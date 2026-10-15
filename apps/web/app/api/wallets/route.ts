import * as repo from "@lockwatch/db";
import { parseSiweMessage } from "viem/siwe";
import { db, json, bad, limited } from "@/server/db";
import { Signed, Addr, signer } from "@/server/auth";

export const dynamic = "force-dynamic";
const MAX = 10;
const noStore = { headers: { "cache-control": "no-store" } };

/** GET ?account=0x… → the account plus every linked wallet. */
export async function GET(req: Request) {
  const a = Addr.safeParse(new URL(req.url).searchParams.get("account"));
  if (!a.success) return bad("account must be an address");
  return json({ wallets: await repo.walletsOf(await db(), a.data) }, noStore);
}

/** Link a wallet: the account signs one SIWE message, the wallet being linked signs another whose statement names
 *  the account. Both nonces are burned, so neither signature can be replayed. */
const Post = Signed.extend({ link: Signed });
export async function POST(req: Request) {
  if (limited(req, 10)) return bad("rate limited", 429);
  const b = Post.safeParse(await req.json().catch(() => null));
  if (!b.success) return bad("invalid body");
  const account = await signer(b.data);
  if (!account) return bad("account signature check failed", 401);
  const stmt = parseSiweMessage(b.data.link.message).statement ?? "";
  if (!stmt.toLowerCase().includes(account.toLowerCase())) return bad("the linked wallet must sign a message naming the account");
  const wallet = await signer(b.data.link);
  if (!wallet) return bad("wallet signature check failed", 401);
  if (wallet.toLowerCase() === account.toLowerCase()) return bad("that is the account itself");
  const d = await db();
  if ((await repo.walletsOf(d, account)).length > MAX) return bad(`up to ${MAX} linked wallets`);
  await repo.linkWallet(d, account, wallet);
  return json({ ok: true, wallets: await repo.walletsOf(d, account) }, noStore);
}

const Del = Signed.extend({ address: Addr });
export async function DELETE(req: Request) {
  const b = Del.safeParse(await req.json().catch(() => null));
  if (!b.success) return bad("invalid body");
  const account = await signer(b.data);
  if (!account) return bad("signature check failed", 401);
  await repo.unlinkWallet(await db(), account, b.data.address);
  return json({ ok: true, wallets: await repo.walletsOf(await db(), account) }, noStore);
}
