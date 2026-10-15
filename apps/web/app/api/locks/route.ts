import { z } from "zod";
import * as repo from "@lockwatch/db";
import { lockStatus } from "@lockwatch/sdk";
import { db, json, bad, CHAIN_ID, limited } from "@/server/db";

export const dynamic = "force-dynamic";
const Q = z.object({ owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

export async function GET(req: Request) {
  if (limited(req)) return bad("rate limited", 429);
  const p = Q.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!p.success) return bad("owner must be an address");
  const d = await db();
  const now = Math.floor(Date.now() / 1000);
  const [locks, prots] = await Promise.all([repo.locksByOwner(d, CHAIN_ID, p.data.owner), repo.protectionsByOwner(d, CHAIN_ID, p.data.owner)]);
  const pm = new Map(prots.map((x) => [x.lock_id, x]));
  return json({
    chainId: CHAIN_ID,
    locks: locks.map((l) => ({
      id: l.id, amount: l.amount, end: Number(l.lock_end), permanent: l.permanent, voted: l.voted, approvedVault: l.approved_vault,
      status: lockStatus({ end: Number(l.lock_end), permanent: l.permanent }, now),
      protection: pm.get(l.id) ?? null,
    })),
  });
}
