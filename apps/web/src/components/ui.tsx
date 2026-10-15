"use client";
import { useEffect, useState } from "react";
import { explorerUrl } from "@lockwatch/sdk";
import { CHAIN_ID } from "@/lib/env";
import { left } from "@/lib/format";

export function useNow(ms = 1000) {
  const [now, set] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => { const t = setInterval(() => set(Math.floor(Date.now() / 1000)), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

/** Ring that drains toward the expiry; amber within 7d, red within 1d. */
export function CountdownRing({ end, start, size = 88 }: { end: number; start?: number; size?: number }) {
  const now = useNow();
  const total = Math.max(1, end - (start ?? end - 28 * 86400));
  const rem = Math.max(0, end - now);
  const frac = Math.min(1, rem / total);
  const color = rem <= 0 ? "#EF4444" : rem <= 86400 ? "#EF4444" : rem <= 7 * 86400 ? "#F59E0B" : "#22C55E";
  const r = size / 2 - 6, c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#1F242C" strokeWidth="6" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="6" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} style={{ transition: "stroke-dashoffset 1s linear" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="num text-[11px] leading-tight" style={{ color }}>{rem <= 0 ? "EXPIRED" : left(rem).split(" ").slice(0, 2).join(" ")}</span>
      </div>
    </div>
  );
}

export function ExplorerLink({ kind, id, children }: { kind: "tx" | "address" | "token"; id: string; children?: React.ReactNode }) {
  return <a className="text-btc underline-offset-2 hover:underline" target="_blank" rel="noreferrer" href={explorerUrl(CHAIN_ID, kind, id)}>{children ?? `${id.slice(0, 10)}…`} ↗</a>;
}

export function Stat({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: boolean }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wider text-mute">{label}</div>
      <div className={`num mt-1 text-3xl font-bold ${accent ? "text-btc" : ""}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-mute">{sub}</div>}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const m: Record<string, string> = { active: "bg-ok/10 text-ok", expiring: "bg-warn/10 text-warn", critical: "bg-bad/10 text-bad", expired: "bg-bad/15 text-bad", permanent: "bg-white/10 text-mute", withdrawn: "bg-white/5 text-mute", safe: "bg-ok/10 text-ok", watch: "bg-warn/10 text-warn", danger: "bg-bad/15 text-bad", liquidatable: "bg-bad/25 text-bad" };
  return <span className={`pill ${m[status] ?? "bg-white/10"}`}>{status}</span>;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="card py-12 text-center"><div className="text-lg font-semibold">{title}</div><div className="mt-2 text-sm text-mute">{children}</div></div>;
}
