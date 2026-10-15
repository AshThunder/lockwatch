"use client";
import { useState } from "react";
import Link from "next/link";
import { useAccount, useReadContract, useWriteContract, useSignTypedData, useWaitForTransactionReceipt, useChainId } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { veBTCAbi, lockwatchVaultAbi, bosAbi, openTroveTypedData, Mode, MIN_NET_DEBT, GAS_COMPENSATION, validLockEnds } from "@lockwatch/sdk";
import { ADDR, VAULT, CHAIN_ID } from "@/lib/env";
import { btc, usd, fetcher, short } from "@/lib/format";
import { ExplorerLink, useNow, Countdown, ExpiryBar, Skeleton, when } from "@/components/ui";
import { Icon } from "@/components/Icon";

const MODES = [
  { m: Mode.RETURN, t: "Return to my wallet", d: "BTC goes straight back to you the moment the lock unlocks." },
  { m: Mode.RELOCK, t: "Re-lock it", d: "A new veBTC lock is minted to you, so you keep voting power and rewards." },
  { m: Mode.MUSD, t: "Open an MUSD loan", d: "BTC becomes collateral for a loan in your name; MUSD lands in your wallet." },
  { m: Mode.MUSD_SAVINGS, t: "MUSD into savings", d: "Same loan, and the MUSD is deposited into sMUSD for you to earn yield." },
];

