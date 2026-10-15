import { ADDRESSES, type ChainId } from "@lockwatch/sdk";
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31611) as ChainId;
export const ADDR = ADDRESSES[CHAIN_ID];
export const VAULT = (process.env.NEXT_PUBLIC_LOCKWATCH_VAULT || ADDR.lockwatchVault || null) as `0x${string}` | null;
export const TG_BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? "LockwatchBot";
export const RESCUE = (process.env.NEXT_PUBLIC_LOCKWATCH_RESCUE || ADDR.lockwatchRescue || null) as `0x${string}` | null;
export const LEGACY_VAULTS = ADDR.lockwatchVaultsLegacy as `0x${string}`[];
export const KEEPER = (process.env.NEXT_PUBLIC_KEEPER_ADDRESS || "0xa5052E50884FB844B624284F481e59B40f8F5F8B") as `0x${string}`;
