'use strict';

const path = require('path');
const crypto = require('crypto');

/**
 * Central configuration. Everything is overridable via environment variables
 * so the same build runs in a demo container and behind HTTPS in production.
 */
const isProd = process.env.NODE_ENV === 'production';

const config = {
  env: process.env.NODE_ENV || 'development',
  isProd,
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',

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
      path.join(__dirname, '..', 'data', 'meridian.db'),
  },

  // Simulated performance engine
  engine: {
    // How often the live engine appends a new tick to open positions.
    tickIntervalMs: Number(process.env.TICK_INTERVAL_MS) || 5000,
    // Days of history to backfill when a position is opened.
    backfillDays: Number(process.env.BACKFILL_DAYS) || 120,
  },

  security: {
    bcryptRounds: 12,
  },
};

module.exports = config;
