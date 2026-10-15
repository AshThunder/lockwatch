"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { veBTCAbi } from "@lockwatch/sdk";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ADDR } from "@/lib/env";
import { fetcher, btc, short } from "@/lib/format";
import { StatusPill, State, useNow, Countdown, ExpiryBar, PageHead, Skeleton, when, ExplorerLink, ago, FlapCountdown, CopyButton } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { GlobalSearch } from "@/components/Search";
import { useTx } from "@/components/feedback";
import { CalendarExport, GoogleCalLink } from "@/components/Calendar";

type Lock = { id: string; amount: string; end: number; permanent: boolean; voted: boolean; approvedVault: boolean; status: string; protection: { active: boolean; mode: number; tx_hash: string | null } | null };
type Act = { items: { kind: string; lock_id: string; tx_hash: string | null; mode: number; ts: number; detail: string | null }[] };
import { MODES } from "@/lib/modes";
const W = (s: string) => BigInt(s);

export default function Dashboard() {
  const { address } = useAccount();
  const [view, setView] = useState<string | null>(null);
  useEffect(() => { const a = new URLSearchParams(window.location.search).get("address"); if (a && /^0x[0-9a-fA-F]{40}$/.test(a)) setView(a); }, []);
  const who = view ?? address;
  const isMine = !!address && who?.toLowerCase() === address.toLowerCase();
  const q = useQuery({ queryKey: ["locks", who], enabled: !!who, queryFn: () => fetcher<{ locks: Lock[] }>(`/api/locks?owner=${who}`) });
  const act = useQuery({ queryKey: ["activity", who], enabled: !!who, queryFn: () => fetcher<Act>(`/api/activity?owner=${who}&limit=6`) });
  const now = useNow(30_000);

  if (!who) return (
    <div className="space-y-8">
      <PageHead title="My locks">Connect the wallet that owns your veBTC locks, or look up any wallet read-only.</PageHead>
      <State title="No wallet connected" action={<ConnectButton label="Connect wallet" />}>
        We read your locks from Mezo. Nothing is signed until you choose to protect one.
        <div className="mx-auto mt-6 max-w-sm text-left"><GlobalSearch /></div>
      </State>
    </div>
  );

  const locks = q.data?.locks ?? [];
  const live = locks.filter((l) => !l.permanent);
  const expired = live.filter((l) => l.end <= now);
  const upcoming = live.filter((l) => l.end > now).sort((a, b) => a.end - b.end);
  const total = locks.reduce((s, l) => s + W(l.amount), 0n);
  const covered = live.filter((l) => l.protection?.active && l.end > now).reduce((s, l) => s + W(l.amount), 0n);
  const coverBase = upcoming.reduce((s, l) => s + W(l.amount), 0n);
  const coverage = coverBase > 0n ? Number((covered * 1000n) / coverBase) / 10 : 0;
  const idle = expired.reduce((s, l) => s + W(l.amount), 0n);
  const order = (l: Lock) => (l.end <= now && !l.permanent ? 0 : l.permanent ? 3 : l.protection?.active ? 2 : 1);
  const sorted = [...locks].sort((a, b) => order(a) - order(b) || a.end - b.end);

  return (
    <div className="space-y-10">
      <PageHead title={isMine ? "My locks" : "Wallet locks"}
        aside={<><CalendarExport address={who} /><Link href="/alerts" className="btn-ghost"><Icon name="bell" />Alerts</Link>{isMine && upcoming.some((l) => !l.protection?.active) && <Link href={`/protect/${upcoming.find((l) => !l.protection?.active)!.id}`} className="btn-primary"><Icon name="shield" />Protect next lock</Link>}</>}>
        {isMine ? "Everything you have locked in veBTC, when it departs, and what happens then." : <span className="inline-flex flex-wrap items-center gap-1">Viewing <span className="num text-paper">{short(who)}</span> read-only <CopyButton text={who} label="Copy address" /></span>}
      </PageHead>

      {q.isError ? <State tone="error" title="Couldn't load locks" action={<button className="btn-ghost" onClick={() => q.refetch()}>Try again</button>}>{(q.error as Error).message}</State> : <>
        <section aria-label="Portfolio" className="grid overflow-hidden rounded-lg border border-line bg-panel lg:grid-cols-[1.2fr_1fr]">
          <div className="border-b border-line p-5 md:p-7 lg:border-b-0 lg:border-r">
            <div className="board-label">Next departure</div>
            {q.isLoading ? <Skeleton className="mt-4 h-16 w-72" /> : upcoming[0] ? <>
              <div className="mt-1 text-sm text-mute">Lock <Link className="num text-paper hover:text-btc" href={`/lock/${upcoming[0].id}`}>#{upcoming[0].id}</Link> · {btc(upcoming[0].amount)} BTC · {when(upcoming[0].end)}</div>
              <div className="mt-4"><FlapCountdown to={upcoming[0].end} size="text-[1.9rem] md:text-[2.4rem]" /></div>
              <div className="mt-4 text-sm">{upcoming[0].protection?.active ? <span className="inline-flex items-center gap-2 text-paper"><Icon name="shield" className="h-4 w-4 text-btc" />At departure: {MODES[upcoming[0].protection.mode].toLowerCase()}</span> : <span className="inline-flex items-center gap-2 text-signal"><Icon name="alert" className="h-4 w-4" />Not protected. The BTC will sit idle until claimed.</span>}</div>
            </> : <p className="mt-3 text-mute">No upcoming departures for this wallet.</p>}
          </div>
          <dl className="grid grid-cols-2 divide-x divide-y divide-line [&>div]:px-5 [&>div]:md:px-6">
            <Stat2 label="Total locked" v={q.isLoading ? null : `${btc(total, 4)}`} unit="BTC" sub={`${locks.length} lock${locks.length === 1 ? "" : "s"}`} />
            <Stat2 label="Protection coverage" v={q.isLoading ? null : coverBase > 0n ? `${coverage.toFixed(0)}%` : "–"} sub={coverBase > 0n ? `${btc(covered, 4)} of ${btc(coverBase, 4)} BTC` : "No upcoming locks"} bar={coverBase > 0n ? coverage : undefined} />
            <Stat2 label="Idle, unclaimed" v={q.isLoading ? null : btc(idle, 4)} unit="BTC" tone={idle > 0n ? "text-bad" : undefined} sub={`${expired.length} ended lock${expired.length === 1 ? "" : "s"}`} />
            <Stat2 label="Voting locks" v={q.isLoading ? null : String(locks.filter((l) => l.voted).length)} sub="Cleared 1 h after departure" />
          </dl>
        </section>

        {expired.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-md border border-bad/40 bg-bad/[0.06] px-4 py-3.5 text-sm" role="status">
            <Icon name="alert" className="h-4 w-4 text-bad" />
            <p className="flex-1"><span className="num font-semibold text-bad">{btc(idle)} BTC</span> is sitting in {expired.length} ended lock{expired.length > 1 ? "s" : ""}. Claim it now, or protect your next lock so it&rsquo;s claimed for you.</p>
          </div>
        )}

        <section aria-labelledby="locks-h">
          <h2 id="locks-h" className="font-display text-2xl font-bold uppercase">Locks</h2>
          {q.isLoading ? (
            <div className="mt-4 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : locks.length === 0 ? (
            <div className="mt-4"><State title="No veBTC locks for this wallet" action={<a className="btn-ghost" href="https://mezo.org" target="_blank" rel="noreferrer">Lock BTC on Mezo<Icon name="external" className="h-3.5 w-3.5" /></a>}>Create a lock on Mezo, then come back to put it on the board.</State></div>
          ) : (
            <div className="mt-4 overflow-hidden rounded-lg border border-line">
              <div className="hidden grid-cols-[7rem_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto] gap-6 border-b border-line bg-panel px-5 py-2.5 text-xs text-mute md:grid"><span>Lock</span><span className="text-right">BTC</span><span>Departs</span><span>At departure</span><span className="w-[13rem] text-right">Actions</span></div>
              <ul>{sorted.map((l) => <LockRow key={l.id} l={l} canAct={isMine} onDone={() => { q.refetch(); act.refetch(); }} />)}</ul>
            </div>
          )}
        </section>

        <section aria-labelledby="act-h">
          <div className="flex items-baseline justify-between gap-3"><h2 id="act-h" className="font-display text-2xl font-bold uppercase">Recent activity</h2><Link className="text-sm text-mute hover:text-paper" href="/activity">All keeper activity</Link></div>
          <ul className="mt-4 border-t border-line">
            {act.data?.items.length ? act.data.items.map((a) => (
              <li key={`${a.lock_id}-${a.ts}`} className="flex flex-wrap items-center justify-between gap-3 border-b border-hair py-3 text-sm">
                <span className="flex items-center gap-3"><StatusPill status={a.kind} /><Link className="num hover:text-btc" href={`/lock/${a.lock_id}`}>#{a.lock_id}</Link><span className="text-mute">{MODES[a.mode]}</span></span>
                <span className="flex items-center gap-3 text-xs text-faint">{ago(a.ts)}{a.tx_hash && <ExplorerLink kind="tx" id={a.tx_hash}>tx</ExplorerLink>}</span>
              </li>
            )) : <li className="py-5 text-sm text-mute">{act.isLoading ? <Skeleton className="h-4 w-1/2" /> : "Nothing yet. Protect a lock and the keeper's actions appear here."}</li>}
          </ul>
        </section>
      </>}
    </div>
  );
}

