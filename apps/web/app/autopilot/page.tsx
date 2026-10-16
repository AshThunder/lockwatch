"use client";
import Link from "next/link";
import { useState } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { veBTCAbi, lockwatchVaultAbi, EXTEND_PRESETS, EXTEND_PRESETS_MEZO, nextExtendAt, MAX_LOCK_SECONDS, MEZO_MAX_LOCK_SECONDS } from "@lockwatch/sdk";
import { fetcher, btc } from "@/lib/format";
import { LEGACY_VAULTS } from "@/lib/env";
import { AssetSwitch } from "@/components/Asset";
import { useAsset, assetCfg, type Asset } from "@/lib/asset";
import { PageHead, State, Skeleton, LockLink, ExplorerLink, when, useNow } from "@/components/ui";
import { useTx } from "@/components/feedback";
import { Icon, Spinner } from "@/components/Icon";

type L = { asset?: Asset; id: string; amount: string; end: number; permanent: boolean; voted: boolean; status: string;
  protection: { active: boolean; mode: number } | null;
  autoExtend: { triggerWithin: number; duration: number; lastTx: string | null } | null; autoRewards: boolean };
type P = { wallets: { address: string; locks: L[] }[] };

type K = "off" | "max" | "step";
type Preset = { k: K; t: string; d: string };
/** Per-asset presets: veBTC runs on a 4-week horizon, veMEZO on 4 years. "step" maps to each asset's second preset. */
const PRESETS: Record<Asset, { list: Preset[]; step: { triggerWithin: number; duration: number }; max: { triggerWithin: number; duration: number }; maxLock: number }> = {
  btc: {
    list: [
      { k: "off", t: "Off", d: "The lock decays as usual." },
      { k: "max", t: "Keep at max", d: "Topped back up to four weeks every Thursday, so voting power stays near full." },
      { k: "step", t: "4 weeks at 7 days", d: "When fewer than 7 days remain, add four weeks." },
    ],
    step: EXTEND_PRESETS.fourWeeksAt7d, max: EXTEND_PRESETS.max, maxLock: MAX_LOCK_SECONDS,
  },
  mezo: {
    list: [
      { k: "off", t: "Off", d: "The lock decays as usual, and so does its veBTC boost." },
      { k: "max", t: "Keep at 4 years", d: "Topped back up every Thursday, so the boost it gives your veBTC never fades." },
      { k: "step", t: "1 year at 30 days", d: "When fewer than 30 days remain, add a year." },
    ],
    step: EXTEND_PRESETS_MEZO.yearAt30d, max: EXTEND_PRESETS_MEZO.max, maxLock: MEZO_MAX_LOCK_SECONDS,
  },
};
const presetOf = (e: L["autoExtend"]): K => !e ? "off" : e.duration === 0 ? "max" : "step";

export default function Autopilot() {
  const { address } = useAccount();
  const [asset, setAsset] = useAsset();
  const A = assetCfg(asset);
  const q = useQuery({ queryKey: ["portfolio", address], enabled: !!address, queryFn: () => fetcher<P>(`/api/portfolio?addresses=${address}`), refetchInterval: 15_000 });
  const running = (q.data?.wallets[0]?.locks ?? []).filter((l) => !l.permanent && l.status !== "expired" && l.status !== "withdrawn");
  const counts = { btc: running.filter((l) => (l.asset ?? "btc") === "btc").length, mezo: running.filter((l) => l.asset === "mezo").length };
  const locks = running.filter((l) => (l.asset ?? "btc") === asset);
  const appr = useReadContracts({ contracts: locks.map((l) => ({ address: A.veAddr, abi: veBTCAbi, functionName: "getApproved", args: [BigInt(l.id)] }) as const), query: { enabled: locks.length > 0, refetchInterval: 6000 } });

  return (
    <>
      <PageHead title="Autopilot" crumb="Yours">
        Keep each lock's voting power topped up and its rewards claimed, without opening the app every week. The keeper does the work; the lock never leaves your wallet.
      </PageHead>
      <AssetSwitch className="mb-6" value={asset} onChange={setAsset} counts={q.data ? counts : undefined} />
      {!address ? <State title="Connect a wallet">Autopilot is set per lock, so connect the wallet that holds them.</State>
        : q.isLoading ? <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-40 w-full" />)}</div>
        : q.isError ? <State tone="error" title="Couldn't load your locks">{String(q.error)}</State>
        : !locks.length ? <State title={`No running ${A.ve} locks`} action={<Link className="btn-ghost" href={asset === "mezo" ? "/dashboard?asset=mezo" : "/dashboard"}>My locks</Link>}>Autopilot works on locks that haven't ended yet.</State>
        : <div className="space-y-3">{locks.map((l, i) => <Row key={`${asset}-${l.id}`} asset={asset} l={l} approved={(appr.data?.[i]?.result as string | undefined)?.toLowerCase()} onDone={() => { q.refetch(); appr.refetch(); }} />)}</div>}
      <section className="mt-10 grid gap-3 md:grid-cols-2">
        <Link href="/rescue" className="panel group flex items-start gap-3 p-5 hover:border-mute">
          <Icon name="rescue" className="mt-0.5 h-5 w-5 text-btc" />
          <div><div className="font-medium text-paper">Loan rescue</div><p className="mt-1 text-sm text-mute">Top up your MUSD loan's collateral automatically if its ratio drops below a line you pick.</p></div>
        </Link>
        <Link href="/keeper" className="panel group flex items-start gap-3 p-5 hover:border-mute">
          <Icon name="pulse" className="mt-0.5 h-5 w-5 text-btc" />
          <div><div className="font-medium text-paper">Keeper status</div><p className="mt-1 text-sm text-mute">Every run, every transaction, and how much gas it has left.</p></div>
        </Link>
      </section>
    </>
  );
}

