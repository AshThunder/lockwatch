"use client";
import { useNow, nextThursday, Countdown, when } from "./ui";

const WEEK = 7 * 86400;
const DAYS = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed", "Thu"];

/** Signature: the veBTC week as a chronograph scale — every lock on Mezo ends at the right-hand edge. */
export function WeekScale() {
  const now = useNow();
  const end = nextThursday(now);
  const frac = 1 - (end - now) / WEEK;
  return (
    <div className="panel relative overflow-hidden p-5 md:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-sm font-medium text-mute">Next veBTC unlock</h2>
        <span className="num text-2xs text-faint">Thu 00:00 UTC · {when(end)} your time</span>
      </div>
      <Countdown to={end} className="mt-3 block whitespace-nowrap text-[2.3rem] font-medium leading-none tracking-[-0.03em] text-paper sm:text-5xl md:text-[2.6rem] lg:text-[3.1rem]" />
      <div className="relative mt-8 h-14 select-none" aria-hidden="true">
        {/* ticks: every 6h, taller each day */}
        <div className="absolute inset-x-0 bottom-5 flex justify-between">
          {Array.from({ length: 29 }, (_, i) => (
            <i key={i} className={`block w-px ${i % 4 === 0 ? "h-4 bg-mute" : "h-2 bg-faint/70"}`} />
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-5 h-px bg-line" />
        <div className="absolute bottom-5 left-0 h-px bg-btc" style={{ width: `${frac * 100}%` }} />
        {/* the hand */}
        <div className="absolute bottom-[14px] flex -translate-x-1/2 flex-col items-center" style={{ left: `${frac * 100}%` }}>
          <span className="num mb-1 rounded-[3px] bg-btc px-1 text-[10px] font-semibold leading-4 text-base">now</span>
          <i className="h-6 w-0.5 bg-btc" />
        </div>
        <div className="absolute inset-x-0 bottom-0 flex justify-between font-mono text-[10px] uppercase tracking-wider text-faint">
          {DAYS.map((d, i) => <span key={i} className={`w-0 text-center ${i === 7 ? "text-btc" : ""} ${i % 2 ? "max-sm:invisible" : ""}`}><span className="-ml-3 inline-block w-6">{d}</span></span>)}
        </div>
      </div>
      <p className="mt-5 text-xs leading-relaxed text-mute">Every veBTC lock ends on this boundary. Whatever unlocks then sits unclaimed until someone withdraws it.</p>
    </div>
  );
}
