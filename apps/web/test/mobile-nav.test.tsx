// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { MobileNav } from "@/components/MobileNav";

const links = [
  { href: "/dashboard", label: "My locks", icon: "board", m: "Locks" },
  { href: "/autopilot", label: "Autopilot", icon: "pilot", m: "Autopilot" },
  { href: "/watch", label: "Watchlist", icon: "eye", m: "Watch" },
  { href: "/radar", label: "Redemption Radar", icon: "radar", m: "Radar" },
  { href: "/rescue", label: "Loan rescue", icon: "rescue", m: "Rescue" },
  { href: "/keeper", label: "Keeper", icon: "pulse", m: "Keeper" },
] as const;
const P = ["/dashboard", "/autopilot", "/watch", "/radar"];
const isOn = (p: string | null, h: string) => p === h;
afterEach(cleanup);

describe("MobileNav", () => {
  it("shows 4 tabs + More, sheet lists the rest, closes on Escape and backdrop", () => {
    render(<MobileNav links={links} primary={P} path="/dashboard" isOn={isOn} />);
    const more = screen.getByRole("button", { name: /more/i });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const d = screen.getByRole("dialog");
    expect(within(d).getByText("Loan rescue")).toBeTruthy();
    expect(within(d).getByText("Keeper")).toBeTruthy();
    expect(within(d).queryByText("My locks")).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    fireEvent.click(screen.getByRole("dialog").previousSibling as Element);
    expect(more.getAttribute("aria-expanded")).toBe("false");
  });
  it("marks More active when route is in the sheet and closes on select", () => {
    render(<MobileNav links={links} primary={P} path="/keeper" isOn={isOn} />);
    const more = screen.getByRole("button", { name: /more/i });
    expect(more.textContent).toMatch(/current page/);
    fireEvent.click(more);
    const cur = within(screen.getByRole("dialog")).getByText("Keeper").closest("a")!;
    expect(cur.getAttribute("aria-current")).toBe("page");
    fireEvent.click(cur);
    expect(more.getAttribute("aria-expanded")).toBe("false");
  });
  it("closes on swipe-down", () => {
    render(<MobileNav links={links} primary={P} path="/dashboard" isOn={isOn} />);
    const more = screen.getByRole("button", { name: /more/i });
    fireEvent.click(more);
    const d = screen.getByRole("dialog");
    fireEvent.touchStart(d, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(d, { touches: [{ clientY: 260 }] });
    fireEvent.touchEnd(d);
    expect(more.getAttribute("aria-expanded")).toBe("false");
  });
});
