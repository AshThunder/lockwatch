import "server-only";
import { parseSiweMessage, verifySiweMessage } from "viem/siwe";
import { createPublicClient, http, type Address } from "viem";
import { chainById } from "@lockwatch/sdk";
import * as repo from "@lockwatch/db";
import { db, CHAIN_ID } from "./db";

/** EIP-4361 sign-in. Verifies signature (EOA or ERC-1271 smart account, e.g. Mezo Passport) and burns the nonce. */
export async function verifySiwe(message: string, signature: `0x${string}`): Promise<Address | null> {
  const m = parseSiweMessage(message);
  if (!m.address || !m.nonce || m.chainId !== CHAIN_ID) return null;
  const host = process.env.SIWE_DOMAIN;
  if (host && m.domain !== host) return null;
  const client = createPublicClient({ chain: chainById(CHAIN_ID), transport: http() });
  const ok = await verifySiweMessage(client, { message, signature, ...(host ? { domain: host } : {}) });
  if (!ok) return null;
  if (!(await repo.useNonce(await db(), m.nonce))) return null;
  return m.address;
}
