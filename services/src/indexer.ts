import { ADDRESSES, veBTCAbi, lockwatchVaultAbi, lockwatchRescueAbi, summarizeAtRisk, type LockView } from "@lockwatch/sdk";
import * as repo from "@lockwatch/db";
import type { Db } from "@lockwatch/db";
import { parseEventLogs, zeroAddress, type Address, type PublicClient } from "viem";
import { loadConfig, publicClientFor, log, allVaults, type Config } from "./config";

/**
 * Indexer: keeps `lock` and `protection` in sync with chain.
 *  - full scan of ids 1..tokenId() (multicall) on first run and every 6h as a cross-check
 *  - incremental: veBTC Transfer/Deposit/Withdraw/Approval + vault events since the cursor block; every touched id
 *    is re-read from chain (state reads are the source of truth, events only say *what* changed)
 */
export async function readLocks(client: PublicClient, chainId: number, ids: bigint[], vault: Address | null | Address[]) {
  const vset = new Set((Array.isArray(vault) ? vault : vault ? [vault] : []).map((v) => v.toLowerCase()));
  const ve = ADDRESSES[chainId as 31611].veBTC;
  const out: Parameters<typeof repo.upsertLock>[1][] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const calls = chunk.flatMap((id) => [
      { address: ve, abi: veBTCAbi, functionName: "ownerOf", args: [id] },
      { address: ve, abi: veBTCAbi, functionName: "locked", args: [id] },
      { address: ve, abi: veBTCAbi, functionName: "voted", args: [id] },
      { address: ve, abi: veBTCAbi, functionName: "getApproved", args: [id] },
    ] as const);
    const res = await client.multicall({ contracts: calls as never, allowFailure: true }) as unknown as { status: string; result?: unknown }[];
    chunk.forEach((id, j) => {
      const [o, l, v, a] = res.slice(j * 4, j * 4 + 4);
      const owner = (o.status === "success" ? o.result : zeroAddress) as Address;
      const lk = l.status === "success" ? (l.result as { amount: bigint; end: bigint; isPermanent: boolean }) : null;
      out.push({
        chainId, id, owner,
        amount: lk ? BigInt(lk.amount) : 0n,
        end: lk ? Number(lk.end) : 0,
        permanent: lk?.isPermanent ?? false,
        voted: v.status === "success" ? (v.result as boolean) : false,
        approvedVault: a.status === "success" && vset.has((a.result as string).toLowerCase()),
        withdrawn: owner === zeroAddress,
      });
    });
  }
  return out;
}

export async function fullScan(db: Db, client: PublicClient, cfg: Config) {
  const ve = ADDRESSES[cfg.chainId].veBTC;
  const max = await client.readContract({ address: ve, abi: veBTCAbi, functionName: "tokenId" });
  const ids = Array.from({ length: Number(max) }, (_, i) => BigInt(i + 1));
  const rows = await readLocks(client, cfg.chainId, ids, allVaults(cfg));
  for (const r of rows) await repo.upsertLock(db, r);
  const live = rows.filter((r) => !r.withdrawn).map((r) => r.id);
  for (const v of allVaults(cfg)) await reconcileProtections(db, client, cfg, live, v);
  if (cfg.vault) await reconcileAutomation(db, client, cfg, live);
  log("indexer", "full scan", { locks: rows.length, live: rows.filter((r) => !r.withdrawn).length });
  return rows;
}

/** Vault prefs are the source of truth: backfills registrations made before the event cursor (fresh DB,
 *  reset cursor) and deactivates rows whose on-chain pref was cleared. Without this a fresh DB never protects. */
export async function reconcileProtections(db: Db, client: PublicClient, cfg: Config, ids: bigint[], vault: Address = cfg.vault!) {
  const v1 = (cfg.legacyVaults.at(-1) ?? cfg.vault!).toLowerCase(); // NULL vault rows predate v2 and belong to v1
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const res = await client.multicall({
      contracts: chunk.map((id) => ({ address: vault, abi: lockwatchVaultAbi, functionName: "prefs", args: [id] })) as never,
      allowFailure: true,
    }) as unknown as { status: string; result?: { owner: Address; mode: number } }[];
    for (let j = 0; j < chunk.length; j++) {
      const r = res[j];
      if (r.status !== "success" || !r.result) continue;
      const { owner, mode } = r.result;
      if (owner !== zeroAddress) await repo.upsertProtection(db, { chainId: cfg.chainId, lockId: chunk[j], owner, mode, active: true, vault });
      else await db.query(`UPDATE protection SET active=false WHERE chain_id=$1 AND lock_id=$2 AND active AND COALESCE(vault,$4)=$3`, [cfg.chainId, chunk[j].toString(), vault.toLowerCase(), v1]);
    }
  }
}

