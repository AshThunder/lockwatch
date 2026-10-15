"use client";
import { useState } from "react";
import Link from "next/link";
import { useAccount, useReadContract, useSignTypedData, useChainId } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { veBTCAbi, lockwatchVaultAbi, bosAbi, openTroveTypedData, Mode, MIN_NET_DEBT, GAS_COMPENSATION, validLockEnds } from "@lockwatch/sdk";
import { ADDR, VAULT, CHAIN_ID } from "@/lib/env";
import { btc, usd, fetcher, short } from "@/lib/format";
import { useNow, Countdown, ExpiryBar, Skeleton, when, PageHead, State } from "@/components/ui";
import { Icon, Spinner } from "@/components/Icon";
import { useTx, useToast } from "@/components/feedback";

const OUTCOMES = [
  { m: Mode.RETURN, icon: "wallet", t: "Back to my wallet", d: "The BTC lands in the wallet that owns the lock." },
  { m: Mode.RELOCK, icon: "relock", t: "Re-lock it", d: "A new veBTC lock is minted to you. Voting power and incentives continue." },
  { m: Mode.MUSD, icon: "coin", t: "Borrow MUSD", d: "The BTC opens a loan in your name. MUSD lands in your wallet." },
  { m: Mode.MUSD_SAVINGS, icon: "coin", t: "MUSD into savings", d: "Same loan, with the MUSD deposited into sMUSD for you." },
];

