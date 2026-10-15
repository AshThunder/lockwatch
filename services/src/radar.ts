import { ADDRESSES, sortedTrovesAbi, troveManagerAbi, priceFeedAbi, redemptionLine, type Trove } from "@lockwatch/sdk";
import * as repo from "@lockwatch/db";
import type { Db } from "@lockwatch/db";
import { zeroAddress, type Address, type PublicClient } from "viem";
import { loadConfig, publicClientFor, log, type Config } from "./config";
import { sleep, snapshotStats } from "./indexer";

/** Walks SortedTroves from getLast() (lowest NICR, first to be redeemed) via getPrev() and reads debt/coll. */
export async function readTroves(client: PublicClient, cfg: Config, max = 5000): Promise<{ troves: Trove[]; price: bigint }> {
  const a = ADDRESSES[cfg.chainId];
  const price = await client.readContract({ address: a.priceFeed, abi: priceFeedAbi, functionName: "fetchPrice" });
  const owners: Address[] = [];
  let cur = await client.readContract({ address: a.sortedTroves, abi: sortedTrovesAbi, functionName: "getLast" });
  while (cur !== zeroAddress && owners.length < max) {
    owners.push(cur);
    cur = await client.readContract({ address: a.sortedTroves, abi: sortedTrovesAbi, functionName: "getPrev", args: [cur] });
  }
  const troves: Trove[] = [];
  for (let i = 0; i < owners.length; i += 100) {
    const chunk = owners.slice(i, i + 100);
    const res = await client.multicall({
      contracts: chunk.map((o) => ({ address: a.troveManager, abi: troveManagerAbi, functionName: "getEntireDebtAndColl", args: [o] })) as never,
      allowFailure: true,
    }) as unknown as { status: string; result?: unknown }[];
    chunk.forEach((owner, j) => {
      const r = res[j];
      if (r.status !== "success") return;
      const [coll, principal, interest] = r.result as unknown as bigint[];
      troves.push({ owner, coll, debt: principal + interest });
    });
  }
  return { troves, price };
}

export async function refreshRadar(db: Db, client: PublicClient, cfg: Config) {
  const { troves, price } = await readTroves(client, cfg);
  const line = redemptionLine(troves, price);
  await repo.replaceTroves(db, cfg.chainId, line.map((e) => ({ owner: e.owner, coll: e.coll, debt: e.debt, icr: e.icr, rank: e.rank, musdAhead: e.musdAhead, redeemable: e.redeemable })));
  await repo.setCursor(db, `price:${cfg.chainId}`, price.toString());
  await snapshotStats(db, cfg.chainId, line.length, price); // feeds /api/health + /api/at-risk snapshotTs
  log("radar", "refreshed", { troves: line.length, price });
  return { line, price };
}

export async function runRadar(db: Db, cfg = loadConfig(), signal?: AbortSignal) {
  const client = publicClientFor(cfg) as PublicClient;
  while (!signal?.aborted) {
    try { await refreshRadar(db, client, cfg); } catch (e) { log("radar", "error", { err: String(e).slice(0, 300) }); }
    await sleep(5 * 60_000, signal);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  repo.connect().then((db) => runRadar(db));
}
