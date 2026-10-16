import * as repo from "@lockwatch/db";
import { summarizeAtRisk, type LockView } from "@lockwatch/sdk";
import { db, json, CHAIN_ID, ledgerOf, assetOf } from "@/server/db";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const d = await db(); const L = ledgerOf(req);
  const rows = await repo.liveLocks(d, L);
  const now = Math.floor(Date.now() / 1000);
  const locks: LockView[] = rows.map((r) => ({ id: BigInt(r.id), owner: r.owner as `0x${string}`, amount: BigInt(r.amount), end: Number(r.lock_end), permanent: r.permanent, voted: r.voted }));
  const s = summarizeAtRisk(locks, now);
  const top = locks.filter((l) => !l.permanent && l.end <= now).sort((a, b) => (b.amount > a.amount ? 1 : -1)).slice(0, 60)
    .map((l) => ({ id: l.id, owner: l.owner, amount: l.amount, end: l.end, ageDays: Math.floor((now - l.end) / 86400) }));
  const snap = await repo.latestSnapshot(d, L);
  return json({ chainId: CHAIN_ID, asset: assetOf(req), now, ...s, totalLocks: rows.length, top, snapshotTs: snap?.ts ?? null });
}
