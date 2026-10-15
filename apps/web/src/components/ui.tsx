"use client";
import { useEffect, useState } from "react";
import { explorerUrl } from "@lockwatch/sdk";
import { CHAIN_ID } from "@/lib/env";
import { short } from "@/lib/format";
import { Icon } from "./Icon";

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
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return { d, h, m, s: x };
}
const two = (n: number) => String(n).padStart(2, "0");

/** Readable local + UTC time, e.g. "Thu 22 Oct, 01:00" in the viewer's zone. */
export function when(ts: number) {
  return new Date(ts * 1000).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function Countdown({ to, className = "" }: { to: number; className?: string }) {
  const now = useNow();
  const c = clock(to - now);
  return (
    <span className={`num ${className}`} role="timer" aria-label={`${c.d} days ${c.h} hours ${c.m} minutes`}>
      {c.d}<span className="text-faint">d</span> {two(c.h)}<span className="text-faint">h</span> {two(c.m)}<span className="text-faint">m</span> {two(c.s)}<span className="text-faint">s</span>
    </span>
  );
}

/** Linear drain toward expiry across a 4-week window: tone shifts amber inside 7d, red inside 24h. */
export function ExpiryBar({ end, permanent }: { end: number; permanent?: boolean }) {
  const now = useNow(10_000);
  const rem = end - now;
  const frac = permanent ? 1 : Math.max(0, Math.min(1, rem / (28 * 86400)));
  const tone = permanent ? "bg-faint" : rem <= 86400 ? "bg-bad" : rem <= WEEK ? "bg-warn" : "bg-ok";
  return (
    <div className="relative h-1 w-full overflow-hidden rounded-full bg-hair" aria-hidden="true">
      <div className={`h-full ${tone} transition-[width] duration-700 ease-out`} style={{ width: `${Math.max(rem > 0 || permanent ? 2 : 0, frac * 100)}%` }} />
      {[0.25, 0.5, 0.75].map((t) => <i key={t} className="absolute top-0 h-full w-px bg-base" style={{ left: `${t * 100}%` }} />)}
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

const TONE: Record<string, [string, string]> = {
  active: ["text-ok", "live"], expiring: ["text-warn", "expiring"], critical: ["text-bad", "under 24h"], expired: ["text-bad", "expired"],
  permanent: ["text-mute", "permanent"], withdrawn: ["text-faint", "withdrawn"], protected: ["text-btc", "protected"],
  linked: ["text-ok", "linked"], safe: ["text-ok", "safe"], watch: ["text-warn", "watch"], danger: ["text-bad", "danger"], liquidatable: ["text-bad", "liquidatable"],
};
export function StatusPill({ status }: { status: string }) {
  const [c, l] = TONE[status] ?? ["text-mute", status];
  return (
    <span className={`pill border ${c}`} style={{ borderColor: "color-mix(in srgb, currentColor 28%, transparent)", background: "color-mix(in srgb, currentColor 8%, transparent)" }}>
      <i className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />{l}
    </span>
  );
}

export function Skeleton({ className = "h-4 w-24" }: { className?: string }) {
  return <span className={`skeleton inline-block align-middle ${className}`} aria-hidden="true" />;
}

export function PageHead({ title, children, aside }: { title: string; children?: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-line pb-6">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-[-0.025em] md:text-[2.5rem] md:leading-[1.1]" style={{ fontStretch: "108%" }}>{title}</h1>
        {children && <p className="mt-3 text-[0.95rem] leading-relaxed text-mute">{children}</p>}
      </div>
      {aside}
    </header>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="panel px-6 py-14 text-center">
      <div className="font-display text-xl font-semibold tracking-tight">{title}</div>
      <div className="mx-auto mt-2 max-w-md text-sm text-mute">{children}</div>
    </div>
  );
}
