import type { Db } from "./index";

const lc = (a: string) => a.toLowerCase();
const now = () => Math.floor(Date.now() / 1000);

export interface LockRow {
  chain_id: number; id: string; owner: string; amount: string; lock_end: string | number;
  permanent: boolean; voted: boolean; approved_vault: boolean; withdrawn: boolean;
}

export async function upsertLock(db: Db, l: {
  chainId: number; id: bigint; owner: string; amount: bigint; end: number; permanent: boolean; voted: boolean;
  approvedVault?: boolean; withdrawn?: boolean;
}) {
  await db.query(
    `INSERT INTO lock (chain_id,id,owner,amount,lock_end,permanent,voted,approved_vault,withdrawn,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (chain_id,id) DO UPDATE SET owner=EXCLUDED.owner, amount=EXCLUDED.amount, lock_end=EXCLUDED.lock_end,
       permanent=EXCLUDED.permanent, voted=EXCLUDED.voted, approved_vault=EXCLUDED.approved_vault,
       withdrawn=EXCLUDED.withdrawn, updated_at=EXCLUDED.updated_at`,
    [l.chainId, l.id.toString(), lc(l.owner), l.amount.toString(), l.end, l.permanent, l.voted, !!l.approvedVault, !!l.withdrawn, now()],
  );
}

export const markWithdrawn = (db: Db, chainId: number, id: bigint) =>
  db.query(`UPDATE lock SET withdrawn=true, updated_at=$3 WHERE chain_id=$1 AND id=$2`, [chainId, id.toString(), now()]);

export const locksByOwner = (db: Db, chainId: number, owner: string) =>
  db.query<LockRow>(`SELECT * FROM lock WHERE chain_id=$1 AND owner=$2 AND NOT withdrawn ORDER BY lock_end`, [chainId, lc(owner)]);

export const lockById = async (db: Db, chainId: number, id: bigint) =>
  (await db.query<LockRow>(`SELECT * FROM lock WHERE chain_id=$1 AND id=$2`, [chainId, id.toString()]))[0];

export const liveLocks = (db: Db, chainId: number) =>
  db.query<LockRow>(`SELECT * FROM lock WHERE chain_id=$1 AND NOT withdrawn`, [chainId]);

export async function upsertProtection(db: Db, p: {
  chainId: number; lockId: bigint; owner: string; mode: number; active: boolean;
  txHash?: string; amount?: bigint; newLockId?: bigint; fallbackReason?: string;
}) {
  await db.query(
    `INSERT INTO protection (chain_id,lock_id,owner,mode,active,tx_hash,amount,new_lock_id,fallback_reason,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (chain_id,lock_id) DO UPDATE SET owner=EXCLUDED.owner, mode=EXCLUDED.mode, active=EXCLUDED.active,
       tx_hash=COALESCE(EXCLUDED.tx_hash, protection.tx_hash), amount=COALESCE(EXCLUDED.amount, protection.amount),
       new_lock_id=COALESCE(EXCLUDED.new_lock_id, protection.new_lock_id),
       fallback_reason=COALESCE(EXCLUDED.fallback_reason, protection.fallback_reason), updated_at=EXCLUDED.updated_at`,
    [p.chainId, p.lockId.toString(), lc(p.owner), p.mode, p.active, p.txHash ?? null, p.amount?.toString() ?? null,
     p.newLockId?.toString() ?? null, p.fallbackReason ?? null, now()],
  );
}

export interface ProtectionRow { chain_id: number; lock_id: string; owner: string; mode: number; active: boolean; tx_hash: string | null; amount: string | null; new_lock_id: string | null; fallback_reason: string | null }

export const protectionsByOwner = (db: Db, chainId: number, owner: string) =>
  db.query<ProtectionRow>(`SELECT * FROM protection WHERE chain_id=$1 AND owner=$2`, [chainId, lc(owner)]);

