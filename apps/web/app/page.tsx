"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetcher, btc } from "@/lib/format";
import { Skeleton } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { WeekScale } from "@/components/WeekScale";
import { VAULT } from "@/lib/env";
import { ExplorerLink } from "@/components/ui";

type AtRisk = { expiredCount: number; expiredBtc: string; owners: number; totalLocks: number; top: { id: string; amount: string }[] };

const TIMELINE = [
  { at: "T − 7 days", t: "First alert", d: "Telegram and email tell you which lock is ending and what auto-protect will do." },
  { at: "T − 24 hours", t: "Last call", d: "A second alert, with a one-tap link to extend the lock or change the plan." },
  { at: "Thu 00:00 UTC", t: "Lock unlocks", d: "The keeper withdraws it straight away and sends the BTC back to you, re-locks it, or opens your MUSD loan." },
  { at: "+ 1 hour", t: "Voted locks clear", d: "Mezo blocks vote resets for the first hour. The keeper clears the votes, then claims." },
];

export default function Home() {
  const { data } = useQuery({ queryKey: ["at-risk"], queryFn: () => fetcher<AtRisk>("/api/at-risk") });
  const n = (v: React.ReactNode, w = "w-14") => (data ? <span className="num font-medium text-paper">{v}</span> : <Skeleton className={`h-[1em] ${w}`} />);
  return (
    <div className="space-y-24 md:space-y-32">
      <section className="grid items-end gap-10 md:grid-cols-[1.1fr_1fr] md:gap-12 lg:gap-16">
        <div>
          <h1 className="text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-6xl md:text-[3.4rem] lg:text-[4.1rem]" style={{ fontStretch: "115%" }}>
            Your Bitcoin shouldn&rsquo;t sit unwatched when a lock&nbsp;ends.
          </h1>
          <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-mute">
            Right now {n(`${data ? btc(data.expiredBtc, 2) : ""} BTC`, "w-24")} sits in {n(data?.expiredCount)} expired veBTC locks across {n(data?.owners)} wallets on Mezo, unclaimed. Lockwatch warns you before your lock ends and claims it for you the moment it does.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/dashboard" className="btn-primary px-5">Check my locks <Icon name="arrow" /></Link>
            <Link href="/at-risk" className="btn-ghost px-5">See the BTC at risk</Link>
          </div>
        </div>
        <WeekScale />
      </section>

      <section>
        <div className="grid gap-10 md:grid-cols-[1fr_2fr]">
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.02em] md:text-3xl">What happens to a protected lock</h2>
            <p className="mt-3 text-sm leading-relaxed text-mute">You approve one lock and pick an outcome. From then on it runs to the clock.</p>
          </div>
          <ol className="relative border-l border-line">
            {TIMELINE.map((s, i) => (
              <li key={s.at} className="relative pb-9 pl-7 last:pb-0">
                <i className={`absolute -left-[5px] top-1.5 h-[9px] w-[9px] rounded-full border-2 border-base ${i === 2 ? "bg-btc" : "bg-mute"}`} aria-hidden="true" />
                <div className={`num text-xs ${i === 2 ? "text-btc" : "text-faint"}`}>{s.at}</div>
                <div className="mt-1 font-display text-lg font-semibold tracking-tight">{s.t}</div>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-mute">{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-y border-line">
        <dl className="grid divide-line md:grid-cols-3 md:divide-x">
          {[
            ["No admin keys", "No owner, no upgrade, no withdraw function. The vault can only send BTC, locks and loans to the lock's owner."],
            ["No forwarder trust", "Plain msg.sender everywhere, so the Oct 5 forged-sender exploit can't apply."],
            ["Fails safe", "If a re-lock or loan can't go through at expiry, the vault returns your BTC instead."],
          ].map(([t, d]) => (
            <div key={t} className="border-b border-line py-7 last:border-b-0 md:border-b-0 md:px-7 md:first:pl-0 md:last:pr-0">
              <dt className="flex items-center gap-2 font-display font-semibold"><Icon name="shield" className="h-4 w-4 text-btc" />{t}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-mute">{d}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line py-4 text-xs text-mute">
          <span>{data ? <><span className="num text-paper">{data.totalLocks}</span> veBTC locks indexed</> : <Skeleton className="h-3 w-32" />}</span>
          {VAULT && <span className="flex items-center gap-2">Vault <ExplorerLink kind="address" id={VAULT} /></span>}
        </div>
      </section>

      <section className="grid gap-8 md:grid-cols-[2fr_1fr] md:items-end">
        <div>
          <h2 className="text-2xl font-semibold tracking-[-0.02em] md:text-3xl">Healthy loans still get redeemed.</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-mute">MUSD redemptions take BTC from the lowest-ratio loans first. Redemption Radar shows your place in that line, how much MUSD would have to be redeemed before it reaches you, and what moves you back.</p>
        </div>
        <Link href="/radar" className="btn-ghost justify-self-start md:justify-self-end">Open Redemption Radar <Icon name="arrow" /></Link>
      </section>
    </div>
  );
}
