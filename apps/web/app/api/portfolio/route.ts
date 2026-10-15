import * as repo from "@lockwatch/db";
import { db, json, bad, CHAIN_ID, limited } from "@/server/db";
import { portfolio } from "@/server/portfolio";

export const dynamic = "force-dynamic";
const ADDR = /^0x[0-9a-fA-F]{40}$/;

/** GET ?account=0x… (account + SIWE-linked wallets) and/or ?addresses=0x…,0x… (local, unverified watch list). */
export async function GET(req: Request) {
  if (limited(req)) return bad("rate limited", 429);
  const sp = new URL(req.url).searchParams;
  const account = sp.get("account");
  const extra = (sp.get("addresses") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (account && !ADDR.test(account)) return bad("account must be an address");
  if (extra.some((a) => !ADDR.test(a))) return bad("addresses must be a comma-separated list of addresses");
  if (!account && !extra.length) return bad("give account or addresses");
  const d = await db();
  const linked = account ? await repo.walletsOf(d, account) : [];
  const wallets = [...new Set([...linked, ...extra.map((a) => a.toLowerCase())])];
  if (wallets.length > 20) return bad("up to 20 wallets");
  return json({ chainId: CHAIN_ID, linked, ...(await portfolio(d, CHAIN_ID, wallets)) }, { headers: { "cache-control": "no-store" } });
}
