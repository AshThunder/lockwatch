"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetcher, btc } from "@/lib/format";
import { Stat } from "@/components/ui";

type AtRisk = { expiredCount: number; expiredBtc: string; owners: number; totalLocks: number; top: { id: string; amount: string }[] };

export default function Home() {
  const { data } = useQuery({ queryKey: ["at-risk"], queryFn: () => fetcher<AtRisk>("/api/at-risk") });
  return (
    <div className="space-y-16">
      <section className="relative overflow-hidden rounded-3xl border border-line bg-gradient-to-b from-panel to-base px-6 py-14 text-center md:px-16">
        <div className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[40rem] -translate-x-1/2 rounded-full bg-btc/20 blur-3xl" />
        <div className="pill mx-auto bg-bad/10 text-bad">After the Oct 5 exploit, expired locks were the target</div>
        <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-extrabold tracking-tight md:text-6xl">
          Never let your Bitcoin <span className="text-btc">sit unwatched</span> on Mezo.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-mute md:text-lg">
          Lockwatch alerts you before a veBTC lock expires, auto-claims it the moment it does, and warns you before a redemption hits your MUSD loan.
        </p>
        <div className="mx-auto mt-10 max-w-md rounded-2xl border border-btc/30 bg-black/30 p-6 glow">
          <div className="text-xs uppercase tracking-widest text-mute">BTC sitting in expired, unclaimed locks</div>
          <div className="num mt-2 text-5xl font-extrabold text-btc md:text-6xl">{data ? btc(data.expiredBtc, 2) : "…"}</div>
          <div className="mt-2 text-sm text-mute">{data ? `${data.expiredCount} locks · ${data.owners} wallets · largest lock ${btc(data.top[0]?.amount ?? "0", 1)} BTC` : "loading live data"}</div>
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/dashboard" className="btn-primary">Check my locks</Link>
          <Link href="/at-risk" className="btn-ghost">See the at-risk map</Link>
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-bold">How it works</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            ["1", "Watch", "Connect your wallet. Every veBTC lock shows a live countdown, its votes, and what's unclaimed."],
            ["2", "Protect", "Approve one lock and pick what happens at expiry: back to your wallet, re-lock, or open an MUSD loan into savings. Funds can only ever go to you."],
            ["3", "Relax", "Telegram and email alerts at 7 days, 1 day and expiry. A keeper claims the lock the moment it unlocks — even clearing votes first."],
          ].map(([n, t, d]) => (
            <div key={n} className="card">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-btc/15 font-bold text-btc">{n}</div>
              <div className="mt-4 text-lg font-semibold">{t}</div>
              <p className="mt-2 text-sm text-mute">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Stat label="Locks tracked" value={data?.totalLocks ?? "…"} sub="every veBTC lock on Mezo" />
        <Stat label="Admin keys" value="0" sub="no owner, no upgrade, no withdraw" />
        <Stat label="Forwarder trust" value="None" sub="plain msg.sender — the Oct 5 exploit class can't apply" />
      </section>

      <section className="card md:flex md:items-center md:gap-8">
        <div className="flex-1">
          <div className="pill bg-btc/10 text-btc">Redemption Radar</div>
          <h3 className="mt-3 text-xl font-bold">Healthy loans still get redeemed.</h3>
          <p className="mt-2 text-sm text-mute">MUSD redemptions take BTC from the lowest-ratio loans first. Radar shows your place in that line, how much MUSD stands ahead of you, and exactly how much collateral moves you back.</p>
        </div>
        <Link href="/radar" className="btn-ghost mt-4 md:mt-0">Open Radar</Link>
      </section>
    </div>
  );
}
