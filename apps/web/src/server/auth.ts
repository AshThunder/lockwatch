import "server-only";
import { z } from "zod";
import { verifySiwe } from "./siwe";

/** Every write to an account-scoped list carries a fresh SIWE message + signature (single-use nonce). */
export const Signed = z.object({ message: z.string().max(2000), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) });
export const Addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export async function signer(b: z.infer<typeof Signed>) {
  return verifySiwe(b.message, b.signature as `0x${string}`);
}
