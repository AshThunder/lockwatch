export type Watched = { address: string; label?: string | null };
const KEY = "lockwatch.watch.v1";
const isAddr = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);

export function loadLocal(): Watched[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => x && isAddr(x.address)).map((x) => ({ address: x.address.toLowerCase(), label: typeof x.label === "string" ? x.label.slice(0, 64) : null })) : [];
  } catch { return []; }
}
export function saveLocal(xs: Watched[]) { localStorage.setItem(KEY, JSON.stringify(xs)); }

/** Add or relabel; addresses are case-insensitive. Returns a new list. */
export function upsert(xs: Watched[], w: Watched): Watched[] {
  const a = w.address.trim().toLowerCase();
  if (!isAddr(a)) throw new Error("Enter a 0x address (42 characters).");
  const label = w.label?.trim() || null;
  return xs.some((x) => x.address === a) ? xs.map((x) => (x.address === a ? { address: a, label: label ?? x.label ?? null } : x)) : [...xs, { address: a, label }];
}
export const drop = (xs: Watched[], a: string) => xs.filter((x) => x.address !== a.toLowerCase());
/** Union of local + account lists; account labels win. */
export function merge(local: Watched[], account: Watched[]): Watched[] {
  let out = [...local];
  for (const w of account) out = upsert(out, w);
  return out;
}
