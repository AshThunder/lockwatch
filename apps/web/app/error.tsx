"use client";
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl py-16 text-center" role="alert">
      <h1 className="font-display text-4xl font-extrabold uppercase">Something broke</h1>
      <p className="mt-3 break-words text-mute">{error.message || "An unexpected error stopped this page."} Your locks and funds are unaffected; this is only the page.</p>
      <button className="btn-primary mt-6" onClick={reset}>Try again</button>
    </div>
  );
}
