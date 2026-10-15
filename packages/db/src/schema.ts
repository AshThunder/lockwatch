// Lockwatch schema (Postgres / PGlite). Kept in TS so bundlers (Next.js) need no fs access.
export const SCHEMA_SQL = `
-- Lockwatch schema (Postgres / PGlite). Amounts are numeric(78,0) wei strings.
CREATE TABLE IF NOT EXISTS lock (
  chain_id     integer NOT NULL,
  id           numeric(78,0) NOT NULL,
  owner        text NOT NULL,
  amount       numeric(78,0) NOT NULL,
  lock_end     bigint NOT NULL,
  permanent    boolean NOT NULL DEFAULT false,
  voted        boolean NOT NULL DEFAULT false,
  approved_vault boolean NOT NULL DEFAULT false,
  withdrawn    boolean NOT NULL DEFAULT false,
  updated_at   bigint NOT NULL,
  PRIMARY KEY (chain_id, id)
);
CREATE INDEX IF NOT EXISTS lock_owner ON lock (chain_id, lower(owner));
CREATE INDEX IF NOT EXISTS lock_end_idx ON lock (chain_id, lock_end) WHERE NOT withdrawn;

CREATE TABLE IF NOT EXISTS protection (
  chain_id   integer NOT NULL,
  lock_id    numeric(78,0) NOT NULL,
  owner      text NOT NULL,
  mode       smallint NOT NULL,
  active     boolean NOT NULL,
  tx_hash    text,
  amount     numeric(78,0),
  new_lock_id numeric(78,0),
  fallback_reason text,
  updated_at bigint NOT NULL,
  PRIMARY KEY (chain_id, lock_id)
);

CREATE TABLE IF NOT EXISTS keeper_attempt (
  chain_id  integer NOT NULL,
  lock_id   numeric(78,0) NOT NULL,
  attempts  integer NOT NULL DEFAULT 0,
  last_error text,
  next_try_at bigint NOT NULL DEFAULT 0,
  dead      boolean NOT NULL DEFAULT false,
  PRIMARY KEY (chain_id, lock_id)
);

CREATE TABLE IF NOT EXISTS trove (
  chain_id    integer NOT NULL,
  owner       text NOT NULL,
  coll        numeric(78,0) NOT NULL,
  debt        numeric(78,0) NOT NULL,
  icr         numeric(78,0) NOT NULL,
  rank        integer NOT NULL,
  musd_ahead  numeric(78,0) NOT NULL,
  redeemable  boolean NOT NULL,
  updated_at  bigint NOT NULL,
  PRIMARY KEY (chain_id, owner)
);

CREATE TABLE IF NOT EXISTS subscription (
  id         serial PRIMARY KEY,
  address    text NOT NULL,
  channel    text NOT NULL CHECK (channel IN ('telegram','email')),
  target     text,               -- telegram chat id or email address
  verified   boolean NOT NULL DEFAULT false,
  code       text UNIQUE,        -- one-time link code / email token
  prefs      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at bigint NOT NULL,
  UNIQUE (address, channel)
);

CREATE TABLE IF NOT EXISTS alert_log (
  sub_id   integer NOT NULL REFERENCES subscription(id) ON DELETE CASCADE,
  key      text NOT NULL,       -- e.g. lock_t1d:31611:42  (idempotency key)
  kind     text NOT NULL,
  sent_at  bigint NOT NULL,
  PRIMARY KEY (sub_id, key)
);

CREATE TABLE IF NOT EXISTS stats_snapshot (
  chain_id integer NOT NULL,
  ts bigint NOT NULL,
  btc_at_risk numeric(78,0) NOT NULL,
  expired_count integer NOT NULL,
  locks integer NOT NULL,
  troves integer NOT NULL,
  price numeric(78,0),
  PRIMARY KEY (chain_id, ts)
);

CREATE TABLE IF NOT EXISTS cursor (
  name text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS siwe_nonce (
  nonce text PRIMARY KEY,
  created_at bigint NOT NULL
);
`;
