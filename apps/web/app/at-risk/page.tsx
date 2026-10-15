"use client";
import { useQuery } from "@tanstack/react-query";
import { ResponsiveContainer, Treemap } from "recharts";
import { fetcher, btc, short } from "@/lib/format";
import { ExplorerLink, PageHead, Skeleton, when } from "@/components/ui";
import { ADDR } from "@/lib/env";

type R = { expiredCount: number; expiredBtc: string; owners: number; totalLocks: number; buckets: { label: string; count: number; btc: string }[]; upcoming: { end: number; count: number; btc: string }[]; top: { id: string; owner: string; amount: string; ageDays: number }[] };

const ageColor = (d: number) => (d < 7 ? "#E9B44C" : d < 30 ? "#F7931A" : d < 90 ? "#D9632A" : "#A8432A");
const AGES: [string, number][] = [["under 1 week", 3], ["under 1 month", 10], ["under 3 months", 60], ["over 3 months", 120]];
const toBtc = (w: string) => Number(BigInt(w)) / 1e18;
const OUTLIER_SHARE = 0.5; // a lock holding more than half the total is shown on its own

function Cell(props: { x?: number; y?: number; width?: number; height?: number; name?: string; ageDays?: number; amountBtc?: number }) {
  const { x = 0, y = 0, width = 0, height = 0, name, ageDays = 0, amountBtc = 0 } = props;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={ageColor(ageDays)} fillOpacity={0.9} stroke="#151411" strokeWidth={2} />
      {width > 58 && height > 36 && (
        <>
          <text x={x + 8} y={y + 18} fill="#0D0C0A" fontSize={12} fontWeight={600} fontFamily="var(--font-mono)">#{name}</text>
          <text x={x + 8} y={y + 32} fill="#0D0C0A" fontSize={11} fontFamily="var(--font-mono)">{amountBtc.toFixed(amountBtc < 1 ? 3 : 1)}</text>
        </>
      )}
    </g>
  );
}

const LockLink = ({ id }: { id: string }) => <ExplorerLink kind="token" id={`${ADDR.veBTC}/instance/${id}`}>#{id}</ExplorerLink>;

