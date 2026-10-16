import * as repo from "@lockwatch/db";
import { buildIcs } from "@lockwatch/sdk";
import { db, bad, limited, LEDGERS } from "@/server/db";
import { MODES } from "@/lib/modes";

export const dynamic = "force-dynamic";

/** GET /api/calendar/0xabc….ics — RFC 5545 feed of a wallet's upcoming veBTC unlocks (subscribe with webcal://). */
export async function GET(req: Request, { params }: { params: { address: string } }) {
  if (limited(req)) return bad("rate limited", 429);
  const address = params.address.replace(/\.ics$/i, "");
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return bad("bad address");
  const d = await db();
  const now = Math.floor(Date.now() / 1000);
  // one feed for both veBTC and veMEZO unlocks
  const events = (await Promise.all(LEDGERS.map(async ({ asset, ledger }) => {
    const [locks, prots] = await Promise.all([repo.locksByOwner(d, ledger, address), repo.protectionsByOwner(d, ledger, address)]);
    const pm = new Map(prots.filter((p) => p.active).map((p) => [String(p.lock_id), p]));
    return locks.filter((l) => !l.permanent && Number(l.lock_end) > now).map((l) => ({
      id: String(l.id), amount: String(l.amount), end: Number(l.lock_end), voted: l.voted, asset,
      protectedMode: pm.has(String(l.id)) ? MODES[pm.get(String(l.id))!.mode].replace("BTC", asset === "mezo" ? "MEZO" : "BTC") : null,
    }));
  }))).flat().sort((a, b) => a.end - b.end);
  const app = process.env.APP_URL ?? new URL(req.url).origin;
  const ics = buildIcs(address, events, app, now);
  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `inline; filename="lockwatch-${address.slice(0, 8).toLowerCase()}.ics"`,
      "cache-control": "s-maxage=900, stale-while-revalidate=3600",
    },
  });
}
