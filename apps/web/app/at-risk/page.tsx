"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, CartesianGrid, Cell } from "recharts";
import { fetcher, btc, short } from "@/lib/format";
import { ExplorerLink, PageHead, Skeleton, when, State, Pager, LockLink, StatusPill } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { AssetSwitch } from "@/components/Asset";
import { useAsset, assetCfg, withAsset } from "@/lib/asset";

type R = { expiredCount: number; expiredBtc: string; owners: number; totalLocks: number; upcoming: { end: number; count: number; btc: string }[]; top: { id: string; owner: string; amount: string; ageDays: number }[] };
type Row = { id: string; owner: string; amount: string; end: number; voted: boolean; ageDays: number };
type E = { page: number; pages: number; total: number; totalAmount: string; hiddenOutlier: { id: string; amount: string } | null; rows: Row[]; now: number };
const toBtc = (w: string) => Number(BigInt(w)) / 1e18;
const ageTone = (d: number) => (d < 7 ? "#F2C14E" : d < 28 ? "#F7931A" : d < 90 ? "#D9632A" : "#9C4027");
const AGES: [string, number][] = [["Under 1 week", 3], ["1 to 4 weeks", 10], ["1 to 3 months", 60], ["Over 3 months", 120]];

export default function Explorer() {
  const router = useRouter();
  const [asset, setAsset] = useAsset();
  const A = assetCfg(asset);
  const SYM = A.symbol;
  const summary = useQuery({ queryKey: ["at-risk", asset], queryFn: () => fetcher<R>(`/api/at-risk?asset=${asset}`) });
  const [state, setState] = useState<"expired" | "live">("expired");
  const [sort, setSort] = useState<"amount" | "end" | "id">("amount");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [minBtc, setMin] = useState(0);
  const [outliers, setOut] = useState<"show" | "hide">("hide");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [state, sort, dir, minBtc, outliers, asset]);
  useEffect(() => setMin(0), [asset]);
  const qs = `asset=${asset}&state=${state}&sort=${sort}&dir=${dir}&minBtc=${minBtc}&outliers=${outliers}&page=${page}&size=20`;
  const list = useQuery({ queryKey: ["explore", qs], queryFn: () => fetcher<E>(`/api/explore?${qs}`), placeholderData: keepPreviousData });
  const chart = useQuery({ queryKey: ["explore-chart", asset, state, outliers, minBtc], queryFn: () => fetcher<E>(`/api/explore?asset=${asset}&state=${state}&outliers=${outliers}&minBtc=${minBtc}&size=100`) });

  const s = summary.data;
  const total = s ? toBtc(s.expiredBtc) : 0;
  const top = s?.top[0];
  const outlier = top && total > 0 && toBtc(top.amount) / total > 0.5 ? top : null;
  const rest = total - (outlier ? toBtc(outlier.amount) : 0);
  const pts = useMemo(() => (chart.data?.rows ?? []).map((r) => ({ id: r.id, x: state === "expired" ? Math.max(0.1, r.ageDays) : Math.max(0.1, (r.end - (chart.data?.now ?? 0)) / 86400), y: Math.max(1e-6, toBtc(r.amount)), age: r.ageDays, owner: r.owner })), [chart.data, state]);

  const th = (k: typeof sort, l: string, right = false) => (
    <th aria-sort={sort === k ? (dir === "asc" ? "ascending" : "descending") : "none"} className={right ? "text-right" : ""}>
      <button className={`inline-flex min-h-[36px] items-center gap-1 hover:text-paper ${sort === k ? "text-paper" : ""}`} onClick={() => { if (sort === k) setDir(dir === "asc" ? "desc" : "asc"); else { setSort(k); setDir(k === "amount" ? "desc" : "asc"); } }}>
        {l}<Icon name={sort === k && dir === "asc" ? "sortUp" : "sortDown"} className={`h-3.5 w-3.5 ${sort === k ? "text-btc" : "text-faint"}`} />
      </button>
    </th>
  );

  return (
    <div className="space-y-10">
      <PageHead title="Lock explorer" aside={<AssetSwitch value={asset} onChange={setAsset} />}>Every {A.ve} lock on Mezo testnet that has ended and was never claimed, plus what departs next. BTC and MEZO are counted separately. Click any lock for its timetable.</PageHead>

      <dl className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-panel md:grid-cols-4 [&>div]:px-5 [&>div]:md:px-6">
        {[
          [`${SYM} idle`, s ? <span className={asset === "mezo" ? "text-mezo" : "text-btc"}>{btc(s.expiredBtc, 2)}</span> : null, "In ended, unclaimed locks"],
          ["Ended locks", s?.expiredCount, s && `of ${s.totalLocks} indexed`],
          ["Wallets", s?.owners, "Own at least one"],
          ["Without the outlier", s ? rest.toFixed(2) : null, outlier ? `${SYM} across ${s!.expiredCount - 1} locks` : "No single outlier"],
        ].map(([l, v, sub], i) => (
          <div key={l as string} className={`py-5 ${i % 2 ? "border-l border-line" : ""} ${i > 1 ? "border-t border-line md:border-t-0" : ""} ${i === 2 ? "md:border-l" : ""}`}>
            <dt className="label">{l as string}</dt><dd className="num mt-1.5 text-2xl font-medium md:text-[1.75rem]">{v ?? <Skeleton className="h-7 w-20" />}</dd><dd className="mt-1 text-xs text-faint">{sub as string}</dd>
          </div>
        ))}
      </dl>

      {outlier && (
        <section aria-labelledby="outlier" className="rounded-lg border border-line p-5 md:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="outlier" className="font-display text-xl font-bold uppercase">One lock holds {(toBtc(outlier.amount) / total * 100).toFixed(1)}% of it</h2>
            <span className="text-sm text-mute">{outliers === "hide" ? "Hidden from the chart and table below so it doesn't flatten them." : "Shown in the chart and table."} <button className="link" onClick={() => setOut(outliers === "hide" ? "show" : "hide")}>{outliers === "hide" ? "Include it" : "Hide it"}</button></span>
          </div>
          <div className="mt-4 flex h-9 overflow-hidden rounded-[4px]" role="img" aria-label={`Lock ${outlier.id}: ${btc(outlier.amount, 1)} ${SYM}; all other ended locks: ${rest.toFixed(2)} ${SYM}`}>
            <div className="flex items-center bg-[#9C4027] px-3 font-mono text-xs text-paper" style={{ flex: toBtc(outlier.amount) }}>#{outlier.id} · {btc(outlier.amount, 1)} {SYM}</div>
            <div className="min-w-[8px] bg-btc" style={{ flex: Math.max(rest, total * 0.008) }} />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-mute">
            <span>Lock <LockLink id={outlier.id} asset={asset} /></span><span>Owner <ExplorerLink kind="address" id={outlier.owner} /></span><span>Idle for <span className="num text-paper">{outlier.ageDays} days</span></span>
          </div>
        </section>
      )}

      <section aria-labelledby="filters" className="space-y-5">
        <h2 id="filters" className="sr-only">Filters</h2>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <div role="radiogroup" aria-label="Lock state" className="inline-flex rounded-[4px] border border-line p-0.5">
            {(["expired", "live"] as const).map((v) => <button key={v} role="radio" aria-checked={state === v} onClick={() => { setState(v); if (v === "live") setSort("end"), setDir("asc"); else setSort("amount"), setDir("desc"); }} className={`min-h-[36px] rounded-[3px] px-3.5 text-sm ${state === v ? "bg-raised text-paper" : "text-mute hover:text-paper"}`}>{v === "expired" ? "Ended, unclaimed" : "Still locked"}</button>)}
          </div>
          <label className="text-sm"><span className="label mb-1.5 block">Minimum size</span>
            <select value={minBtc} onChange={(e) => setMin(+e.target.value)} className="field h-10 min-h-[40px] w-40">
              {(asset === "mezo" ? [0, 1, 100, 1000, 10000] : [0, 0.001, 0.01, 0.1, 1]).map((v) => <option key={v} value={v}>{v ? `${v.toLocaleString()} ${SYM} or more` : "Any size"}</option>)}
            </select>
          </label>
          {state === "expired" && <label className="flex min-h-[40px] cursor-pointer items-center gap-2.5 text-sm"><input type="checkbox" checked={outliers === "hide"} onChange={(e) => setOut(e.target.checked ? "hide" : "show")} className="h-4 w-4 accent-btc" />Hide the outlier</label>}
          <span className="ml-auto text-sm text-mute" aria-live="polite">{list.data ? <><span className="num text-paper">{list.data.total}</span> locks · <span className="num text-paper">{btc(list.data.totalAmount, 3)}</span> {SYM}</> : null}</span>
        </div>

        <div className="rounded-lg border border-line bg-panel p-4 md:p-6">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="font-display text-lg font-bold uppercase">{state === "expired" ? "Size against time idle" : "Size against time to departure"}</h3>
            {state === "expired" && <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-mute">{AGES.map(([l, d]) => <li key={l} className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ background: ageTone(d) }} />{l}</li>)}</ul>}
          </div>
          <div className="h-[300px] md:h-[360px]" role="img" aria-label={`Chart of ${pts.length} locks; each dot is a lock. The table below lists the same data.`}>
            {chart.isLoading ? <div className="skeleton h-full w-full" /> : pts.length === 0 ? <div className="grid h-full place-items-center text-sm text-mute">No locks match these filters.</div> : (
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 8, right: 12, bottom: 24, left: 4 }}>
                  <CartesianGrid stroke="#1E2226" />
                  <XAxis type="number" dataKey="x" scale="log" domain={["auto", "auto"]} tick={{ fill: "#82888C", fontSize: 11, fontFamily: "var(--font-mono)" }} stroke="#2C3238" tickFormatter={(v) => `${Math.round(v)}d`} label={{ value: state === "expired" ? "Days idle (log)" : "Days to departure (log)", position: "insideBottom", offset: -14, fill: "#82888C", fontSize: 11 }} />
                  <YAxis type="number" dataKey="y" scale="log" domain={["auto", "auto"]} tick={{ fill: "#82888C", fontSize: 11, fontFamily: "var(--font-mono)" }} stroke="#2C3238" width={52} tickFormatter={(v) => (v >= 1 ? v.toFixed(0) : v.toPrecision(1))} />
                  <ZAxis range={[40, 40]} />
                  <Tooltip cursor={{ stroke: "#2C3238" }} content={({ payload }) => {
                    const p = payload?.[0]?.payload as (typeof pts)[number] | undefined;
                    return p ? <div className="rounded border border-line bg-raised px-3 py-2 text-xs shadow-pop"><div className="num text-paper">#{p.id} · {p.y.toFixed(p.y < 1 ? 4 : 2)} {SYM}</div><div className="mt-0.5 text-mute">{state === "expired" ? `Idle ${p.age} days` : `Departs in ${Math.ceil(p.x)} days`} · {short(p.owner)}</div><div className="mt-1 text-faint">Click to open</div></div> : null;
                  }} />
                  <Scatter data={pts} onClick={(p: { id?: string; payload?: { id: string } }) => router.push(withAsset(`/lock/${p.payload?.id ?? p.id}`, asset))} className="cursor-pointer">
                    {pts.map((p) => <Cell key={p.id} fill={state === "expired" ? ageTone(p.age) : "#62C68E"} fillOpacity={0.85} stroke="#0E1012" />)}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            )}
          </div>
          {chart.data && chart.data.total > 100 && <p className="mt-2 text-xs text-faint">Chart shows the 100 largest of {chart.data.total}. The table pages through all of them.</p>}
        </div>

        {list.isError ? <State tone="error" title="Couldn't load locks" action={<button className="btn-ghost" onClick={() => list.refetch()}>Try again</button>}>{(list.error as Error).message}</State> : (
          <div className={`transition-opacity ${list.isPlaceholderData ? "opacity-60" : ""}`}>
            <div className="relative overflow-x-auto">
              <table className="tbl w-full sm:min-w-[40rem]">
                <caption className="sr-only">Locks, sortable</caption>
                <thead><tr>{th("id", "Lock")}<th className="hidden sm:table-cell">Owner</th>{th("amount", SYM, true)}{th("end", state === "expired" ? "Ended" : "Departs", true)}<th className="hidden text-right sm:table-cell">Status</th></tr></thead>
                <tbody>
                  {list.data?.rows.map((l) => (
                    <tr key={l.id}>
                      <td><LockLink id={l.id} asset={asset} /></td>
                      <td className="hidden sm:table-cell"><ExplorerLink kind="address" id={l.owner}>{short(l.owner)}</ExplorerLink></td>
                      <td className="num whitespace-nowrap text-right">{btc(l.amount, A.decimals)}</td>
                      <td className="num text-right text-mute">{state === "expired" ? `${l.ageDays} d ago` : when(l.end)}</td>
                      <td className="hidden text-right sm:table-cell">{l.voted ? <StatusPill status="voted" /> : <StatusPill status={state === "expired" ? "expired" : "active"} />}</td>
                    </tr>
                  ))}
                  {!list.data && Array.from({ length: 8 }, (_, i) => <tr key={i}><td colSpan={5}><Skeleton className="h-4 w-full" /></td></tr>)}
                </tbody>
              </table>
            </div>
            {list.data?.rows.length === 0 && <div className="mt-4"><State title="No locks match" action={<button className="btn-ghost" onClick={() => { setMin(0); setOut("show"); }}>Clear filters</button>}>Try a smaller minimum size.</State></div>}
            {list.data && <Pager page={list.data.page} pages={list.data.pages} onPage={setPage} />}
          </div>
        )}
      </section>

      <section aria-labelledby="up">
        <h2 id="up" className="font-display text-2xl font-bold uppercase">Departing next</h2>
        <ul className="mt-4 border-t border-line">
          {(s?.upcoming ?? []).slice(0, 5).map((u) => (
            <li key={u.end} className="flex items-baseline justify-between gap-4 border-b border-hair py-3.5 text-sm"><span className="num">{when(u.end)}</span><span className="num text-mute">{u.count} lock{u.count > 1 ? "s" : ""} · <span className="text-paper">{btc(u.btc)} {SYM}</span></span></li>
          ))}
          {s && s.upcoming.length === 0 && <li className="py-4 text-sm text-mute">No live locks depart in the next 30 days.</li>}
          {!s && <li className="py-4"><Skeleton className="h-4 w-full" /></li>}
        </ul>
        <p className="mt-4 text-sm text-mute">Own one of these? <Link className="link" href="/dashboard">Protect it before it departs</Link>.</p>
      </section>
    </div>
  );
}
