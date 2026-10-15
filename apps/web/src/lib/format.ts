export const btc = (wei: string | bigint, dp = 4) => {
  const n = Number(BigInt(wei)) / 1e18;
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 0.01 && n > 0 ? 8 : dp });
};
export const usd = (wei: string | bigint, dp = 0) => (Number(BigInt(wei)) / 1e18).toLocaleString("en-US", { maximumFractionDigits: dp });
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export function left(sec: number) {
  if (sec <= 0) return "expired";
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}
export const pct = (wei18: string | bigint) => `${(Number(BigInt(wei18)) / 1e16).toFixed(1)}%`;
export const fetcher = async <T,>(u: string): Promise<T> => {
  const r = await fetch(u);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
  return r.json();
};
