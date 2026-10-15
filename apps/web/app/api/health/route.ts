import * as repo from "@lockwatch/db";
import { db, json, CHAIN_ID } from "@/server/db";

export const dynamic = "force-dynamic";
export async function GET() {
  const snap = await repo.latestSnapshot(await db(), CHAIN_ID).catch(() => undefined);
  return json({ ok: true, chainId: CHAIN_ID, lastSnapshot: snap?.ts ?? null }, { headers: { "cache-control": "no-store" } });
}
