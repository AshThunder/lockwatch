import "server-only";
import * as repo from "@lockwatch/db";
import { lockStatus, radarRisk, ledgerId, ASSETS, type Asset, type LineEntry } from "@lockwatch/sdk";
import type { Address } from "viem";

const TYPICAL = BigInt(process.env.TYPICAL_REDEMPTION_MUSD ?? "10000") * 10n ** 18n;

/** Locks (+ protection / auto-extend / rewards state) and the MUSD loan for each wallet, plus totals. */
const cov = (t: { covered: bigint; base: bigint }) => (t.base > 0n ? Number((t.covered * 10000n) / t.base) / 100 : null);

export async function portfolio(d: repo.Db, chainId: number, wallets: string[], now = Math.floor(Date.now() / 1000)) {
  const out = [];
  // BTC and MEZO amounts are never summed together: totals and amount-weighted coverage are per asset
  const z = () => ({ locked: 0n, idle: 0n, locks: 0, covered: 0n, base: 0n });
  const tot: Record<Asset, ReturnType<typeof z>> = { btc: z(), mezo: z() };
  let coll = 0n, debt = 0n, nextUnlock: number | null = null, lockCount = 0;
  for (const w of wallets) {
    const t = await repo.troveOf(d, chainId, w);
    const ls = [];
    for (const asset of ASSETS) {
    const L = ledgerId(chainId, asset);
    const [locks, prots, ext, rew] = await Promise.all([
      repo.locksByOwner(d, L, w), repo.protectionsByOwner(d, L, w), repo.extendsByOwner(d, L, w), repo.rewardsByOwner(d, L, w),
    ]);
    const pm = new Map(prots.map((p) => [String(p.lock_id), p]));
    const em = new Map(ext.map((e) => [String(e.lock_id), e]));
    const rm = new Set(rew.map((r) => String(r.lock_id)));
    ls.push(...locks.map((l) => {
      const id = String(l.id), end = Number(l.lock_end), amt = BigInt(l.amount);
      const p = pm.get(id);
      const expired = !l.permanent && end <= now;
      tot[asset].locked += amt; tot[asset].locks++; lockCount++;
      if (expired) tot[asset].idle += amt;
      else if (!l.permanent) {
        tot[asset].base += amt;
        if (p?.active || em.has(id)) tot[asset].covered += amt;
        if (nextUnlock === null || end < nextUnlock) nextUnlock = end;
      }
      return {
        asset, id, amount: String(l.amount), end, permanent: l.permanent, voted: l.voted, approvedVault: l.approved_vault,
        status: lockStatus({ end, permanent: l.permanent }, now),
        protection: p ? { active: p.active, mode: Number(p.mode), tx_hash: p.tx_hash } : null,
        autoExtend: em.has(id) ? { triggerWithin: Number(em.get(id)!.trigger_within), duration: Number(em.get(id)!.duration), lastTx: em.get(id)!.last_tx } : null,
        autoRewards: rm.has(id),
      };
    }));
    }
    let loan = null;
    if (t) {
      const e: LineEntry = { owner: t.owner as Address, coll: BigInt(t.coll), debt: BigInt(t.debt), icr: BigInt(t.icr), rank: t.rank, musdAhead: BigInt(t.musd_ahead), redeemable: t.redeemable };
      coll += e.coll; debt += e.debt;
      loan = { coll: t.coll, debt: t.debt, icr: t.icr, rank: t.rank, musdAhead: t.musd_ahead, risk: radarRisk(e, TYPICAL) };
    }
    out.push({ address: w, locks: ls, loan });
  }
  return {
    wallets: out,
    totals: {
      wallets: wallets.length, locks: lockCount, locked: tot.btc.locked.toString(), idle: tot.btc.idle.toString(),
      mezo: { locks: tot.mezo.locks, locked: tot.mezo.locked.toString(), idle: tot.mezo.idle.toString(), coverage: cov(tot.mezo) },
      coverage: cov(tot.btc),
      nextUnlock, loanColl: coll.toString(), loanDebt: debt.toString(), loans: out.filter((w) => w.loan).length,
    },
  };
}
