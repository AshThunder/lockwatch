import { describe, expect, it, beforeAll } from "vitest";
import * as repo from "@lockwatch/db";
import { ledgerId } from "@lockwatch/sdk";
import { db } from "../src/server/db";
import { GET as locks } from "../app/api/locks/route";
import { GET as lockById } from "../app/api/locks/[id]/route";
import { GET as atRisk } from "../app/api/at-risk/route";
import { GET as explore } from "../app/api/explore/route";
import { GET as calendar } from "../app/api/calendar/[address]/route";
import { GET as portfolio } from "../app/api/portfolio/route";
import { GET as search } from "../app/api/search/route";
import { GET as keeper } from "../app/api/keeper/route";
import { GET as automation } from "../app/api/automation/route";

const C = 31611, M = ledgerId(C, "mezo"), E18 = 10n ** 18n;
const O = "0x00000000000000000000000000000000000000d4";
const ip = () => ({ "x-forwarded-for": Math.random().toString() });
const get = (u: string) => new Request(`http://t${u}`, { headers: ip() });

beforeAll(async () => {
  process.env.KEEPER_BALANCE_RPC = "off";
  const d = await db();
  const now = Math.floor(Date.now() / 1000);
  // same id 777 on both escrows, different owners/amounts
  await repo.upsertLock(d, { chainId: C, id: 777n, owner: O, amount: 2n * E18, end: now + 3 * 86400, permanent: false, voted: false });
  await repo.upsertLock(d, { chainId: M, id: 777n, owner: O, amount: 5000n * E18, end: now + 9 * 86400, permanent: false, voted: true });
  await repo.upsertLock(d, { chainId: M, id: 778n, owner: O, amount: 1200n * E18, end: now - 30 * 86400, permanent: false, voted: false });
  await repo.upsertProtection(d, { chainId: M, lockId: 777n, owner: O, mode: 1, active: true });
  await repo.upsertExtend(d, { chainId: M, lockId: 777n, owner: O, triggerWithin: 30 * 86400, duration: 0, active: true });
  await repo.logRun(d, { chainId: M, job: "extend", subject: "777", ok: true, txHash: "0xmezo", ts: now - 60 });
  await repo.logRun(d, { chainId: C, job: "heartbeat", ok: true, ts: now - 30 });
});

describe("veMEZO API", () => {
  it("/api/locks returns both assets tagged, never merged", async () => {
    const j = await (await locks(get(`/api/locks?owner=${O}`))).json();
    const tags = j.locks.map((l: { asset: string; id: string }) => `${l.asset}:${l.id}`).sort();
    expect(tags).toEqual(["btc:777", "mezo:777", "mezo:778"]);
    expect(j.locks.find((l: { asset: string; id: string }) => l.asset === "mezo" && l.id === "777").protection.mode).toBe(1);
  });
  it("/api/locks/[id]?asset=mezo reads the veMEZO ledger", async () => {
    const b = await (await lockById(get("/api/locks/777"), { params: { id: "777" } })).json();
    const m = await (await lockById(get("/api/locks/777?asset=mezo"), { params: { id: "777" } })).json();
    expect(b.lock.amount).toBe(String(2n * E18));
    expect(m.lock.amount).toBe(String(5000n * E18));
    expect(m.asset).toBe("mezo");
    expect(m.protection.mode).toBe(1);
  });
  it("at-risk and explorer keep MEZO separate from BTC", async () => {
    const m = await (await atRisk(get("/api/at-risk?asset=mezo"))).json();
    expect(m.asset).toBe("mezo");
    expect(m.expiredBtc).toBe(String(1200n * E18));
    const b = await (await atRisk(get("/api/at-risk"))).json();
    expect(BigInt(b.expiredBtc) < 1000n * E18).toBe(true);
    const e = await (await explore(get("/api/explore?asset=mezo&state=all"))).json();
    expect(e.rows.map((r: { id: string }) => r.id).sort()).toEqual(["777", "778"]);
  });
  it("calendar feed includes veMEZO unlocks with MEZO copy", async () => {
    const ics = await (await calendar(get(`/api/calendar/${O}.ics`), { params: { address: `${O}.ics` } })).text();
    expect(ics).toContain("veMEZO lock #777 unlocks (5000 MEZO)");
    expect(ics).toContain("veBTC lock #777 unlocks (2 BTC)");
    expect(ics).toContain("UID:lockwatch-m777-");
  });
  it("portfolio keeps per-asset totals", async () => {
    const j = await (await portfolio(get(`/api/portfolio?addresses=${O}`))).json();
    expect(j.totals.locked).toBe(String(2n * E18));
    expect(j.totals.mezo.locked).toBe(String(6200n * E18));
    expect(j.totals.mezo.idle).toBe(String(1200n * E18));
    expect(j.totals.mezo.coverage).toBe(100);
  });
  it("search returns both matches for a shared id", async () => {
    const j = await (await search(get("/api/search?q=%23777"))).json();
    expect(j.matches.map((m: { asset: string }) => m.asset)).toEqual(["btc", "mezo"]);
    expect(j.matches[1].href).toBe("/lock/777?asset=mezo");
  });
  it("keeper feed merges ledgers and tags asset; ?asset filters", async () => {
    const j = await (await keeper(get("/api/keeper"))).json();
    expect(j.items.some((i: { asset: string; tx: string }) => i.asset === "mezo" && i.tx === "0xmezo")).toBe(true);
    const f = await (await keeper(get("/api/keeper?asset=btc"))).json();
    expect(f.items.some((i: { asset: string }) => i.asset === "mezo")).toBe(false);
  });
  it("automation lists veMEZO policies with asset", async () => {
    const j = await (await automation(get(`/api/automation?owner=${O}`))).json();
    expect(j.extend).toEqual([expect.objectContaining({ asset: "mezo", lockId: "777", triggerWithin: 30 * 86400 })]);
  });
});
