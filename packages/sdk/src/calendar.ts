/** Calendar export: an RFC 5545 ICS feed per wallet and Google Calendar "add event" links. */
export interface CalendarLock {
  id: string;
  amount: string; // wei
  end: number; // unix seconds (Thursday 00:00 UTC)
  voted?: boolean;
  protectedMode?: string | null; // e.g. "Send BTC to my wallet"
}

const pad = (n: number) => String(n).padStart(2, "0");
/** 20261022T000000Z */
export const icsDate = (ts: number) => {
  const d = new Date(ts * 1000);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
};
const btc = (wei: string) => {
  const v = BigInt(wei);
  const whole = v / 10n ** 18n;
  const frac = (v % 10n ** 18n).toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
};
/** RFC 5545 TEXT escaping. */
export const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** Fold lines longer than 75 octets (RFC 5545 §3.1). */
export function icsFold(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) out.push(" " + line.slice(i, i + 74));
  return out.join("\r\n");
}

export function lockEventText(l: CalendarLock, appUrl: string) {
  const title = `veBTC lock #${l.id} unlocks (${btc(l.amount)} BTC)`;
  const plan = l.protectedMode ? `Lockwatch will: ${l.protectedMode}.` : "Not protected: the BTC sits idle until you claim it.";
  const votes = l.voted ? " This lock has gauge votes; they can be cleared from 01:00 UTC." : "";
  return { title, details: `${plan}${votes} ${appUrl}/lock/${l.id}`.trim(), url: `${appUrl}/lock/${l.id}` };
}

/** Wallet feed: one 30-minute event per upcoming lock end, with 7-day and 1-day alarms. */
export function buildIcs(address: string, locks: CalendarLock[], appUrl: string, now = Math.floor(Date.now() / 1000)): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Lockwatch//veBTC unlocks//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(`Lockwatch ${address.slice(0, 6)}…${address.slice(-4)}`)}`, "X-WR-TIMEZONE:UTC",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
  ];
  for (const l of locks) {
    const t = lockEventText(l, appUrl);
    lines.push(
      "BEGIN:VEVENT",
      `UID:lockwatch-${l.id}-${l.end}@lockwatch.vercel.app`,
      `DTSTAMP:${icsDate(now)}`,
      `DTSTART:${icsDate(l.end)}`,
      `DTEND:${icsDate(l.end + 1800)}`,
      `SUMMARY:${icsEscape(t.title)}`,
      `DESCRIPTION:${icsEscape(t.details)}`,
      `URL:${t.url}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(t.title)} in 7 days`, "TRIGGER:-P7D", "END:VALARM",
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(t.title)} in 24 hours`, "TRIGGER:-P1D", "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(icsFold).join("\r\n") + "\r\n";
}

/** https://calendar.google.com/calendar/render?action=TEMPLATE … for a single unlock. */
export function googleCalendarUrl(l: CalendarLock, appUrl: string): string {
  const t = lockEventText(l, appUrl);
  const q = new URLSearchParams({ action: "TEMPLATE", text: t.title, dates: `${icsDate(l.end)}/${icsDate(l.end + 1800)}`, details: t.details, ctz: "UTC" });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** webcal:// subscription URL for a feed (Apple Calendar / Outlook subscribe). */
export const webcalUrl = (httpsUrl: string) => httpsUrl.replace(/^https?:\/\//, "webcal://");