export default function AtRisk() {
  const { data } = useQuery({ queryKey: ["at-risk"], queryFn: () => fetcher<R>("/api/at-risk") });
  const total = data ? toBtc(data.expiredBtc) : 0;
  const first = data?.top[0];
  const outlier = first && total > 0 && toBtc(first.amount) / total > OUTLIER_SHARE ? first : null;
  const rest = (data?.top ?? []).filter((l) => l !== outlier);
  const restBtc = total - (outlier ? toBtc(outlier.amount) : 0);
  const tree = rest.map((l) => ({ name: l.id, size: Math.sqrt(toBtc(l.amount)), amountBtc: toBtc(l.amount), ageDays: l.ageDays }));
  const upcoming = (data?.upcoming ?? []).slice(0, 4);

  const figures: [string, React.ReactNode, React.ReactNode?][] = [
    ["BTC unclaimed", data ? <span className="text-btc">{btc(data.expiredBtc, 2)}</span> : null],
    ["Expired locks", data?.expiredCount, data && `of ${data.totalLocks} indexed`],
    ["Wallets", data?.owners],
    ["Without the outlier", outlier ? restBtc.toFixed(2) : data ? btc(data.expiredBtc, 2) : null, outlier && `BTC across ${data!.expiredCount - 1} locks`],
  ];

  return (
    <div className="space-y-12">
      <PageHead title="BTC at risk on Mezo">Every veBTC lock that has expired and was never claimed. Unclaimed locks are what the Oct 5 attacker drained.</PageHead>

      <dl className="grid grid-cols-2 border-b border-line md:grid-cols-4">
        {figures.map(([l, v, sub], i) => (
          <div key={l} className={`py-5 ${i % 2 ? "pl-5" : "pr-5"} ${i < 2 ? "max-md:border-b max-md:border-line" : ""} md:px-6 md:first:pl-0 ${i ? "md:border-l md:border-line" : ""} ${i % 2 ? "border-l border-line" : ""}`}>
            <dt className="label">{l}</dt>
            <dd className="num mt-2 text-2xl font-medium md:text-3xl">{v ?? <Skeleton className="h-7 w-20" />}</dd>
            {sub && <dd className="mt-1 text-xs text-faint">{sub}</dd>}
          </div>
        ))}
      </dl>

      {outlier && (
        <section aria-labelledby="outlier">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="outlier" className="text-xl font-semibold tracking-tight">One lock holds {(toBtc(outlier.amount) / total * 100).toFixed(1)}% of it</h2>
            <span className="text-xs text-mute">Shown on its own so it doesn&rsquo;t hide the other {data!.expiredCount - 1}.</span>
          </div>
          <div className="mt-4 flex h-10 overflow-hidden rounded-[4px]" role="img" aria-label={`Lock ${outlier.id}: ${btc(outlier.amount, 1)} BTC; all other expired locks: ${restBtc.toFixed(2)} BTC`}>
            <div className="flex items-center bg-[#A8432A] px-3 font-mono text-xs text-base" style={{ flex: toBtc(outlier.amount) }}>#{outlier.id} · {btc(outlier.amount, 1)} BTC</div>
            <div className="min-w-[6px] bg-btc" style={{ flex: Math.max(restBtc, total * 0.006) }} />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-mute">
            <span>Lock <LockLink id={outlier.id} /></span>
            <span>Owner <ExplorerLink kind="address" id={outlier.owner} /></span>
            <span>Unclaimed for <span className="num text-paper">{outlier.ageDays} days</span></span>
          </div>
        </section>
      )}

      <section className="panel min-w-0 overflow-hidden p-5 md:p-6" aria-labelledby="map">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="map" className="text-xl font-semibold tracking-tight">{outlier ? "Everything else" : "Largest unclaimed locks"}</h2>
            <p className="mt-1 text-xs text-mute">{outlier ? `${restBtc.toFixed(2)} BTC. ` : ""}Area follows √BTC so small locks stay visible. Colour is time since expiry.</p>
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-mute">
            {AGES.map(([l, d]) => <li key={l} className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5" style={{ background: ageColor(d) }} />{l}</li>)}
          </ul>
        </div>
        <div className="h-[300px] w-full min-w-0 overflow-hidden md:h-[380px]">
          {tree.length > 0 ? <ResponsiveContainer><Treemap data={tree} dataKey="size" content={<Cell />} isAnimationActive={false} /></ResponsiveContainer> : <div className="skeleton h-full w-full" />}
        </div>
      </section>

      <div className="grid gap-12 md:grid-cols-2">
        <section aria-labelledby="age">
          <h2 id="age" className="text-xl font-semibold tracking-tight">By time since expiry</h2>
          <ul className="mt-5 space-y-4">
            {(data?.buckets ?? Array.from({ length: 4 }, () => null)).map((b, i) => {
              if (!b) return <li key={i}><Skeleton className="h-4 w-full" /></li>;
              const share = total > 0 ? toBtc(b.btc) / total : 0;
              return (
                <li key={b.label}>
                  <div className="flex justify-between text-sm"><span>{b.label}</span><span className="num text-mute">{b.count} locks · {btc(b.btc, 2)} BTC</span></div>
                  <div className="mt-2 h-1 bg-hair"><div className="h-1" style={{ width: `${share > 0 ? Math.max(1, share * 100) : 0}%`, background: ageColor(AGES[i]?.[1] ?? 120) }} /></div>
                </li>
              );
            })}
          </ul>
        </section>
        <section aria-labelledby="up">
          <h2 id="up" className="text-xl font-semibold tracking-tight">Unlocking next</h2>
          {data && upcoming.length === 0 && <p className="mt-5 text-sm text-mute">No live locks unlock in the next 30 days.</p>}
          <ul className="mt-5 divide-y divide-line border-y border-line">
            {upcoming.map((u) => (
              <li key={u.end} className="flex items-baseline justify-between gap-4 py-3 text-sm">
                <span>{when(u.end)}</span>
                <span className="num text-mute">{u.count} lock{u.count > 1 ? "s" : ""} · <span className="text-paper">{btc(u.btc)} BTC</span></span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-labelledby="top">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="top" className="text-xl font-semibold tracking-tight">Largest unclaimed</h2>
          <span className="flex items-center gap-2 text-xs text-mute">veBTC contract <ExplorerLink kind="address" id={ADDR.veBTC} /></span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead><tr className="border-b border-line text-left"><th className="label py-2.5 font-medium">Lock</th><th className="label font-medium">Owner</th><th className="label text-right font-medium">BTC</th><th className="label text-right font-medium">Expired</th></tr></thead>
            <tbody>
              {(data?.top ?? []).slice(0, 15).map((l) => (
                <tr key={l.id} className="border-b border-hair transition-colors hover:bg-panel">
                  <td className="py-2.5"><LockLink id={l.id} /></td>
                  <td><ExplorerLink kind="address" id={l.owner}>{short(l.owner)}</ExplorerLink></td>
                  <td className="num text-right">{btc(l.amount)}</td>
                  <td className="num text-right text-mute">{l.ageDays}d ago</td>
                </tr>
              ))}
              {!data && Array.from({ length: 6 }, (_, i) => <tr key={i} className="border-b border-hair"><td colSpan={4} className="py-3"><Skeleton className="h-4 w-full" /></td></tr>)}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
