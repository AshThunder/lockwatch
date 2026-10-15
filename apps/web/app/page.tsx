"use client";
import Link from "next/link";
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetcher, btc, short } from "@/lib/format";
import { VAULT } from "@/lib/env";
import { Icon } from "@/components/Icon";
import { Wordmark } from "@/components/Logo";
import { GlobalSearch } from "@/components/Search";
import { Flap, Ticker, useReveal, gsap, useGSAP } from "@/components/motion";
import { FlapCountdown, nextThursday, useNow, when, ExplorerLink, Skeleton, StatusPill, ago, tzLabel } from "@/components/ui";

type AtRisk = { expiredCount: number; expiredBtc: string; owners: number; totalLocks: number; buckets: { label: string; count: number; btc: string }[]; upcoming: { end: number; count: number; btc: string }[]; top: { id: string; amount: string; ageDays: number; owner: string }[] };
type Act = { items: { kind: string; lock_id: string; tx_hash: string | null; amount: string | null; mode: number; ts: number }[] };
const toBtc = (w: string) => Number(BigInt(w)) / 1e18;
const MODE = ["Back to wallet", "Re-locked", "MUSD loan", "MUSD savings"];

export default function Home() {
  const risk = useQuery({ queryKey: ["at-risk"], queryFn: () => fetcher<AtRisk>("/api/at-risk") });
  const act = useQuery({ queryKey: ["activity", "home"], queryFn: () => fetcher<Act>("/api/activity?limit=5") });
  return (
    <>
      <Hero risk={risk.data} />
      <Problem risk={risk.data} />
      <How />
      <LiveBoard risk={risk.data} act={act.data} />
      <Security />
      <Radar />
      <Faq />
      <Close />
      <SiteFooter />
    </>
  );
}

