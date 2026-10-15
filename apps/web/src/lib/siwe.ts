"use client";
import { useAccount, useSignMessage } from "wagmi";
import { createSiweMessage } from "viem/siwe";
import { CHAIN_ID } from "./env";
import { fetcher } from "./format";

/** Fresh single-use SIWE signature for one account-scoped write. */
export function useSiwe() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  return async (statement: string, as?: `0x${string}`) => {
    const who = as ?? address;
    if (!who) throw new Error("Connect a wallet first");
    const { nonce } = await fetcher<{ nonce: string }>("/api/auth/nonce");
    const message = createSiweMessage({ address: who, chainId: CHAIN_ID, domain: window.location.host, nonce, uri: window.location.origin, version: "1", statement });
    return { message, signature: await signMessageAsync({ message, account: who }) };
  };
}

export async function postJson<T>(url: string, method: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j as T;
}
