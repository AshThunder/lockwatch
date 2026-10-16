"use client";
import { useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { fetcher, btc, short } from "@/lib/format";
import { MODES } from "@/lib/modes";
import { PageHead, State, Skeleton, StatusPill, ExplorerLink, when, ago } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { AssetSwitch } from "@/components/Asset";
import { useAsset, withAsset, type Asset } from "@/lib/asset";

type Item = { kind: string; lock_id: string; owner: string; mode: number; tx_hash: string | null; amount: string | null; new_lock_id: string | null; detail: string | null; ts: number };
const SIZE = 20;
const KIND_TEXT: Record<string, (i: Item, sym: string) => string> = {
  protected: (i, sym) => `Claimed${i.amount ? ` ${btc(i.amount)} ${sym}` : ""} and ${MODES[i.mode].toLowerCase()}${i.new_lock_id ? ` as lock #${i.new_lock_id}` : ""}`,
  registered: (i) => `Auto-protect on. Plan: ${MODES[i.mode].toLowerCase()}`,
  unregistered: () => "Auto-protect switched off by the owner",
  fallback: (i, sym) => `Plan couldn't run (${i.detail ?? "reverted"}). ${sym} sent to the owner instead`,
  retrying: (i) => `Keeper retrying: ${i.detail ?? "unknown error"}`,
  stuck: (i) => `Keeper stopped after 3 attempts: ${i.detail ?? "unknown error"}`,
};

export default function Activity() {
  const { address } = useAccount();
  const [mine, setMine] = useState(false);
  const [offset, setOffset] = useState(0);
  const [asset, setAssetRaw] = useAsset();
  const setAsset = (a: Asset) => { setAssetRaw(a); setOffset(0); };
  const SYM = asset === "mezo" ? "MEZO" : "BTC";
  const filter = mine && address ? `&owner=${address}` : "";
  const q = useQuery({ queryKey: ["activity-feed", asset, filter, offset], queryFn: () => fetcher<{ items: Item[]; hasMore: boolean }>(`/api/activity?asset=${asset}&limit=${SIZE}&offset=${offset}${filter}`), placeholderData: keepPreviousData, refetchInterval: 20_000 });
  const items = q.data?.items ?? [];
  return (
    <div className="space-y-8">
      <PageHead title="Keeper activity" aside={<><AssetSwitch value={asset} onChange={setAsset} />{address ? (
        <div role="radiogroup" aria-label="Show" className="inline-flex rounded-[4px] border border-line p-0.5">
          {[[false, "Everyone"], [true, "My locks"]].map(([v, l]) => <button key={String(v)} role="radio" aria-checked={mine === v} onClick={() => { setMine(v as boolean); setOffset(0); }} className={`min-h-[36px] rounded-[3px] px-3.5 text-sm ${mine === v ? "bg-raised text-paper" : "text-mute hover:text-paper"}`}>{l as string}</button>)}
        </div>) : null}</>}>
        Every plan registered with the vault and every claim the keeper makes, newest first, with the transaction on Mezo&rsquo;s explorer. Updates every 20 seconds.
      </PageHead>

      {q.isError ? <State tone="error" title="Couldn't load activity" action={<button className="btn-ghost" onClick={() => q.refetch()}>Try again</button>}>{(q.error as Error).message}</State>
        : q.isLoading ? <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        : items.length === 0 ? <State title={mine ? "No activity on your locks yet" : "No keeper activity yet"} action={<Link className="btn-primary" href="/dashboard"><Icon name="shield" />Protect a lock</Link>}>When a protected lock departs, the claim shows up here within minutes.</State>
        : (
          <div className={q.isPlaceholderData ? "opacity-60 transition-opacity" : ""}>
            <ol className="relative border-l border-line">
              {items.map((i) => (
                <li key={`${i.lock_id}-${i.kind}-${i.ts}`} className="relative grid gap-2 pb-6 pl-6 md:grid-cols-[9rem_minmax(0,1fr)_auto] md:gap-6">
                  <i className={`absolute -left-[5px] top-2 h-[9px] w-[9px] rounded-full border-2 border-ground ${i.kind === "protected" ? "bg-ok" : i.kind === "stuck" ? "bg-bad" : i.kind === "retrying" || i.kind === "fallback" ? "bg-signal" : "bg-btc"}`} aria-hidden="true" />
                  <div className="text-xs text-faint"><time dateTime={new Date(i.ts * 1000).toISOString()} title={when(i.ts)}>{ago(i.ts)}</time><div className="num mt-0.5">{when(i.ts)}</div></div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><StatusPill status={i.kind} /><Link href={withAsset(`/lock/${i.lock_id}`, asset)} className="num font-medium hover:text-btc">{asset === "mezo" ? "veMEZO" : "Lock"} #{i.lock_id}</Link><span className="text-xs text-faint">owner {short(i.owner)}</span></div>
                    <p className="mt-1.5 text-sm text-mute">{(KIND_TEXT[i.kind] ?? (() => i.kind))(i, SYM)}</p>
                  </div>
                  <div className="text-sm md:text-right">{i.tx_hash ? <ExplorerLink kind="tx" id={i.tx_hash} /> : <span className="text-xs text-faint">No transaction</span>}</div>
                </li>
              ))}
            </ol>
            <nav className="flex justify-between gap-3 border-t border-line pt-4" aria-label="Pagination">
              <button className="btn-ghost btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - SIZE))}><Icon name="chevL" />Newer</button>
              <button className="btn-ghost btn-sm" disabled={!q.data?.hasMore} onClick={() => setOffset(offset + SIZE)}>Older<Icon name="chevR" /></button>
            </nav>
          </div>
        )}
    </div>
  );
}
