import { ADDRESSES, lockwatchVaultAbi, lockwatchRescueAbi, chainById, buildClaim, rewardsDue, EXTEND_REASONS, fmt18, pct18, rescueWanted, radarRisk, type LineEntry } from "@lockwatch/sdk";
import * as repo from "@lockwatch/db";
import type { Db } from "@lockwatch/db";
import { createWalletClient, http, parseAbi, zeroAddress, type Address, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Config } from "./config";
import { log } from "./config";
import type { Notify } from "./keeper";

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
  const account = privateKeyToAccount(cfg.keeperKey);
  return { account, wallet: createWalletClient({ account, chain: chainById(cfg.chainId), transport: http(cfg.rpc) }) };
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
      return wallet.writeContract({ ...request, gas: (gas * 13n) / 10n });
    },
    wait: waitFor(client),
  };
}
