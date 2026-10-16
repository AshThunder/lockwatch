import { describe, expect, it, beforeEach } from "vitest";
import * as repo from "@lockwatch/db";
import { ledgerId, summarizeAtRisk } from "@lockwatch/sdk";
import { rebaseTick, REBASE_BATCH, type RebaseChain } from "../src/automation";
import { keeperPass } from "../src/keeper";
import { loadConfig } from "../src/config";

const C = 31611, M = ledgerId(C, "mezo"), E18 = 10n ** 18n, THU = 1792022400;
const OWNER = "0x00000000000000000000000000000000000000aa";
let db: repo.Db;
beforeEach(async () => { db = await repo.connect("memory"); });
const lock = (chainId: number, id: number, amount = E18, withdrawn = false) =>
  repo.upsertLock(db, { chainId, id: BigInt(id), owner: OWNER, amount, end: THU + 86400 * 30, permanent: false, voted: false, approvedVault: undefined, withdrawn });

function fake(claim0: Record<string, bigint>, o: { ready?: boolean; failIds?: bigint[] } = {}) {
  const claim = claim0, sent: bigint[][] = [];
  const chain: RebaseChain = {
    ready: async () => o.ready ?? true,
    claimable: async (ids) => ids.map((id) => claim[id.toString()] ?? 0n),
    claimMany: async (ids) => { if (ids.some((i) => o.failIds?.includes(i))) throw new Error("NotManagedOrNormalNFT"); sent.push(ids); for (const i of ids) claim[i.toString()] = 0n; return `0x${sent.length}` as `0x${string}`; },
    wait: async () => "success",
  };
  return { chain, sent };
}

describe("rebase auto-claim", () => {
  it("claims every lock at or above the dust line, once per epoch, and logs per lock with the tx", async () => {
    for (const i of [1, 2, 3, 4]) await lock(M, i);
    await lock(M, 5, E18, true); // withdrawn: never a candidate
    const claim: Record<string, bigint> = { "1": 5n * E18, "2": 10n ** 15n, "3": 10n ** 16n, "5": E18 };
    const f = fake(claim);
    const r = await rebaseTick(db, f.chain, M, THU + 7200, 10n ** 16n);
    expect(f.sent).toEqual([[1n, 3n]]);
    expect(r).toMatchObject({ due: 2 });
    const runs = (await repo.keeperRuns(db, M)).filter((x) => x.job === "rebase");
    expect(runs.map((x) => [x.subject, x.tx_hash, x.detail, x.ok]).sort()).toEqual([["1", "0x1", (5n * E18).toString(), true], ["3", "0x1", (10n ** 16n).toString(), true]]);
    // same epoch: no second pass
    expect(await rebaseTick(db, f.chain, M, THU + 9000, 10n ** 16n)).toEqual({ skipped: "done this epoch" });
    expect(f.sent.length).toBe(1);
    // next epoch: runs again
    claim["1"] = E18;
    await rebaseTick(db, f.chain, M, THU + 7 * 86400 + 60, 10n ** 16n);
    expect(f.sent.length).toBe(2);
  });

  it("waits (without marking the epoch) while the distributor hasn't rolled over", async () => {
    await lock(C, 1);
    const f = fake({ "1": E18 }, { ready: false });
    expect(await rebaseTick(db, f.chain, C, THU + 60, 1n)).toEqual({ skipped: "distributor not updated for this epoch" });
    expect(f.sent).toEqual([]);
    f.chain.ready = async () => true;
    await rebaseTick(db, f.chain, C, THU + 120, 1n);
    expect(f.sent).toEqual([[1n]]);
  });

  it("batches, and isolates a bad id by retrying the batch per lock", async () => {
    const n = REBASE_BATCH + 3, claim: Record<string, bigint> = {};
    for (let i = 1; i <= n; i++) { await lock(C, i); claim[String(i)] = E18; }
    const f = fake(claim, { failIds: [2n] });
    await rebaseTick(db, f.chain, C, THU + 60, 1n);
    expect(f.sent.length).toBe(REBASE_BATCH - 1 + 1); // first batch split into singles minus the bad one, then 1 batch of 3
    expect(f.sent.flat()).not.toContain(2n);
    expect(f.sent.flat().length).toBe(n - 1);
    const bad = (await repo.keeperRuns(db, C)).find((x) => x.job === "rebase" && x.subject === "2")!;
    expect(bad.ok).toBe(false);
    expect(bad.detail).toContain("NotManagedOrNormalNFT");
  });

  it("runs inside keeperPass and shows in the activity feed with amount + tx", async () => {
    await lock(M, 7);
    const f = fake({ "7": 3n * E18 });
    const out = await keeperPass(db, { vaults: [], rebase: { chain: f.chain, min: 1n } }, M, THU + 60);
    expect(out.rebase).toMatchObject({ due: 1 });
    const a = await repo.activity(db, M, { owner: OWNER });
    expect(a.items[0]).toMatchObject({ kind: "rebase", lock_id: "7", tx_hash: "0x1", amount: (3n * E18).toString(), owner: OWNER });
    expect((await repo.activity(db, C)).items).toEqual([]); // ledger isolation
  });

  it("config: distributors + dust lines per escrow", () => {
    const b = loadConfig({} as never), m = loadConfig({} as never, "mezo");
    expect(b.distributor).toBe("0x10B0E7b3411F4A38ca2F6BB697aA28D607924729");
    expect(m.distributor).toBe("0x2962E8817ae716019F759d098e2caE658bDcAd04");
    expect(b.rebaseMin).toBe(10n ** 12n);
    expect(m.rebaseMin).toBe(10n ** 16n);
  });

  it("at-risk summary ignores zero-amount (merged) locks", () => {
    const L = (id: number, amount: bigint) => ({ id: BigInt(id), owner: OWNER as `0x${string}`, amount, end: THU - 86400, permanent: false, voted: false });
    const s = summarizeAtRisk([L(1, E18), L(2, 0n), L(3, 0n)], THU);
    expect(s.expiredCount).toBe(1);
  });
});

