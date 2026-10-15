import { z } from "zod";
import * as repo from "@lockwatch/db";
import { db, json, bad, limited } from "@/server/db";
import { Signed, Addr, signer } from "@/server/auth";

export const dynamic = "force-dynamic";
const MAX = 50;
const noStore = { headers: { "cache-control": "no-store" } };

/** GET ?account=0x… → that account's saved watchlist. */
export async function GET(req: Request) {
  const a = Addr.safeParse(new URL(req.url).searchParams.get("account"));
  if (!a.success) return bad("account must be an address");
  return json({ items: (await repo.watchlist(await db(), a.data)).map((w) => ({ address: w.address, label: w.label })) }, noStore);
}

const Post = Signed.extend({ address: Addr, label: z.string().trim().max(64).optional() });
/** Add (or relabel) a watched wallet. Signed by the account owner. */
export async function POST(req: Request) {
  if (limited(req, 20)) return bad("rate limited", 429);
  const b = Post.safeParse(await req.json().catch(() => null));
  if (!b.success) return bad("invalid body");
  const account = await signer(b.data);
  if (!account) return bad("signature check failed", 401);
  const d = await db();
  const cur = await repo.watchlist(d, account);
  if (cur.length >= MAX && !cur.some((w) => w.address === b.data.address.toLowerCase())) return bad(`watchlists hold up to ${MAX} wallets`);
  await repo.addWatch(d, account, b.data.address, b.data.label || undefined);
  return json({ ok: true, items: (await repo.watchlist(d, account)).map((w) => ({ address: w.address, label: w.label })) }, noStore);
}

/** Bulk import of a local (browser) watchlist after sign-in. */
const Put = Signed.extend({ items: z.array(z.object({ address: Addr, label: z.string().trim().max(64).optional() })).max(MAX) });
export async function PUT(req: Request) {
  if (limited(req, 10)) return bad("rate limited", 429);
  const b = Put.safeParse(await req.json().catch(() => null));
  if (!b.success) return bad("invalid body");
  const account = await signer(b.data);
  if (!account) return bad("signature check failed", 401);
  const d = await db();
  for (const i of b.data.items) await repo.addWatch(d, account, i.address, i.label || undefined);
  return json({ ok: true, items: (await repo.watchlist(d, account)).map((w) => ({ address: w.address, label: w.label })) }, noStore);
}

const Del = Signed.extend({ address: Addr });
export async function DELETE(req: Request) {
  const b = Del.safeParse(await req.json().catch(() => null));
  if (!b.success) return bad("invalid body");
  const account = await signer(b.data);
  if (!account) return bad("signature check failed", 401);
  await repo.removeWatch(await db(), account, b.data.address);
  return json({ ok: true }, noStore);
}
