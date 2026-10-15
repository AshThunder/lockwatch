"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, Spinner } from "./Icon";

type Hit = { kind: "lock" | "address" | "none"; href?: string; found?: boolean; reason?: string; id?: string; locks?: number; trove?: boolean };

/** Global search: a lock number or any wallet. "/" or Cmd/Ctrl-K focuses it. */
export function GlobalSearch({ big = false, autoFocus = false }: { big?: boolean; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (big) return;
    const f = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(t.tagName))) { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f);
  }, [big]);
  async function go(e: React.FormEvent) {
    e.preventDefault(); if (!q.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const h: Hit = await (await fetch(`/api/search?q=${encodeURIComponent(q)}`)).json();
      if (h.kind === "none") setMsg(h.reason ?? "Nothing matched.");
      else if (h.kind === "lock" && !h.found) setMsg(`Lock #${h.id} isn't indexed on this network.`);
      else if (h.kind === "address" && !h.found) setMsg("No veBTC locks or MUSD loan for that wallet.");
      else { router.push(h.kind === "address" && !h.locks && h.trove ? h.href!.replace("/dashboard", "/radar") : h.href!); setQ(""); input.current?.blur(); }
    } catch { setMsg("Search is unavailable. Try again in a moment."); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={go} role="search" className="relative w-full">
      <label className="sr-only" htmlFor={big ? "hero-search" : "global-search"}>Search a lock number or wallet address</label>
      <Icon name="search" className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint ${big ? "h-5 w-5" : "h-4 w-4"}`} />
      <input ref={input} id={big ? "hero-search" : "global-search"} value={q} onChange={(e) => { setQ(e.target.value); setMsg(null); }} autoFocus={autoFocus}
        spellCheck={false} autoComplete="off" aria-describedby={msg ? `${big ? "hero" : "global"}-search-msg` : undefined}
        placeholder={big ? "Wallet or lock #, e.g. #100" : "Lock # or wallet"}
        className={`field num pl-10 ${big ? "h-14 pr-36 text-[1rem]" : "h-10 min-h-[40px] pr-16 text-[0.8125rem]"}`} />
      {big ? (
        <button className="btn-primary absolute right-1.5 top-1.5 h-11 min-h-0" disabled={busy}>{busy ? <Spinner /> : null}Find my BTC</button>
      ) : (
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">{busy ? <Spinner className="h-3.5 w-3.5 text-faint" /> : <kbd className="max-sm:hidden rounded-[3px] border border-line px-1.5 py-0.5 font-mono text-[0.6875rem] text-faint">/</kbd>}</span>
      )}
      {msg && <p id={`${big ? "hero" : "global"}-search-msg`} role="status" className={`${big ? "mt-2 text-sm" : "absolute left-0 top-full z-50 mt-1.5 w-full rounded border border-line bg-raised p-2.5 text-xs shadow-pop"} text-signal`}>{msg}</p>}
    </form>
  );
}
