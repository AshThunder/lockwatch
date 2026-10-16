import type { Address } from "viem";
import { WEEK, DAY, MAX_LOCK_SECONDS } from "./time";

// ---------------------------------------------------------------- auto-extend
/** Mirrors LockwatchVault._extendCheck reasons. */
export const EXTEND_REASONS: Record<number, string> = {
  0: "ok", 1: "no policy", 2: "lock changed owner", 4: "permanent lock", 5: "vault not approved",
  7: "managed NFT", 8: "not inside the extend window yet", 9: "already expired", 10: "already at the maximum",
};

export interface ExtendPolicy { triggerWithin: number; duration: number } // seconds; duration 0 = max

export const EXTEND_PRESETS = {
  /** Keep at maximum: re-extend every week so voting power never decays below ~3 weeks. */
  max: { triggerWithin: MAX_LOCK_SECONDS - 1, duration: 0 },
  /** Extend 4 weeks once fewer than 7 days remain. */
  fourWeeksAt7d: { triggerWithin: 7 * DAY, duration: 4 * WEEK },
} as const satisfies Record<string, ExtendPolicy>;

/** veMEZO (4-year max lock). Same vault arithmetic, longer horizon. */
export const MEZO_MAX_LOCK_SECONDS = 4 * 365 * DAY;
export const EXTEND_PRESETS_MEZO = {
  /** Keep at 4 years: re-extend weekly so boost weight never decays. */
  max: { triggerWithin: MEZO_MAX_LOCK_SECONDS - 1, duration: 0 },
  /** Add a year once fewer than 30 days remain. */
  yearAt30d: { triggerWithin: 30 * DAY, duration: 52 * WEEK },
} as const satisfies Record<string, ExtendPolicy>;

/** End the vault would set right now (weekly-rounded); same arithmetic as veBTC. */
export const extendTarget = (now: number, p: ExtendPolicy, maxLock = MAX_LOCK_SECONDS) =>
  Math.floor((now + (p.duration === 0 ? maxLock : p.duration)) / WEEK) * WEEK;

/** Earliest time the keeper will run extend for this lock (or null if it never would gain anything). */
export function nextExtendAt(end: number, now: number, p: ExtendPolicy, maxLock = MAX_LOCK_SECONDS): number | null {
  const openAt = Math.max(now, end - p.triggerWithin);
  if (openAt >= end) return null;
  // the target must move past `end`: floor((t + d)/W)*W > end  <=>  t >= end + W - d (rounded)
  const d = p.duration === 0 ? maxLock : p.duration;
  const gainAt = Math.max(openAt, Math.floor(end / WEEK) * WEEK + WEEK - d);
  return gainAt < end ? gainAt : null;
}

export function validateExtendPolicy(p: ExtendPolicy, maxLock = MAX_LOCK_SECONDS): string | null {
  if (p.triggerWithin <= 0 || p.triggerWithin > maxLock) return "Window must be between 1 second and 30 days";
  if (p.duration !== 0 && (p.duration < WEEK || p.duration > maxLock)) return "Extension must be 1–4 weeks, or max";
  return null;
}

// ---------------------------------------------------------------- reward auto-claim
export interface RewardClaimable { gauge: Address; bribeTokens: Address[]; feeTokens: Address[] }
/** Only include gauges/tokens with something earned; null when nothing to claim. */
export function buildClaim(items: { gauge: Address; bribe: { token: Address; earned: bigint }[]; fees: { token: Address; earned: bigint }[] }[]) {
  const out: RewardClaimable[] = [];
  for (const i of items) {
    const b = i.bribe.filter((x) => x.earned > 0n).map((x) => x.token);
    const f = i.fees.filter((x) => x.earned > 0n).map((x) => x.token);
    if (b.length || f.length) out.push({ gauge: i.gauge, bribeTokens: b, feeTokens: f });
  }
  return out.length ? { gauges: out.map((o) => o.gauge), bribeTokens: out.map((o) => o.bribeTokens), feeTokens: out.map((o) => o.feeTokens) } : null;
}
/** Claim once per epoch, after the 1h distribute window following the Thursday flip. */
export const rewardsDue = (now: number, lastClaim: number) => {
  const es = now - (now % WEEK);
  return now > es + 3600 && lastClaim < es + 3600;
};

// ---------------------------------------------------------------- loan rescue
const E18 = 10n ** 18n;
/** EIP-712 AddColl / RepayMUSD for BorrowerOperationsSignatures. Sign AddColl at nonce n, RepayMUSD at n+1. */
export function rescueTypedData(kind: "AddColl" | "RepayMUSD", p: { chainId: number; bos: Address; amount: bigint; borrower: Address; nonce: bigint; deadline: bigint }) {
  const amountField = kind === "AddColl" ? "assetAmount" : "amount";
  return {
    domain: { name: "BorrowerOperationsSignatures", version: "1", chainId: p.chainId, verifyingContract: p.bos },
    types: { [kind]: [
      { name: amountField, type: "uint256" }, { name: "borrower", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
    ] },
    primaryType: kind,
    message: { [amountField]: p.amount, borrower: p.borrower, nonce: p.nonce, deadline: p.deadline },
  } as const;
}

/** Keeper decision: rescue when ICR < trigger (enforced onchain), or pre-emptively when the Radar says a typical
 *  redemption would reach the loan AND the ICR is within 10 points of the trigger (the onchain check still decides). */
export function rescueWanted(r: { icr: bigint; triggerIcr: bigint; radarRisk?: string | null }) {
  if (r.icr < r.triggerIcr) return "below_trigger" as const;
  if ((r.radarRisk === "danger" || r.radarRisk === "liquidatable") && r.icr < r.triggerIcr + E18 / 10n) return "front_of_line" as const;
  return null;
}

// ---------------------------------------------------------------- keeper transparency
export interface KeeperRun { job: string; ok: boolean; ts: number }
export function keeperStats(runs: KeeperRun[], now: number, cadence = 300) {
  const actions = runs.filter((r) => r.job !== "heartbeat");
  const ok = actions.filter((r) => r.ok).length;
  const hb = runs.filter((r) => r.job === "heartbeat" && r.ts > now - DAY).map((r) => Math.floor(r.ts / cadence));
  const slots = new Set(hb).size;
  const expected = Math.floor(DAY / cadence);
  const last = runs.reduce((m, r) => (r.job === "heartbeat" ? Math.max(m, r.ts) : m), 0);
  return {
    actions: actions.length,
    succeeded: ok,
    successRate: actions.length ? ok / actions.length : null,
    uptime24h: Math.min(1, slots / expected),
    lastHeartbeat: last || null,
    nextRun: last ? last + cadence : null,
    byJob: Object.fromEntries(["protect", "extend", "rewards", "rescue"].map((j) => {
      const xs = actions.filter((r) => r.job === j);
      return [j, { total: xs.length, ok: xs.filter((r) => r.ok).length }];
    })),
  };
}
