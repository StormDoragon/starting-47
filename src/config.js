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

  // Session / crypto
  session: {
    // A stable-but-random secret for the demo; set SESSION_SECRET in prod.
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    cookieName: 'meridian.sid',
    maxAgeMs: 1000 * 60 * 60 * 8, // 8 hours
  },

  db: {
    // libSQL URL. Locally this is an embedded SQLite file (`file:...`); on
    // Vercel/production point it at a hosted Turso/libSQL database
    // (`libsql://<db>.turso.io`) and set DB_AUTH_TOKEN.
    url:
      process.env.DB_URL ||
      `file:${process.env.DB_FILE || path.join(__dirname, '..', 'data', 'meridian.db')}`,
    authToken: process.env.DB_AUTH_TOKEN || undefined,
  },

  // Simulated performance engine
  engine: {
    // 'interval' — a long-running loop appends ticks (local/server hosting).
    // 'lazy' — ticks are generated on portfolio reads + a daily cron
    //          (serverless hosting, e.g. Vercel, where no loop can run).
    mode: process.env.ENGINE_MODE || (process.env.VERCEL ? 'lazy' : 'interval'),
    // How often the live engine appends a new tick to open positions.
    tickIntervalMs: Number(process.env.TICK_INTERVAL_MS) || 5000,
    // Days of history to backfill when a position is opened.
    backfillDays: Number(process.env.BACKFILL_DAYS) || 120,
    // How much faster simulated market time runs than wall-clock time. Live
    // ticks apply the fraction of a trading day that elapsed × this factor,
    // so values move visibly in a demo without compounding a full day's
    // return every few seconds.
    simSpeed: Number(process.env.SIM_SPEED) || 360,
    // Bearer token that authorises the /api/cron/tick endpoint (Vercel Cron
    // sends it as `Authorization: Bearer <CRON_SECRET>`).
    cronSecret: process.env.CRON_SECRET || null,
  },

  security: {
    bcryptRounds: 12,
  },
};

module.exports = config;
