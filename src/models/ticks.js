'use strict';

const { run, get, all, batch } = require('../db');

const INSERT = 'INSERT INTO performance_ticks (position_id, ts, value_cents) VALUES (?, ?, ?)';

module.exports = {
  add: (positionId, ts, valueCents) => run(INSERT, [positionId, ts, valueCents]),
  /** Insert many ticks atomically. rows: [{positionId, ts, valueCents}] */
  addMany: (rows) =>
    batch(rows.map((r) => ({ sql: INSERT, args: [r.positionId, r.ts, r.valueCents] }))),
  latest: (positionId) =>
    get(
      'SELECT * FROM performance_ticks WHERE position_id = ? ORDER BY ts DESC, id DESC LIMIT 1',
      [positionId],
    ),
  series: (positionId) =>
    all('SELECT ts, value_cents FROM performance_ticks WHERE position_id = ? ORDER BY ts ASC', [
      positionId,
    ]),
  // Down-sampled daily series (last value of each calendar day) for charts.
  dailySeries: (positionId) =>
    all(
      `SELECT substr(ts, 1, 10) AS day, value_cents AS value_cents, MAX(ts) AS ts
       FROM performance_ticks
       WHERE position_id = ?
       GROUP BY substr(ts, 1, 10)
       ORDER BY day ASC`,
      [positionId],
    ),
};
