'use strict';

/**
 * Simulated performance engine.
 *
 * Every pool has its own drift/volatility (and, for IT & Ventures, occasional
 * upward jumps). The engine drives ALL dashboard numbers from a stored
 * time-series — values are never hardcoded.
 *
 *  - backfillPosition(): on deposit, seeds a simulated daily track ending at the
 *    principal at the moment of deposit, so charts are rich immediately.
 *  - start(): a live loop that appends one fresh tick per active position on an
 *    interval (long-running hosts).
 *  - refreshUserPositions(): serverless-friendly "lazy" ticking — catch up any
 *    missed days and append a fresh tick when the portfolio is read.
 */

const config = require('../config');
const { DAY_MS } = require('../utils/time');
const { gaussian, mulberry32, seedFromString } = require('./random');
const positionsModel = require('../models/positions');
const ticksModel = require('../models/ticks');
const poolsModel = require('../models/pools');

/**
 * One geometric-Brownian-motion step (with optional jump) as a multiplier.
 * `dayFraction` scales the step to a fraction of a trading day: drift scales
 * linearly, volatility with √t, and the jump hazard linearly.
 */
function stepMultiplier(pool, rng = Math.random, dayFraction = 1) {
  let logRet =
    pool.drift_daily * dayFraction + pool.vol_daily * Math.sqrt(dayFraction) * gaussian(rng);
  if (pool.jump_prob > 0 && rng() < pool.jump_prob * dayFraction) {
    // Mostly-upward event jumps for the growth pool.
    logRet += pool.jump_scale * (0.5 + rng());
  }
  return Math.exp(logRet);
}

/**
 * Build a simulated daily series for a freshly-opened position. The final point
 * lands exactly on the deposited principal at `deposited_at`; earlier points are
 * the simulated track leading into it. Live ticks then extend it forward.
 */
async function backfillPosition(position) {
  const pool = await poolsModel.byId(position.pool_id);
  const days = config.engine.backfillDays;
  const depositedMs = new Date(position.deposited_at).getTime();

  // Generate relative multipliers forward, then normalise so the last == 1.
  const mult = [1];
  for (let i = 1; i <= days; i++) {
    mult.push(mult[i - 1] * stepMultiplier(pool));
  }
  const last = mult[days];

  const rows = [];
  for (let i = 0; i <= days; i++) {
    const ts = new Date(depositedMs - (days - i) * DAY_MS).toISOString();
    const value = Math.round(position.principal_cents * (mult[i] / last));
    rows.push({ positionId: position.id, ts, valueCents: Math.max(1, value) });
  }
  await ticksModel.addMany(rows);
  return rows.length;
}

/**
 * Append a single fresh live tick to a position, based on its latest value.
 * The step covers the simulated time that elapsed since the last tick
 * (wall-clock elapsed × simSpeed), capped at one trading day — longer gaps
 * are the catch-up job's business.
 */
async function tickPosition(position, now = Date.now()) {
  const pool = await poolsModel.byId(position.pool_id);
  const latest = await ticksModel.latest(position.id);
  const base = latest ? latest.value_cents : position.principal_cents;
  const elapsedMs = latest ? Math.max(0, now - new Date(latest.ts).getTime()) : 0;
  const dayFraction = Math.min(1, (elapsedMs * config.engine.simSpeed) / DAY_MS) || 1 / 86400;
  const next = Math.max(1, Math.round(base * stepMultiplier(pool, Math.random, dayFraction)));
  await ticksModel.add(position.id, new Date(now).toISOString(), next);
  return next;
}

async function tickAll() {
  const active = await positionsModel.allActive();
  for (const p of active) await tickPosition(p);
  return active.length;
}

/**
 * Fill the gap between a position's last stored tick and now with daily ticks,
 * so charts have no flat holes after the server (or serverless function) has
 * been idle for a while.
 */
async function catchUpPosition(position, now = Date.now()) {
  const pool = await poolsModel.byId(position.pool_id);
  const latest = await ticksModel.latest(position.id);
  if (!latest) return 0;
  let ts = new Date(latest.ts).getTime();
  let value = latest.value_cents;
  const rows = [];
  while (now - ts > DAY_MS) {
    ts += DAY_MS;
    value = Math.max(1, Math.round(value * stepMultiplier(pool)));
    rows.push({ positionId: position.id, ts: new Date(ts).toISOString(), valueCents: value });
  }
  if (rows.length) await ticksModel.addMany(rows);
  return rows.length;
}

async function catchUpAll() {
  const active = await positionsModel.allActive();
  let added = 0;
  for (const p of active) added += await catchUpPosition(p);
  return added;
}

/**
 * Lazy mode (serverless): bring one user's positions up to date on read.
 * Catches up any missed full days, then appends a fresh live tick when the
 * last one is at least a tick interval old. Returns the number of ticks added.
 */
async function refreshUserPositions(userId, now = Date.now()) {
  const positions = await positionsModel.activeByUser(userId);
  let added = 0;
  for (const pos of positions) {
    added += await catchUpPosition(pos, now);
    const latest = await ticksModel.latest(pos.id);
    if (!latest || now - new Date(latest.ts).getTime() >= config.engine.tickIntervalMs) {
      await tickPosition(pos, now);
      added += 1;
    }
  }
  return added;
}

let timer = null;
function start() {
  if (timer) return;
  catchUpAll()
    .then((added) => {
      if (added > 0) console.log(`performance engine: backfilled ${added} missed daily tick(s)`);
    })
    .catch((err) => console.error('performance engine catch-up failed:', err.message));
  timer = setInterval(() => {
    tickAll().catch((err) => {
      // Never let a bad tick crash the process.
      console.error('performance engine tick failed:', err.message);
    });
  }, config.engine.tickIntervalMs);
  if (timer.unref) timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * A stable, seeded simulated index series for MARKETING pages (so the pool
 * charts don't reshuffle on every reload). Returns an array of {t, v} where v
 * is an index normalised to start at 100. Pure math — no database access.
 */
function syntheticPoolSeries(pool, days = 180, seedSalt = '') {
  const rng = mulberry32(seedFromString(pool.slug + seedSalt));
  const out = [];
  let v = 100;
  const now = Date.now();
  for (let i = days; i >= 0; i--) {
    let logRet = pool.drift_daily + pool.vol_daily * gaussian(rng);
    if (pool.jump_prob > 0 && rng() < pool.jump_prob) {
      logRet += pool.jump_scale * (0.5 + rng());
    }
    v *= Math.exp(logRet);
    out.push({ t: new Date(now - i * DAY_MS).toISOString(), v: Number(v.toFixed(3)) });
  }
  return out;
}

module.exports = {
  stepMultiplier,
  backfillPosition,
  tickPosition,
  tickAll,
  catchUpPosition,
  catchUpAll,
  refreshUserPositions,
  start,
  stop,
  syntheticPoolSeries,
};
