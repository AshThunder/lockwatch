// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const w = vi.hoisted(() => ({ address: undefined as string | undefined, approved: [] as string[], writes: [] as unknown[], signs: [] as string[] }));
vi.mock("wagmi", () => ({
  useAccount: () => ({ address: w.address, isConnected: !!w.address }),
  useReadContract: () => ({ data: undefined, refetch: () => {} }),
  useReadContracts: () => ({ data: w.approved.map((a) => ({ result: a })), refetch: () => {} }),
  useWriteContract: () => ({ writeContractAsync: async (a: unknown) => { w.writes.push(a); return "0xabc"; }, data: undefined, reset: () => {} }),
  useWaitForTransactionReceipt: () => ({}),
  useSignMessage: () => ({ signMessageAsync: async ({ message }: { message: string }) => { w.signs.push(message); return "0x" + "11".repeat(65); } }),
  useSignTypedData: () => ({ signTypedDataAsync: async () => "0x" + "22".repeat(65) }),
  usePublicClient: () => ({ waitForTransactionReceipt: async () => ({ status: "success" }), readContract: async () => 0n }),
}));
vi.hoisted(() => { if (typeof window !== "undefined") { HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; }; } if (typeof window !== "undefined") window.matchMedia = ((q: string) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, onchange: null, dispatchEvent: () => false })) as never; });
vi.mock("next/navigation", () => ({ usePathname: () => "/autopilot", useRouter: () => ({ push: () => {} }), useSearchParams: () => new URLSearchParams() }));

import { ToastProvider } from "@/components/feedback";
import Autopilot from "../app/autopilot/page";
import Watch from "../app/watch/page";
import Keeper from "../app/keeper/page";
import Portfolio from "../app/portfolio/page";
import Rescue from "../app/rescue/page";
import { CalendarExport, GoogleCalLink } from "@/components/Calendar";
import { APP_LINKS } from "@/components/Nav";
import { upsert, merge, drop, loadLocal, saveLocal } from "@/lib/watch";
import { rescueSteps } from "@/lib/rescue";
import { VAULT, LEGACY_VAULTS } from "@/lib/env";

