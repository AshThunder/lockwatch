import * as repo from "@lockwatch/db";
import { db, json, bad, CHAIN_ID } from "@/server/db";

export const dynamic = "force-dynamic";
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!/^\d+$/.test(params.id)) return bad("bad id");
  const l = await repo.lockById(await db(), CHAIN_ID, BigInt(params.id));
  return l ? json(l) : bad("not found", 404);
}
