import { describe, expect, it } from "vitest";
import { hashTypedData, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildIcs, googleCalendarUrl, icsDate, icsEscape, icsFold, webcalUrl,
  EXTEND_PRESETS, extendTarget, nextExtendAt, validateExtendPolicy, buildClaim, rewardsDue,
  rescueTypedData, rescueWanted, keeperStats, WEEK, DAY, ADDRESSES,
} from "../src";

const THU = 1792022400; // Thu 2026-10-15 00:00 UTC
const APP = "https://lockwatch.vercel.app";
const lock = { id: "380", amount: "4000000000000000", end: THU + WEEK, voted: true, protectedMode: "Send BTC to my wallet" };

describe("calendar", () => {
  it("formats UTC dates", () => expect(icsDate(THU + WEEK)).toBe("20261022T000000Z"));
  it("escapes and folds per RFC 5545", () => {
    expect(icsEscape("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const f = icsFold("X".repeat(160));
    expect(f.split("\r\n").every((l) => l.length <= 75)).toBe(true);
    expect(f.replace(/\r\n /g, "")).toBe("X".repeat(160));
  });
  it("builds a valid feed with alarms", () => {
    const ics = buildIcs("0x" + "ab".repeat(20), [lock, { ...lock, id: "381", end: THU + 2 * WEEK, voted: false, protectedMode: null }], APP, THU);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)!.length).toBe(2);
    expect(ics).toContain("DTSTART:20261022T000000Z");
    expect(ics).toContain("UID:lockwatch-380-");
    expect(ics).toContain("TRIGGER:-P7D");
    expect(ics).toContain("TRIGGER:-P1D");
    expect(ics.replace(/\r\n /g, "")).toContain("veBTC lock #380 unlocks (0.004 BTC)");
    expect(ics.replace(/\r\n /g, "")).toContain("Not protected");
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
  });
  it("google link", () => {
    const u = new URL(googleCalendarUrl(lock, APP));
    expect(u.host).toBe("calendar.google.com");
    expect(u.searchParams.get("action")).toBe("TEMPLATE");
    expect(u.searchParams.get("dates")).toBe("20261022T000000Z/20261022T003000Z");
    expect(u.searchParams.get("text")).toContain("#380");
  });
  it("webcal", () => expect(webcalUrl("https://x.app/api/calendar/0x1.ics")).toBe("webcal://x.app/api/calendar/0x1.ics"));
});

describe("auto-extend helpers", () => {
  it("target matches veBTC rounding", () => {
    expect(extendTarget(THU + DAY, EXTEND_PRESETS.max)).toBe(THU + 4 * WEEK);
    expect(extendTarget(THU + DAY, EXTEND_PRESETS.fourWeeksAt7d)).toBe(THU + 4 * WEEK);
  });
  it("next extend time", () => {
    const end = THU + 2 * WEEK;
    // keep-at-max: gains once now >= end + W - 30d
    expect(nextExtendAt(end, THU, EXTEND_PRESETS.max)).toBe(Math.max(THU, end + WEEK - 30 * DAY));
    expect(extendTarget(nextExtendAt(end, THU, EXTEND_PRESETS.max)!, EXTEND_PRESETS.max)).toBeGreaterThan(end);
    expect(nextExtendAt(end, THU, EXTEND_PRESETS.fourWeeksAt7d)).toBe(end - 7 * DAY);
    expect(nextExtendAt(end, end, EXTEND_PRESETS.max)).toBeNull();
  });
  it("validates policies", () => {
    expect(validateExtendPolicy({ triggerWithin: 0, duration: 0 })).not.toBeNull();
    expect(validateExtendPolicy({ triggerWithin: DAY, duration: 3 * DAY })).not.toBeNull();
    expect(validateExtendPolicy({ triggerWithin: DAY, duration: 31 * DAY })).not.toBeNull();
    expect(validateExtendPolicy(EXTEND_PRESETS.max)).toBeNull();
  });
});

describe("rewards helpers", () => {
  const g = "0x0000000000000000000000000000000000000001", t = "0x0000000000000000000000000000000000000002", u = "0x0000000000000000000000000000000000000003";
  it("drops empty gauges and tokens", () => {
    expect(buildClaim([{ gauge: g, bribe: [{ token: t, earned: 0n }], fees: [] }])).toBeNull();
    expect(buildClaim([{ gauge: g, bribe: [{ token: t, earned: 5n }, { token: u, earned: 0n }], fees: [{ token: u, earned: 1n }] }]))
      .toEqual({ gauges: [g], bribeTokens: [[t]], feeTokens: [[u]] });
  });
  it("once per epoch after the distribute window", () => {
    expect(rewardsDue(THU + 1800, 0)).toBe(false);
    expect(rewardsDue(THU + 7200, 0)).toBe(true);
    expect(rewardsDue(THU + 7200, THU + 3700)).toBe(false);
    expect(rewardsDue(THU + WEEK + 7200, THU + 3700)).toBe(true);
  });
});

describe("rescue helpers", () => {
  const acct = privateKeyToAccount("0x" + "11".repeat(32) as `0x${string}`);
  const bos = ADDRESSES[31611].borrowerOperationsSignatures!;
  it("typed data recovers to the borrower and matches the MUSD typehash shape", async () => {
    for (const kind of ["AddColl", "RepayMUSD"] as const) {
      const td = rescueTypedData(kind, { chainId: 31611, bos, amount: 10n ** 16n, borrower: acct.address, nonce: 3n, deadline: BigInt(THU) });
      const sig = await acct.signTypedData(td as never);
      expect(await recoverTypedDataAddress({ ...(td as never), signature: sig })).toBe(acct.address);
      expect(hashTypedData(td as never)).toMatch(/^0x[0-9a-f]{64}$/);
    }
    const a = rescueTypedData("AddColl", { chainId: 31611, bos, amount: 1n, borrower: acct.address, nonce: 0n, deadline: 1n });
    expect(Object.keys(a.types)).toEqual(["AddColl"]);
    expect(a.types.AddColl![0].name).toBe("assetAmount");
  });
  it("decides when to rescue", () => {
    const E = 10n ** 18n;
    expect(rescueWanted({ icr: 14n * E / 10n, triggerIcr: 15n * E / 10n })).toBe("below_trigger");
    expect(rescueWanted({ icr: 155n * E / 100n, triggerIcr: 15n * E / 10n, radarRisk: "danger" })).toBe("front_of_line");
    expect(rescueWanted({ icr: 2n * E, triggerIcr: 15n * E / 10n, radarRisk: "danger" })).toBeNull();
    expect(rescueWanted({ icr: 155n * E / 100n, triggerIcr: 15n * E / 10n, radarRisk: "safe" })).toBeNull();
  });
});

describe("keeper stats", () => {
  it("success rate, uptime and next run", () => {
    const now = THU + DAY;
    const hb = Array.from({ length: 144 }, (_, i) => ({ job: "heartbeat", ok: true, ts: now - i * 600 }));
    const s = keeperStats([...hb, { job: "protect", ok: true, ts: now - 10 }, { job: "extend", ok: false, ts: now - 20 }, { job: "extend", ok: true, ts: now - 30 }], now);
    expect(s.actions).toBe(3);
    expect(s.successRate).toBeCloseTo(2 / 3);
    expect(s.uptime24h).toBeCloseTo(0.5, 1);
    expect(s.nextRun).toBe(now + 300);
    expect(s.byJob.extend).toEqual({ total: 2, ok: 1 });
    expect(keeperStats([], now).successRate).toBeNull();
  });
});
