'use strict';

/**
 * Rich demo dataset for the admin dashboard. Creates the bootstrap administrator
 * plus a spread of sample clients with realistic, varied state — approved /
 * pending / rejected KYC, 2FA on some, positions across all four pools with
 * backfilled + caught-up performance history, deposits/withdrawals, a virtual
 * cash balance, and a scatter of security-audit events and active sessions.
 *
 * Everything routes through the same models the live app uses, so the seeded
 * data is indistinguishable from data produced by real usage. This is a
 * SIMULATION: no real funds or identities are involved.
 *
 *   npm run seed:demo     # populate (safe to re-run; skips if clients exist)
 *   npm run reset         # wipe the db, then `npm run seed:demo` for a fresh set
 */

const { db, migrate } = require('./index');
const { seedPools } = require('./seed');
const config = require('../config');
const usersModel = require('../models/users');
const kycModel = require('../models/kyc');
const positionsModel = require('../models/positions');
const transactionsModel = require('../models/transactions');
const audit = require('../models/audit');
const engine = require('../services/performanceEngine');
const { newId } = require('../utils/id');
const { addYears, iso } = require('../utils/time');

const DAY_MS = 24 * 60 * 60 * 1000;

// A minimal req-shaped object so audit.log() can record an IP + user-agent for
// seeded security events (it only reads req.ip and req.headers['user-agent']).
function fakeReq(ip, ua) {
  return { ip, headers: { 'user-agent': ua } };
}

const AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (X11; Linux x86_64) Firefox/126.0',
  'Mozilla/5.0 (iPad; CPU OS 17_4) Mobile/15E148 Safari/604.1',
];
const COUNTRIES = ['United Kingdom', 'United States', 'Germany', 'Singapore', 'Canada', 'Australia', 'United Arab Emirates', 'Japan'];

function pick(arr, i) {
  return arr[i % arr.length];
}

// The demo client roster. `alloc` is dollars per pool id; `daysAgo` sets both
// the signup date and the position deposit date (so lock countdowns vary).
const CLIENTS = [
  { name: 'Amara Okafor',    kyc: 'approved', totp: true,  daysAgo: 512, alloc: { pool_stocks: 8000, pool_it: 6000, pool_realestate: 4000 } },
  { name: 'Liang Wei',       kyc: 'approved', totp: false, daysAgo: 430, alloc: { pool_forex: 5200, pool_stocks: 3000 } },
  { name: 'Sofia Romano',    kyc: 'approved', totp: true,  daysAgo: 365, alloc: { pool_realestate: 12000, pool_stocks: 5000 } },
  { name: 'James Whitfield', kyc: 'approved', totp: false, daysAgo: 290, alloc: { pool_it: 9000, pool_forex: 4000 } },
  { name: 'Priya Nair',      kyc: 'approved', totp: true,  daysAgo: 210, alloc: { pool_stocks: 2000, pool_forex: 2000, pool_realestate: 2000, pool_it: 2000 }, withdrew: true },
  { name: 'Tomas Novak',     kyc: 'approved', totp: false, daysAgo: 140, alloc: { pool_forex: 3500 } },
  { name: 'Fatima Al-Sayed', kyc: 'approved', totp: false, daysAgo: 74,  alloc: { pool_realestate: 6000, pool_it: 3000 } },
  { name: 'Diego Fernandez', kyc: 'approved', totp: true,  daysAgo: 26,  alloc: { pool_stocks: 4200, pool_it: 4200 } },
  { name: 'Hannah Berg',     kyc: 'pending',  totp: false, daysAgo: 9,   alloc: {} },
  { name: 'Marcus Cole',     kyc: 'pending',  totp: false, daysAgo: 4,   alloc: {} },
  { name: 'Yuki Tanaka',     kyc: 'rejected', totp: false, daysAgo: 18,  alloc: {} },
  { name: 'Olivia Grant',    kyc: 'unverified', totp: false, daysAgo: 2, alloc: {} },
];

const setCreatedAt = db.prepare("UPDATE users SET created_at = ?, updated_at = ? WHERE id = ?");
const insertSession = db.prepare(`
  INSERT INTO sessions (sid, user_id, data, ip, user_agent, expires_at, created_at, last_seen)
  VALUES (@sid, @user_id, @data, @ip, @user_agent, @expires_at, @created_at, @last_seen)
`);

function emailFor(name) {
  return name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '') + '@example.com';
}

/** Create the bootstrap admin account if it doesn't exist. */
function ensureAdmin() {
  let admin = usersModel.byEmail(config.admin.email);
  if (!admin) {
    admin = usersModel.create({
      email: config.admin.email,
      password: config.admin.password,
      displayName: 'Platform Admin',
    });
    audit.log(admin.id, 'account.created', 'seeded admin', fakeReq('127.0.0.1', pick(AGENTS, 0)));
  }
  usersModel.setAdmin(admin.id, true);
  usersModel.setKycStatus(admin.id, 'approved');
  return admin;
}

