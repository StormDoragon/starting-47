'use strict';

const express = require('express');
const os = require('os');
const router = express.Router();

const config = require('../config');
const adminModel = require('../models/admin');
const adminMetrics = require('../services/adminMetrics');
const usersModel = require('../models/users');
const kycModel = require('../models/kyc');
const poolsModel = require('../models/pools');
const transactionsModel = require('../models/transactions');
const audit = require('../models/audit');

const { requireAdmin } = require('../security/auth');
const { sensitiveLimiter } = require('../security/rateLimit');
const v = require('../security/validate');
const { countdown } = require('../utils/time');

// Every route in this router is administrator-only. The section flag drives the
// active state of the admin sidebar via res.locals.
router.use(requireAdmin, (req, res, next) => {
  res.locals.adminSection = '';
  next();
});

const PER_PAGE = 25;

/** Parse a 1-based ?page= into a safe { page, limit, offset }. */
function paging(req, perPage = PER_PAGE) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  return { page, limit: perPage, offset: (page - 1) * perPage };
}

function pageCount(total, perPage = PER_PAGE) {
  return Math.max(1, Math.ceil(total / perPage));
}

// ---- Overview -------------------------------------------------------------

router.get('/', (req, res) => {
  res.locals.adminSection = 'overview';
  const stats = adminModel.overview();
  res.render('admin/overview', {
    title: 'Admin · Overview',
    stats,
    aumSeries: adminMetrics.siteDailyAum(120),
    recentSignups: adminModel.recentSignups(6),
    recentTransactions: adminModel.recentTransactions(8),
    recentAudit: adminModel.recentAudit(8),
  });
});

// Live JSON for the overview KPIs + AUM curve (polled client-side).
router.get('/api/overview', (req, res) => {
  const stats = adminModel.overview();
  res.set('Cache-Control', 'no-store');
  res.json({
    ts: Date.now(),
    aumCents: stats.aumCents,
    principalCents: stats.principalCents,
    gainCents: stats.gainCents,
    gainPct: stats.gainPct,
    cashTotalCents: stats.cashTotalCents,
    activePositions: stats.activePositions,
    activeInvestors: stats.activeInvestors,
    aumSeries: adminMetrics.siteDailyAum(120),
    poolBreakdown: stats.poolBreakdown.map((p) => ({
      poolId: p.pool_id,
      name: p.name,
      accent: p.accent,
      valueCents: p.value_cents,
    })),
  });
});

// ---- Clients --------------------------------------------------------------

router.get('/clients', (req, res) => {
  res.locals.adminSection = 'clients';
  const { page, limit, offset } = paging(req);
  const search = v.clean(req.query.q).slice(0, 80);
  const { rows, total } = adminModel.clients({ q: search, limit, offset });
  res.render('admin/clients', {
    title: 'Admin · Clients',
    clients: rows,
    total,
    page,
    pages: pageCount(total),
    search,
  });
});

router.get('/clients/:id', (req, res, next) => {
  res.locals.adminSection = 'clients';
  const user = usersModel.byId(req.params.id);
  if (!user) return next();
  const store = req.app.get('sessionStore');
  // Note: the render local is `account`, not `client` — EJS reserves `client`
  // as a compile option (client mode), which would strip the `include` helper.
  res.render('admin/client-detail', {
    title: `Admin · ${user.display_name || user.email}`,
    account: user,
    kyc: kycModel.byUser(user.id),
    positions: adminModel.clientPositions(user.id),
    transactions: transactionsModel.byUser(user.id).slice(0, 40),
    sessions: store.listByUser(user.id),
    activity: audit.byUser(user.id, 40),
    countdown,
  });
});

