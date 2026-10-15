import { generateSiweNonce } from "viem/siwe";
import * as repo from "@lockwatch/db";
import { db, json } from "@/server/db";

export const dynamic = "force-dynamic";
export async function GET() {
  const nonce = generateSiweNonce();
  await repo.putNonce(await db(), nonce);
  return json({ nonce }, { headers: { "cache-control": "no-store" } });
}
