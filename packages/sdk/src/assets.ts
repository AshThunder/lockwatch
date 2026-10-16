import { ADDRESSES, type ChainId } from "./addresses";

/** Lockwatch protects two vote-escrow locks on Mezo. Both are tigris VotingEscrow NFTs. */
export type Asset = "btc" | "mezo";
export const ASSETS: Asset[] = ["btc", "mezo"];

export interface AssetMeta {
  asset: Asset;
  symbol: "BTC" | "MEZO";
  ve: "veBTC" | "veMEZO";
  maxLockSec: number;
  /** MUSD modes (open a loan at expiry) only exist for BTC collateral. */
  musdModes: boolean;
  /** veBTC voter has bribes + fees; veMEZO BoostVoter has bribes only. */
  feeRewards: boolean;
  decimals: number; // display precision
}

export const ASSET_META: Record<Asset, AssetMeta> = {
  btc: { asset: "btc", symbol: "BTC", ve: "veBTC", maxLockSec: 30 * 86400, musdModes: true, feeRewards: true, decimals: 4 },
  mezo: { asset: "mezo", symbol: "MEZO", ve: "veMEZO", maxLockSec: 4 * 365 * 86400, musdModes: false, feeRewards: false, decimals: 2 },
};

/** DB ledger key. veBTC and veMEZO token ids overlap, so every lock-scoped table keys veMEZO rows under
 *  chainId + 1_000_000 (31611 → 1031611). Non-lock tables (troves, subscriptions, watchlists) stay on chainId. */
export const MEZO_LEDGER_OFFSET = 1_000_000;
export const ledgerId = (chainId: number, asset: Asset): number => (asset === "mezo" ? chainId + MEZO_LEDGER_OFFSET : chainId);
export const assetOfLedger = (ledger: number): Asset => (ledger >= MEZO_LEDGER_OFFSET ? "mezo" : "btc");
export const chainOfLedger = (ledger: number): ChainId => (ledger >= MEZO_LEDGER_OFFSET ? ledger - MEZO_LEDGER_OFFSET : ledger) as ChainId;
export const parseAsset = (v: unknown): Asset => (v === "mezo" ? "mezo" : "btc");

export function assetContracts(chainId: ChainId, asset: Asset) {
  const a = ADDRESSES[chainId];
  return asset === "mezo"
    ? { ve: a.veMEZO, voter: a.veMEZOVoter, token: a.mezo, vault: a.lockwatchVaultMezo, legacyVaults: [] as `0x${string}`[] }
    : { ve: a.veBTC, voter: a.voter, token: a.btc, vault: a.lockwatchVault, legacyVaults: a.lockwatchVaultsLegacy };
}
