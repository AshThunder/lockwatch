"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetcher, short } from "@/lib/format";
import { VAULT, RESCUE, LEGACY_VAULTS } from "@/lib/env";
import { PageHead, State, Skeleton, Stat, ExplorerLink, Pager, when, ago, useNow } from "@/components/ui";

type K = { keeper: string; balance: string | null; actions: number; succeeded: number; successRate: number | null; uptime24h: number; lastHeartbeat: number | null; nextRun: number | null;
  byJob: Record<string, { total: number; ok: number }>; page: number; pages: number; total: number; items: { job: string; subject: string | null; ok: boolean; tx: string | null; detail: string | null; ts: number }[] };
const JOBS = [{ k: "", t: "All" }, { k: "protect", t: "End-of-lock" }, { k: "extend", t: "Extend" }, { k: "rewards", t: "Rewards" }, { k: "rescue", t: "Rescue" }];
const JOB_NAME: Record<string, string> = { protect: "End-of-lock", extend: "Extend", rewards: "Rewards", rescue: "Rescue" };
const LOW = 0.002;

export default function Keeper() {
  const [job, setJob] = useState("");
  const [page, setPage] = useState(1);
  const now = useNow(10_000);
  const q = useQuery({ queryKey: ["keeper", job, page], refetchInterval: 30_000, queryFn: () => fetcher<K>(`/api/keeper?page=${page}${job ? `&job=${job}` : ""}`) });
  const d = q.data;
  const bal = d?.balance != null ? Number(d.balance) : null;
  const late = d?.nextRun ? now - d.nextRun > 300 : false;

  return (
    <>
      <PageHead title="Keeper" crumb="Lockwatch">
        One public wallet runs every scheduled action. Everything it does is a transaction you can check, and it can only ever do what each lock owner set up.
      </PageHead>
      {q.isLoading ? <Skeleton className="h-28 w-full" /> : q.isError || !d ? <State tone="error" title="Keeper status is unavailable">{String(q.error ?? "")}</State> : <>
        <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Status" value={<span className="inline-flex items-center gap-2"><i className={`h-2 w-2 rounded-full ${!d.lastHeartbeat || late ? "bg-signal" : "bg-ok"}`} aria-hidden="true" />{!d.lastHeartbeat ? "Waiting" : late ? "Running late" : "Running"}</span>}
            sub={d.lastHeartbeat ? `Last run ${ago(d.lastHeartbeat, now)}${d.nextRun && !late ? ` · next ${when(d.nextRun)}` : ""}` : "No runs recorded yet"} />
          <Stat label="Uptime, 24h" value={`${Math.round(d.uptime24h * 100)}%`} sub="of 5-minute slots" />
          <Stat label="Success rate, 30d" value={d.successRate === null ? "–" : `${(d.successRate * 100).toFixed(1)}%`} sub={`${d.succeeded} of ${d.actions} actions`} />
          <Stat label="Gas balance" value={bal === null ? "–" : `${bal.toFixed(4)} BTC`} tone={bal !== null && bal < LOW ? "text-signal" : undefined} sub={bal !== null && bal < LOW ? "Low. Top-up pending." : <ExplorerLink kind="address" id={d.keeper}>{short(d.keeper)}</ExplorerLink>} />
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          {Object.entries(d.byJob).map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between border-b border-hair pb-2 text-sm"><span className="text-mute">{JOB_NAME[k]}</span><span className="num text-paper">{v.ok}<span className="text-faint">/{v.total}</span></span></div>
          ))}
        </div>

        <section className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="board-label">History</h2>
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter by job">
              {JOBS.map((j) => <button key={j.k} role="tab" aria-selected={job === j.k} onClick={() => { setJob(j.k); setPage(1); }} className={`btn-sm rounded px-3 ${job === j.k ? "bg-raised text-paper" : "text-mute hover:text-paper"}`}>{j.t}</button>)}
            </div>
          </div>
          {!d.items.length ? <div className="mt-3"><State title="Nothing here yet">Actions appear the moment the keeper takes one.</State></div> : (
            <div className="relative mt-3 overflow-x-auto rounded-md border border-line">
              <table className="tbl w-full min-w-[36rem]">
                <thead><tr><th scope="col">When</th><th scope="col">Job</th><th scope="col">For</th><th scope="col">Result</th><th scope="col">Transaction</th></tr></thead>
                <tbody>{d.items.map((r, i) => (
                  <tr key={`${r.ts}-${i}`}>
                    <td className="num text-xs text-faint">{when(r.ts)}</td>
                    <td>{JOB_NAME[r.job] ?? r.job}</td>
                    <td className="num">{r.subject ? (r.subject.startsWith("0x") ? short(r.subject) : `#${r.subject}`) : "–"}</td>
                    <td>{r.ok ? <span className="text-ok">Done</span> : <span className="text-signal" title={r.detail ?? undefined}>Skipped{r.detail ? `: ${r.detail}` : ""}</span>}</td>
                    <td>{r.tx ? <ExplorerLink kind="tx" id={r.tx}>{short(r.tx)}</ExplorerLink> : <span className="text-faint">–</span>}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
          {d.pages > 1 && <div className="mt-3"><Pager page={d.page} pages={d.pages} onPage={setPage} label="Keeper history pages" /></div>}
        </section>

        <section className="mt-10 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <h2 className="board-label sm:col-span-2">Contracts</h2>
          {VAULT && <Row k="Vault" v={VAULT} />}
          {LEGACY_VAULTS.map((v) => <Row key={v} k="Vault (first version, still served)" v={v} />)}
          {RESCUE && <Row k="Loan rescue" v={RESCUE} />}
          <Row k="Keeper wallet" v={d.keeper} />
        </section>
      </>}
    </>
  );
}
const Row = ({ k, v }: { k: string; v: string }) => <div className="flex items-baseline justify-between gap-3 border-b border-hair py-2"><span className="text-mute">{k}</span><ExplorerLink kind="address" id={v} className="num">{short(v)}</ExplorerLink></div>;
