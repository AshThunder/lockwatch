/** LIVE API pass against lockwatch.vercel.app with real SIWE signatures (keys never printed). */
import { readFileSync, writeFileSync } from "node:fs";
import { createSiweMessage } from "viem/siwe";
import { privateKeyToAccount } from "viem/accounts";
const BASE = "https://lockwatch.vercel.app", S = "/workspace/lockwatch/secrets/";
const acct = (n: string) => privateKeyToAccount(readFileSync(S + n, "utf8").trim() as `0x${string}`);
const A = acct("e2e_key"), B = acct("e2e2_key");
const res: Record<string, unknown> = {};
async function siwe(who: typeof A, statement: string) {
  const { nonce } = await (await fetch(BASE + "/api/auth/nonce")).json();
  const message = createSiweMessage({ address: who.address, chainId: 31611, domain: "lockwatch.vercel.app", nonce, uri: BASE, version: "1", statement });
  return { message, signature: await who.signMessage({ message }) };
}
const call = async (path: string, method = "GET", body?: unknown) => { const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); return { status: r.status, body: t.slice(0, 600) }; };
async function main() {
  const ics = await fetch(`${BASE}/api/calendar/${B.address}`); const t = await ics.text();
  res.calendar = { status: ics.status, type: ics.headers.get("content-type"), events: (t.match(/BEGIN:VEVENT/g) ?? []).length, mentions381: t.includes("381"), head: t.slice(0, 300) };
  res.watchAdd = await call("/api/watchlist", "POST", { ...(await siwe(A, "Lockwatch: add wallet to watchlist")), address: B.address, label: "live-test B" });
  res.watchGet = await call(`/api/watchlist?account=${A.address}`);
  const link = await siwe(B, `Link this wallet to Lockwatch account ${A.address}`);
  res.link = await call("/api/wallets", "POST", { ...(await siwe(A, "Lockwatch: link a wallet")), link });
  res.replay = await call("/api/wallets", "POST", { ...(await siwe(A, "Lockwatch: link a wallet")), link });
  res.wallets = await call(`/api/wallets?account=${A.address}`);
  res.portfolio = await call(`/api/portfolio?account=${A.address}`);
  res.automationB = await call(`/api/automation?owner=${B.address}`);
  res.automationA = await call(`/api/automation?owner=${A.address}`);
  res.keeper = await call(`/api/keeper`);
  writeFileSync("/workspace/lockwatch/live/api.json", JSON.stringify(res, null, 1)); console.log(JSON.stringify(res, null, 1));
}
main();