/** v2 vault state (auto-extend policies, reward opt-ins) is the source of truth, like prefs. */
export async function reconcileAutomation(db: Db, client: PublicClient, cfg: Config, ids: bigint[]) {
  const vault = cfg.vault!;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const res = await client.multicall({
      contracts: chunk.flatMap((id) => [
        { address: vault, abi: lockwatchVaultAbi, functionName: "extendPolicy", args: [id] },
        { address: vault, abi: lockwatchVaultAbi, functionName: "rewardsOwner", args: [id] },
      ]) as never,
      allowFailure: true,
    }) as unknown as { status: string; result?: unknown }[];
    for (let j = 0; j < chunk.length; j++) {
      const e = res[2 * j], r = res[2 * j + 1];
      if (e.status === "success") {
        const p = e.result as { owner: Address; triggerWithin: number; duration: number };
        if (p.owner !== zeroAddress) await repo.upsertExtend(db, { chainId: cfg.chainId, lockId: chunk[j], owner: p.owner, triggerWithin: Number(p.triggerWithin), duration: Number(p.duration), active: true });
        else await repo.setExtendActive(db, cfg.chainId, chunk[j], false);
      }
      if (r.status === "success") {
        const o = r.result as Address;
        if (o !== zeroAddress) await repo.upsertRewards(db, { chainId: cfg.chainId, lockId: chunk[j], owner: o, enabled: true });
        else await db.query(`UPDATE rewards_auto SET enabled=false WHERE chain_id=$1 AND lock_id=$2`, [cfg.chainId, chunk[j].toString()]);
      }
    }
  }
}

/** Reads a borrower's rescue rule + escrow from LockwatchRescue and mirrors it. */
export type RescueReader = (borrower: Address) => Promise<{ triggerIcr: bigint; deadline: bigint; addAmount: bigint; repayAmount: bigint; btc: bigint; musd: bigint }>;
export const viemRescueReader = (client: PublicClient, rescue: Address): RescueReader => async (b) => {
  const [r, btc, musd] = await Promise.all([
    client.readContract({ address: rescue, abi: lockwatchRescueAbi, functionName: "rules", args: [b] }) as Promise<{ triggerIcr: bigint; deadline: bigint; addAmount: bigint; repayAmount: bigint }>,
    client.readContract({ address: rescue, abi: lockwatchRescueAbi, functionName: "btcOf", args: [b] }) as Promise<bigint>,
    client.readContract({ address: rescue, abi: lockwatchRescueAbi, functionName: "musdOf", args: [b] }) as Promise<bigint>,
  ]);
  return { triggerIcr: BigInt(r.triggerIcr), deadline: BigInt(r.deadline), addAmount: BigInt(r.addAmount), repayAmount: BigInt(r.repayAmount), btc, musd };
};
export async function refreshRescue(db: Db, chainId: number, read: RescueReader, borrower: Address, tx?: string) {
  const r = await read(borrower);
  await repo.upsertRescue(db, {
    chainId, borrower, triggerIcr: r.triggerIcr, addAmount: r.addAmount, repayAmount: r.repayAmount, deadline: Number(r.deadline),
    btcEscrow: r.btc, musdEscrow: r.musd, active: r.triggerIcr > 0n && (r.addAmount > 0n || r.repayAmount > 0n), lastTx: tx,
  });
}

export async function syncEvents(db: Db, client: PublicClient, cfg: Config, maxRange = 5_000n) {
  const ve = ADDRESSES[cfg.chainId].veBTC;
  const key = `events:${cfg.chainId}`;
  const head = await client.getBlockNumber();
  const from = BigInt((await repo.getCursor(db, key)) ?? (head - 1n).toString()) + 1n;
  if (from > head) return { touched: 0 };
  const to = from + maxRange - 1n < head ? from + maxRange - 1n : head;
  const vaults = allVaults(cfg);
  const addresses = [ve, ...vaults, ...(cfg.rescue ? [cfg.rescue] : [])];
  const logs = await client.getLogs({ address: addresses, fromBlock: from, toBlock: to });
  const touched = new Set<bigint>();
  for (const ev of parseEventLogs({ abi: veBTCAbi, logs: logs.filter((l) => l.address.toLowerCase() === ve.toLowerCase()) })) {
    const a = ev.args as { tokenId?: bigint };
    if (a.tokenId !== undefined) touched.add(a.tokenId);
  }
  for (const v of vaults) {
    const vlogs = logs.filter((l) => l.address.toLowerCase() === v.toLowerCase());
    for (const ev of parseEventLogs({ abi: lockwatchVaultAbi, logs: vlogs })) {
      await applyVaultEvent(db, cfg.chainId, ev as never, v);
      touched.add((ev.args as { tokenId: bigint }).tokenId);
    }
  }
  if (cfg.rescue) {
    const rlogs = logs.filter((l) => l.address.toLowerCase() === cfg.rescue!.toLowerCase());
    const who = new Map<string, string>();
    for (const ev of parseEventLogs({ abi: lockwatchRescueAbi, logs: rlogs })) who.set((ev.args as { borrower: string }).borrower, ev.transactionHash);
    const read = viemRescueReader(client, cfg.rescue);
    for (const [b, tx] of who) await refreshRescue(db, cfg.chainId, read, b as Address, tx);
  }
  if (touched.size) for (const r of await readLocks(client, cfg.chainId, [...touched], vaults)) await repo.upsertLock(db, r);
  await repo.setCursor(db, key, to.toString());
  return { touched: touched.size, from, to };
}

