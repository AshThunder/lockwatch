/** Authored 1.6px-stroke icon set — replaces emoji and unicode glyphs. */
const P: Record<string, React.ReactNode> = {
  external: <><path d="M9 4h7v7" /><path d="M16 4l-8.5 8.5" /><path d="M14 12.5V16H4V6h3.5" /></>,
  check: <path d="M4.5 10.5l3.5 3.5 7.5-8" />,
  shield: <><path d="M10 2.8l6 2.2v4.6c0 3.7-2.6 6.4-6 7.6-3.4-1.2-6-3.9-6-7.6V5z" /><path d="M7.3 10l1.9 1.9 3.6-3.8" /></>,
  bell: <><path d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.3 1.5H3.7z" /><path d="M8.3 17.2a1.9 1.9 0 0 0 3.4 0" /></>,
  arrow: <><path d="M4 10h11.5" /><path d="M11 5.5L15.5 10 11 14.5" /></>,
  back: <><path d="M16 10H4.5" /><path d="M9 5.5L4.5 10 9 14.5" /></>,
  alert: <><path d="M10 3l7.5 13h-15z" /><path d="M10 8.5v3.2" /><path d="M10 14h.01" /></>,
  clock: <><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.6 1.6" /></>,
};
export function Icon({ name, className = "h-4 w-4" }: { name: keyof typeof P | string; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[name]}</svg>
  );
}
