import * as repo from "@lockwatch/db";
import { db, json, bad, CHAIN_ID, limited } from "@/server/db";
import { parseSearch } from "@/server/queries";

export const dynamic = "force-dynamic";
/** Resolve a lock id or wallet address for the global search box. */
export async function GET(req: Request) {
  if (limited(req, 120)) return bad("rate limited", 429);
  const hit = parseSearch(new URL(req.url).searchParams.get("q") ?? "");
  const d = await db();
  if (hit.kind === "lock") {
    const l = await repo.lockById(d, CHAIN_ID, BigInt(hit.id));
    return json(l ? { ...hit, found: true, amount: String(l.amount), owner: l.owner } : { ...hit, found: false });
  }
  if (hit.kind === "address") {
    const [locks, trove] = await Promise.all([repo.locksByOwner(d, CHAIN_ID, hit.address), repo.troveOf(d, CHAIN_ID, hit.address)]);
    return json({ ...hit, found: locks.length > 0 || !!trove, locks: locks.length, trove: !!trove });
  }
  return json({ ...hit, found: false });
}
