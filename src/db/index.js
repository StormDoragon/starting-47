'use strict';

const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');
const config = require('../config');

// For embedded file databases, make sure the directory exists.
if (config.db.url.startsWith('file:')) {
  const file = config.db.url.slice('file:'.length);
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
}

const client = createClient({
  url: config.db.url,
  authToken: config.db.authToken,
});

/** Normalise libSQL rows (array-like) into plain objects keyed by column. */
function toObjects(rs) {
  return rs.rows.map((row) => {
    const obj = {};
    rs.columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

/** Run a statement; returns the raw ResultSet ({ rowsAffected, ... }). */
async function run(sql, args = []) {
  return client.execute({ sql, args });
}

/** Query many rows as plain objects. */
async function all(sql, args = []) {
  return toObjects(await client.execute({ sql, args }));
}

/** Query a single row (or undefined). */
async function get(sql, args = []) {
  const rows = await all(sql, args);
  return rows[0];
}

/** Execute several write statements atomically. stmts: [{sql, args}] */
async function batch(stmts) {
  return client.batch(stmts, 'write');
}

/**
 * Apply the schema (idempotent — every statement is CREATE ... IF NOT EXISTS),
 * then any additive migrations for databases created by older schema versions.
 * Serialised so concurrent callers (warm serverless invocations) share one run.
 */
let migration = null;
function migrate() {
  if (!migration) {
    migration = (async () => {
      // Best-effort pragma: supported by embedded SQLite; some hosted libSQL
      // deployments reject PRAGMA over the wire, which is fine to ignore.
      try {
        await client.execute('PRAGMA foreign_keys = ON');
      } catch {
        /* not supported remotely — relations are enforced by the app layer */
      }
      const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
      await client.executeMultiple(schema);

      // users.cash_balance_cents was added after the first release.
      try {
        await client.execute(
          'ALTER TABLE users ADD COLUMN cash_balance_cents INTEGER NOT NULL DEFAULT 0',
        );
      } catch (err) {
        if (!/duplicate column/i.test(String(err.message))) throw err;
      }
    })();
  }
  return migration;
}

module.exports = { client, run, all, get, batch, migrate };
