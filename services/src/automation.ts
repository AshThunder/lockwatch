import { ADDRESSES, lockwatchVaultAbi, lockwatchRescueAbi, chainById, buildClaim, rewardsDue, EXTEND_REASONS, fmt18, pct18, rescueWanted, radarRisk, type LineEntry } from "@lockwatch/sdk";
import * as repo from "@lockwatch/db";
import type { Db } from "@lockwatch/db";
import { createWalletClient, http, parseAbi, zeroAddress, type Address, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Config } from "./config";
import { log } from "./config";
import type { Notify } from "./keeper";
import { keeperWallet, buffered } from "./signer";

type Hash = `0x${string}`;
const TYPICAL_REDEMPTION = BigInt(process.env.TYPICAL_REDEMPTION_MUSD ?? "10000") * 10n ** 18n;

// ================================================================ auto-extend
export interface ExtendChain {
  canExtend(id: bigint): Promise<[boolean, number, bigint, bigint]>; // ok, reason, end, target
  extend(id: bigint): Promise<Hash>;
  wait(hash: Hash): Promise<"success" | "reverted">;
}

/** Runs vault.extend for every policy whose window is open. Permanent reasons deactivate the row. */
export async function extendTick(db: Db, chain: ExtendChain, chainId: number, now: number, notify?: Notify) {
  const out: { id: string; ok: boolean; hash?: string; reason?: string }[] = [];
  for (const row of await repo.dueExtends(db, chainId, now)) {
    const id = BigInt(row.lock_id);
    const [ok, why, end, target] = await chain.canExtend(id);
    if (!ok) {
      if (why === 1 || why === 2 || why === 4 || why === 7) await repo.setExtendActive(db, chainId, id, false);
      if (why === 5 || why === 2) {
        await repo.logRun(db, { chainId, job: "extend", subject: row.lock_id, ok: false, detail: EXTEND_REASONS[why], ts: now });
        out.push({ id: row.lock_id, ok: false, reason: EXTEND_REASONS[why] });
      }
      continue; // 8 (too early) / 10 (no gain yet) just wait
    }
    try {
      const hash = await chain.extend(id);
      const st = await chain.wait(hash);
      const good = st === "success";
      await repo.logRun(db, { chainId, job: "extend", subject: row.lock_id, ok: good, txHash: hash, detail: good ? `${end}→${target}` : "tx reverted", ts: now });
      if (good) {
        await repo.markExtended(db, chainId, id, hash, now);
        await repo.upsertLock(db, { ...(await lockArgs(db, chainId, id)), end: Number(target) });
        await notify?.(row.owner, "extended", { lockId: row.lock_id, end: String(target), tx: hash });
      }
      out.push({ id: row.lock_id, ok: good, hash });
    } catch (e) {
      await repo.logRun(db, { chainId, job: "extend", subject: row.lock_id, ok: false, detail: String(e).slice(0, 200), ts: now });
      out.push({ id: row.lock_id, ok: false, reason: String(e).slice(0, 120) });
    }
  }
  return out;
}

async function lockArgs(db: Db, chainId: number, id: bigint) {
  const l = await repo.lockById(db, chainId, id);
  return { chainId, id, owner: l.owner, amount: BigInt(l.amount), end: Number(l.lock_end), permanent: l.permanent, voted: l.voted, approvedVault: l.approved_vault, withdrawn: l.withdrawn };
}

// ================================================================ reward auto-claim
export interface RewardsChain {
  /** Gauges with per-token earned amounts for `id` (bribe + fee reward contracts). */
  claimable(id: bigint): Promise<{ gauge: Address; bribe: { token: Address; earned: bigint }[]; fees: { token: Address; earned: bigint }[] }[]>;
  claim(id: bigint, gauges: Address[], bribeTokens: Address[][], feeTokens: Address[][]): Promise<Hash>;
  wait(hash: Hash): Promise<"success" | "reverted">;
}

