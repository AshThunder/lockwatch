import { handleTelegram } from "@lockwatch/services/src/alerts";
import { telegram } from "@lockwatch/services/src/notify";
import { db, CHAIN_ID } from "@/server/db";

export const dynamic = "force-dynamic";
/** Telegram webhook (TELEGRAM_MODE=webhook). Verified with the secret token header set via setWebhook. */
export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-telegram-bot-api-secret-token") !== secret) return new Response("forbidden", { status: 403 });
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return new Response("not configured", { status: 503 });
  const u = await req.json();
  if (u?.message?.text) {
    await handleTelegram(await db(), telegram(token), String(u.message.chat.id), u.message.text, { appUrl: process.env.APP_URL ?? new URL(req.url).origin, chainId: CHAIN_ID });
  }
  return new Response("ok");
}
