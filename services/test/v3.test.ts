import { describe, expect, it, beforeEach, vi } from "vitest";
import * as repo from "@lockwatch/db";
import type { Address } from "viem";
import { keeperTick, keeperPass, type KeeperChain } from "../src/keeper";
import { extendTick, rewardsTick, rescueTick, type ExtendChain, type RewardsChain, type RescueChain } from "../src/automation";
import { applyVaultEvent, refreshRescue } from "../src/indexer";
import { alertsFor, alertsTick, message, keeperNotifier } from "../src/alerts";
import { loadConfig, allVaults } from "../src/config";

const A = "0x00000000000000000000000000000000000000aa" as Address, B = "0x00000000000000000000000000000000000000bb" as Address;
const V1 = "0xD7160697f3ACd0191e65bcccaAFeaa0913D21999", V2 = "0xdd5baB25b65C4697A2e14F47B919B61416A0cAdB";
const C = 31611, DAY = 86400, E18 = 10n ** 18n;
const THU = 1792022400;
const cfg = { appUrl: "https://lockwatch.vercel.app", chainId: C as 31611 };
let db: repo.Db;
beforeEach(async () => { db = await repo.connect("memory"); });

const fakeProtect = (sent: bigint[][]): KeeperChain => ({
  isProtectable: async () => [true, 0], prefDebt: async () => 0n, hints: async () => [A, A],
  simulateBatch: async (ids) => ids.map(() => true), sendBatch: async (ids) => { sent.push(ids); return "0x1"; },
  wait: async () => "success", balance: async () => E18,
});

describe("config", () => {
  it("serves the v2 vault plus the v1 vault", () => {
    const c = loadConfig({} as NodeJS.ProcessEnv);
    expect(c.vault).toBe(V2);
    expect(allVaults(c)).toEqual([V2, V1]);
    expect(c.rescue).toMatch(/^0x4408e334/);
    const o = loadConfig({ LOCKWATCH_VAULT: V1 } as never);
    expect(o.legacyVaults).toEqual([]); // never double-serve
  });
});

describe("multi-vault keeper", () => {
  it("lock #380 (v1 registration) is protected through v1, new ones through v2", async () => {
    await repo.upsertLock(db, { chainId: C, id: 380n, owner: A, amount: 4n * 10n ** 15n, end: THU, permanent: false, voted: true });
    await repo.upsertLock(db, { chainId: C, id: 400n, owner: B, amount: E18, end: THU, permanent: false, voted: false });
    await repo.upsertProtection(db, { chainId: C, lockId: 380n, owner: A, mode: 0, active: true }); // pre-v2 row, vault NULL
    await applyVaultEvent(db, C, { eventName: "Registered", args: { tokenId: 400n, owner: B, mode: 0 }, transactionHash: "0x2" }, V2);
    const s1: bigint[][] = [], s2: bigint[][] = [];
    await keeperPass(db, { vaults: [{ address: V2, isDefaultForNull: false, chain: fakeProtect(s2) }, { address: V1, isDefaultForNull: true, chain: fakeProtect(s1) }] }, C, THU + 7200);
    expect(s1).toEqual([[380n]]);
    expect(s2).toEqual([[400n]]);
    const runs = await repo.keeperRuns(db, C);
    expect(runs.filter((r) => r.job === "protect").length).toBe(2);
    expect(runs.filter((r) => r.job === "heartbeat").length).toBe(1);
  });
});

