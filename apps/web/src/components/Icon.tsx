/** Authored 1.6px-stroke icon set on a 20px grid. One stroke weight, round caps. */
const P: Record<string, React.ReactNode> = {
  external: <><path d="M9 4h7v7" /><path d="M16 4l-8.5 8.5" /><path d="M14 12.5V16H4V6h3.5" /></>,
  check: <path d="M4.5 10.5l3.5 3.5 7.5-8" />,
  shield: <><path d="M10 2.8l6 2.2v4.6c0 3.7-2.6 6.4-6 7.6-3.4-1.2-6-3.9-6-7.6V5z" /><path d="M7.3 10l1.9 1.9 3.6-3.8" /></>,
  bell: <><path d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.3 1.5H3.7z" /><path d="M8.3 17.2a1.9 1.9 0 0 0 3.4 0" /></>,
  arrow: <><path d="M4 10h11.5" /><path d="M11 5.5L15.5 10 11 14.5" /></>,
  back: <><path d="M16 10H4.5" /><path d="M9 5.5L4.5 10 9 14.5" /></>,
  alert: <><path d="M10 3l7.5 13h-15z" /><path d="M10 8.5v3.2" /><path d="M10 14h.01" /></>,
  clock: <><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.6 1.6" /></>,
  search: <><circle cx="8.8" cy="8.8" r="5.3" /><path d="M12.8 12.8L17 17" /></>,
  board: <><rect x="3" y="4" width="14" height="12" rx="1.5" /><path d="M3 8.5h14M3 12h14M8 4v12" /></>,
  locks: <><rect x="4" y="9" width="12" height="8" rx="1.5" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /><path d="M10 12.2v1.6" /></>,
  map: <><path d="M3 5.5l4.5-2 5 2 4.5-2v11l-4.5 2-5-2-4.5 2z" /><path d="M7.5 3.5v11M12.5 5.5v11" /></>,
  radar: <><path d="M3 15.5h14" /><path d="M5 15.5V11M8 15.5V7.5M11 15.5V9.5M14 15.5V4.5" /></>,
  activity: <path d="M2.5 10.5h3l2-5 3.5 9 2-4h4.5" />,
  menu: <><path d="M3.5 6h13M3.5 10h13M3.5 14h13" /></>,
  close: <><path d="M5 5l10 10M15 5L5 15" /></>,
  chevL: <path d="M12 5l-5 5 5 5" />, chevR: <path d="M8 5l5 5-5 5" />, chevD: <path d="M5 8l5 5 5-5" />,
  sortUp: <><path d="M10 4v12" /><path d="M6 8l4-4 4 4" /></>, sortDown: <><path d="M10 4v12" /><path d="M6 12l4 4 4-4" /></>,
  copy: <><rect x="7" y="7" width="9" height="9" rx="1.5" /><path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" /></>,
  relock: <><path d="M15.5 8A6 6 0 0 0 4.6 7" /><path d="M4.5 3.5V7H8" /><path d="M4.5 12a6 6 0 0 0 10.9 1" /><path d="M15.5 16.5V13H12" /></>,
  wallet: <><rect x="3" y="5" width="14" height="11" rx="1.5" /><path d="M3 8h14" /><path d="M13 12h1.5" /></>,
  coin: <><circle cx="10" cy="10" r="7" /><path d="M8 7h3a1.5 1.5 0 0 1 0 3H8zM8 10h3.5a1.5 1.5 0 0 1 0 3H8zM8 6v8M10 6v1M10 13v1" /></>,
  telegram: <path d="M3 9.5l13.5-5.5-2.3 12-4.2-3.3-2.2 2.1.3-3.4 6-5.3-7.4 4.4z" />,
  mail: <><rect x="3" y="5" width="14" height="10.5" rx="1.5" /><path d="M3.5 6l6.5 5 6.5-5" /></>,
  github: <path d="M10 2.5a7.5 7.5 0 0 0-2.4 14.6c.4.1.5-.2.5-.4v-1.4c-2.1.5-2.5-.9-2.5-.9-.3-.9-.8-1.1-.8-1.1-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.8.8 2.3.6 0-.5.3-.8.5-1-1.7-.2-3.4-.8-3.4-3.7 0-.8.3-1.5.8-2-.1-.2-.3-1 .1-2 0 0 .6-.2 2.1.8a7 7 0 0 1 3.8 0c1.4-1 2.1-.8 2.1-.8.4 1 .2 1.8.1 2 .5.5.8 1.2.8 2 0 2.9-1.8 3.5-3.4 3.7.3.2.5.7.5 1.4v2.1c0 .2.1.5.5.4A7.5 7.5 0 0 0 10 2.5z" />,
};
export function Icon({ name, className = "h-4 w-4" }: { name: keyof typeof P | string; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[name]}</svg>
  );
}
export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={`shrink-0 animate-spin motion-reduce:animate-none ${className}`} fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeOpacity=".25" strokeWidth="2" />
      <path d="M17 10a7 7 0 0 0-7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
