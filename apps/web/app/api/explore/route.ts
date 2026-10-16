import * as repo from "@lockwatch/db";
import { db, json, bad, limited, ledgerOf } from "@/server/db";
import { ExploreQ, OUTLIER_SHARE, toWei } from "@/server/queries";

export const dynamic = "force-dynamic";
/** Paginated, filterable lock explorer for the at-risk page. */
export async function GET(req: Request) {
  if (limited(req, 120)) return bad("rate limited", 429);
  const p = ExploreQ.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!p.success) return bad("invalid query");
  const q = p.data; const d = await db(); const L = ledgerOf(req); const now = Math.floor(Date.now() / 1000);
  let excludeOver: bigint | undefined; let outlier: repo.LockRow | null = null;
  if (q.outliers === "hide" && q.state === "expired") {
    const all = await repo.exploreLocks(d, L, { state: "expired", limit: 1, now });
    const top = all.rows[0];
    if (top && Number(BigInt(top.amount)) / Number(BigInt(all.totalAmount || "0") || 1n) > OUTLIER_SHARE) { outlier = top; excludeOver = BigInt(top.amount); }
  }
  const r = await repo.exploreLocks(d, L, { state: q.state, sort: q.sort, dir: q.dir, minBtc: q.minBtc ? toWei(q.minBtc) : undefined, excludeOver, limit: q.size, offset: (q.page - 1) * q.size, now });
  return json({
    now, page: q.page, size: q.size, total: r.total, pages: Math.max(1, Math.ceil(r.total / q.size)), totalAmount: r.totalAmount,
    hiddenOutlier: outlier ? { id: String(outlier.id), amount: String(outlier.amount) } : null,
    rows: r.rows.map((l) => ({ id: String(l.id), owner: l.owner, amount: String(l.amount), end: Number(l.lock_end), voted: l.voted, ageDays: Math.floor((now - Number(l.lock_end)) / 86400) })),
  });
}