/** Once per epoch (after the Thursday distribute hour) claim everything earned for opted-in locks. */
export async function rewardsTick(db: Db, chain: RewardsChain, chainId: number, now: number, notify?: Notify) {
  const out: { id: string; ok: boolean; hash?: string; skipped?: string }[] = [];
  for (const row of await repo.enabledRewards(db, chainId)) {
    if (!rewardsDue(now, Number(row.last_claim_at))) continue;
    const id = BigInt(row.lock_id);
    const items = await chain.claimable(id);
    const c = buildClaim(items);
    if (!c) { await repo.markRewardsClaimed(db, chainId, id, null, now); out.push({ id: row.lock_id, ok: true, skipped: "nothing earned" }); continue; }
    try {
      const hash = await chain.claim(id, c.gauges, c.bribeTokens, c.feeTokens);
      const st = await chain.wait(hash);
      const good = st === "success";
      const total = items.flatMap((i) => [...i.bribe, ...i.fees]).reduce((s, x) => s + x.earned, 0n);
      await repo.logRun(db, { chainId, job: "rewards", subject: row.lock_id, ok: good, txHash: hash, detail: good ? `${c.gauges.length} gauge(s)` : "tx reverted", ts: now });
      if (good) {
        await repo.markRewardsClaimed(db, chainId, id, hash, now);
        await notify?.(row.owner, "rewards_claimed", { lockId: row.lock_id, gauges: String(c.gauges.length), amount: fmt18(total), tx: hash });
      }
      out.push({ id: row.lock_id, ok: good, hash });
    } catch (e) {
      await repo.logRun(db, { chainId, job: "rewards", subject: row.lock_id, ok: false, detail: String(e).slice(0, 200), ts: now });
      out.push({ id: row.lock_id, ok: false });
    }
  }
  return out;
}

// ================================================================ loan rescue
export interface RescueChain {
  check(borrower: Address): Promise<[boolean, bigint, bigint, bigint]>; // ok, icr, addBtc, repay
  rescue(borrower: Address): Promise<Hash>;
  wait(hash: Hash): Promise<"success" | "reverted">;
}

/** Rescues borrowers whose onchain ICR is below their trigger. A Radar "danger" position just above the trigger is
 *  logged as a watch (the contract only permits a rescue below the borrower's own trigger). */
export async function rescueTick(db: Db, chain: RescueChain, chainId: number, now: number, notify?: Notify) {
  const out: { borrower: string; ok: boolean; hash?: string; why?: string }[] = [];
  for (const r of await repo.activeRescues(db, chainId, now)) {
    const b = r.borrower as Address;
    const [ok, icr, add, repay] = await chain.check(b);
    const t = await repo.troveOf(db, chainId, b);
    const risk = t ? radarRisk({ owner: b, coll: BigInt(t.coll), debt: BigInt(t.debt), icr: BigInt(t.icr), rank: t.rank, musdAhead: BigInt(t.musd_ahead), redeemable: t.redeemable } as LineEntry, TYPICAL_REDEMPTION) : null;
    const why = rescueWanted({ icr, triggerIcr: BigInt(r.trigger_icr), radarRisk: risk });
    if (!ok) { if (why === "front_of_line") out.push({ borrower: b, ok: false, why: "front_of_line_watch" }); continue; }
    try {
      const hash = await chain.rescue(b);
      const st = await chain.wait(hash);
      const good = st === "success";
      await repo.logRun(db, { chainId, job: "rescue", subject: b, ok: good, txHash: hash, detail: good ? `ICR ${pct18(icr)}: +${fmt18(add)} BTC, -${fmt18(repay)} MUSD` : "tx reverted", ts: now });
      if (good) await notify?.(b, "rescued", { icr: pct18(icr), btc: fmt18(add), musd: fmt18(repay), tx: hash });
      out.push({ borrower: b, ok: good, hash, why: why ?? undefined });
    } catch (e) {
      await repo.logRun(db, { chainId, job: "rescue", subject: b, ok: false, detail: String(e).slice(0, 200), ts: now });
      out.push({ borrower: b, ok: false });
    }
  }
  return out;
}

