/**
 * Fork end-to-end: real deployed LockwatchVault + real veBTC/Voter/BorrowerOperations on an anvil fork of Mezo
 * testnet, driven by the production indexer + keeper code (in-memory PGlite DB, anvil key as keeper).
 *   anvil --fork-url https://rpc.test.mezo.org --port 8545   (then)   FORK_RPC=http://127.0.0.1:8545 tsx scripts/fork-e2e.ts
 * Mezo's BTC precompile and BTC/USD oracle precompile can't run in a local EVM, so they are replaced with
 * cheatcode-free emulators (contracts/test/mocks/AnvilMocks.sol). Nothing here touches the real chain.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createPublicClient, createTestClient, createWalletClient, http, parseEther, formatEther, parseAbi, keccak256, toHex, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ADDRESSES, veBTCAbi, voterAbi, bosAbi, erc20Abi, lockwatchVaultAbi, openTroveTypedData, Mode, chainById, NOT_PROTECTABLE_REASONS } from "@lockwatch/sdk";
import * as repo from "@lockwatch/db";
import { fullScan, syncEvents } from "../src/indexer";
import { keeperTick, viemKeeperChain } from "../src/keeper";
import { loadConfig } from "../src/config";

const RPC = process.env.FORK_RPC ?? "http://127.0.0.1:8545";
const OUT = process.env.OUT ?? "/workspace/lockwatch/e2e";
mkdirSync(OUT, { recursive: true });
const A = ADDRESSES[31611];
const VAULT = A.lockwatchVault!;
const ORACLE = "0x7b7c000000000000000000000000000000000015" as Address;
const LIVE_ID = BigInt(process.env.LIVE_ID ?? 380);
// throwaway fork-only keys
const KEEPER = keccak256(toHex("lockwatch-fork-keeper"));
const BOB = privateKeyToAccount(keccak256(toHex("lockwatch-fork-bob")));
const CAROL = privateKeyToAccount(keccak256(toHex("lockwatch-fork-carol")));
const chain = { ...chainById(31611), rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) }) as PublicClient;
const test = createTestClient({ chain, mode: "anvil", transport: http(RPC) });
const carol = createWalletClient({ account: CAROL, chain, transport: http(RPC) });
const bob = createWalletClient({ account: BOB, chain, transport: http(RPC) });
const art = (n: string) => JSON.parse(readFileSync(`../contracts/out/AnvilMocks.sol/${n}.json`, "utf8")).deployedBytecode.object as Hex;
const btcOf = (a: Address) => pub.readContract({ address: A.btc, abi: erc20Abi, functionName: "balanceOf", args: [a] });
const musdOf = (a: Address) => pub.readContract({ address: A.musd, abi: erc20Abi, functionName: "balanceOf", args: [a] });
const report: Record<string, unknown> = {};
const j = (x: unknown) => JSON.parse(JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
const log = (k: string, v: unknown) => { report[k] = j(v); console.log(k, JSON.stringify(j(v))); };
async function at(ts: bigint) { await test.setNextBlockTimestamp({ timestamp: ts }); await test.mine({ blocks: 1 }); }
async function send(c: ReturnType<typeof createWalletClient>, req: any) { const h = await c.writeContract(req); const r = await pub.waitForTransactionReceipt({ hash: h }); if (r.status !== "success") throw new Error(`reverted ${req.functionName}`); return h; }

const ids: bigint[] = [LIVE_ID];
async function main() {
  const livePrice = await pub.readContract({ address: A.priceFeed, abi: parseAbi(["function fetchPrice() view returns (uint256)"]), functionName: "fetchPrice" }).catch(() => parseEther("82000"));
  await test.setCode({ address: A.btc, bytecode: art("AnvilMezoBTC") });
  await test.setBalance({ address: A.btc, value: parseEther("100000") });
  await test.setCode({ address: ORACLE, bytecode: art("AnvilOracle") });
  await test.setStorageAt({ address: ORACLE, index: 0, value: `0x${(livePrice as bigint).toString(16).padStart(64, "0")}` });
  await test.setBalance({ address: BOB.address, value: parseEther("1") });
  await test.setBalance({ address: CAROL.address, value: parseEther("1") });
  await test.setBalance({ address: privateKeyToAccount(KEEPER).address, value: parseEther("1") });
  log("forkBlock", await pub.getBlockNumber());

  // ---- MUSD-mode lock created on the fork through the same calls the app makes
  const coll = parseEther("0.1"), debt = parseEther("2500");
  await send(bob, { address: A.btc, abi: erc20Abi, functionName: "approve", args: [A.veBTC, coll] });
  await send(bob, { address: A.veBTC, abi: parseAbi(["function createLock(uint256,uint256) returns (uint256)"]), functionName: "createLock", args: [coll, 604800n] });
  const bobId = await pub.readContract({ address: A.veBTC, abi: veBTCAbi, functionName: "tokenId" }) as bigint;
  const end = (await pub.readContract({ address: A.veBTC, abi: veBTCAbi, functionName: "locked", args: [bobId] }) as any);
  const lockEnd = BigInt(end.end ?? end[1]);
  if (lockEnd !== 1792627200n) throw new Error(`fork clock moved: restart anvil (lockEnd ${lockEnd})`);
  await send(bob, { address: A.veBTC, abi: veBTCAbi, functionName: "approve", args: [VAULT, bobId] });
  const nonce = await pub.readContract({ address: A.borrowerOperationsSignatures!, abi: bosAbi, functionName: "getNonce", args: [BOB.address] }) as bigint;
  const deadline = lockEnd + 14n * 86400n;
  const sig = await bob.signTypedData(openTroveTypedData({ chainId: 31611, bos: A.borrowerOperationsSignatures!, assetAmount: coll, debtAmount: debt, borrower: BOB.address, recipient: BOB.address, nonce, deadline }) as any);
  await send(bob, { address: VAULT, abi: lockwatchVaultAbi, functionName: "register", args: [bobId, { owner: "0x0000000000000000000000000000000000000000", mode: Mode.MUSD, relockDuration: 0, deadline, debt, sig }] });
  // ---- RELOCK-mode lock (same expiry) so one keeper batch carries two ids
  await send(carol, { address: A.btc, abi: erc20Abi, functionName: "approve", args: [A.veBTC, parseEther("0.05")] });
  await send(carol, { address: A.veBTC, abi: parseAbi(["function createLock(uint256,uint256) returns (uint256)"]), functionName: "createLock", args: [parseEther("0.05"), 604800n] });
  const carolId = await pub.readContract({ address: A.veBTC, abi: veBTCAbi, functionName: "tokenId" }) as bigint;
  await send(carol, { address: A.veBTC, abi: veBTCAbi, functionName: "approve", args: [VAULT, carolId] });
  await send(carol, { address: VAULT, abi: lockwatchVaultAbi, functionName: "register", args: [carolId, { owner: "0x0000000000000000000000000000000000000000", mode: Mode.RELOCK, relockDuration: 14 * 86400, deadline: 0n, debt: 0n, sig: "0x" }] });
  ids.push(bobId, carolId);
  log("setup", { liveLock: LIVE_ID, musdLock: bobId, relockLock: carolId, lockEnd, bob: BOB.address, carol: CAROL.address });

  // ---- production indexer into an in-memory DB
  const cfg = { ...loadConfig({ CHAIN_ID: "31611", RPC_URL: RPC } as any), vault: VAULT, keeperKey: KEEPER };
  const db = await repo.connect("memory");
  await fullScan(db, pub, cfg);
  await repo.setCursor(db, `events:31611`, (await pub.getBlockNumber()).toString());
  const kc = viemKeeperChain(pub, cfg);
  const liveOwner = (await pub.readContract({ address: A.veBTC, abi: veBTCAbi, functionName: "ownerOf", args: [LIVE_ID] })) as Address;
  const snap = async (tag: string) => log(`balances_${tag}`, {
    liveOwnerBTC: formatEther(await btcOf(liveOwner)), bobBTC: formatEther(await btcOf(BOB.address)), bobMUSD: formatEther(await musdOf(BOB.address)), carolBTC: formatEther(await btcOf(CAROL.address)),
    carolLocks: await pub.readContract({ address: A.veBTC, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [CAROL.address] }),
    vaultBTC: formatEther(await btcOf(VAULT)), vaultMUSD: formatEther(await musdOf(VAULT)),
    liveVoted: await pub.readContract({ address: A.veBTC, abi: veBTCAbi, functionName: "voted", args: [LIVE_ID] }),
  });
  const status = async (tag: string) => { const o: Record<string, string> = {}; for (const id of ids) o[String(id)] = NOT_PROTECTABLE_REASONS[(await kc.isProtectable(id))[1]] ?? "ok"; log(`isProtectable_${tag}`, o); };
  await snap("before"); await status("before");
  log("due_before_expiry", await repo.dueProtections(db, 31611, Number((await pub.getBlock()).timestamp)));

  // ---- T1: Oct 22 00:10 UTC (01:10 WAT): expired; voted lock still inside Voter's 1h distribute window
  await at(lockEnd + 600n);
  await syncEvents(db, pub, cfg);
  await status("t0010");
  const r1 = await keeperTick(db, kc, 31611, Number((await pub.getBlock()).timestamp));
  log("keeper_t0010", r1);
  await snap("after_t0010");

  // ---- T2: 01:05 UTC (02:05 WAT): reset window open -> voted lock reset + withdrawn + returned
  await at(lockEnd + 3900n);
  await syncEvents(db, pub, cfg);
  await status("t0105");
  const r2 = await keeperTick(db, kc, 31611, Number((await pub.getBlock()).timestamp));
  log("keeper_t0105", r2);
  await snap("after_t0105");
  log("final_sync", await syncEvents(db, pub, cfg));
  log("db_protections", await db.query(`SELECT lock_id, mode, active, tx_hash, amount, new_lock_id, fallback_reason FROM protection WHERE lock_id = ANY($1)`, [ids.map(String)]));
  log("db_locks", await db.query(`SELECT id, withdrawn, voted FROM lock WHERE id = ANY($1)`, [ids.map(String)]));
  const trove = await pub.readContract({ address: A.troveManager, abi: parseAbi(["function getEntireDebtAndColl(address) view returns (uint256,uint256,uint256)"]), functionName: "getEntireDebtAndColl", args: [BOB.address] });
  log("bob_trove", { coll: formatEther(trove[0]), principal: formatEther(trove[1]), interest: formatEther(trove[2]) });
  for (const [k, r] of [["t0010", r1], ["t0105", r2]] as const) for (const x of r) if (x.hash) {
    const rc = await pub.getTransactionReceipt({ hash: x.hash as Hex });
    log(`tx_${k}_${x.id}`, { hash: x.hash, status: rc.status, gasUsed: rc.gasUsed, gasLimit: (await pub.getTransaction({ hash: x.hash as Hex })).gas, logs: rc.logs.length });
  }
  writeFileSync(`${OUT}/fork-report.json`, JSON.stringify(report, null, 2));
  await db.close();
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
