import { describe, expect, it, beforeEach, vi } from "vitest";
import * as repo from "@lockwatch/db";
import type { Address } from "viem";
import { keeperTick, type KeeperChain } from "../src/keeper";
import { alertsTick, alertsFor, handleTelegram, message } from "../src/alerts";
import { applyVaultEvent } from "../src/indexer";
import { telegram, resend } from "../src/notify";

const A = "0x00000000000000000000000000000000000000aa";
const Z = "0x0000000000000000000000000000000000000000" as Address;
const C = 31611;
let db: repo.Db;
beforeEach(async () => { db = await repo.connect("memory"); });

function fakeChain(over: Partial<KeeperChain> = {}): KeeperChain & { sent: bigint[][] } {
  const sent: bigint[][] = [];
  return {
    sent,
    isProtectable: async () => [true, 0],
    prefDebt: async () => 3000n * 10n ** 18n,
    hints: async () => ["0x00000000000000000000000000000000000000b1", "0x00000000000000000000000000000000000000b2"],
    simulateBatch: async (ids) => ids.map(() => true),
    sendBatch: async (ids) => { sent.push(ids); return "0xabc"; },
    wait: async () => "success",
    balance: async () => 10n ** 18n,
    ...over,
  };
}

async function seed(id: bigint, end: number, mode = 0) {
  await repo.upsertLock(db, { chainId: C, id, owner: A, amount: 10n ** 17n, end, permanent: false, voted: false, approvedVault: true });
  await repo.upsertProtection(db, { chainId: C, lockId: id, owner: A, mode, active: true });
}

describe("keeper", () => {
  it("protects due locks in chunks and skips not-yet-due", async () => {
    for (let i = 1; i <= 25; i++) await seed(BigInt(i), 100);
    await seed(99n, 10_000);
    const ch = fakeChain();
    const r = await keeperTick(db, ch, C, 200);
    expect(r.filter((x) => x.ok).length).toBe(25);
    expect(ch.sent.map((b) => b.length)).toEqual([20, 5]);
  });

  it("passes SortedTroves hints for MUSD modes only", async () => {
    await seed(1n, 100, 2);
    await seed(2n, 100, 0);
    const calls: Address[][] = [];
    const ch = fakeChain({ sendBatch: async (_ids, ups) => { calls.push(ups); return "0x1"; } });
    await keeperTick(db, ch, C, 200);
    expect(calls[0]).toEqual(["0x00000000000000000000000000000000000000b1", Z]);
  });

  it("waits during the vote-reset window without counting a failure", async () => {
    await seed(1n, 100);
    const ch = fakeChain({ isProtectable: async () => [false, 6] });
    await keeperTick(db, ch, C, 200);
    expect(ch.sent.length).toBe(0);
    expect((await repo.dueProtections(db, C, 200)).length).toBe(1);
  });

  it("notifies owner on stale approval and backs off, dead-letters after 3 sim failures", async () => {
    await seed(1n, 100);
    const notify = vi.fn(async () => {});
    await keeperTick(db, fakeChain({ isProtectable: async () => [false, 5] }), C, 200, notify);
    expect(notify).toHaveBeenCalledWith(A, "protect_failed", expect.objectContaining({ lockId: "1" }));
    await seed(2n, 100);
    const bad = fakeChain({ simulateBatch: async (ids) => ids.map(() => false) });
    for (const t of [200, 10_000, 100_000]) await keeperTick(db, bad, C, t, notify);
    expect(bad.sent.length).toBe(0);
    expect(notify.mock.calls.some((c) => (c as unknown[])[2] && ((c as unknown[])[2] as { lockId: string }).lockId === "2")).toBe(true);
    expect((await repo.dueProtections(db, C, 10_000_000)).map((x) => x.lock_id)).not.toContain("2");
  });

  it("low balance alert", async () => {
    const notify = vi.fn(async () => {});
    await keeperTick(db, fakeChain({ balance: async () => 1n }), C, 200, notify);
    expect(notify).toHaveBeenCalledWith("admin", "keeper_low_balance", expect.anything());
  });
});

describe("indexer vault events", () => {
  it("Registered → Protected lifecycle", async () => {
    await applyVaultEvent(db, C, { eventName: "Registered", args: { tokenId: 7n, owner: A, mode: 1 }, transactionHash: "0x1" });
    expect((await repo.protectionsByOwner(db, C, A))[0].active).toBe(true);
    await applyVaultEvent(db, C, { eventName: "Protected", args: { tokenId: 7n, owner: A, mode: 1, amount: 5n, newLockId: 9n }, transactionHash: "0xfeed" });
    const p = (await repo.protectionsByOwner(db, C, A))[0];
    expect([p.active, p.tx_hash, p.new_lock_id]).toEqual([false, "0xfeed", "9"]);
  });
});

