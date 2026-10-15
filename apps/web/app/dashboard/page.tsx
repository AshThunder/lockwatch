"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { veBTCAbi } from "@lockwatch/sdk";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ADDR } from "@/lib/env";
import { fetcher, btc, short } from "@/lib/format";
import { StatusPill, Empty, ExplorerLink, useNow, Countdown, ExpiryBar, PageHead, Skeleton, when } from "@/components/ui";
import { Icon } from "@/components/Icon";

type Lock = { id: string; amount: string; end: number; permanent: boolean; voted: boolean; approvedVault: boolean; status: string; protection: { active: boolean; mode: number; tx_hash: string | null } | null };
const MODES = ["return to wallet", "re-lock", "MUSD loan", "MUSD into savings"];

export default function Dashboard() {
  const { address } = useAccount();
  const [view, setView] = useState<string | null>(null);
  useEffect(() => { const a = new URLSearchParams(window.location.search).get("address"); if (a && /^0x[0-9a-fA-F]{40}$/.test(a)) setView(a); }, []);
  const who = view ?? address;
  const isMine = !!address && who?.toLowerCase() === address.toLowerCase();
  const q = useQuery({ queryKey: ["locks", who], enabled: !!who, queryFn: () => fetcher<{ locks: Lock[] }>(`/api/locks?owner=${who}`) });
  if (!who) return <Empty title="Connect a wallet to see your veBTC locks">We read your locks from Mezo. Nothing is signed until you protect one.<div className="mt-6 flex justify-center"><ConnectButton /></div></Empty>;
  const locks = q.data?.locks ?? [];
  const expired = locks.filter((l) => l.status === "expired");
  const order = (l: Lock) => (l.status === "expired" ? 0 : l.permanent ? 3 : l.protection?.active ? 2 : 1);
  const sorted = [...locks].sort((a, b) => order(a) - order(b) || a.end - b.end);
  return (
    <div className="space-y-8">
      <PageHead title={isMine ? "My locks" : "Locks"} aside={<Link href="/alerts" className="btn-ghost"><Icon name="bell" />Set up alerts</Link>}>
        {q.isLoading ? <Skeleton className="h-4 w-56" /> : <>{locks.length} veBTC lock{locks.length === 1 ? "" : "s"} · {expired.length} expired and unclaimed{!isMine && <> · viewing <span className="num text-paper">{short(who)}</span> read-only</>}</>}
      </PageHead>
      {expired.length > 0 && (
        <div className="flex items-start gap-3 rounded-md border border-bad/30 bg-bad/[0.06] p-4 text-sm" role="status">
          <Icon name="alert" className="mt-0.5 h-4 w-4 text-bad" />
          <p><span className="num font-medium text-bad">{btc(expired.reduce((s, l) => s + BigInt(l.amount), 0n))} BTC</span> is sitting in expired locks. Claim it now, or turn on auto-protect so the next one is claimed for you.</p>
        </div>
      )}
      {q.isLoading ? (
        <ul className="divide-y divide-line border-y border-line">{[0, 1, 2].map((i) => <li key={i} className="py-6"><Skeleton className="h-5 w-40" /><Skeleton className="mt-3 h-1 w-full" /></li>)}</ul>
      ) : locks.length === 0 ? <Empty title="No veBTC locks for this wallet">Create a lock on mezo.org, then come back.</Empty> : (
        <ul className="divide-y divide-line border-y border-line">{sorted.map((l) => <LockRow key={l.id} l={l} canAct={isMine} onDone={() => q.refetch()} />)}</ul>
      )}
    </div>
  );
}

function LockRow({ l, canAct, onDone }: { l: Lock; canAct: boolean; onDone: () => void }) {
  const now = useNow();
  const { writeContract, data: hash, isPending } = useWriteContract();
  const r = useWaitForTransactionReceipt({ hash });
  useEffect(() => { if (r.isSuccess) { const t = setTimeout(onDone, 1500); return () => clearTimeout(t); } }, [r.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps
  const expired = l.end <= now && !l.permanent;
  const prot = l.protection?.active;
  const busy = isPending || r.isLoading;
  return (
    <li className="grid gap-x-8 gap-y-4 py-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display font-semibold">Lock #{l.id}</span>
          <StatusPill status={l.status} />
          {prot && <StatusPill status="protected" />}
          {l.voted && <span className="pill border border-line text-mute">voted</span>}
        </div>
        <div className="num mt-2 text-2xl font-medium">{btc(l.amount)} <span className="text-sm text-faint">BTC</span></div>
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          {l.permanent ? <span className="text-mute">Permanent lock</span> : expired ? <span className="text-bad">Expired {when(l.end)}</span> : <Countdown to={l.end} className="text-paper" />}
          {!l.permanent && !expired && <span className="text-xs text-faint">{when(l.end)}</span>}
        </div>
        <div className="mt-2.5"><ExpiryBar end={l.end} permanent={l.permanent} /></div>
        <div className="mt-2.5 flex items-center gap-1.5 text-xs">
          {prot ? <><Icon name="shield" className="h-3.5 w-3.5 text-btc" /><span className="text-mute">At expiry: <span className="text-paper">{MODES[l.protection!.mode]}</span></span>{!l.approvedVault && <span className="text-warn">· approval missing, re-approve</span>}</> : <span className="text-faint">{l.permanent ? "Never expires" : "Not protected. Nothing happens at expiry."}</span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 md:justify-end">
        {expired && !l.voted && canAct && (
          <button className="btn-primary" disabled={busy} onClick={() => writeContract({ address: ADDR.veBTC, abi: veBTCAbi, functionName: "withdraw", args: [BigInt(l.id)] })}>
            {busy ? "Claiming…" : "Claim now"}
          </button>
        )}
        {!l.permanent && <Link href={`/protect/${l.id}`} className={expired || prot ? "btn-ghost" : "btn-primary"}>{prot ? "Edit plan" : <><Icon name="shield" />Protect</>}</Link>}
        {!expired && !l.permanent && canAct && (
          <button className="btn-ghost" disabled={busy} onClick={() => writeContract({ address: ADDR.veBTC, abi: veBTCAbi, functionName: "increaseUnlockTime", args: [BigInt(l.id), BigInt(28 * 86400)] })}>Extend 4 weeks</button>
        )}
        {hash && <div className="w-full text-xs md:text-right"><ExplorerLink kind="tx" id={hash}>Transaction</ExplorerLink></div>}
      </div>
    </li>
  );
}
