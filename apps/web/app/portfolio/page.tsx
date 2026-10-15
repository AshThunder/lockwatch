"use client";
import Link from "next/link";
import { useState } from "react";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { fetcher, btc, short, usd, pct } from "@/lib/format";
import { MODES } from "@/lib/modes";
import { useSiwe, postJson } from "@/lib/siwe";
import { PageHead, State, Skeleton, Stat, LockLink, StatusPill, when } from "@/components/ui";
import { useToast } from "@/components/feedback";
import { Icon, Spinner } from "@/components/Icon";
import { CalendarExport } from "@/components/Calendar";

type Lk = { id: string; amount: string; end: number; permanent: boolean; status: string; protection: { active: boolean; mode: number } | null; autoExtend: unknown; autoRewards: boolean };
type P = { linked: string[]; wallets: { address: string; locks: Lk[]; loan: { coll: string; debt: string; icr: string; risk: string } | null }[];
  totals: { wallets: number; locks: number; locked: string; idle: string; coverage: number | null; nextUnlock: number | null; loanColl: string; loanDebt: string; loans: number } };
type Pending = { account: `0x${string}`; message: string; signature: string };

export default function Portfolio() {
  const { address } = useAccount();
  const siwe = useSiwe();
  const toast = useToast();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const account = pending?.account ?? address;
  const q = useQuery({ queryKey: ["portfolio-acct", account], enabled: !!account, refetchInterval: 30_000,
    queryFn: () => fetcher<P>(`/api/portfolio?account=${account}&addresses=${account}`) });
  const switched = !!pending && !!address && address.toLowerCase() !== pending.account.toLowerCase();

  async function start() {
    if (!address) return;
    setBusy(true);
    try { const s = await siwe("Link another wallet to my Lockwatch portfolio."); setPending({ account: address, ...s }); }
    catch (x) { const m = (x as Error).message; if (!/reject|denied/i.test(m)) toast({ tone: "bad", title: "Couldn't sign", body: m }); }
    finally { setBusy(false); }
  }
  async function finish() {
    if (!pending || !address) return;
    setBusy(true);
    try {
      const link = await siwe(`Link this wallet to Lockwatch account ${pending.account}.`, address);
      await postJson("/api/wallets", "POST", { message: pending.message, signature: pending.signature, link });
      toast({ tone: "ok", title: `${short(address)} linked`, body: `Switch back to ${short(pending.account)} whenever you like.` });
      setPending(null); q.refetch();
    } catch (x) { const m = (x as Error).message; if (!/reject|denied/i.test(m)) toast({ tone: "bad", title: "Couldn't link", body: m }); }
    finally { setBusy(false); }
  }
  async function unlink(w: string) {
    try { const s = await siwe(`Unlink ${w} from my Lockwatch portfolio.`); await postJson("/api/wallets", "DELETE", { ...s, address: w }); q.refetch(); }
    catch (x) { const m = (x as Error).message; if (!/reject|denied/i.test(m)) toast({ tone: "bad", title: "Couldn't unlink", body: m }); }
  }

  const t = q.data?.totals;
  const own = address && account && address.toLowerCase() === account.toLowerCase();
  return (
    <>
      <PageHead title="Portfolio" crumb="Yours" aside={own && !pending ? <button className="btn-ghost" onClick={start} disabled={busy}>{busy ? <Spinner /> : <Icon name="plus" />}Link a wallet</button> : undefined}>
        Every wallet you hold veBTC in, on one board. Linking proves you own each wallet with a signature; it gives Lockwatch no access to any of them.
      </PageHead>

      {pending && (
        <section className="panel mb-6 border-btc p-5" aria-live="polite">
          <div className="board-label">Linking a wallet</div>
          {!switched
            ? <p className="mt-2 text-sm text-mute">Step 2 of 2. In your wallet, switch to the wallet you want to link. This page will wait.</p>
            : <p className="mt-2 text-sm text-mute">Step 2 of 2. Sign with <span className="num text-paper">{short(address!)}</span> to link it to <span className="num text-paper">{short(pending.account)}</span>.</p>}
          <div className="mt-4 flex gap-2">
            <button className="btn-primary btn-sm" disabled={!switched || busy} onClick={finish}>{busy ? <Spinner /> : null}Sign and link</button>
            <button className="btn-ghost btn-sm" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </section>
      )}

      {!account ? <State title="Connect a wallet">Connect your main wallet. You can link the others from here.</State>
        : q.isLoading ? <Skeleton className="h-40 w-full" />
        : q.isError ? <State tone="error" title="Couldn't load the portfolio">{String(q.error)}</State>
        : t && <>
          <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Locked" value={`${btc(t.locked)} BTC`} sub={`${t.locks} lock${t.locks === 1 ? "" : "s"} · ${t.wallets} wallet${t.wallets === 1 ? "" : "s"}`} />
            <Stat label="Next unlock" value={t.nextUnlock ? when(t.nextUnlock) : "None"} />
            <Stat label="Covered" value={t.coverage === null ? "–" : `${Math.round(t.coverage)}%`} sub="of running BTC has a plan" />
            <Stat label="Ended, unclaimed" value={`${btc(t.idle)} BTC`} tone={BigInt(t.idle) > 0n ? "text-signal" : undefined} />
          </div>
          {t.loans > 0 && <p className="mt-3 text-sm text-mute">MUSD loans: <span className="num text-paper">{usd(t.loanDebt)} MUSD</span> against <span className="num text-paper">{btc(t.loanColl)} BTC</span> across {t.loans} wallet{t.loans === 1 ? "" : "s"}.</p>}

          <div className="mt-8 space-y-6">
            {q.data!.wallets.map((w) => {
              const isAcct = w.address.toLowerCase() === account.toLowerCase();
              return (
                <section key={w.address} aria-label={`Wallet ${w.address}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                    <h2 className="flex items-center gap-2 text-paper"><span className="num">{short(w.address)}</span><span className="board-label">{isAcct ? "Main" : "Linked"}</span></h2>
                    <div className="flex items-center gap-1">
                      {w.loan && <span className="mr-2 text-xs text-mute">Loan <span className={w.loan.risk === "safe" ? "text-paper" : "text-signal"}>{pct(w.loan.icr)}</span></span>}
                      <CalendarExport address={w.address} compact />
                      {!isAcct && own && <button className="btn-ghost btn-sm" onClick={() => unlink(w.address)} aria-label={`Unlink ${w.address}`}>Unlink</button>}
                    </div>
                  </div>
                  {!w.locks.length ? <p className="py-4 text-sm text-faint">No veBTC locks.</p> : (
                    <ul className="divide-y divide-hair">
                      {w.locks.map((l) => (
                        <li key={l.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-4 py-3 text-sm sm:grid-cols-[5rem_8rem_1fr_auto]">
                          <LockLink id={l.id} />
                          <span className="num text-paper">{btc(l.amount)} BTC</span>
                          <span className="hidden text-mute sm:block">{l.permanent ? "Permanent" : when(l.end)}{l.protection?.active && <> · {MODES[l.protection.mode].toLowerCase()}</>}{!!l.autoExtend && " · auto-extend"}{l.autoRewards && " · rewards"}</span>
                          <StatusPill status={l.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
          {own && q.data!.wallets.length === 1 && <p className="mt-6 text-sm text-faint">Only one wallet so far. <button className="underline decoration-line underline-offset-[3px] hover:text-paper" onClick={start}>Link another</button>, or follow wallets you don't own on the <Link className="underline decoration-line underline-offset-[3px] hover:text-paper" href="/watch">watchlist</Link>.</p>}
        </>}
    </>
  );
}
