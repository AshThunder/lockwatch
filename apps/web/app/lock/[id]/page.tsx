"use client";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { fetcher, btc, short } from "@/lib/format";
import { MODES } from "@/lib/modes";
import { PageHead, State, Skeleton, StatusPill, ExplorerLink, lockExplorer, when, ago, useNow, FlapCountdown, ExpiryBar, CopyButton } from "@/components/ui";
import { Icon } from "@/components/Icon";

type Detail = {
  now: number;
  lock: { id: string; owner: string; amount: string; end: number; permanent: boolean; voted: boolean; approvedVault: boolean; withdrawn: boolean; status: string };
  protection: { mode: number; active: boolean; txHash: string | null; amount: string | null; newLockId: string | null; fallbackReason: string | null; updatedAt: number } | null;
  keeper: { attempts: number; lastError: string | null; nextTryAt: number; dead: boolean } | null;
  timeline: { key: string; label: string; at: number; state: "done" | "now" | "next" }[];
  activity: { kind: string; tx_hash: string | null; mode: number; ts: number; detail: string | null; amount: string | null; new_lock_id: string | null }[];
};

export default function LockPage({ params }: { params: { id: string } }) {
  const { address } = useAccount();
  const now = useNow(5000);
  const q = useQuery({ queryKey: ["lock", params.id], queryFn: () => fetcher<Detail>(`/api/locks/${params.id}`), retry: (n, e) => !/not found/.test((e as Error).message) && n < 2 });
  const back = <Link href="/at-risk" className="mb-3 inline-flex min-h-[36px] items-center gap-1.5 text-sm text-mute hover:text-paper"><Icon name="back" />Lock explorer</Link>;
  if (!/^\d+$/.test(params.id)) return <State title="That isn't a lock number" action={<Link className="btn-ghost" href="/at-risk">Browse locks</Link>}>Lock numbers are whole numbers, like #100.</State>;
  if (q.isError) return /not found/.test((q.error as Error).message)
    ? <div>{back}<State title={`Lock #${params.id} isn't indexed`} action={<Link className="btn-ghost" href="/at-risk">Browse locks</Link>}>It may not exist on this network yet. The indexer picks up new locks within a minute.</State></div>
    : <div>{back}<State tone="error" title="Couldn't load this lock" action={<button className="btn-ghost" onClick={() => q.refetch()}>Try again</button>}>{(q.error as Error).message}</State></div>;
  const d = q.data;
  const l = d?.lock;
  const ended = !!l && !l.permanent && l.end <= now;
  const mine = !!l && !!address && l.owner.toLowerCase() === address.toLowerCase();
  const p = d?.protection;
  const status = !l ? "" : l.withdrawn ? "withdrawn" : ended ? "expired" : l.status;
  return (
    <div className="space-y-10">
      <PageHead crumb={back} title={<>Lock <span className="num font-sans text-[0.8em] font-medium tracking-normal">#{params.id}</span></>}
        aside={l && !l.withdrawn && !l.permanent && !ended ? <Link href={`/protect/${l.id}`} className="btn-primary"><Icon name="shield" />{p?.active ? "Edit protection" : "Protect this lock"}</Link> : undefined}>
        {l ? <span className="flex flex-wrap items-center gap-2"><StatusPill status={status} />{p?.active && <StatusPill status="protected" />}{l.voted && <StatusPill status="voted" />}</span> : <Skeleton className="h-5 w-48" />}
      </PageHead>

      <section className="grid overflow-hidden rounded-lg border border-line bg-panel lg:grid-cols-[1.25fr_1fr]">
        <div className="border-b border-line p-5 md:p-7 lg:border-b-0 lg:border-r">
          <div className="label">Locked</div>
          <div className="num mt-1 text-4xl font-medium md:text-5xl">{l ? btc(l.amount) : <Skeleton className="h-12 w-40" />} <span className="text-lg text-faint">BTC</span></div>
          <div className="mt-6 board-label">{!l ? "" : l.permanent ? "Permanent lock" : l.withdrawn ? "Claimed" : ended ? "Departed" : "Departs in"}</div>
          {l && !l.permanent && !l.withdrawn && (ended
            ? <p className="mt-2 text-sm text-bad">Ended {when(l.end)}, {Math.floor((now - l.end) / 86400)} days ago. {p?.active ? "The keeper will claim it on its next run." : "The BTC is idle until it is claimed."}</p>
            : <div className="mt-3"><FlapCountdown to={l.end} size="text-[1.8rem] md:text-[2.3rem]" /><div className="mt-4 max-w-md"><ExpiryBar end={l.end} /></div><div className="mt-2 text-xs text-faint">{when(l.end)} your time · Thu 00:00 UTC</div></div>)}
        </div>
        <dl className="divide-y divide-line text-sm">
          {[
            ["Owner", l ? <span className="flex items-center gap-1"><ExplorerLink kind="address" id={l.owner} /><CopyButton text={l.owner} label="Copy owner" />{mine && <span className="pill text-btc">You</span>}</span> : null],
            ["Votes", l ? (l.voted ? "Has gauge votes. Cleared 1 h after departure, then claimed." : "No gauge votes") : null],
            ["Vault approval", l ? (l.approvedVault ? <span className="text-ok">Approved for Lockwatch</span> : <span className="text-mute">Not approved</span>) : null],
            ["At departure", l ? (p?.active ? <span className="inline-flex items-center gap-1.5"><Icon name="shield" className="h-4 w-4 text-btc" />{MODES[p.mode]}</span> : p && !p.active && p.txHash ? <span className="text-ok">Done: {MODES[p.mode].toLowerCase()}</span> : "Nothing. Not protected.") : null],
            ["On explorer", l ? <ExplorerLink kind="token" id={lockExplorer(l.id)}>veBTC #{l.id}</ExplorerLink> : null],
          ].map(([k, v]) => (
            <div key={k as string} className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-4 px-5 py-3.5 md:px-6">
              <dt className="text-mute">{k as string}</dt><dd className="min-w-0">{v ?? <Skeleton className="h-4 w-32" />}</dd>
            </div>
          ))}
        </dl>
      </section>

      {d?.keeper && (
        <div className={`flex items-start gap-3 rounded-md border px-4 py-3.5 text-sm ${d.keeper.dead ? "border-bad/40 bg-bad/[0.06]" : "border-signal/40 bg-signal/[0.06]"}`} role="status">
          <Icon name="alert" className={`mt-0.5 h-4 w-4 ${d.keeper.dead ? "text-bad" : "text-signal"}`} />
          <p>{d.keeper.dead ? "The keeper stopped retrying this lock after 3 attempts." : `The keeper is retrying (attempt ${d.keeper.attempts}, next ${when(d.keeper.nextTryAt)}).`} Last reason: <span className="num">{d.keeper.lastError}</span>. You can always claim it yourself from My locks.</p>
        </div>
      )}

      <div className="grid gap-10 lg:grid-cols-[1.25fr_1fr]">
        <section aria-labelledby="tl-h">
          <h2 id="tl-h" className="font-display text-2xl font-bold uppercase">Timetable</h2>
          {l?.permanent ? <p className="mt-4 text-sm text-mute">Permanent locks never depart, so there is nothing to schedule.</p> : (
            <ol className="mt-5 border-l border-line">
              {(d?.timeline ?? Array.from({ length: 4 }, () => null)).map((s, i) => !s ? <li key={i} className="pb-7 pl-6"><Skeleton className="h-4 w-48" /></li> : (
                <li key={s.key} className="relative pb-7 pl-6 last:pb-0" aria-current={s.state === "now" ? "step" : undefined}>
                  <i className={`absolute -left-[6px] top-1 h-[11px] w-[11px] rounded-full border-2 border-ground ${s.state === "done" ? "bg-ok" : s.state === "now" ? "bg-btc ring-4 ring-btc/20" : "bg-raised"}`} aria-hidden="true" />
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <span className={`font-display text-lg font-bold uppercase ${s.state === "next" ? "text-mute" : ""}`}>{s.label}</span>
                    <span className="num text-xs text-faint">{when(s.at)}</span>
                  </div>
                  <span className="text-xs text-faint">{s.state === "done" ? "Done" : s.state === "now" ? "Next up" : `In ${Math.max(0, Math.ceil((s.at - now) / 86400))} days`}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section aria-labelledby="la-h">
          <h2 id="la-h" className="font-display text-2xl font-bold uppercase">Activity</h2>
          <ul className="mt-4 border-t border-line">
            {d?.activity.length ? d.activity.map((a) => (
              <li key={`${a.kind}-${a.ts}`} className="border-b border-hair py-3.5 text-sm">
                <div className="flex items-center justify-between gap-3"><StatusPill status={a.kind} /><span className="text-xs text-faint">{ago(a.ts)}</span></div>
                <p className="mt-1.5 text-mute">{a.kind === "protected" ? <>Claimed and {MODES[a.mode].toLowerCase()}{a.amount ? ` · ${btc(a.amount)} BTC` : ""}{a.new_lock_id ? ` · new lock #${a.new_lock_id}` : ""}</> : a.kind === "registered" ? <>Auto-protect on: {MODES[a.mode].toLowerCase()}</> : a.detail ?? "Protection switched off"}</p>
                {a.tx_hash && <div className="mt-1.5 text-xs"><ExplorerLink kind="tx" id={a.tx_hash}>{short(a.tx_hash)}</ExplorerLink></div>}
              </li>
            )) : <li className="py-5 text-sm text-mute">{d ? "No Lockwatch activity on this lock yet." : <Skeleton className="h-4 w-1/2" />}</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
