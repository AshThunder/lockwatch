"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { CHAIN_ID } from "@/lib/env";

const links = [["/dashboard", "My locks"], ["/at-risk", "BTC at risk"], ["/radar", "Redemption Radar"], ["/alerts", "Alerts"]] as const;

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-base/80 backdrop-blur [&_button]:whitespace-nowrap">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <img src="/favicon.svg" alt="" className="h-7 w-7" /> Lockwatch
        </Link>
        <nav className="hidden gap-1 md:flex">
          {links.map(([h, l]) => (
            <Link key={h} href={h} className={`rounded-lg px-3 py-1.5 text-sm ${path?.startsWith(h) ? "bg-white/10 text-white" : "text-mute hover:text-white"}`}>{l}</Link>
          ))}
        </nav>
        <span className="ml-auto hidden pill bg-btc/10 text-btc sm:inline-flex">{CHAIN_ID === 31612 ? "Mainnet" : "Testnet"}</span>
        <div className="ml-auto sm:ml-0"><ConnectButton chainStatus="none" showBalance={false} accountStatus="address" /></div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
        {links.map(([h, l]) => (
          <Link key={h} href={h} className={`whitespace-nowrap rounded-lg px-3 py-1 text-xs ${path?.startsWith(h) ? "bg-white/10" : "text-mute"}`}>{l}</Link>
        ))}
      </nav>
    </header>
  );
}
