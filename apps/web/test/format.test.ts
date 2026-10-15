import { describe, expect, it } from "vitest";
import { btc, left, pct, short } from "../src/lib/format";

describe("format", () => {
  it("formats", () => {
    expect(btc(10n ** 18n)).toBe("1");
    expect(btc(2n * 10n ** 13n)).toBe("0.00002");
    expect(left(0)).toBe("expired");
    expect(left(90061)).toBe("1d 1h 1m");
    expect(pct(1_283_000_000_000_000_000n)).toBe("128.3%");
    expect(short("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });
});
