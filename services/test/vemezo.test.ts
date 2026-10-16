import { describe, expect, it, beforeEach } from "vitest";
import * as repo from "@lockwatch/db";
import type { Address } from "viem";
import { ledgerId } from "@lockwatch/sdk";
import { keeperPass, type KeeperChain } from "../src/keeper";
import { extendTick, rewardsTick, type ExtendChain, type RewardsChain } from "../src/automation";
import { applyVaultEvent, snapshotStats } from "../src/indexer";
import { alertsFor, message, keeperNotifier, handleTelegram } from "../src/alerts";
import { loadConfig, loadConfigs, allVaults } from "../src/config";
import type { Channel } from "../src/notify";

const A = "0x00000000000000000000000000000000000000aa" as Address;
const C = 31611, M = ledgerId(C, "mezo"), DAY = 86400, E18 = 10n ** 18n, THU = 1792022400;
const VM = "0x24fd63DE4274c71B51cA08adEd519B6cC72f27ae", V2 = "0xdd5baB25b65C4697A2e14F47B919B61416A0cAdB";
const cfg = { appUrl: "https://lockwatch.vercel.app", chainId: C as 31611 };
let db: repo.Db;
beforeEach(async () => { db = await repo.connect("memory"); });

const sub = async (addr = A) => { const s = await repo.createPendingSub(db, addr, "telegram", "c1"); return (await repo.verifySub(db, "c1", "chat"))!; };
const fakeProtect = (sent: bigint[][]): KeeperChain => ({
  isProtectable: async () => [true, 0], prefDebt: async () => 0n, hints: async () => [A, A],
  simulateBatch: async (ids) => ids.map(() => true), sendBatch: async (ids) => { sent.push(ids); return "0x1"; },
  wait: async () => "success", balance: async () => E18,
});

describe("veMEZO config", () => {
  it("binds the veMEZO vault, BoostVoter and a separate ledger; no rescue/legacy", () => {
    const m = loadConfig({} as NodeJS.ProcessEnv, "mezo");
    expect(m.asset).toBe("mezo");
    expect(m.ledger).toBe(1031611);
    expect(m.ve).toBe("0xaCE816CA2bcc9b12C59799dcC5A959Fb9b98111b");
    expect(m.voter).toBe("0x21d7bDF5a5929AD179F8cA0c9014A0B62ae6Bfd1");
    expect(allVaults(m)).toEqual([VM]);
    expect(m.rescue).toBeNull();
    expect(loadConfig({ LOCKWATCH_VAULT_MEZO: "0x01" } as never, "mezo").vault).toBe("0x01");
    expect(loadConfigs({} as never).map((c) => c.asset)).toEqual(["btc", "mezo"]);
    expect(loadConfig({} as never).ledger).toBe(C);
  });
});

describe("veMEZO ledger isolation", () => {
  it("same token id on veBTC and veMEZO never collide; keeper serves each vault on its own ledger", async () => {
    await repo.upsertLock(db, { chainId: C, id: 5n, owner: A, amount: E18, end: THU, permanent: false, voted: false });
    await repo.upsertLock(db, { chainId: M, id: 5n, owner: A, amount: 900n * E18, end: THU - 7 * DAY, permanent: false, voted: false });
    await applyVaultEvent(db, M, { eventName: "Registered", args: { tokenId: 5n, owner: A, mode: 0 }, transactionHash: "0x2" }, VM);
    expect((await repo.lockById(db, C, 5n)).amount).toBe(String(E18));
    expect((await repo.lockById(db, M, 5n)).amount).toBe(String(900n * E18));
    const sb: bigint[][] = [], sm: bigint[][] = [];
    await keeperPass(db, { vaults: [{ address: V2, isDefaultForNull: true, chain: fakeProtect(sb) }] }, C, THU + 7200);
    await keeperPass(db, { vaults: [{ address: VM, isDefaultForNull: true, chain: fakeProtect(sm) }] }, M, THU + 7200);
    expect(sb).toEqual([]);
    expect(sm).toEqual([[5n]]);
    expect((await repo.keeperRuns(db, M)).some((r) => r.job === "protect" && r.subject === "5")).toBe(true);
    expect((await repo.keeperRuns(db, C)).some((r) => r.job === "protect")).toBe(false);
  });

  it("at-risk snapshot for veMEZO counts MEZO only", async () => {
    await repo.upsertLock(db, { chainId: C, id: 1n, owner: A, amount: E18, end: 1, permanent: false, voted: false });
    await repo.upsertLock(db, { chainId: M, id: 1n, owner: A, amount: 250n * E18, end: 1, permanent: false, voted: false });
    const s = await snapshotStats(db, M);
    expect(s.expiredBtc).toBe(250n * E18);
    expect((await repo.latestSnapshot(db, M))!.btc_at_risk).toBe(String(250n * E18));
  });
});

