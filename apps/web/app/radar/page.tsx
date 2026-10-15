"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { fetcher, btc, usd, pct, short } from "@/lib/format";
import { StatusPill, ExplorerLink, PageHead, Skeleton } from "@/components/ui";
import { Icon } from "@/components/Icon";

type Row = { owner: string; coll: string; debt: string; icr: string; rank: number; musd_ahead: string; redeemable: boolean };
type Mine = { price: string; trove: (Row & { risk: string }) | null; total: number; simulate: { amount: string; hit: string } | null; suggest: { passTroves: number; addColl: string; repay: string } | null };

const n18 = (w: string | bigint) => Number(BigInt(w)) / 1e18;
const icrTone = (icr: string) => (BigInt(icr) < 12n * 10n ** 17n ? "#EE6A5F" : BigInt(icr) < 13n * 10n ** 17n ? "#E9B44C" : "#6F695E");

export default function Radar() {
  const { address } = useAccount();
  const [lookup, setLookup] = useState("");
  const [sim, setSim] = useState(25000);
  useEffect(() => { const a = new URLSearchParams(window.location.search).get("address"); if (a) setLookup(a); }, []);
  const who = (/^0x[0-9a-fA-F]{40}$/.test(lookup) ? lookup : address) ?? "";
  const mine = useQuery({ queryKey: ["radar", who, sim], enabled: !!who, queryFn: () => fetcher<Mine>(`/api/radar/${who}?simulate=${sim}`), placeholderData: (p) => p });
  const line = useQuery({ queryKey: ["line"], queryFn: () => fetcher<{ price: string; line: Row[] }>("/api/radar/line?limit=40") });
  const t = mine.data?.trove;
  const rows = line.data?.line ?? [];
  const redeemable = rows.filter((r) => r.redeemable);
  const lineTotal = redeemable.reduce((s, r) => s + n18(r.debt), 0);
  const hit = mine.data?.simulate && BigInt(mine.data.simulate.hit) > 0n;
  const meIn = !!who && redeemable.some((r) => r.owner === who.toLowerCase());

  return (
    <div className="space-y-12">
      <PageHead title="Redemption Radar">When someone redeems MUSD, Mezo takes BTC from the loans with the lowest collateral ratio first, even healthy ones. Radar shows where a loan stands in that line and how to move back.</PageHead>

      <label className="block max-w-md">
        <span className="label">Borrower</span>
        <input value={lookup} onChange={(e) => setLookup(e.target.value.trim())} spellCheck={false} autoComplete="off"
          placeholder={address ? `Your wallet ${short(address)}, or paste any address` : "Paste a borrower address (0x…)"} className="field num mt-2" />
      </label>

      {who && (mine.isLoading ? (
        <div className="space-y-3"><Skeleton className="h-10 w-3/4" /><Skeleton className="h-4 w-1/2" /></div>
      ) : !t ? (
        <p className="text-sm text-mute">No open MUSD loan for <span className="num text-paper">{short(who)}</span>.</p>
      ) : (
        <section className="space-y-8" aria-labelledby="headline">
          <div>
            <h2 id="headline" className="text-3xl font-semibold leading-tight tracking-[-0.03em] md:text-5xl" style={{ fontStretch: "110%" }}>
              {t.redeemable ? <>Safe until <span className="num text-btc">{usd(t.musd_ahead)}</span> MUSD is redeemed.</> : <>This loan is below the liquidation line.</>}
            </h2>
            <p className="mt-3 text-sm text-mute">
              {t.redeemable ? <>Loan <span className="num text-paper">#{t.rank}</span> of {mine.data!.total} in the redemption line. </> : null}
              Collateral ratio <span className="num text-paper">{pct(t.icr)}</span> · {btc(t.coll)} BTC against {usd(t.debt)} MUSD · <StatusPill status={t.risk} />
            </p>
          </div>
          <div className="grid gap-10 md:grid-cols-2">
            <div>
              <h3 className="font-semibold">If someone redeems</h3>
              <div className="num mt-3 text-2xl">{sim.toLocaleString()} MUSD</div>
              <input type="range" min={1000} max={200000} step={1000} value={sim} onChange={(e) => setSim(+e.target.value)} className="mt-2" aria-label="Simulated redemption in MUSD" />
              <p className={`mt-2 text-sm ${hit ? "text-bad" : "text-ok"}`} role="status">
                {hit ? `${usd(mine.data!.simulate!.hit)} MUSD of this debt would be repaid with its BTC.` : "It stops before this loan. Nothing is taken."}
              </p>
            </div>
            <div>
              <h3 className="font-semibold">Move back in line</h3>
              {mine.data?.suggest ? (
                <>
                  <p className="mt-3 text-sm text-mute">To get behind the next {mine.data.suggest.passTroves} loans, either:</p>
                  <dl className="mt-3 grid grid-cols-2 divide-x divide-line border-y border-line">
                    <div className="py-3 pr-4"><dt className="text-xs text-mute">Add collateral</dt><dd className="num mt-1 text-xl text-btc">+{btc(mine.data.suggest.addColl)} BTC</dd></div>
                    <div className="py-3 pl-4"><dt className="text-xs text-mute">Or repay</dt><dd className="num mt-1 text-xl text-btc">{usd(mine.data.suggest.repay)} MUSD</dd></div>
                  </dl>
                </>
              ) : <p className="mt-3 text-sm text-mute">Already near the back of the line.</p>}
              <Link href="/alerts" className="link mt-4 inline-flex min-h-[44px] items-center gap-1.5 text-sm"><Icon name="bell" />Alert me before a redemption reaches it</Link>
            </div>
          </div>
        </section>
      ))}

      <section aria-labelledby="queue">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="queue" className="text-xl font-semibold tracking-tight">The line right now</h2>
          <span className="num text-xs text-mute">BTC ${line.data ? usd(line.data.price) : "…"} · first {redeemable.length} loans, redeemed left to right</span>
        </div>
        {/* Visual queue: each segment is a loan, width = its debt. */}
        <div className="mt-5">
          <div className="relative">
          <div className="flex h-12 gap-px overflow-hidden rounded-[4px] bg-base" role="img" aria-label={`Redemption queue of ${redeemable.length} loans, ${Math.round(lineTotal).toLocaleString()} MUSD in total`}>
            {redeemable.length === 0 && <div className="skeleton h-full w-full" />}
            {redeemable.map((r) => {
              const me = who && r.owner === who.toLowerCase();
              return <div key={r.owner} title={`#${r.rank} ${short(r.owner)} · ${usd(r.debt)} MUSD · ${pct(r.icr)}`} className={me ? "relative bg-btc" : ""} style={{ flex: n18(r.debt), background: me ? undefined : icrTone(r.icr), opacity: me ? 1 : 0.75 }} />;
            })}
          </div>
          {lineTotal > 0 && (
            <div className="pointer-events-none absolute inset-y-0 left-0 border-r-2 border-dashed border-paper bg-paper/10" style={{ width: `${Math.min(100, (sim / lineTotal) * 100)}%` }} aria-hidden="true" />
          )}
          </div>
          <div className="mt-2 flex justify-between font-mono text-2xs text-faint"><span>0 MUSD · redeemed first</span><span>{Math.round(lineTotal).toLocaleString()} MUSD</span></div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-2xs text-mute">
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5" style={{ background: "#EE6A5F" }} />ratio under 120%</span>
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5" style={{ background: "#E9B44C" }} />120–130%</span>
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5" style={{ background: "#6F695E" }} />above 130%</span>
            {t && <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 bg-btc" />{meIn ? "this loan" : `this loan is #${t.rank}, past the first ${redeemable.length}`}</span>}
            <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 border border-dashed border-paper" />simulated {sim.toLocaleString()} MUSD</span>
          </div>
        </div>

        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b border-line text-left"><th className="label py-2.5 font-medium">#</th><th className="label font-medium">Borrower</th><th className="label font-medium">Debt (MUSD)</th><th className="label text-right font-medium">Ratio</th><th className="label text-right font-medium">MUSD ahead</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.owner} className={`border-b border-hair ${who && r.owner === who.toLowerCase() ? "bg-btc/[0.08]" : "hover:bg-panel"}`}>
                  <td className="num py-2.5 text-mute">{r.redeemable ? r.rank : <span className="text-bad">liq</span>}</td>
                  <td><ExplorerLink kind="address" id={r.owner}>{short(r.owner)}</ExplorerLink></td>
                  <td className="num">{usd(r.debt)}</td>
                  <td className="num text-right" style={{ color: BigInt(r.icr) < 12n * 10n ** 17n ? "#EE6A5F" : undefined }}>{pct(r.icr)}</td>
                  <td className="num text-right text-mute">{usd(r.musd_ahead)}</td>
                </tr>
              ))}
              {line.isLoading && Array.from({ length: 6 }, (_, i) => <tr key={i} className="border-b border-hair"><td colSpan={5} className="py-3"><Skeleton className="h-4 w-full" /></td></tr>)}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
