"use client";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icon";

type L = { readonly href: string; readonly label: string; readonly icon: string; readonly m: string };

/** Phone bottom tab bar: four primary tabs plus a "More" sheet holding every other destination. */
export function MobileNav({ links, primary, path, isOn }: { links: readonly L[]; primary: readonly string[]; path: string | null; isOn: (p: string | null, h: string) => boolean }) {
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(0);
  const startY = useRef<number | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const tabs = links.filter((l) => primary.includes(l.href));
  const rest = links.filter((l) => !primary.includes(l.href));
  const moreOn = rest.some((l) => isOn(path, l.href));

  const close = useCallback((refocus = true) => { setOpen(false); setDrag(0); if (refocus) trigger.current?.focus(); }, []);

  useEffect(() => { setOpen(false); }, [path]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const el = sheet.current;
    el?.querySelector<HTMLElement>("[aria-current=page], a, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Tab" || !el) return;
      const f = Array.from(el.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, close]);

  const tab = (a: boolean) => `flex min-h-[56px] flex-col items-center justify-center gap-1 text-[0.6875rem] ${a ? "text-paper" : "text-faint"}`;

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] supports-[backdrop-filter]:backdrop-blur-md lg:hidden" aria-label="App">
        {tabs.map((l) => {
          const a = isOn(path, l.href);
          return (
            <Link key={l.href} href={l.href} aria-current={a ? "page" : undefined} className={tab(a)}>
              <Icon name={l.icon} className={`h-5 w-5 ${a ? "text-btc" : ""}`} />
              <span className="max-w-full truncate px-1">{l.m}</span>
            </Link>
          );
        })}
        <button ref={trigger} type="button" onClick={() => (open ? close() : setOpen(true))} aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
          className={`relative ${tab(moreOn || open)}`}>
          <Icon name={open ? "close" : "grid"} className={`h-5 w-5 ${moreOn || open ? "text-btc" : ""}`} />
          <span className="max-w-full truncate px-1">More</span>
          {moreOn && !open && <span className="sr-only">(current page is in this menu)</span>}
        </button>
      </nav>

      <div className={`fixed inset-0 z-50 lg:hidden ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
        <div onClick={() => close()} className={`absolute inset-0 bg-ground/70 transition-opacity duration-200 motion-reduce:transition-none ${open ? "opacity-100" : "opacity-0"}`} />
        <div ref={sheet} id={id} role="dialog" aria-modal="true" aria-label="More destinations"
          onTouchStart={(e) => { startY.current = e.touches[0].clientY; }}
          onTouchMove={(e) => { if (startY.current != null) setDrag(Math.max(0, e.touches[0].clientY - startY.current)); }}
          onTouchEnd={() => { if (drag > 80) close(); else setDrag(0); startY.current = null; }}
          style={open && drag ? { transform: `translateY(${drag}px)`, transition: "none" } : undefined}
          className={`absolute inset-x-0 bottom-0 rounded-t-[10px] border-t border-line bg-panel pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none ${open ? "translate-y-0" : "translate-y-full"}`}>
          {open && <>
            <div className="flex justify-center pt-2.5" aria-hidden="true"><i className="h-1 w-10 rounded-full bg-line" /></div>
            <div className="flex items-center justify-between px-5 pb-2 pt-3">
              <span className="board-label">All destinations</span>
              <button type="button" onClick={() => close()} className="-mr-2 grid h-10 w-10 place-items-center rounded text-mute hover:text-paper" aria-label="Close menu"><Icon name="close" className="h-5 w-5" /></button>
            </div>
            <ul className="grid grid-cols-3 gap-2 px-4">
              {rest.map((l) => {
                const a = isOn(path, l.href);
                return (
                  <li key={l.href}>
                    <Link href={l.href} onClick={() => close(false)} aria-current={a ? "page" : undefined}
                      className={`relative flex min-h-[76px] flex-col items-center justify-center gap-2 rounded-[4px] border px-2 text-center text-[0.75rem] transition-colors ${a ? "border-btc/60 bg-raised text-paper" : "border-line text-mute hover:bg-raised/60 hover:text-paper"}`}>
                      {a && <i className="absolute inset-x-3 top-0 h-[3px] rounded-b bg-btc" aria-hidden="true" />}
                      <Icon name={l.icon} className={`h-5 w-5 ${a ? "text-btc" : "text-faint"}`} />
                      <span className="leading-tight">{l.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>}
        </div>
      </div>
    </>
  );
}
