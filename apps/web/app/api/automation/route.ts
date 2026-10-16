import * as repo from "@lockwatch/db";
import { db, json, bad, CHAIN_ID, limited, LEDGERS } from "@/server/db";

export const dynamic = "force-dynamic";

/** GET ?owner=0x… → auto-extend policies, reward auto-claim opt-ins and the loan rescue rule for a wallet. */
export async function GET(req: Request) {
  if (limited(req)) return bad("rate limited", 429);
  const owner = new URL(req.url).searchParams.get("owner") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) return bad("owner must be an address");
  const d = await db();
  const per = await Promise.all(LEDGERS.map(async ({ asset, ledger }) => ({ asset, ext: await repo.extendsByOwner(d, ledger, owner), rew: await repo.rewardsByOwner(d, ledger, owner) })));
  const ext = per.flatMap((p) => p.ext.map((e) => ({ ...e, asset: p.asset })));
  const rew = per.flatMap((p) => p.rew.map((r) => ({ ...r, asset: p.asset })));
  const rescue = await repo.rescueOf(d, CHAIN_ID, owner);
  return json({
    extend: ext.map((e) => ({ asset: e.asset, lockId: String(e.lock_id), triggerWithin: Number(e.trigger_within), duration: Number(e.duration), lastTx: e.last_tx, lastExtendedAt: e.last_extended_at ? Number(e.last_extended_at) : null })),
    rewards: rew.map((r) => ({ asset: r.asset, lockId: String(r.lock_id), lastClaimAt: Number(r.last_claim_at) || null, lastTx: r.last_tx })),
    rescue: rescue ? { triggerIcr: rescue.trigger_icr, addAmount: rescue.add_amount, repayAmount: rescue.repay_amount, deadline: Number(rescue.deadline), btcEscrow: rescue.btc_escrow, musdEscrow: rescue.musd_escrow, active: rescue.active, lastTx: rescue.last_tx } : null,
  }, { headers: { "cache-control": "no-store" } });
}
