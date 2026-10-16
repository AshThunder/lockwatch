import { describe, expect, it, beforeEach } from "vitest";
import * as repo from "@lockwatch/db";
import { ledgerId } from "@lockwatch/sdk";
import { rebaseTick, REBASE_TRIES, type RebaseChain } from "../src/automation";
import { keeperPass } from "../src/keeper";
import { loadConfig } from "../src/config";
import { sendDropAware } from "../src/signer";

const C = 31611, M = ledgerId(C, "mezo"), E18 = 10n ** 18n, THU = 1792022400;
const OWNER = "0x00000000000000000000000000000000000000aa";
let db: repo.Db;
beforeEach(async () => { db = await repo.connect("memory"); });
const lock = (id: number) => repo.upsertLock(db, { chainId: M, id: BigInt(id), owner: OWNER, amount: E18, end: THU + 86400 * 30, permanent: false, voted: false, approvedVault: undefined, withdrawn: false });

function chainFor(claim: Record<string, bigint>, status: (ids: bigint[]) => "success" | "reverted" | "dropped" = () => "success", single = true) {
  const sent: bigint[][] = [];
  const chain: RebaseChain = {
    ready: async () => true,
    claimable: async (ids) => ids.map((i) => claim[i.toString()] ?? 0n),
    claimMany: async (ids) => { if (single && ids.length > 1) throw new Error("estimate"); sent.push(ids); return `0x${sent.length.toString(16)}` as `0x${string}`; },
    wait: async (h) => { const ids = sent[parseInt(h.slice(2), 16) - 1]; const s = status(ids); if (s === "success") ids.forEach((i) => (claim[i.toString()] = 0n)); return s; },
  };
  return { chain, sent };
}

describe("rebase is bounded and resumes", () => {
  it("caps claim txs per pass and picks up where it stopped, marking the epoch done only at the end", async () => {
    const claim: Record<string, bigint> = {};
    for (let i = 1; i <= 12; i++) { await lock(i); claim[String(i)] = E18; }
    const f = chainFor(claim);
    const lim = { maxClaims: 5, budgetMs: 1e9 };
    const r1 = await rebaseTick(db, f.chain, M, THU + 60, 1n, lim);
    expect(f.sent.length).toBe(5); // the failed batch estimate never reached the node, so it is not a send
    expect(r1).toMatchObject({ left: 7 });
    await rebaseTick(db, f.chain, M, THU + 360, 1n, lim);
    await rebaseTick(db, f.chain, M, THU + 660, 1n, lim);
    expect(Object.values(claim).every((v) => v === 0n)).toBe(true);
    expect(await rebaseTick(db, f.chain, M, THU + 960, 1n, lim)).toEqual({ skipped: "done this epoch" });
  });

  it("stops on the time budget", async () => {
    const claim: Record<string, bigint> = {};
    for (let i = 1; i <= 10; i++) { await lock(i); claim[String(i)] = E18; }
    let t = 0;
    const f = chainFor(claim, () => { t += 30_000; return "success"; }, false);
    f.chain.claimMany = async (ids) => { f.sent.push(ids.slice(0, 1)); return `0x${f.sent.length.toString(16)}` as `0x${string}`; }; // one lock per tx
    await rebaseTick(db, f.chain, M, THU + 60, 1n, { maxClaims: 1e9, budgetMs: 60_000, clock: () => t });
    expect(f.sent.length).toBe(2);
  });

  it("a dropped tx is logged as dropped (not reverted), doesn't count toward parking, and is retried", async () => {
    await lock(1);
    const claim = { "1": E18 };
    let n = 0;
    const f = chainFor(claim, () => (++n <= REBASE_TRIES + 1 ? "dropped" : "success"));
    for (let i = 0; i <= REBASE_TRIES + 1; i++) await rebaseTick(db, f.chain, M, THU + 60 + i * 300, 1n);
    const runs = (await repo.keeperRuns(db, M)).filter((x) => x.job === "rebase");
    expect(runs.filter((x) => !x.ok).every((x) => x.detail!.startsWith("dropped"))).toBe(true);
    expect(runs.some((x) => x.ok)).toBe(true);
  });
});

describe("keeper pass order", () => {
  it("writes the heartbeat before any rebase tx, and rebase errors can't block it", async () => {
    await lock(1);
    let hbBeforeSend = false;
    const f = chainFor({ "1": E18 });
    const orig = f.chain.claimMany;
    f.chain.claimMany = async (ids) => { hbBeforeSend = (await repo.keeperRuns(db, M)).some((r) => r.job === "heartbeat"); return orig(ids); };
    await keeperPass(db, { vaults: [], rebase: { chain: f.chain, min: 1n } }, M, THU + 60);
    expect(hbBeforeSend).toBe(true);
    const broken: RebaseChain = { ...f.chain, ready: async () => { throw new Error("rpc down"); } };
    await keeperPass(db, { vaults: [], rebase: { chain: broken, min: 1n } }, M, THU + 400);
    expect((await repo.keeperRuns(db, M)).filter((r) => r.job === "heartbeat").length).toBe(2);
  });

  it("config: per-run cap and budget from env", () => {
    expect(loadConfig({} as never, "mezo")).toMatchObject({ rebaseMaxClaims: 20, rebaseBudgetMs: 90_000 });
    expect(loadConfig({ REBASE_MAX_PER_RUN: "7", REBASE_BUDGET_MS: "1000" } as never, "mezo")).toMatchObject({ rebaseMaxClaims: 7, rebaseBudgetMs: 1000 });
  });
});

describe("sendDropAware", () => {
  const sleep = async () => {};
  const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;
  it("resends a forgotten tx with the same nonce at a bumped price, and returns the replacement's receipt", async () => {
    const sends: [number, bigint][] = [];
    const client = {
      getTransactionReceipt: async ({ hash }: { hash: string }) => { if (hash === H(2)) return { status: "success" as const }; throw new Error("not found"); },
      getTransaction: async () => { throw new Error("not found"); },
    };
    const r = await sendDropAware(client, async (n, p) => { sends.push([n, p]); return H(sends.length); }, { nonce: 7, gasPrice: 100n, timeoutMs: 9, pollMs: 3, sleep });
    expect(r).toEqual({ status: "success", hash: H(2), resends: 1 });
    expect(sends).toEqual([[7, 100n], [7, 126n]]);
  });
  it("reports dropped (not reverted) when every resend vanishes", async () => {
    const client = { getTransactionReceipt: async () => { throw new Error("nf"); }, getTransaction: async () => { throw new Error("nf"); } };
    let k = 0;
    const r = await sendDropAware(client, async () => H(++k), { nonce: 1, gasPrice: 10n, timeoutMs: 3, pollMs: 3, tries: 3, sleep });
    expect(r.status).toBe("dropped");
    expect(k).toBe(3);
  });
  it("passes a mined revert straight through, and tolerates 'already known' on a resend", async () => {
    let calls = 0;
    const client = { getTransactionReceipt: async () => { if (++calls > 3) return { status: "reverted" as const }; throw new Error("nf"); }, getTransaction: async () => ({}) };
    let k = 0;
    const r = await sendDropAware(client, async () => { if (++k > 1) throw new Error("already known"); return H(1); }, { nonce: 1, gasPrice: 10n, timeoutMs: 3, pollMs: 3, sleep });
    expect(r).toMatchObject({ status: "reverted", hash: H(1) });
  });
});
