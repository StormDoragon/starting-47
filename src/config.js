'use strict';

const path = require('path');
const crypto = require('crypto');

/**
 * Central configuration. Everything is overridable via environment variables
 * so the same build runs in a demo container and behind HTTPS in production.
 */
const isProd = process.env.NODE_ENV === 'production';

if (isProd && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required in production.');
}

function positiveNumber(name, defaultValue, { integer = false, min = 1 } = {}) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;

  const value = Number(raw);
  const valid = Number.isFinite(value) && value >= min && (!integer || Number.isInteger(value));
  if (!valid) {
    throw new Error(`${name} must be ${integer ? 'an integer' : 'a number'} greater than or equal to ${min}.`);
  }
  return value;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  isProd,
  port: positiveNumber('PORT', 3000, { integer: true }),
  host: process.env.HOST || '0.0.0.0',
  trustProxy: isProd ? positiveNumber('TRUST_PROXY_HOPS', 1, { integer: true, min: 0 }) : false,

  // Brand
  brand: {
    name: process.env.BRAND_NAME || 'Meridian Capital',
    tagline: 'Global markets, one disciplined portfolio.',
    // The single required legal line, shown on every page.
    disclaimer:
      'Demo platform for portfolio purposes. Not a real investment offering. No real funds are processed.',
  },

  // Product terms (mock)
  terms: {
    minDeposit: 1200, // USD
    maxDeposit: 1000000, // USD per pool, per deposit (demo guardrail)
    lockYears: 3,
    currency: 'USD',
    // Early-withdrawal penalty schedule by completed years held.
    penaltySchedule: [
      { beforeYear: 1, penaltyPct: 0.2, label: 'Year 1' },
      { beforeYear: 2, penaltyPct: 0.12, label: 'Year 2' },
      { beforeYear: 3, penaltyPct: 0.06, label: 'Year 3' },
    ],
    managementFeePct: 0.015, // 1.5% annual (illustrative)
  },

  demo: {
    autoApproveKyc:
      process.env.DEMO_AUTO_APPROVE_KYC == null
        ? !isProd
        : process.env.DEMO_AUTO_APPROVE_KYC === 'true',
  },

  // Session / crypto
  session: {
    // A stable-but-random secret for the demo; set SESSION_SECRET in prod.
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    cookieName: 'meridian.sid',
    maxAgeMs: 1000 * 60 * 60 * 8, // 8 hours
  },

  db: {
    file:
      process.env.DB_FILE ||
      (isProd ? '/tmp/meridian.db' : path.join(__dirname, '..', 'data', 'meridian.db')),
  },

  // Simulated performance engine
  engine: {
    // How often the live engine appends a new tick to open positions.
    tickIntervalMs: positiveNumber('TICK_INTERVAL_MS', 5000, { integer: true }),
    // Days of history to backfill when a position is opened.
    backfillDays: positiveNumber('BACKFILL_DAYS', 120, { integer: true }),
    // How much faster simulated market time runs than wall-clock time. Live
    // ticks apply the fraction of a trading day that elapsed × this factor,
    // so values move visibly in a demo without compounding a full day's
    // return every few seconds.
    simSpeed: positiveNumber('SIM_SPEED', 360),
  },

  security: {
    bcryptRounds: 12,
  },
};

module.exports = config;