function Row({ l, asset, approved, onDone }: { l: L; asset: Asset; approved?: string; onDone: () => void }) {
  const now = useNow(60_000);
  const A = assetCfg(asset);
  const VAULT = A.vault;
  const P = PRESETS[asset];
  const [pick, setPick] = useState<K>(presetOf(l.autoExtend));
  const ok = !!VAULT && approved === VAULT.toLowerCase();
  const legacy = asset === "btc" && !!approved && LEGACY_VAULTS.some((v) => v.toLowerCase() === approved);
  const approve = useTx(`Approve lock #${l.id}`, { onSuccess: onDone, successText: "Lockwatch approved on this lock." });
  const ext = useTx(`Auto-extend for lock #${l.id}`, { onSuccess: onDone, successText: "Saved. The keeper takes it from here." });
  const rew = useTx(`Reward auto-claim for lock #${l.id}`, { onSuccess: onDone, successText: "Saved." });
  const cur = presetOf(l.autoExtend);
  const pol = pick === "off" ? null : pick === "max" ? P.max : P.step;
  const next = pol ? nextExtendAt(l.end, now, pol, P.maxLock) : null;
  const id = BigInt(l.id);
  const busy = approve.busy || ext.busy || rew.busy;

  const save = () => {
    if (!VAULT) return;
    if (pick === "off") ext.run({ address: VAULT, abi: lockwatchVaultAbi, functionName: "clearExtendPolicy", args: [id] });
    else ext.run({ address: VAULT, abi: lockwatchVaultAbi, functionName: "setExtendPolicy", args: [id, pol!.triggerWithin, pol!.duration] });
  };

  return (
    <article className="panel p-5" aria-label={`Lock ${l.id}`}>
      {approve.modal}{ext.modal}{rew.modal}
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3"><LockLink id={l.id} asset={asset} /><span className="num text-lg text-paper">{btc(l.amount, A.decimals)} {A.symbol}</span></div>
        <span className="text-xs text-faint">Ends {when(l.end)}</span>
      </div>

      {!ok && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded border border-hair bg-raised px-4 py-3 text-sm">
          <p className="text-mute">{legacy
            ? <>This lock is approved for the first Lockwatch vault. Re-save its plan on the current vault to use Autopilot; its end-of-lock plan carries over.</>
            : <>Approve Lockwatch on this lock once. It can extend the lock and claim rewards to you, nothing else.</>}</p>
          {legacy
            ? <Link className="btn-ghost btn-sm" href={`/protect/${l.id}`}>Re-save plan</Link>
            : <button className="btn-primary btn-sm" disabled={!VAULT || busy} onClick={() => VAULT && approve.run({ address: A.veAddr, abi: veBTCAbi, functionName: "approve", args: [VAULT, id] })}>{approve.busy ? <><Spinner />Approving</> : "Approve"}</button>}
        </div>
      )}

      <fieldset className="mt-5" disabled={!ok || busy}>
        <legend className="board-label">Auto-extend</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3" role="radiogroup">
          {P.list.map((p) => (
            <label key={p.k} className={`flex cursor-pointer flex-col gap-1 rounded border px-3.5 py-3 text-sm transition-colors ${pick === p.k ? "border-btc bg-raised" : "border-hair hover:border-line"} ${!ok ? "opacity-60" : ""}`}>
              <span className="flex items-center gap-2 text-paper"><input type="radio" name={`ext-${l.id}`} className="accent-[var(--btc)]" checked={pick === p.k} onChange={() => setPick(p.k)} />{p.t}</span>
              <span className="text-xs leading-relaxed text-mute">{p.d}</span>
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-faint">
          <span>{pol ? (next ? <>Next extension around {when(next)}</> : "Already at the longest lock allowed.") : l.autoExtend ? "Turning this off stops future extensions." : "Not set."}
            {l.autoExtend?.lastTx && <> · last <ExplorerLink kind="tx" id={l.autoExtend.lastTx}>extension</ExplorerLink></>}</span>
          <button className="btn-primary btn-sm" disabled={pick === cur || !ok || busy} onClick={save}>{ext.busy ? <><Spinner />Saving</> : "Save"}</button>
        </div>
        {l.voted && <p className="mt-2 text-xs text-mute">This lock is voting. Extending keeps the vote in place.</p>}
      </fieldset>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-hair pt-4">
        <div>
          <div className="board-label">Reward auto-claim</div>
          <p className="mt-1 text-sm text-mute">{asset === "mezo" ? "Boost-gauge incentives this lock earns are claimed weekly, straight to your wallet." : "Bribes and fees this lock earns are claimed weekly, straight to your wallet."}</p>
        </div>
        <button role="switch" aria-checked={l.autoRewards} aria-label={`Reward auto-claim for lock ${l.id}`} disabled={!ok || busy}
          onClick={() => VAULT && rew.run({ address: VAULT, abi: lockwatchVaultAbi, functionName: "setRewardsAuto", args: [id, !l.autoRewards] })}
          className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${l.autoRewards ? "border-btc bg-btc" : "border-line bg-raised"}`}>
          <i className={`absolute top-[3px] h-5 w-5 rounded-full bg-paper transition-[left] ${l.autoRewards ? "left-[24px]" : "left-[3px]"}`} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