// ================================================================ viem implementations
const voterAbi2 = parseAbi([
  "function length() view returns (uint256)",
  "function pools(uint256) view returns (address)",
  "function gauges(address) view returns (address)",
  "function gaugeToBribe(address) view returns (address)",
  "function gaugeToFees(address) view returns (address)",
]);
const boostVoterAbi = parseAbi([
  "function gaugeVote(uint256 tokenId, uint256 index) view returns (address)",
  "function gaugeToBribe(address) view returns (address)",
]);
const rewardAbi = parseAbi([
  "function rewardsListLength() view returns (uint256)",
  "function rewards(uint256) view returns (address)",
  "function earned(address token, uint256 tokenId) view returns (uint256)",
]);

function writer(cfg: Config) {
  if (!cfg.keeperKey) throw new Error("KEEPER_PRIVATE_KEY not set");
  return keeperWallet(cfg.keeperKey, cfg.chainId, cfg.rpc);
}
const waitFor = (client: PublicClient) => async (hash: Hash) => (await client.waitForTransactionReceipt({ hash, timeout: 120_000 })).status;

export function viemExtendChain(client: PublicClient, cfg: Config): ExtendChain {
  const { account, wallet } = writer(cfg);
  const vault = cfg.vault!;
  return {
    canExtend: async (id) => (await client.readContract({ address: vault, abi: lockwatchVaultAbi, functionName: "canExtend", args: [id] })) as [boolean, number, bigint, bigint],
    extend: async (id) => {
      const { request } = await client.simulateContract({ account, address: vault, abi: lockwatchVaultAbi, functionName: "extend", args: [id] });
      return wallet.writeContract(request);
    },
    wait: waitFor(client),
  };
}

export function viemRewardsChain(client: PublicClient, cfg: Config): RewardsChain {
  const { account, wallet } = writer(cfg);
  const vault = cfg.vault!;
  const voter = cfg.voter;
  const boost = cfg.asset === "mezo"; // veMEZO BoostVoter: bribes only, gauges found per lock via gaugeVote
  let gaugeCache: { at: number; list: { gauge: Address; bribe: Address; fees: Address; bribeTokens: Address[]; feeTokens: Address[] }[] } | null = null;
  async function tokensOf(reward: Address): Promise<Address[]> {
    const n = Number(await client.readContract({ address: reward, abi: rewardAbi, functionName: "rewardsListLength" }));
    return Promise.all(Array.from({ length: n }, (_, i) => client.readContract({ address: reward, abi: rewardAbi, functionName: "rewards", args: [BigInt(i)] }))) as Promise<Address[]>;
  }
  async function gauges() {
    if (gaugeCache && Date.now() - gaugeCache.at < 3600_000) return gaugeCache.list;
    const n = Number(await client.readContract({ address: voter, abi: voterAbi2, functionName: "length" }));
    const list = [];
    for (let i = 0; i < n; i++) {
      const pool = await client.readContract({ address: voter, abi: voterAbi2, functionName: "pools", args: [BigInt(i)] });
      const gauge = await client.readContract({ address: voter, abi: voterAbi2, functionName: "gauges", args: [pool] });
      if (gauge === zeroAddress) continue;
      const [bribe, fees] = await Promise.all([
        client.readContract({ address: voter, abi: voterAbi2, functionName: "gaugeToBribe", args: [gauge] }),
        client.readContract({ address: voter, abi: voterAbi2, functionName: "gaugeToFees", args: [gauge] }),
      ]);
      list.push({ gauge, bribe, fees, bribeTokens: await tokensOf(bribe), feeTokens: await tokensOf(fees) });
    }
    gaugeCache = { at: Date.now(), list };
    return list;
  }
  /** veMEZO: the BoostVoter has 600+ boost gauges, so only the gauges this lock votes for are checked. */
  async function votedGauges(id: bigint) {
    const list: { gauge: Address; bribe: Address; fees: Address; bribeTokens: Address[]; feeTokens: Address[] }[] = [];
    for (let i = 0; i < 64; i++) {
      let gauge: Address;
      try { gauge = await client.readContract({ address: voter, abi: boostVoterAbi, functionName: "gaugeVote", args: [id, BigInt(i)] }) as Address; } catch { break; }
      const bribe = await client.readContract({ address: voter, abi: boostVoterAbi, functionName: "gaugeToBribe", args: [gauge] }) as Address;
      list.push({ gauge, bribe, fees: zeroAddress, bribeTokens: await tokensOf(bribe), feeTokens: [] });
    }
    return list;
  }
  const earned = (reward: Address, tokens: Address[], id: bigint) =>
    Promise.all(tokens.map(async (token) => ({ token, earned: (await client.readContract({ address: reward, abi: rewardAbi, functionName: "earned", args: [token, id] })) as bigint })));
  return {
    claimable: async (id) => Promise.all((boost ? await votedGauges(id) : await gauges()).map(async (g) => ({ gauge: g.gauge, bribe: await earned(g.bribe, g.bribeTokens, id), fees: g.feeTokens.length ? await earned(g.fees, g.feeTokens, id) : [] }))),
    claim: async (id, gs, bt, ft) => {
      const { request } = await client.simulateContract({ account, address: vault, abi: lockwatchVaultAbi, functionName: "claimRewards", args: [id, gs, bt, ft] });
      return wallet.writeContract(request);
    },
    wait: waitFor(client),
  };
}

