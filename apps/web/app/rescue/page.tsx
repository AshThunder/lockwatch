"use client";
import Link from "next/link";
import { useState } from "react";
import { parseEther } from "viem";
import { useAccount, useReadContracts, useWriteContract, useSignTypedData, usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { ADDRESSES, lockwatchRescueAbi, bosAbi, erc20Abi, rescueTypedData } from "@lockwatch/sdk";
import { fetcher, btc, usd, pct } from "@/lib/format";
import { rescueSteps } from "@/lib/rescue";
import { CHAIN_ID, RESCUE } from "@/lib/env";
import { PageHead, State, Skeleton, Stat, ExplorerLink, when } from "@/components/ui";
import { useToast, withGasBuffer } from "@/components/feedback";
import { Icon, Spinner } from "@/components/Icon";

const ADDR = ADDRESSES[CHAIN_ID];
type Trove = { trove: { coll: string; debt: string; icr: string; rank: number; risk: string } | null };
type Auto = { rescue: { triggerIcr: string; addAmount: string; repayAmount: string; deadline: number; active: boolean; lastTx: string | null } | null };

export default function Rescue() {
  const { address } = useAccount();
  const t = useQuery({ queryKey: ["trove", address], enabled: !!address, queryFn: () => fetcher<Trove>(`/api/radar/${address}`) });
  const a = useQuery({ queryKey: ["automation", address], enabled: !!address, queryFn: () => fetcher<Auto>(`/api/automation?owner=${address}`), refetchInterval: 15_000 });
  const chain = useReadContracts({ query: { enabled: !!address && !!RESCUE, refetchInterval: 8000 }, contracts: RESCUE && address ? [
    { address: RESCUE, abi: lockwatchRescueAbi, functionName: "btcOf", args: [address] },
    { address: RESCUE, abi: lockwatchRescueAbi, functionName: "musdOf", args: [address] },
  ] as const : [] });
  const btcEscrow = (chain.data?.[0]?.result as bigint | undefined) ?? 0n;
  const musdEscrow = (chain.data?.[1]?.result as bigint | undefined) ?? 0n;

  const [trigger, setTrigger] = useState("150");
  const [add, setAdd] = useState("0.01");
  const [repay, setRepay] = useState("");
  const [days, setDays] = useState("30");
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const pc = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();

  const tv = Number(trigger), addWei = safe(add), repayWei = safe(repay);
  const formErr = !(tv >= 110 && tv <= 1000) ? "Pick a line between 110% and 1000%." : addWei === null || repayWei === null ? "Amounts must be numbers." : addWei === 0n && repayWei === 0n ? "Set a top-up amount, a repayment, or both." : !(Number(days) >= 1 && Number(days) <= 365) ? "Valid for 1 to 365 days." : null;
  const icr = t.data?.trove ? BigInt(t.data.trove.icr) : null;
  const rule = a.data?.rescue?.active ? a.data.rescue : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function tx(k: string, args: any) {
    setStep(k);
    const h = await writeContractAsync(await withGasBuffer(pc, address, args));
    const r = await pc!.waitForTransactionReceipt({ hash: h });
    if (r.status !== "success") throw new Error("The transaction reverted onchain.");
    return h;
  }
  async function turnOn() {
    if (!address || !RESCUE || !ADDR.borrowerOperationsSignatures || formErr) return;
    const bos = ADDR.borrowerOperationsSignatures;
    setErr(null);
    try {
      if (addWei! > btcEscrow) await tx("depositBtc", { address: RESCUE, abi: lockwatchRescueAbi, functionName: "depositBtc", value: addWei! - btcEscrow });
      if (repayWei! > musdEscrow) {
        await tx("approveMusd", { address: ADDR.musd, abi: erc20Abi, functionName: "approve", args: [RESCUE, repayWei! - musdEscrow] });
        await tx("depositMusd", { address: RESCUE, abi: lockwatchRescueAbi, functionName: "depositMusd", args: [repayWei! - musdEscrow] });
      }
      setStep("sign");
      let nonce = await pc!.readContract({ address: bos, abi: bosAbi, functionName: "getNonce", args: [address] });
      const deadline = BigInt(Math.floor(Date.now() / 1000) + Number(days) * 86400);
      const sig = async (kind: "AddColl" | "RepayMUSD", amount: bigint) => {
        const s = await signTypedDataAsync({ ...rescueTypedData(kind, { chainId: CHAIN_ID, bos, amount, borrower: address, nonce, deadline }) } as never);
        nonce += 1n; return s;
      };
      const addSig = addWei! ? await sig("AddColl", addWei!) : "0x";
      const repaySig = repayWei! ? await sig("RepayMUSD", repayWei!) : "0x";
      const h = await tx("setRule", { address: RESCUE, abi: lockwatchRescueAbi, functionName: "setRule", args: [{ triggerIcr: BigInt(tv) * 10n ** 16n, deadline, addAmount: addWei!, repayAmount: repayWei!, addSig, repaySig }] });
      toast({ tone: "ok", title: "Loan rescue is on", body: `If the ratio drops under ${tv}%, the keeper tops it up.` });
      void h; a.refetch(); chain.refetch();
    } catch (e) {
      const m = (e as Error).message.split("\n")[0];
      if (/reject|denied/i.test(m)) toast({ tone: "info", title: "Cancelled in wallet", body: "Anything already confirmed stays in your reserve; you can withdraw it." });
      else setErr(m);
    } finally { setStep(null); a.refetch(); chain.refetch(); }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function simple(k: string, args: any, ok: string) {
    setErr(null);
    try { await tx(k, args); toast({ tone: "ok", title: ok }); } catch (e) { const m = (e as Error).message.split("\n")[0]; if (!/reject|denied/i.test(m)) setErr(m); }
    finally { setStep(null); a.refetch(); chain.refetch(); }
  }

  const steps = addWei !== null && repayWei !== null ? rescueSteps({ add: addWei, repay: repayWei, btcEscrow, musdEscrow }) : [];
  return (
    <>
      <PageHead title="Loan rescue" crumb="Mezo">
        Set a line for your MUSD loan's collateral ratio. If it ever drops under that line, the keeper adds BTC from your own reserve, and can repay some MUSD too, in the same block. You sign the exact amounts in advance; nothing else can be done with them.
      </PageHead>
      {!RESCUE ? <State title="Not available on this network">Loan rescue is live on Mezo testnet.</State>
        : !address ? <State title="Connect a wallet">Connect the wallet that holds the MUSD loan.</State>
        : t.isLoading ? <Skeleton className="h-48 w-full" />
        : !t.data?.trove ? <State title="No MUSD loan on this wallet" action={<Link className="btn-ghost" href="/radar">Redemption Radar</Link>}>Rescue protects an open loan. Open one on Mezo, then come back.</State>
        : <>
          <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4">
            <Stat label="Collateral ratio" value={pct(t.data.trove.icr)} tone={icr! < BigInt(tv) * 10n ** 16n ? "text-signal" : undefined} />
            <Stat label="Collateral" value={`${btc(t.data.trove.coll)} BTC`} />
            <Stat label="Debt" value={`${usd(t.data.trove.debt)} MUSD`} />
            <Stat label="Reserve" value={`${btc(btcEscrow)} BTC`} sub={musdEscrow ? `${usd(musdEscrow)} MUSD` : undefined} />
          </div>

          {rule && (
            <section className="panel mt-6 p-5" aria-label="Current rule">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-paper"><i className="h-2 w-2 rounded-full bg-ok" aria-hidden="true" />Rescue is on</div>
                <button className="btn-ghost btn-sm" disabled={!!step} onClick={() => simple("clear", { address: RESCUE, abi: lockwatchRescueAbi, functionName: "clearRule" }, "Rescue is off")}>{step === "clear" ? <Spinner /> : null}Turn off</button>
              </div>
              <p className="mt-2 text-sm text-mute">Under <span className="num text-paper">{pct(rule.triggerIcr)}</span>: add <span className="num text-paper">{btc(rule.addAmount)} BTC</span>{BigInt(rule.repayAmount) > 0n && <>, repay <span className="num text-paper">{usd(rule.repayAmount)} MUSD</span></>}. Signed until {when(rule.deadline)}.{rule.lastTx && <> Last rescue: <ExplorerLink kind="tx" id={rule.lastTx}>transaction</ExplorerLink>.</>}</p>
              <p className="mt-2 text-xs text-faint">Any other signed loan action you take on Mezo uses up the signature. If that happens, save the rule again.</p>
            </section>
          )}

          <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
            <form className="panel space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); turnOn(); }} aria-label="Rescue rule">
              <h2 className="board-label">{rule ? "Replace the rule" : "Set a rule"}</h2>
              <label className="block text-sm"><span className="label">Rescue when the ratio drops under</span>
                <div className="mt-1.5 flex items-center gap-2"><input className="field num w-28" inputMode="decimal" value={trigger} onChange={(e) => setTrigger(e.target.value)} aria-describedby="trig-help" /><span className="text-mute">%</span></div>
                <span id="trig-help" className="mt-1 block text-xs text-faint">Mezo liquidates at 110%. Now: {pct(t.data.trove.icr)}.</span></label>
              <label className="block text-sm"><span className="label">Add from reserve</span>
                <div className="mt-1.5 flex items-center gap-2"><input className="field num w-40" inputMode="decimal" value={add} onChange={(e) => setAdd(e.target.value)} /><span className="text-mute">BTC</span></div></label>
              <label className="block text-sm"><span className="label">Also repay (optional)</span>
                <div className="mt-1.5 flex items-center gap-2"><input className="field num w-40" inputMode="decimal" placeholder="0" value={repay} onChange={(e) => setRepay(e.target.value)} /><span className="text-mute">MUSD</span></div></label>
              <label className="block text-sm"><span className="label">Signature valid for</span>
                <div className="mt-1.5 flex items-center gap-2"><input className="field num w-20" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /><span className="text-mute">days</span></div></label>
              {(formErr || err) && <p role="alert" className="text-sm text-bad">{formErr ?? err}</p>}
              <button className="btn-primary" disabled={!!formErr || !!step}>{step ? <><Spinner />Working</> : rule ? "Save new rule" : "Turn on rescue"}</button>
            </form>
            <aside className="space-y-4">
              <ol className="panel space-y-3 p-5 text-sm" aria-label="Steps">
                {steps.map((s, i) => <li key={s.k} className={`flex gap-3 ${step === s.k ? "text-paper" : "text-mute"}`}><span className="num w-4 text-faint">{step === s.k ? <Spinner className="h-3.5 w-3.5" /> : i + 1}</span>{s.t}</li>)}
              </ol>
              {(btcEscrow > 0n || musdEscrow > 0n) && (
                <div className="panel p-5 text-sm">
                  <div className="board-label">Your reserve</div>
                  <p className="mt-2 text-mute">Yours to take back any time. Withdrawing below the rule's amounts pauses the rescue.</p>
                  <button className="btn-ghost btn-sm mt-3" disabled={!!step} onClick={() => simple("withdraw", { address: RESCUE, abi: lockwatchRescueAbi, functionName: "withdraw", args: [btcEscrow, musdEscrow] }, "Reserve withdrawn")}><Icon name="arrow" className="h-3.5 w-3.5 rotate-180" />Withdraw all</button>
                </div>
              )}
            </aside>
          </section>
        </>}
    </>
  );
}

function safe(s: string): bigint | null {
  if (!s.trim()) return 0n;
  try { return parseEther(s.trim() as `${number}`); } catch { return null; }
}
