import { describe, expect, it, beforeAll } from "vitest";
import * as repo from "@lockwatch/db";
import { db } from "../src/server/db";
import { parseSearch, lockTimeline } from "../src/server/queries";
import { GET as explore } from "../app/api/explore/route";
import { GET as activity } from "../app/api/activity/route";
import { GET as search } from "../app/api/search/route";
import { GET as lock } from "../app/api/locks/[id]/route";

const C = 31611, A = "0x00000000000000000000000000000000000000aa";
const req = (u: string) => new Request(`http://t${u}`, { headers: { "x-forwarded-for": Math.random().toString() } });
const BTC = 10n ** 18n;
beforeAll(async () => {
  const d = await db();
  const now = Math.floor(Date.now() / 1000);
  await repo.upsertLock(d, { chainId: C, id: 100n, owner: A, amount: 868n * BTC, end: now - 350 * 86400, permanent: false, voted: false });
  await repo.upsertLock(d, { chainId: C, id: 101n, owner: A, amount: 2n * BTC, end: now - 3 * 86400, permanent: false, voted: true });
  await repo.upsertLock(d, { chainId: C, id: 102n, owner: A, amount: BTC / 2n, end: now - 86400, permanent: false, voted: false });
  await repo.upsertLock(d, { chainId: C, id: 380n, owner: A, amount: 4n * 10n ** 15n, end: now + 6 * 86400, permanent: false, voted: true });
  await repo.upsertProtection(d, { chainId: C, lockId: 380n, owner: A, mode: 0, active: true });
  await repo.upsertProtection(d, { chainId: C, lockId: 102n, owner: A, mode: 0, active: false, txHash: "0xfeed", amount: BTC / 2n });
});

describe("parseSearch", () => {
  it("routes ids and addresses", () => {
    expect(parseSearch("#100")).toMatchObject({ kind: "lock", id: "100", href: "/lock/100" });
    expect(parseSearch(" lock 7 ")).toMatchObject({ kind: "lock", id: "7" });
    expect(parseSearch("0x" + "Ab".repeat(20))).toMatchObject({ kind: "address", href: `/dashboard?address=0x${"ab".repeat(20)}` });
    expect(parseSearch("0x12").kind).toBe("none");
    expect(parseSearch("hello").kind).toBe("none");
  });
  it("timeline marks voted window and claim", () => {
    const t = lockTimeline(1000, 2000, { voted: true, protectedTx: "0x1" });
    expect(t.map((s) => s.key)).toEqual(["t7", "t1", "end", "votes", "claim"]);
    expect(t.every((s) => s.state === "done")).toBe(true);
    const u = lockTimeline(10 * 86400, 0, { voted: false });
    expect(u[0].state).toBe("now");
    expect(u.at(-1)!.state).toBe("next");
  });
});

describe("api", () => {
  it("explore paginates and hides the outlier", async () => {
    const a = await (await explore(req("/api/explore?size=2"))).json();
    expect(a.total).toBe(3);
    expect(a.pages).toBe(2);
    expect(a.rows[0].id).toBe("100");
    const b = await (await explore(req("/api/explore?outliers=hide&sort=end&dir=asc"))).json();
    expect(b.hiddenOutlier.id).toBe("100");
    expect(b.rows.map((r: { id: string }) => r.id)).toEqual(["101", "102"]);
    expect((await explore(req("/api/explore?sort=nope"))).status).toBe(400);
  });
  it("activity lists keeper actions with tx links", async () => {
    const r = await (await activity(req("/api/activity"))).json();
    const k = Object.fromEntries(r.items.map((i: { lock_id: string; kind: string }) => [i.lock_id, i.kind]));
    expect(k).toMatchObject({ "380": "registered", "102": "protected" });
    expect((await activity(req("/api/activity?owner=bad"))).status).toBe(400);
  });
  it("search resolves locks and wallets", async () => {
    expect(await (await search(req("/api/search?q=%23100"))).json()).toMatchObject({ kind: "lock", found: true });
    expect(await (await search(req("/api/search?q=%23999"))).json()).toMatchObject({ kind: "lock", found: false });
    expect(await (await search(req(`/api/search?q=${A}`))).json()).toMatchObject({ kind: "address", found: true, locks: 4 });
  });
  it("lock detail includes protection, timeline and activity", async () => {
    const r = await (await lock(req("/api/locks/380"), { params: { id: "380" } })).json();
    expect(r.lock).toMatchObject({ id: "380", voted: true, status: "expiring" });
    expect(r.protection).toMatchObject({ mode: 0, active: true });
    expect(r.timeline.map((s: { key: string }) => s.key)).toContain("votes");
    expect(r.activity[0].kind).toBe("registered");
    expect((await lock(req("/api/locks/9999"), { params: { id: "9999" } })).status).toBe(404);
  });
});