export function viemRescueChain(client: PublicClient, cfg: Config): RescueChain {
  const { account, wallet } = writer(cfg);
  const rescue = cfg.rescue!;
  return {
    check: async (b) => (await client.readContract({ address: rescue, abi: lockwatchRescueAbi, functionName: "check", args: [b] })) as [boolean, bigint, bigint, bigint],
    rescue: async (b) => {
      const { request } = await client.simulateContract({ account, address: rescue, abi: lockwatchRescueAbi, functionName: "rescue", args: [b, zeroAddress, zeroAddress] });
      const gas = await client.estimateContractGas({ account, address: rescue, abi: lockwatchRescueAbi, functionName: "rescue", args: [b, zeroAddress, zeroAddress] });
      log("keeper", "rescue", { borrower: b, gas });
      return wallet.writeContract({ ...request, gas: buffered(gas) });
    },
    wait: waitFor(client),
  };
}

// ================================================================ rebase auto-claim (RewardsDistributor, permissionless)
export interface RebaseChain {
  /** false while the Splitter hasn't rolled into the current epoch (claim/claimMany revert UpdatePeriod). */
  ready(): Promise<boolean>;
  claimable(ids: bigint[]): Promise<bigint[]>;
  claimMany(ids: bigint[]): Promise<Hash>;
  wait(hash: Hash): Promise<"success" | "reverted">;
}
export const REBASE_BATCH = 25;
const WEEK_S = 7 * 86400;

export const REBASE_TRIES = 3;
/** Each epoch: claim every rebase at or above `min` for every indexed lock of this escrow. Anyone may call
 *  RewardsDistributor.claim; the protocol itself compounds into a live lock or pays the owner of an expired one, so
 *  the keeper only spends gas. Strictly sequential: one tx in flight, each receipt awaited, and the lock's
 *  claimable re-read right before its send so nothing is sent for a lock with nothing left (the first claim of a
 *  week checkpoints the distributor, which can change every other lock's amount). A batch that fails is retried
 *  per lock so one odd id can't block the rest. After a successful round the amounts are re-read once more (the
 *  checkpoint can make new locks due). The epoch is marked done when nothing is left due or after REBASE_TRIES
 *  passes, so failures never loop gas. */
