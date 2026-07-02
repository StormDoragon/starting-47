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
 * Apply the schema (idempotent — every statement is CREATE ... IF NOT EXISTS).
 */
function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
}

module.exports = { db, migrate };