/* ------------------------------------------------------------------ hero: the departures board */
function Hero({ risk }: { risk?: AtRisk }) {
  const now = useNow();
  const next = nextThursday(now);
  const root = useRef<HTMLElement>(null);
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
      tl.from("[data-h1] > span", { yPercent: 40, opacity: 0, duration: 0.9, stagger: 0.08 })
        .from("[data-hero-sub]", { opacity: 0, y: 12, duration: 0.7 }, "-=0.6")
        .from("[data-board]", { opacity: 0, y: 24, duration: 0.9 }, "-=0.5")
        .from("[data-row]", { rotateX: -80, opacity: 0, transformOrigin: "50% 0%", duration: 0.5, stagger: 0.07 }, "-=0.5");
    });
    return () => mm.revert();
  }, { scope: root });
  const rows = (risk?.upcoming ?? []).slice(0, 4);
  const cols = ["Departs", "Locks", "BTC", "Status"];
  return (
    <section ref={root} className="relative overflow-hidden border-b border-line">
      <div className="mx-auto grid max-w-[80rem] gap-12 px-5 pb-16 pt-12 md:px-8 md:pb-24 md:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.02fr)] lg:items-center lg:gap-14">
        <div>
          <h1 data-h1 className="font-display text-[3rem] font-extrabold uppercase leading-[0.88] sm:text-[4.25rem] lg:text-[4.6rem] xl:text-[5.4rem]">
            <span className="block">Every <span className="normal-case">ve</span>BTC lock</span> <span className="block">ends on a Thursday.</span> <span className="block text-btc">Yours keeps working.</span>
          </h1>
          <div data-hero-sub>
            <p className="mt-7 max-w-[33rem] text-lg leading-relaxed text-mute">
              When a lock ends, its BTC stops earning and voting, and waits until you come back to claim it. Lockwatch alerts you before that moment, then claims, re-locks or borrows MUSD against it for you, automatically.
            </p>
            <div className="mt-7 max-w-[33rem]"><GlobalSearch big /></div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
              <Link href="/dashboard" className="link inline-flex min-h-[44px] items-center gap-1.5">Or connect a wallet<Icon name="arrow" className="h-3.5 w-3.5" /></Link>
              <a href="#how" className="inline-flex min-h-[44px] items-center text-mute hover:text-paper">How it works</a>
            </div>
          </div>
        </div>

        <div data-board className="min-w-0 overflow-hidden rounded-lg border border-line bg-panel shadow-pop" style={{ perspective: 800 }}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3 md:px-6">
            <span className="board-label text-paper">Departures · <span className="normal-case">ve</span>BTC</span>
            <span className="flex items-center gap-2 text-xs text-mute"><i className="h-2 w-2 animate-lamp rounded-full bg-btc" aria-hidden="true" />Live, Mezo testnet</span>
          </div>
          <div className="border-b border-line p-5 md:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="board-label">Next departure</span>
              <span className="text-sm text-mute"><span className="text-paper">{when(next)}</span> {tzLabel()}</span>
            </div>
            <div className="mt-4"><FlapCountdown to={next} size="text-[2rem] sm:text-[2.6rem] lg:text-[2.3rem] xl:text-[2.75rem]" /></div>
          </div>
          <table className="w-full text-sm">
            <caption className="sr-only">Upcoming veBTC unlocks and BTC idle in ended locks</caption>
            <thead><tr className="text-left">{cols.map((h, i) => <th key={h} scope="col" className={`board-label h-10 border-b border-line px-4 font-semibold first:pl-5 last:pr-5 md:first:pl-6 md:last:pr-6 ${i ? "text-right" : ""} ${i === 1 ? "max-sm:hidden" : ""}`}>{h}</th>)}</tr></thead>
            <tbody>
              {risk ? rows.map((u, i) => (
                <tr key={u.end} data-row className="border-b border-hair">
                  <td className="num h-[52px] px-4 pl-5 text-paper md:pl-6">{when(u.end)}</td>
                  <td className="num px-4 text-right max-sm:hidden">{u.count}</td>
                  <td className="num px-4 text-right">{btc(u.btc, 3)}</td>
                  <td className="px-4 pr-5 text-right md:pr-6">{i === 0 ? <span className="pill bg-btc/15 text-btc">Boarding</span> : <span className="pill text-mute">Scheduled</span>}</td>
                </tr>
              )) : [0, 1].map((i) => <tr key={i} className="border-b border-hair"><td colSpan={4} className="h-[52px] px-5"><Skeleton className="h-4 w-full" /></td></tr>)}
              <tr data-row className="bg-bad/[0.05]">
                <td className="h-[52px] px-4 pl-5 text-paper md:pl-6">Ended, never claimed</td>
                <td className="num px-4 text-right max-sm:hidden">{risk ? risk.expiredCount : <Skeleton className="h-4 w-10" />}</td>
                <td className="num px-4 text-right text-paper">{risk ? btc(risk.expiredBtc, 2) : <Skeleton className="h-4 w-16" />}</td>
                <td className="px-4 pr-5 text-right md:pr-6"><span className="pill bg-bad/15 text-bad">Idle</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ the problem, plainly */
function Problem({ risk }: { risk?: AtRisk }) {
  const ref = useReveal<HTMLElement>();
  const total = risk ? toBtc(risk.expiredBtc) : 0;
  const out = risk?.top[0] && total ? toBtc(risk.top[0].amount) : 0;
  const beats = [
    ["Thursday, 00:00 UTC", "Every veBTC lock on Mezo ends on the same weekly boundary. For much of the world that is the middle of the night."],
    ["Nobody is watching", "Lock lengths top out around four weeks, so the reminder comes around fast and is easy to miss."],
    ["The BTC sits idle", "An ended lock stops earning gauge incentives and stops voting. The BTC just waits, unprotected, until its owner claims it."],
  ];
  return (
    <section ref={ref} className="border-b border-line">
      <div className="mx-auto grid max-w-[80rem] gap-12 px-5 py-20 md:px-8 md:py-28 lg:grid-cols-[1fr_1.15fr] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <h2 data-reveal className="font-display text-[2.4rem] font-extrabold uppercase leading-[0.92] md:text-[3.6rem]">Locks end weekly. People forget.</h2>
          <div data-reveal className="mt-10">
            <div className="label">Idle in ended locks on Mezo testnet right now</div>
            <div className="mt-2 font-display text-[4.5rem] font-extrabold leading-none text-btc md:text-[6rem]">{risk ? <Ticker value={total} format={(n) => n.toFixed(2)} className="font-display" /> : <Skeleton className="h-20 w-64" />}<span className="ml-3 text-[0.4em] text-paper">BTC</span></div>
            {risk && <p className="mt-4 max-w-md text-sm leading-relaxed text-mute">Across <span className="num text-paper">{risk.expiredCount}</span> locks and <span className="num text-paper">{risk.owners}</span> wallets. One test lock holds <span className="num text-paper">{out.toFixed(0)} BTC</span> of it; the other locks still hold <span className="num text-paper">{(total - out).toFixed(2)} BTC</span>.</p>}
          </div>
        </div>
        <ol className="space-y-px">
          {beats.map(([t, d], i) => (
            <li key={t} data-reveal className="grid grid-cols-[3.5rem_1fr] gap-4 border-t border-line py-9 first:border-t-0 first:pt-0 md:py-12">
              <Flap value={String(i + 1)} cell="h-12 w-10 text-2xl" />
              <div><h3 className="font-display text-2xl font-bold uppercase tracking-[0.01em] md:text-3xl">{t}</h3><p className="mt-3 max-w-[34rem] leading-relaxed text-mute">{d}</p></div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ how it works: a timetable */
function How() {
  const ref = useReveal<HTMLElement>();
  const stops = [
    ["T − 7 days", "First alert", "Telegram and email name the lock, the BTC in it, and what auto-protect will do."],
    ["T − 24 hours", "Last call", "A second alert with one link to extend the lock or change the plan."],
    ["Thu 00:00 UTC", "Departure", "The lock ends. Within minutes the keeper calls the vault, which claims it."],
    ["+ 1 hour", "Voted locks", "Mezo only lets votes reset an hour after the boundary. The vault clears them, then claims."],
  ];
  const outcomes = [
    ["wallet", "Back to your wallet", "The BTC lands in the wallet that owns the lock. Nothing else changes."],
    ["relock", "Re-locked for you", "A new veBTC lock is minted to you for up to four weeks, so voting power and incentives continue."],
    ["coin", "Borrow MUSD", "The BTC opens an MUSD loan in your name from terms you signed in advance. MUSD lands in your wallet."],
  ];
  return (
    <section id="how" ref={ref} className="border-b border-line bg-panel/40">
      <div className="mx-auto max-w-[80rem] px-5 py-20 md:px-8 md:py-28">
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end">
          <h2 data-reveal className="font-display text-[2.4rem] font-extrabold uppercase leading-[0.92] md:text-[3.6rem]">Approve once. It runs to the timetable.</h2>
          <p data-reveal className="max-w-xl leading-relaxed text-mute lg:justify-self-end">You approve Lockwatch on one lock, not your wallet, and choose where the BTC goes. From then on, every step happens on schedule, whether or not you are awake.</p>
        </div>
        <ol className="mt-14 grid border-y border-line md:grid-cols-4" aria-label="Timetable">
          {stops.map(([at, t, d], i) => (
            <li key={at} data-reveal className={`relative py-7 md:px-6 md:first:pl-0 ${i ? "border-t border-line md:border-l md:border-t-0" : ""}`}>
              <div className={`num text-sm ${i === 2 ? "text-btc" : "text-faint"}`}>{at}</div>
              <div className="mt-2 font-display text-2xl font-bold uppercase">{t}</div>
              <p className="mt-2 text-sm leading-relaxed text-mute">{d}</p>
              {i === 2 && <i className="absolute inset-x-0 top-0 h-[3px] bg-btc md:left-0 md:right-auto md:top-0 md:h-[3px] md:w-full" aria-hidden="true" />}
            </li>
          ))}
        </ol>
        <h3 data-reveal className="mt-20 board-label">Where the BTC goes. You choose per lock.</h3>
        <dl className="mt-5 grid gap-px overflow-hidden rounded-md border border-line bg-line md:grid-cols-3">
          {outcomes.map(([ic, t, d]) => (
            <div key={t} data-reveal className="bg-ground p-6 md:p-7">
              <dt className="flex items-center gap-3 font-display text-xl font-bold uppercase"><Icon name={ic} className="h-5 w-5 text-btc" />{t}</dt>
              <dd className="mt-3 text-sm leading-relaxed text-mute">{d}</dd>
            </div>
          ))}
        </dl>
        <p data-reveal className="mt-5 text-sm text-mute">If a re-lock or loan can&rsquo;t go through at the moment of departure, the vault sends the BTC to your wallet instead.</p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ live data showcase */
function LiveBoard({ risk, act }: { risk?: AtRisk; act?: Act }) {
  const ref = useReveal<HTMLElement>();
  const total = risk ? toBtc(risk.expiredBtc) : 0;
  const ages = risk?.buckets ?? [];
  const AGE = ["bg-signal", "bg-btc", "bg-[#D9632A]", "bg-[#9C4027]"];
  return (
    <section id="board" ref={ref} className="border-b border-line">
      <div className="mx-auto max-w-[80rem] px-5 py-20 md:px-8 md:py-28">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <h2 data-reveal className="max-w-[16ch] font-display text-[2.4rem] font-extrabold uppercase leading-[0.92] md:text-[3.6rem]">Real locks. Real keeper. On testnet now.</h2>
          <Link data-reveal href="/at-risk" className="btn-ghost">Open the lock explorer<Icon name="arrow" /></Link>
        </div>
        <dl data-reveal className="mt-12 grid grid-cols-2 border-y border-line md:grid-cols-4">
          {[
            ["Locks indexed", risk?.totalLocks],
            ["Ended, unclaimed", risk?.expiredCount],
            ["Wallets affected", risk?.owners],
            ["BTC idle", risk ? total : undefined],
          ].map(([l, v], i) => (
            <div key={l as string} className={`py-6 ${i % 2 ? "pl-5 border-l border-line" : "pr-5"} md:px-6 md:first:pl-0 ${i > 0 ? "md:border-l md:border-line" : ""} ${i < 2 ? "max-md:border-b max-md:border-line" : ""}`}>
              <dt className="label">{l as string}</dt>
              <dd className="mt-2 font-display text-[2.6rem] font-extrabold leading-none md:text-[3.2rem]">{v === undefined ? <Skeleton className="h-10 w-24" /> : <Ticker className="font-display" value={v as number} format={(n) => (i === 3 ? n.toFixed(2) : Math.round(n).toLocaleString("en-US"))} />}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-14 grid gap-14 lg:grid-cols-[1.1fr_1fr]">
          <div data-reveal>
            <h3 className="board-label text-paper">How long it has been idle</h3>
            <div className="mt-5 flex h-3 overflow-hidden rounded-full bg-raised" role="img" aria-label={ages.map((a) => `${a.label}: ${a.count} locks`).join(", ")}>
              {ages.map((a, i) => <div key={a.label} className={AGE[i]} style={{ flex: Math.max(a.count, 0.0001) }} />)}
            </div>
            <ul className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {ages.map((a, i) => <li key={a.label} className="flex items-center justify-between gap-3 border-b border-hair pb-3"><span className="flex items-center gap-2"><i className={`h-2.5 w-2.5 rounded-[2px] ${AGE[i]}`} aria-hidden="true" />{a.label}</span><span className="num text-mute">{a.count} locks</span></li>)}
              {!risk && [0, 1, 2, 3].map((i) => <li key={i}><Skeleton className="h-4 w-full" /></li>)}
            </ul>
            <p className="mt-5 text-xs leading-relaxed text-faint">Counted by lock. One test lock with about 868 BTC is shown in the explorer on its own, so it doesn&rsquo;t hide the rest.</p>
          </div>
          <div data-reveal>
            <div className="flex items-baseline justify-between gap-3"><h3 className="board-label text-paper">Latest keeper activity</h3><Link href="/activity" className="text-sm text-mute hover:text-paper">All activity</Link></div>
            <ul className="mt-4 border-t border-line">
              {act?.items.length ? act.items.map((a) => (
                <li key={`${a.lock_id}-${a.ts}`} className="flex items-center justify-between gap-3 border-b border-hair py-3.5 text-sm">
                  <span className="flex min-w-0 items-center gap-3"><StatusPill status={a.kind} /><Link href={`/lock/${a.lock_id}`} className="num hover:text-btc">#{a.lock_id}</Link><span className="hidden truncate text-mute sm:inline">{a.kind === "protected" ? MODE[a.mode] : a.kind === "registered" ? `Plan: ${MODE[a.mode].toLowerCase()}` : ""}</span></span>
                  <span className="flex shrink-0 items-center gap-3 text-xs text-faint">{ago(a.ts)}{a.tx_hash && <ExplorerLink kind="tx" id={a.tx_hash}>tx</ExplorerLink>}</span>
                </li>
              )) : act ? <li className="py-6 text-sm text-mute">No keeper actions yet on this network.</li> : [0, 1, 2].map((i) => <li key={i} className="border-b border-hair py-4"><Skeleton className="h-4 w-full" /></li>)}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ security spec sheet */
function Security() {
  const ref = useReveal<HTMLElement>();
  const spec = [
    ["Admin keys", "None. The vault has no owner and no privileged role."],
    ["Upgrades", "None. The deployed code is the code, forever."],
    ["Withdraw function", "None. BTC, new locks and loans can only go to the lock's owner."],
    ["Forwarders", "None trusted. Every call checks the real sender, so gasless relays can't act for you."],
    ["Approval scope", "One lock at a time, and only usable after that lock has ended."],
    ["If something fails", "The BTC goes straight back to your wallet."],
  ];
  return (
    <section id="security" ref={ref} className="border-b border-line bg-panel/40">
      <div className="mx-auto grid max-w-[80rem] gap-12 px-5 py-20 md:px-8 md:py-28 lg:grid-cols-[1fr_1.4fr] lg:gap-20">
        <div>
          <h2 data-reveal className="font-display text-[2.4rem] font-extrabold uppercase leading-[0.92] md:text-[3.6rem]">Built so it can&rsquo;t keep your BTC.</h2>
          <p data-reveal className="mt-6 max-w-md leading-relaxed text-mute">Every guarantee below is an automated test, including fuzz, invariant and gas-griefing tests, and fork tests run against the real Mezo testnet contracts.</p>
          {VAULT && <div data-reveal className="mt-8 rounded-md border border-line p-4 text-sm"><div className="label">LockwatchVault · source verified</div><div className="mt-1.5 break-all"><ExplorerLink kind="address" id={VAULT}>{VAULT}</ExplorerLink></div></div>}
        </div>
        <dl className="border-t border-line">
          {spec.map(([k, v]) => (
            <div key={k} data-reveal className="grid gap-1 border-b border-line py-5 sm:grid-cols-[12rem_1fr] sm:gap-6">
              <dt className="font-display text-lg font-bold uppercase tracking-[0.02em]">{k}</dt>
              <dd className="flex gap-2.5 leading-relaxed text-mute"><Icon name="check" className="mt-1 h-4 w-4 text-ok" />{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ radar teaser */
function Radar() {
  const ref = useReveal<HTMLElement>();
  const segs = [14, 9, 22, 6, 11, 18, 8, 12];
  return (
    <section ref={ref} className="border-b border-line">
      <div className="mx-auto grid max-w-[80rem] gap-10 px-5 py-20 md:px-8 md:py-24 lg:grid-cols-[1fr_1fr] lg:items-center">
        <div>
          <h2 data-reveal className="font-display text-[2.2rem] font-extrabold uppercase leading-[0.92] md:text-[3rem]">Borrowing MUSD? Know your place in line.</h2>
          <p data-reveal className="mt-5 max-w-lg leading-relaxed text-mute">MUSD redemptions are paid from the loans with the lowest collateral ratio first, healthy ones included. Redemption Radar shows how much MUSD would have to be redeemed before it reaches you, and what moves you back.</p>
          <Link data-reveal href="/radar" className="btn-ghost mt-7">Check a loan<Icon name="arrow" /></Link>
        </div>
        <div data-reveal aria-hidden="true">
          <div className="flex h-14 gap-[3px]">{segs.map((s, i) => <div key={i} className={`rounded-[3px] ${i === 5 ? "bg-btc" : i < 2 ? "bg-bad/70" : "bg-raised"}`} style={{ flex: s }} />)}</div>
          <div className="mt-3 flex justify-between font-mono text-xs text-faint"><span>Redeemed first</span><span className="text-btc">Your loan</span><span>Last</span></div>
          <p className="mt-2 text-xs text-faint">Illustration. The live line is on the Radar page.</p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ FAQ */
const FAQ: [string, React.ReactNode][] = [
  ["Does Lockwatch ever hold my BTC?", "Only inside the single transaction that claims your lock. In that same transaction it is sent to your wallet, re-locked in your name, or used as collateral for a loan in your name. The vault has no balance between transactions and no way to withdraw."],
  ["What do I approve?", "A standard veBTC approval on one lock ID. It does not cover your other locks or any tokens, and you can revoke it or switch the plan off at any time before the lock ends."],
  ["Why do unclaimed locks matter?", <>An ended lock earns nothing and votes for nothing until it is claimed, and BTC that nobody is watching is a target. Mezo saw that in an incident on Oct 5, 2026. Lockwatch keeps ended locks from sitting at all, and its vault does not use the gasless relay path involved there.</>],
  ["What happens to locks that have votes?", "Mezo lets votes be reset one hour after the Thursday boundary. The keeper waits for that window, clears the votes through the vault, then claims."],
  ["Who runs the keeper, and what if it goes down?", "Lockwatch runs one, but claiming through the vault is permissionless: anyone can trigger it, and the result is the same. You can also always claim the lock yourself."],
  ["Which wallets work?", "Any EVM wallet through RainbowKit, plus Bitcoin wallets through Mezo Passport. MUSD outcomes need an EVM wallet because they use a signed loan permit."],
  ["Is this on mainnet?", "Not yet. Lockwatch runs on Mezo testnet, and every figure on this page is read from it live. The sMUSD savings outcome switches on with mainnet."],
];
function Faq() {
  const ref = useReveal<HTMLElement>();
  return (
    <section id="faq" ref={ref} className="border-b border-line">
      <div className="mx-auto grid max-w-[80rem] gap-12 px-5 py-20 md:px-8 md:py-28 lg:grid-cols-[1fr_1.6fr]">
        <h2 data-reveal className="font-display text-[2.4rem] font-extrabold uppercase leading-[0.92] md:text-[3.6rem]">Questions</h2>
        <div className="border-t border-line">
          {FAQ.map(([q, a]) => (
            <details key={q} data-reveal className="group border-b border-line">
              <summary className="flex min-h-[64px] cursor-pointer list-none items-center justify-between gap-6 py-4 text-lg font-semibold [&::-webkit-details-marker]:hidden">
                {q}<Icon name="chevD" className="h-5 w-5 text-faint transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <div className="max-w-[62ch] pb-6 leading-relaxed text-mute">{a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Close() {
  const now = useNow(30_000);
  return (
    <section className="border-b border-line bg-btc text-btc-ink">
      <div className="mx-auto flex max-w-[80rem] flex-wrap items-end justify-between gap-8 px-5 py-16 md:px-8 md:py-20">
        <div>
          <h2 className="max-w-[18ch] font-display text-[2.4rem] font-extrabold uppercase leading-[0.92] md:text-[3.6rem]">Put your locks on the board.</h2>
          <p className="mt-3 font-display text-[1rem] font-bold uppercase tracking-[0.12em] opacity-80">Next departure {when(nextThursday(now))}</p>
        </div>
        <Link href="/dashboard" className="btn min-h-[52px] bg-ground px-6 text-[1rem] text-paper hover:bg-raised">Open Lockwatch<Icon name="arrow" /></Link>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer>
      <div className="mx-auto grid max-w-[80rem] gap-10 px-5 py-14 text-sm md:grid-cols-[1.5fr_1fr_1fr_1fr] md:px-8">
        <div>
          <Wordmark className="h-6 text-paper" />
          <p className="mt-4 max-w-xs leading-relaxed text-mute">Alerts and auto-protect for veBTC locks, and Redemption Radar for MUSD loans. Built for Mezo.</p>
        </div>
        {[
          ["Product", [["/dashboard", "My locks"], ["/at-risk", "Lock explorer"], ["/radar", "Redemption Radar"], ["/alerts", "Alerts"]]],
          ["Proof", [["/activity", "Keeper activity"], [VAULT ? `https://explorer.test.mezo.org/address/${VAULT}` : "/", "Vault on explorer"], ["https://github.com/AshThunder/lockwatch", "Source code"]]],
          ["Mezo", [["https://mezo.org", "mezo.org"], ["https://explorer.test.mezo.org", "Testnet explorer"], ["https://faucet.test.mezo.org", "Testnet faucet"]]],
        ].map(([h, ls]) => (
          <div key={h as string}>
            <div className="board-label">{h as string}</div>
            <ul className="mt-4 space-y-2.5">{(ls as string[][]).map(([href, l]) => <li key={l}>{href.startsWith("http") ? <a className="text-mute hover:text-paper" href={href} target="_blank" rel="noreferrer">{l}</a> : <Link className="text-mute hover:text-paper" href={href}>{l}</Link>}</li>)}</ul>
          </div>
        ))}
      </div>
      <div className="mx-auto flex max-w-[80rem] flex-wrap justify-between gap-3 border-t border-line px-5 py-6 text-xs text-faint md:px-8">
        <span>Testnet software. Not financial advice.</span>
        <span>Vault {VAULT ? short(VAULT) : "not deployed"} · Apache-2.0</span>
      </div>
    </footer>
  );
}
