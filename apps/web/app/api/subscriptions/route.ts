import { z } from "zod";
import { randomBytes } from "node:crypto";
import * as repo from "@lockwatch/db";
import { resend, consoleChannel } from "@lockwatch/services/src/notify";
import { db, json, bad, limited } from "@/server/db";
import { verifySiwe } from "@/server/siwe";

export const dynamic = "force-dynamic";
const Body = z.object({
  message: z.string().max(2000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  channel: z.enum(["telegram", "email"]),
  email: z.string().email().optional(),
  prefs: z.record(z.boolean()).default({}),
});

/** Create/refresh a subscription. Telegram → returns a t.me deep link with a one-time code. Email → magic link. */
export async function POST(req: Request) {
  if (limited(req, 10)) return bad("rate limited", 429);
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return bad("invalid body");
  const address = await verifySiwe(b.data.message, b.data.signature as `0x${string}`);
  if (!address) return bad("signature check failed", 401);
  const code = randomBytes(12).toString("hex");
  const d = await db();
  if (b.data.channel === "telegram") {
    await repo.createPendingSub(d, address, "telegram", code, undefined, b.data.prefs);
    const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? "LockwatchBot";
    return json({ link: `https://t.me/${bot}?start=${code}` }, { headers: { "cache-control": "no-store" } });
  }
  if (!b.data.email) return bad("email required");
  await repo.createPendingSub(d, address, "email", code, b.data.email, b.data.prefs);
  const app = process.env.APP_URL ?? new URL(req.url).origin;
  const mail = process.env.RESEND_API_KEY ? resend(process.env.RESEND_API_KEY, process.env.EMAIL_FROM ?? "Lockwatch <alerts@lockwatch.app>") : consoleChannel("email");
  await mail.send(b.data.email, `Confirm Lockwatch alerts\nClick to confirm alerts for ${address}: ${app}/api/email/verify?code=${code}`);
  return json({ sent: true }, { headers: { "cache-control": "no-store" } });
}

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return bad("bad address");
  const subs = await repo.subsByAddress(await db(), address);
  return json(subs.map((s) => ({ channel: s.channel, verified: s.verified, target: s.channel === "email" ? s.target?.replace(/(.).+(@.+)/, "$1…$2") : s.verified ? "linked" : null, prefs: s.prefs })), { headers: { "cache-control": "no-store" } });
}

const Del = z.object({ message: z.string(), signature: z.string(), channel: z.enum(["telegram", "email"]) });
export async function DELETE(req: Request) {
  const b = Del.safeParse(await req.json().catch(() => null));
  if (!b.success) return bad("invalid body");
  const address = await verifySiwe(b.data.message, b.data.signature as `0x${string}`);
  if (!address) return bad("signature check failed", 401);
  await repo.deleteSub(await db(), address, b.data.channel);
  return json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
