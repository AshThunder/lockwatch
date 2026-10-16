import { z } from "zod";
import * as repo from "@lockwatch/db";
import { lockStatus } from "@lockwatch/sdk";
import { db, json, bad, CHAIN_ID, limited, LEDGERS } from "@/server/db";

export const dynamic = "force-dynamic";
const Q = z.object({ owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

export async function GET(req: Request) {
  if (limited(req)) return bad("rate limited", 429);
  const p = Q.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!p.success) return bad("owner must be an address");
  const d = await db();
  const now = Math.floor(Date.now() / 1000);
  // every asset: veBTC first, then veMEZO; each row carries `asset`
  const all = await Promise.all(LEDGERS.map(async ({ asset, ledger }) => {
    const [locks, prots] = await Promise.all([repo.locksByOwner(d, ledger, p.data.owner), repo.protectionsByOwner(d, ledger, p.data.owner)]);
    return { asset, locks, pm: new Map(prots.map((x) => [x.lock_id, x])) };
  }));
  return json({
    chainId: CHAIN_ID,
    locks: all.flatMap(({ asset, locks, pm }) => locks.map((l) => ({ asset,
      id: l.id, amount: l.amount, end: Number(l.lock_end), permanent: l.permanent, voted: l.voted, approvedVault: l.approved_vault,
      status: lockStatus({ end: Number(l.lock_end), permanent: l.permanent }, now),
      protection: pm.get(l.id) ?? null,
    }))),
  });
}
