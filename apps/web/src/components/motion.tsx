"use client";
import { useRef, useEffect, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP, ScrollTrigger);
export { gsap, ScrollTrigger, useGSAP };

export function usePrefersReducedMotion() {
  const [r, set] = useState(false);
  useEffect(() => { const m = matchMedia("(prefers-reduced-motion: reduce)"); set(m.matches); const f = () => set(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return r;
}

/** Split-flap characters. Changed cells flip down like a Solari board; reduced motion swaps instantly. */
export function Flap({ value, className = "", cell = "h-[1.35em] w-[0.86em]", label }: { value: string; className?: string; cell?: string; label?: string }) {
  const root = useRef<HTMLSpanElement>(null);
  const prev = useRef<string>("");
  useGSAP(() => {
    const old = prev.current; prev.current = value;
    if (!root.current || !old) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const cells = Array.from(root.current!.querySelectorAll<HTMLElement>("[data-c]")).filter((el, i) => old[i] !== value[i]);
      if (cells.length) gsap.fromTo(cells, { rotateX: -88, filter: "brightness(1.6)" }, { rotateX: 0, filter: "brightness(1)", duration: 0.34, ease: "power3.out", stagger: 0.035 });
    });
    return () => mm.revert();
  }, { dependencies: [value], scope: root });
  return (
    <span ref={root} className={`inline-flex gap-[0.08em] ${className}`} role={label ? "img" : undefined} aria-label={label}>
      {value.split("").map((ch, i) => (
        ch === " " ? <span key={i} className="w-[0.3em]" aria-hidden="true" /> :
        <span key={i} className={`flap ${cell}`} aria-hidden={label ? "true" : undefined}><span data-c>{ch}</span></span>
      ))}
    </span>
  );
}

/** Counts up to a number once it scrolls into view. Final value is in the DOM from the start (SSR-safe, no-JS-safe). */
export function Ticker({ value, format = (n) => n.toLocaleString("en-US"), className = "" }: { value: number; format?: (n: number) => string; className?: string }) {
  const el = useRef<HTMLSpanElement>(null);
  useGSAP(() => {
    if (!el.current) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const o = { v: 0 };
      gsap.to(o, { v: value, duration: 1.4, ease: "expo.out", scrollTrigger: { trigger: el.current, start: "top 92%", once: true },
        onUpdate: () => { if (el.current) el.current.textContent = format(o.v); }, onComplete: () => { if (el.current) el.current.textContent = format(value); } });
    });
    return () => mm.revert();
  }, { dependencies: [value], scope: el });
  return <span ref={el} className={`num ${className}`}>{format(value)}</span>;
}

/** Scroll reveals for a section: children marked data-reveal rise in once, as a batch. Visible by default. */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const items = gsap.utils.toArray<HTMLElement>("[data-reveal]", ref.current);
      gsap.set(items, { opacity: 0, y: 18 });
      ScrollTrigger.batch(items, { start: "top 88%", once: true, onEnter: (b) => gsap.to(b, { opacity: 1, y: 0, duration: 0.7, ease: "expo.out", stagger: 0.06, overwrite: true }) });
    });
    return () => mm.revert();
  }, { scope: ref });
  return ref;
}
