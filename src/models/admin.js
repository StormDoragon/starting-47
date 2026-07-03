'use strict';

/**
 * Back-office aggregate queries for the admin dashboard. Everything here is
 * read-only reporting across the whole platform (all users), built from the
 * same tables the investor portal writes to. Position "current value" is always
 * the latest stored performance tick — never a hardcoded number — matching the
 * investor-facing portfolio service.
 *
 * All statements are parameterised prepared statements, so there is no
 * SQL-injection surface even though several accept free-text search input.
 */

const { db } = require('../db');

// A correlated sub-select that resolves a position's latest tick value, falling
// back to its principal if (somehow) no tick exists yet. Reused across queries.
const LATEST_VALUE = `
  COALESCE(
    (SELECT t.value_cents FROM performance_ticks t
      WHERE t.position_id = p.id ORDER BY t.ts DESC, t.id DESC LIMIT 1),
    p.principal_cents
  )`;

// ---- Headline counts ------------------------------------------------------

const q = {
  clientCount: db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 0'),
  adminCount: db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1'),
  usersSince: db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 0 AND created_at >= ?'),
  twofaCount: db.prepare('SELECT COUNT(*) AS n FROM users WHERE totp_enabled = 1'),
  cashTotal: db.prepare('SELECT COALESCE(SUM(cash_balance_cents), 0) AS c FROM users'),
  kycBreakdown: db.prepare(
    'SELECT kyc_status AS status, COUNT(*) AS n FROM users GROUP BY kyc_status',
  ),
  pendingKyc: db.prepare("SELECT COUNT(*) AS n FROM kyc_submissions WHERE status = 'pending'"),

  activePositions: db.prepare("SELECT COUNT(*) AS n FROM positions WHERE status = 'active'"),
  activeInvestors: db.prepare(
    "SELECT COUNT(DISTINCT user_id) AS n FROM positions WHERE status = 'active'",
  ),

  // Platform assets under management + invested principal (active positions).
  aum: db.prepare(`
    SELECT
      COALESCE(SUM(${LATEST_VALUE}), 0) AS value_cents,
      COALESCE(SUM(p.principal_cents), 0) AS principal_cents
    FROM positions p WHERE p.status = 'active'
  `),

  // Lifetime money-flow tallies from the transaction ledger.
  flowByType: db.prepare(`
    SELECT type, COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS total_cents
    FROM transactions GROUP BY type
  `),

  sessionCount: db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?'),
  failedLogins: db.prepare(
    "SELECT COUNT(*) AS n FROM audit_log WHERE event = 'login.failed' AND created_at >= ?",
  ),

  // ---- Per-pool investment breakdown --------------------------------------
  poolBreakdown: db.prepare(`
    SELECT
      pl.id AS pool_id, pl.name AS name, pl.accent AS accent,
      pl.risk_profile AS risk_profile,
      pl.target_low_pct AS target_low_pct, pl.target_high_pct AS target_high_pct,
      COUNT(p.id) AS positions,
      COUNT(DISTINCT p.user_id) AS investors,
      COALESCE(SUM(p.principal_cents), 0) AS principal_cents,
      COALESCE(SUM(${LATEST_VALUE}), 0) AS value_cents
    FROM pools pl
    LEFT JOIN positions p ON p.pool_id = pl.id AND p.status = 'active'
    GROUP BY pl.id
    ORDER BY pl.sort_order ASC
  `),

  // ---- Recent activity feeds ----------------------------------------------
  recentSignups: db.prepare(`
    SELECT id, email, display_name, kyc_status, created_at
    FROM users WHERE is_admin = 0 ORDER BY created_at DESC LIMIT ?
  `),
  recentTransactions: db.prepare(`
    SELECT t.id, t.type, t.amount_cents, t.status, t.meta, t.created_at,
           u.email AS user_email, u.display_name AS user_name, u.id AS user_id
    FROM transactions t JOIN users u ON u.id = t.user_id
    ORDER BY t.created_at DESC, t.id DESC LIMIT ?
  `),
  recentAudit: db.prepare(`
    SELECT a.id, a.event, a.detail, a.ip, a.user_agent, a.created_at,
           u.email AS user_email, u.id AS user_id
    FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.created_at DESC, a.id DESC LIMIT ?
  `),
};

