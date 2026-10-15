"use client";
import { useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { createSiweMessage } from "viem/siwe";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { CHAIN_ID, TG_BOT } from "@/lib/env";
import { fetcher } from "@/lib/format";
import { State, PageHead, StatusPill, Skeleton } from "@/components/ui";
import { Icon, Spinner } from "@/components/Icon";
import { useToast } from "@/components/feedback";

const GROUPS: [string, [string, string, string][]][] = [
  ["veBTC locks", [["lock_t7d", "7 days before departure", "Which lock, how much BTC, what auto-protect will do"], ["lock_t1d", "24 hours before", "Last call, with a link to extend or change the plan"], ["lock_expired", "Ended and unclaimed", "If a lock departs without protection"]]],
  ["Auto-protect", [["protected", "Keeper claimed a lock", "With the transaction link"], ["protect_failed", "Needs attention", "The keeper couldn't run your plan"], ["fallback", "Plan B ran", "BTC was sent to your wallet instead"]]],
  ["MUSD loans", [["radar_danger", "A redemption could reach my loan", "Before it happens"], ["radar_watch", "Weekly place in line", "One message a week"], ["icr_low", "Ratio near liquidation", "When collateral gets thin"]]],
];
const ALL = GROUPS.flatMap(([, k]) => k.map(([id]) => id));

export default function Alerts() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const toast = useToast();
  const [prefs, setPrefs] = useState<Record<string, boolean>>(Object.fromEntries(ALL.map((k) => [k, true])));
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const subs = useQuery({ queryKey: ["subs", address], enabled: !!address, queryFn: () => fetcher<{ channel: string; verified: boolean; target: string | null; prefs?: Record<string, boolean> }[]>(`/api/subscriptions?address=${address}`) });
  useEffect(() => { const p = subs.data?.find((s) => s.prefs && Object.keys(s.prefs).length)?.prefs; if (p) setPrefs((x) => ({ ...x, ...p })); }, [subs.data]);
  useEffect(() => { const e = new URLSearchParams(window.location.search).get("email"); if (e) setNotice(e === "verified" ? "Email confirmed. Alerts will arrive from Lockwatch." : "That confirmation link has expired. Send a new one below."); }, []);

  if (!address) return (
    <div className="space-y-8">
      <PageHead title="Alerts">Telegram and email, before each lock departs and whenever the keeper acts.</PageHead>
      <State title="Connect a wallet to set up alerts" action={<ConnectButton label="Connect wallet" />}>You sign in with your wallet. It&rsquo;s a free signature, not a transaction.</State>
    </div>
  );

  async function siwe() {
    const { nonce } = await fetcher<{ nonce: string }>("/api/auth/nonce");
    const message = createSiweMessage({ address: address!, chainId: CHAIN_ID, domain: window.location.host, nonce, uri: window.location.origin, version: "1", statement: "Sign in to Lockwatch alerts. This costs nothing." });
    return { message, signature: await signMessageAsync({ message }) };
  }
  async function subscribe(channel: "telegram" | "email") {
    setBusy(channel);
    try {
      const auth = await siwe();
      const r = await fetch("/api/subscriptions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...auth, channel, email: channel === "email" ? email : undefined, prefs }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      if (j.link) { window.open(j.link, "_blank", "noopener"); toast({ tone: "ok", title: "Telegram opened", body: "Press Start in the chat to link it." }); }
      else toast({ tone: "ok", title: "Check your inbox", body: `We sent a confirmation link to ${email}.` });
      subs.refetch();
    } catch (e) {
      const m = (e as Error).message.split("\n")[0];
      toast({ tone: /reject|denied/i.test(m) ? "info" : "bad", title: /reject|denied/i.test(m) ? "Sign-in cancelled" : "Couldn't save", body: m });
    } finally { setBusy(null); }
  }
  const has = (c: string) => subs.data?.find((s) => s.channel === c);
  const tg = has("telegram"), em = has("email");
  return (
    <div className="mx-auto max-w-[60rem] space-y-10">
      <PageHead title="Alerts">Choose where Lockwatch reaches you and what it sends. Signing in is a free wallet signature.</PageHead>
      {notice && <p className="rounded-md border border-line bg-panel px-4 py-3 text-sm" role="status">{notice}</p>}

      <section aria-labelledby="ch-h">
        <h2 id="ch-h" className="font-display text-2xl font-bold uppercase">Channels</h2>
        <div className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line">
          <div className="grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-center">
            <div className="flex items-start gap-3.5">
              <Icon name="telegram" className="mt-0.5 h-5 w-5 text-btc" />
              <div><div className="flex items-center gap-2 font-semibold">Telegram {subs.isLoading ? <Skeleton className="h-4 w-14" /> : tg && <StatusPill status={tg.verified ? "linked" : "pending"} />}</div>
                <p className="mt-1 text-sm text-mute">Instant messages from @{TG_BOT}. In the chat: /locks, /radar, /mute.</p></div>
            </div>
            <button className="btn-primary" disabled={busy !== null} onClick={() => subscribe("telegram")}>{busy === "telegram" ? <><Spinner />Check your wallet</> : tg ? "Re-link Telegram" : "Connect Telegram"}</button>
          </div>
          <div className="grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-end">
            <div className="flex items-start gap-3.5">
              <Icon name="mail" className="mt-0.5 h-5 w-5 text-btc" />
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 font-semibold">Email {em && <StatusPill status={em.verified ? "linked" : "pending"} />}{em?.target && <span className="num text-xs font-normal text-mute">{em.target}</span>}</div>
                <label htmlFor="email" className="sr-only">Email address</label>
                <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" className="field mt-2 max-w-sm" /></div>
            </div>
            <button className="btn-ghost" disabled={!/^\S+@\S+\.\S+$/.test(email) || busy !== null} onClick={() => subscribe("email")}>{busy === "email" ? <><Spinner />Check your wallet</> : "Send confirmation"}</button>
          </div>
        </div>
      </section>

      <section aria-labelledby="what-h">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="what-h" className="font-display text-2xl font-bold uppercase">What to send</h2>
          <span className="text-sm text-mute">Saved when you connect or re-link a channel.</span>
        </div>
        <div className="mt-4 grid gap-8 md:grid-cols-3">
          {GROUPS.map(([g, items]) => (
            <fieldset key={g}>
              <legend className="board-label">{g}</legend>
              <div className="mt-3 border-t border-line">
                {items.map(([k, l, d]) => (
                  <label key={k} className="flex min-h-[56px] cursor-pointer items-start gap-3 border-b border-hair py-3">
                    <input type="checkbox" checked={!!prefs[k]} onChange={(e) => setPrefs({ ...prefs, [k]: e.target.checked })} className="mt-0.5 h-4 w-4 accent-btc" />
                    <span><span className="block text-sm">{l}</span><span className="block text-xs text-faint">{d}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </section>
    </div>
  );
}
