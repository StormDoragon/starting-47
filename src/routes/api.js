'use strict';

const express = require('express');
const router = express.Router();

const config = require('../config');
const { requireAuth } = require('../security/auth');
const portfolio = require('../services/portfolio');
const poolsModel = require('../models/pools');
const engine = require('../services/performanceEngine');
const ah = require('../utils/asyncHandler');

// Public: mock live FX/index ticker for the marketing hero.
router.get('/ticker', (req, res) => {
  const symbols = [
    { sym: 'EUR/USD', base: 1.0842 },
    { sym: 'GBP/USD', base: 1.2718 },
    { sym: 'USD/JPY', base: 156.32 },
    { sym: 'AUD/USD', base: 0.6631 },
    { sym: 'BTC/USD', base: 64120 },
    { sym: 'S&P 500', base: 5490.2 },
    { sym: 'GOLD', base: 2338.4 },
    { sym: 'USD/CHF', base: 0.8975 },
  ];
  const rates = symbols.map((s) => {
    const drift = (Math.random() - 0.5) * 0.004;
    const price = s.base * (1 + drift);
    return {
      sym: s.sym,
      price: price >= 100 ? price.toFixed(2) : price.toFixed(4),
      changePct: (drift * 100).toFixed(2),
      up: drift >= 0,
    };
  });
  res.set('Cache-Control', 'no-store');
  res.json({ rates, ts: Date.now() });
});

// Public: a pool's simulated index series (for marketing detail pages, if needed).
router.get(
  '/pools/:slug/series',
  ah(async (req, res) => {
    const pool = await poolsModel.bySlug(req.params.slug);
    if (!pool) return res.status(404).json({ error: 'Not found' });
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 180, 30), 365);
    res.json({ slug: pool.slug, accent: pool.accent, series: engine.syntheticPoolSeries(pool, days) });
  }),
);

// Authenticated: the live portfolio snapshot that drives the dashboard.
router.get(
  '/portfolio',
  requireAuth,
  ah(async (req, res) => {
    // In lazy (serverless) mode this poll IS the tick source: catch up any
    // missed days and append a fresh time-scaled tick before reading.
    if (config.engine.mode === 'lazy') {
      await engine.refreshUserPositions(req.user.id);
    }
    const snap = await portfolio.snapshot(req.user.id);
    const combined = await portfolio.combinedDailySeries(req.user.id);
    const perPool = await portfolio.poolDailySeries(req.user.id);
    res.set('Cache-Control', 'no-store');
    res.json({
      ts: Date.now(),
      cashBalanceCents: req.user.cashBalanceCents,
      totalValueCents: snap.totalValueCents,
      totalPrincipalCents: snap.totalPrincipalCents,
      totalGainCents: snap.totalGainCents,
      totalGainPct: snap.totalGainPct,
      allocation: snap.allocation,
      positions: snap.positions.map((p) => ({
        id: p.id,
        pool: p.pool.name,
        accent: p.pool.accent,
        valueCents: p.valueCents,
        principalCents: p.principalCents,
        gainCents: p.gainCents,
        gainPct: p.gainPct,
      })),
      combined,
      perPool: Object.values(perPool).map((e) => ({
        poolId: e.pool.id,
        name: e.pool.name,
        accent: e.pool.accent,
        series: e.series,
      })),
    });
  }),
);

// Scheduled catch-up (Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`).
// Fills missed daily ticks for every active position, so idle accounts stay
// current even if their owners never open the dashboard.
router.get(
  '/cron/tick',
  ah(async (req, res) => {
    const auth = req.get('authorization') || '';
    if (!config.engine.cronSecret || auth !== `Bearer ${config.engine.cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const caughtUp = await engine.catchUpAll();
    const ticked = await engine.tickAll();
    res.json({ ok: true, caughtUp, positionsTicked: ticked, ts: Date.now() });
  }),
);

module.exports = router;
