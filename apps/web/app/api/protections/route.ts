import * as repo from "@lockwatch/db";
import { db, json, bad, ledgerOf } from "@/server/db";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const owner = new URL(req.url).searchParams.get("owner") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) return bad("bad owner");
  return json(await repo.protectionsByOwner(await db(), ledgerOf(req), owner));
}
