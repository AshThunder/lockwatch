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
  txHash?: string; amount?: bigint; newLockId?: bigint; fallbackReason?: string; vault?: string;
}) {
  await db.query(
    `INSERT INTO protection (chain_id,lock_id,owner,mode,active,tx_hash,amount,new_lock_id,fallback_reason,updated_at,vault)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (chain_id,lock_id) DO UPDATE SET owner=EXCLUDED.owner, mode=EXCLUDED.mode, active=EXCLUDED.active,
       tx_hash=COALESCE(EXCLUDED.tx_hash, protection.tx_hash), amount=COALESCE(EXCLUDED.amount, protection.amount),
       new_lock_id=COALESCE(EXCLUDED.new_lock_id, protection.new_lock_id),
       fallback_reason=COALESCE(EXCLUDED.fallback_reason, protection.fallback_reason), updated_at=EXCLUDED.updated_at,
       vault=COALESCE(EXCLUDED.vault, protection.vault)`,
    [p.chainId, p.lockId.toString(), lc(p.owner), p.mode, p.active, p.txHash ?? null, p.amount?.toString() ?? null,
     p.newLockId?.toString() ?? null, p.fallbackReason ?? null, now(), p.vault ? lc(p.vault) : null],
  );
}

export interface ProtectionRow { chain_id: number; lock_id: string; owner: string; mode: number; active: boolean; tx_hash: string | null; amount: string | null; new_lock_id: string | null; fallback_reason: string | null; vault?: string | null }

export const protectionsByOwner = (db: Db, chainId: number, owner: string) =>
  db.query<ProtectionRow>(`SELECT * FROM protection WHERE chain_id=$1 AND owner=$2`, [chainId, lc(owner)]);

/** Keeper work queue: active protections whose lock has expired and that aren't backing off.
 *  `vault` filters to one vault; rows with NULL vault belong to `legacyDefault` (the v1 vault). */
