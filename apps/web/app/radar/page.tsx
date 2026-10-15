"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { fetcher, btc, usd, pct, short } from "@/lib/format";
import { Stat, StatusPill, ExplorerLink } from "@/components/ui";

type Row = { owner: string; coll: string; debt: string; icr: string; rank: number; musd_ahead: string; redeemable: boolean };
type Mine = { price: string; trove: (Row & { risk: string }) | null; total: number; simulate: { amount: string; hit: string } | null; suggest: { passTroves: number; addColl: string; repay: string } | null };

export default function Radar() {
  const { address } = useAccount();
  const [lookup, setLookup] = useState("");
  const [sim, setSim] = useState(25000);
  useEffect(() => { const a = new URLSearchParams(window.location.search).get("address"); if (a) setLookup(a); }, []);
  const who = (/^0x[0-9a-fA-F]{40}$/.test(lookup) ? lookup : address) ?? "";
  const mine = useQuery({ queryKey: ["radar", who, sim], enabled: !!who, queryFn: () => fetcher<Mine>(`/api/radar/${who}?simulate=${sim}`) });
  const line = useQuery({ queryKey: ["line"], queryFn: () => fetcher<{ price: string; line: Row[] }>("/api/radar/line?limit=40") });
  const t = mine.data?.trove;
  const rows = line.data?.line ?? [];
  const maxDebt = rows.reduce((m, r) => (BigInt(r.debt) > m ? BigInt(r.debt) : m), 1n);
  return (
    <div className="space-y-6">
      <div>
        <div className="pill bg-btc/10 text-btc">Borrower-side</div>
        <h1 className="mt-2 text-3xl font-bold">Redemption Radar</h1>
        <p className="max-w-2xl text-sm text-mute">When someone redeems MUSD, Mezo takes BTC from the loans with the lowest collateral ratio first — even healthy ones. Radar tells you where your loan stands in that line and how to move back.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input value={lookup} onChange={(e) => setLookup(e.target.value.trim())} placeholder={address ? `Your wallet ${short(address)} — or paste any address` : "Paste a borrower address"} className="w-full max-w-md rounded-xl border border-line bg-panel px-4 py-2.5 text-sm outline-none focus:border-btc" />
      </div>
      {!who ? <div className="card text-sm text-mute">Connect a wallet or paste an address to see a loan.</div> : !t ? (
        <div className="card text-sm text-mute">{mine.isLoading ? "Loading…" : "No open MUSD loan for this address."}</div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Stat label="Place in line" value={t.redeemable ? `#${t.rank}` : "—"} sub={`of ${mine.data!.total} redeemable loans`} accent />
            <Stat label="MUSD ahead of you" value={usd(t.musd_ahead)} sub="redemptions must exceed this to reach you" />
            <Stat label="Collateral ratio" value={pct(t.icr)} sub={`${btc(t.coll)} BTC vs ${usd(t.debt)} MUSD`} />
            <div className="card"><div className="text-xs uppercase tracking-wider text-mute">Risk</div><div className="mt-3"><StatusPill status={t.risk} /></div><Link href="/alerts" className="mt-3 block text-xs text-btc">Alert me before I'm hit →</Link></div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="card space-y-3">
              <h2 className="font-semibold">What if someone redeems…</h2>
              <input type="range" min={1000} max={200000} step={1000} value={sim} onChange={(e) => setSim(+e.target.value)} className="w-full accent-btc" />
              <div className="num text-2xl">{sim.toLocaleString()} MUSD</div>
              <div className={`text-sm ${mine.data?.simulate && BigInt(mine.data.simulate.hit) > 0n ? "text-bad" : "text-ok"}`}>
                {mine.data?.simulate && BigInt(mine.data.simulate.hit) > 0n ? `→ ${usd(mine.data.simulate.hit)} MUSD of your debt would be repaid with your BTC.` : "→ It stops before your loan. You're untouched."}
              </div>
            </div>
            <div className="card space-y-3">
              <h2 className="font-semibold">Move back in line</h2>
              {mine.data?.suggest ? (
                <>
                  <p className="text-sm text-mute">To get behind the next {mine.data.suggest.passTroves} loans:</p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl bg-black/30 p-3">Add collateral<div className="num text-xl text-btc">+{btc(mine.data.suggest.addColl)} BTC</div></div>
                    <div className="rounded-xl bg-black/30 p-3">or repay<div className="num text-xl text-btc">{usd(mine.data.suggest.repay)} MUSD</div></div>
                  </div>
                </>
              ) : <p className="text-sm text-mute">You're already near the back of the line.</p>}
            </div>
          </div>
        </>
      )}
      <div className="card overflow-x-auto">
        <div className="mb-3 flex items-baseline justify-between"><h2 className="font-semibold">The line right now</h2><span className="text-xs text-mute">BTC ${usd(line.data?.price ?? "0")} · first to be redeemed at top</span></div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-mute"><tr><th className="py-2">#</th><th>Borrower</th><th>Debt</th><th className="text-right">ICR</th><th className="text-right">MUSD ahead</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.owner} className={`border-t border-line ${who && r.owner === who.toLowerCase() ? "bg-btc/10" : ""}`}>
                <td className="py-2">{r.redeemable ? r.rank : <span className="text-bad">liq</span>}</td>
                <td><ExplorerLink kind="address" id={r.owner}>{short(r.owner)}</ExplorerLink></td>
                <td className="w-1/3"><div className="flex items-center gap-2"><div className="h-1.5 rounded-full bg-btc/70" style={{ width: `${Math.max(2, Number((BigInt(r.debt) * 100n) / maxDebt))}%` }} /><span className="num text-xs text-mute">{usd(r.debt)}</span></div></td>
                <td className={`num text-right ${BigInt(r.icr) < 12n * 10n ** 17n ? "text-bad" : ""}`}>{pct(r.icr)}</td>
                <td className="num text-right text-mute">{usd(r.musd_ahead)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
