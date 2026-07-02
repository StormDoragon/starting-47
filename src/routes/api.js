'use strict';

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../security/auth');
const portfolio = require('../services/portfolio');
const poolsModel = require('../models/pools');
const engine = require('../services/performanceEngine');

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
router.get('/pools/:slug/series', (req, res) => {
  const pool = poolsModel.bySlug(req.params.slug);
  if (!pool) return res.status(404).json({ error: 'Not found' });
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 180, 30), 365);
  res.json({ slug: pool.slug, accent: pool.accent, series: engine.syntheticPoolSeries(pool, days) });
});

// Authenticated: the live portfolio snapshot that drives the dashboard.
router.get('/portfolio', requireAuth, (req, res) => {
  const snap = portfolio.snapshot(req.user.id);
  const combined = portfolio.combinedDailySeries(req.user.id);
  const perPool = portfolio.poolDailySeries(req.user.id);
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
});

module.exports = router;
