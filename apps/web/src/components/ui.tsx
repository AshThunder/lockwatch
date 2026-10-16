"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { explorerUrl } from "@lockwatch/sdk";
import { ADDR, CHAIN_ID } from "@/lib/env";
import { short } from "@/lib/format";
import { Icon } from "./Icon";
import { Flap } from "./motion";

const WEEK = 7 * 86400;

export function useNow(ms = 1000) {
  const [now, set] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => { const t = setInterval(() => set(Math.floor(Date.now() / 1000)), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

/** veBTC locks end on a Thursday 00:00 UTC boundary (unix epoch began on a Thursday). */
export const nextThursday = (now: number) => Math.floor(now / WEEK) * WEEK + WEEK;

export function clock(sec: number) {
  const s = Math.max(0, sec);
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}
export const two = (n: number) => String(n).padStart(2, "0");

/** Viewer-local time, e.g. "Thu 22 Oct, 01:00". */
export function when(ts: number) {
  return new Date(ts * 1000).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
export function ago(ts: number, now = Math.floor(Date.now() / 1000)) {
  const s = now - ts; if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return `${Math.floor(s / 86400)} d ago`;
}
export const tzLabel = () => Intl.DateTimeFormat().resolvedOptions().timeZone.split("/").pop()?.replace("_", " ") ?? "local";

export function Countdown({ to, className = "" }: { to: number; className?: string }) {
  const now = useNow();
  const c = clock(to - now);
  return (
    <span className={`num ${className}`} role="timer" aria-label={`${c.d} days ${c.h} hours ${c.m} minutes`}>
      {c.d}<span className="text-faint">d</span> {two(c.h)}<span className="text-faint">h</span> {two(c.m)}<span className="text-faint">m</span>
    </span>
  );
}

/** The signature: a departures-board countdown in split-flap tiles. */
export function FlapCountdown({ to, size = "text-4xl" }: { to: number; size?: string }) {
  const now = useNow();
  const c = clock(to - now);
  const groups: [string, string][] = [[two(c.d), "days"], [two(c.h), "hrs"], [two(c.m), "min"], [two(c.s), "sec"]];
  return (
    <div className={`flex items-start gap-2.5 sm:gap-3 ${size}`} role="timer" aria-label={`${c.d} days ${c.h} hours ${c.m} minutes until Thursday 00:00 UTC`}>
      {groups.map(([v, l]) => (
        <div key={l} className="flex flex-col items-center gap-1.5" aria-hidden="true">
          <Flap value={v} />
          <span className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-faint">{l}</span>
        </div>
      ))}
    </div>
  );
}

/** Drain toward expiry over a 4-week window: amber inside 7 days, red inside 24 hours. */
export function ExpiryBar({ end, permanent }: { end: number; permanent?: boolean }) {
  const now = useNow(10_000);
  const rem = end - now;
  const frac = permanent ? 1 : Math.max(0, Math.min(1, rem / (28 * 86400)));
  const tone = permanent ? "bg-faint" : rem <= 86400 ? "bg-bad" : rem <= WEEK ? "bg-signal" : "bg-ok";
  return (
    <div className="relative h-1 w-full overflow-hidden rounded-full bg-raised" aria-hidden="true">
      <div className={`h-full ${tone} transition-[width] duration-700 ease-out`} style={{ width: `${Math.max(rem > 0 || permanent ? 2 : 0, frac * 100)}%` }} />
      {[0.25, 0.5, 0.75].map((t) => <i key={t} className="absolute top-0 h-full w-px bg-ground" style={{ left: `${t * 100}%` }} />)}
    </div>
  );
}

export function ExplorerLink({ kind, id, children, className = "" }: { kind: "tx" | "address" | "token"; id: string; children?: React.ReactNode; className?: string }) {
  return (
    <a className={`group inline-flex items-center gap-1 text-paper underline decoration-line underline-offset-[3px] transition-colors hover:text-btc hover:decoration-btc ${className}`} target="_blank" rel="noreferrer" href={explorerUrl(CHAIN_ID, kind, id)}>
      <span className="num">{children ?? short(id)}</span>
      <Icon name="external" className="h-3 w-3 text-faint transition-colors group-hover:text-btc" />
      <span className="sr-only">(opens Mezo explorer)</span>
    </a>
  );
}
export const lockExplorer = (id: string, asset?: string) => `${asset === "mezo" ? ADDR.veMEZO : ADDR.veBTC}/instance/${id}`;
export const LockLink = ({ id, asset }: { id: string; asset?: string }) => <Link href={`/lock/${id}${asset === "mezo" ? "?asset=mezo" : ""}`} className="num text-paper underline decoration-line underline-offset-[3px] hover:text-btc hover:decoration-btc">#{id}</Link>;

const TONE: Record<string, [string, string]> = {
  active: ["text-ok", "On time"], expiring: ["text-signal", "Under 7 days"], critical: ["text-bad", "Under 24 h"], expired: ["text-bad", "Expired"],
  permanent: ["text-mute", "Permanent"], withdrawn: ["text-faint", "Withdrawn"], protected: ["text-btc", "Protected"],
  linked: ["text-ok", "Linked"], pending: ["text-signal", "Pending"], safe: ["text-ok", "Safe"], watch: ["text-signal", "Watch"], danger: ["text-bad", "Danger"], liquidatable: ["text-bad", "Liquidatable"],
  registered: ["text-btc", "Protect on"], unregistered: ["text-faint", "Protect off"], fallback: ["text-signal", "Plan B"], retrying: ["text-signal", "Retrying"], stuck: ["text-bad", "Needs attention"],
  voted: ["text-mute", "Voted"],
};
export function StatusPill({ status }: { status: string }) {
  const [c, l] = TONE[status] ?? ["text-mute", status];
  return (
    <span className={`pill ${c}`} style={{ background: "color-mix(in srgb, currentColor 11%, transparent)" }}>
      <i className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />{l}
    </span>
  );
}

export function Skeleton({ className = "h-4 w-24" }: { className?: string }) {
  return <span className={`skeleton inline-block align-middle ${className}`} aria-hidden="true" />;
}

export function PageHead({ title, children, aside, crumb }: { title: React.ReactNode; children?: React.ReactNode; aside?: React.ReactNode; crumb?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pb-6">
      <div className="min-w-0 max-w-3xl">
        {crumb}
        <h1 className="font-display text-[2rem] font-bold uppercase leading-[0.95] tracking-[0.01em] md:text-[2.75rem]">{title}</h1>
        {children && <div className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-mute">{children}</div>}
      </div>
      {aside && <div className="flex flex-wrap gap-2">{aside}</div>}
    </header>
  );
}

/** Empty / error / gated states share one shape: a ruled board row with a title, a reason and the way forward. */
export function State({ title, children, action, tone = "quiet" }: { title: string; children?: React.ReactNode; action?: React.ReactNode; tone?: "quiet" | "error" }) {
  return (
    <div className={`rounded-md border px-6 py-12 text-center ${tone === "error" ? "border-bad/40 bg-bad/[0.04]" : "border-dashed border-line"}`} role={tone === "error" ? "alert" : undefined}>
      <div className="font-display text-xl font-bold uppercase tracking-[0.02em]">{title}</div>
      {children && <div className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-mute">{children}</div>}
      {action && <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
export const Empty = State;

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 py-4">
      <dt className="label">{label}</dt>
      <dd className={`num mt-1.5 truncate text-2xl font-medium md:text-[1.75rem] ${tone ?? ""}`}>{value ?? <Skeleton className="h-7 w-24" />}</dd>
      {sub && <dd className="mt-1 text-xs text-faint">{sub}</dd>}
    </div>
  );
}

export function Pager({ page, pages, onPage, label = "Pagination" }: { page: number; pages: number; onPage: (p: number) => void; label?: string }) {
  if (pages <= 1) return null;
  return (
    <nav className="flex items-center justify-between gap-3 pt-4 text-sm" aria-label={label}>
      <span className="text-mute">Page <span className="num text-paper">{page}</span> of <span className="num">{pages}</span></span>
      <div className="flex gap-1.5">
        <button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}><Icon name="chevL" />Previous</button>
        <button className="btn-ghost btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next<Icon name="chevR" /></button>
      </div>
    </nav>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [ok, set] = useState(false);
  return (
    <button className="btn-quiet btn-sm min-h-[32px] px-2" onClick={async () => { await navigator.clipboard.writeText(text); set(true); setTimeout(() => set(false), 1400); }} aria-label={ok ? "Copied" : label}>
      <Icon name={ok ? "check" : "copy"} className="h-3.5 w-3.5" />
    </button>
  );
}
