import { dueExpiryAlerts, radarRisk, fmt18, pct18, explorerUrl, type ChainId, type LineEntry, NOT_PROTECTABLE_REASONS } from "@lockwatch/sdk";
import * as repo from "@lockwatch/db";
import type { Db, SubRow } from "@lockwatch/db";
import type { Address } from "viem";
import { loadConfig, log, type Config } from "./config";
import { telegram, resend, consoleChannel, type Channel } from "./notify";
import { sleep } from "./indexer";

export type Kind = "lock_t7d" | "lock_t1d" | "lock_expired" | "protected" | "protect_failed" | "fallback" | "radar_watch" | "radar_danger" | "icr_low";
export const ALL_KINDS: Kind[] = ["lock_t7d", "lock_t1d", "lock_expired", "protected", "protect_failed", "fallback", "radar_watch", "radar_danger", "icr_low"];
export const TYPICAL_REDEMPTION = BigInt(process.env.TYPICAL_REDEMPTION_MUSD ?? "10000") * 10n ** 18n;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const when = (ts: number) => new Date(ts * 1000).toUTCString().replace(":00 GMT", " UTC");

export function message(kind: Kind, d: Record<string, string>, cfg: Pick<Config, "appUrl" | "chainId">): string {
  const lock = `<a href="${cfg.appUrl}/dashboard">lock #${d.lockId}</a>`;
  switch (kind) {
    case "lock_t7d": return `⏳ Your veBTC ${lock} (${d.amount} BTC) unlocks in under 7 days — ${when(+d.end)}.${d.protected === "1" ? "\n✅ Auto-protect is on." : `\nSet up auto-protect so it doesn't sit unclaimed: ${cfg.appUrl}/protect/${d.lockId}`}`;
    case "lock_t1d": return `⚠️ ${lock} (${d.amount} BTC) unlocks in under 24h — ${when(+d.end)}.${d.protected === "1" ? "\n✅ Auto-protect is on." : `\nProtect it now: ${cfg.appUrl}/protect/${d.lockId}`}`;
    case "lock_expired": return `🔓 ${lock} has expired and ${d.amount} BTC is sitting unclaimed.${d.protected === "1" ? "\nThe keeper will claim it for you shortly." : `\nClaim it now or turn on auto-protect: ${cfg.appUrl}/dashboard`}`;
    case "protected": return `✅ Protected ${lock}: ${d.amount} BTC → ${d.mode}.\n${explorerUrl(cfg.chainId as ChainId, "tx", d.tx)}`;
    case "fallback": return `↩️ ${lock}: ${d.mode} couldn't complete (${d.reason}), so your BTC was returned to your wallet instead.`;
    case "protect_failed": return `❌ Auto-protect couldn't run for lock #${d.lockId}: ${d.reason}.\nTap to fix or claim: ${cfg.appUrl}/protect/${d.lockId}`;
    case "radar_watch": return `👀 Redemption Radar: your MUSD loan ${short(d.owner)} is #${d.rank} in the redemption line with ${d.ahead} MUSD ahead.\n${cfg.appUrl}/radar`;
    case "radar_danger": return `🚨 Redemption Radar: only ${d.ahead} MUSD of loans sit ahead of yours (#${d.rank}, ICR ${d.icr}). A redemption could swap your BTC for MUSD.\nAdd collateral or repay to move back: ${cfg.appUrl}/radar`;
    case "icr_low": return `🩸 Your loan's collateral ratio is ${d.icr}. Below 110% it can be liquidated.\n${cfg.appUrl}/radar`;
  }
}

const MODE_NAMES = ["returned to your wallet", "re-locked", "MUSD loan", "MUSD → savings (sMUSD)"];