const A = "0x1111111111111111111111111111111111111111", B = "0x2222222222222222222222222222222222222222";
const now = Math.floor(Date.now() / 1000);
let routes: Record<string, unknown> = {};
const calls: { url: string; init?: RequestInit }[] = [];
function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ToastProvider>{ui}</ToastProvider></QueryClientProvider>);
}
beforeEach(() => {
  w.address = undefined; w.approved = []; w.writes = []; w.signs = []; routes = {}; calls.length = 0; localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const k = Object.keys(routes).find((p) => url.startsWith(p));
    const body = k ? (typeof routes[k] === "function" ? (routes[k] as (u: string, i?: RequestInit) => unknown)(url, init) : routes[k]) : { error: "no route " + url };
    return new Response(JSON.stringify(body), { status: k ? 200 : 404, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const lock = (id: string, extra: object = {}) => ({ id, amount: "500000000000000000", end: now + 10 * 86400, permanent: false, voted: false, approvedVault: false, status: "active", protection: null, autoExtend: null, autoRewards: false, ...extra });
const pf = (wallets: { address: string; locks: object[]; loan?: object | null }[]) => ({ linked: [], wallets: wallets.map((x) => ({ loan: null, ...x })),
  totals: { wallets: wallets.length, locks: 1, locked: "500000000000000000", idle: "0", coverage: 0, nextUnlock: now + 86400, loanColl: "0", loanDebt: "0", loans: 0 } });

describe("nav", () => {
  it("lists every v3 page and has exactly five mobile tabs' worth of short labels", () => {
    const hrefs = APP_LINKS.map((l) => l.href);
    for (const h of ["/portfolio", "/autopilot", "/watch", "/rescue", "/keeper"]) expect(hrefs).toContain(h);
    expect(APP_LINKS.every((l) => l.m.length <= 9)).toBe(true);
  });
});

describe("watch lib", () => {
  it("upserts case-insensitively, keeps labels, rejects junk", () => {
    let xs = upsert([], { address: A.toUpperCase().replace("0X", "0x"), label: "Cold" });
    xs = upsert(xs, { address: A, label: "" });
    expect(xs).toEqual([{ address: A, label: "Cold" }]);
    expect(() => upsert(xs, { address: "0x12" })).toThrow(/0x address/);
    expect(merge(xs, [{ address: A, label: "Vault" }, { address: B }]).map((x) => x.label)).toEqual(["Vault", null]);
    expect(drop(xs, A.toUpperCase().replace("0X", "0x"))).toEqual([]);
  });
  it("survives corrupt storage", () => {
    localStorage.setItem("lockwatch.watch.v1", "{nope"); expect(loadLocal()).toEqual([]);
    saveLocal([{ address: A, label: "x" }, { address: "bad" } as never]); expect(loadLocal()).toEqual([{ address: A, label: "x" }]);
  });
});

describe("rescue steps", () => {
  it("skips deposits already covered by the reserve", () => {
    expect(rescueSteps({ add: 10n ** 16n, repay: 0n, btcEscrow: 0n, musdEscrow: 0n }).map((s) => s.k)).toEqual(["depositBtc", "sign", "setRule"]);
    expect(rescueSteps({ add: 10n ** 16n, repay: 5n, btcEscrow: 10n ** 16n, musdEscrow: 0n }).map((s) => s.k)).toEqual(["approveMusd", "depositMusd", "sign", "setRule"]);
  });
});

describe("calendar export", () => {
  it("offers webcal subscribe, Google subscribe and a download of the wallet feed", () => {
    wrap(<CalendarExport address={A} />);
    fireEvent.click(screen.getByRole("button", { name: /add to calendar/i }));
    const d = screen.getByRole("dialog");
    expect(within(d).getByText(/Apple Calendar/).closest("a")!.getAttribute("href")).toMatch(new RegExp(`^webcal://.*/api/calendar/${A}\\.ics$`));
    expect(within(d).getByText(/Google Calendar/).closest("a")!.getAttribute("href")).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/r\?cid=webcal/);
    expect(within(d).getByText(/Download/).closest("a")!.hasAttribute("download")).toBe(true);
  });
  it("builds a one-off Google event for a lock", () => {
    wrap(<GoogleCalLink id="380" amount="1000000000000000000" end={1798675200} />);
    const href = screen.getByRole("link").getAttribute("href")!;
    expect(href).toContain("calendar.google.com"); expect(decodeURIComponent(href)).toContain("#380");
  });
});

describe("autopilot page", () => {
  it("asks for a wallet when disconnected", () => {
    wrap(<Autopilot />);
    expect(screen.getByText("Connect a wallet")).toBeTruthy();
  });
  it("needs approval first, then saves a preset and toggles rewards on the v2 vault", async () => {
    w.address = A;
    routes["/api/portfolio"] = pf([{ address: A, locks: [lock("7")] }]);
    w.approved = ["0x0000000000000000000000000000000000000000"];
    const v = wrap(<Autopilot />);
    await screen.findByText(/Approve Lockwatch on this lock once/);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(w.writes).toHaveLength(1));
    expect(w.writes[0]).toMatchObject({ functionName: "approve", args: [VAULT, 7n] });
    v.unmount(); w.writes = []; w.approved = [VAULT!.toLowerCase()];
    const v2 = wrap(<Autopilot />);
    await screen.findByText("Keep at max");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Keep at max/));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(w.writes).toHaveLength(1));
    expect(w.writes[0]).toMatchObject({ address: VAULT, functionName: "setExtendPolicy", args: [7n, 30 * 86400 - 1, 0] });
    // one transaction at a time: everything else is disabled while it is pending
    expect((screen.getByRole("switch", { name: /reward auto-claim/i }) as HTMLButtonElement).disabled).toBe(true);
    v2.unmount(); wrap(<Autopilot />);
    fireEvent.click(await screen.findByRole("switch", { name: /reward auto-claim/i }));
    await waitFor(() => expect(w.writes).toHaveLength(2));
    expect(w.writes[1]).toMatchObject({ functionName: "setRewardsAuto", args: [7n, true] });
  });
  it("points legacy-vault locks at re-saving their plan", async () => {
    w.address = A; routes["/api/portfolio"] = pf([{ address: A, locks: [lock("380", { protection: { active: true, mode: 1 } })] }]);
    w.approved = [LEGACY_VAULTS[0].toLowerCase()];
    wrap(<Autopilot />);
    expect((await screen.findByRole("link", { name: "Re-save plan" })).getAttribute("href")).toBe("/protect/380");
  });
  it("clears the policy when switched off", async () => {
    w.address = A; w.approved = [VAULT!.toLowerCase()];
    routes["/api/portfolio"] = pf([{ address: A, locks: [lock("9", { autoExtend: { triggerWithin: 604800, duration: 2419200, lastTx: null } })] }]);
    wrap(<Autopilot />);
    await screen.findByText("4 weeks at 7 days");
    fireEvent.click(screen.getByLabelText(/^Off/));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(w.writes[0]).toMatchObject({ functionName: "clearExtendPolicy", args: [9n] }));
  });
});