describe("alerts", () => {
  const cfg = { appUrl: "https://lockwatch.vercel.app", chainId: C as 31611 };
  it("sends T-1d once, respects prefs, includes protected tx", async () => {
    const now = 1_000_000;
    await repo.upsertLock(db, { chainId: C, id: 1n, owner: A, amount: 10n ** 18n, end: now + 3600, permanent: false, voted: false });
    const s = await repo.createPendingSub(db, A, "telegram", "c1");
    await repo.verifySub(db, "c1", "chat1");
    const sent: string[] = [];
    const ch = { telegram: { send: async (_t: string, m: string) => { sent.push(m); } }, email: { send: async () => {} } };
    expect(await alertsTick(db, ch, cfg, now)).toBe(1);
    expect(await alertsTick(db, ch, cfg, now + 60)).toBe(0);
    expect(sent[0]).toContain("under 24h");
    await applyVaultEvent(db, C, { eventName: "Protected", args: { tokenId: 1n, owner: A, mode: 0, amount: 10n ** 18n, newLockId: 0n }, transactionHash: "0xdead" });
    await alertsTick(db, ch, cfg, now + 120);
    expect(sent.at(-1)).toContain("explorer.test.mezo.org/tx/0xdead");
    await repo.updateSubPrefs(db, s.id, { lock_t7d: false });
    await repo.upsertLock(db, { chainId: C, id: 2n, owner: A, amount: 1n, end: now + 5 * 86400, permanent: false, voted: false });
    const due = await alertsFor(db, { ...s, verified: true, target: "chat1", prefs: { lock_t7d: false } }, C, now);
    expect(due.find(([, k]) => k === "lock_t7d")).toBeUndefined();
  });

  it("radar danger alert from trove table", async () => {
    await repo.replaceTroves(db, C, [{ owner: A, coll: 10n ** 17n, debt: 5000n * 10n ** 18n, icr: 115n * 10n ** 16n, rank: 2, musdAhead: 1000n * 10n ** 18n, redeemable: true }]);
    const out = await alertsFor(db, { id: 1, address: A, channel: "telegram", target: "x", verified: true, code: null, prefs: {} }, C, 1);
    expect(out[0][1]).toBe("radar_danger");
    expect(message("radar_danger", out[0][2], cfg)).toContain("1,000 MUSD");
  });

  it("failed send is released for retry", async () => {
    await repo.upsertLock(db, { chainId: C, id: 1n, owner: A, amount: 1n, end: 50, permanent: false, voted: false });
    await repo.createPendingSub(db, A, "email", "e1", "a@b.co");
    await repo.verifySub(db, "e1");
    let fail = true;
    const ch = { telegram: { send: async () => {} }, email: { send: async () => { if (fail) throw new Error("x"); } } };
    expect(await alertsTick(db, ch, cfg, 100)).toBe(0);
    fail = false;
    expect(await alertsTick(db, ch, cfg, 100)).toBe(1);
  });
});

describe("telegram bot", () => {
  const cfg = { appUrl: "https://lockwatch.vercel.app", chainId: C as 31611 };
  it("/start links, /locks lists, /mute toggles", async () => {
    await repo.createPendingSub(db, A, "telegram", "abc");
    await repo.upsertLock(db, { chainId: C, id: 3n, owner: A, amount: 2n * 10n ** 18n, end: 1, permanent: false, voted: true });
    const out: string[] = [];
    const tg = { send: async (_c: string, m: string) => { out.push(m); } };
    await handleTelegram(db, tg, "42", "/start abc", cfg);
    expect(out[0]).toContain("Linked");
    await handleTelegram(db, tg, "42", "/locks", cfg);
    expect(out[1]).toContain("#3 · 2 BTC · 🔓 expired · voted");
    await handleTelegram(db, tg, "42", "/mute", cfg);
    expect(out[2]).toContain("Muted");
    await handleTelegram(db, tg, "43", "/start abc", cfg);
    expect(out[3]).toContain("expired");
  });
});

describe("notify transports", () => {
  it("telegram + resend request shapes", async () => {
    const calls: [string, RequestInit][] = [];
    const f = (async (u: string, i: RequestInit) => { calls.push([u, i]); return new Response(JSON.stringify({ ok: true, result: {} })); }) as unknown as typeof fetch;
    await telegram("TOKEN", f).send("1", "hi");
    await resend("KEY", "a@b", f).send("c@d", "<b>Subject</b>\nbody");
    expect(calls[0][0]).toBe("https://api.telegram.org/botTOKEN/sendMessage");
    expect(JSON.parse(calls[1][1].body as string).subject).toBe("Subject");
  });
});
