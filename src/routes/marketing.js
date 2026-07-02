'use strict';

const express = require('express');
const router = express.Router();

const poolsModel = require('../models/pools');
const engine = require('../services/performanceEngine');
const config = require('../config');

/** Build a compact chart payload for a pool's simulated index history. */
function poolChart(pool, days = 180) {
  const series = engine.syntheticPoolSeries(pool, days);
  return {
    slug: pool.slug,
    accent: pool.accent,
    points: series.map((p) => p.v),
  };
}

router.get('/', (req, res) => {
  const pools = poolsModel.all();
  // Snapshot performance for the homepage "performance snapshot" chart.
  const snapshot = pools.map((p) => poolChart(p, 180));
  res.render('marketing/home', {
    title: `${config.brand.name} — ${config.brand.tagline}`,
    pools,
    snapshot,
  });
});

router.get('/how-it-works', (req, res) => {
  res.render('marketing/how-it-works', {
    title: 'How it works',
    pools: poolsModel.all(),
  });
});

router.get('/pools', (req, res) => {
  const pools = poolsModel.all();
  res.render('marketing/pools', {
    title: 'Investment pools',
    pools,
    charts: pools.map((p) => poolChart(p, 180)),
  });
});

router.get('/pools/:slug', (req, res, next) => {
  const pool = poolsModel.bySlug(req.params.slug);
  if (!pool) return next();
  res.render('marketing/pool-detail', {
    title: `${pool.name} pool`,
    pool,
    chart: poolChart(pool, 365),
  });
});

router.get('/security', (req, res) => {
  res.render('marketing/security', { title: 'Security & trust' });
});

router.get('/pricing', (req, res) => {
  res.render('marketing/pricing', { title: 'Pricing & terms' });
});

router.get('/about', (req, res) => {
  res.render('marketing/about', { title: 'About, legal & contact' });
});

module.exports = router;
