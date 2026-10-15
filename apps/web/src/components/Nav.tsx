"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { CHAIN_ID, VAULT } from "@/lib/env";
import { short } from "@/lib/format";
import { Wordmark, Mark } from "./Logo";
import { Icon } from "./Icon";
import { GlobalSearch } from "./Search";

export const APP_LINKS = [
  { href: "/dashboard", label: "My locks", icon: "board", m: "Locks" },
  { href: "/portfolio", label: "Portfolio", icon: "layers", m: "Portfolio" },
  { href: "/autopilot", label: "Autopilot", icon: "pilot", m: "Autopilot" },
  { href: "/watch", label: "Watchlist", icon: "eye", m: "Watch" },
  { href: "/at-risk", label: "Lock explorer", icon: "map", m: "Explorer" },
  { href: "/radar", label: "Redemption Radar", icon: "radar", m: "Radar" },
  { href: "/rescue", label: "Loan rescue", icon: "rescue", m: "Rescue" },
  { href: "/keeper", label: "Keeper", icon: "pulse", m: "Keeper" },
  { href: "/activity", label: "Activity", icon: "activity", m: "Activity" },
  { href: "/alerts", label: "Alerts", icon: "bell", m: "Alerts" },
] as const;
const MOBILE = ["/dashboard", "/autopilot", "/watch", "/radar", "/keeper"];

export function NetworkBadge({ compact = false }: { compact?: boolean }) {
  const main = CHAIN_ID === 31612;
  return (
    <span className="inline-flex items-center gap-2 rounded-[4px] border border-line px-2 py-1 text-[0.75rem] text-mute" title={`Chain ${CHAIN_ID}`}>
      <i className={`h-2 w-2 rounded-full ${main ? "bg-ok" : "bg-btc"} animate-lamp`} aria-hidden="true" />
      <span className="font-display font-semibold uppercase tracking-[0.1em] text-paper">Mezo {main ? "mainnet" : "testnet"}</span>
      {!compact && <span className="num text-faint">{CHAIN_ID}</span>}
    </span>
  );
}

const on = (path: string | null, h: string) => !!path && (path === h || path.startsWith(h + "/") || (h === "/at-risk" && path.startsWith("/lock")) || (h === "/dashboard" && path.startsWith("/protect")));

/** App shell: a fixed board rail on desktop, a top bar plus bottom tab bar on phones. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded focus:bg-btc focus:px-3 focus:py-2 focus:text-btc-ink">Skip to content</a>
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-panel lg:flex">
        <Link href="/" className="flex h-16 items-center border-b border-line px-5 text-paper" aria-label="Lockwatch home"><Wordmark className="h-6" /></Link>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3" aria-label="App">
          {APP_LINKS.map((l, i) => {
            const a = on(path, l.href);
            const group = i === 0 ? "Yours" : i === 4 ? "Mezo" : i === 7 ? "Lockwatch" : null;
            return (
              <div key={l.href}>
              {group && <div className={`board-label px-3 pb-1.5 ${i ? "pt-5" : "pt-1"}`}>{group}</div>}
              <Link href={l.href} aria-current={a ? "page" : undefined}
                className={`group relative flex min-h-[40px] items-center gap-3 rounded-[4px] px-3 text-sm transition-colors ${a ? "bg-raised text-paper" : "text-mute hover:bg-raised/60 hover:text-paper"}`}>
                {a && <i className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-btc" aria-hidden="true" />}
                <Icon name={l.icon} className={`h-[18px] w-[18px] ${a ? "text-btc" : "text-faint group-hover:text-mute"}`} />{l.label}
              </Link>
              </div>
            );
          })}
        </nav>
        <div className="space-y-3 border-t border-line p-4 text-xs text-mute">
          <NetworkBadge />
          {VAULT && <div className="flex items-center justify-between gap-2"><span>Vault</span><a className="num text-paper hover:text-btc" href={`https://explorer.test.mezo.org/address/${VAULT}`} target="_blank" rel="noreferrer">{short(VAULT)}</a></div>}
          <Link href="/keeper" className="flex items-center justify-between gap-2 hover:text-paper"><span>Keeper</span><span className="flex items-center gap-1.5 text-paper"><i className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden="true" />every 5 min</span></Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-40 border-b border-line bg-ground/95 supports-[backdrop-filter]:bg-ground/85 supports-[backdrop-filter]:backdrop-blur-md">
          <div className="flex h-16 items-center gap-3 px-4 md:px-6">
            <Link href="/" className="h-7 shrink-0 text-paper lg:hidden" aria-label="Lockwatch home"><Mark className="h-7 w-7" /></Link>
            <div className="min-w-0 max-w-md flex-1"><GlobalSearch /></div>
            <div className="ml-auto flex items-center gap-3">
              <span className="hidden md:inline-flex lg:hidden"><NetworkBadge compact /></span>
              <ConnectButton chainStatus="icon" showBalance={false} accountStatus={{ smallScreen: "avatar", largeScreen: "address" }} label="Connect" />
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[76rem] flex-1 px-4 pb-28 pt-8 md:px-8 md:pt-10 lg:pb-16">{children}</main>
        <footer className="hidden border-t border-line px-8 py-5 text-xs text-faint lg:flex lg:items-center lg:justify-between">
          <span>Non-custodial. No admin keys. No upgrade path.</span>
          <a className="inline-flex items-center gap-1.5 hover:text-paper" href="https://github.com/AshThunder/lockwatch"><Icon name="github" className="h-3.5 w-3.5" />Source</a>
        </footer>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] supports-[backdrop-filter]:backdrop-blur-md lg:hidden" aria-label="App">
        {APP_LINKS.filter((l) => MOBILE.includes(l.href)).map((l) => {
          const a = on(path, l.href);
          return (
            <Link key={l.href} href={l.href} aria-current={a ? "page" : undefined} className={`flex min-h-[56px] flex-col items-center justify-center gap-1 text-[0.6875rem] ${a ? "text-paper" : "text-faint"}`}>
              <Icon name={l.icon} className={`h-5 w-5 ${a ? "text-btc" : ""}`} />
              <span className="max-w-full truncate px-1">{l.m}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

const SITE = [["#how", "How it works"], ["#board", "Live board"], ["#security", "Security"], ["#faq", "FAQ"]] as const;
export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-ground/90 supports-[backdrop-filter]:bg-ground/75 supports-[backdrop-filter]:backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[80rem] items-center gap-8 px-5 md:px-8">
        <Link href="/" className="h-6 shrink-0 text-paper" aria-label="Lockwatch home"><Wordmark className="h-6" /></Link>
        <nav className="hidden items-center gap-7 md:flex" aria-label="Site">
          {SITE.map(([h, l]) => <a key={h} href={h} className="text-sm text-mute transition-colors hover:text-paper">{l}</a>)}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden lg:inline-flex"><NetworkBadge compact /></span>
          <Link href="/dashboard" className="btn-primary btn-sm">Open app<Icon name="arrow" className="h-3.5 w-3.5" /></Link>
        </div>
      </div>
    </header>
  );
}
