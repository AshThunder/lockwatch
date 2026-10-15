import { ADDRESSES, veBTCAbi, lockwatchVaultAbi, summarizeAtRisk, type LockView } from "@lockwatch/sdk";
import * as repo from "@lockwatch/db";
import type { Db } from "@lockwatch/db";
import { parseEventLogs, zeroAddress, type Address, type PublicClient } from "viem";
import { loadConfig, publicClientFor, log, type Config } from "./config";

/**
 * Indexer: keeps `lock` and `protection` in sync with chain.
 *  - full scan of ids 1..tokenId() (multicall) on first run and every 6h as a cross-check
 *  - incremental: veBTC Transfer/Deposit/Withdraw/Approval + vault events since the cursor block; every touched id
 *    is re-read from chain (state reads are the source of truth, events only say *what* changed)
 */
export async function readLocks(client: PublicClient, chainId: number, ids: bigint[], vault: Address | null) {
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
        approvedVault: !!vault && a.status === "success" && (a.result as string).toLowerCase() === vault.toLowerCase(),
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
  const rows = await readLocks(client, cfg.chainId, ids, cfg.vault);
  for (const r of rows) await repo.upsertLock(db, r);
  log("indexer", "full scan", { locks: rows.length, live: rows.filter((r) => !r.withdrawn).length });
  return rows;
}

export async function syncEvents(db: Db, client: PublicClient, cfg: Config, maxRange = 5_000n) {
  const ve = ADDRESSES[cfg.chainId].veBTC;
  const key = `events:${cfg.chainId}`;
  const head = await client.getBlockNumber();
  const from = BigInt((await repo.getCursor(db, key)) ?? (head - 1n).toString()) + 1n;
  if (from > head) return { touched: 0 };
  const to = from + maxRange - 1n < head ? from + maxRange - 1n : head;
  const addresses = [ve, ...(cfg.vault ? [cfg.vault] : [])];
  const logs = await client.getLogs({ address: addresses, fromBlock: from, toBlock: to });
  const touched = new Set<bigint>();
  for (const ev of parseEventLogs({ abi: veBTCAbi, logs: logs.filter((l) => l.address.toLowerCase() === ve.toLowerCase()) })) {
    const a = ev.args as { tokenId?: bigint };
    if (a.tokenId !== undefined) touched.add(a.tokenId);
  }
  if (cfg.vault) {
    const vlogs = logs.filter((l) => l.address.toLowerCase() === cfg.vault!.toLowerCase());
    for (const ev of parseEventLogs({ abi: lockwatchVaultAbi, logs: vlogs })) {
      await applyVaultEvent(db, cfg.chainId, ev as never);
      touched.add((ev.args as { tokenId: bigint }).tokenId);
    }
  }
  if (touched.size) for (const r of await readLocks(client, cfg.chainId, [...touched], cfg.vault)) await repo.upsertLock(db, r);
  await repo.setCursor(db, key, to.toString());
  return { touched: touched.size, from, to };
}

type VaultEvent =
  | { eventName: "Registered"; args: { tokenId: bigint; owner: Address; mode: number }; transactionHash: string }
  | { eventName: "Unregistered"; args: { tokenId: bigint; owner: Address }; transactionHash: string }
  | { eventName: "Protected"; args: { tokenId: bigint; owner: Address; mode: number; amount: bigint; newLockId: bigint }; transactionHash: string }
  | { eventName: "Fallback"; args: { tokenId: bigint; owner: Address; requested: number; reason: string }; transactionHash: string };

export async function applyVaultEvent(db: Db, chainId: number, ev: VaultEvent) {
  const { tokenId, owner } = ev.args;
  switch (ev.eventName) {
    case "Registered":
      return repo.upsertProtection(db, { chainId, lockId: tokenId, owner, mode: ev.args.mode, active: true });
    case "Unregistered":
      return repo.upsertProtection(db, { chainId, lockId: tokenId, owner, mode: 0, active: false });
    case "Fallback":
      return repo.upsertProtection(db, { chainId, lockId: tokenId, owner, mode: ev.args.requested, active: true, fallbackReason: ev.args.reason || "reverted" });
    case "Protected":
      await repo.clearAttempt(db, chainId, tokenId);
      return repo.upsertProtection(db, {
        chainId, lockId: tokenId, owner, mode: ev.args.mode, active: false, txHash: ev.transactionHash,
        amount: ev.args.amount, newLockId: ev.args.newLockId || undefined,
      });
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
