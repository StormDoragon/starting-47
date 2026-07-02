'use strict';

/* Unit tests for the pure logic: money, time, validation, RNG and the
   simulated performance engine's math. Uses a throwaway database file so
   nothing touches a developer's data. */

process.env.DB_FILE = require('path').join(
  require('os').tmpdir(),
  `meridian-test-unit-${process.pid}.db`,
);

const test = require('node:test');
const assert = require('node:assert/strict');

const money = require('../src/utils/money');
const timeUtil = require('../src/utils/time');
const v = require('../src/security/validate');
const { mulberry32, seedFromString, gaussian } = require('../src/services/random');

test('money: cents round-trip and formatting', () => {
  assert.equal(money.toCents('12.34'), 1234);
  assert.equal(money.fromCents(1234), 12.34);
  assert.equal(money.formatCents(123456), '$1,234.56');
  assert.equal(money.formatCents0(120000), '$1,200');
  assert.equal(money.formatPct(0.1234), '+12.34%');
  assert.equal(money.formatPct(-0.05, 1), '-5.0%');
});

test('validate: parseMoney accepts dollars, rejects junk', () => {
  assert.equal(v.parseMoney('1,200'), 120000);
  assert.equal(v.parseMoney('$99.99'), 9999);
  assert.equal(v.parseMoney('12.345'), null); // 3 decimal places
  assert.equal(v.parseMoney('abc'), null);
  assert.equal(v.parseMoney('-5'), null);
  assert.equal(v.parseMoney('0'), null); // zero is not a positive amount
});

test('validate: email and password policy', () => {
  assert.equal(v.isEmail('user@example.com'), true);
  assert.equal(v.isEmail('not-an-email'), false);
  assert.equal(v.passwordError('short'), 'Password must be at least 10 characters.');
  assert.equal(v.passwordError('alllowercaseonly') !== null, true);
  assert.equal(v.passwordError('Str0ng-Passw0rd!'), null);
});

test('time: addYears and completedYears around anniversaries', () => {
  const from = new Date('2024-06-15T00:00:00Z');
  assert.equal(timeUtil.addYears(from, 3).getUTCFullYear(), 2027);
  assert.equal(timeUtil.completedYears(from, new Date('2025-06-14T00:00:00Z')), 0);
  assert.equal(timeUtil.completedYears(from, new Date('2025-06-16T00:00:00Z')), 1);
  assert.equal(timeUtil.completedYears(from, new Date('2027-01-01T00:00:00Z')), 2);
});

test('time: countdown reports past for elapsed dates', () => {
  const past = timeUtil.countdown(new Date(Date.now() - timeUtil.DAY_MS * 3));
  assert.equal(past.past, true);
  const future = timeUtil.countdown(new Date(Date.now() + timeUtil.DAY_MS * 400));
  assert.equal(future.past, false);
  assert.equal(future.years, 1);
});

test('random: mulberry32 is deterministic and uniform-ish', () => {
  const a = mulberry32(seedFromString('forex'));
  const b = mulberry32(seedFromString('forex'));
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  seqA.forEach((x) => assert.ok(x >= 0 && x < 1));
});

test('random: gaussian has roughly zero mean and unit variance', () => {
  const rng = mulberry32(42);
  const n = 20000;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const g = gaussian(rng);
    sum += g;
    sumSq += g * g;
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  assert.ok(Math.abs(mean) < 0.05, `mean ${mean}`);
  assert.ok(Math.abs(variance - 1) < 0.1, `variance ${variance}`);
});

// ---- Engine + portfolio math (needs the temp database) ---------------------

const { db } = require('../src/db');
const { seedPools } = require('../src/db/seed');
const engine = require('../src/services/performanceEngine');
const portfolio = require('../src/services/portfolio');
const usersModel = require('../src/models/users');
const positionsModel = require('../src/models/positions');
const ticksModel = require('../src/models/ticks');
const poolsModel = require('../src/models/pools');
const config = require('../src/config');

test('engine: backfill ends exactly on the principal', () => {
  seedPools();
  const user = usersModel.create({
    email: 'unit@example.com',
    password: 'Str0ng-Passw0rd!',
    displayName: 'Unit',
  });
  const now = new Date();
  const pos = positionsModel.create({
    userId: user.id,
    poolId: 'pool_forex',
    principalCents: 250000,
    depositedAt: now.toISOString(),
    lockEndAt: timeUtil.addYears(now, 3).toISOString(),
  });
  const rows = engine.backfillPosition(pos);
  assert.equal(rows, config.engine.backfillDays + 1);
  const latest = ticksModel.latest(pos.id);
  assert.equal(latest.value_cents, 250000);
  const series = ticksModel.series(pos.id);
  assert.equal(series.length, config.engine.backfillDays + 1);
  series.forEach((t) => assert.ok(t.value_cents > 0));
});

