import { describe, expect, it, beforeAll } from "vitest";
import * as r from "../src";

let db: r.Db;
beforeAll(async () => { db = await r.connect("memory"); });
const A = "0x00000000000000000000000000000000000000AA";

describe("db", () => {
  it("locks + keeper queue", async () => {
    await r.upsertLock(db, { chainId: 1, id: 1n, owner: A, amount: 10n ** 18n, end: 100, permanent: false, voted: false });
    await r.upsertLock(db, { chainId: 1, id: 2n, owner: A, amount: 5n, end: 300, permanent: false, voted: true });
    await r.upsertProtection(db, { chainId: 1, lockId: 1n, owner: A, mode: 0, active: true });
    await r.upsertProtection(db, { chainId: 1, lockId: 2n, owner: A, mode: 1, active: true });
    expect((await r.locksByOwner(db, 1, A.toLowerCase())).length).toBe(2);
    expect((await r.dueProtections(db, 1, 200)).map((x) => x.lock_id)).toEqual(["1"]);
    const a = await r.recordAttempt(db, 1, 1n, "boom", 200);
    expect(a).toEqual({ attempts: 1, dead: false });
    expect((await r.dueProtections(db, 1, 200)).length).toBe(0); // backing off
    expect((await r.dueProtections(db, 1, 10_000)).length).toBe(2);
    await r.recordAttempt(db, 1, 1n, "boom", 200);
    expect((await r.recordAttempt(db, 1, 1n, "boom", 200)).dead).toBe(true);
    expect((await r.dueProtections(db, 1, 10_000)).map((x) => x.lock_id)).toEqual(["2"]);
    await r.markWithdrawn(db, 1, 2n);
    expect((await r.dueProtections(db, 1, 10_000)).length).toBe(0);
  });

  it("subscriptions verify once and alerts dedupe", async () => {
    const s = await r.createPendingSub(db, A, "telegram", "code123");
    expect(s.verified).toBe(false);
    const v = await r.verifySub(db, "code123", "998877");
    expect(v.verified).toBe(true);
    expect(await r.verifySub(db, "code123", "x")).toBeUndefined();
    expect(await r.claimAlert(db, v.id, "lock_t1d:1:1", "lock_t1d")).toBe(true);
    expect(await r.claimAlert(db, v.id, "lock_t1d:1:1", "lock_t1d")).toBe(false);
    expect((await r.subByTarget(db, "telegram", "998877"))?.id).toBe(v.id);
  });

  it("troves + nonces + cursor", async () => {
    await r.replaceTroves(db, 1, [{ owner: A, coll: 1n, debt: 2n, icr: 3n, rank: 1, musdAhead: 0n, redeemable: true }]);
    expect((await r.troveOf(db, 1, A))?.rank).toBe(1);
    await r.putNonce(db, "n1");
    expect(await r.useNonce(db, "n1")).toBe(true);
    expect(await r.useNonce(db, "n1")).toBe(false);
    await r.setCursor(db, "c", "5");
    expect(await r.getCursor(db, "c")).toBe("5");
  });
});