/** Keeper work queue: active protections whose lock has expired and that aren't backing off. */
export const dueProtections = (db: Db, chainId: number, ts: number) =>
  db.query<{ lock_id: string; owner: string; mode: number; amount: string; voted: boolean }>(
    `SELECT p.lock_id, p.owner, p.mode, l.amount, l.voted FROM protection p
       JOIN lock l ON l.chain_id=p.chain_id AND l.id=p.lock_id
       LEFT JOIN keeper_attempt k ON k.chain_id=p.chain_id AND k.lock_id=p.lock_id
     WHERE p.chain_id=$1 AND p.active AND NOT l.withdrawn AND l.lock_end <= $2
       AND (k.lock_id IS NULL OR (NOT k.dead AND k.next_try_at <= $2))
     ORDER BY l.lock_end`,
    [chainId, ts],
  );

export async function recordAttempt(db: Db, chainId: number, lockId: bigint, error: string, ts: number, maxAttempts = 3) {
  const rows = await db.query<{ attempts: number }>(
    `INSERT INTO keeper_attempt (chain_id,lock_id,attempts,last_error,next_try_at)
     VALUES ($1,$2,1,$3,$4)
     ON CONFLICT (chain_id,lock_id) DO UPDATE SET attempts=keeper_attempt.attempts+1, last_error=EXCLUDED.last_error
     RETURNING attempts`,
    [chainId, lockId.toString(), error.slice(0, 500), ts + 60],
  );
  const a = rows[0].attempts;
  const dead = a >= maxAttempts;
  await db.query(`UPDATE keeper_attempt SET next_try_at=$3, dead=$4 WHERE chain_id=$1 AND lock_id=$2`,
    [chainId, lockId.toString(), ts + 60 * 2 ** a, dead]);
  return { attempts: a, dead };
}

export const clearAttempt = (db: Db, chainId: number, lockId: bigint) =>
  db.query(`DELETE FROM keeper_attempt WHERE chain_id=$1 AND lock_id=$2`, [chainId, lockId.toString()]);