test('engine: tick appends a positive value based on the last tick', () => {
  const pos = positionsModel.allActive()[0];
  const before = ticksModel.series(pos.id).length;
  const next = engine.tickPosition(pos);
  assert.ok(next > 0);
  assert.equal(ticksModel.series(pos.id).length, before + 1);
});

test('engine: catch-up fills daily gaps after downtime', () => {
  const pos = positionsModel.allActive()[0];
  // Simulate 5 days of downtime by shifting the whole series into the past.
  const shift = db.prepare('UPDATE performance_ticks SET ts = ? WHERE id = ?');
  const move = db.transaction(() => {
    for (const t of db
      .prepare('SELECT id, ts FROM performance_ticks WHERE position_id = ?')
      .all(pos.id)) {
      shift.run(new Date(new Date(t.ts).getTime() - 5 * timeUtil.DAY_MS).toISOString(), t.id);
    }
  });
  move();
  const added = engine.catchUpPosition(positionsModel.byId(pos.id));
  assert.ok(added >= 4 && added <= 5, `added ${added}`);
  const fresh = ticksModel.latest(pos.id);
  assert.ok(Date.now() - new Date(fresh.ts).getTime() <= timeUtil.DAY_MS);
});

test('portfolio: snapshot totals come from the tick series', () => {
  const user = usersModel.byEmail('unit@example.com');
  const snap = portfolio.snapshot(user.id);
  assert.equal(snap.hasPositions, true);
  assert.equal(snap.totalPrincipalCents, 250000);
  const latest = ticksModel.latest(snap.positions[0].id);
  assert.equal(snap.totalValueCents, latest.value_cents);
  assert.equal(snap.allocation.length, 1);
  assert.equal(snap.allocation[0].weight, 1);
});

test('portfolio: early withdrawal preview applies the year-1 penalty', () => {
  const user = usersModel.byEmail('unit@example.com');
  const pos = positionsModel.activeByUser(user.id)[0];
  const preview = portfolio.earlyWithdrawalPreview(pos);
  assert.equal(preview.mature, false);
  assert.equal(preview.penaltyPct, config.terms.penaltySchedule[0].penaltyPct);
  assert.equal(preview.penaltyCents, Math.round(preview.valueCents * preview.penaltyPct));
  assert.equal(preview.netCents, preview.valueCents - preview.penaltyCents);
});

test('portfolio: matured positions carry no penalty', () => {
  const user = usersModel.byEmail('unit@example.com');
  const now = new Date();
  const pos = positionsModel.create({
    userId: user.id,
    poolId: 'pool_stocks',
    principalCents: 100000,
    depositedAt: new Date(now.getTime() - 4 * 365.25 * timeUtil.DAY_MS).toISOString(),
    lockEndAt: new Date(now.getTime() - 365.25 * timeUtil.DAY_MS).toISOString(),
  });
  engine.backfillPosition(pos);
  const preview = portfolio.earlyWithdrawalPreview(pos);
  assert.equal(preview.mature, true);
  assert.equal(preview.penaltyCents, 0);
  assert.equal(preview.netCents, preview.valueCents);
});

test('users: cash balance credits accumulate', () => {
  const user = usersModel.byEmail('unit@example.com');
  const before = usersModel.byId(user.id).cash_balance_cents;
  usersModel.creditCash(user.id, 12345);
  usersModel.creditCash(user.id, 55);
  assert.equal(usersModel.byId(user.id).cash_balance_cents, before + 12400);
});

test('engine: step size scales with the day fraction', () => {
  const pool = poolsModel.bySlug('forex');
  const rngA = mulberry32(7);
  const rngB = mulberry32(7);
  // With the same randomness, a tiny fraction of a day must move the value
  // far less than a full day does.
  const tiny = Math.abs(Math.log(engine.stepMultiplier(pool, rngA, 1 / 1440)));
  const full = Math.abs(Math.log(engine.stepMultiplier(pool, rngB, 1)));
  assert.ok(tiny < full, `tiny ${tiny} vs full ${full}`);
  assert.ok(tiny < 0.005, `intraday step too large: ${tiny}`);
});

test('engine: syntheticPoolSeries is stable across calls', () => {
  const pool = poolsModel.bySlug('forex');
  const s1 = engine.syntheticPoolSeries(pool, 30);
  const s2 = engine.syntheticPoolSeries(pool, 30);
  assert.equal(s1.length, 31);
  assert.deepEqual(s1.map((p) => p.v), s2.map((p) => p.v));
});

test.after(() => {
  try {
    db.close();
    require('fs').rmSync(process.env.DB_FILE, { force: true });
    require('fs').rmSync(process.env.DB_FILE + '-wal', { force: true });
    require('fs').rmSync(process.env.DB_FILE + '-shm', { force: true });
  } catch {
    /* best-effort cleanup */
  }
});
