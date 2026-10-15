/** Lockwatch mark v2: a single split-flap tile whose top half is a lock shackle.
 *  The orange bar is the board's departing lamp — the moment the lock ends. */
export function Mark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" fill="none">
      <path d="M10.5 12V9.2a5.5 5.5 0 0 1 11 0V12" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <rect x="5" y="12" width="22" height="17" rx="3" fill="currentColor" />
      <rect x="5" y="19.6" width="22" height="1.8" fill="#0E1012" />
      <rect x="11" y="15" width="10" height="2.6" rx="1.3" fill="#F7931A" />
      <rect x="14.6" y="23.4" width="2.8" height="3.2" rx="1.4" fill="#0E1012" />
    </svg>
  );
}

export function Wordmark({ className = "h-6" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Mark className="h-full w-auto" />
      <span className="font-display text-[1.2em] font-bold uppercase leading-none tracking-[0.06em]">Lockwatch</span>
    </span>
  );
}