export default function Protect({ params }: { params: { id: string } }) {
  const id = BigInt(params.id);
  const { address } = useAccount();
  const chainId = useChainId();
  const now = useNow(5000);
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
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  const { signTypedDataAsync, isPending: signing } = useSignTypedData();

  const amount = locked.data ? BigInt(locked.data.amount) : 0n;
  const end = locked.data ? Number(locked.data.end) : 0;
  const isOwner = !!address && owner.data?.toLowerCase() === address.toLowerCase();
  const isApproved = !!VAULT && approved.data?.toLowerCase() === VAULT.toLowerCase();
  const musdMode = mode === Mode.MUSD || mode === Mode.MUSD_SAVINGS;
  const p = BigInt(price.data?.price ?? "0");
  const debtWei = BigInt(debt) * 10n ** 18n;
  const composite = debtWei + GAS_COMPENSATION + debtWei / 200n;
  const icr = composite > 0n && p > 0n ? Number((amount * p) / composite) / 1e16 : 0;
  const maxDebt = p > 0n ? Math.floor(Number((amount * p) / 10n ** 18n / 10n ** 18n) / 1.5) : 0; // ≥150% target
  const relockSeconds = weeks * 7 * 86400;
  const ends = validLockEnds(end > now ? end : now);
  const smusdOk = mode !== Mode.MUSD_SAVINGS || !!ADDR.smusd;
  const blockers = [
    !VAULT && "LockwatchVault isn't deployed on this network yet",
    !isOwner && "Connect the wallet that owns this lock",
    chainId !== CHAIN_ID && "Switch to Mezo",
    musdMode && BigInt(debt) * 10n ** 18n < MIN_NET_DEBT && "MUSD loans need at least 2,000 MUSD",
    musdMode && icr > 0 && icr < 150 && "Keep the collateral ratio at 150% or more",
    !smusdOk && "sMUSD savings is mainnet-only. Pick the MUSD loan on testnet",
  ].filter(Boolean) as string[];

  async function sign() {
    if (!address || !ADDR.borrowerOperationsSignatures || !VAULT) return;
    const dl = BigInt(end + 14 * 86400);
    const td = openTroveTypedData({ chainId: CHAIN_ID, bos: ADDR.borrowerOperationsSignatures, assetAmount: amount, debtAmount: debtWei, borrower: address, recipient: mode === Mode.MUSD_SAVINGS ? VAULT : address, nonce: nonce.data ?? 0n, deadline: dl });
    setSig(await signTypedDataAsync(td));
    setDeadline(dl);
  }

  const register = () => VAULT && writeContract({
    address: VAULT, abi: lockwatchVaultAbi, functionName: "register",
    args: [id, { owner: "0x0000000000000000000000000000000000000000", mode, relockDuration: mode === Mode.RELOCK ? relockSeconds : 0, deadline: musdMode ? deadline : 0n, debt: musdMode ? debtWei : 0n, sig: musdMode ? sig! : "0x" }],
  });

  const ownerAddr = owner.data as string | undefined;
  const to = ownerAddr ? short(ownerAddr) : "the lock owner";
  const amt = `${btc(amount)} BTC`;
  const at = end ? when(end) : "expiry";
  const outcome = {
    [Mode.RETURN]: <>withdraws <b>{amt}</b> and sends it straight to <b>{to}</b>, the wallet that owns the lock.</>,
    [Mode.RELOCK]: <>withdraws <b>{amt}</b> and locks it again for <b>{weeks} week{weeks > 1 ? "s" : ""}</b>, minting the new lock to <b>{to}</b>. Your voting power carries on.</>,
    [Mode.MUSD]: <>withdraws <b>{amt}</b> and uses it as collateral for a <b>{debt.toLocaleString()} MUSD</b> loan in your name. The MUSD is sent to <b>{to}</b>{icr ? <>, starting near a <b>{icr.toFixed(0)}%</b> collateral ratio</> : null}.</>,
    [Mode.MUSD_SAVINGS]: <>withdraws <b>{amt}</b>, opens a <b>{debt.toLocaleString()} MUSD</b> loan in your name, and deposits the MUSD into sMUSD for <b>{to}</b>.</>,
  }[mode];
  const signed = !musdMode || !!sig;
  const done = receipt.isSuccess;
  const steps = [
    { k: "approve", t: "Approve", ok: isApproved },
    { k: "choose", t: "Choose outcome", ok: isApproved },
    ...(musdMode ? [{ k: "sign", t: "Sign loan terms", ok: signed }] : []),
    { k: "confirm", t: "Confirm", ok: done },
  ];
  const current = steps.findIndex((s) => !s.ok);

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div>
        <Link href="/dashboard" className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-mute hover:text-paper"><Icon name="back" />My locks</Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-line pb-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.025em] md:text-[2.5rem]" style={{ fontStretch: "108%" }}>Protect lock #{params.id}</h1>
            <div className="num mt-2 text-xl text-mute">{locked.data ? amt : <Skeleton className="h-6 w-28" />}</div>
          </div>
          <div className="w-full text-sm sm:w-64">
            <div className="flex justify-between gap-3">{end ? (end > now ? <Countdown to={end} /> : <span className="text-bad">Expired</span>) : <Skeleton className="h-4 w-28" />}<span className="text-xs text-faint">{end ? when(end) : ""}</span></div>
            <div className="mt-2"><ExpiryBar end={end} /></div>
          </div>
        </div>
      </div>

      <ol className="grid gap-2 text-xs" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0,1fr))` }} aria-label="Steps">
        {steps.map((s, i) => {
          const state = s.ok ? "done" : i === current ? "now" : "next";
          return (
            <li key={s.k} aria-current={state === "now" ? "step" : undefined} className={`border-t-2 pt-2 ${state === "done" ? "border-btc text-paper" : state === "now" ? "border-paper text-paper" : "border-line text-faint"}`}>
              <span className="num mr-1.5">{state === "done" ? <Icon name="check" className="inline h-3.5 w-3.5 text-btc" /> : i + 1}</span><span className="max-sm:hidden">{s.t}</span>
            </li>
          );
        })}
      </ol>

      <Step n={1} title="Approve Lockwatch on this one lock" done={isApproved}>
        <p className="text-sm leading-relaxed text-mute">A per-lock approval, not your whole wallet. The vault can only act after the lock expires, and only toward its owner.</p>
        <button className="btn-primary mt-4" disabled={!VAULT || !isOwner || isApproved || isPending} onClick={() => VAULT && writeContract({ address: ADDR.veBTC, abi: veBTCAbi, functionName: "approve", args: [VAULT, id] })}>
          {isApproved ? <><Icon name="check" />Approved</> : "Approve lock"}
        </button>
      </Step>

      <Step n={2} title="What should happen when it unlocks?">
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Outcome at expiry">
          {MODES.map((x) => (
            <button key={x.m} role="radio" aria-checked={mode === x.m} onClick={() => { setMode(x.m); setSig(null); }}
              className={`group rounded-md border p-4 text-left transition-colors ${mode === x.m ? "border-btc bg-btc/[0.07]" : "border-line hover:border-faint"}`}>
              <div className="flex items-center gap-2.5 font-medium">
                <i className={`grid h-4 w-4 place-items-center rounded-full border ${mode === x.m ? "border-btc" : "border-faint"}`}>{mode === x.m && <i className="h-2 w-2 rounded-full bg-btc" />}</i>{x.t}
              </div>
              <div className="mt-1.5 pl-[26px] text-xs leading-relaxed text-mute">{x.d}</div>
            </button>
          ))}
        </div>
        {mode === Mode.RELOCK && (
          <label className="mt-5 block text-sm">Re-lock for <b className="num">{weeks} week{weeks > 1 ? "s" : ""}</b> <span className="text-mute">(Mezo caps locks at about 4 weeks)</span>
            <input type="range" min={1} max={4} value={weeks} onChange={(e) => setWeeks(+e.target.value)} className="mt-2" />
            <span className="text-xs text-faint">Next valid end dates: {ends.map((e) => when(e)).join(" · ")}</span>
          </label>
        )}
        {musdMode && (
          <div className="mt-5 space-y-4 text-sm">
            <label className="block">Borrow <b className="num">{debt.toLocaleString()} MUSD</b>
              <input type="range" min={2000} max={Math.max(2000, maxDebt)} step={100} value={debt} onChange={(e) => { setDebt(+e.target.value); setSig(null); }} className="mt-2" />
            </label>
            <dl className="grid grid-cols-3 divide-x divide-line border-y border-line text-xs">
              <div className="py-3 pr-3"><dt className="text-mute">Collateral ratio</dt><dd className={`num mt-1 text-lg ${icr >= 150 ? "text-ok" : "text-bad"}`}>{icr ? icr.toFixed(0) : "–"}%</dd></div>
              <div className="p-3"><dt className="text-mute">BTC price</dt><dd className="num mt-1 text-lg">${usd(p)}</dd></div>
              <div className="py-3 pl-3"><dt className="text-mute">Debt with fees</dt><dd className="num mt-1 text-lg">{usd(composite)}</dd></div>
            </dl>
            <p className="text-xs leading-relaxed text-mute">If the price moves and the loan can&rsquo;t open at expiry, the vault returns your BTC instead. Signing another MUSD action before expiry invalidates this signature, and we&rsquo;ll alert you to re-sign. Bitcoin-wallet (Passport) accounts can&rsquo;t sign this; use an EVM wallet for MUSD outcomes.</p>
          </div>
        )}
      </Step>

      {musdMode && (
        <Step n={3} title="Sign the loan terms" done={!!sig}>
          <p className="text-sm leading-relaxed text-mute">An EIP-712 OpenTrove signature for MUSD: exactly {amt} collateral, {debt.toLocaleString()} MUSD, borrower is you, valid until 14 days after expiry. Signing costs nothing.</p>
          <button className="btn-primary mt-4" disabled={!!sig || signing || blockers.length > 0} onClick={sign}>{sig ? <><Icon name="check" />Signed</> : signing ? "Check your wallet…" : "Sign terms"}</button>
        </Step>
      )}

      <Step n={musdMode ? 4 : 3} title="Confirm auto-protect" done={done}>
        <div className="rounded-md border border-line bg-base p-5">
          <div className="label">Where your BTC goes</div>
          <p className="mt-2 text-[0.95rem] leading-relaxed text-paper [&_b]:font-medium [&_b]:text-btc">On <b>{at}</b>, Lockwatch {outcome}</p>
          <ul className="mt-4 space-y-1.5 text-xs text-mute">
            <li className="flex gap-2"><Icon name="check" className="h-3.5 w-3.5 text-ok" />Funds, new locks and loans can only go to the lock&rsquo;s owner at expiry.</li>
            <li className="flex gap-2"><Icon name="check" className="h-3.5 w-3.5 text-ok" />No admin, no upgrade, no withdraw function. If any step fails, the BTC is returned to you.</li>
            <li className="flex gap-2"><Icon name="check" className="h-3.5 w-3.5 text-ok" />Votes are cleared first (Mezo allows this from 01:00 UTC on expiry day).</li>
          </ul>
        </div>
        {blockers.length > 0 && <ul className="mt-4 space-y-1 rounded-md border border-warn/30 bg-warn/[0.06] p-3 text-xs text-warn">{blockers.map((b) => <li key={b} className="flex gap-2"><Icon name="alert" className="h-3.5 w-3.5" />{b}</li>)}</ul>}
        <button className="btn-primary mt-4" disabled={blockers.length > 0 || !isApproved || (musdMode && !sig) || isPending} onClick={register}>
          {isPending || receipt.isLoading ? "Confirming…" : done ? <><Icon name="shield" />Protected</> : "Turn on auto-protect"}
        </button>
        {hash && <div className="mt-3 text-xs"><ExplorerLink kind="tx" id={hash}>View transaction</ExplorerLink></div>}
        {error && <p className="mt-3 text-xs text-bad" role="alert">{error.message.split("\n")[0]}</p>}
      </Step>
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3" aria-labelledby={`step-${n}`}>
      <span className={`num grid h-7 w-7 place-items-center rounded-full border text-xs ${done ? "border-btc bg-btc text-base" : "border-line text-mute"}`}>{done ? <Icon name="check" className="h-3.5 w-3.5" /> : n}</span>
      <div>
        <h2 id={`step-${n}`} className="pt-0.5 text-lg font-semibold tracking-tight">{title}</h2>
        <div className="mt-3">{children}</div>
      </div>
    </section>
  );
}
