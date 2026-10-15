import * as repo from "@lockwatch/db";
import { db, json, bad, CHAIN_ID, limited } from "@/server/db";

export const dynamic = "force-dynamic";

/** GET ?owner=0x… → auto-extend policies, reward auto-claim opt-ins and the loan rescue rule for a wallet. */
export async function GET(req: Request) {
  if (limited(req)) return bad("rate limited", 429);
  const owner = new URL(req.url).searchParams.get("owner") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) return bad("owner must be an address");
  const d = await db();
  const [ext, rew, rescue] = await Promise.all([repo.extendsByOwner(d, CHAIN_ID, owner), repo.rewardsByOwner(d, CHAIN_ID, owner), repo.rescueOf(d, CHAIN_ID, owner)]);
  return json({
    extend: ext.map((e) => ({ lockId: String(e.lock_id), triggerWithin: Number(e.trigger_within), duration: Number(e.duration), lastTx: e.last_tx, lastExtendedAt: e.last_extended_at ? Number(e.last_extended_at) : null })),
    rewards: rew.map((r) => ({ lockId: String(r.lock_id), lastClaimAt: Number(r.last_claim_at) || null, lastTx: r.last_tx })),
    rescue: rescue ? { triggerIcr: rescue.trigger_icr, addAmount: rescue.add_amount, repayAmount: rescue.repay_amount, deadline: Number(rescue.deadline), btcEscrow: rescue.btc_escrow, musdEscrow: rescue.musd_escrow, active: rescue.active, lastTx: rescue.last_tx } : null,
  }, { headers: { "cache-control": "no-store" } });
}
