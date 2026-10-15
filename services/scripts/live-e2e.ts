/** LIVE testnet pass (real txs). Keys from /workspace/lockwatch/secrets; never printed. */
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther, parseAbi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ADDRESSES, veBTCAbi, erc20Abi, lockwatchVaultAbi, chainById } from "@lockwatch/sdk";
const S = "/workspace/lockwatch/secrets/", A = ADDRESSES[31611], V = A.lockwatchVault!, chain = chainById(31611);
const key = (n: string) => readFileSync(S + n, "utf8").trim() as `0x${string}`;
const pub = createPublicClient({ chain, transport: http() });
const w = (k: string) => createWalletClient({ account: privateKeyToAccount(key(k)), chain, transport: http() });
const dep = w("deployer_key"), b = w("e2e2_key"), e2e = w("e2e_key");
const out: Record<string, string> = {}; const X = (h: string) => `https://explorer.test.mezo.org/tx/${h}`;
async function send(c: any, label: string, req: any) { const h = await c.writeContract({ ...req, gas: 1_200_000n }); const r = await pub.waitForTransactionReceipt({ hash: h }); if (r.status !== "success") throw new Error(label + " reverted " + h); out[label] = X(h); console.log(label, X(h)); return r; }
async function main() {
  const B = b.account.address; console.log("walletB", B, "e2e", e2e.account.address);
  if ((await pub.getBalance({ address: B })) < parseEther("0.0015")) { const h = await dep.sendTransaction({ to: B, value: parseEther("0.002") }); await pub.waitForTransactionReceipt({ hash: h }); out.fundB = X(h); console.log("fundB", X(h)); }
  const amt = parseEther("0.001");
  if ((await pub.readContract({ address: A.btc, abi: parseAbi(["function allowance(address,address) view returns (uint256)"]), functionName: "allowance", args: [B, A.veBTC] }) as bigint) < amt) await send(b, "approveBTC", { address: A.btc, abi: erc20Abi, functionName: "approve", args: [A.veBTC, amt] });
  await send(b, "createLock", { address: A.veBTC, abi: parseAbi(["function createLock(uint256,uint256) returns (uint256)"]), functionName: "createLock", args: [amt, 604800n] });
  const id = await pub.readContract({ address: A.veBTC, abi: veBTCAbi, functionName: "tokenId" }) as bigint;
  out.lockId = String(id); console.log("lockId", id);
  await send(b, "approveVault", { address: A.veBTC, abi: veBTCAbi, functionName: "approve", args: [V, id] });
  await send(b, "setExtendPolicy", { address: V, abi: lockwatchVaultAbi, functionName: "setExtendPolicy", args: [id, 2592000, 0] });
  await send(b, "setRewardsAuto", { address: V, abi: lockwatchVaultAbi, functionName: "setRewardsAuto", args: [id, true] });
  console.log("canExtend", await pub.readContract({ address: V, abi: lockwatchVaultAbi, functionName: "canExtend", args: [id] }));
  // #380 (voted lock owned by e2e): opt into reward auto-claim via setApprovalForAll so its legacy-vault approval stays intact
  const ok = await pub.readContract({ address: A.veBTC, abi: parseAbi(["function isApprovedForAll(address,address) view returns (bool)"]), functionName: "isApprovedForAll", args: [e2e.account.address, V] });
  if (!ok) await send(e2e, "e2e_setApprovalForAll_v2", { address: A.veBTC, abi: parseAbi(["function setApprovalForAll(address,bool)"]), functionName: "setApprovalForAll", args: [V, true] });
  await send(e2e, "setRewardsAuto_380", { address: V, abi: lockwatchVaultAbi, functionName: "setRewardsAuto", args: [380n, true] });
  writeFileSync("/workspace/lockwatch/live/onchain.json", JSON.stringify(out, null, 1));
}
main().catch((e) => { console.error(String(e).slice(0, 500)); writeFileSync("/workspace/lockwatch/live/onchain.json", JSON.stringify(out, null, 1)); process.exit(1); });