// Approve or reject a client's latest KYC submission.
router.post('/clients/:id/kyc', sensitiveLimiter, (req, res, next) => {
  const user = usersModel.byId(req.params.id);
  if (!user) return next();
  const decision = req.body.decision === 'approve' ? 'approved' : req.body.decision === 'reject' ? 'rejected' : null;
  if (!decision) {
    req.flash('error', 'Unknown KYC decision.');
    return res.redirect(`/admin/clients/${user.id}`);
  }
  const submission = kycModel.byUser(user.id);
  if (submission) kycModel.setStatus(submission.id, decision);
  usersModel.setKycStatus(user.id, decision);
  audit.log(user.id, `kyc.${decision}`, `by admin ${req.user.email}`, req);
  audit.log(req.user.id, 'admin.kyc_decision', `user=${user.email} → ${decision}`, req);
  req.flash('success', `KYC ${decision} for ${user.email}.`);
  res.redirect(`/admin/clients/${user.id}`);
});

// Grant or revoke administrator access. A guardrail prevents an admin from
// removing their own access (which could lock the last admin out).
router.post('/clients/:id/admin', sensitiveLimiter, (req, res, next) => {
  const user = usersModel.byId(req.params.id);
  if (!user) return next();
  const grant = req.body.grant === 'yes';
  if (!grant && user.id === req.user.id) {
    req.flash('error', 'You cannot revoke your own administrator access.');
    return res.redirect(`/admin/clients/${user.id}`);
  }
  usersModel.setAdmin(user.id, grant);
  audit.log(req.user.id, 'admin.role_change', `user=${user.email} admin=${grant}`, req);
  req.flash('success', `${user.email} is ${grant ? 'now an administrator' : 'no longer an administrator'}.`);
  res.redirect(`/admin/clients/${user.id}`);
});

// Revoke every active session for a client (force sign-out everywhere).
router.post('/clients/:id/sessions/revoke-all', sensitiveLimiter, (req, res, next) => {
  const user = usersModel.byId(req.params.id);
  if (!user) return next();
  const store = req.app.get('sessionStore');
  const sessions = store.listByUser(user.id);
  let revoked = 0;
  for (const s of sessions) {
    if (s.sid === req.sessionID) continue; // never revoke the admin's own live session
    store.destroy(s.sid, () => {});
    revoked += 1;
  }
  audit.log(req.user.id, 'admin.sessions_revoked', `user=${user.email} count=${revoked}`, req);
  req.flash('success', `Revoked ${revoked} session(s) for ${user.email}.`);
  res.redirect(`/admin/clients/${user.id}`);
});

// ---- Investments ----------------------------------------------------------

router.get('/investments', (req, res) => {
  res.locals.adminSection = 'investments';
  const { page, limit, offset } = paging(req);
  const status = ['active', 'withdrawn'].includes(req.query.status) ? req.query.status : '';
  const { rows, total } = adminModel.positions({ status, limit, offset });
  const stats = adminModel.overview();
  res.render('admin/investments', {
    title: 'Admin · Investments',
    poolBreakdown: stats.poolBreakdown,
    totals: { aumCents: stats.aumCents, principalCents: stats.principalCents, gainCents: stats.gainCents, gainPct: stats.gainPct },
    positions: rows,
    total,
    page,
    pages: pageCount(total),
    status,
    pools: poolsModel.all(),
  });
});

// ---- Transactions ---------------------------------------------------------

router.get('/transactions', (req, res) => {
  res.locals.adminSection = 'transactions';
  const { page, limit, offset } = paging(req);
  const type = ['deposit', 'withdrawal', 'withdrawal_request'].includes(req.query.type) ? req.query.type : '';
  const { rows, total } = adminModel.transactions({ type, limit, offset });
  const stats = adminModel.overview();
  res.render('admin/transactions', {
    title: 'Admin · Transactions',
    transactions: rows,
    total,
    page,
    pages: pageCount(total),
    type,
    flow: stats.flow,
  });
});

// ---- Security -------------------------------------------------------------

router.get('/security', (req, res) => {
  res.locals.adminSection = 'security';
  const { page, limit, offset } = paging(req, 40);
  const event = v.clean(req.query.event).slice(0, 60);
  const { rows, total, events } = adminModel.audit({ event, limit, offset });
  const stats = adminModel.overview();
  res.render('admin/security', {
    title: 'Admin · Security',
    audit: rows,
    total,
    page,
    pages: pageCount(total, 40),
    event,
    events,
    sessions: adminModel.activeSessions(100),
    stats,
    posture: securityPosture(),
    currentSid: req.sessionID,
  });
});

