/**
 * veMEZO fork end-to-end: the real VeMEZO + BoostVoter on an anvil fork of Mezo testnet, the deployed veMEZO
 * LockwatchVault (0x24fd…27ae), driven by the production indexer + keeper code for the "mezo" pipeline.
 *   anvil --fork-url https://rpc.test.mezo.org --port 8546 --hardfork cancun
 *   FORK_RPC=http://127.0.0.1:8546 tsx scripts/fork-e2e-mezo.ts
 * MEZO (0x7B7c…01) is a precompile a local EVM can't run, so a plain ERC-20 is set there. Nothing touches the real chain.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createPublicClient, createTestClient, createWalletClient, http, parseEther, parseAbi, keccak256, toHex, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ADDRESSES, veBTCAbi, erc20Abi, lockwatchVaultAbi, chainById, ledgerId } from "@lockwatch/sdk";
import * as repo from "@lockwatch/db";
import { fullScan, syncEvents } from "../src/indexer";
import { keeperPass, viemKeeperJobs } from "../src/keeper";
import { loadConfig } from "../src/config";

const RPC = process.env.FORK_RPC ?? "http://127.0.0.1:8546";
const OUT = process.env.OUT ?? "/workspace/lockwatch/e2e";
mkdirSync(OUT, { recursive: true });
const A = ADDRESSES[31611];
const KEEPER = keccak256(toHex("lockwatch-fork-keeper"));
const MIA = privateKeyToAccount(keccak256(toHex("lockwatch-fork-mia"))); // RETURN at expiry
const NED = privateKeyToAccount(keccak256(toHex("lockwatch-fork-ned"))); // auto-extend to 4y
const chain = { ...chainById(31611), rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) }) as PublicClient;
const test = createTestClient({ chain, mode: "anvil", transport: http(RPC) });
const ve = parseAbi(["function createLock(uint256,uint256) returns (uint256)", "function tokenId() view returns (uint256)"]);
const mint = parseAbi(["function mint(address,uint256)"]);
const report: Record<string, unknown> = {};
const j = (x: unknown) => JSON.parse(JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
const log = (k: string, v: unknown) => { report[k] = j(v); console.log(k, JSON.stringify(j(v))); };
async function at(ts: bigint) { await test.setNextBlockTimestamp({ timestamp: ts }); await test.mine({ blocks: 1 }); }
async function send(c: ReturnType<typeof createWalletClient>, req: any) { const h = await c.writeContract(req); const r = await pub.waitForTransactionReceipt({ hash: h }); if (r.status !== "success") throw new Error(`reverted ${req.functionName}`); return h; }
const must = (c: boolean, m: string) => { if (!c) throw new Error(`ASSERT: ${m}`); };

async function main() {
  const erc20 = JSON.parse(readFileSync("../contracts/out/Mocks.sol/MockERC20.json", "utf8")).deployedBytecode.object as Hex;
  await test.setCode({ address: A.mezo, bytecode: erc20 });
  for (const a of [MIA.address, NED.address, privateKeyToAccount(KEEPER).address]) await test.setBalance({ address: a, value: parseEther("1") });
  const cfg = { ...loadConfig({ RPC_URL: RPC, KEEPER_PRIVATE_KEY: KEEPER } as never, "mezo"), rpc: RPC };
  must(cfg.vault === A.lockwatchVaultMezo, "mezo config uses deployed vault");
  const VAULT = cfg.vault!;
  const db = await repo.connect("memory");
  log("forkBlock", await pub.getBlockNumber());

  async function lock(w: typeof MIA, amt: bigint, dur: bigint) {
    const c = createWalletClient({ account: w, chain, transport: http(RPC) });
    await send(c, { address: A.mezo, abi: mint, functionName: "mint", args: [w.address, amt] });
    await send(c, { address: A.mezo, abi: erc20Abi, functionName: "approve", args: [A.veMEZO, amt] });
    await send(c, { address: A.veMEZO, abi: ve, functionName: "createLock", args: [amt, dur] });
    const id = (await pub.readContract({ address: A.veMEZO, abi: ve, functionName: "tokenId" })) as bigint;
    await send(c, { address: A.veMEZO, abi: veBTCAbi, functionName: "approve", args: [VAULT, id] });
    return { c, id };
  }
  const mia = await lock(MIA, parseEther("2500"), 7n * 86400n);
  await send(mia.c, { address: VAULT, abi: lockwatchVaultAbi, functionName: "register", args: [mia.id, { owner: "0x0000000000000000000000000000000000000000", mode: 0, relockDuration: 0, deadline: 0n, debt: 0n, sig: "0x" }] });
  const ned = await lock(NED, parseEther("10000"), 21n * 86400n);
  await send(ned.c, { address: VAULT, abi: lockwatchVaultAbi, functionName: "setExtendPolicy", args: [ned.id, 30 * 86400, 0] });
  log("locks", { mia: mia.id, ned: ned.id });

  // index with the production code (mezo ledger), only the new ids + the full event range
  await repo.setCursor(db, `events:${cfg.ledger}`, ((await pub.getBlockNumber()) - 20n).toString());
  for (let i = 0; i < 3; i++) await syncEvents(db, pub, cfg);
  const L = ledgerId(31611, "mezo");
  must(cfg.ledger === L, "ledger");
  const ml = await repo.lockById(db, L, mia.id);
  must(!!ml && BigInt(ml.amount) === parseEther("2500"), "mia lock indexed on mezo ledger");
  must(!(await repo.lockById(db, 31611, mia.id)) || (await repo.lockById(db, 31611, mia.id)).owner !== MIA.address.toLowerCase(), "not on btc ledger");
  log("indexed", { protections: await repo.protectionsByOwner(db, L, MIA.address), extend: await repo.extendsByOwner(db, L, NED.address) });

  // keeper pass now: NED is inside its 30-day window → extend to ~4 years
  const jobs = viemKeeperJobs(pub, cfg);
  must(!jobs.rescue, "no rescue on mezo");
  const nedEnd0 = (await pub.readContract({ address: A.veMEZO, abi: veBTCAbi, functionName: "locked", args: [ned.id] }) as any).end as bigint;
  const now0 = Number((await pub.getBlock()).timestamp);
  const r1 = await keeperPass(db, jobs, L, now0);
  const nedEnd1 = (await pub.readContract({ address: A.veMEZO, abi: veBTCAbi, functionName: "locked", args: [ned.id] }) as any).end as bigint;
  log("autoextend", { pass: r1.extend, before: nedEnd0, after: nedEnd1, years: Number(nedEnd1 - BigInt(now0)) / (365 * 86400) });
  must(nedEnd1 > nedEnd0 && Number(nedEnd1) - now0 > 3.9 * 365 * 86400, "extended to ~4y");

  // warp past MIA's end (+2h for the distribute window) → keeper protects (RETURN): MEZO back to MIA
  const miaEnd = (await pub.readContract({ address: A.veMEZO, abi: veBTCAbi, functionName: "locked", args: [mia.id] }) as any).end as bigint;
  await at(miaEnd + 7200n);
  const bal0 = await pub.readContract({ address: A.mezo, abi: erc20Abi, functionName: "balanceOf", args: [MIA.address] });
  const r2 = await keeperPass(db, jobs, L, Number(miaEnd + 7200n));
  const bal1 = await pub.readContract({ address: A.mezo, abi: erc20Abi, functionName: "balanceOf", args: [MIA.address] });
  const vaultBal = await pub.readContract({ address: A.mezo, abi: erc20Abi, functionName: "balanceOf", args: [VAULT] });
  for (let i = 0; i < 3; i++) await syncEvents(db, pub, cfg);
  const p = (await repo.protectionsByOwner(db, L, MIA.address))[0];
  log("protect", { pass: r2[`protect:${VAULT}`], mezoReturned: bal1 - bal0, vaultBal, protection: p, runs: (await repo.keeperRuns(db, L)).filter((r) => r.job !== "heartbeat") });
  must(bal1 - bal0 === parseEther("2500") && vaultBal === 0n, "2500 MEZO returned to owner, vault empty");
  must(!!p && !p.active && !!p.tx_hash, "protection closed with tx");
  writeFileSync(`${OUT}/fork-e2e-mezo.json`, JSON.stringify(report, null, 2));
  console.log("FORK E2E (veMEZO): PASS");
}
main().catch((e) => { console.error(e); process.exit(1); });
