import { describe, expect, it, beforeAll } from "vitest";
import * as r from "../src";

let db: r.Db;
const A = "0x00000000000000000000000000000000000000AA";
const B = "0x00000000000000000000000000000000000000BB";
beforeAll(async () => {
  db = await r.connect("memory");
  for (const [id, owner, amt, end] of [[1n, A, 10n ** 18n, 100], [2n, A, 5n, 300], [3n, B, 868n * 10n ** 18n, 50], [4n, B, 2n, 10_000]] as const)
    await r.upsertLock(db, { chainId: 7, id, owner, amount: amt, end, permanent: false, voted: false });
});

describe("read models", () => {
  it("exploreLocks filters, sorts, paginates and excludes outliers", async () => {
    const all = await r.exploreLocks(db, 7, { state: "expired", now: 1000 });
    expect(all.total).toBe(3);
    expect(all.rows.map((x) => String(x.id))).toEqual(["3", "1", "2"]);
    const page = await r.exploreLocks(db, 7, { state: "expired", now: 1000, limit: 1, offset: 1 });
    expect(page.rows.map((x) => String(x.id))).toEqual(["1"]);
    const noOut = await r.exploreLocks(db, 7, { state: "expired", now: 1000, excludeOver: 100n * 10n ** 18n, sort: "end", dir: "asc" });
    expect(noOut.rows.map((x) => String(x.id))).toEqual(["1", "2"]);
    expect((await r.exploreLocks(db, 7, { state: "live", now: 1000 })).rows.map((x) => String(x.id))).toEqual(["4"]);
  });

  it("activity derives kinds from protection + keeper state", async () => {
    await r.upsertProtection(db, { chainId: 7, lockId: 1n, owner: A, mode: 0, active: false, txHash: "0xabc", amount: 10n ** 18n });
    await r.upsertProtection(db, { chainId: 7, lockId: 2n, owner: A, mode: 1, active: true });
    await r.upsertProtection(db, { chainId: 7, lockId: 4n, owner: B, mode: 2, active: true });
    await r.recordAttempt(db, 7, 4n, "simulation failed", 1000);
    const { items, hasMore } = await r.activity(db, 7, { limit: 10 });
    const by = Object.fromEntries(items.map((i) => [i.lock_id, i]));
    expect(by["1"].kind).toBe("protected");
    expect(by["1"].tx_hash).toBe("0xabc");
    expect(by["2"].kind).toBe("registered");
    expect(by["4"].kind).toBe("retrying");
    expect(by["4"].detail).toBe("simulation failed");
    expect(hasMore).toBe(false);
    expect((await r.activity(db, 7, { owner: B })).items.map((i) => i.lock_id)).toEqual(["4"]);
    expect((await r.activity(db, 7, { limit: 1 })).hasMore).toBe(true);
    expect((await r.protectionById(db, 7, 2n))?.mode).toBe(1);
    expect((await r.attemptById(db, 7, 4n))?.attempts).toBe(1);
  });
});
