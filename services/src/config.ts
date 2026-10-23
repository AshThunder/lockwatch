import { ADDRESSES, RPC, type ChainId, type Asset, chainById, ledgerId, assetContracts } from "@lockwatch/sdk";
import { createPublicClient, http, type Address } from "viem";

export interface Config {
  chainId: ChainId;
  asset: Asset; // which vote-escrow this pipeline serves
  ledger: number; // DB key for lock-scoped tables (chainId for veBTC, chainId+1e6 for veMEZO)
  ve: Address;
  voter: Address;
  rpc: string;
  vault: Address | null; // current vault (v2)
  legacyVaults: Address[]; // older vaults the keeper still serves (v1 holds lock #380's registration)
  rescue: Address | null; // LockwatchRescue
  distributor: Address | null; // RewardsDistributor (rebases) for this escrow
  rebaseMin: bigint; // dust threshold (wei) below which a rebase is not worth a claim
  rebaseMaxClaims: number; // claim txs per keeper pass (REBASE_MAX_PER_RUN)
  rebaseBudgetMs: number; // wall-clock budget per pass for rebase claims (REBASE_BUDGET_MS)
  appUrl: string;
  telegramToken?: string;
  resendKey?: string;
  emailFrom: string;
  keeperKey?: `0x${string}`; // never logged
  adminChatId?: string; // low-balance / dead-letter notices
}

export function loadConfig(env = process.env, asset: Asset = "btc"): Config {
  const chainId = (Number(env.CHAIN_ID ?? 31611) as ChainId);
  const base = loadBtc(env, chainId);
  if (asset === "btc") return base;
  const c = assetContracts(chainId, "mezo");
  return {
    ...base, asset, ledger: ledgerId(chainId, "mezo"), ve: c.ve, voter: c.voter,
    vault: (env.LOCKWATCH_VAULT_MEZO as Address | undefined) ?? c.vault, legacyVaults: [], rescue: null,
    distributor: (env.REBASE_DISTRIBUTOR_MEZO as Address | undefined) ?? c.distributor, rebaseMin: BigInt(env.REBASE_MIN_MEZO ?? 10n ** 16n), rebaseMaxClaims: Number(env.REBASE_MAX_PER_RUN ?? 20), rebaseBudgetMs: Number(env.REBASE_BUDGET_MS ?? 90_000), // 0.01 MEZO
  };
}

/** Every pipeline the worker runs: veBTC (with MUSD radar/rescue) and veMEZO. */
export const loadConfigs = (env = process.env): Config[] => [loadConfig(env, "btc"), loadConfig(env, "mezo")];

function loadBtc(env: NodeJS.ProcessEnv, chainId: ChainId): Config {
  return {
    chainId, asset: "btc", ledger: chainId, ve: ADDRESSES[chainId].veBTC, voter: ADDRESSES[chainId].voter,
    rpc: env.RPC_URL ?? RPC[chainId],
    vault: (env.LOCKWATCH_VAULT as Address | undefined) ?? ADDRESSES[chainId].lockwatchVault,
    legacyVaults: (env.LOCKWATCH_LEGACY_VAULTS ? env.LOCKWATCH_LEGACY_VAULTS.split(",").map((x) => x.trim()).filter(Boolean) as Address[] : ADDRESSES[chainId].lockwatchVaultsLegacy)
      .filter((v) => v.toLowerCase() !== ((env.LOCKWATCH_VAULT ?? ADDRESSES[chainId].lockwatchVault ?? "") as string).toLowerCase()),
    rescue: (env.LOCKWATCH_RESCUE as Address | undefined) ?? ADDRESSES[chainId].lockwatchRescue,
    distributor: (env.REBASE_DISTRIBUTOR as Address | undefined) ?? ADDRESSES[chainId].rebaseDistributor,
    rebaseMin: BigInt(env.REBASE_MIN_BTC ?? 10n ** 12n), rebaseMaxClaims: Number(env.REBASE_MAX_PER_RUN ?? 20), rebaseBudgetMs: Number(env.REBASE_BUDGET_MS ?? 90_000), // 0.000001 BTC
    appUrl: env.APP_URL ?? "https://lockwatch.online",
    telegramToken: env.TELEGRAM_BOT_TOKEN,
    resendKey: env.RESEND_API_KEY,
    emailFrom: env.EMAIL_FROM ?? "Lockwatch <alerts@lockwatch.app>",
    keeperKey: env.KEEPER_PRIVATE_KEY as `0x${string}` | undefined,
    adminChatId: env.ADMIN_TELEGRAM_CHAT_ID,
  };
}

export const publicClientFor = (c: Config) =>
  createPublicClient({ chain: chainById(c.chainId), transport: http(c.rpc, { retryCount: 3, timeout: 20_000 }), batch: { multicall: true } });

export const log = (scope: string, msg: string, extra?: Record<string, unknown>) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), scope, msg, ...extra }, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

/** Every vault the indexer/keeper serves: current first, then legacy. */
export const allVaults = (c: Pick<Config, "vault" | "legacyVaults">): Address[] => [...(c.vault ? [c.vault] : []), ...c.legacyVaults];
