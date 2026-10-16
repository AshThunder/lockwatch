import "server-only";
import { connect, type Db } from "@lockwatch/db";
import { ASSETS, ledgerId, parseAsset, type Asset } from "@lockwatch/sdk";

const g = globalThis as unknown as { __lwdb?: Promise<Db> };
/** DATABASE_URL: postgres://… in production (Railway Postgres), a PGlite dir or "memory" locally. */
export const db = () => (g.__lwdb ??= connect(process.env.DATABASE_URL ?? "memory"));
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31611) as 31611 | 31612;
/** ?asset=mezo selects the veMEZO ledger (lock-scoped tables); anything else is veBTC. */
export const assetOf = (req: Request): Asset => parseAsset(new URL(req.url).searchParams.get("asset"));
export const ledgerOf = (req: Request) => ledgerId(CHAIN_ID, assetOf(req));
export const LEDGERS = ASSETS.map((a) => ({ asset: a, ledger: ledgerId(CHAIN_ID, a) }));

export const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v)), {
    ...init,
    headers: { "content-type": "application/json", "cache-control": "s-maxage=30, stale-while-revalidate=60", ...init?.headers },
  });
export const bad = (msg: string, status = 400) => json({ error: msg }, { status, headers: { "cache-control": "no-store" } });

/** Tiny in-memory rate limiter (per instance). Upstash can replace it in production. */
const hits = new Map<string, { n: number; t: number }>();
export function limited(req: Request, max = 60) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) { hits.set(ip, { n: 1, t: now }); return false; }
  return ++h.n > max;
}