describe("veMEZO automation", () => {
  it("auto-extends a veMEZO lock to the 4-year target", async () => {
    await repo.upsertLock(db, { chainId: M, id: 9n, owner: A, amount: E18, end: THU + 3 * DAY, permanent: false, voted: false });
    await applyVaultEvent(db, M, { eventName: "ExtendSet", args: { tokenId: 9n, owner: A, triggerWithin: 30 * DAY, duration: 0 }, transactionHash: "0x0" }, VM);
    const target = THU + 4 * 365 * DAY;
    const ch: ExtendChain = { canExtend: async () => [true, 0, BigInt(THU + 3 * DAY), BigInt(target)], extend: async () => "0xe", wait: async () => "success" };
    const notes: Record<string, string>[] = [];
    const r = await extendTick(db, ch, M, THU, async (_o, _k, d) => { notes.push(d); });
    expect(r[0].ok).toBe(true);
    expect(Number((await repo.lockById(db, M, 9n)).lock_end)).toBe(target);
    expect(await repo.lockById(db, C, 9n)).toBeUndefined();
    expect(notes[0].end).toBe(String(target));
  });

  it("claims BoostVoter bribes with empty fee lists", async () => {
    await repo.upsertLock(db, { chainId: M, id: 3n, owner: A, amount: E18, end: THU + 300 * DAY, permanent: false, voted: true });
    await applyVaultEvent(db, M, { eventName: "RewardsAutoSet", args: { tokenId: 3n, owner: A, enabled: true }, transactionHash: "0x0" }, VM);
    const G = "0x0000000000000000000000000000000000000001" as Address, T = "0x0000000000000000000000000000000000000002" as Address;
    let args: unknown[] = [];
    const ch: RewardsChain = {
      claimable: async () => [{ gauge: G, bribe: [{ token: T, earned: 5n * E18 }], fees: [] }],
      claim: async (...a) => { args = a; return "0xc"; }, wait: async () => "success",
    };
    const r = await rewardsTick(db, ch, M, THU + 2 * 3600);
    expect(r[0].ok).toBe(true);
    expect(args).toEqual([3n, [G], [[T]], [[]]]);
  });
});

describe("veMEZO alerts", () => {
  it("expiry alerts name MEZO and link ?asset=mezo; keys don't collide with veBTC", async () => {
    const s = await sub();
    await repo.upsertLock(db, { chainId: C, id: 7n, owner: A, amount: E18, end: THU + 3 * DAY, permanent: false, voted: false });
    await repo.upsertLock(db, { chainId: M, id: 7n, owner: A, amount: 1500n * E18, end: THU + 3 * DAY, permanent: false, voted: false });
    const out = await alertsFor(db, s, C, THU);
    expect(out.map(([k]) => k).sort()).toEqual([`lock_t7d:${C}:7:${THU + 3 * DAY}`, `lock_t7d:${M}:7:${THU + 3 * DAY}`].sort());
    const mz = out.find(([k]) => k.includes(String(M)))!;
    const txt = message(mz[1], mz[2], cfg);
    expect(txt).toContain("veMEZO lock #7");
    expect(txt).toMatch(/1,?500 MEZO/);
    expect(txt).toContain("/protect/7?asset=mezo");
    const bt = message(out.find(([k]) => !k.includes(String(M)))![1], out.find(([k]) => !k.includes(String(M)))![2], cfg);
    expect(bt).toContain("veBTC lock #7");
    expect(bt).not.toContain("MEZO");
  });

  it("keeper notifier tags veMEZO notices", async () => {
    await sub();
    const sent: string[] = [];
    const ch: Channel = { send: async (_t, m) => { sent.push(m); } } as Channel;
    const n = keeperNotifier(db, { telegram: ch, email: ch }, loadConfig({} as never, "mezo"));
    await n(A, "extended", { lockId: "4", end: String(THU), tx: "0xabc" });
    expect(sent[0]).toContain("veMEZO lock #4");
    expect(sent[0]).toContain("?asset=mezo");
  });

  it("/locks lists both assets", async () => {
    await sub();
    await repo.upsertLock(db, { chainId: C, id: 1n, owner: A, amount: E18, end: 2_000_000_000, permanent: false, voted: false });
    await repo.upsertLock(db, { chainId: M, id: 2n, owner: A, amount: 10n * E18, end: 2_000_000_000, permanent: false, voted: false });
    const sent: string[] = [];
    await handleTelegram(db, { send: async (_t: string, m: string) => { sent.push(m); } } as Channel, "chat", "/locks", cfg);
    expect(sent[0]).toMatch(/veBTC #1 · 1 BTC/);
    expect(sent[0]).toMatch(/veMEZO #2 · 10 MEZO/);
  });
});
