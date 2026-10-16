import { describe, expect, it } from "vitest";
import { ledgerId, assetOfLedger, chainOfLedger, assetContracts, ASSET_META, parseAsset, lockEventText, buildIcs } from "../src";

describe("assets", () => {
  it("keys veMEZO rows on a separate ledger", () => {
    expect(ledgerId(31611, "btc")).toBe(31611);
    expect(ledgerId(31611, "mezo")).toBe(1031611);
    expect(assetOfLedger(1031611)).toBe("mezo");
    expect(assetOfLedger(31611)).toBe("btc");
    expect(chainOfLedger(1031611)).toBe(31611);
  });
  it("resolves veMEZO contracts on testnet", () => {
    const c = assetContracts(31611, "mezo");
    expect(c.ve).toBe("0xaCE816CA2bcc9b12C59799dcC5A959Fb9b98111b");
    expect(c.token.toLowerCase()).toBe("0x7b7c000000000000000000000000000000000001");
    expect(c.vault).toBe("0x24fd63DE4274c71B51cA08adEd519B6cC72f27ae");
    expect(assetContracts(31611, "btc").ve).toBe("0xB63fcCd03521Cf21907627bd7fA465C129479231");
  });
  it("meta: 4y max, no MUSD modes, bribes only", () => {
    expect(ASSET_META.mezo.maxLockSec).toBe(126144000);
    expect(ASSET_META.mezo.musdModes).toBe(false);
    expect(ASSET_META.mezo.feeRewards).toBe(false);
    expect(parseAsset("mezo")).toBe("mezo");
    expect(parseAsset("x")).toBe("btc");
  });
  it("calendar copy names the asset", () => {
    const t = lockEventText({ id: "7", amount: "2500000000000000000000", end: 1800000000, asset: "mezo" }, "https://x");
    expect(t.title).toBe("veMEZO lock #7 unlocks (2500 MEZO)");
    expect(t.url).toBe("https://x/lock/7?asset=mezo");
    const ics = buildIcs("0xabc0000000000000000000000000000000000def", [{ id: "7", amount: "1", end: 1800000000, asset: "mezo" }, { id: "7", amount: "1", end: 1800000000 }], "https://x", 1700000000);
    expect(ics).toContain("UID:lockwatch-m7-1800000000@");
    expect(ics).toContain("UID:lockwatch-7-1800000000@");
  });
});

import { EXTEND_PRESETS_MEZO, MEZO_MAX_LOCK_SECONDS, nextExtendAt, extendTarget, validateExtendPolicy } from "../src";
describe("veMEZO auto-extend presets", () => {
  const THU = 1792022400, W = 7 * 86400;
  it("are valid for a 4-year max and land on Thursdays", () => {
    for (const p of Object.values(EXTEND_PRESETS_MEZO)) expect(validateExtendPolicy(p, MEZO_MAX_LOCK_SECONDS)).toBeNull();
    const t = extendTarget(THU + 3600, EXTEND_PRESETS_MEZO.max, MEZO_MAX_LOCK_SECONDS);
    expect(t % W).toBe(0);
    expect(t).toBeGreaterThan(THU + MEZO_MAX_LOCK_SECONDS - W);
  });
  it("year-at-30d opens inside 30 days of the end", () => {
    const end = THU + 200 * 86400;
    const at = nextExtendAt(end, THU, EXTEND_PRESETS_MEZO.yearAt30d, MEZO_MAX_LOCK_SECONDS)!;
    expect(at).toBe(end - 30 * 86400);
  });
});
