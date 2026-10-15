import { describe, expect, it, beforeAll } from "vitest";
import { connect, type Db } from "../src";
import * as repo from "../src";

const C = 31611, A = "0x00000000000000000000000000000000000000AA", B = "0x00000000000000000000000000000000000000bb";
const V1 = "0xD7160697f3ACd0191e65bcccaAFeaa0913D21999", V2 = "0xdd5baB25b65C4697A2e14F47B919B61416A0cAdB";
let db: Db;
const now = 1_792_100_000;
beforeAll(async () => {
  db = await connect("memory");
  await repo.upsertLock(db, { chainId: C, id: 1n, owner: A, amount: 10n, end: now + 3 * 86400, permanent: false, voted: false });
  await repo.upsertLock(db, { chainId: C, id: 2n, owner: A, amount: 10n, end: now + 20 * 86400, permanent: false, voted: true });
  await repo.upsertLock(db, { chainId: C, id: 3n, owner: B, amount: 10n, end: now - 10, permanent: false, voted: false });
  await repo.upsertLock(db, { chainId: C, id: 4n, owner: B, amount: 10n, end: now - 10, permanent: false, voted: false });
});

describe("multi-vault protections", () => {
  it("routes NULL-vault rows to the v1 vault and tagged rows to theirs", async () => {
    await repo.upsertProtection(db, { chainId: C, lockId: 3n, owner: B, mode: 0, active: true }); // legacy row, no vault
    await repo.upsertProtection(db, { chainId: C, lockId: 4n, owner: B, mode: 0, active: true, vault: V2 });
    const v1 = await repo.dueProtections(db, C, now, { address: V1, isDefaultForNull: true });
    const v2 = await repo.dueProtections(db, C, now, { address: V2, isDefaultForNull: false });
    expect(v1.map((r) => r.lock_id)).toEqual(["3"]);
    expect(v2.map((r) => r.lock_id)).toEqual(["4"]);
    expect((await repo.dueProtections(db, C, now)).length).toBe(2);
    // a later update without vault keeps the vault tag
    await repo.upsertProtection(db, { chainId: C, lockId: 4n, owner: B, mode: 1, active: true });
    expect((await repo.protectionById(db, C, 4n)).vault).toBe(V2.toLowerCase());
  });
});

describe("auto-extend", () => {
  it("due only inside the window", async () => {
    await repo.upsertExtend(db, { chainId: C, lockId: 1n, owner: A, triggerWithin: 7 * 86400, duration: 0, active: true });
    await repo.upsertExtend(db, { chainId: C, lockId: 2n, owner: A, triggerWithin: 7 * 86400, duration: 0, active: true });
    expect((await repo.dueExtends(db, C, now)).map((r) => r.lock_id)).toEqual(["1"]);
    await repo.markExtended(db, C, 1n, "0xabc", now);
    const rows = await repo.extendsByOwner(db, C, A);
    expect(rows.find((r) => r.lock_id === "1")!.last_tx).toBe("0xabc");
    await repo.setExtendActive(db, C, 1n, false);
    expect((await repo.dueExtends(db, C, now)).length).toBe(0);
  });
});

describe("rewards", () => {
  it("opt-in, claimed marker", async () => {
    await repo.upsertRewards(db, { chainId: C, lockId: 2n, owner: A, enabled: true });
    expect((await repo.enabledRewards(db, C)).map((r) => r.lock_id)).toEqual(["2"]);
    await repo.markRewardsClaimed(db, C, 2n, "0xr", now);
    expect(Number((await repo.rewardsByOwner(db, C, A))[0].last_claim_at)).toBe(now);
    await repo.upsertRewards(db, { chainId: C, lockId: 2n, owner: A, enabled: false });
    expect((await repo.enabledRewards(db, C)).length).toBe(0);
  });
});

describe("rescue", () => {
  it("active until deadline", async () => {
    await repo.upsertRescue(db, { chainId: C, borrower: A, triggerIcr: 15n * 10n ** 17n, addAmount: 1n, repayAmount: 0n, deadline: now + 100, btcEscrow: 1n, musdEscrow: 0n, active: true });
    expect((await repo.activeRescues(db, C, now)).length).toBe(1);
    expect((await repo.activeRescues(db, C, now + 101)).length).toBe(0);
    expect((await repo.rescueOf(db, C, A))!.trigger_icr).toBe("1500000000000000000");
  });
});

describe("keeper log", () => {
  it("logs runs, filters actions, prunes heartbeats", async () => {
    await repo.logRun(db, { chainId: C, job: "heartbeat", ok: true, ts: now - 8 * 86400 });
    await repo.logRun(db, { chainId: C, job: "heartbeat", ok: true, ts: now });
    await repo.logRun(db, { chainId: C, job: "extend", subject: "1", ok: true, txHash: "0x1", ts: now });
    expect((await repo.keeperRuns(db, C)).length).toBe(3);
    expect((await repo.keeperRuns(db, C, { actionsOnly: true })).map((r) => r.job)).toEqual(["extend"]);
    await repo.pruneHeartbeats(db, C, now);
    expect((await repo.keeperRuns(db, C)).length).toBe(2);
  });
});

describe("watchlists and wallet links", () => {
  it("watch / unwatch / watchers", async () => {
    await repo.addWatch(db, A, B, "Treasury");
    await repo.addWatch(db, A, B, "Treasury 2");
    expect((await repo.watchlist(db, A))).toMatchObject([{ address: B, label: "Treasury 2" }]);
    expect((await repo.watchersOf(db, B)).map((r) => r.account)).toEqual([A.toLowerCase()]);
    await repo.removeWatch(db, A, B);
    expect((await repo.watchlist(db, A)).length).toBe(0);
  });
  it("links wallets to an account", async () => {
    await repo.linkWallet(db, A, B);
    await repo.linkWallet(db, A, B);
    expect(await repo.walletsOf(db, A)).toEqual([A.toLowerCase(), B]);
    await repo.unlinkWallet(db, A, B);
    expect(await repo.walletsOf(db, A)).toEqual([A.toLowerCase()]);
  });
});
