import { DAY } from "./time";

export type LockStatus = "active" | "expiring" | "critical" | "expired" | "withdrawn" | "permanent";

export interface LockView {
  id: bigint;
  owner: `0x${string}`;
  amount: bigint;
  end: number;
  permanent: boolean;
  voted: boolean;
  withdrawn?: boolean;
}

/** UI + alert classification: amber within 7d, red within 1d, expired once end <= now. */
export function lockStatus(l: Pick<LockView, "end" | "permanent" | "withdrawn">, now: number): LockStatus {
  if (l.withdrawn) return "withdrawn";
  if (l.permanent) return "permanent";
  const left = l.end - now;
  if (left <= 0) return "expired";
  if (left <= DAY) return "critical";
  if (left <= 7 * DAY) return "expiring";
  return "active";
}

export type AlertKind = "lock_t7d" | "lock_t1d" | "lock_expired";

/** Which expiry alerts are due for a lock right now (idempotency handled by the caller's alert_log). */
export function dueExpiryAlerts(l: Pick<LockView, "end" | "permanent" | "withdrawn">, now: number): AlertKind[] {
  if (l.withdrawn || l.permanent) return [];
  const left = l.end - now;
  const out: AlertKind[] = [];
  if (left <= 0) out.push("lock_expired");
  else if (left <= DAY) out.push("lock_t1d");
  else if (left <= 7 * DAY) out.push("lock_t7d");
  return out;
}

export interface AtRiskSummary {
  expiredCount: number;
  expiredBtc: bigint;
  owners: number;
  buckets: { label: string; count: number; btc: bigint }[];
  upcoming: { end: number; count: number; btc: bigint }[];
}

/** Aggregates the "BTC at risk" map: expired-but-unclaimed locks by age, plus upcoming expiries. */
export function summarizeAtRisk(locks: LockView[], now: number): AtRiskSummary {
  // amount 0 = merged/split-away lock (NFT kept, balance moved): nothing to claim, not at risk
  const live = locks.filter((l) => !l.withdrawn && !l.permanent && l.amount > 0n);
  const expired = live.filter((l) => l.end <= now);
  const ages: [string, number][] = [["< 1 week", 7 * DAY], ["1–4 weeks", 28 * DAY], ["1–3 months", 90 * DAY], ["> 3 months", Infinity]];
  const buckets = ages.map(([label]) => ({ label, count: 0, btc: 0n }));
  for (const l of expired) {
    const age = now - l.end;
    const i = ages.findIndex(([, max]) => age < max);
    buckets[i].count++;
    buckets[i].btc += l.amount;
  }
  const upMap = new Map<number, { end: number; count: number; btc: bigint }>();
  for (const l of live.filter((l) => l.end > now)) {
    const u = upMap.get(l.end) ?? { end: l.end, count: 0, btc: 0n };
    u.count++;
    u.btc += l.amount;
    upMap.set(l.end, u);
  }
  return {
    expiredCount: expired.length,
    expiredBtc: expired.reduce((s, l) => s + l.amount, 0n),
    owners: new Set(expired.map((l) => l.owner.toLowerCase())).size,
    buckets,
    upcoming: [...upMap.values()].sort((a, b) => a.end - b.end),
  };
}