export default function Protect({ params }: { params: { id: string } }) {
  const id = BigInt(/^\d+$/.test(params.id) ? params.id : "0");
  const { address } = useAccount();
  const chainId = useChainId();
  const now = useNow(5000);
  const toast = useToast();
  const locked = useReadContract({ address: ADDR.veBTC, abi: veBTCAbi, functionName: "locked", args: [id] });
  const owner = useReadContract({ address: ADDR.veBTC, abi: veBTCAbi, functionName: "ownerOf", args: [id] });
  const approved = useReadContract({ address: ADDR.veBTC, abi: veBTCAbi, functionName: "getApproved", args: [id], query: { refetchInterval: 4000 } });
  const nonce = useReadContract({ address: ADDR.borrowerOperationsSignatures ?? undefined, abi: bosAbi, functionName: "getNonce", args: address ? [address] : undefined, query: { enabled: !!address && !!ADDR.borrowerOperationsSignatures } });
  const price = useQuery({ queryKey: ["price"], queryFn: () => fetcher<{ price: string }>("/api/radar/line?limit=1") });

  const [mode, setMode] = useState<Mode>(Mode.RETURN);
  const [weeks, setWeeks] = useState(4);
  const [debt, setDebt] = useState(2000);
  const [sig, setSig] = useState<`0x${string}` | null>(null);
  const [deadline, setDeadline] = useState<bigint>(0n);
  const { signTypedDataAsync, isPending: signing } = useSignTypedData();
  const approve = useTx(`Approve lock #${params.id}`, { onSuccess: () => approved.refetch(), successText: "Lockwatch approved on this lock." });
  const reg = useTx(`Turn on auto-protect`, { successText: `Lock #${params.id} is protected.` });

  if (!/^\d+$/.test(params.id)) return <State title="That isn't a lock number" action={<Link className="btn-ghost" href="/dashboard">My locks</Link>} />;
  if (owner.isError) return <State title={`Lock #${params.id} doesn't exist`} action={<Link className="btn-ghost" href="/dashboard">My locks</Link>}>It may have been withdrawn, or it isn&rsquo;t on this network.</State>;

  const amount = locked.data ? BigInt(locked.data.amount) : 0n;
  const end = locked.data ? Number(locked.data.end) : 0;
  const isOwner = !!address && owner.data?.toLowerCase() === address.toLowerCase();
  const isApproved = !!VAULT && approved.data?.toLowerCase() === VAULT.toLowerCase();
  const musdMode = mode === Mode.MUSD || mode === Mode.MUSD_SAVINGS;
  const p = BigInt(price.data?.price ?? "0");
  const debtWei = BigInt(debt) * 10n ** 18n;
  const composite = debtWei + GAS_COMPENSATION + debtWei / 200n;
  const icr = composite > 0n && p > 0n ? Number((amount * p) / composite) / 1e16 : 0;
  const maxDebt = p > 0n ? Math.floor(Number((amount * p) / 10n ** 18n / 10n ** 18n) / 1.5) : 0;
  const canBorrow = maxDebt >= 2000;
  const relockSeconds = weeks * 7 * 86400;
  const ends = validLockEnds(end > now ? end : now);
  const smusdOk = mode !== Mode.MUSD_SAVINGS || !!ADDR.smusd;
  const ended = end > 0 && end <= now;
  const blockers = [
    !VAULT && "LockwatchVault isn't deployed on this network yet.",
    !!address && !isOwner && "This wallet doesn't own the lock. Switch to the owner's wallet.",
    chainId !== CHAIN_ID && "Switch your wallet to Mezo.",
    ended && "This lock has already ended. Claim it from My locks.",
    musdMode && !canBorrow && "This lock is too small for an MUSD loan (minimum 2,000 MUSD at 150%).",
    musdMode && canBorrow && BigInt(debt) * 10n ** 18n < MIN_NET_DEBT && "MUSD loans need at least 2,000 MUSD.",
    musdMode && icr > 0 && icr < 150 && "Keep the collateral ratio at 150% or more.",
    !smusdOk && "sMUSD savings is mainnet-only. Pick Borrow MUSD on testnet.",
  ].filter(Boolean) as string[];

  async function sign() {
    if (!address || !ADDR.borrowerOperationsSignatures || !VAULT) return;
    const dl = BigInt(end + 14 * 86400);
    const td = openTroveTypedData({ chainId: CHAIN_ID, bos: ADDR.borrowerOperationsSignatures, assetAmount: amount, debtAmount: debtWei, borrower: address, recipient: mode === Mode.MUSD_SAVINGS ? VAULT : address, nonce: nonce.data ?? 0n, deadline: dl });
    try { setSig(await signTypedDataAsync(td)); setDeadline(dl); toast({ tone: "ok", title: "Loan terms signed", body: "Nothing was sent onchain." }); }
    catch (e) { toast({ tone: /reject|denied/i.test((e as Error).message) ? "info" : "bad", title: "Not signed", body: (e as Error).message.split("\n")[0] }); }
  }
  const register = () => VAULT && reg.run({
    address: VAULT, abi: lockwatchVaultAbi, functionName: "register",
    args: [id, { owner: "0x0000000000000000000000000000000000000000", mode, relockDuration: mode === Mode.RELOCK ? relockSeconds : 0, deadline: musdMode ? deadline : 0n, debt: musdMode ? debtWei : 0n, sig: musdMode ? sig! : "0x" }],
  });

  const ownerAddr = owner.data as string | undefined;
  const to = ownerAddr ? short(ownerAddr) : "the owner";
  const amt = `${btc(amount)} BTC`;
  const at = end ? when(end) : "departure";
  const outcome = {
    [Mode.RETURN]: <>claims <b>{amt}</b> and sends it to <b>{to}</b>, the wallet that owns the lock.</>,
    [Mode.RELOCK]: <>claims <b>{amt}</b> and locks it again for <b>{weeks} week{weeks > 1 ? "s" : ""}</b>, minting the new lock to <b>{to}</b>.</>,
    [Mode.MUSD]: <>claims <b>{amt}</b> and uses it as collateral for a <b>{debt.toLocaleString()} MUSD</b> loan in your name, sending the MUSD to <b>{to}</b>{icr ? <> at about <b>{icr.toFixed(0)}%</b> collateral</> : null}.</>,
    [Mode.MUSD_SAVINGS]: <>claims <b>{amt}</b>, opens a <b>{debt.toLocaleString()} MUSD</b> loan in your name, and deposits the MUSD into sMUSD for <b>{to}</b>.</>,
  }[mode];
  const signed = !musdMode || !!sig;
  const done = reg.success;
  const steps = [
    { k: "approve", t: "Approve", ok: isApproved },
    { k: "choose", t: "Choose", ok: isApproved && (!musdMode || signed) },
    ...(musdMode ? [{ k: "sign", t: "Sign terms", ok: signed }] : []),
    { k: "confirm", t: "Confirm", ok: done },
  ];
  const current = steps.findIndex((s) => !s.ok);

  return (
    <div className="mx-auto max-w-[60rem] space-y-10">
      {approve.modal}{reg.modal}
      <PageHead crumb={<Link href={`/lock/${params.id}`} className="mb-3 inline-flex min-h-[36px] items-center gap-1.5 text-sm text-mute hover:text-paper"><Icon name="back" />Lock #{params.id}</Link>}
        title={<>Protect lock <span className="num font-sans text-[0.8em] font-medium tracking-normal">#{params.id}</span></>}>
        Choose what happens the moment this lock ends. You approve one lock only, and you can switch it off any time before then.
      </PageHead>

      <section className="grid gap-6 rounded-lg border border-line bg-panel p-5 md:grid-cols-[1fr_1.3fr] md:p-6">
        <div><div className="label">In this lock</div><div className="num mt-1 text-3xl font-medium">{locked.data ? amt : <Skeleton className="h-8 w-32" />}</div><div className="mt-1 text-xs text-faint">Owner {ownerAddr ? short(ownerAddr) : "…"}</div></div>
        <div className="text-sm">
          <div className="flex justify-between gap-3">{end ? (ended ? <span className="text-bad">Ended {when(end)}</span> : <Countdown to={end} />) : <Skeleton className="h-4 w-28" />}<span className="text-xs text-faint">{end ? when(end) : ""}</span></div>
          <div className="mt-2.5"><ExpiryBar end={end} /></div>
        </div>
      </section>

      <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0,1fr))` }} aria-label="Progress">
        {steps.map((s, i) => {
          const st = s.ok ? "done" : i === current ? "now" : "next";
          return (
            <li key={s.k} aria-current={st === "now" ? "step" : undefined} className={`border-t-[3px] pt-2.5 text-sm ${st === "done" ? "border-ok" : st === "now" ? "border-btc" : "border-line text-faint"}`}>
              <span className="flex items-center gap-1.5">{st === "done" ? <Icon name="check" className="h-4 w-4 text-ok" /> : <span className="num text-xs">{i + 1}</span>}<span className="max-sm:sr-only">{s.t}</span></span>
            </li>
          );
        })}
      </ol>

      {!address && <State title="Connect the owner's wallet" action={<ConnectButton label="Connect wallet" />}>You can read the plan without a wallet. Approving and confirming need the wallet that owns lock #{params.id}.</State>}

      <Step n={1} title="Approve Lockwatch on this lock" done={isApproved}>
        <p className="text-sm leading-relaxed text-mute">A standard veBTC approval for lock #{params.id} only. The vault can only use it after the lock ends, and only toward its owner.</p>
        {isApproved ? <p className="mt-4 inline-flex items-center gap-2 text-sm text-ok"><Icon name="check" />Approved for Lockwatch on this lock</p> :
        <button className="btn-primary mt-4" disabled={!VAULT || !isOwner || approve.busy || ended} onClick={() => VAULT && approve.run({ address: ADDR.veBTC, abi: veBTCAbi, functionName: "approve", args: [VAULT, id] })}>
          {approve.busy ? <><Spinner />Approving</> : "Approve lock"}
        </button>}
      </Step>

      <Step n={2} title="Where should the BTC go?">
        <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2" role="radiogroup" aria-label="Outcome at departure">
          {OUTCOMES.map((x) => {
            const sel = mode === x.m;
            const off = x.m === Mode.MUSD_SAVINGS && !ADDR.smusd;
            return (
              <button key={x.m} role="radio" aria-checked={sel} disabled={off} onClick={() => { setMode(x.m); setSig(null); }}
                className={`relative bg-ground p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${sel ? "bg-raised" : "hover:bg-panel"}`}>
                {sel && <i className="absolute inset-x-0 top-0 h-[3px] bg-btc" aria-hidden="true" />}
                <div className="flex items-center gap-2.5 font-semibold"><Icon name={x.icon} className={`h-[18px] w-[18px] ${sel ? "text-btc" : "text-faint"}`} />{x.t}{off && <span className="pill ml-auto text-faint">Mainnet</span>}</div>
                <div className="mt-1.5 pl-[28px] text-sm leading-relaxed text-mute">{x.d}</div>
              </button>
            );
          })}
        </div>
        {mode === Mode.RELOCK && (
          <div className="mt-6">
            <label htmlFor="weeks" className="text-sm">Re-lock for <b className="num">{weeks} week{weeks > 1 ? "s" : ""}</b> <span className="text-mute">(Mezo caps locks at about 4 weeks)</span></label>
            <input id="weeks" type="range" min={1} max={4} value={weeks} onChange={(e) => setWeeks(+e.target.value)} className="mt-2" />
            <p className="text-xs text-faint">Valid end dates: {ends.map((e) => when(e)).join(" · ")}</p>
          </div>
        )}
        {musdMode && (
          <div className="mt-6 space-y-4 text-sm">
            {canBorrow ? <>
              <label htmlFor="debt">Borrow <b className="num">{debt.toLocaleString()} MUSD</b></label>
              <input id="debt" type="range" min={2000} max={Math.max(2000, maxDebt)} step={100} value={debt} onChange={(e) => { setDebt(+e.target.value); setSig(null); }} className="mt-2" />
              <dl className="grid grid-cols-3 divide-x divide-line rounded-md border border-line text-xs">
                <div className="p-3"><dt className="text-mute">Collateral ratio</dt><dd className={`num mt-1 text-lg ${icr >= 150 ? "text-ok" : "text-bad"}`}>{icr ? icr.toFixed(0) : "–"}%</dd></div>
                <div className="p-3"><dt className="text-mute">BTC price</dt><dd className="num mt-1 text-lg">${usd(p)}</dd></div>
                <div className="p-3"><dt className="text-mute">Debt with fees</dt><dd className="num mt-1 text-lg">{usd(composite)}</dd></div>
              </dl>
            </> : <p className="rounded-md border border-line p-3 text-mute">At today&rsquo;s price this lock supports at most <span className="num text-paper">{maxDebt.toLocaleString()} MUSD</span> at 150%, under the 2,000 MUSD minimum.</p>}
            <p className="text-xs leading-relaxed text-mute">If the loan can&rsquo;t open at departure, the vault sends your BTC to your wallet instead. Signing another MUSD action before then invalidates this permit, and we&rsquo;ll alert you to sign again. Bitcoin (Passport) wallets can&rsquo;t sign loan permits; use an EVM wallet.</p>
          </div>
        )}
      </Step>

      {musdMode && (
        <Step n={3} title="Sign the loan terms" done={!!sig}>
          <p className="text-sm leading-relaxed text-mute">A free EIP-712 signature for exactly {amt} of collateral and {debt.toLocaleString()} MUSD, borrower you, valid until 14 days after departure.</p>
          <button className="btn-primary mt-4" disabled={!!sig || signing || blockers.length > 0 || !address} onClick={sign}>{sig ? <><Icon name="check" />Signed</> : signing ? <><Spinner />Check your wallet</> : "Sign terms"}</button>
        </Step>
      )}

      <Step n={musdMode ? 4 : 3} title="Confirm" done={done}>
        <div className="rounded-md border border-line bg-panel p-5">
          <div className="label">Where your BTC goes</div>
          <p className="mt-2 text-[1.0625rem] leading-relaxed [&_b]:font-semibold [&_b]:text-btc">On <b>{at}</b>, Lockwatch {outcome}</p>
          <ul className="mt-4 space-y-2 text-sm text-mute">
            {["Funds, new locks and loans can only go to the lock's owner.", "No admin, no upgrade, no withdraw function. If any step fails, the BTC goes to your wallet.", "Votes are cleared first. Mezo allows this from 01:00 UTC on departure day."].map((t) => <li key={t} className="flex gap-2.5"><Icon name="check" className="mt-0.5 h-4 w-4 text-ok" />{t}</li>)}
          </ul>
        </div>
        {address && blockers.length > 0 && <ul className="mt-4 space-y-1.5 rounded-md border border-signal/40 bg-signal/[0.06] p-3.5 text-sm text-signal" role="status">{blockers.map((b) => <li key={b} className="flex gap-2"><Icon name="alert" className="mt-0.5 h-4 w-4" />{b}</li>)}</ul>}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={!address || blockers.length > 0 || !isApproved || (musdMode && !sig) || reg.busy || done} onClick={register}>
            {reg.busy ? <><Spinner />Confirming</> : done ? <><Icon name="shield" />Protected</> : "Turn on auto-protect"}
          </button>
          {done && <Link href={`/lock/${params.id}`} className="btn-ghost">View lock</Link>}
        </div>
      </Step>
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-4 border-t border-line pt-8" aria-labelledby={`step-${n}`}>
      <span className={`num grid h-9 w-9 place-items-center rounded-[4px] text-sm ${done ? "bg-ok text-ground" : "bg-flap text-paper shadow-flap"}`}>{done ? <Icon name="check" className="h-4 w-4" /> : n}</span>
      <div>
        <h2 id={`step-${n}`} className="pt-1 font-display text-2xl font-bold uppercase">{title}</h2>
        <div className="mt-3">{children}</div>
      </div>
    </section>
  );
}
