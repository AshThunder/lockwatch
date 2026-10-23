"use client";
import { useState } from "react";
import { googleCalendarUrl, webcalUrl } from "@lockwatch/sdk";
import { Icon } from "./Icon";
import { CopyButton } from "./ui";

/** Calendar export for a wallet: subscribe (webcal), download .ics, copy the feed URL. */
export function CalendarExport({ address, compact = false }: { address: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const feed = typeof window === "undefined" ? `/api/calendar/${address}.ics` : `${window.location.origin}/api/calendar/${address}.ics`;
  return (
    <div className="relative">
      <button className={compact ? "btn-ghost btn-sm" : "btn-ghost"} aria-expanded={open} aria-controls="cal-pop" onClick={() => setOpen((o) => !o)}>
        <Icon name="calendar" />Add to calendar<Icon name="chevD" className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div id="cal-pop" role="dialog" aria-label="Calendar export" className="absolute right-0 z-30 mt-2 w-[19rem] rounded-md border border-line bg-raised p-3 text-sm shadow-pop">
          <p className="px-1 pb-2 text-xs leading-relaxed text-mute">Every upcoming veBTC and veMEZO unlock for this wallet, with reminders 7 days and 24 hours before. The feed refreshes as locks change.</p>
          <a className="flex min-h-[44px] items-center gap-2.5 rounded px-2 hover:bg-flap" href={webcalUrl(feed)}><Icon name="calendar" className="h-4 w-4 text-btc" />Subscribe in Apple Calendar or Outlook</a>
          <a className="flex min-h-[44px] items-center gap-2.5 rounded px-2 hover:bg-flap" target="_blank" rel="noreferrer" href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl(feed))}`}><Icon name="external" className="h-4 w-4 text-faint" />Subscribe in Google Calendar</a>
          <a className="flex min-h-[44px] items-center gap-2.5 rounded px-2 hover:bg-flap" href={feed} download><Icon name="arrow" className="h-4 w-4 rotate-90 text-faint" />Download .ics</a>
          <div className="mt-1 flex items-center gap-1 border-t border-hair px-1 pt-2"><span className="num min-w-0 flex-1 truncate text-xs text-faint">{feed}</span><CopyButton text={feed} label="Copy feed URL" /></div>
        </div>
      )}
    </div>
  );
}

/** One-tap Google Calendar event for a single unlock. */
export function GoogleCalLink({ id, amount, end, voted, mode, asset, className = "" }: { id: string; amount: string; end: number; voted?: boolean; mode?: string | null; asset?: "btc" | "mezo"; className?: string }) {
  const app = typeof window === "undefined" ? "https://lockwatch.online" : window.location.origin;
  return (
    <a className={`inline-flex min-h-[32px] items-center gap-1.5 text-xs text-mute hover:text-paper ${className}`} target="_blank" rel="noreferrer"
      href={googleCalendarUrl({ id, amount, end, voted, asset, protectedMode: mode ?? null }, app)} aria-label={`Add lock #${id} unlock to Google Calendar`}>
      <Icon name="calendar" className="h-3.5 w-3.5" />Google Calendar
    </a>
  );
}
