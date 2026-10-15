import "server-only";
import * as repo from "@lockwatch/db";
import { lockStatus, radarRisk, type LineEntry } from "@lockwatch/sdk";
import type { Address } from "viem";

const TYPICAL = BigInt(process.env.TYPICAL_REDEMPTION_MUSD ?? "10000") * 10n ** 18n;

/** Locks (+ protection / auto-extend / rewards state) and the MUSD loan for each wallet, plus totals. */
export async function portfolio(d: repo.Db, chainId: number, wallets: string[], now = Math.floor(Date.now() / 1000)) {
  const out = [];
  let locked = 0n, idle = 0n, covered = 0n, coverBase = 0n, coll = 0n, debt = 0n, nextUnlock: number | null = null, lockCount = 0;
  for (const w of wallets) {
    const [locks, prots, ext, rew, t] = await Promise.all([
      repo.locksByOwner(d, chainId, w), repo.protectionsByOwner(d, chainId, w), repo.extendsByOwner(d, chainId, w), repo.rewardsByOwner(d, chainId, w), repo.troveOf(d, chainId, w),
    ]);
    const pm = new Map(prots.map((p) => [String(p.lock_id), p]));
    const em = new Map(ext.map((e) => [String(e.lock_id), e]));
    const rm = new Set(rew.map((r) => String(r.lock_id)));
    const ls = locks.map((l) => {
      const id = String(l.id), end = Number(l.lock_end), amt = BigInt(l.amount);
      const p = pm.get(id);
      const expired = !l.permanent && end <= now;
      locked += amt; lockCount++;
      if (expired) idle += amt;
      else if (!l.permanent) {
        coverBase += amt;
        if (p?.active || em.has(id)) covered += amt;
        if (nextUnlock === null || end < nextUnlock) nextUnlock = end;
      }
      return {
        id, amount: String(l.amount), end, permanent: l.permanent, voted: l.voted, approvedVault: l.approved_vault,
        status: lockStatus({ end, permanent: l.permanent }, now),
        protection: p ? { active: p.active, mode: Number(p.mode), tx_hash: p.tx_hash } : null,
        autoExtend: em.has(id) ? { triggerWithin: Number(em.get(id)!.trigger_within), duration: Number(em.get(id)!.duration), lastTx: em.get(id)!.last_tx } : null,
        autoRewards: rm.has(id),
      };
    });
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
      wallets: wallets.length, locks: lockCount, locked: locked.toString(), idle: idle.toString(),
      coverage: coverBase > 0n ? Number((covered * 10000n) / coverBase) / 100 : null,
      nextUnlock, loanColl: coll.toString(), loanDebt: debt.toString(), loans: out.filter((w) => w.loan).length,
    },
  };
}
