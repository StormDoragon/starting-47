-- Meridian Capital — demo schema (SQLite)
-- All monetary values are stored in integer cents to avoid float drift.
-- This platform is a SIMULATION. No real funds are represented.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  display_name   TEXT,
  kyc_status     TEXT NOT NULL DEFAULT 'unverified'
                   CHECK (kyc_status IN ('unverified','pending','approved','rejected')),
  totp_secret    TEXT,                      -- base32; set when 2FA enabled
  totp_enabled   INTEGER NOT NULL DEFAULT 0,
  cash_balance_cents INTEGER NOT NULL DEFAULT 0, -- virtual cash from withdrawals

  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kyc_submissions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name    TEXT NOT NULL,
  dob          TEXT NOT NULL,
  country      TEXT NOT NULL,
  address      TEXT NOT NULL,
  id_doc_type  TEXT NOT NULL,
  id_doc_ref   TEXT NOT NULL,               -- filename reference only; nothing verified
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','rejected')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pools (
  id                TEXT PRIMARY KEY,
  slug              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  short_desc        TEXT NOT NULL,
  description       TEXT NOT NULL,
  risk_profile      TEXT NOT NULL,
  target_low_pct    REAL NOT NULL,          -- illustrative annual target range
  target_high_pct   REAL NOT NULL,
  accent            TEXT NOT NULL,          -- hex color for charts
  -- Volatility model parameters (per trading-day), used by the engine.
  drift_daily       REAL NOT NULL,          -- expected daily log-return
  vol_daily         REAL NOT NULL,          -- daily volatility (std dev)
  jump_prob         REAL NOT NULL DEFAULT 0,-- probability of an event jump
  jump_scale        REAL NOT NULL DEFAULT 0,-- magnitude of jumps
  sort_order        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS positions (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pool_id           TEXT NOT NULL REFERENCES pools(id),
  principal_cents   INTEGER NOT NULL,
  deposited_at      TEXT NOT NULL,
  lock_end_at       TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','withdrawn')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_id);

-- Generated time series that DRIVES the dashboard. Values are never hardcoded;
-- portfolio numbers are read from this table.
CREATE TABLE IF NOT EXISTS performance_ticks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id  TEXT NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  ts           TEXT NOT NULL,               -- ISO timestamp of the tick
  value_cents  INTEGER NOT NULL             -- position value at this tick
);

CREATE INDEX IF NOT EXISTS idx_ticks_position_ts
  ON performance_ticks(position_id, ts);

CREATE TABLE IF NOT EXISTS transactions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position_id   TEXT REFERENCES positions(id) ON DELETE SET NULL,
  type          TEXT NOT NULL
                  CHECK (type IN ('deposit','withdrawal_request','withdrawal')),
  amount_cents  INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'completed'
                  CHECK (status IN ('pending','completed','denied')),
  meta          TEXT,                        -- JSON blob (method, penalty, etc.)
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);

-- Persisted express-session rows (custom SQLite store).
CREATE TABLE IF NOT EXISTS sessions (
  sid        TEXT PRIMARY KEY,
  user_id    TEXT,
  data       TEXT NOT NULL,
  ip         TEXT,
  user_agent TEXT,
  expires_at INTEGER NOT NULL,               -- epoch ms
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  event       TEXT NOT NULL,
  detail      TEXT,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at);