export async function rebaseTick(db: Db, chain: RebaseChain, chainId: number, now: number, min: bigint) {
  const epoch = Math.floor(now / WEEK_S) * WEEK_S;
  const key = `rebase:${chainId}`, triesKey = `rebase-tries:${chainId}`;
  if (Number((await repo.getCursor(db, key)) ?? 0) >= epoch) return { skipped: "done this epoch" };
  if (!(await chain.ready())) return { skipped: "distributor not updated for this epoch" };
  const [tEpoch, tN] = String((await repo.getCursor(db, triesKey)) ?? "0:0").split(":").map(Number);
  const tries = (tEpoch === epoch ? tN : 0) + 1;
  await repo.setCursor(db, triesKey, `${epoch}:${tries}`);
  const ids = (await repo.liveLocks(db, chainId)).map((r) => BigInt(r.id));
  const read = async (xs: bigint[]) => {
    const amounts: bigint[] = [];
    for (let i = 0; i < xs.length; i += 200) amounts.push(...(await chain.claimable(xs.slice(i, i + 200))));
    return xs.map((id, i) => ({ id, amt: amounts[i] ?? 0n })).filter((x) => x.amt >= min);
  };
  const out: { ids: string[]; ok: boolean; hash?: string; err?: string }[] = [];
  const record = async (batch: { id: bigint; amt: bigint }[], ok: boolean, hash?: string, err?: string) => {
    for (const x of batch) await repo.logRun(db, { chainId, job: "rebase", subject: x.id.toString(), ok, txHash: hash, detail: ok ? x.amt.toString() : (err ?? "tx reverted").slice(0, 200), ts: now });
    out.push({ ids: batch.map((x) => x.id.toString()), ok, hash, err });
  };
  const run = async (batch0: { id: bigint; amt: bigint }[]): Promise<void> => {
    const batch = await read(batch0.map((x) => x.id)); // fresh amounts; skips locks with nothing claimable now
    if (!batch.length) return;
    let hash: Hash | undefined;
    try {
      hash = await chain.claimMany(batch.map((x) => x.id));
      if ((await chain.wait(hash)) === "success") return record(batch, true, hash);
    } catch (e) {
      if (batch.length > 1) { for (const x of batch) await run([x]); return; }
      return record(batch, false, hash, String(e));
    }
    if (batch.length > 1) { for (const x of batch) await run([x]); return; }
    await record(batch, false, hash);
  };
  let due = await read(ids), total = 0;
  const seen = new Set<string>();
  for (let round = 0; round < 2 && due.length; round++) {
    total += due.length;
    due.forEach((x) => seen.add(x.id.toString()));
    const before = out.filter((o) => o.ok).length;
    for (let i = 0; i < due.length; i += REBASE_BATCH) await run(due.slice(i, i + REBASE_BATCH));
    if (out.filter((o) => o.ok).length === before) break;
    due = (await read(ids)).filter((x) => !seen.has(x.id.toString())); // newly due after a checkpoint
  }
  const left = (await read(ids)).length;
  if (!left || tries >= REBASE_TRIES) await repo.setCursor(db, key, String(epoch));
  log("keeper", "rebase", { ledger: chainId, candidates: ids.length, due: total, batches: out.length, ok: out.filter((o) => o.ok).length, left, try: tries });
  return { due: total, batches: out, left };
}

const distAbi = parseAbi([
  "function claimable(uint256) view returns (uint256)",
  "function claimMany(uint256[]) returns (bool)",
  "function depositor() view returns (address)",
]);
export function viemRebaseChain(client: PublicClient, cfg: Config): RebaseChain {
  const { account, wallet } = writer(cfg);
  const dist = cfg.distributor!;
  return {
    ready: async () => {
      const dep = await client.readContract({ address: dist, abi: distAbi, functionName: "depositor" });
      const ap = await client.readContract({ address: dep, abi: parseAbi(["function activePeriod() view returns (uint256)"]), functionName: "activePeriod" });
      const ts = (await client.getBlock()).timestamp;
      return ap >= (ts / 604800n) * 604800n;
    },
    claimable: async (ids) => {
      const rs = await client.multicall({ contracts: ids.map((id) => ({ address: dist, abi: distAbi, functionName: "claimable" as const, args: [id] })) });
      return rs.map((r) => (r.status === "success" ? (r.result as bigint) : 0n));
    },
    claimMany: async (ids) => {
      const { request } = await client.simulateContract({ account, address: dist, abi: distAbi, functionName: "claimMany", args: [ids] });
      const gas = await client.estimateContractGas({ account, address: dist, abi: distAbi, functionName: "claimMany", args: [ids] });
      // floor: ~420k per lock observed on testnet; the 06:24 WAT singles died out of gas at a 47,929 limit
      return wallet.writeContract({ ...request, gas: buffered(gas, 300_000n + 450_000n * BigInt(ids.length)) });
    },
    wait: waitFor(client),
  };
}