describe("watch page", () => {
  it("adds, persists and removes a watched wallet without a connected wallet", async () => {
    routes["/api/portfolio"] = pf([{ address: A, locks: [lock("5", { protection: { active: true, mode: 0 } })] }]);
    wrap(<Watch />);
    await screen.findByText("Nothing watched yet");
    fireEvent.change(screen.getByLabelText("Wallet address"), { target: { value: "0x12" } });
    fireEvent.click(screen.getByRole("button", { name: /watch/i }));
    expect(screen.getByRole("alert").textContent).toMatch(/0x address/);
    fireEvent.change(screen.getByLabelText("Wallet address"), { target: { value: A } });
    fireEvent.change(screen.getByLabelText(/Label/), { target: { value: "Cold" } });
    fireEvent.click(screen.getByRole("button", { name: /watch/i }));
    expect(await screen.findByText("Cold")).toBeTruthy();
    await screen.findByText("1/1");
    expect(JSON.parse(localStorage.getItem("lockwatch.watch.v1")!)).toEqual([{ address: A, label: "Cold" }]);
    fireEvent.click(screen.getByRole("button", { name: /stop watching cold/i }));
    await screen.findByText("Nothing watched yet");
  });
  it("merges the account list and saves unsaved wallets with one SIWE signature", async () => {
    w.address = A; saveLocal([{ address: B, label: "Friend" }]);
    let put: unknown = null;
    routes["/api/auth/nonce"] = { nonce: "abcdefgh12345678" };
    routes["/api/watchlist"] = (_u: string, i?: RequestInit) => { if (i?.method === "PUT") put = JSON.parse(String(i.body)); return { items: put ? [{ address: B, label: "Friend" }] : [{ address: A, label: "Me" }] }; };
    routes["/api/portfolio"] = pf([]);
    wrap(<Watch />);
    await screen.findByText("Me");
    fireEvent.click(await screen.findByRole("button", { name: /save 1 to my account/i }));
    await waitFor(() => expect(put).toBeTruthy());
    expect((put as { items: unknown[] }).items).toEqual([{ address: B, label: "Friend" }]);
    expect(w.signs[0]).toMatch(/Save 1 watched wallet to my Lockwatch account/);
  });
});

describe("portfolio page", () => {
  it("shows totals, and links a second wallet with two signatures", async () => {
    w.address = A;
    routes["/api/auth/nonce"] = { nonce: "abcdefgh12345678" };
    let linked: { link: { message: string } } | null = null;
    routes["/api/wallets"] = (_u: string, i?: RequestInit) => { linked = JSON.parse(String(i!.body)); return { ok: true, wallets: [B] }; };
    routes["/api/portfolio"] = pf([{ address: A, locks: [lock("1")] }]);
    const v = wrap(<Portfolio />);
    await screen.findByText("Locked");
    expect(screen.getByText("Main")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /link a wallet/i }));
    await screen.findByText(/switch to the wallet you want to link/);
    expect((screen.getByRole("button", { name: /sign and link/i }) as HTMLButtonElement).disabled).toBe(true);
    w.address = B; v.rerender(<QueryClientProvider client={new QueryClient()}><ToastProvider><Portfolio /></ToastProvider></QueryClientProvider>);
    const btn = await screen.findByRole("button", { name: /sign and link/i });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await waitFor(() => expect(linked).toBeTruthy());
    expect(w.signs).toHaveLength(2);
    expect(linked!.link.message).toContain(`Link this wallet to Lockwatch account ${A}`);
    expect(linked!.link.message).toContain(B);
  });
});

