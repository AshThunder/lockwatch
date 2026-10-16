import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { chainById } from "@lockwatch/sdk";

/** One account object per key. Nonces come from the node's pending count: keeper passes are serialized (see
 *  serial()) and every send awaits its receipt, so the count is always current; a dropped tx is resent with its
 *  own nonce by sendDropAware. (viem's nonceManager would keep counting past a dropped tx and wedge.) */
const accounts = new Map<string, PrivateKeyAccount>();
export function keeperAccount(key: Hex): PrivateKeyAccount {
  let a = accounts.get(key);
  if (!a) { a = privateKeyToAccount(key); accounts.set(key, a); }
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

export type TxStatus = "success" | "reverted" | "dropped";
export interface DropAwareClient {
  getTransactionReceipt(a: { hash: Hash }): Promise<{ status: "success" | "reverted" }>;
  getTransaction(a: { hash: Hash }): Promise<unknown>;
}
type Hash = `0x${string}`;

/** Sends with an explicit nonce and gas price and waits for the receipt. A tx the node has forgotten (no receipt,
 *  and getTransaction can't find the hash after `timeoutMs`) was dropped: resend it with the SAME nonce at a
 *  bumped price, up to `tries` times. A tx that is known but still pending after the timeout is also replaced
 *  (same nonce, +25% price) so it can't wedge the queue. Only a mined receipt can report "reverted". */
export async function sendDropAware(client: DropAwareClient, send: (nonce: number, gasPrice: bigint) => Promise<Hash>,
  o: { nonce: number; gasPrice: bigint; timeoutMs?: number; pollMs?: number; tries?: number; sleep?: (ms: number) => Promise<void> }) {
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const timeout = o.timeoutMs ?? 60_000, poll = o.pollMs ?? 3_000, tries = o.tries ?? 3;
  let price = o.gasPrice;
  const hashes: Hash[] = [];
  for (let t = 0; t < tries; t++) {
    try { hashes.push(await send(o.nonce, price)); }
    catch (e) { if (!/nonce too low|already known|replacement/i.test(String(e)) || !hashes.length) throw e; }
    for (let waited = 0; waited <= timeout; waited += poll) {
      for (const h of hashes) {
        const r = await client.getTransactionReceipt({ hash: h }).catch(() => null);
        if (r) return { status: r.status as TxStatus, hash: h, resends: hashes.length - 1 };
      }
      if (waited < timeout) await sleep(poll);
    }
    const known = await Promise.all(hashes.map((h) => client.getTransaction({ hash: h }).then(() => true, () => false)));
    if (!known.some(Boolean) && t === tries - 1) break;
    price = (price * 125n) / 100n + 1n;
  }
  return { status: "dropped" as TxStatus, hash: hashes.at(-1)!, resends: hashes.length - 1 };
}