function seedClient(spec, idx) {
  const email = emailFor(spec.name);
  if (usersModel.byEmail(email)) return; // already seeded

  const signupIso = iso(new Date(Date.now() - spec.daysAgo * DAY_MS));
  const user = usersModel.create({
    email,
    password: 'Client-Demo-2026!',
    displayName: spec.name,
  });
  setCreatedAt.run(signupIso, signupIso, user.id);
  usersModel.setKycStatus(user.id, spec.kyc);

  // KYC submission (for approved/pending/rejected — unverified never submitted).
  if (spec.kyc !== 'unverified') {
    kycModel.create({
      user_id: user.id,
      full_name: spec.name,
      dob: `19${70 + (idx % 25)}-0${1 + (idx % 8)}-1${idx % 9}`,
      country: pick(COUNTRIES, idx),
      address: `${100 + idx} Demo Street`,
      id_doc_type: pick(['Passport', 'National ID', "Driver's licence"], idx),
      id_doc_ref: 'demo-document.jpg',
      status: spec.kyc,
    });
    audit.log(user.id, 'kyc.submitted', spec.kyc, fakeReq(`203.0.113.${10 + idx}`, pick(AGENTS, idx)));
  }

  if (spec.totp) {
    // A stable demo secret; enables the "2FA on" state without a real enrolment.
    usersModel.setTotp(user.id, { secret: 'JBSWY3DPEHPK3PXP', enabled: true });
    audit.log(user.id, '2fa.enabled', null, fakeReq(`203.0.113.${10 + idx}`, pick(AGENTS, idx)));
  }

  // Positions across the requested pools, deposited on the signup date.
  const depositedAt = new Date(Date.now() - spec.daysAgo * DAY_MS);
  const lockEnd = addYears(depositedAt, config.terms.lockYears);
  const posIds = [];
  for (const [poolId, dollars] of Object.entries(spec.alloc)) {
    const pos = positionsModel.create({
      userId: user.id,
      poolId,
      principalCents: Math.round(dollars * 100),
      depositedAt: iso(depositedAt),
      lockEndAt: iso(lockEnd),
    });
    engine.backfillPosition(pos);
    transactionsModel.create({
      userId: user.id,
      positionId: pos.id,
      type: 'deposit',
      amountCents: Math.round(dollars * 100),
      status: 'completed',
      meta: { method: pick(['card', 'bank', 'crypto'], idx), pool: poolId },
    });
    posIds.push(pos.id);
  }

  // One client demonstrates an early withdrawal → virtual cash balance.
  if (spec.withdrew && posIds.length) {
    const posId = posIds[0];
    const latest = require('../models/ticks').latest(posId);
    const value = latest ? latest.value_cents : 200000;
    const penalty = Math.round(value * 0.12);
    positionsModel.markWithdrawn(posId);
    usersModel.creditCash(user.id, value - penalty);
    transactionsModel.create({
      userId: user.id,
      positionId: posId,
      type: 'withdrawal_request',
      amountCents: value - penalty,
      status: 'completed',
      meta: { early: true, penaltyPct: 0.12, penaltyCents: penalty, grossCents: value },
    });
    audit.log(user.id, 'withdrawal.early_request', `position=${posId} penalty=12%`, fakeReq(`203.0.113.${10 + idx}`, pick(AGENTS, idx)));
  }

  // A few login events (success + the occasional failure) for the security log.
  const ip = `203.0.113.${10 + idx}`;
  const ua = pick(AGENTS, idx);
  audit.log(user.id, 'login.success', null, fakeReq(ip, ua));
  if (idx % 3 === 0) audit.log(null, 'login.failed', `email=${email}`, fakeReq(`198.51.100.${idx}`, pick(AGENTS, idx + 2)));
  if (idx % 4 === 0) audit.log(user.id, 'password.changed', null, fakeReq(ip, ua));

  // An active session row so the admin session list has live entries.
  if (spec.kyc === 'approved' && idx % 2 === 0) {
    insertSession.run({
      sid: newId('sess'),
      user_id: user.id,
      data: JSON.stringify({ user: { id: user.id } }),
      ip,
      user_agent: ua,
      expires_at: Date.now() + 6 * 60 * 60 * 1000,
      created_at: iso(new Date(Date.now() - (idx % 5) * 3600 * 1000)),
      last_seen: iso(new Date(Date.now() - (idx % 3) * 600 * 1000)),
    });
  }
}

/** Idempotent seed: ensures the admin exists and populates clients if absent. */
function ensureSeeded() {
  migrate();
  seedPools();
  ensureAdmin();

  const clientCount = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 0').get().n;
  if (clientCount > 0) return false; // already have clients — don't duplicate

  const tx = db.transaction(() => {
    CLIENTS.forEach((spec, i) => seedClient(spec, i));
  });
  tx();

  // Fill each historical position forward to today so the dashboard shows
  // realistic accrued gains/losses immediately, not flat principal.
  try {
    engine.catchUpAll();
  } catch (err) {
    console.error('catch-up during seed failed:', err.message);
  }
  return true;
}

function run() {
  const seeded = ensureSeeded();
  const clients = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 0').get().n;
  if (seeded) {
    console.log(`Seeded ${CLIENTS.length} demo clients + admin (${config.admin.email}).`);
  } else {
    console.log(`Demo data already present (${clients} clients). Run "npm run reset" for a fresh set.`);
  }
  console.log(`Admin login → ${config.admin.email} / ${config.admin.password}`);
}

if (require.main === module) run();

module.exports = { ensureSeeded, ensureAdmin, run };
