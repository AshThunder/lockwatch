import { z } from "zod";

const n = (d: number, max: number) => z.coerce.number().int().min(0).max(max).default(d);
export const ExploreQ = z.object({
  state: z.enum(["expired", "live", "all"]).default("expired"),
  sort: z.enum(["amount", "end", "id"]).default("amount"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  minBtc: z.coerce.number().min(0).max(1e6).default(0),
  outliers: z.enum(["show", "hide"]).default("show"),
  page: n(1, 10_000).transform((v) => Math.max(1, v)),
  size: n(25, 100).transform((v) => Math.max(1, v)),
});
export const ActivityQ = z.object({
  owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  lock: z.string().regex(/^\d{1,30}$/).optional(),
  limit: n(25, 100).transform((v) => Math.max(1, v)),
  offset: n(0, 100_000),
});

/** Outlier rule shared by API and UI: a single lock holding over half of the expired BTC. */
export const OUTLIER_SHARE = 0.5;
export const toWei = (btc: number) => BigInt(Math.round(btc * 1e8)) * 10n ** 10n;

export type SearchHit = { kind: "lock"; id: string; href: string } | { kind: "address"; address: string; href: string } | { kind: "none"; reason: string };
/** Global search: "#123", "123", "lock 123" -> lock page; 0x + 40 hex -> wallet view. */
export function parseSearch(raw: string): SearchHit {
  const q = raw.trim();
  const lock = q.match(/^(?:lock\s*)?#?\s*(\d{1,30})$/i);
  if (lock) return { kind: "lock", id: String(BigInt(lock[1])), href: `/lock/${BigInt(lock[1])}` };
  if (/^0x[0-9a-fA-F]{40}$/.test(q)) return { kind: "address", address: q.toLowerCase(), href: `/dashboard?address=${q.toLowerCase()}` };
  if (/^0x[0-9a-fA-F]*$/.test(q)) return { kind: "none", reason: "An address is 0x followed by 40 hex characters." };
  return { kind: "none", reason: "Enter a lock number like #100 or a wallet address." };
}

export type TimelineStep = { key: string; label: string; at: number; state: "done" | "now" | "next" };
/** Lifecycle for a lock: alerts at T-7d / T-1d, unlock, vote-reset window (+1h), keeper claim. */
export function lockTimeline(end: number, now: number, o: { voted: boolean; protectedTx?: string | null; withdrawn?: boolean }): TimelineStep[] {
  const steps = [
    { key: "t7", label: "7-day alert", at: end - 7 * 86400 },
    { key: "t1", label: "24-hour alert", at: end - 86400 },
    { key: "end", label: "Lock unlocks", at: end },
    ...(o.voted ? [{ key: "votes", label: "Votes can be cleared", at: end + 3600 }] : []),
    { key: "claim", label: o.protectedTx ? "Claimed by keeper" : o.withdrawn ? "Withdrawn" : "Claim", at: end + (o.voted ? 3600 : 0) },
  ];
  const finished = !!o.protectedTx || !!o.withdrawn;
  const idx = steps.findIndex((s) => s.at > now);
  return steps.map((s, i) => ({ ...s, state: finished || s.at <= now && !(s.key === "claim") ? "done" : (i === idx || (s.key === "claim" && s.at <= now)) ? "now" : "next" }));
}
