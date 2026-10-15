import { describe, expect, it, beforeAll, vi } from "vitest";
import * as repo from "@lockwatch/db";
import { createSiweMessage } from "viem/siwe";
import { privateKeyToAccount } from "viem/accounts";
import { db } from "../src/server/db";
import { GET as calendar } from "../app/api/calendar/[address]/route";
import { GET as wlGet, POST as wlPost, PUT as wlPut, DELETE as wlDel } from "../app/api/watchlist/route";
import { GET as wGet, POST as wPost, DELETE as wDel } from "../app/api/wallets/route";
import { GET as portfolio } from "../app/api/portfolio/route";
import { GET as keeper } from "../app/api/keeper/route";
import { GET as automation } from "../app/api/automation/route";

// SIWE verification is real (viem verifySiweMessage); only the RPC client is unused for EOAs.
const C = 31611, BTC = 10n ** 18n;
const acct = privateKeyToAccount(("0x" + "a1".repeat(32)) as `0x${string}`);
const other = privateKeyToAccount(("0x" + "b2".repeat(32)) as `0x${string}`);
const W = "0x00000000000000000000000000000000000000c3";
const ip = () => ({ "x-forwarded-for": Math.random().toString() });
const get = (u: string) => new Request(`http://t${u}`, { headers: ip() });
const send = (method: string, body: unknown) => new Request("http://t/api", { method, body: JSON.stringify(body), headers: { "content-type": "application/json", ...ip() } });

async function siwe(a = acct, statement = "Lockwatch") {
  const nonce = Math.random().toString(36).slice(2, 12).padEnd(10, "x");
  await repo.putNonce(await db(), nonce);
  const message = createSiweMessage({ address: a.address, chainId: C, domain: "lockwatch.test", nonce, uri: "https://lockwatch.test", version: "1", statement });
  return { message, signature: await a.signMessage({ message }) };
}

beforeAll(async () => {
  process.env.KEEPER_BALANCE_RPC = "off";
  const d = await db();
  const now = Math.floor(Date.now() / 1000);
  await repo.upsertLock(d, { chainId: C, id: 500n, owner: acct.address, amount: 2n * BTC, end: now + 5 * 86400, permanent: false, voted: true });
  await repo.upsertLock(d, { chainId: C, id: 501n, owner: acct.address, amount: BTC, end: now - 86400, permanent: false, voted: false });
  await repo.upsertLock(d, { chainId: C, id: 502n, owner: other.address, amount: 3n * BTC, end: now + 12 * 86400, permanent: false, voted: false });
  await repo.upsertProtection(d, { chainId: C, lockId: 500n, owner: acct.address, mode: 1, active: true });
  await repo.upsertExtend(d, { chainId: C, lockId: 502n, owner: other.address, triggerWithin: 7 * 86400, duration: 0, active: true });
  await repo.upsertRewards(d, { chainId: C, lockId: 500n, owner: acct.address, enabled: true });
  await repo.upsertRescue(d, { chainId: C, borrower: acct.address, triggerIcr: 15n * BTC / 10n, addAmount: BTC / 10n, repayAmount: 0n, deadline: now + 86400, btcEscrow: BTC / 10n, musdEscrow: 0n, active: true });
  await repo.replaceTroves(d, C, [{ owner: acct.address, coll: BTC, debt: 50_000n * BTC, icr: 164n * BTC / 100n, rank: 3, musdAhead: 20_000n * BTC, redeemable: true }]);
  await repo.logRun(d, { chainId: C, job: "heartbeat", ok: true, ts: now - 10 });
  await repo.logRun(d, { chainId: C, job: "protect", subject: "380", ok: true, txHash: "0xp", ts: now - 20 });
  await repo.logRun(d, { chainId: C, job: "extend", subject: "502", ok: false, detail: "vault not approved", ts: now - 30 });
});

describe("calendar feed", () => {
  it("returns an ICS with upcoming unlocks only", async () => {
    const r = await calendar(get(`/api/calendar/${acct.address}.ics`), { params: { address: `${acct.address}.ics` } });
    expect(r.headers.get("content-type")).toContain("text/calendar");
    const t = await r.text();
    expect(t.match(/BEGIN:VEVENT/g)!.length).toBe(1); // 501 ended, 500 upcoming
    expect(t.replace(/\r\n /g, "")).toContain("veBTC lock #500 unlocks (2 BTC)");
    expect(t.replace(/\r\n /g, "")).toContain("Lockwatch will: Re-lock.");
    expect((await calendar(get("/api/calendar/0x12"), { params: { address: "0x12" } })).status).toBe(400);
  });
});

