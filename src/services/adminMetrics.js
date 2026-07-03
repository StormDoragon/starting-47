'use strict';

/**
 * Composed metrics for the admin overview that need more than a single SQL
 * aggregate — chiefly the platform-wide AUM curve, built by merging every
 * active position's stored daily tick series onto a shared day axis (the same
 * forward-fill technique the investor portfolio service uses, but across all
 * users). Values are read from performance_ticks; nothing is synthesised here.
 */

const positionsModel = require('../models/positions');
const ticksModel = require('../models/ticks');

/**
 * Platform assets under management per calendar day, summed across all active
 * positions. Returns [{ day, valueCents }] ascending. Optionally trims to the
 * most recent `maxDays` points to keep the payload compact.
 */
function siteDailyAum(maxDays = 120) {
  const positions = positionsModel.allActive();
  if (positions.length === 0) return [];

  const allDays = new Set();
  const seriesByPos = positions.map((pos) => {
    const rows = ticksModel.dailySeries(pos.id);
    rows.forEach((r) => allDays.add(r.day));
    return { rows };
  });
  const days = [...allDays].sort();

  const last = new Array(seriesByPos.length).fill(0);
  const cursor = new Array(seriesByPos.length).fill(0);
  const out = [];
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
    out.push({ day, valueCents: total });
  }

  return maxDays && out.length > maxDays ? out.slice(out.length - maxDays) : out;
}

module.exports = { siteDailyAum };
