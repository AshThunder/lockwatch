"use client";
import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { createSiweMessage } from "viem/siwe";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { CHAIN_ID } from "@/lib/env";
import { fetcher } from "@/lib/format";
import { Empty } from "@/components/ui";

const KINDS: [string, string][] = [
  ["lock_t7d", "Lock unlocks in 7 days"], ["lock_t1d", "Lock unlocks in 24 hours"], ["lock_expired", "Lock expired and unclaimed"],
  ["protected", "Auto-protect ran (with tx link)"], ["protect_failed", "Auto-protect needs attention"], ["fallback", "Plan B: BTC returned instead"],
  ["radar_danger", "Redemption could hit my loan"], ["radar_watch", "Weekly Radar position"], ["icr_low", "Collateral ratio near liquidation"],
];

export default function Alerts() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [prefs, setPrefs] = useState<Record<string, boolean>>(Object.fromEntries(KINDS.map(([k]) => [k, true])));
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const subs = useQuery({ queryKey: ["subs", address], enabled: !!address, queryFn: () => fetcher<{ channel: string; verified: boolean; target: string | null }[]>(`/api/subscriptions?address=${address}`) });
  if (!address) return <Empty title="Connect a wallet to set up alerts"><div className="mt-4 flex justify-center"><ConnectButton /></div></Empty>;

  async function siwe() {
    const { nonce } = await fetcher<{ nonce: string }>("/api/auth/nonce");
    const message = createSiweMessage({ address: address!, chainId: CHAIN_ID, domain: window.location.host, nonce, uri: window.location.origin, version: "1", statement: "Sign in to Lockwatch alerts. This costs nothing." });
    return { message, signature: await signMessageAsync({ message }) };
  }
  async function subscribe(channel: "telegram" | "email") {
    setMsg(null);
    try {
      const auth = await siwe();
      const r = await fetch("/api/subscriptions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...auth, channel, email: channel === "email" ? email : undefined, prefs }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      if (j.link) { window.open(j.link, "_blank"); setMsg("Telegram opened — press Start to link this chat."); }
      else setMsg(`Check ${email} for a confirmation link.`);
      subs.refetch();
    } catch (e) { setMsg((e as Error).message); }
  }
  const has = (c: string) => subs.data?.find((s) => s.channel === c);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div><h1 className="text-3xl font-bold">Alerts</h1><p className="text-sm text-mute">Sign in with your wallet (free, no transaction) and choose where we reach you.</p></div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card space-y-3">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Telegram</h2>{has("telegram")?.verified && <span className="pill bg-ok/10 text-ok">linked</span>}</div>
          <p className="text-xs text-mute">Instant messages from @{process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? "LockwatchBot"}. Commands: /locks /radar /mute</p>
          <button className="btn-primary w-full" onClick={() => subscribe("telegram")}>{has("telegram") ? "Re-link Telegram" : "Connect Telegram"}</button>
        </div>
        <div className="card space-y-3">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Email</h2>{has("email")?.verified && <span className="pill bg-ok/10 text-ok">{has("email")!.target}</span>}</div>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="w-full rounded-xl border border-line bg-black/30 px-3 py-2 text-sm outline-none focus:border-btc" />
          <button className="btn-primary w-full" disabled={!email.includes("@")} onClick={() => subscribe("email")}>Send confirmation</button>
        </div>
      </div>
      {msg && <div className="card text-sm">{msg}</div>}
      <div className="card">
        <h2 className="mb-3 font-semibold">What to send me</h2>
        <div className="grid gap-2 md:grid-cols-2">
          {KINDS.map(([k, l]) => (
            <label key={k} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/5">
              <input type="checkbox" checked={prefs[k]} onChange={(e) => setPrefs({ ...prefs, [k]: e.target.checked })} className="h-4 w-4 accent-btc" />
              <span className="text-sm">{l}</span>
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-mute">Saved when you connect a channel.</p>
      </div>
    </div>
  );
}
