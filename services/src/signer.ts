import { createWalletClient, http, type Hex } from "viem";
import { nonceManager, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { chainById } from "@lockwatch/sdk";

/** One account object per key, with viem's nonce manager, so every job and both ledgers (veBTC + veMEZO run
 *  side by side in one worker) draw nonces from the same counter instead of each asking the node. */
const accounts = new Map<string, PrivateKeyAccount>();
export function keeperAccount(key: Hex): PrivateKeyAccount {
  let a = accounts.get(key);
  if (!a) { a = privateKeyToAccount(key, { nonceManager }); accounts.set(key, a); }
  return a;
}
export function keeperWallet(key: Hex, chainId: number, rpc: string) {
  const account = keeperAccount(key);
  return { account, wallet: createWalletClient({ account, chain: chainById(chainId), transport: http(rpc) }) };
}

/** Process-wide FIFO lock. Keeper passes run under it, and every tick awaits each receipt before the next send,
 *  so the keeper never has two of its own transactions in flight (no nonce races, and gas estimates always see
 *  the state the previous tx left behind). */
let tail: Promise<unknown> = Promise.resolve();
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.catch(() => undefined);
  return run;
}

/** Gas limit with headroom and a floor: node estimates can come in low when state moves between estimate and
 *  inclusion (a RewardsDistributor checkpoint makes the first claim of a week ~2M gas, later ones far less). */
export function buffered(estimate: bigint, floor = 0n): bigint {
  const g = (estimate * 15n) / 10n + 50_000n;
  return g > floor ? g : floor;
}