/** Computes alerts for one subscriber. Returns [key, kind, data] tuples; the caller dedupes via alert_log. */
export async function alertsFor(db: Db, sub: SubRow, chainId: number, now: number): Promise<[string, Kind, Record<string, string>][]> {
  const out: [string, Kind, Record<string, string>][] = [];
  const locks = await repo.locksByOwner(db, chainId, sub.address);
  const prots = await repo.protectionsByOwner(db, chainId, sub.address);
  const protectedIds = new Set(prots.filter((p) => p.active).map((p) => p.lock_id));
  for (const l of locks) {
    for (const k of dueExpiryAlerts({ end: Number(l.lock_end), permanent: l.permanent }, now)) {
      out.push([`${k}:${chainId}:${l.id}:${l.lock_end}`, k, { lockId: l.id, amount: fmt18(BigInt(l.amount)), end: String(l.lock_end), protected: protectedIds.has(l.id) ? "1" : "0" }]);
    }
  }
  for (const p of prots) {
    if (!p.active && p.tx_hash) out.push([`protected:${chainId}:${p.lock_id}`, "protected", { lockId: p.lock_id, amount: fmt18(BigInt(p.amount ?? 0)), mode: MODE_NAMES[p.mode], tx: p.tx_hash }]);
    if (p.fallback_reason) out.push([`fallback:${chainId}:${p.lock_id}`, "fallback", { lockId: p.lock_id, mode: MODE_NAMES[p.mode], reason: p.fallback_reason.startsWith("0x") ? "the call reverted" : p.fallback_reason }]);
  }
  const t = await repo.troveOf(db, chainId, sub.address);
  if (t) {
    const e: LineEntry = { owner: t.owner as Address, coll: BigInt(t.coll), debt: BigInt(t.debt), icr: BigInt(t.icr), rank: t.rank, musdAhead: BigInt(t.musd_ahead), redeemable: t.redeemable };
    const day = Math.floor(now / 86400);
    const risk = radarRisk(e, TYPICAL_REDEMPTION);
    const d = { owner: t.owner, rank: String(t.rank), ahead: fmt18(e.musdAhead, 0), icr: pct18(e.icr) };
    if (risk === "danger") out.push([`radar_danger:${chainId}:${t.owner}:${day}`, "radar_danger", d]);
    else if (risk === "watch") out.push([`radar_watch:${chainId}:${t.owner}:${Math.floor(day / 7)}`, "radar_watch", d]);
    else if (risk === "liquidatable") out.push([`icr_low:${chainId}:${t.owner}:${day}`, "icr_low", d]);
  }
  return out.filter(([, k]) => sub.prefs?.[k] !== false);
}

export async function alertsTick(db: Db, channels: Record<"telegram" | "email", Channel>, cfg: Pick<Config, "appUrl" | "chainId">, now: number) {
  let sent = 0;
  for (const sub of await repo.verifiedSubs(db)) {
    if (!sub.target || sub.prefs?.muted) continue;
    for (const [key, kind, data] of await alertsFor(db, sub, cfg.chainId, now)) {
      if (!(await repo.claimAlert(db, sub.id, key, kind))) continue;
      try {
        await channels[sub.channel].send(sub.target, message(kind, data, cfg));
        sent++;
      } catch (e) {
        await repo.releaseAlert(db, sub.id, key); // retry next tick
        log("alerts", "send failed", { sub: sub.id, kind, err: String(e).slice(0, 200) });
      }
    }
  }
  return sent;
}

/** Direct notice used by the keeper (failures, low balance). */
export function keeperNotifier(db: Db, channels: Record<"telegram" | "email", Channel>, cfg: Config) {
  return async (owner: string, kind: "protect_failed" | "keeper_low_balance", data: Record<string, string>) => {
    if (kind === "keeper_low_balance") {
      if (cfg.adminChatId) await channels.telegram.send(cfg.adminChatId, `🔋 Keeper balance low: ${data.balance} BTC`);
      return;
    }
    for (const s of await repo.subsByAddress(db, owner)) {
      if (!s.verified || !s.target) continue;
      if (await repo.claimAlert(db, s.id, `protect_failed:${cfg.chainId}:${data.lockId}:${data.reason}`, kind)) await channels[s.channel].send(s.target, message("protect_failed", data, cfg));
    }
  };
}