describe("keeper page", () => {
  it("shows status, success rate, gas and a filterable tx history", async () => {
    routes["/api/keeper"] = (u: string) => ({ keeper: "0xa5052E50884FB844B624284F481e59B40f8F5F8B", balance: "0.0098", actions: 4, succeeded: 3, successRate: 0.75, uptime24h: 0.99, lastHeartbeat: now - 60, nextRun: now + 240,
      byJob: { protect: { total: 1, ok: 1 }, extend: { total: 2, ok: 1 }, rewards: { total: 1, ok: 1 }, rescue: { total: 0, ok: 0 } }, page: 1, pages: 1, total: 1,
      items: u.includes("job=rescue") ? [] : [{ job: "extend", subject: "380", ok: true, tx: "0x" + "ab".repeat(32), detail: null, ts: now - 100 }] });
    wrap(<Keeper />);
    expect(await screen.findByText("Running")).toBeTruthy();
    expect(screen.getByText("75.0%")).toBeTruthy();
    expect(screen.getByText("99%")).toBeTruthy();
    expect(screen.getByText("0.0098 BTC")).toBeTruthy();
    expect(screen.getByText("veBTC #380")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Rescue" }));
    await screen.findByText("Nothing here yet");
    expect(calls.some((c) => c.url.includes("job=rescue"))).toBe(true);
  });
  it("flags a late keeper and low gas", async () => {
    routes["/api/keeper"] = { keeper: "0xa5052E50884FB844B624284F481e59B40f8F5F8B", balance: "0.0001", actions: 0, succeeded: 0, successRate: null, uptime24h: 0.2, lastHeartbeat: now - 3600, nextRun: now - 3300, byJob: {}, page: 1, pages: 1, total: 0, items: [] };
    wrap(<Keeper />);
    expect(await screen.findByText("Running late")).toBeTruthy();
    expect(screen.getByText(/Low\. Top-up pending/)).toBeTruthy();
  });
});

describe("rescue page", () => {
  it("explains when there is no loan", async () => {
    w.address = A; routes["/api/radar"] = { trove: null }; routes["/api/automation"] = { extend: [], rewards: [], rescue: null };
    wrap(<Rescue />);
    expect(await screen.findByText("No MUSD loan on this wallet")).toBeTruthy();
  });
  it("validates the line, then deposits, signs and saves the rule", async () => {
    w.address = A;
    routes["/api/radar"] = { trove: { coll: "100000000000000000", debt: "5000000000000000000000", icr: "1800000000000000000", rank: 3, risk: "safe" } };
    routes["/api/automation"] = { extend: [], rewards: [], rescue: null };
    wrap(<Rescue />);
    const trig = await screen.findByLabelText(/Rescue when the ratio drops under/);
    fireEvent.change(trig, { target: { value: "105" } });
    expect(screen.getByRole("alert").textContent).toMatch(/between 110% and 1000%/);
    fireEvent.change(trig, { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn on rescue" }));
    await waitFor(() => expect(w.writes).toHaveLength(2));
    expect(w.writes[0]).toMatchObject({ functionName: "depositBtc", value: 10n ** 16n });
    const r = (w.writes[1] as { functionName: string; args: [{ triggerIcr: bigint; addAmount: bigint; repayAmount: bigint; addSig: string; repaySig: string }] });
    expect(r.functionName).toBe("setRule");
    expect(r.args[0]).toMatchObject({ triggerIcr: 15n * 10n ** 17n, addAmount: 10n ** 16n, repayAmount: 0n, repaySig: "0x" });
    expect(r.args[0].addSig).toMatch(/^0x22/);
  });
});
