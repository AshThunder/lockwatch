import * as repo from "@lockwatch/db";
import { buildIcs } from "@lockwatch/sdk";
import { db, bad, CHAIN_ID, limited } from "@/server/db";
import { MODES } from "@/lib/modes";

export const dynamic = "force-dynamic";

/** GET /api/calendar/0xabc….ics — RFC 5545 feed of a wallet's upcoming veBTC unlocks (subscribe with webcal://). */
export async function GET(req: Request, { params }: { params: { address: string } }) {
  if (limited(req)) return bad("rate limited", 429);
  const address = params.address.replace(/\.ics$/i, "");
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return bad("bad address");
  const d = await db();
  const now = Math.floor(Date.now() / 1000);
  const [locks, prots] = await Promise.all([repo.locksByOwner(d, CHAIN_ID, address), repo.protectionsByOwner(d, CHAIN_ID, address)]);
  const pm = new Map(prots.filter((p) => p.active).map((p) => [p.lock_id, p]));
  const upcoming = locks.filter((l) => !l.permanent && Number(l.lock_end) > now);
  const app = process.env.APP_URL ?? new URL(req.url).origin;
  const ics = buildIcs(address, upcoming.map((l) => ({ id: String(l.id), amount: String(l.amount), end: Number(l.lock_end), voted: l.voted, protectedMode: pm.has(String(l.id)) ? MODES[pm.get(String(l.id))!.mode] : null })), app, now);
  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `inline; filename="lockwatch-${address.slice(0, 8).toLowerCase()}.ics"`,
      "cache-control": "s-maxage=900, stale-while-revalidate=3600",
    },
  });
}