describe("watchlist (SIWE)", () => {
  it("add, relabel, import, list, delete; rejects bad signatures", async () => {
    const add = await wlPost(send("POST", { ...(await siwe()), address: W, label: "Treasury" }));
    expect(add.status).toBe(200);
    expect((await add.json()).items).toEqual([{ address: W, label: "Treasury" }]);
    const imp = await wlPut(send("PUT", { ...(await siwe()), items: [{ address: other.address, label: "Fund" }, { address: W, label: "Treasury 2" }] }));
    expect((await imp.json()).items.length).toBe(2);
    const l = await (await wlGet(get(`/api/watchlist?account=${acct.address}`))).json();
    expect(l.items.find((i: { address: string }) => i.address === W).label).toBe("Treasury 2");
    const forged = await siwe();
    expect((await wlPost(send("POST", { ...forged, signature: (await siwe(other)).signature, address: W }))).status).toBe(401);
    const replay = await siwe();
    expect((await wlDel(send("DELETE", { ...replay, address: W }))).status).toBe(200);
    expect((await wlDel(send("DELETE", { ...replay, address: W }))).status).toBe(401); // nonce burned
    expect((await (await wlGet(get(`/api/watchlist?account=${acct.address}`))).json()).items.length).toBe(1);
    expect((await wlPost(send("POST", { message: "x", signature: "0x1", address: "nope" }))).status).toBe(400);
  });
});

describe("wallet links (multi-wallet portfolio)", () => {
  it("requires both signatures and the link statement to name the account", async () => {
    const bad = await wPost(send("POST", { ...(await siwe()), link: await siwe(other, "Link me") }));
    expect(bad.status).toBe(400);
    const ok = await wPost(send("POST", { ...(await siwe()), link: await siwe(other, `Link this wallet to Lockwatch account ${acct.address}`) }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).wallets).toEqual([acct.address.toLowerCase(), other.address.toLowerCase()]);
    const self = await wPost(send("POST", { ...(await siwe()), link: await siwe(acct, `Link to ${acct.address}`) }));
    expect(self.status).toBe(400);
    expect((await (await wGet(get(`/api/wallets?account=${acct.address}`))).json()).wallets.length).toBe(2);
  });
  it("portfolio aggregates linked wallets plus local addresses", async () => {
    const r = await (await portfolio(get(`/api/portfolio?account=${acct.address}&addresses=${W}`))).json();
    expect(r.wallets.map((w: { address: string }) => w.address)).toEqual([acct.address.toLowerCase(), other.address.toLowerCase(), W]);
    expect(r.totals).toMatchObject({ wallets: 3, locks: 3, locked: (6n * BTC).toString(), idle: BTC.toString(), loans: 1, coverage: 100 });
    const mine = r.wallets[0];
    expect(mine.locks.find((l: { id: string }) => l.id === "500")).toMatchObject({ autoRewards: true, protection: { mode: 1 } });
    expect(r.wallets[1].locks[0].autoExtend).toMatchObject({ duration: 0 });
    expect(mine.loan).toMatchObject({ rank: 3 });
    expect((await portfolio(get("/api/portfolio"))).status).toBe(400);
    expect((await portfolio(get("/api/portfolio?addresses=0x1"))).status).toBe(400);
  });
  it("unlink", async () => {
    const r = await wDel(send("DELETE", { ...(await siwe()), address: other.address }));
    expect((await r.json()).wallets).toEqual([acct.address.toLowerCase()]);
  });
});

describe("keeper transparency", () => {
  it("stats, history, filters", async () => {
    const r = await (await keeper(get("/api/keeper"))).json();
    expect(r.keeper).toMatch(/^0x/);
    expect(r.balance).toBeNull();
    expect(r.actions).toBe(2);
    expect(r.successRate).toBe(0.5);
    expect(r.nextRun).toBeGreaterThan(Math.floor(Date.now() / 1000) - 60);
    expect(r.items[0]).toMatchObject({ job: "protect", tx: "0xp" });
    const f = await (await keeper(get("/api/keeper?job=extend"))).json();
    expect(f.items.map((i: { job: string }) => i.job)).toEqual(["extend"]);
    expect((await keeper(get("/api/keeper?job=bogus"))).status).toBe(400);
  });
});

describe("automation state", () => {
  it("returns extend, rewards and rescue for an owner", async () => {
    const r = await (await automation(get(`/api/automation?owner=${acct.address}`))).json();
    expect(r.rewards[0].lockId).toBe("500");
    expect(r.rescue).toMatchObject({ active: true, triggerIcr: (15n * BTC / 10n).toString() });
    const o = await (await automation(get(`/api/automation?owner=${other.address}`))).json();
    expect(o.extend[0]).toMatchObject({ lockId: "502", duration: 0 });
    expect((await automation(get("/api/automation?owner=x"))).status).toBe(400);
  });
});
