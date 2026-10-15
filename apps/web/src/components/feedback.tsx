"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAccount, usePublicClient, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { Icon, Spinner } from "./Icon";
import { ExplorerLink } from "./ui";

// ---------------------------------------------------------------- toasts
type Toast = { id: number; tone: "ok" | "bad" | "info"; title: string; body?: ReactNode };
const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, set] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    set((x) => [...x.slice(-3), { ...t, id }]);
    setTimeout(() => set((x) => x.filter((y) => y.id !== id)), t.tone === "bad" ? 9000 : 5500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <ol className="pointer-events-none fixed inset-x-3 bottom-20 z-[60] flex flex-col items-end gap-2 md:bottom-6 md:right-6 md:left-auto" aria-live="polite" aria-label="Notifications">
        {items.map((t) => (
          <li key={t.id} className="toast-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border border-line bg-raised p-3.5 shadow-pop" role={t.tone === "bad" ? "alert" : "status"}>
            <Icon name={t.tone === "ok" ? "check" : t.tone === "bad" ? "alert" : "bell"} className={`mt-0.5 h-4 w-4 ${t.tone === "ok" ? "text-ok" : t.tone === "bad" ? "text-bad" : "text-btc"}`} />
            <div className="min-w-0 flex-1 text-sm"><div className="font-semibold">{t.title}</div>{t.body && <div className="mt-0.5 break-words text-mute">{t.body}</div>}</div>
            <button className="-m-1 grid h-8 w-8 place-items-center rounded text-faint hover:text-paper" onClick={() => set((x) => x.filter((y) => y.id !== t.id))} aria-label="Dismiss"><Icon name="close" className="h-3.5 w-3.5" /></button>
          </li>
        ))}
      </ol>
    </ToastCtx.Provider>
  );
}

// ---------------------------------------------------------------- transaction progress modal
type Phase = "idle" | "wallet" | "pending" | "done" | "failed";
const PHASES: { k: Phase; t: string }[] = [{ k: "wallet", t: "Confirm in your wallet" }, { k: "pending", t: "Waiting for Mezo" }, { k: "done", t: "Confirmed" }];

/** Mezo's RPC can under-estimate veBTC/vault calls (seen: viem estimate far below the ~479k cast reported).
 *  Estimate ourselves, add 50% plus a 100k floor margin, and fall back to the wallet's own estimate on error. */
export async function withGasBuffer<T extends object>(pc: unknown, account: `0x${string}` | undefined, args: T): Promise<T> {
  const c = pc as { estimateContractGas?: (a: unknown) => Promise<bigint> } | undefined;
  if (!c?.estimateContractGas || !account || "gas" in args) return args;
  try {
    const est = await c.estimateContractGas({ ...args, account });
    return { ...args, gas: (est * 3n) / 2n + 100_000n };
  } catch { return args; }
}

/** writeContract + receipt, surfaced as a modal with three steps, an explorer link and a toast. */
export function useTx(title: string, opts: { onSuccess?: () => void; successText?: string } = {}) {
  const { writeContractAsync, data: hash, reset } = useWriteContract();
  const pc = usePublicClient();
  const { address: account } = useAccount();
  const r = useWaitForTransactionReceipt({ hash });
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const done = useRef(false);
  useEffect(() => {
    if (!hash) return;
    if (r.isSuccess && !done.current) {
      done.current = true;
      if (r.data.status === "success") { setPhase("done"); toast({ tone: "ok", title: opts.successText ?? `${title}: confirmed` }); opts.onSuccess?.(); }
      else { setPhase("failed"); setErr("The transaction reverted onchain."); }
    }
    if (r.isError) { setPhase("failed"); setErr(r.error?.message.split("\n")[0] ?? "Could not read the receipt."); }
  }, [r.isSuccess, r.isError]); // eslint-disable-line react-hooks/exhaustive-deps
  async function run(args: Parameters<typeof writeContractAsync>[0]) {
    done.current = false; setErr(null); setPhase("wallet");
    try { await writeContractAsync(await withGasBuffer(pc, account, args)); setPhase("pending"); }
    catch (e) {
      const m = (e as Error).message.split("\n")[0];
      if (/reject|denied/i.test(m)) { setPhase("idle"); toast({ tone: "info", title: "Cancelled in wallet", body: "Nothing was sent." }); }
      else { setPhase("failed"); setErr(m); }
    }
  }
  const close = () => { setPhase("idle"); setErr(null); reset(); };
  const busy = phase === "wallet" || phase === "pending";
  const modal = <TxModal open={phase !== "idle"} title={title} phase={phase} hash={hash} error={err} onClose={close} />;
  return { run, busy, phase, hash, modal, success: phase === "done" || (!!r.data && r.data.status === "success") };
}

function TxModal({ open, title, phase, hash, error, onClose }: { open: boolean; title: string; phase: Phase; hash?: `0x${string}`; error: string | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  const idx = phase === "failed" ? (hash ? 1 : 0) : PHASES.findIndex((p) => p.k === phase);
  const closable = phase === "done" || phase === "failed";
  return (
    <dialog ref={ref} aria-labelledby="tx-title" onCancel={(e) => { if (!closable) e.preventDefault(); else onClose(); }}
      className="m-auto w-[min(92vw,26rem)] rounded-lg border border-line bg-panel p-0 text-paper shadow-pop">
      <div className="p-6">
        <h2 id="tx-title" className="font-display text-xl font-bold uppercase tracking-[0.02em]">{title}</h2>
        <ol className="mt-5 space-y-3">
          {PHASES.map((p, i) => {
            const st = phase === "failed" && i === idx ? "fail" : i < idx || phase === "done" ? "done" : i === idx ? "now" : "next";
            return (
              <li key={p.k} className="flex items-center gap-3 text-sm" aria-current={st === "now" ? "step" : undefined}>
                <span className={`grid h-7 w-7 place-items-center rounded-full border ${st === "done" ? "border-ok bg-ok/10 text-ok" : st === "now" ? "border-btc text-btc" : st === "fail" ? "border-bad text-bad" : "border-line text-faint"}`}>
                  {st === "done" ? <Icon name="check" className="h-3.5 w-3.5" /> : st === "now" ? <Spinner className="h-3.5 w-3.5" /> : st === "fail" ? <Icon name="close" className="h-3.5 w-3.5" /> : <span className="num text-xs">{i + 1}</span>}
                </span>
                <span className={st === "next" ? "text-faint" : ""}>{p.t}</span>
              </li>
            );
          })}
        </ol>
        {error && <p className="mt-5 break-words rounded border border-bad/40 bg-bad/[0.06] p-3 text-xs leading-relaxed text-bad" role="alert">{error}</p>}
        {hash && <div className="mt-5 text-sm"><ExplorerLink kind="tx" id={hash}>View on Mezo explorer</ExplorerLink></div>}
        <div className="mt-6 flex justify-end">
          <button className={closable ? "btn-primary" : "btn-ghost"} onClick={onClose} disabled={!closable}>{closable ? "Done" : "Working…"}</button>
        </div>
      </div>
    </dialog>
  );
}