describe("rebase: sequential sends, fresh amounts, retries", () => {
  it("never has two claims in flight and re-reads amounts before each send (skips emptied locks)", async () => {
    for (const i of [1, 2, 3]) await lock(M, i);
    const claim: Record<string, bigint> = { "1": E18, "2": E18, "3": E18 };
    let inFlight = 0, maxInFlight = 0;
    const sent: bigint[][] = [];
    const chain: RebaseChain = {
      ready: async () => true,
      claimable: async (ids) => ids.map((id) => claim[id.toString()] ?? 0n),
      claimMany: async (ids) => {
        if (ids.length > 1) throw new Error("estimate failed");
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); sent.push(ids);
        if (ids[0] === 1n) claim["2"] = 0n; // e.g. another caller claimed #2 meanwhile
        claim[ids[0].toString()] = 0n;
        return `0x${sent.length}` as `0x${string}`;
      },
      wait: async () => { await new Promise((r) => setTimeout(r, 5)); inFlight--; return "success"; },
    };
    await rebaseTick(db, chain, M, THU + 60, 1n);
    expect(maxInFlight).toBe(1);
    expect(sent).toEqual([[1n], [3n]]);
  });

  it("splits a reverted batch into singles and picks up locks the checkpoint made due", async () => {
    for (const i of [1, 2, 3]) await lock(M, i);
    const claim: Record<string, bigint> = { "1": E18, "2": E18 };
    const sent: bigint[][] = [];
    const chain: RebaseChain = {
      ready: async () => true,
      claimable: async (ids) => ids.map((id) => claim[id.toString()] ?? 0n),
      claimMany: async (ids) => { sent.push(ids); return `0x${sent.length}` as `0x${string}`; },
      wait: async (h) => {
        const ids = sent[Number(h.slice(2)) - 1];
        if (ids.length > 1) return "reverted";
        claim[ids[0].toString()] = 0n; claim["3"] = claim["3"] ?? E18; // first claim checkpoints: #3 becomes due
        return "success";
      },
    };
    const r = await rebaseTick(db, chain, M, THU + 60, 1n);
    expect(sent).toEqual([[1n, 2n], [1n], [2n], [3n]]);
    expect(r).toMatchObject({ left: 0 });
    expect((await repo.keeperRuns(db, M)).filter((x) => x.job === "rebase").every((x) => x.ok)).toBe(true);
  });

  it("retries failed locks on later passes, then gives up for the epoch after REBASE_TRIES", async () => {
    await lock(M, 1);
    const sent: bigint[][] = [];
    const chain: RebaseChain = {
      ready: async () => true, claimable: async (ids) => ids.map(() => E18),
      claimMany: async (ids) => { sent.push(ids); return "0x1"; }, wait: async () => "reverted",
    };
    for (let i = 0; i < 5; i++) await rebaseTick(db, chain, M, THU + 60 + i * 300, 1n);
    expect(sent.length).toBe(3);
  });
});