function Stat2({ label, v, unit, sub, tone, bar }: { label: string; v: string | null; unit?: string; sub?: string; tone?: string; bar?: number }) {
  return (
    <div className="min-w-0 py-5">
      <dt className="label">{label}</dt>
      <dd className={`num mt-1.5 truncate text-2xl font-medium ${tone ?? ""}`}>{v === null ? <Skeleton className="h-7 w-20" /> : <>{v}{unit && <span className="ml-1 text-sm text-faint">{unit}</span>}</>}</dd>
      {bar !== undefined && <dd className="mt-2 h-1 overflow-hidden rounded-full bg-raised" aria-hidden="true"><div className="h-full bg-btc" style={{ width: `${bar}%` }} /></dd>}
      {sub && <dd className="mt-1.5 truncate text-xs text-faint">{sub}</dd>}
    </div>
  );
}

function LockRow({ l, canAct, onDone }: { l: Lock; canAct: boolean; onDone: () => void }) {
  const now = useNow();
  const claim = useTx(`Claim lock #${l.id}`, { onSuccess: onDone, successText: `Lock #${l.id} claimed. BTC is in your wallet.` });
  const extend = useTx(`Extend lock #${l.id}`, { onSuccess: onDone, successText: `Lock #${l.id} extended by 4 weeks.` });
  const expired = l.end <= now && !l.permanent;
  const prot = l.protection?.active;
  return (
    <li className="grid gap-x-6 gap-y-3 border-b border-hair px-4 py-4 last:border-b-0 md:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto] md:items-center md:px-5">
      {claim.modal}{extend.modal}
      <div className="flex items-center gap-2 md:block">
        <Link href={`/lock/${l.id}`} className="num text-[1rem] font-medium hover:text-btc">#{l.id}</Link>
        <div className="md:mt-1"><StatusPill status={expired ? "expired" : l.status} /></div>
      </div>
      <div className="num text-lg md:text-right">{btc(l.amount)} <span className="text-xs text-faint">BTC</span></div>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          {l.permanent ? <span className="text-mute">Permanent lock</span> : expired ? <span className="text-bad">Ended {when(l.end)}</span> : <Countdown to={l.end} />}
          {!l.permanent && !expired && <span className="text-xs text-faint">{when(l.end)}</span>}
        </div>
        <div className="mt-2"><ExpiryBar end={l.end} permanent={l.permanent} /></div>
        {!l.permanent && !expired && <GoogleCalLink id={l.id} amount={l.amount} end={l.end} voted={l.voted} mode={l.protection?.active ? MODES[l.protection.mode] : null} className="mt-1" />}
      </div>
      <div className="text-sm">
        {prot ? <span className="inline-flex items-center gap-1.5"><Icon name="shield" className="h-4 w-4 text-btc" />{MODES[l.protection!.mode]}{l.voted && <span className="text-faint">· clears votes</span>}</span>
          : <span className="text-faint">{l.permanent ? "Never departs" : "Nothing happens"}</span>}
        {prot && !l.approvedVault && <div className="mt-1 text-xs text-signal">Approval missing. Re-approve to keep it protected.</div>}
      </div>
      <div className="flex flex-wrap gap-2 md:w-[13rem] md:justify-end">
        {expired && !l.voted && canAct && <button className="btn-primary btn-sm" disabled={claim.busy} onClick={() => claim.run({ address: ADDR.veBTC, abi: veBTCAbi, functionName: "withdraw", args: [BigInt(l.id)] })}>Claim now</button>}
        {!l.permanent && !expired && <Link href={`/protect/${l.id}`} className={prot ? "btn-ghost btn-sm" : "btn-primary btn-sm"}>{prot ? "Edit plan" : <><Icon name="shield" className="h-3.5 w-3.5" />Protect</>}</Link>}
        {!expired && !l.permanent && canAct && <button className="btn-ghost btn-sm" disabled={extend.busy} onClick={() => extend.run({ address: ADDR.veBTC, abi: veBTCAbi, functionName: "increaseUnlockTime", args: [BigInt(l.id), BigInt(28 * 86400)] })}>+4 weeks</button>}
        {expired && l.voted && <Link href={`/lock/${l.id}`} className="btn-ghost btn-sm">Details</Link>}
      </div>
    </li>
  );
}
