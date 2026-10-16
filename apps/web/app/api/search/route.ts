import * as repo from "@lockwatch/db";
import { db, json, bad, CHAIN_ID, limited, LEDGERS } from "@/server/db";
import { parseSearch } from "@/server/queries";

export const dynamic = "force-dynamic";
/** Resolve a lock id or wallet address for the global search box. */
export async function GET(req: Request) {
  if (limited(req, 120)) return bad("rate limited", 429);
  const hit = parseSearch(new URL(req.url).searchParams.get("q") ?? "");
  const d = await db();
  if (hit.kind === "lock") {
    // same id can exist on veBTC and veMEZO: return every match, veBTC first
    const matches = (await Promise.all(LEDGERS.map(async ({ asset, ledger }) => {
      const l = await repo.lockById(d, ledger, BigInt(hit.id));
      return l ? { asset, amount: String(l.amount), owner: l.owner, href: asset === "mezo" ? `${hit.href}?asset=mezo` : hit.href } : null;
    }))).filter((m) => m !== null);
    const first = matches[0];
    return json(first ? { ...hit, href: first.href, found: true, asset: first.asset, amount: first.amount, owner: first.owner, matches } : { ...hit, found: false, matches: [] });
  }
  if (hit.kind === "address") {
    const [lb, lm, trove] = await Promise.all([repo.locksByOwner(d, LEDGERS[0].ledger, hit.address), repo.locksByOwner(d, LEDGERS[1].ledger, hit.address), repo.troveOf(d, CHAIN_ID, hit.address)]);
    const locks = [...lb, ...lm];
    return json({ ...hit, found: locks.length > 0 || !!trove, locks: locks.length, trove: !!trove });
  }
  return json({ ...hit, found: false });
}