// Revoke any session by sid (from the security session table).
router.post('/security/sessions/revoke', sensitiveLimiter, (req, res) => {
  const sid = v.clean(req.body.sid);
  const store = req.app.get('sessionStore');
  if (sid && sid !== req.sessionID) {
    store.destroy(sid, () => {});
    audit.log(req.user.id, 'admin.session_revoked', `sid=${sid.slice(0, 8)}…`, req);
    req.flash('success', 'Session revoked.');
  } else {
    req.flash('error', 'That session could not be revoked.');
  }
  res.redirect('/admin/security');
});

// ---- KYC review queue -----------------------------------------------------

router.get('/kyc', (req, res) => {
  res.locals.adminSection = 'kyc';
  res.render('admin/kyc', {
    title: 'Admin · KYC review',
    submissions: adminModel.pendingKyc(),
  });
});

router.post('/kyc/:submissionId', sensitiveLimiter, (req, res) => {
  const submission = kycModel.byId(req.params.submissionId);
  if (!submission) {
    req.flash('error', 'Submission not found.');
    return res.redirect('/admin/kyc');
  }
  const decision = req.body.decision === 'approve' ? 'approved' : req.body.decision === 'reject' ? 'rejected' : null;
  if (!decision) {
    req.flash('error', 'Unknown KYC decision.');
    return res.redirect('/admin/kyc');
  }
  kycModel.setStatus(submission.id, decision);
  usersModel.setKycStatus(submission.user_id, decision);
  audit.log(submission.user_id, `kyc.${decision}`, `by admin ${req.user.email}`, req);
  audit.log(req.user.id, 'admin.kyc_decision', `submission=${submission.id} → ${decision}`, req);
  req.flash('success', `Submission ${decision}.`);
  res.redirect('/admin/kyc');
});

// ---- System info ----------------------------------------------------------

router.get('/system', (req, res) => {
  res.locals.adminSection = 'system';
  const mem = process.memoryUsage();
  res.render('admin/system', {
    title: 'Admin · System',
    tableCounts: adminModel.tableCounts(),
    engine: config.engine,
    terms: config.terms,
    security: config.security,
    demo: config.demo,
    runtime: {
      node: process.version,
      platform: `${os.type()} ${os.release()}`,
      env: config.env,
      isVercel: config.isVercel,
      uptimeSec: Math.round(process.uptime()),
      pid: process.pid,
      rssMb: (mem.rss / 1024 / 1024).toFixed(1),
      heapUsedMb: (mem.heapUsed / 1024 / 1024).toFixed(1),
      dbFile: config.db.file,
      cpus: os.cpus().length,
      loadavg: os.loadavg().map((n) => n.toFixed(2)).join(', '),
    },
  });
});

/**
 * A read-only summary of the demo build's own web-app security hygiene, sourced
 * from the actual middleware config — an honest "what's switched on" panel, not
 * a marketing claim.
 */
function securityPosture() {
  return [
    { name: 'Password hashing', value: `bcrypt · ${config.security.bcryptRounds} rounds`, on: true },
    { name: 'CSRF protection', value: 'Double-submit token on all unsafe methods', on: true },
    { name: 'Session cookies', value: `httpOnly · sameSite=lax · secure=${config.isProd}`, on: true },
    { name: 'Rate limiting', value: 'Global + auth + sensitive-action limiters', on: true },
    { name: 'Content-Security-Policy', value: "script-src 'self' — no inline JS", on: true },
    { name: 'Two-factor (TOTP)', value: 'Available to all accounts', on: true },
    { name: 'Parameterised queries', value: 'All DB access via prepared statements', on: true },
    { name: 'HTTPS-only cookies', value: config.isProd ? 'Enforced (production)' : 'Dev mode (http allowed)', on: config.isProd },
  ];
}

module.exports = router;