export const dueProtections = (db: Db, chainId: number, ts: number, vault?: { address: string; isDefaultForNull: boolean }) =>
  db.query<{ lock_id: string; owner: string; mode: number; amount: string; voted: boolean }>(
    `SELECT p.lock_id, p.owner, p.mode, l.amount, l.voted FROM protection p
       JOIN lock l ON l.chain_id=p.chain_id AND l.id=p.lock_id
       LEFT JOIN keeper_attempt k ON k.chain_id=p.chain_id AND k.lock_id=p.lock_id
     WHERE p.chain_id=$1 AND p.active AND NOT l.withdrawn AND l.lock_end <= $2
       AND (k.lock_id IS NULL OR (NOT k.dead AND k.next_try_at <= $2))
       ${vault ? (vault.isDefaultForNull ? "AND (p.vault IS NULL OR p.vault=$3)" : "AND p.vault=$3") : ""}
     ORDER BY l.lock_end`,
    vault ? [chainId, ts, lc(vault.address)] : [chainId, ts],
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

// ---------------------------------------------------------------- v3: automation, keeper log, watchlists, wallets
export interface ExtendRow { lock_id: string; owner: string; trigger_within: string | number; duration: string | number; active: boolean; last_tx: string | null; last_extended_at: string | number | null }
export async function upsertExtend(db: Db, e: { chainId: number; lockId: bigint; owner: string; triggerWithin: number; duration: number; active: boolean; lastTx?: string; extendedAt?: number }) {
  await db.query(
    `INSERT INTO extend_policy (chain_id,lock_id,owner,trigger_within,duration,active,last_tx,last_extended_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (chain_id,lock_id) DO UPDATE SET owner=EXCLUDED.owner, trigger_within=EXCLUDED.trigger_within, duration=EXCLUDED.duration,
       active=EXCLUDED.active, last_tx=COALESCE(EXCLUDED.last_tx, extend_policy.last_tx),
       last_extended_at=COALESCE(EXCLUDED.last_extended_at, extend_policy.last_extended_at), updated_at=EXCLUDED.updated_at`,
    [e.chainId, e.lockId.toString(), lc(e.owner), e.triggerWithin, e.duration, e.active, e.lastTx ?? null, e.extendedAt ?? null, now()]);
}
export const markExtended = (db: Db, chainId: number, lockId: bigint, tx: string, ts = now()) =>
  db.query(`UPDATE extend_policy SET last_tx=$3, last_extended_at=$4, updated_at=$4 WHERE chain_id=$1 AND lock_id=$2`, [chainId, lockId.toString(), tx, ts]);
export const setExtendActive = (db: Db, chainId: number, lockId: bigint, active: boolean) =>
  db.query(`UPDATE extend_policy SET active=$3, updated_at=$4 WHERE chain_id=$1 AND lock_id=$2`, [chainId, lockId.toString(), active, now()]);
/** Live, unexpired locks with an active policy whose extend window has opened. */
export const dueExtends = (db: Db, chainId: number, ts: number) =>
  db.query<ExtendRow & { lock_end: string | number }>(
    `SELECT e.*, l.lock_end FROM extend_policy e JOIN lock l ON l.chain_id=e.chain_id AND l.id=e.lock_id
      WHERE e.chain_id=$1 AND e.active AND NOT l.withdrawn AND NOT l.permanent AND l.lock_end > $2 AND l.lock_end - $2 <= e.trigger_within
      ORDER BY l.lock_end`, [chainId, ts]);
export const extendsByOwner = (db: Db, chainId: number, owner: string) =>
  db.query<ExtendRow>(`SELECT * FROM extend_policy WHERE chain_id=$1 AND owner=$2 AND active`, [chainId, lc(owner)]);

export interface RewardsRow { lock_id: string; owner: string; enabled: boolean; last_claim_at: string | number; last_tx: string | null }
export async function upsertRewards(db: Db, r: { chainId: number; lockId: bigint; owner: string; enabled: boolean }) {
  await db.query(
    `INSERT INTO rewards_auto (chain_id,lock_id,owner,enabled,updated_at) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (chain_id,lock_id) DO UPDATE SET owner=EXCLUDED.owner, enabled=EXCLUDED.enabled, updated_at=EXCLUDED.updated_at`,
    [r.chainId, r.lockId.toString(), lc(r.owner), r.enabled, now()]);
}
export const markRewardsClaimed = (db: Db, chainId: number, lockId: bigint, tx: string | null, ts = now()) =>
  db.query(`UPDATE rewards_auto SET last_claim_at=$3, last_tx=COALESCE($4,last_tx), updated_at=$3 WHERE chain_id=$1 AND lock_id=$2`, [chainId, lockId.toString(), ts, tx]);
export const enabledRewards = (db: Db, chainId: number) =>
  db.query<RewardsRow>(`SELECT r.* FROM rewards_auto r JOIN lock l ON l.chain_id=r.chain_id AND l.id=r.lock_id
     WHERE r.chain_id=$1 AND r.enabled AND NOT l.withdrawn ORDER BY r.lock_id`, [chainId]);
export const rewardsByOwner = (db: Db, chainId: number, owner: string) =>
  db.query<RewardsRow>(`SELECT * FROM rewards_auto WHERE chain_id=$1 AND owner=$2 AND enabled`, [chainId, lc(owner)]);

export interface RescueRow { borrower: string; trigger_icr: string; add_amount: string; repay_amount: string; deadline: string | number; btc_escrow: string; musd_escrow: string; active: boolean; last_tx: string | null; updated_at: string | number }
export async function upsertRescue(db: Db, r: { chainId: number; borrower: string; triggerIcr: bigint; addAmount: bigint; repayAmount: bigint; deadline: number; btcEscrow: bigint; musdEscrow: bigint; active: boolean; lastTx?: string }) {
  await db.query(
    `INSERT INTO rescue_rule (chain_id,borrower,trigger_icr,add_amount,repay_amount,deadline,btc_escrow,musd_escrow,active,last_tx,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (chain_id,borrower) DO UPDATE SET trigger_icr=EXCLUDED.trigger_icr, add_amount=EXCLUDED.add_amount, repay_amount=EXCLUDED.repay_amount,
       deadline=EXCLUDED.deadline, btc_escrow=EXCLUDED.btc_escrow, musd_escrow=EXCLUDED.musd_escrow, active=EXCLUDED.active,
       last_tx=COALESCE(EXCLUDED.last_tx, rescue_rule.last_tx), updated_at=EXCLUDED.updated_at`,
    [r.chainId, lc(r.borrower), r.triggerIcr.toString(), r.addAmount.toString(), r.repayAmount.toString(), r.deadline, r.btcEscrow.toString(), r.musdEscrow.toString(), r.active, r.lastTx ?? null, now()]);
}
export const activeRescues = (db: Db, chainId: number, ts = now()) =>
  db.query<RescueRow>(`SELECT * FROM rescue_rule WHERE chain_id=$1 AND active AND deadline >= $2`, [chainId, ts]);
export const rescueOf = async (db: Db, chainId: number, borrower: string) =>
  (await db.query<RescueRow>(`SELECT * FROM rescue_rule WHERE chain_id=$1 AND borrower=$2`, [chainId, lc(borrower)]))[0];

export interface KeeperRunRow { id: number; job: string; subject: string | null; ok: boolean; tx_hash: string | null; detail: string | null; ts: string | number }
export const logRun = (db: Db, r: { chainId: number; job: string; subject?: string; ok: boolean; txHash?: string; detail?: string; ts?: number }) =>
  db.query(`INSERT INTO keeper_run (chain_id,job,subject,ok,tx_hash,detail,ts) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [r.chainId, r.job, r.subject ?? null, r.ok, r.txHash ?? null, r.detail?.slice(0, 500) ?? null, r.ts ?? now()]);
export const keeperRuns = (db: Db, chainId: number, o: { since?: number; actionsOnly?: boolean; limit?: number; offset?: number } = {}) =>
  db.query<KeeperRunRow>(`SELECT * FROM keeper_run WHERE chain_id=$1 AND ts >= $2 ${o.actionsOnly ? "AND job <> 'heartbeat'" : ""}
     ORDER BY ts DESC, id DESC LIMIT ${Math.min(Math.max(o.limit ?? 5000, 1), 10000)} OFFSET ${Math.max(o.offset ?? 0, 0)}`, [chainId, o.since ?? 0]);
/** Heartbeats older than 7 days are pruned; actions are kept. */
export const pruneHeartbeats = (db: Db, chainId: number, ts = now()) =>
  db.query(`DELETE FROM keeper_run WHERE chain_id=$1 AND job='heartbeat' AND ts < $2`, [chainId, ts - 7 * 86400]);

export interface WatchRow { account: string; address: string; label: string | null; created_at: string | number }
export const addWatch = (db: Db, account: string, address: string, label?: string) =>
  db.query(`INSERT INTO watch (account,address,label,created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (account,address) DO UPDATE SET label=EXCLUDED.label`,
    [lc(account), lc(address), label?.slice(0, 64) ?? null, now()]);
export const removeWatch = (db: Db, account: string, address: string) =>
  db.query(`DELETE FROM watch WHERE account=$1 AND address=$2`, [lc(account), lc(address)]);
export const watchlist = (db: Db, account: string) =>
  db.query<WatchRow>(`SELECT * FROM watch WHERE account=$1 ORDER BY created_at`, [lc(account)]);
/** Accounts that watch `address` (for alert fan-out). */
export const watchersOf = (db: Db, address: string) =>
  db.query<{ account: string }>(`SELECT account FROM watch WHERE address=$1`, [lc(address)]);

export const linkWallet = (db: Db, account: string, address: string) =>
  db.query(`INSERT INTO wallet_link (account,address,created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [lc(account), lc(address), now()]);
export const unlinkWallet = (db: Db, account: string, address: string) =>
  db.query(`DELETE FROM wallet_link WHERE account=$1 AND address=$2`, [lc(account), lc(address)]);
/** The account itself plus every linked wallet. */
export async function walletsOf(db: Db, account: string) {
  const rows = await db.query<{ address: string }>(`SELECT address FROM wallet_link WHERE account=$1 ORDER BY created_at`, [lc(account)]);
  return [lc(account), ...rows.map((r) => r.address).filter((a) => a !== lc(account))];
}
