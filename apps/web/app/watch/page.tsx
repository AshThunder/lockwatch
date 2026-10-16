"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { fetcher, btc, short, pct } from "@/lib/format";
import { useSiwe, postJson } from "@/lib/siwe";
import { loadLocal, saveLocal, upsert, drop, merge, type Watched } from "@/lib/watch";
import { PageHead, State, Skeleton, when, CopyButton } from "@/components/ui";
import { useToast } from "@/components/feedback";
import { Icon, Spinner } from "@/components/Icon";
import { CalendarExport } from "@/components/Calendar";

type W = { address: string; locks: { asset?: "btc" | "mezo"; id: string; amount: string; end: number; permanent: boolean; status: string; protection: { active: boolean } | null }[]; loan: { icr: string; risk: string } | null };
const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export default function Watch() {
  const { address } = useAccount();
  const siwe = useSiwe();
  const toast = useToast();
  const [list, setList] = useState<Watched[]>([]);
  const [ready, setReady] = useState(false);
  const [addr, setAddr] = useState("");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setList(loadLocal()); setReady(true); }, []);
  useEffect(() => { if (ready) saveLocal(list); }, [list, ready]);

  const acct = useQuery({ queryKey: ["watchlist", address], enabled: !!address, queryFn: () => fetcher<{ items: Watched[] }>(`/api/watchlist?account=${address}`) });
  useEffect(() => { if (acct.data) setList((l) => merge(l, acct.data.items)); }, [acct.data]);
  const saved = new Set((acct.data?.items ?? []).map((w) => w.address.toLowerCase()));
  const unsaved = list.filter((w) => !saved.has(w.address));

  const addrs = list.map((w) => w.address);
  const data = useQuery({ queryKey: ["watch-data", addrs.join(",")], enabled: addrs.length > 0, refetchInterval: 30_000,
    queryFn: async () => (await Promise.all(chunk(addrs, 20).map((c) => fetcher<{ wallets: W[] }>(`/api/portfolio?addresses=${c.join(",")}`)))).flatMap((r) => r.wallets) });
  const by = useMemo(() => new Map((data.data ?? []).map((w) => [w.address.toLowerCase(), w])), [data.data]);

  function add(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try { setList(upsert(list, { address: addr, label })); setAddr(""); setLabel(""); } catch (x) { setErr((x as Error).message); }
  }
  async function sync() {
    setBusy(true);
    try {
      const s = await siwe(`Save ${unsaved.length} watched wallet${unsaved.length === 1 ? "" : "s"} to my Lockwatch account.`);
      await postJson("/api/watchlist", "PUT", { ...s, items: unsaved.map((w) => ({ address: w.address, label: w.label ?? undefined })) });
      toast({ tone: "ok", title: "Watchlist saved", body: "Alerts for these wallets now reach your alert channels." });
      acct.refetch();
    } catch (x) { const m = (x as Error).message; if (!/reject|denied/i.test(m)) toast({ tone: "bad", title: "Couldn't save", body: m }); }
    finally { setBusy(false); }
  }
  async function remove(a: string) {
    if (saved.has(a)) {
      try { const s = await siwe(`Stop watching ${a} on my Lockwatch account.`); await postJson("/api/watchlist", "DELETE", { ...s, address: a }); acct.refetch(); }
      catch (x) { const m = (x as Error).message; if (!/reject|denied/i.test(m)) toast({ tone: "bad", title: "Couldn't remove", body: m }); return; }
    }
    setList((l) => drop(l, a));
  }

  return (
    <>
      <PageHead title="Watchlist" crumb="Yours">
        Follow any wallet's locks and loan without connecting it: a cold wallet, a treasury, a friend. The list lives in this browser; sign in to keep it on your account and get its alerts.
      </PageHead>

      <form onSubmit={add} className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-end" aria-label="Add a wallet">
        <label className="flex-1 text-sm"><span className="label">Wallet address</span><input className="field num mt-1.5 w-full" placeholder="0x…" value={addr} onChange={(e) => setAddr(e.target.value)} spellCheck={false} autoComplete="off" /></label>
        <label className="text-sm sm:w-56"><span className="label">Label (optional)</span><input className="field mt-1.5 w-full" placeholder="Cold storage" maxLength={64} value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <button className="btn-primary" disabled={!addr.trim()}><Icon name="plus" />Watch</button>
      </form>
      {err && <p role="alert" className="mt-2 text-sm text-bad">{err}</p>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-mute">{list.length ? `${list.length} wallet${list.length === 1 ? "" : "s"} watched` : ""}</span>
        {address ? (unsaved.length > 0
          ? <button className="btn-ghost btn-sm" onClick={sync} disabled={busy}>{busy ? <Spinner /> : <Icon name="check" className="h-3.5 w-3.5" />}Save {unsaved.length} to my account</button>
          : list.length > 0 && <span className="inline-flex items-center gap-2 text-mute"><i className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden="true" />Saved to {short(address)} · <Link className="underline decoration-line underline-offset-[3px] hover:text-paper" href="/alerts">alert settings</Link></span>)
          : list.length > 0 && <span className="text-faint">Connect a wallet to save this list and get alerts.</span>}
      </div>

      {!ready ? <Skeleton className="mt-4 h-32 w-full" />
        : !list.length ? <div className="mt-4"><State title="Nothing watched yet">Paste any Mezo address above. Nothing is signed and nothing is approved; watching is read-only.</State></div>
        : (
          <div className="relative mt-3 overflow-x-auto rounded-md border border-line">
            <table className="tbl w-full min-w-[42rem]">
              <thead><tr><th scope="col">Wallet</th><th scope="col" className="text-right">Locked</th><th scope="col">Next unlock</th><th scope="col">Covered</th><th scope="col">Loan</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {list.map((w) => {
                  const d = by.get(w.address);
                  const live = d?.locks.filter((l) => !l.permanent && l.status !== "expired" && l.status !== "withdrawn") ?? [];
                  const next = live.reduce<number | null>((m, l) => (m === null || l.end < m ? l.end : m), null);
                  const idle = d?.locks.filter((l) => l.status === "expired").length ?? 0;
                  const total = d?.locks.filter((l) => l.asset !== "mezo").reduce((s, l) => s + BigInt(l.amount), 0n) ?? 0n;
                  const totalMezo = d?.locks.filter((l) => l.asset === "mezo").reduce((s, l) => s + BigInt(l.amount), 0n) ?? 0n;
                  const cov = live.filter((l) => l.protection?.active).length;
                  return (
                    <tr key={w.address}>
                      <td><div className="text-paper">{w.label || short(w.address)}</div>{w.label && <div className="num text-xs text-faint">{short(w.address)}</div>}{saved.has(w.address) && <span className="sr-only">saved to account</span>}</td>
                      <td className="num text-right">{d ? <>{btc(total)} BTC{totalMezo > 0n && <div className="text-xs text-mezo">{btc(totalMezo, 2)} MEZO</div>}</> : <Skeleton className="ml-auto h-4 w-16" />}</td>
                      <td>{!d ? "" : next ? <span className="text-paper">{when(next)}</span> : <span className="text-faint">None</span>}{idle > 0 && <div className="text-xs text-signal">{idle} ended, unclaimed</div>}</td>
                      <td className="num">{d ? (live.length ? `${cov}/${live.length}` : "–") : ""}</td>
                      <td>{d?.loan ? <span className={d.loan.risk === "safe" ? "text-mute" : "text-signal"}>{pct(d.loan.icr)}</span> : <span className="text-faint">{d ? "None" : ""}</span>}</td>
                      <td><div className="flex items-center justify-end gap-1"><CalendarExport address={w.address} compact /><CopyButton text={w.address} label="Copy address" /><button className="btn-ghost btn-sm" aria-label={`Stop watching ${w.label || w.address}`} onClick={() => remove(w.address)}><Icon name="trash" className="h-3.5 w-3.5" /></button></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </>
  );
}
