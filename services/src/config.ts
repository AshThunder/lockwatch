import { ADDRESSES, RPC, type ChainId, chainById } from "@lockwatch/sdk";
import { createPublicClient, http, type Address } from "viem";

export interface Config {
  chainId: ChainId;
  rpc: string;
  vault: Address | null;
  appUrl: string;
  telegramToken?: string;
  resendKey?: string;
  emailFrom: string;
  keeperKey?: `0x${string}`; // never logged
  adminChatId?: string; // low-balance / dead-letter notices
}

export function loadConfig(env = process.env): Config {
  const chainId = (Number(env.CHAIN_ID ?? 31611) as ChainId);
  return {
    chainId,
    rpc: env.RPC_URL ?? RPC[chainId],
    vault: (env.LOCKWATCH_VAULT as Address | undefined) ?? ADDRESSES[chainId].lockwatchVault,
    appUrl: env.APP_URL ?? "https://lockwatch.vercel.app",
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
