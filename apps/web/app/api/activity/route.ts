import * as repo from "@lockwatch/db";
import { db, json, bad, CHAIN_ID, limited } from "@/server/db";
import { ActivityQ } from "@/server/queries";

export const dynamic = "force-dynamic";
/** Keeper and vault activity feed, newest first. Optional ?owner= or ?lock= filter. */
export async function GET(req: Request) {
  if (limited(req, 120)) return bad("rate limited", 429);
  const p = ActivityQ.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!p.success) return bad("invalid query");
  const r = await repo.activity(await db(), CHAIN_ID, { limit: p.data.limit, offset: p.data.offset, owner: p.data.owner, lockId: p.data.lock ? BigInt(p.data.lock) : undefined });
  return json({ chainId: CHAIN_ID, ...r });
}
