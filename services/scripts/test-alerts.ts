/** One-off live alert test: sends the REAL templates for one lock to the owner's linked Telegram chat,
 *  and the same set by email to TEST_EMAIL_TO only. Dry-run unless --send. Does not touch alert_log. */
import * as repo from "@lockwatch/db";
import { fmt18 } from "@lockwatch/sdk";
import { message, type Kind } from "../src/alerts";
import { telegram, resend } from "../src/notify";
import { loadConfig } from "../src/config";

const SEND = process.argv.includes("--send") || process.env.ALERT_TEST_SEND === "1";
const OWNER = (process.env.TEST_OWNER ?? "0x66E634A38c3dF412f7D3fd8Eb59Fd13Ef35F3fCd").toLowerCase();
const LOCK = process.env.TEST_LOCK ?? "380";
const EMAIL_TO = process.env.TEST_EMAIL_TO;
const cfg = loadConfig();
const db = await repo.connect(process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL);

const lock = (await repo.locksByOwner(db, cfg.chainId, OWNER)).find((l) => String(l.id) === LOCK);
if (!lock) throw new Error(`lock #${LOCK} not found for ${OWNER}`);
const prot = (await repo.protectionsByOwner(db, cfg.chainId, OWNER)).find((p) => String(p.lock_id) === LOCK);
const base = { lockId: LOCK, amount: fmt18(BigInt(lock.amount)), end: String(lock.lock_end), protected: prot?.active ? "1" : "0" };
const tx = process.env.TEST_TX ?? "0x7ad468bff2acdd5a5ed71fc8f7a902ded58eea07328eeaa3910c9124a33d5413";
const set: [Kind, Record<string, string>][] = [
  ["lock_t7d", base], ["lock_t1d", base], ["lock_expired", base],
  ["protected", { ...base, mode: "returned to your wallet", tx }],
];
const tag = (t: string) => `[TEST] ${t}`;

async function run() {
const tg = (await repo.subsByAddress(db, OWNER)).find((s) => s.channel === "telegram" && s.verified && s.target);
console.log(`telegram: ${tg ? "linked" : "NOT LINKED (tap the deep link first)"} | email: ${EMAIL_TO ?? "none"} | mode: ${SEND ? "SEND" : "dry-run"}`);
if (SEND && !tg) { console.log("Telegram not linked yet — tap the deep link first. Nothing sent."); return; }
if (SEND && !process.argv.includes("--force") && !(await repo.claimAlert(db, tg!.id, `test-send:${LOCK}:${process.env.ALERT_TEST_RUN ?? "1"}`, "test"))) { console.log("test-send already done for this ALERT_TEST_RUN; skipping"); return; }
for (const [k, d] of set) {
  const text = tag(message(k, d, cfg));
  if (!SEND) { console.log(`--- ${k}\n${text}`); continue; }
  if (tg) { await telegram(cfg.telegramToken!).send(tg.target!, text); console.log(`telegram ✓ ${k}`); }
  if (EMAIL_TO) { await resend(cfg.resendKey!, "Lockwatch <onboarding@resend.dev>").send(EMAIL_TO, text); console.log(`email ✓ ${k}`); }
}
}
await run();
if (import.meta.url === `file://${process.argv[1]}`) process.exit(0);
