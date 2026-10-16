import { ADDRESSES, lockwatchVaultAbi, hintHelpersAbi, sortedTrovesAbi, inBurstWindow, nicr, GAS_COMPENSATION, Mode, NOT_PROTECTABLE_REASONS, chainById } from "@lockwatch/sdk";
import * as repo from "@lockwatch/db";
import type { Db } from "@lockwatch/db";
import { createWalletClient, http, parseEventLogs, zeroAddress, formatEther, type Address, type PublicClient } from "viem";
import { keeperWallet, serial } from "./signer";
import { loadConfig, publicClientFor, log, allVaults, type Config } from "./config";
import { extendTick, rewardsTick, rescueTick, rebaseTick, viemExtendChain, viemRewardsChain, viemRescueChain, viemRebaseChain, type ExtendChain, type RewardsChain, type RescueChain, type RebaseChain, type RebaseLimits } from "./automation";
import { sleep } from "./indexer";

/** Chain side of the keeper, injectable for tests. */
export interface KeeperChain {
  isProtectable(id: bigint): Promise<[boolean, number]>;
  prefDebt(id: bigint): Promise<bigint>;
  hints(coll: bigint, debt: bigint): Promise<[Address, Address]>;
  simulateBatch(ids: bigint[], ups: Address[], lows: Address[]): Promise<boolean[]>;
  sendBatch(ids: bigint[], ups: Address[], lows: Address[]): Promise<`0x${string}`>;
  wait(hash: `0x${string}`): Promise<"success" | "reverted">;
  /** ids that emitted Protected in the tx. protectBatch swallows per-id failures, so tx success != id success. */
  protectedIn?(hash: `0x${string}`): Promise<bigint[]>;
  balance(): Promise<bigint>;
}

export type NotifyKind = "protect_failed" | "keeper_low_balance" | "extended" | "rewards_claimed" | "rescued";
export interface Notify { (owner: string, kind: NotifyKind, data: Record<string, string>): Promise<void> }

export const CHUNK = 20;
export const LOW_BALANCE = 2n * 10n ** 15n; // 0.002 BTC

/** One keeper pass: pick due protections, pre-check on chain, compute MUSD hints, send batches. */
export async function keeperTick(db: Db, chain: KeeperChain, chainId: number, now: number, notify?: Notify,
  vault?: { address: string; isDefaultForNull: boolean }, opts: { checkBalance?: boolean } = {}) {
  const due = await repo.dueProtections(db, chainId, now, vault);
  const ready: { id: bigint; up: Address; low: Address }[] = [];
  for (const d of due) {
    const id = BigInt(d.lock_id);
    const [ok, why] = await chain.isProtectable(id);
    if (!ok) {
      if (why === 3 || why === 6) continue; // not expired / reset window: just wait, not a failure
      const { dead } = await repo.recordAttempt(db, chainId, id, NOT_PROTECTABLE_REASONS[why] ?? `reason ${why}`, now);
      if (why === 1) await repo.upsertProtection(db, { chainId, lockId: id, owner: d.owner, mode: d.mode, active: false });
      if (dead || why === 2 || why === 5) await notify?.(d.owner, "protect_failed", { lockId: d.lock_id, reason: NOT_PROTECTABLE_REASONS[why] ?? String(why) });
      continue;
    }
    let up: Address = zeroAddress, low: Address = zeroAddress;
    if (d.mode === Mode.MUSD || d.mode === Mode.MUSD_SAVINGS) {
      try { [up, low] = await chain.hints(BigInt(d.amount), await chain.prefDebt(id)); } catch { /* zero hints still work, just more gas */ }
    }
    ready.push({ id, up, low });
  }
  const results: { id: bigint; ok: boolean; hash?: string }[] = [];
  for (let i = 0; i < ready.length; i += CHUNK) {
    const c = ready.slice(i, i + CHUNK);
    const ids = c.map((x) => x.id), ups = c.map((x) => x.up), lows = c.map((x) => x.low);
    let sim: boolean[];
    try { sim = await chain.simulateBatch(ids, ups, lows); } catch (e) { sim = ids.map(() => false); log("keeper", "simulate failed", { err: String(e).slice(0, 200) }); }
    const go = c.filter((_, j) => sim[j]);
    for (const x of c.filter((_, j) => !sim[j])) {
      const { dead } = await repo.recordAttempt(db, chainId, x.id, "simulation failed", now);
      if (dead) await notify?.((due.find((d) => d.lock_id === x.id.toString()))!.owner, "protect_failed", { lockId: x.id.toString(), reason: "simulation failed 3 times — tap to claim manually" });
      results.push({ id: x.id, ok: false });
    }
    if (!go.length) continue;
    const hash = await chain.sendBatch(go.map((x) => x.id), go.map((x) => x.up), go.map((x) => x.low));
    const st = await chain.wait(hash);
    const done = st === "success" && chain.protectedIn ? new Set((await chain.protectedIn(hash)).map(String)) : null;
    for (const x of go) {
      const ok = st === "success" && (!done || done.has(x.id.toString()));
      await repo.logRun(db, { chainId, job: "protect", subject: x.id.toString(), ok, txHash: hash, detail: ok ? undefined : st === "success" ? "skipped in batch" : "tx reverted", ts: now });
      if (ok) results.push({ id: x.id, ok: true, hash });
      else {
        const { dead } = await repo.recordAttempt(db, chainId, x.id, st === "success" ? `skipped in batch ${hash}` : `tx reverted ${hash}`, now);
        if (dead) await notify?.((due.find((d) => d.lock_id === x.id.toString()))!.owner, "protect_failed", { lockId: x.id.toString(), reason: "keeper could not protect it 3 times — tap to claim manually" });
        results.push({ id: x.id, ok: false, hash });
      }
    }
    log("keeper", "batch", { hash, n: go.length, status: st });
  }
  if (opts.checkBalance !== false) {
    const bal = await chain.balance();
    if (bal < LOW_BALANCE) await notify?.("admin", "keeper_low_balance", { balance: formatEther(bal) });
  }
  return results;
}

