'use strict';

const { db } = require('../db');

const insert = db.prepare(
  'INSERT INTO performance_ticks (position_id, ts, value_cents) VALUES (?, ?, ?)',
);
const insertMany = db.transaction((rows) => {
  for (const r of rows) insert.run(r.positionId, r.ts, r.valueCents);
});

const latest = db.prepare(
  'SELECT * FROM performance_ticks WHERE position_id = ? ORDER BY ts DESC, id DESC LIMIT 1',
);

const seriesForPosition = db.prepare(`
  SELECT ts, value_cents FROM performance_ticks
  WHERE position_id = ? ORDER BY ts ASC
`);

// Down-sampled daily series (last value of each calendar day) for charts.
const dailySeriesForPosition = db.prepare(`
  SELECT substr(ts, 1, 10) AS day, value_cents AS value_cents, MAX(ts) AS ts
  FROM performance_ticks
  WHERE position_id = ?
  GROUP BY substr(ts, 1, 10)
  ORDER BY day ASC
`);

module.exports = {
  add: (positionId, ts, valueCents) => insert.run(positionId, ts, valueCents),
  addMany: (rows) => insertMany(rows),
  latest: (positionId) => latest.get(positionId),
  series: (positionId) => seriesForPosition.all(positionId),
  dailySeries: (positionId) => dailySeriesForPosition.all(positionId),
};
