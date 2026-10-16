"use client";
import { useCallback, useEffect, useState } from "react";
import { ASSET_META, parseAsset, type Asset } from "@lockwatch/sdk";
import { ADDR } from "./env";

export type { Asset };
const MEZO_VAULT = (process.env.NEXT_PUBLIC_LOCKWATCH_VAULT_MEZO || ADDR.lockwatchVaultMezo || null) as `0x${string}` | null;
const BTC_VAULT = (process.env.NEXT_PUBLIC_LOCKWATCH_VAULT || ADDR.lockwatchVault || null) as `0x${string}` | null;

/** Everything a page needs to act on one vote-escrow: contracts, units and copy. */
export function assetCfg(a: Asset) {
  const m = ASSET_META[a];
  return {
    ...m,
    veAddr: (a === "mezo" ? ADDR.veMEZO : ADDR.veBTC) as `0x${string}`,
    token: (a === "mezo" ? ADDR.mezo : ADDR.btc) as `0x${string}`,
    vault: a === "mezo" ? MEZO_VAULT : BTC_VAULT,
    q: a === "mezo" ? "asset=mezo" : "",
    /** extend presets: veBTC caps at ~4 weeks, veMEZO at 4 years */
    extendStep: a === "mezo" ? 52 * 7 * 86400 : 28 * 86400,
    extendLabel: a === "mezo" ? "+1 year" : "+4 weeks",
  };
}
export const withAsset = (href: string, a?: Asset | string | null) =>
  a === "mezo" ? `${href}${href.includes("?") ? "&" : "?"}asset=mezo` : href;

/** ?asset=mezo in the URL, kept in sync without a navigation (works on statically rendered pages). */
export function useAsset(): [Asset, (a: Asset) => void] {
  const [asset, set] = useState<Asset>("btc");
  useEffect(() => {
    const read = () => set(parseAsset(new URLSearchParams(window.location.search).get("asset")));
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  const choose = useCallback((a: Asset) => {
    const u = new URL(window.location.href);
    if (a === "mezo") u.searchParams.set("asset", "mezo"); else u.searchParams.delete("asset");
    window.history.replaceState(window.history.state, "", u.toString());
    set(a);
  }, []);
  return [asset, choose];
}
