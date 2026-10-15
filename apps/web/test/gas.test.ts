import { describe, it, expect } from "vitest";
import { withGasBuffer } from "../src/components/feedback";
const A = "0x0000000000000000000000000000000000000001" as const;
describe("withGasBuffer", () => {
  it("adds 50% + 100k to the estimate", async () => {
    const r = await withGasBuffer({ estimateContractGas: async () => 300_000n }, A, { functionName: "x" });
    expect((r as unknown as { gas: bigint }).gas).toBe(550_000n);
  });
  it("falls back to wallet estimation on error or missing client", async () => {
    expect("gas" in (await withGasBuffer({ estimateContractGas: async () => { throw new Error("no"); } }, A, {}))).toBe(false);
    expect("gas" in (await withGasBuffer(undefined, A, {}))).toBe(false);
  });
  it("keeps an explicit gas", async () => {
    const r = await withGasBuffer({ estimateContractGas: async () => 1n }, A, { gas: 9n });
    expect(r.gas).toBe(9n);
  });
});
