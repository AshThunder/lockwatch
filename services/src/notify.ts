import { log } from "./config";

export interface Channel { send(target: string, text: string, html?: string): Promise<void> }

/** Telegram Bot API (sendMessage). Token comes from env and is never logged. */
export function telegram(token: string, fetchImpl: typeof fetch = fetch): Channel & {
  getUpdates(offset: number): Promise<{ update_id: number; message?: { chat: { id: number }; text?: string } }[]>;
  setWebhook(url: string, secret: string): Promise<void>;
} {
  const api = (m: string) => `https://api.telegram.org/bot${token}/${m}`;
  const call = async (m: string, body: unknown) => {
    const r = await fetchImpl(api(m), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = (await r.json()) as { ok: boolean; result: unknown; description?: string };
    if (!j.ok) throw new Error(`telegram ${m}: ${j.description}`);
    return j.result;
  };
  return {
    send: async (chatId, text) => { await call("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }); },
    getUpdates: async (offset) => (await call("getUpdates", { offset, timeout: 25 })) as never,
    setWebhook: async (url, secret) => { await call("setWebhook", { url, secret_token: secret }); },
  };
}

/** Resend email API. */
export function resend(key: string, from: string, fetchImpl: typeof fetch = fetch): Channel {
  return {
    send: async (to, text, html) => {
      const r = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to, subject: text.split("\n")[0].replace(/<[^>]+>/g, "").slice(0, 90), text: text.replace(/<[^>]+>/g, ""), html: html ?? text.replace(/\n/g, "<br/>") }),
      });
      if (!r.ok) throw new Error(`resend ${r.status}`);
    },
  };
}

/** Fallback when no credentials: log instead of sending (local dev / demo dry-run). */
export const consoleChannel = (name: string): Channel => ({
  send: async (target, text) => log("notify", `[dry-run ${name}]`, { target, text }),
});
