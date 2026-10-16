import * as repo from "@lockwatch/db";
import { keeperStats, RPC, chainById } from "@lockwatch/sdk";
import { createPublicClient, http, formatEther } from "viem";
import { db, json, bad, CHAIN_ID, limited, LEDGERS } from "@/server/db";
import { KEEPER } from "@/lib/env";

export const dynamic = "force-dynamic";

async function balance(): Promise<string | null> {
  if (process.env.KEEPER_BALANCE_RPC === "off") return null;
  try {
    const c = createPublicClient({ chain: chainById(CHAIN_ID), transport: http(process.env.RPC_URL ?? RPC[CHAIN_ID], { timeout: 4000 }) });
    return formatEther(await c.getBalance({ address: KEEPER }));
  } catch { return null; }
}

/** Keeper transparency: balance, success rate by job, 24h uptime, next run and the action history. */
export async function GET(req: Request) {
  if (limited(req)) return bad("rate limited", 429);
  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, Math.min(10_000, Number(sp.get("page") ?? 1) || 1));
  const size = Math.max(1, Math.min(100, Number(sp.get("size") ?? 20) || 20));
  const job = sp.get("job");
  if (job && !["protect", "extend", "rewards", "rescue"].includes(job)) return bad("unknown job");
  const d = await db();
  const now = Math.floor(Date.now() / 1000);
  const asset = sp.get("asset");
  const [perLedger, bal] = await Promise.all([
    Promise.all(LEDGERS.map(async (l) => (await repo.keeperRuns(d, l.ledger, { since: now - 30 * 86400 })).map((r) => ({ ...r, asset: l.asset })))),
    balance(),
  ]);
  // uptime/heartbeats come from the veBTC pipeline; actions from both, newest first
  const runs = perLedger.flat().filter((r) => r.job !== "heartbeat" || r.asset === "btc").sort((a, b) => Number(b.ts) - Number(a.ts) || b.id - a.id);
  const stats = keeperStats(runs.map((r) => ({ job: r.job, ok: r.ok, ts: Number(r.ts) })), now);
  const actions = runs.filter((r) => r.job !== "heartbeat" && (!job || r.job === job) && (!asset || r.asset === asset));
  const items = actions.slice((page - 1) * size, page * size).map((r) => ({ asset: r.asset, job: r.job, subject: r.subject, ok: r.ok, tx: r.tx_hash, detail: r.detail, ts: Number(r.ts) }));
  return json({ keeper: KEEPER, balance: bal, ...stats, page, pages: Math.max(1, Math.ceil(actions.length / size)), total: actions.length, items, window: "30d" },
    { headers: { "cache-control": "s-maxage=20, stale-while-revalidate=60" } });
}
