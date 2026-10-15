"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { fetcher, btc, usd, pct, short } from "@/lib/format";
import { StatusPill, ExplorerLink, PageHead, Skeleton, State } from "@/components/ui";
import { Icon } from "@/components/Icon";

type Row = { owner: string; coll: string; debt: string; icr: string; rank: number; musd_ahead: string; redeemable: boolean };
type Mine = { price: string; trove: (Row & { risk: string }) | null; total: number; simulate: { amount: string; hit: string } | null; suggest: { passTroves: number; addColl: string; repay: string } | null };
const n18 = (w: string | bigint) => Number(BigInt(w)) / 1e18;
const tone = (icr: string) => (BigInt(icr) < 12n * 10n ** 17n ? "bg-bad" : BigInt(icr) < 13n * 10n ** 17n ? "bg-signal" : "bg-[#3A4148]");

export default function Radar() {
  const { address } = useAccount();
  const [input, setInput] = useState("");
  const [lookup, setLookup] = useState("");
  const [sim, setSim] = useState(25000);
  const [focus, setFocus] = useState<Row | null>(null);
  useEffect(() => { const a = new URLSearchParams(window.location.search).get("address"); if (a) { setInput(a); setLookup(a); } }, []);
  const valid = /^0x[0-9a-fA-F]{40}$/.test(lookup);
  const who = (valid ? lookup : address) ?? "";
  const mine = useQuery({ queryKey: ["radar", who, sim], enabled: !!who, queryFn: () => fetcher<Mine>(`/api/radar/${who}?simulate=${sim}`), placeholderData: keepPreviousData });
  const line = useQuery({ queryKey: ["line"], queryFn: () => fetcher<{ price: string; line: Row[] }>("/api/radar/line?limit=60") });
  const t = mine.data?.trove;
  const rows = line.data?.line ?? [];
  const redeemable = rows.filter((r) => r.redeemable);
  const lineTotal = redeemable.reduce((s, r) => s + n18(r.debt), 0);
  const hit = mine.data?.simulate && BigInt(mine.data.simulate.hit) > 0n;
  const me = (r: Row) => !!who && r.owner === who.toLowerCase();
  const meIn = redeemable.some(me);
  const f = focus ?? (t && meIn ? redeemable.find(me) ?? null : null);

  return (
    <div className="space-y-10">
      <PageHead title="Redemption Radar">MUSD redemptions are paid from the loans with the lowest collateral ratio first, healthy ones included. Find any loan&rsquo;s place in that line and what moves it back.</PageHead>

      <form className="flex max-w-xl flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setLookup(input.trim()); }} role="search">
        <label htmlFor="borrower" className="sr-only">Borrower address</label>
        <input id="borrower" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} autoComplete="off" placeholder={address ? `Your wallet ${short(address)}, or any 0x address` : "Borrower address, 0x…"} className="field num min-w-0 flex-1" aria-invalid={!!lookup && !valid} />
        <button className="btn-primary">Look up</button>
        {lookup && !valid && <p className="w-full text-sm text-signal" role="status">That isn&rsquo;t a full address. It should be 0x followed by 40 characters.</p>}
      </form>

      {!who ? <State title="Look up a loan">Connect your wallet or paste a borrower address. The live line below works without either.</State>
        : mine.isError ? <State tone="error" title="Couldn't load this loan" action={<button className="btn-ghost" onClick={() => mine.refetch()}>Try again</button>}>{(mine.error as Error).message}</State>
        : mine.isLoading ? <div className="space-y-3"><Skeleton className="h-12 w-3/4" /><Skeleton className="h-4 w-1/2" /></div>
        : !t ? <State title="No open MUSD loan" action={<a className="btn-ghost" href="https://mezo.org" target="_blank" rel="noreferrer">Borrow on Mezo<Icon name="external" className="h-3.5 w-3.5" /></a>}><span className="num text-paper">{short(who)}</span> has no trove on Mezo testnet.</State>
        : (
          <section aria-labelledby="headline" className="overflow-hidden rounded-lg border border-line bg-panel">
            <div className="border-b border-line p-5 md:p-7">
              <h2 id="headline" className="font-display text-[2.2rem] font-extrabold uppercase leading-[0.95] md:text-[3.2rem]">
                {t.redeemable ? <>Safe until <span className="num font-sans text-[0.85em] font-medium normal-case text-btc">{usd(t.musd_ahead)}</span> MUSD is redeemed</> : <>Below the liquidation line</>}
              </h2>
              <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-mute">
                {t.redeemable && <>Loan <span className="num text-paper">#{t.rank}</span> of {mine.data!.total} in line ·</>} Ratio <span className="num text-paper">{pct(t.icr)}</span> · {btc(t.coll)} BTC against {usd(t.debt)} MUSD <StatusPill status={t.risk} />
              </p>
            </div>
            <div className="grid divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
              <div className="p-5 md:p-7">
                <h3 className="font-display text-lg font-bold uppercase">If someone redeems</h3>
                <label htmlFor="sim" className="num mt-3 block text-2xl">{sim.toLocaleString()} MUSD</label>
                <input id="sim" type="range" min={1000} max={200000} step={1000} value={sim} onChange={(e) => setSim(+e.target.value)} className="mt-2" />
                <p className={`mt-2 text-sm ${hit ? "text-bad" : "text-ok"}`} role="status">{hit ? `${usd(mine.data!.simulate!.hit)} MUSD of this debt would be repaid with its BTC.` : "It stops before this loan. Nothing is taken."}</p>
              </div>
              <div className="p-5 md:p-7">
                <h3 className="font-display text-lg font-bold uppercase">Move back in line</h3>
                {mine.data?.suggest ? <>
                  <p className="mt-3 text-sm text-mute">To get behind the next {mine.data.suggest.passTroves} loans, either:</p>
                  <dl className="mt-3 grid grid-cols-2 divide-x divide-line rounded-md border border-line">
                    <div className="p-3"><dt className="text-xs text-mute">Add collateral</dt><dd className="num mt-1 text-xl text-btc">+{btc(mine.data.suggest.addColl)} BTC</dd></div>
                    <div className="p-3"><dt className="text-xs text-mute">Or repay</dt><dd className="num mt-1 text-xl text-btc">{usd(mine.data.suggest.repay)} MUSD</dd></div>
                  </dl>
                </> : <p className="mt-3 text-sm text-mute">Already near the back of the line.</p>}
                <Link href="/alerts" className="link mt-4 inline-flex min-h-[44px] items-center gap-1.5 text-sm"><Icon name="bell" />Alert me before a redemption reaches it</Link>
              </div>
            </div>
          </section>
        )}

      <section aria-labelledby="queue">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="queue" className="font-display text-2xl font-bold uppercase">The line right now</h2>
          <span className="num text-xs text-mute">BTC ${line.data ? usd(line.data.price) : "…"} · first {redeemable.length} loans · redeemed left to right</span>
        </div>
        <div className="mt-5 rounded-lg border border-line bg-panel p-4 md:p-6">
          <div className="relative">
            <div className="flex h-16 gap-[2px]" role="list" aria-label={`Redemption queue: ${redeemable.length} loans, ${Math.round(lineTotal).toLocaleString()} MUSD`}>
              {line.isLoading && <div className="skeleton h-full w-full" />}
              {redeemable.map((r) => (
                <button key={r.owner} role="listitem" onMouseEnter={() => setFocus(r)} onFocus={() => setFocus(r)} onClick={() => setFocus(r)}
                  aria-label={`Loan ${r.rank}, ${usd(r.debt)} MUSD at ${pct(r.icr)}${me(r) ? ", this loan" : ""}`}
                  className={`h-full min-w-[3px] rounded-[2px] transition-[filter,transform] hover:brightness-125 focus-visible:z-10 ${me(r) ? "bg-btc" : tone(r.icr)} ${f?.owner === r.owner ? "ring-2 ring-paper ring-offset-2 ring-offset-panel" : ""}`}
                  style={{ flex: n18(r.debt) }} />
              ))}
            </div>
            {lineTotal > 0 && <div className="pointer-events-none absolute inset-y-[-6px] left-0 border-r-2 border-dashed border-paper/80 bg-paper/[0.06]" style={{ width: `${Math.min(100, (sim / lineTotal) * 100)}%` }} aria-hidden="true" />}
          </div>
          <div className="mt-2 flex justify-between font-mono text-xs text-faint"><span>0 MUSD · redeemed first</span><span>{Math.round(lineTotal).toLocaleString()} MUSD</span></div>
          <div className="mt-5 grid gap-4 border-t border-line pt-4 md:grid-cols-[1fr_auto] md:items-center">
            <div className="min-h-[44px] text-sm" aria-live="polite">
              {f ? <span className="flex flex-wrap items-center gap-x-4 gap-y-1"><span className="num text-paper">#{f.rank}</span><ExplorerLink kind="address" id={f.owner} /><span className="num">{usd(f.debt)} MUSD</span><span className="num">{pct(f.icr)}</span><span className="text-mute"><span className="num text-paper">{usd(f.musd_ahead)}</span> MUSD ahead</span>{me(f) && <span className="pill text-btc">This loan</span>}</span>
                : <span className="text-mute">Hover or tab through the line to inspect a loan.</span>}
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-mute">
              <li className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[2px] bg-bad" />Under 120%</li>
              <li className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[2px] bg-signal" />120 to 130%</li>
              <li className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[2px] bg-[#3A4148]" />Above 130%</li>
              {t && <li className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[2px] bg-btc" />{meIn ? "This loan" : `This loan, #${t.rank}, past the first ${redeemable.length}`}</li>}
              <li className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 border border-dashed border-paper" />{sim.toLocaleString()} MUSD redeemed</li>
            </ul>
          </div>
        </div>

        <div className="relative mt-8 overflow-x-auto">
          <table className="tbl min-w-[36rem]">
            <caption className="sr-only">Redemption line, lowest collateral ratio first</caption>
            <thead><tr><th>#</th><th>Borrower</th><th className="text-right">Debt (MUSD)</th><th className="text-right">Ratio</th><th className="text-right">MUSD ahead</th></tr></thead>
            <tbody>
              {rows.slice(0, 25).map((r) => (
                <tr key={r.owner} className={me(r) ? "bg-btc/[0.08]" : ""}>
                  <td className="num text-mute">{r.redeemable ? r.rank : <span className="text-bad">liq</span>}</td>
                  <td><ExplorerLink kind="address" id={r.owner}>{short(r.owner)}</ExplorerLink></td>
                  <td className="num text-right">{usd(r.debt)}</td>
                  <td className={`num text-right ${BigInt(r.icr) < 12n * 10n ** 17n ? "text-bad" : ""}`}>{pct(r.icr)}</td>
                  <td className="num text-right text-mute">{usd(r.musd_ahead)}</td>
                </tr>
              ))}
              {line.isLoading && Array.from({ length: 6 }, (_, i) => <tr key={i}><td colSpan={5}><Skeleton className="h-4 w-full" /></td></tr>)}
            </tbody>
          </table>
          {line.data && rows.length === 0 && <div className="mt-4"><State title="No open loans indexed">The Radar worker hasn't recorded any troves on this network yet.</State></div>}
        </div>
      </section>
    </div>
  );
}
