// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useState } from "react";
import { AssetSwitch, AssetTag } from "@/components/Asset";
import { assetCfg, withAsset, type Asset } from "@/lib/asset";

afterEach(cleanup);

describe("asset UI", () => {
  it("switch is a radiogroup that reports the chosen asset", () => {
    function H() { const [a, set] = useState<Asset>("btc"); return <><AssetSwitch value={a} onChange={set} counts={{ btc: 2, mezo: 1 }} /><span data-testid="v">{a}</span></>; }
    render(<H />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    fireEvent.click(screen.getByRole("radio", { name: /veMEZO/ }));
    expect(screen.getByTestId("v").textContent).toBe("mezo");
    expect(screen.getByRole("radio", { name: /veMEZO/ }).getAttribute("aria-checked")).toBe("true");
  });
  it("tags use the asset lamp", () => {
    render(<><AssetTag asset="mezo" /><AssetTag asset="btc" /></>);
    expect(screen.getByText("veMEZO").className).toContain("text-mezo");
    expect(screen.getByText("veBTC").className).toContain("text-btc");
  });
  it("asset config points at veMEZO contracts and 4-year horizon", () => {
    const m = assetCfg("mezo");
    expect(m.veAddr).toBe("0xaCE816CA2bcc9b12C59799dcC5A959Fb9b98111b");
    expect(m.vault).toBe("0x24fd63DE4274c71B51cA08adEd519B6cC72f27ae");
    expect(m.musdModes).toBe(false);
    expect(m.extendLabel).toBe("+1 year");
    expect(assetCfg("btc").vault).toBe("0xdd5baB25b65C4697A2e14F47B919B61416A0cAdB");
    expect(withAsset("/lock/1", "mezo")).toBe("/lock/1?asset=mezo");
    expect(withAsset("/x?a=1", "mezo")).toBe("/x?a=1&asset=mezo");
    expect(withAsset("/lock/1", "btc")).toBe("/lock/1");
  });
});
