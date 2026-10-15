// One-shot read-only scan of Mezo testnet into a local PGlite DB: locks + troves + stats. No keys needed.
import * as repo from "@lockwatch/db";
import type { PublicClient } from "viem";
import { loadConfig, publicClientFor } from "./config";
import { fullScan, snapshotStats } from "./indexer";
import { refreshRadar } from "./radar";

const cfg = loadConfig();
const db = await repo.connect(process.env.DATABASE_URL ?? "memory");
const client = publicClientFor(cfg) as PublicClient;
await fullScan(db, client, cfg);
const { line, price } = await refreshRadar(db, client, cfg);
const s = await snapshotStats(db, cfg.chainId, line.length, price);
console.log(JSON.stringify({ expired: s.expiredCount, btcAtRisk: Number(s.expiredBtc) / 1e18, owners: s.owners, troves: line.length, price: Number(price) / 1e18, buckets: s.buckets.map((b) => [b.label, b.count, Number(b.btc) / 1e18]) }));
await db.close();
