import { ADDRESSES, lockwatchVaultAbi, hintHelpersAbi, sortedTrovesAbi, inBurstWindow, nicr, GAS_COMPENSATION, Mode, NOT_PROTECTABLE_REASONS, chainById } from "@lockwatch/sdk";
import * as repo from "@lockwatch/db";
import type { Db } from "@lockwatch/db";
import { createWalletClient, http, zeroAddress, formatEther, type Address, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig, publicClientFor, log, type Config } from "./config";
import { sleep } from "./indexer";

/** Chain side of the keeper, injectable for tests. */
export interface KeeperChain {
  isProtectable(id: bigint): Promise<[boolean, number]>;
  prefDebt(id: bigint): Promise<bigint>;
  hints(coll: bigint, debt: bigint): Promise<[Address, Address]>;
  simulateBatch(ids: bigint[], ups: Address[], lows: Address[]): Promise<boolean[]>;
  sendBatch(ids: bigint[], ups: Address[], lows: Address[]): Promise<`0x${string}`>;
  wait(hash: `0x${string}`): Promise<"success" | "reverted">;
  balance(): Promise<bigint>;
}

export interface Notify { (owner: string, kind: "protect_failed" | "keeper_low_balance", data: Record<string, string>): Promise<void> }

export const CHUNK = 20;
export const LOW_BALANCE = 2n * 10n ** 15n; // 0.002 BTC

/** One keeper pass: pick due protections, pre-check on chain, compute MUSD hints, send batches. */
export async function keeperTick(db: Db, chain: KeeperChain, chainId: number, now: number, notify?: Notify) {
  const due = await repo.dueProtections(db, chainId, now);
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
    for (const x of go) {
      if (st === "success") results.push({ id: x.id, ok: true, hash });
      else { await repo.recordAttempt(db, chainId, x.id, `tx reverted ${hash}`, now); results.push({ id: x.id, ok: false, hash }); }
    }
    log("keeper", "batch", { hash, n: go.length, status: st });
  }
  const bal = await chain.balance();
  if (bal < LOW_BALANCE) await notify?.("admin", "keeper_low_balance", { balance: formatEther(bal) });
  return results;
}

export function viemKeeperChain(client: PublicClient, cfg: Config): KeeperChain {
  if (!cfg.vault) throw new Error("LOCKWATCH_VAULT not set");
  if (!cfg.keeperKey) throw new Error("KEEPER_PRIVATE_KEY not set");
  const account = privateKeyToAccount(cfg.keeperKey);
  const wallet = createWalletClient({ account, chain: chainById(cfg.chainId), transport: http(cfg.rpc) });
  const a = ADDRESSES[cfg.chainId];
  const vault = cfg.vault;
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
      const gas = await client.estimateContractGas({ account, address: vault, abi: lockwatchVaultAbi, functionName: "protectBatch", args: [ids, ups, lows] });
      const fees = await client.estimateFeesPerGas();
      return wallet.writeContract({ address: vault, abi: lockwatchVaultAbi, functionName: "protectBatch", args: [ids, ups, lows], gas: (gas * 12n) / 10n, maxFeePerGas: (fees.maxFeePerGas! * 12n) / 10n, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
    },
    wait: async (hash) => (await client.waitForTransactionReceipt({ hash, timeout: 120_000 })).status,
    balance: () => client.getBalance({ address: account.address }),
  };
}

/** 5-minute cadence, 30-second burst around the Thursday 00:00 UTC epoch flip and the 01:00 vote-window opening. */
export async function runKeeper(db: Db, cfg = loadConfig(), notify?: Notify, signal?: AbortSignal) {
  const client = publicClientFor(cfg) as PublicClient;
  const chain = viemKeeperChain(client, cfg);
  while (!signal?.aborted) {
    const now = Math.floor(Date.now() / 1000);
    try { await keeperTick(db, chain, cfg.chainId, now, notify); } catch (e) { log("keeper", "error", { err: String(e).slice(0, 300) }); }
    await sleep(inBurstWindow(now) ? 30_000 : 5 * 60_000, signal);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  repo.connect().then((db) => runKeeper(db));
}
