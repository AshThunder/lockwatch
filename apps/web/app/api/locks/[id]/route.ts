import * as repo from "@lockwatch/db";
import { lockStatus } from "@lockwatch/sdk";
import { db, json, bad, CHAIN_ID } from "@/server/db";
import { lockTimeline } from "@/server/queries";

export const dynamic = "force-dynamic";
/** Lock detail: indexed lock, its protection plan, keeper retry state, lifecycle timeline and activity. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!/^\d{1,30}$/.test(params.id)) return bad("bad id");
  const id = BigInt(params.id); const d = await db();
  const l = await repo.lockById(d, CHAIN_ID, id);
  if (!l) return bad("not found", 404);
  const [p, k, act] = await Promise.all([repo.protectionById(d, CHAIN_ID, id), repo.attemptById(d, CHAIN_ID, id), repo.activity(d, CHAIN_ID, { lockId: id, limit: 10 })]);
  const now = Math.floor(Date.now() / 1000); const end = Number(l.lock_end);
  return json({
    chainId: CHAIN_ID, now,
    // legacy fields kept for existing clients
    ...l,
    lock: { id: String(l.id), owner: l.owner, amount: String(l.amount), end, permanent: l.permanent, voted: l.voted, approvedVault: l.approved_vault, withdrawn: l.withdrawn,
      status: l.withdrawn ? "withdrawn" : lockStatus({ end, permanent: l.permanent }, now) },
    protection: p ? { mode: Number(p.mode), active: p.active, txHash: p.tx_hash, amount: p.amount && String(p.amount), newLockId: p.new_lock_id && String(p.new_lock_id), fallbackReason: p.fallback_reason, updatedAt: Number(p.updated_at) } : null,
    keeper: k ? { attempts: Number(k.attempts), lastError: k.last_error, nextTryAt: Number(k.next_try_at), dead: k.dead } : null,
    timeline: l.permanent ? [] : lockTimeline(end, now, { voted: l.voted, protectedTx: p && !p.active ? p.tx_hash : null, withdrawn: l.withdrawn }),
    activity: act.items,
  });
}