// ---- Clients (search + pagination) ----------------------------------------

const clientList = db.prepare(`
  SELECT
    u.id, u.email, u.display_name, u.kyc_status, u.totp_enabled, u.is_admin,
    u.cash_balance_cents, u.created_at,
    (SELECT COUNT(*) FROM positions p WHERE p.user_id = u.id AND p.status = 'active')
      AS active_positions,
    (SELECT COALESCE(SUM(${LATEST_VALUE}), 0) FROM positions p
       WHERE p.user_id = u.id AND p.status = 'active') AS invested_value_cents,
    (SELECT COALESCE(SUM(amount_cents), 0) FROM transactions t
       WHERE t.user_id = u.id AND t.type = 'deposit') AS deposited_cents,
    (SELECT MAX(created_at) FROM audit_log a WHERE a.user_id = u.id) AS last_activity
  FROM users u
  WHERE u.is_admin = 0
    AND (@q = '' OR lower(u.email) LIKE @like OR lower(u.display_name) LIKE @like)
  ORDER BY u.created_at DESC
  LIMIT @limit OFFSET @offset
`);
const clientCountFiltered = db.prepare(`
  SELECT COUNT(*) AS n FROM users u
  WHERE u.is_admin = 0
    AND (@q = '' OR lower(u.email) LIKE @like OR lower(u.display_name) LIKE @like)
`);

function clients({ q: search = '', limit = 25, offset = 0 } = {}) {
  const s = String(search || '').toLowerCase().trim();
  const params = { q: s, like: `%${s}%`, limit, offset };
  return {
    rows: clientList.all(params),
    total: clientCountFiltered.get(params).n,
  };
}

// ---- Single client (deep view) --------------------------------------------

const positionsForUser = db.prepare(`
  SELECT p.*, pl.name AS pool_name, pl.accent AS accent,
         ${LATEST_VALUE} AS value_cents
  FROM positions p JOIN pools pl ON pl.id = p.pool_id
  WHERE p.user_id = ? ORDER BY p.created_at DESC
`);

function clientPositions(userId) {
  return positionsForUser.all(userId);
}

// ---- All positions (investments page, search + pagination) ----------------

const positionList = db.prepare(`
  SELECT p.id, p.principal_cents, p.deposited_at, p.lock_end_at, p.status,
         ${LATEST_VALUE} AS value_cents,
         pl.name AS pool_name, pl.accent AS accent,
         u.id AS user_id, u.email AS user_email, u.display_name AS user_name
  FROM positions p
  JOIN pools pl ON pl.id = p.pool_id
  JOIN users u ON u.id = p.user_id
  WHERE (@status = '' OR p.status = @status)
  ORDER BY p.created_at DESC
  LIMIT @limit OFFSET @offset
`);
const positionCount = db.prepare(`
  SELECT COUNT(*) AS n FROM positions p
  WHERE (@status = '' OR p.status = @status)
`);

function positions({ status = '', limit = 25, offset = 0 } = {}) {
  const s = ['active', 'withdrawn'].includes(status) ? status : '';
  const params = { status: s, limit, offset };
  return { rows: positionList.all(params), total: positionCount.get(params).n };
}

// ---- All transactions (ledger page, filter + pagination) ------------------

const txList = db.prepare(`
  SELECT t.id, t.type, t.amount_cents, t.status, t.meta, t.created_at,
         u.id AS user_id, u.email AS user_email, u.display_name AS user_name
  FROM transactions t JOIN users u ON u.id = t.user_id
  WHERE (@type = '' OR t.type = @type)
  ORDER BY t.created_at DESC, t.id DESC
  LIMIT @limit OFFSET @offset
`);
const txCount = db.prepare(`
  SELECT COUNT(*) AS n FROM transactions t
  WHERE (@type = '' OR t.type = @type)
`);

function transactions({ type = '', limit = 25, offset = 0 } = {}) {
  const t = ['deposit', 'withdrawal', 'withdrawal_request'].includes(type) ? type : '';
  const params = { type: t, limit, offset };
  const rows = txList.all(params).map((r) => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null }));
  return { rows, total: txCount.get(params).n };
}

// ---- Security feeds -------------------------------------------------------

