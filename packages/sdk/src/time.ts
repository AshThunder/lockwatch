export const WEEK = 7 * 24 * 3600;
export const DAY = 24 * 3600;
export const HOUR = 3600;
/** veBTC maxLockTime on Mezo (tigris deploy/08_deploy_ve_btc.ts: 30 days). */
export const MAX_LOCK_SECONDS = 30 * DAY;

/** Epochs flip every Thursday 00:00 UTC (unix epoch started on a Thursday). */
export const epochStart = (ts: number) => ts - (ts % WEEK);
export const epochNext = (ts: number) => epochStart(ts) + WEEK;

/** veBTC rounds unlock time down to the week: floor((now + d) / WEEK) * WEEK. */
export const lockEnd = (now: number, durationSec: number) => Math.floor((now + durationSec) / WEEK) * WEEK;

/** Valid lock durations from `now`: any end in (now, now + 30d], on a week boundary. */
export function validLockEnds(now: number): number[] {
  const out: number[] = [];
  for (let e = epochNext(now); e <= now + MAX_LOCK_SECONDS; e += WEEK) out.push(e);
  return out;
}

/** Mirrors Voter.onlyNewEpoch: reset allowed after the 1h distribute window, once per epoch. */
export function resetWindowOpen(now: number, lastVoted: number): boolean {
  const es = epochStart(now);
  return es > lastVoted && now > es + HOUR;
}

/** Keeper burst mode: 10 minutes either side of the epoch flip and of the vote-window opening. */
export function inBurstWindow(now: number): boolean {
  const es = epochStart(now);
  const d = now - es;
  const toNext = epochNext(now) - now;
  return d <= 10 * 60 || toNext <= 10 * 60 || Math.abs(d - HOUR) <= 10 * 60;
}