describe("auto-extend job", () => {
  const chain = (over: Partial<ExtendChain> = {}): ExtendChain & { calls: bigint[] } => {
    const calls: bigint[] = [];
    return { calls, canExtend: async () => [true, 0, BigInt(THU + 7 * DAY), BigInt(THU + 28 * DAY)], extend: async (id) => { calls.push(id); return "0xe"; }, wait: async () => "success", ...over };
  };
  async function seed(id: bigint, end: number, trig = 7 * DAY) {
    await repo.upsertLock(db, { chainId: C, id, owner: A, amount: E18, end, permanent: false, voted: true });
    await applyVaultEvent(db, C, { eventName: "ExtendSet", args: { tokenId: id, owner: A, triggerWithin: trig, duration: 0 }, transactionHash: "0x0" }, V2);
  }
  it("extends inside the window, updates the lock end, logs and notifies", async () => {
    await seed(1n, THU + 5 * DAY);
    await seed(2n, THU + 20 * DAY);
    const ch = chain();
    const notify = vi.fn(async () => {});
    const r = await extendTick(db, ch, C, THU, notify);
    expect(ch.calls).toEqual([1n]);
    expect(r[0]).toMatchObject({ ok: true, hash: "0xe" });
    expect(Number((await repo.lockById(db, C, 1n)).lock_end)).toBe(THU + 28 * DAY);
    expect(notify).toHaveBeenCalledWith(A, "extended", expect.objectContaining({ lockId: "1", tx: "0xe" }));
    expect((await repo.keeperRuns(db, C, { actionsOnly: true }))[0]).toMatchObject({ job: "extend", ok: true, tx_hash: "0xe" });
    // after the extension the lock is outside the window -> no repeat
    expect((await extendTick(db, ch, C, THU + 60)).length).toBe(0);
  });
  it("waits on 'too early'/'no gain', deactivates on stale owner, logs missing approval", async () => {
    await seed(1n, THU + 5 * DAY);
    expect((await extendTick(db, chain({ canExtend: async () => [false, 10, 0n, 0n] }), C, THU)).length).toBe(0);
    expect((await repo.dueExtends(db, C, THU)).length).toBe(1);
    const r = await extendTick(db, chain({ canExtend: async () => [false, 5, 0n, 0n] }), C, THU);
    expect(r[0].reason).toContain("not approved");
    await extendTick(db, chain({ canExtend: async () => [false, 2, 0n, 0n] }), C, THU);
    expect((await repo.dueExtends(db, C, THU)).length).toBe(0);
  });
  it("records a reverted extend as a failure", async () => {
    await seed(1n, THU + 5 * DAY);
    const r = await extendTick(db, chain({ wait: async () => "reverted" }), C, THU);
    expect(r[0].ok).toBe(false);
    expect((await repo.keeperRuns(db, C, { actionsOnly: true }))[0].ok).toBe(false);
  });
});

describe("reward auto-claim job", () => {
  const G = "0x00000000000000000000000000000000000000a1" as Address, T = "0x00000000000000000000000000000000000000a2" as Address;
  const chain = (earned: bigint, over: Partial<RewardsChain> = {}): RewardsChain & { claims: unknown[] } => {
    const claims: unknown[] = [];
    return { claims, claimable: async () => [{ gauge: G, bribe: [{ token: T, earned }], fees: [{ token: T, earned: 0n }] }], claim: async (...a) => { claims.push(a); return "0xc"; }, wait: async () => "success", ...over };
  };
  async function seed() {
    await repo.upsertLock(db, { chainId: C, id: 5n, owner: A, amount: E18, end: THU + 20 * DAY, permanent: false, voted: true });
    await applyVaultEvent(db, C, { eventName: "RewardsAutoSet", args: { tokenId: 5n, owner: A, enabled: true }, transactionHash: "0x0" }, V2);
  }
  it("claims once per epoch after the distribute hour, only earned tokens", async () => {
    await seed();
    const ch = chain(7n * E18);
    expect((await rewardsTick(db, ch, C, THU + 1800)).length).toBe(0); // inside distribute hour
    const notify = vi.fn(async () => {});
    const r = await rewardsTick(db, ch, C, THU + 7200, notify);
    expect(r[0]).toMatchObject({ ok: true, hash: "0xc" });
    expect(ch.claims[0]).toEqual([5n, [G], [[T]], [[]]]);
    expect(notify).toHaveBeenCalledWith(A, "rewards_claimed", expect.objectContaining({ amount: "7" }));
    expect((await rewardsTick(db, ch, C, THU + 9000)).length).toBe(0); // already this epoch
    expect((await rewardsTick(db, ch, C, THU + 7 * DAY + 7200)).length).toBe(1); // next epoch
  });
  it("skips without a tx when nothing is earned; opting out stops it", async () => {
    await seed();
    const ch = chain(0n);
    expect((await rewardsTick(db, ch, C, THU + 7200))[0].skipped).toBe("nothing earned");
    expect(ch.claims.length).toBe(0);
    await applyVaultEvent(db, C, { eventName: "RewardsAutoSet", args: { tokenId: 5n, owner: A, enabled: false }, transactionHash: "0x0" }, V2);
    expect((await rewardsTick(db, chain(1n), C, THU + 7 * DAY + 7200)).length).toBe(0);
  });
  it("protect clears automation rows", async () => {
    await seed();
    await applyVaultEvent(db, C, { eventName: "Protected", args: { tokenId: 5n, owner: A, mode: 0, amount: 1n, newLockId: 0n }, transactionHash: "0x9" }, V2);
    expect((await repo.enabledRewards(db, C)).length).toBe(0);
  });
});

