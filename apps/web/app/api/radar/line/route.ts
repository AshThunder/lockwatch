import * as repo from "@lockwatch/db";
import { db, json, CHAIN_ID } from "@/server/db";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const limit = Math.min(Number(new URL(req.url).searchParams.get("limit") ?? 50), 500);
  const d = await db();
  const [line, price] = await Promise.all([repo.troveLine(d, CHAIN_ID, limit), repo.getCursor(d, `price:${CHAIN_ID}`)]);
  return json({ price: price ?? "0", line });
}
