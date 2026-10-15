import * as repo from "@lockwatch/db";
import { radarRisk, collToPass, repayToPass, redemptionHit, type LineEntry } from "@lockwatch/sdk";
import { db, json, bad, CHAIN_ID } from "@/server/db";

export const dynamic = "force-dynamic";
const TYPICAL = BigInt(process.env.TYPICAL_REDEMPTION_MUSD ?? "10000") * 10n ** 18n;

export async function GET(req: Request, { params }: { params: { address: string } }) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(params.address)) return bad("bad address");
  const d = await db();
  const t = await repo.troveOf(d, CHAIN_ID, params.address);
  const price = BigInt((await repo.getCursor(d, `price:${CHAIN_ID}`)) ?? "0");
  if (!t) return json({ trove: null, price });
  const e: LineEntry = { owner: t.owner as `0x${string}`, coll: BigInt(t.coll), debt: BigInt(t.debt), icr: BigInt(t.icr), rank: t.rank, musdAhead: BigInt(t.musd_ahead), redeemable: t.redeemable };
  const sim = BigInt(new URL(req.url).searchParams.get("simulate") ?? "0") * 10n ** 18n;
  // suggestion: get behind the 10 troves currently right behind you → about +N rank positions
  const line = await repo.troveLine(d, CHAIN_ID, 100000);
  const behind = line.filter((x) => x.redeemable && x.rank > t.rank).slice(0, 10);
  const target = behind.at(-1);
  return json({
    price,
    trove: { ...t, risk: radarRisk(e, TYPICAL) },
    total: line.filter((x) => x.redeemable).length,
    simulate: sim ? { amount: sim, hit: redemptionHit(e, sim) } : null,
    suggest: target && price > 0n ? { passTroves: behind.length, addColl: collToPass(e, BigInt(target.icr), price), repay: repayToPass(e, BigInt(target.icr), price) } : null,
  });
}
