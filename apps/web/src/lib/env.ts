import { ADDRESSES, type ChainId } from "@lockwatch/sdk";
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31611) as ChainId;
export const ADDR = ADDRESSES[CHAIN_ID];
export const VAULT = (process.env.NEXT_PUBLIC_LOCKWATCH_VAULT || ADDR.lockwatchVault || null) as `0x${string}` | null;
export const TG_BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? "LockwatchBot";