export function viemKeeperChain(client: PublicClient, cfg: Config, vaultOverride?: Address): KeeperChain {
  if (!cfg.vault && !vaultOverride) throw new Error("LOCKWATCH_VAULT not set");
  if (!cfg.keeperKey) throw new Error("KEEPER_PRIVATE_KEY not set");
  const { account, wallet } = keeperWallet(cfg.keeperKey, cfg.chainId, cfg.rpc);
  const a = ADDRESSES[cfg.chainId];
  const vault = (vaultOverride ?? cfg.vault)!;
  return {
    isProtectable: async (id) => (await client.readContract({ address: vault, abi: lockwatchVaultAbi, functionName: "isProtectable", args: [id] })) as [boolean, number],
    prefDebt: async (id) => ((await client.readContract({ address: vault, abi: lockwatchVaultAbi, functionName: "prefs", args: [id] })) as { debt: bigint }).debt,
    hints: async (coll, debt) => {
      const n = nicr(coll, debt + GAS_COMPENSATION + debt / 200n);
      const [approx] = await client.readContract({ address: a.hintHelpers, abi: hintHelpersAbi, functionName: "getApproxHint", args: [n, 50n, BigInt(Date.now())] });
      return (await client.readContract({ address: a.sortedTroves, abi: sortedTrovesAbi, functionName: "findInsertPosition", args: [n, approx, approx] })) as [Address, Address];
    },
    simulateBatch: async (ids, ups, lows) =>
      (await client.simulateContract({ account, address: vault, abi: lockwatchVaultAbi, functionName: "protectBatch", args: [ids, ups, lows] })).result as boolean[],
    sendBatch: async (ids, ups, lows) => {
      // Estimate each id with the reverting single-id `protect` and sum them. Estimating protectBatch itself is
      // unsafe: it try/catches per id, so the node's minimal-gas search happily returns a limit at which later
      // ids run out of gas and are silently skipped (found in the fork e2e).
      let gas = 60_000n;
      for (let i = 0; i < ids.length; i++) {
        gas += await client.estimateContractGas({ account, address: vault, abi: lockwatchVaultAbi, functionName: "protect", args: [ids[i], ups[i], lows[i]] }) + 15_000n;
      }
      const fees = await client.estimateFeesPerGas();
      return wallet.writeContract({ address: vault, abi: lockwatchVaultAbi, functionName: "protectBatch", args: [ids, ups, lows], gas: (gas * 13n) / 10n, maxFeePerGas: (fees.maxFeePerGas! * 12n) / 10n, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
    },
    wait: async (hash) => (await client.waitForTransactionReceipt({ hash, timeout: 120_000 })).status,
    protectedIn: async (hash) => {
      const rc = await client.getTransactionReceipt({ hash });
      return parseEventLogs({ abi: lockwatchVaultAbi, logs: rc.logs.filter((l) => l.address.toLowerCase() === vault.toLowerCase()), eventName: "Protected" })
        .map((e) => (e.args as { tokenId: bigint }).tokenId);
    },
    balance: () => client.getBalance({ address: account.address }),
  };
}

/** One full keeper pass: protect (all vaults), auto-extend, reward claims, loan rescue, heartbeat, then bounded rebase claims. */
export function keeperPass(db: Db, jobs: KeeperJobs, chainId: number, now: number, notify?: Notify) {
  return serial(() => pass(db, jobs, chainId, now, notify)); // one pass (and so one tx) at a time across ledgers
}
async function pass(db: Db, jobs: KeeperJobs, chainId: number, now: number, notify?: Notify) {
  const out: Record<string, unknown> = {};
  for (const [i, v] of jobs.vaults.entries()) {
    try { out[`protect:${v.address}`] = await keeperTick(db, v.chain, chainId, now, notify, { address: v.address, isDefaultForNull: v.isDefaultForNull }, { checkBalance: i === 0 }); }
    catch (e) { log("keeper", "protect error", { vault: v.address, err: String(e).slice(0, 300) }); }
  }
  if (jobs.extend) try { out.extend = await extendTick(db, jobs.extend, chainId, now, notify); } catch (e) { log("keeper", "extend error", { err: String(e).slice(0, 300) }); }
  if (jobs.rewards) try { out.rewards = await rewardsTick(db, jobs.rewards, chainId, now, notify); } catch (e) { log("keeper", "rewards error", { err: String(e).slice(0, 300) }); }
  if (jobs.rescue) try { out.rescue = await rescueTick(db, jobs.rescue, chainId, now, notify); } catch (e) { log("keeper", "rescue error", { err: String(e).slice(0, 300) }); }
  // heartbeat once protection is done, before the (bounded, best-effort) rebase claims
  await repo.logRun(db, { chainId, job: "heartbeat", ok: true, ts: now });
  await repo.pruneHeartbeats(db, chainId, now);
  if (jobs.rebase) try { out.rebase = await rebaseTick(db, jobs.rebase.chain, chainId, now, jobs.rebase.min, jobs.rebase.limits); } catch (e) { log("keeper", "rebase error", { err: String(e).slice(0, 300) }); }
  return out;
}

export interface KeeperJobs {
  vaults: { address: string; isDefaultForNull: boolean; chain: KeeperChain }[];
  extend?: ExtendChain;
  rewards?: RewardsChain;
  rescue?: RescueChain;
  rebase?: { chain: RebaseChain; min: bigint; limits?: RebaseLimits };
}

export function viemKeeperJobs(client: PublicClient, cfg: Config): KeeperJobs {
  const v1 = cfg.legacyVaults.at(-1) ?? cfg.vault;
  const vaults = allVaults(cfg).map((v) => ({ address: v, isDefaultForNull: v.toLowerCase() === v1?.toLowerCase(), chain: viemKeeperChain(client, cfg, v) }));
  return {
    vaults,
    extend: cfg.vault ? viemExtendChain(client, cfg) : undefined,
    rewards: cfg.vault ? viemRewardsChain(client, cfg) : undefined,
    rescue: cfg.rescue ? viemRescueChain(client, cfg) : undefined,
    rebase: cfg.distributor && cfg.keeperKey ? { chain: viemRebaseChain(client, cfg), min: cfg.rebaseMin, limits: { maxClaims: cfg.rebaseMaxClaims, budgetMs: cfg.rebaseBudgetMs } } : undefined,
  };
}

/** 5-minute cadence, 30-second burst around the Thursday 00:00 UTC epoch flip and the 01:00 vote-window opening. */
export async function runKeeper(db: Db, cfg = loadConfig(), notify?: Notify, signal?: AbortSignal) {
  const client = publicClientFor(cfg) as PublicClient;
  const jobs = viemKeeperJobs(client, cfg);
  log("keeper", "jobs", { asset: cfg.asset, vaults: jobs.vaults.map((v) => v.address), extend: !!jobs.extend, rewards: !!jobs.rewards, rescue: !!jobs.rescue, rebase: !!jobs.rebase });
  while (!signal?.aborted) {
    const now = Math.floor(Date.now() / 1000);
    try { await keeperPass(db, jobs, cfg.ledger, now, notify); } catch (e) { log("keeper", "error", { err: String(e).slice(0, 300) }); }
    await sleep(inBurstWindow(now) ? 30_000 : 5 * 60_000, signal);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  repo.connect().then((db) => runKeeper(db));
}
