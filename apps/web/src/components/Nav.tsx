"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { CHAIN_ID } from "@/lib/env";
import { Wordmark } from "./Logo";

const links = [["/dashboard", "My locks"], ["/at-risk", "BTC at risk"], ["/radar", "Redemption Radar"], ["/alerts", "Alerts"]] as const;

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-base/95 supports-[backdrop-filter]:bg-base/80 supports-[backdrop-filter]:backdrop-blur-md [&_button]:whitespace-nowrap">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-5">
        <Link href="/" className="h-6 shrink-0 text-paper" aria-label="Lockwatch home"><Wordmark className="h-6" /></Link>
        <nav className="hidden h-full items-stretch gap-6 md:flex" aria-label="Primary">
          {links.map(([h, l]) => {
            const on = path?.startsWith(h);
            return (
              <Link key={h} href={h} aria-current={on ? "page" : undefined}
                className={`relative flex items-center text-sm transition-colors ${on ? "text-paper" : "text-mute hover:text-paper"}`}>
                {l}{on && <i className="absolute inset-x-0 bottom-0 h-0.5 bg-btc" aria-hidden="true" />}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <span className="hidden items-center gap-1.5 font-mono text-2xs uppercase tracking-[0.08em] text-mute lg:inline-flex">
            <i className="h-1.5 w-1.5 rounded-full bg-btc" aria-hidden="true" />Mezo {CHAIN_ID === 31612 ? "mainnet" : "testnet"}
          </span>
          <ConnectButton chainStatus="none" showBalance={false} accountStatus="address" />
        </div>
      </div>
      <nav className="flex gap-5 overflow-x-auto border-t border-hair px-5 md:hidden" aria-label="Primary">
        {links.map(([h, l]) => {
          const on = path?.startsWith(h);
          return (
            <Link key={h} href={h} aria-current={on ? "page" : undefined} className={`relative flex min-h-[44px] items-center whitespace-nowrap text-[0.8125rem] ${on ? "text-paper" : "text-mute"}`}>
              {l}{on && <i className="absolute inset-x-0 bottom-0 h-0.5 bg-btc" aria-hidden="true" />}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
