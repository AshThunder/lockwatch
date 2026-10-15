/** Lockwatch mark: a watch case whose crown doubles as a lock shackle; the orange hand sits at twelve — the expiry. */
export function Mark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" fill="none">
      <path d="M12.5 6.2V4.8a3.5 3.5 0 0 1 7 0v1.4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="16" cy="18" r="11" stroke="currentColor" strokeWidth="2.2" />
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity=".55">
        <path d="M24.2 18h1.3M6.5 18h1.3M16 26.2v1.3" />
      </g>
      <path d="M16 18V9.6" stroke="#F7931A" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M16 18l4.6 2.7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="16" cy="18" r="1.9" fill="#F7931A" />
    </svg>
  );
}

export function Wordmark({ className = "h-6" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Mark className="h-full w-auto" />
      <span className="font-display text-[1.05em] font-semibold leading-none tracking-[-0.02em]" style={{ fontStretch: "112%" }}>Lockwatch</span>
    </span>
  );
}