export async function replaceTroves(db: Db, chainId: number, rows: {
  owner: string; coll: bigint; debt: bigint; icr: bigint; rank: number; musdAhead: bigint; redeemable: boolean;
}[]) {
  const ts = now();
  await db.query(`DELETE FROM trove WHERE chain_id=$1`, [chainId]);
  for (const r of rows) {
    await db.query(
      `INSERT INTO trove (chain_id,owner,coll,debt,icr,rank,musd_ahead,redeemable,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [chainId, lc(r.owner), r.coll.toString(), r.debt.toString(), r.icr.toString(), r.rank, r.musdAhead.toString(), r.redeemable, ts],
    );
  }
}

export interface TroveRow { owner: string; coll: string; debt: string; icr: string; rank: number; musd_ahead: string; redeemable: boolean; updated_at: string | number }
export const troveOf = async (db: Db, chainId: number, owner: string) =>
  (await db.query<TroveRow>(`SELECT * FROM trove WHERE chain_id=$1 AND owner=$2`, [chainId, lc(owner)]))[0];
export const troveLine = (db: Db, chainId: number, limit: number) =>
  db.query<TroveRow>(`SELECT * FROM trove WHERE chain_id=$1 ORDER BY redeemable DESC, rank ASC LIMIT $2`, [chainId, limit]);

// ---------------------------------------------------------------- subscriptions & alerts
export interface SubRow { id: number; address: string; channel: "telegram" | "email"; target: string | null; verified: boolean; code: string | null; prefs: Record<string, boolean> }

export async function createPendingSub(db: Db, address: string, channel: "telegram" | "email", code: string, target?: string, prefs: Record<string, boolean> = {}) {
  const rows = await db.query<SubRow>(
    `INSERT INTO subscription (address,channel,target,verified,code,prefs,created_at) VALUES ($1,$2,$3,false,$4,$5,$6)
     ON CONFLICT (address,channel) DO UPDATE SET code=EXCLUDED.code, target=COALESCE(EXCLUDED.target, subscription.target),
       verified=false, prefs=EXCLUDED.prefs RETURNING *`,
    [lc(address), channel, target ?? null, code, JSON.stringify(prefs), now()],
  );
  return rows[0];
}

/** Telegram /start <code> or email magic link: binds the target and verifies. Single-use code. */
export async function verifySub(db: Db, code: string, target?: string) {
  const rows = await db.query<SubRow>(
    `UPDATE subscription SET verified=true, code=NULL, target=COALESCE($2, target) WHERE code=$1 RETURNING *`,
    [code, target ?? null],
  );
  return rows[0];
}

export const subsByAddress = (db: Db, address: string) =>
  db.query<SubRow>(`SELECT * FROM subscription WHERE address=$1`, [lc(address)]);
export const verifiedSubs = (db: Db) => db.query<SubRow>(`SELECT * FROM subscription WHERE verified`);
export const deleteSub = (db: Db, address: string, channel: string) =>
  db.query(`DELETE FROM subscription WHERE address=$1 AND channel=$2`, [lc(address), channel]);
export const subByTarget = async (db: Db, channel: string, target: string) =>
  (await db.query<SubRow>(`SELECT * FROM subscription WHERE channel=$1 AND target=$2 AND verified`, [channel, target]))[0];
export const updateSubPrefs = (db: Db, id: number, prefs: Record<string, boolean>) =>
  db.query(`UPDATE subscription SET prefs=$2 WHERE id=$1`, [id, JSON.stringify(prefs)]);

/** Returns true if this (sub,key) has not been sent before and records it atomically. */
export async function claimAlert(db: Db, subId: number, key: string, kind: string): Promise<boolean> {
  const rows = await db.query(
    `INSERT INTO alert_log (sub_id,key,kind,sent_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING key`,
    [subId, key, kind, now()],
  );
  return rows.length === 1;
}
export const releaseAlert = (db: Db, subId: number, key: string) =>
  db.query(`DELETE FROM alert_log WHERE sub_id=$1 AND key=$2`, [subId, key]);

export async function snapshot(db: Db, s: { chainId: number; btcAtRisk: bigint; expiredCount: number; locks: number; troves: number; price?: bigint }) {
  await db.query(
    `INSERT INTO stats_snapshot (chain_id,ts,btc_at_risk,expired_count,locks,troves,price) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
    [s.chainId, now(), s.btcAtRisk.toString(), s.expiredCount, s.locks, s.troves, s.price?.toString() ?? null],
  );
}
export const latestSnapshot = async (db: Db, chainId: number) =>
  (await db.query<{ ts: string; btc_at_risk: string; expired_count: number; locks: number; troves: number; price: string | null }>(
    `SELECT * FROM stats_snapshot WHERE chain_id=$1 ORDER BY ts DESC LIMIT 1`, [chainId]))[0];

export const getCursor = async (db: Db, name: string) =>
  (await db.query<{ value: string }>(`SELECT value FROM cursor WHERE name=$1`, [name]))[0]?.value;
export const setCursor = (db: Db, name: string, value: string) =>
  db.query(`INSERT INTO cursor (name,value) VALUES ($1,$2) ON CONFLICT (name) DO UPDATE SET value=EXCLUDED.value`, [name, value]);

export const putNonce = (db: Db, nonce: string) => db.query(`INSERT INTO siwe_nonce (nonce,created_at) VALUES ($1,$2)`, [nonce, now()]);
export async function useNonce(db: Db, nonce: string, maxAge = 600): Promise<boolean> {
  const r = await db.query(`DELETE FROM siwe_nonce WHERE nonce=$1 AND created_at >= $2 RETURNING nonce`, [nonce, now() - maxAge]);
  return r.length === 1;
}

// ---------------------------------------------------------------- read models for the web app (no schema change)
export const protectionById = async (db: Db, chainId: number, id: bigint) =>
  (await db.query<ProtectionRow & { updated_at: string | number }>(`SELECT * FROM protection WHERE chain_id=$1 AND lock_id=$2`, [chainId, id.toString()]))[0];

export const attemptById = async (db: Db, chainId: number, id: bigint) =>
  (await db.query<{ attempts: number; last_error: string | null; next_try_at: string | number; dead: boolean }>(
    `SELECT attempts,last_error,next_try_at,dead FROM keeper_attempt WHERE chain_id=$1 AND lock_id=$2`, [chainId, id.toString()]))[0];

export type ActivityKind = "protected" | "fallback" | "registered" | "unregistered" | "retrying" | "stuck";
export interface ActivityRow { kind: ActivityKind; lock_id: string; owner: string; mode: number; tx_hash: string | null; amount: string | null; new_lock_id: string | null; detail: string | null; ts: number }

/** Keeper and vault activity, newest first: protections (by state) plus keeper retries. */
export async function activity(db: Db, chainId: number, opts: { limit?: number; offset?: number; owner?: string; lockId?: bigint } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100), offset = Math.max(opts.offset ?? 0, 0);
  const where: string[] = ["p.chain_id=$1"]; const args: unknown[] = [chainId];
  if (opts.owner) { args.push(lc(opts.owner)); where.push(`p.owner=$${args.length}`); }
  if (opts.lockId !== undefined) { args.push(opts.lockId.toString()); where.push(`p.lock_id=$${args.length}`); }
  const rows = await db.query<{ lock_id: string; owner: string; mode: number; active: boolean; tx_hash: string | null; amount: string | null; new_lock_id: string | null; fallback_reason: string | null; updated_at: string | number; attempts: number | null; last_error: string | null; dead: boolean | null }>(
    `SELECT p.lock_id,p.owner,p.mode,p.active,p.tx_hash,p.amount,p.new_lock_id,p.fallback_reason,p.updated_at,k.attempts,k.last_error,k.dead
       FROM protection p LEFT JOIN keeper_attempt k ON k.chain_id=p.chain_id AND k.lock_id=p.lock_id
      WHERE ${where.join(" AND ")} ORDER BY p.updated_at DESC, p.lock_id DESC LIMIT ${limit + 1} OFFSET ${offset}`, args);
  const items: ActivityRow[] = rows.slice(0, limit).map((r) => {
    const kind: ActivityKind = r.attempts && r.active ? (r.dead ? "stuck" : "retrying")
      : r.fallback_reason ? "fallback" : !r.active && r.tx_hash ? "protected" : r.active ? "registered" : "unregistered";
    return { kind, lock_id: String(r.lock_id), owner: r.owner, mode: Number(r.mode), tx_hash: r.tx_hash, amount: r.amount && String(r.amount), new_lock_id: r.new_lock_id && String(r.new_lock_id),
      detail: kind === "fallback" ? r.fallback_reason : kind === "retrying" || kind === "stuck" ? r.last_error : null, ts: Number(r.updated_at) };
  });
  return { items, hasMore: rows.length > limit };
}

export type LockSort = "amount" | "end" | "id";
/** Paginated lock explorer. state: expired | live | all. */
export async function exploreLocks(db: Db, chainId: number, o: { state?: "expired" | "live" | "all"; minBtc?: bigint; sort?: LockSort; dir?: "asc" | "desc"; limit?: number; offset?: number; now?: number; excludeOver?: bigint }) {
  const now_ = o.now ?? now(); const limit = Math.min(Math.max(o.limit ?? 25, 1), 100); const offset = Math.max(o.offset ?? 0, 0);
  const args: unknown[] = [chainId, now_]; const where = ["chain_id=$1", "NOT withdrawn", "NOT permanent"];
  if ((o.state ?? "expired") === "expired") where.push("lock_end <= $2"); else if (o.state === "live") where.push("lock_end > $2");
  if (o.minBtc) { args.push(o.minBtc.toString()); where.push(`amount >= $${args.length}`); }
  if (o.excludeOver) { args.push(o.excludeOver.toString()); where.push(`amount < $${args.length}`); }
  const col = { amount: "amount", end: "lock_end", id: "id" }[o.sort ?? "amount"]; const dir = o.dir === "asc" ? "ASC" : "DESC";
  const w = where.join(" AND ");
  const [rows, cnt] = await Promise.all([
    db.query<LockRow>(`SELECT * FROM lock WHERE ${w} ORDER BY ${col} ${dir}, id ASC LIMIT ${limit} OFFSET ${offset}`, args),
    db.query<{ n: string | number; s: string | null }>(`SELECT count(*) AS n, sum(amount) AS s FROM lock WHERE ${w}`, args),
  ]);
  return { rows, total: Number(cnt[0]?.n ?? 0), totalAmount: String(cnt[0]?.s ?? "0") };
}
