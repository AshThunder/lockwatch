import Link from "next/link";
export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <div className="num text-sm text-faint">404</div>
      <h1 className="mt-2 font-display text-4xl font-extrabold uppercase">Not on the board</h1>
      <p className="mt-3 text-mute">That page doesn&rsquo;t exist. Search a lock number or wallet from the top bar, or head back.</p>
      <div className="mt-6 flex justify-center gap-2"><Link href="/dashboard" className="btn-primary">My locks</Link><Link href="/" className="btn-ghost">Home</Link></div>
    </div>
  );
}
