/**
 * Redemption Radar (borrower side). MUSD redemptions start at the trove with the LOWEST ICR
 * (SortedTroves.getLast()) and walk getPrev(), skipping troves below MCR (110%). A borrower is hit
 * once cumulative redemptions exceed the debt of every redeemable trove ahead of them.
 */
export const MCR = 110n * 10n ** 16n; // 1.10e18
const E18 = 10n ** 18n;

export interface Trove {
  owner: `0x${string}`;
  coll: bigint; // BTC, 1e18
  debt: bigint; // MUSD, 1e18 (principal + interest)
}

export interface LineEntry extends Trove {
  icr: bigint; // 1e18
  rank: number; // 1 = next to be redeemed (only counts redeemable troves)
  musdAhead: bigint; // debt of redeemable troves strictly before this one
  redeemable: boolean;
}

export const icrOf = (t: Trove, price: bigint) => (t.debt === 0n ? 2n ** 255n : (t.coll * price) / t.debt);

/** Builds the redemption line ordered from next-to-be-redeemed to last. */
export function redemptionLine(troves: Trove[], price: bigint): LineEntry[] {
  const withIcr = troves.map((t) => ({ ...t, icr: icrOf(t, price) })).sort((a, b) => (a.icr < b.icr ? -1 : a.icr > b.icr ? 1 : 0));
  let ahead = 0n;
  let rank = 0;
  return withIcr.map((t) => {
    const redeemable = t.icr >= MCR;
    const e: LineEntry = { ...t, redeemable, rank: redeemable ? ++rank : 0, musdAhead: ahead };
    if (redeemable) ahead += t.debt;
    return e;
  });
}

export type RiskLevel = "safe" | "watch" | "danger" | "liquidatable";

/** Risk from MUSD ahead vs a typical redemption size, plus ICR health. */
export function radarRisk(e: LineEntry, typicalRedemption: bigint): RiskLevel {
  if (!e.redeemable) return "liquidatable";
  if (e.icr < 120n * 10n ** 16n || e.musdAhead <= typicalRedemption) return "danger";
  if (e.musdAhead <= typicalRedemption * 5n) return "watch";
  return "safe";
}

/** How much of trove X a redemption of `amount` MUSD would take (0 if it stops before X). */
export function redemptionHit(e: LineEntry, amount: bigint): bigint {
  if (!e.redeemable || amount <= e.musdAhead) return 0n;
  const over = amount - e.musdAhead;
  return over > e.debt ? e.debt : over;
}

/**
 * Collateral to add so the trove's ICR rises above `target` trove's ICR (moving behind it in the line).
 * coll' * price / debt > targetIcr  =>  coll' = targetIcr * debt / price + 1
 */
export function collToPass(e: Trove, targetIcr: bigint, price: bigint): bigint {
  targetIcr = (targetIcr * 10_001n) / 10_000n; // 0.01% buffer so the move is strict after rounding
  const need = (targetIcr * e.debt) / price + 1n;
  return need > e.coll ? need - e.coll : 0n;
}

/** MUSD to repay so ICR rises above targetIcr: debt' < coll * price / targetIcr. */
export function repayToPass(e: Trove, targetIcr: bigint, price: bigint): bigint {
  targetIcr = (targetIcr * 10_001n) / 10_000n;
  const maxDebt = (e.coll * price) / targetIcr;
  return e.debt > maxDebt ? e.debt - maxDebt + 1n : 0n;
}

export const fmt18 = (v: bigint, dp = 4) => {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const s = (Number(a / 10n ** 10n) / 1e8).toLocaleString("en-US", { maximumFractionDigits: dp });
  return neg ? `-${s}` : s;
};
export const pct18 = (v: bigint) => `${(Number((v * 10000n) / E18) / 100).toFixed(1)}%`;