const auditList = db.prepare(`
  SELECT a.id, a.event, a.detail, a.ip, a.user_agent, a.created_at,
         u.email AS user_email, u.id AS user_id
  FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
  WHERE (@event = '' OR a.event = @event)
  ORDER BY a.created_at DESC, a.id DESC
  LIMIT @limit OFFSET @offset
`);
const auditCount = db.prepare(`
  SELECT COUNT(*) AS n FROM audit_log a WHERE (@event = '' OR a.event = @event)
`);
const auditEvents = db.prepare(
  'SELECT DISTINCT event FROM audit_log ORDER BY event ASC',
);

function audit({ event = '', limit = 40, offset = 0 } = {}) {
  const params = { event: String(event || '').trim(), limit, offset };
  return {
    rows: auditList.all(params),
    total: auditCount.get(params).n,
    events: auditEvents.all().map((r) => r.event),
  };
}

const allSessions = db.prepare(`
  SELECT s.sid, s.ip, s.user_agent, s.created_at, s.last_seen, s.expires_at,
         u.id AS user_id, u.email AS user_email, u.display_name AS user_name,
         u.is_admin AS is_admin
  FROM sessions s LEFT JOIN users u ON u.id = s.user_id
  WHERE s.expires_at > ?
  ORDER BY s.last_seen DESC
  LIMIT ?
`);

function activeSessions(limit = 100) {
  return allSessions.all(Date.now(), limit);
}

// ---- Pending KYC review queue ---------------------------------------------

const pendingKycList = db.prepare(`
  SELECT k.*, u.email AS user_email, u.display_name AS user_name
  FROM kyc_submissions k JOIN users u ON u.id = k.user_id
  WHERE k.status = 'pending'
  ORDER BY k.created_at ASC
`);

function pendingKyc() {
  return pendingKycList.all();
}

// ---- Table row counts (system page) ---------------------------------------

function tableCounts() {
  const tables = [
    'users', 'kyc_submissions', 'pools', 'positions',
    'performance_ticks', 'transactions', 'sessions', 'audit_log',
  ];
  const out = {};
  for (const t of tables) {
    // Table names come from this fixed allow-list, never from user input.
    out[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  }
  return out;
}

// ---- Overview roll-up -----------------------------------------------------

function overview() {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const sevenDaysAgo = new Date(now - 7 * day).toISOString();
  const thirtyDaysAgo = new Date(now - 30 * day).toISOString();

  const aum = q.aum.get();
  const kyc = {};
  for (const row of q.kycBreakdown.all()) kyc[row.status] = row.n;

  const flow = { deposit: { n: 0, total_cents: 0 }, withdrawal: { n: 0, total_cents: 0 }, withdrawal_request: { n: 0, total_cents: 0 } };
  for (const row of q.flowByType.all()) flow[row.type] = { n: row.n, total_cents: row.total_cents };

  return {
    clients: q.clientCount.get().n,
    admins: q.adminCount.get().n,
    newClients7d: q.usersSince.get(sevenDaysAgo).n,
    newClients30d: q.usersSince.get(thirtyDaysAgo).n,
    twofaUsers: q.twofaCount.get().n,
    cashTotalCents: q.cashTotal.get().c,
    kyc,
    pendingKyc: q.pendingKyc.get().n,
    activePositions: q.activePositions.get().n,
    activeInvestors: q.activeInvestors.get().n,
    aumCents: aum.value_cents,
    principalCents: aum.principal_cents,
    gainCents: aum.value_cents - aum.principal_cents,
    gainPct: aum.principal_cents ? (aum.value_cents - aum.principal_cents) / aum.principal_cents : 0,
    flow,
    activeSessions: q.sessionCount.get(now).n,
    failedLogins7d: q.failedLogins.get(sevenDaysAgo).n,
    poolBreakdown: q.poolBreakdown.all(),
  };
}

function recentSignups(limit = 6) {
  return q.recentSignups.all(limit);
}
function recentTransactions(limit = 8) {
  return q.recentTransactions
    .all(limit)
    .map((r) => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null }));
}
function recentAudit(limit = 8) {
  return q.recentAudit.all(limit);
}

module.exports = {
  overview,
  clients,
  clientPositions,
  positions,
  transactions,
  audit,
  activeSessions,
  pendingKyc,
  tableCounts,
  recentSignups,
  recentTransactions,
  recentAudit,
};
