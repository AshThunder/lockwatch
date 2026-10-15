"use client";
import Link from "next/link";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { veBTCAbi } from "@lockwatch/sdk";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ADDR } from "@/lib/env";
import { fetcher, btc, left } from "@/lib/format";
import { CountdownRing, StatusPill, Empty, ExplorerLink, useNow } from "@/components/ui";

type Lock = { id: string; amount: string; end: number; permanent: boolean; voted: boolean; approvedVault: boolean; status: string; protection: { active: boolean; mode: number; tx_hash: string | null } | null };
const MODES = ["Return to wallet", "Re-lock", "MUSD loan", "MUSD → savings"];

export default function Dashboard() {
  const { address } = useAccount();
  const q = useQuery({ queryKey: ["locks", address], enabled: !!address, queryFn: () => fetcher<{ locks: Lock[] }>(`/api/locks?owner=${address}`) });
  if (!address) return <Empty title="Connect a wallet to see your veBTC locks"><div className="mt-4 flex justify-center"><ConnectButton /></div></Empty>;
  const locks = q.data?.locks ?? [];
  const expired = locks.filter((l) => l.status === "expired");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">My locks</h1>
          <p className="text-sm text-mute">{locks.length} veBTC locks · {expired.length} expired and unclaimed</p>
        </div>
        <Link href="/alerts" className="btn-ghost">🔔 Set up alerts</Link>
      </div>
      {expired.length > 0 && (
        <div className="card border-bad/40 bg-bad/5 text-sm">
          <b className="text-bad">{btc(expired.reduce((s, l) => s + BigInt(l.amount), 0n))} BTC</b> is sitting in expired locks. Claim it now or turn on auto-protect so it never happens again.
        </div>
      )}
      {q.isLoading ? <div className="text-mute">Loading…</div> : locks.length === 0 ? <Empty title="No veBTC locks for this wallet">Create a lock on mezo.org, then come back.</Empty> : (
        <div className="grid gap-4 md:grid-cols-2">{locks.map((l) => <LockCard key={l.id} l={l} onDone={() => q.refetch()} />)}</div>
      )}
    </div>
  );
}

function LockCard({ l, onDone }: { l: Lock; onDone: () => void }) {
  const now = useNow();
  const { writeContract, data: hash, isPending } = useWriteContract();
  const r = useWaitForTransactionReceipt({ hash });
  if (r.isSuccess) setTimeout(onDone, 1500);
  const expired = l.end <= now && !l.permanent;
  const prot = l.protection?.active;
  return (
    <div className="card flex gap-5">
      <CountdownRing end={l.end} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold">Lock #{l.id}</span>
          <StatusPill status={l.status} />
          {l.voted && <span className="pill bg-white/10 text-mute">voted</span>}
        </div>
        <div className="num mt-1 text-2xl font-bold">{btc(l.amount)} <span className="text-sm text-mute">BTC</span></div>
        <div className="mt-1 text-xs text-mute">{l.permanent ? "Permanent lock" : `${expired ? "Expired" : "Unlocks"} ${new Date(l.end * 1000).toUTCString().slice(0, 22)} UTC · ${left(l.end - now)}`}</div>
        <div className="mt-2 text-xs">
          {prot ? <span className="text-ok">🛡 Auto-protect on · {MODES[l.protection!.mode]}{!l.approvedVault && <b className="text-warn"> · re-approve needed</b>}</span> : <span className="text-mute">Not protected</span>}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {expired && !l.voted && (
            <button className="btn-primary" disabled={isPending || r.isLoading} onClick={() => writeContract({ address: ADDR.veBTC, abi: veBTCAbi, functionName: "withdraw", args: [BigInt(l.id)] })}>
              {isPending || r.isLoading ? "Claiming…" : "Claim now"}
            </button>
          )}
          {!l.permanent && <Link href={`/protect/${l.id}`} className={expired ? "btn-ghost" : "btn-primary"}>{prot ? "Edit protection" : "Protect"}</Link>}
          {!expired && !l.permanent && (
            <button className="btn-ghost" disabled={isPending} onClick={() => writeContract({ address: ADDR.veBTC, abi: veBTCAbi, functionName: "increaseUnlockTime", args: [BigInt(l.id), BigInt(28 * 86400)] })}>Extend 4 wks</button>
          )}
        </div>
        {hash && <div className="mt-2 text-xs"><ExplorerLink kind="tx" id={hash} /></div>}
      </div>
    </div>
  );
}