// ---------------------------------------------------------------- Telegram bot commands
export async function handleTelegram(db: Db, tg: Channel, chatId: string, text: string, cfg: Pick<Config, "appUrl" | "chainId">) {
  const [cmd, arg] = text.trim().split(/\s+/, 2);
  const sub = await repo.subByTarget(db, "telegram", chatId);
  switch (cmd.split("@")[0]) {
    case "/start": {
      if (!arg) return tg.send(chatId, `👋 Lockwatch watches your veBTC locks and MUSD loans on Mezo.\nConnect from ${cfg.appUrl}/alerts to link this chat.`);
      const v = await repo.verifySub(db, arg, chatId);
      return tg.send(chatId, v ? `✅ Linked to ${short(v.address)}. You'll get lock expiry, auto-protect and Redemption Radar alerts here.\nCommands: /locks /radar /mute` : "That link has expired. Generate a new one in the app.");
    }
    case "/locks": {
      if (!sub) return tg.send(chatId, `Link your wallet first: ${cfg.appUrl}/alerts`);
      const locks = await repo.locksByOwner(db, cfg.chainId, sub.address);
      if (!locks.length) return tg.send(chatId, "No veBTC locks found for your wallet.");
      const now = Date.now() / 1000;
      return tg.send(chatId, locks.map((l) => {
        const left = Number(l.lock_end) - now;
        return `#${l.id} · ${fmt18(BigInt(l.amount))} BTC · ${left <= 0 ? "🔓 expired" : `${Math.ceil(left / 86400)}d left`}${l.voted ? " · voted" : ""}`;
      }).join("\n"));
    }
    case "/radar": {
      if (!sub) return tg.send(chatId, `Link your wallet first: ${cfg.appUrl}/alerts`);
      const t = await repo.troveOf(db, cfg.chainId, sub.address);
      if (!t) return tg.send(chatId, "No open MUSD loan for your wallet.");
      return tg.send(chatId, `Your loan: #${t.rank} in the redemption line · ${fmt18(BigInt(t.musd_ahead), 0)} MUSD ahead · ICR ${pct18(BigInt(t.icr))}`);
    }
    case "/mute": {
      if (!sub) return tg.send(chatId, "Nothing to mute.");
      const muted = !sub.prefs?.muted;
      await repo.updateSubPrefs(db, sub.id, { ...sub.prefs, muted });
      return tg.send(chatId, muted ? "🔕 Muted. Send /mute again to resume." : "🔔 Alerts resumed.");
    }
    default:
      return tg.send(chatId, "Commands: /locks /radar /mute");
  }
}

export function channelsFrom(cfg: Config): Record<"telegram" | "email", Channel> {
  return {
    telegram: cfg.telegramToken ? telegram(cfg.telegramToken) : consoleChannel("telegram"),
    email: cfg.resendKey ? resend(cfg.resendKey, cfg.emailFrom) : consoleChannel("email"),
  };
}

/** Long-polls Telegram when no webhook is configured (Railway worker). */
export async function runTelegramPolling(db: Db, cfg: Config, signal?: AbortSignal) {
  if (!cfg.telegramToken) return;
  const tg = telegram(cfg.telegramToken);
  let offset = 0;
  while (!signal?.aborted) {
    try {
      for (const u of await tg.getUpdates(offset)) {
        offset = u.update_id + 1;
        if (u.message?.text) await handleTelegram(db, tg, String(u.message.chat.id), u.message.text, cfg);
      }
    } catch (e) { log("telegram", "poll error", { err: String(e).slice(0, 200) }); await sleep(5000, signal); }
  }
}

export async function runAlerts(db: Db, cfg = loadConfig(), signal?: AbortSignal) {
  const ch = channelsFrom(cfg);
  while (!signal?.aborted) {
    try { await alertsTick(db, ch, cfg, Math.floor(Date.now() / 1000)); } catch (e) { log("alerts", "error", { err: String(e).slice(0, 300) }); }
    await sleep(60_000, signal);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  repo.connect().then((db) => runAlerts(db));
}