describe("loan rescue job", () => {
  const read = async () => ({ triggerIcr: 15n * E18 / 10n, deadline: BigInt(THU + 30 * DAY), addAmount: E18 / 10n, repayAmount: 0n, btc: E18 / 10n, musd: 0n });
  const chain = (ok: boolean, icr: bigint, over: Partial<RescueChain> = {}): RescueChain & { calls: Address[] } => {
    const calls: Address[] = [];
    return { calls, check: async () => [ok, icr, ok ? E18 / 10n : 0n, 0n], rescue: async (b) => { calls.push(b); return "0xr"; }, wait: async () => "success", ...over };
  };
  it("mirrors rule state from chain and rescues below trigger", async () => {
    await refreshRescue(db, C, read, A, "0xset");
    expect((await repo.rescueOf(db, C, A))).toMatchObject({ active: true, add_amount: (E18 / 10n).toString(), last_tx: "0xset" });
    const ch = chain(true, 14n * E18 / 10n);
    const notify = vi.fn(async () => {});
    const r = await rescueTick(db, ch, C, THU, notify);
    expect(ch.calls).toEqual([A]);
    expect(r[0]).toMatchObject({ ok: true, why: "below_trigger" });
    expect(notify).toHaveBeenCalledWith(A, "rescued", expect.objectContaining({ icr: "140.0%", btc: "0.1" }));
  });
  it("does nothing above trigger; flags a front-of-line watch from the Radar", async () => {
    await refreshRescue(db, C, read, A);
    await repo.replaceTroves(db, C, [{ owner: A, coll: E18, debt: 50_000n * E18, icr: 155n * E18 / 100n, rank: 1, musdAhead: 0n, redeemable: true }]);
    const ch = chain(false, 155n * E18 / 100n);
    const r = await rescueTick(db, ch, C, THU);
    expect(ch.calls.length).toBe(0);
    expect(r[0].why).toBe("front_of_line_watch");
  });
  it("consumed rule becomes inactive", async () => {
    await refreshRescue(db, C, async () => ({ triggerIcr: 0n, deadline: 0n, addAmount: 0n, repayAmount: 0n, btc: 0n, musd: 0n }), A, "0xdone");
    expect((await repo.activeRescues(db, C, THU)).length).toBe(0);
  });
});

describe("alerts v3", () => {
  it("watched wallets alert their watcher, labelled, without 'your'", async () => {
    await repo.upsertLock(db, { chainId: C, id: 9n, owner: B, amount: E18, end: THU + 3600, permanent: false, voted: false });
    await repo.createPendingSub(db, A, "telegram", "k1");
    await repo.verifySub(db, "k1", "chat");
    await repo.addWatch(db, A, B, "Treasury");
    const sent: string[] = [];
    const ch = { telegram: { send: async (_t: string, m: string) => { sent.push(m); } }, email: { send: async () => {} } };
    expect(await alertsTick(db, ch, cfg, THU)).toBe(1);
    expect(sent[0]).toContain("Watched wallet Treasury");
    expect(sent[0]).toContain("lock #9");
    const sub = (await repo.subsByAddress(db, A))[0];
    expect((await alertsFor(db, { ...sub, prefs: { watch_alerts: false } }, C, THU)).length).toBe(0);
  });
  it("linked wallets alert as your own", async () => {
    await repo.upsertLock(db, { chainId: C, id: 10n, owner: B, amount: E18, end: THU + 3600, permanent: false, voted: false });
    await repo.linkWallet(db, A, B);
    const out = await alertsFor(db, { id: 1, address: A, channel: "telegram", target: "x", verified: true, code: null, prefs: {} }, C, THU);
    expect(out[0][2].watch).toBeUndefined();
    expect(out[0][1]).toBe("lock_t1d");
  });
  it("new automation messages + notifier dedupes per tx and respects prefs", async () => {
    expect(message("extended", { lockId: "1", end: String(THU), tx: "0xe" }, cfg)).toContain("Auto-extend");
    expect(message("rewards_claimed", { lockId: "1", amount: "7", gauges: "1", tx: "0xc" }, cfg)).toContain("1 gauge)");
    expect(message("rescued", { icr: "140.0%", btc: "0.1", musd: "0", tx: "0xr" }, cfg)).toContain("your own trove");
    await repo.createPendingSub(db, A, "telegram", "k2");
    await repo.verifySub(db, "k2", "chat");
    const sent: string[] = [];
    const n = keeperNotifier(db, { telegram: { send: async (_t, m) => { sent.push(m); } }, email: { send: async () => {} } }, { ...loadConfig({} as never), ...cfg });
    await n(A, "rescued", { icr: "1", btc: "1", musd: "0", tx: "0xr" });
    await n(A, "rescued", { icr: "1", btc: "1", musd: "0", tx: "0xr" });
    expect(sent.length).toBe(1);
    const s = (await repo.subsByAddress(db, A))[0];
    await repo.updateSubPrefs(db, s.id, { extended: false });
    await n(A, "extended", { lockId: "1", end: "1", tx: "0xe" });
    expect(sent.length).toBe(1);
  });
});
