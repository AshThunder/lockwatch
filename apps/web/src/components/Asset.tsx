"use client";
import type { Asset } from "@/lib/asset";

/** Board-style asset tag: the lamp colour tells veBTC (orange) from veMEZO (steel blue) at a glance. */
export function AssetTag({ asset, className = "" }: { asset: Asset | string; className?: string }) {
  const mezo = asset === "mezo";
  return (
    <span className={`pill ${mezo ? "text-mezo" : "text-btc"} ${className}`} style={{ background: "color-mix(in srgb, currentColor 12%, transparent)" }}>
      {mezo ? "veMEZO" : "veBTC"}
    </span>
  );
}

/** Segmented veBTC / veMEZO switch in the departures-board idiom (two flap-style tabs). */
export function AssetSwitch({ value, onChange, counts, className = "" }: { value: Asset; onChange: (a: Asset) => void; counts?: Partial<Record<Asset, number>>; className?: string }) {
  const opts: [Asset, string][] = [["btc", "veBTC"], ["mezo", "veMEZO"]];
  return (
    <div role="radiogroup" aria-label="Lock type" className={`inline-flex rounded-[4px] border border-line bg-ground p-0.5 ${className}`}>
      {opts.map(([a, label]) => {
        const on = value === a;
        return (
          <button key={a} type="button" role="radio" aria-checked={on} onClick={() => onChange(a)}
            className={`inline-flex min-h-[40px] items-center gap-2 rounded-[3px] px-3.5 font-display text-[0.8125rem] font-semibold uppercase tracking-[0.1em] transition-colors duration-150 ${on ? (a === "mezo" ? "bg-mezo text-mezo-ink" : "bg-btc text-btc-ink") : "text-mute hover:bg-raised hover:text-paper"}`}>
            {label}
            {counts?.[a] !== undefined && <span className={`num text-[0.75rem] ${on ? "opacity-70" : "text-faint"}`}>{counts[a]}</span>}
          </button>
        );
      })}
    </div>
  );
}
