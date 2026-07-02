'use strict';

const config = require('../config');
const positionsModel = require('../models/positions');
const ticksModel = require('../models/ticks');
const poolsModel = require('../models/pools');
const { completedYears } = require('../utils/time');

/**
 * Compute a full portfolio snapshot for a user, entirely from the stored
 * performance-tick series. Nothing here is hardcoded.
 */
function snapshot(userId) {
  const positions = positionsModel.activeByUser(userId);
  const pools = poolsModel.all();
  const poolById = Object.fromEntries(pools.map((p) => [p.id, p]));

  let totalValue = 0;
  let totalPrincipal = 0;
  const byPool = {};

  const positionViews = positions.map((pos) => {
    const latest = ticksModel.latest(pos.id);
    const value = latest ? latest.value_cents : pos.principal_cents;
    const pool = poolById[pos.pool_id];
    totalValue += value;
    totalPrincipal += pos.principal_cents;

    if (!byPool[pos.pool_id]) {
      byPool[pos.pool_id] = {
        pool,
        principalCents: 0,
        valueCents: 0,
        positionIds: [],
      };
    }
    byPool[pos.pool_id].principalCents += pos.principal_cents;
    byPool[pos.pool_id].valueCents += value;
    byPool[pos.pool_id].positionIds.push(pos.id);

    return {
      id: pos.id,
      pool,
      principalCents: pos.principal_cents,
      valueCents: value,
      gainCents: value - pos.principal_cents,
      gainPct: pos.principal_cents ? (value - pos.principal_cents) / pos.principal_cents : 0,
      depositedAt: pos.deposited_at,
      lockEndAt: pos.lock_end_at,
    };
  });

  const allocation = Object.values(byPool)
    .map((entry) => ({
      poolId: entry.pool.id,
      name: entry.pool.name,
      accent: entry.pool.accent,
      principalCents: entry.principalCents,
      valueCents: entry.valueCents,
      gainCents: entry.valueCents - entry.principalCents,
      gainPct: entry.principalCents
        ? (entry.valueCents - entry.principalCents) / entry.principalCents
        : 0,
      weight: 0, // filled below
    }))
    .sort((a, b) => b.valueCents - a.valueCents);

  for (const a of allocation) {
    a.weight = totalValue ? a.valueCents / totalValue : 0;
  }

  return {
    hasPositions: positions.length > 0,
    totalValueCents: totalValue,
    totalPrincipalCents: totalPrincipal,
    totalGainCents: totalValue - totalPrincipal,
    totalGainPct: totalPrincipal ? (totalValue - totalPrincipal) / totalPrincipal : 0,
    allocation,
    positions: positionViews,
  };
}

/**
 * Merge all active positions' daily series into a single combined portfolio
 * value curve (summed across positions per day) for the main line chart.
 */
function combinedDailySeries(userId) {
  const positions = positionsModel.activeByUser(userId);
  const perDay = new Map();
  const lastByPos = new Map();

  // Gather all distinct days across positions.
  const allDays = new Set();
  const seriesByPos = positions.map((pos) => {
    const s = ticksModel.dailySeries(pos.id);
    s.forEach((row) => allDays.add(row.day));
    return { posId: pos.id, rows: s };
  });
  const days = [...allDays].sort();

  // Forward-fill each position's value across the shared day axis.
  const cursor = new Map(seriesByPos.map((s) => [s.posId, 0]));
  for (const day of days) {
    let total = 0;
    for (const s of seriesByPos) {
      const rows = s.rows;
      let i = cursor.get(s.posId);
      while (i < rows.length && rows[i].day <= day) {
        lastByPos.set(s.posId, rows[i].value_cents);
        i++;
      }
      cursor.set(s.posId, i);
      total += lastByPos.get(s.posId) || 0;
    }
    perDay.set(day, total);
  }

  return days.map((day) => ({ day, valueCents: perDay.get(day) }));
}

/** Per-pool daily series (summed across a user's positions in that pool). */
function poolDailySeries(userId) {
  const positions = positionsModel.activeByUser(userId);
  const pools = poolsModel.all();
  const result = {};
  for (const pool of pools) {
    const inPool = positions.filter((p) => p.pool_id === pool.id);
    if (inPool.length === 0) continue;
    const perDay = new Map();
    const allDays = new Set();
    const seriesByPos = inPool.map((pos) => {
      const s = ticksModel.dailySeries(pos.id);
      s.forEach((row) => allDays.add(row.day));
      return { rows: s };
    });
    const days = [...allDays].sort();
    const last = new Array(seriesByPos.length).fill(0);
    const cursor = new Array(seriesByPos.length).fill(0);
    for (const day of days) {
      let total = 0;
      seriesByPos.forEach((s, idx) => {
        let i = cursor[idx];
        while (i < s.rows.length && s.rows[i].day <= day) {
          last[idx] = s.rows[i].value_cents;
          i++;
        }
        cursor[idx] = i;
        total += last[idx];
      });
      perDay.set(day, total);
    }
    result[pool.id] = {
      pool: { id: pool.id, name: pool.name, accent: pool.accent },
      series: days.map((day) => ({ day, valueCents: perDay.get(day) })),
    };
  }
  return result;
}

/**
 * Penalty preview for an early withdrawal of a position (before its lock ends).
 * Returns null if the position is already mature (no penalty).
 */
function earlyWithdrawalPreview(position) {
  const now = new Date();
  const lockEnd = new Date(position.lock_end_at);
  const latest = ticksModel.latest(position.id);
  const valueCents = latest ? latest.value_cents : position.principal_cents;

  if (now >= lockEnd) {
    return { mature: true, valueCents, penaltyPct: 0, penaltyCents: 0, netCents: valueCents };
  }

  const held = completedYears(position.deposited_at, now);
  const schedule = config.terms.penaltySchedule;
  // Penalty tier = first tier whose year window we're still inside.
  const tier = schedule[Math.min(held, schedule.length - 1)];
  const penaltyPct = tier.penaltyPct;
  const penaltyCents = Math.round(valueCents * penaltyPct);
  return {
    mature: false,
    valueCents,
    penaltyPct,
    penaltyCents,
    netCents: valueCents - penaltyCents,
    tierLabel: tier.label,
    lockEndAt: position.lock_end_at,
  };
}

module.exports = {
  snapshot,
  combinedDailySeries,
  poolDailySeries,
  earlyWithdrawalPreview,
};
