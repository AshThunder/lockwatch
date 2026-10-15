"use client";
import { useQuery } from "@tanstack/react-query";
import { ResponsiveContainer, Treemap, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { fetcher, btc, short } from "@/lib/format";
import { Stat, ExplorerLink } from "@/components/ui";

type R = { expiredCount: number; expiredBtc: string; owners: number; totalLocks: number; buckets: { label: string; count: number; btc: string }[]; upcoming: { end: number; count: number; btc: string }[]; top: { id: string; owner: string; amount: string; ageDays: number }[] };

const ageColor = (d: number) => (d < 7 ? "#F59E0B" : d < 30 ? "#F97316" : d < 90 ? "#EF4444" : "#B91C1C");

function Cell(props: { x?: number; y?: number; width?: number; height?: number; name?: string; ageDays?: number; amountBtc?: number }) {
  const { x = 0, y = 0, width = 0, height = 0, name, ageDays = 0, amountBtc = 0 } = props;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={ageColor(ageDays)} fillOpacity={0.85} stroke="#0B0D10" strokeWidth={2} rx={4} />
      {width > 60 && height > 34 && (
        <>
          <text x={x + 8} y={y + 18} fill="#000" fontSize={12} fontWeight={700}>#{name}</text>
          <text x={x + 8} y={y + 32} fill="#000" fontSize={11}>{amountBtc.toFixed(amountBtc < 1 ? 3 : 1)} BTC</text>
        </>
      )}
    </g>
  );
}

export default function AtRisk() {
  const { data } = useQuery({ queryKey: ["at-risk"], queryFn: () => fetcher<R>("/api/at-risk") });
  const tree = (data?.top ?? []).map((l) => ({ name: l.id, size: Math.sqrt(Number(BigInt(l.amount)) / 1e18), amountBtc: Number(BigInt(l.amount)) / 1e18, ageDays: l.ageDays }));
  const up = (data?.upcoming ?? []).slice(0, 6).map((u) => ({ date: new Date(u.end * 1000).toISOString().slice(5, 10), btc: Number(BigInt(u.btc)) / 1e18, count: u.count }));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">BTC at risk on Mezo</h1>
        <p className="text-sm text-mute">Every veBTC lock that has expired but was never claimed. Unclaimed locks were exactly what the Oct 5 attacker drained.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-5">
        <Stat label="BTC unclaimed" value={data ? btc(data.expiredBtc, 2) : "…"} accent />
        <Stat label="Expired locks" value={data?.expiredCount ?? "…"} sub={data ? `of ${data.totalLocks} live locks` : ""} />
        <Stat label="Wallets affected" value={data?.owners ?? "…"} />
        <Stat label="Largest single lock" value={data?.top[0] ? btc(data.top[0].amount, 1) : "…"} sub={data?.top[0] ? `#${data.top[0].id} · ${data.top[0].ageDays}d unclaimed` : ""} />
        <Stat label="Older than 3 months" value={data ? btc(data.buckets[3]?.btc ?? "0", 1) : "…"} sub="BTC forgotten the longest" />
      </div>
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <div><h2 className="font-semibold">Largest unclaimed locks</h2><div className="text-xs text-mute">area ∝ √BTC so small locks stay visible</div></div>
          <div className="flex gap-3 text-xs text-mute">
            {[["< 1 wk", 3], ["< 1 mo", 10], ["< 3 mo", 60], ["> 3 mo", 120]].map(([l, d]) => <span key={l} className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: ageColor(+d) }} />{l}</span>)}
          </div>
        </div>
        <div className="h-[420px]">
          {tree.length > 0 && <ResponsiveContainer><Treemap data={tree} dataKey="size" content={<Cell />} isAnimationActive={false} /></ResponsiveContainer>}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 font-semibold">Upcoming Thursday expiries</h2>
          <div className="h-56">
            {up.length === 0 ? <div className="flex h-full items-center justify-center text-sm text-mute">No live locks unlock in the next 30 days — everything here has already expired.</div> : <ResponsiveContainer>
              <BarChart data={up}>
                <XAxis dataKey="date" stroke="#8B95A5" fontSize={12} />
                <YAxis stroke="#8B95A5" fontSize={12} />
                <Tooltip contentStyle={{ background: "#12151A", border: "1px solid #1F242C" }} formatter={(v: number) => [`${v.toFixed(4)} BTC`, "unlocking"]} />
                <Bar dataKey="btc" fill="#F7931A" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>}
          </div>
        </div>
        <div className="card">
          <h2 className="mb-3 font-semibold">By time since expiry</h2>
          <div className="space-y-3">
            {(data?.buckets ?? []).map((b) => {
              const share = data && BigInt(data.expiredBtc) > 0n ? Number((BigInt(b.btc) * 1000n) / BigInt(data.expiredBtc)) / 10 : 0;
              return (
                <div key={b.label}>
                  <div className="flex justify-between text-sm"><span>{b.label}</span><span className="num text-mute">{b.count} locks · {btc(b.btc, 2)} BTC</span></div>
                  <div className="mt-1 h-2 rounded-full bg-line"><div className="h-2 rounded-full bg-btc" style={{ width: `${share}%` }} /></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="card overflow-x-auto">
        <h2 className="mb-3 font-semibold">Top unclaimed</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-mute"><tr><th className="py-2">Lock</th><th>Owner</th><th className="text-right">BTC</th><th className="text-right">Expired</th></tr></thead>
          <tbody>
            {(data?.top ?? []).slice(0, 15).map((l) => (
              <tr key={l.id} className="border-t border-line">
                <td className="py-2">#{l.id}</td>
                <td><ExplorerLink kind="address" id={l.owner}>{short(l.owner)}</ExplorerLink></td>
                <td className="num text-right">{btc(l.amount)}</td>
                <td className="text-right text-mute">{l.ageDays}d ago</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
