'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

// Ensure the data directory exists.
fs.mkdirSync(path.dirname(config.db.file), { recursive: true });

const db = new Database(config.db.file);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Apply the schema (idempotent — every statement is CREATE ... IF NOT EXISTS),
 * then any additive migrations for databases created by older schema versions.
 */
function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('cash_balance_cents')) {
    db.exec('ALTER TABLE users ADD COLUMN cash_balance_cents INTEGER NOT NULL DEFAULT 0');
  }
  if (!userCols.includes('is_admin')) {
    db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
  }
}

// Models prepare their statements at require time, so the schema must exist
// before any model module loads — migrate as soon as the database opens.
migrate();

module.exports = { db, migrate };