type VaultEvent =
  | { eventName: "Registered"; args: { tokenId: bigint; owner: Address; mode: number }; transactionHash: string }
  | { eventName: "Unregistered"; args: { tokenId: bigint; owner: Address }; transactionHash: string }
  | { eventName: "Protected"; args: { tokenId: bigint; owner: Address; mode: number; amount: bigint; newLockId: bigint }; transactionHash: string }
  | { eventName: "Fallback"; args: { tokenId: bigint; owner: Address; requested: number; reason: string }; transactionHash: string }
  | { eventName: "ExtendSet"; args: { tokenId: bigint; owner: Address; triggerWithin: number; duration: number }; transactionHash: string }
  | { eventName: "ExtendCleared"; args: { tokenId: bigint; owner: Address }; transactionHash: string }
  | { eventName: "Extended"; args: { tokenId: bigint; owner: Address; oldEnd: bigint; newEnd: bigint }; transactionHash: string }
  | { eventName: "RewardsAutoSet"; args: { tokenId: bigint; owner: Address; enabled: boolean }; transactionHash: string }
  | { eventName: "RewardsClaimed"; args: { tokenId: bigint; owner: Address; gauges: bigint }; transactionHash: string };

export async function applyVaultEvent(db: Db, chainId: number, ev: VaultEvent, vault?: string) {
  const { tokenId, owner } = ev.args;
  switch (ev.eventName) {
    case "Registered":
      return repo.upsertProtection(db, { chainId, lockId: tokenId, owner, mode: ev.args.mode, active: true, vault });
    case "Unregistered":
      return repo.upsertProtection(db, { chainId, lockId: tokenId, owner, mode: 0, active: false, vault });
    case "Fallback":
      return repo.upsertProtection(db, { chainId, lockId: tokenId, owner, mode: ev.args.requested, active: true, fallbackReason: ev.args.reason || "reverted", vault });
    case "Protected":
      await repo.clearAttempt(db, chainId, tokenId);
      await repo.setExtendActive(db, chainId, tokenId, false);
      await db.query(`UPDATE rewards_auto SET enabled=false WHERE chain_id=$1 AND lock_id=$2`, [chainId, tokenId.toString()]);
      return repo.upsertProtection(db, {
        chainId, lockId: tokenId, owner, mode: ev.args.mode, active: false, txHash: ev.transactionHash,
        amount: ev.args.amount, newLockId: ev.args.newLockId || undefined, vault,
      });
    case "ExtendSet":
      return repo.upsertExtend(db, { chainId, lockId: tokenId, owner, triggerWithin: Number(ev.args.triggerWithin), duration: Number(ev.args.duration), active: true });
    case "ExtendCleared":
      return repo.setExtendActive(db, chainId, tokenId, false);
    case "Extended":
      return repo.markExtended(db, chainId, tokenId, ev.transactionHash);
    case "RewardsAutoSet":
      return repo.upsertRewards(db, { chainId, lockId: tokenId, owner, enabled: ev.args.enabled });
    case "RewardsClaimed":
      return repo.markRewardsClaimed(db, chainId, tokenId, ev.transactionHash);
  }
}

export async function snapshotStats(db: Db, chainId: number, troves = 0, price?: bigint) {
  const rows = await repo.liveLocks(db, chainId);
  const locks: LockView[] = rows.map((r) => ({ id: BigInt(r.id), owner: r.owner as Address, amount: BigInt(r.amount), end: Number(r.lock_end), permanent: r.permanent, voted: r.voted }));
  const s = summarizeAtRisk(locks, Math.floor(Date.now() / 1000));
  await repo.snapshot(db, { chainId, btcAtRisk: s.expiredBtc, expiredCount: s.expiredCount, locks: rows.length, troves, price });
  return s;
}

export async function runIndexer(db: Db, cfg = loadConfig(), signal?: AbortSignal) {
  const client = publicClientFor(cfg) as PublicClient;
  let lastFull = 0;
  while (!signal?.aborted) {
    try {
      if (Date.now() - lastFull > 6 * 3600_000) {
        const head = await client.getBlockNumber();
        await fullScan(db, client, cfg);
        if (!(await repo.getCursor(db, `events:${cfg.chainId}`))) await repo.setCursor(db, `events:${cfg.chainId}`, head.toString());
        lastFull = Date.now();
      }
      // catch up in 5k-block pages until we reach head
      for (let i = 0; i < 50 && !signal?.aborted; i++) {
        const r = await syncEvents(db, client, cfg);
        if (r.to === undefined || r.to >= (await client.getBlockNumber())) break;
      }
    } catch (e) {
      log("indexer", "error", { err: String(e).slice(0, 300) });
    }
    await sleep(15_000, signal);
  }
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res) => { const t = setTimeout(res, ms); signal?.addEventListener("abort", () => { clearTimeout(t); res(); }); });

if (import.meta.url === `file://${process.argv[1]}`) {
  repo.connect().then((db) => runIndexer(db));
}
