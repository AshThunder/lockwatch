"use client";
import { useState } from "react";
import Link from "next/link";
import { useAccount, useReadContract, useWriteContract, useSignTypedData, useWaitForTransactionReceipt, useChainId } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { veBTCAbi, lockwatchVaultAbi, bosAbi, openTroveTypedData, Mode, MIN_NET_DEBT, GAS_COMPENSATION, validLockEnds } from "@lockwatch/sdk";
import { ADDR, VAULT, CHAIN_ID } from "@/lib/env";
import { btc, usd, fetcher } from "@/lib/format";
import { CountdownRing, ExplorerLink, useNow } from "@/components/ui";

const MODES = [
  { m: Mode.RETURN, t: "Return to my wallet", d: "BTC goes straight back to you the moment the lock unlocks." },
  { m: Mode.RELOCK, t: "Re-lock it", d: "A new veBTC lock is minted to you, so you keep voting power and rewards." },
  { m: Mode.MUSD, t: "Open an MUSD loan", d: "BTC becomes collateral for a loan in your name; MUSD lands in your wallet." },
  { m: Mode.MUSD_SAVINGS, t: "MUSD → savings", d: "Same loan, and the MUSD is deposited into sMUSD for you to earn yield." },
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
    !smusdOk && "sMUSD isn't live on testnet yet — pick MUSD loan",
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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/dashboard" className="text-sm text-mute">← My locks</Link>
      <div className="card flex items-center gap-5">
        <CountdownRing end={end} size={96} />
        <div>
          <div className="text-sm text-mute">Protect lock #{params.id}</div>
          <div className="num text-3xl font-bold">{btc(amount)} BTC</div>
          <div className="text-xs text-mute">Unlocks {end ? new Date(end * 1000).toUTCString().slice(0, 22) + " UTC" : "…"}</div>
        </div>
      </div>

      <section className="card space-y-4">
        <h2 className="font-semibold">1 · What should happen at expiry?</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {MODES.map((x) => (
            <button key={x.m} onClick={() => { setMode(x.m); setSig(null); }} className={`rounded-xl border p-4 text-left transition ${mode === x.m ? "border-btc bg-btc/10" : "border-line hover:border-white/20"}`}>
              <div className="font-semibold">{x.t}</div>
              <div className="mt-1 text-xs text-mute">{x.d}</div>
            </button>
          ))}
        </div>
        {mode === Mode.RELOCK && (
          <label className="block text-sm">Re-lock for <b>{weeks} week{weeks > 1 ? "s" : ""}</b> (max ~4, Mezo caps locks at 30 days)
            <input type="range" min={1} max={4} value={weeks} onChange={(e) => setWeeks(+e.target.value)} className="mt-2 w-full accent-btc" />
            <span className="text-xs text-mute">Next valid end dates: {ends.map((e) => new Date(e * 1000).toISOString().slice(5, 10)).join(", ")} (Thursdays 00:00 UTC)</span>
          </label>
        )}
        {musdMode && (
          <div className="space-y-2 text-sm">
            <label className="block">Borrow <b className="num">{debt.toLocaleString()} MUSD</b>
              <input type="range" min={2000} max={Math.max(2000, maxDebt)} step={100} value={debt} onChange={(e) => { setDebt(+e.target.value); setSig(null); }} className="mt-2 w-full accent-btc" />
            </label>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg bg-black/30 p-2">Collateral ratio<div className={`num text-lg ${icr >= 150 ? "text-ok" : "text-bad"}`}>{icr ? icr.toFixed(0) : "–"}%</div></div>
              <div className="rounded-lg bg-black/30 p-2">BTC price<div className="num text-lg">${usd(p)}</div></div>
              <div className="rounded-lg bg-black/30 p-2">Debt incl. fees<div className="num text-lg">{usd(composite)}</div></div>
            </div>
            <p className="text-xs text-mute">If the price moves and the loan can't open at expiry, the vault returns your BTC instead. Signing any other MUSD action before expiry invalidates this signature — we'll alert you to re-sign. Bitcoin-wallet (Passport) accounts can't sign this; use an EVM wallet for MUSD modes.</p>
          </div>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">2 · Approve Lockwatch on this one lock</h2>
        <p className="text-xs text-mute">Per-lock approval only. The vault can withdraw this lock after it expires and must send everything to you.</p>
        <button className="btn-primary" disabled={!VAULT || !isOwner || isApproved || isPending} onClick={() => VAULT && writeContract({ address: ADDR.veBTC, abi: veBTCAbi, functionName: "approve", args: [VAULT, id] })}>
          {isApproved ? "✓ Approved" : "Approve lock"}
        </button>
      </section>

      {musdMode && (
        <section className="card space-y-3">
          <h2 className="font-semibold">3 · Sign the loan terms</h2>
          <p className="text-xs text-mute">EIP-712 “OpenTrove” for MUSD BorrowerOperationsSignatures: exactly {btc(amount)} BTC collateral, {debt.toLocaleString()} MUSD, borrower = you, valid until 14 days after expiry.</p>
          <button className="btn-primary" disabled={!!sig || signing || blockers.length > 0} onClick={sign}>{sig ? "✓ Signed" : signing ? "Check wallet…" : "Sign"}</button>
        </section>
      )}

      <section className="card space-y-3">
        <h2 className="font-semibold">{musdMode ? 4 : 3} · Turn on auto-protect</h2>
        <ul className="space-y-1 text-xs text-mute">
          <li>✓ Funds, new locks and loans can only go to <b>you</b> (the lock owner at expiry).</li>
          <li>✓ No admin, no upgrade, no withdraw function. If any step fails, your BTC is returned to you.</li>
          <li>✓ Votes are cleared automatically (Mezo allows this from 01:00 UTC on the Thursday the lock expires).</li>
        </ul>
        {blockers.length > 0 && <div className="rounded-lg bg-warn/10 p-3 text-xs text-warn">{blockers.map((b) => <div key={b}>• {b}</div>)}</div>}
        <button className="btn-primary" disabled={blockers.length > 0 || !isApproved || (musdMode && !sig) || isPending} onClick={register}>
          {isPending || receipt.isLoading ? "Confirming…" : receipt.isSuccess ? "🛡 Protected" : "Enable protection"}
        </button>
        {hash && <div className="text-xs"><ExplorerLink kind="tx" id={hash}>View transaction</ExplorerLink></div>}
        {error && <div className="text-xs text-bad">{error.message.split("\n")[0]}</div>}
      </section>
    </div>
  );
}
