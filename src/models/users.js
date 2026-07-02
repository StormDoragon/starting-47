'use strict';

const bcrypt = require('bcryptjs');
const { run, get } = require('../db');
const { newId } = require('../utils/id');
const config = require('../config');

async function create({ email, password, displayName }) {
  const id = newId('usr');
  const password_hash = bcrypt.hashSync(password, config.security.bcryptRounds);
  await run(
    'INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)',
    [id, email.toLowerCase().trim(), password_hash, displayName || null],
  );
  return get('SELECT * FROM users WHERE id = ?', [id]);
}

function verifyPassword(user, password) {
  return bcrypt.compareSync(password, user.password_hash);
}

async function setPassword(userId, password) {
  const hash = bcrypt.hashSync(password, config.security.bcryptRounds);
  await run("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?", [
    hash,
    userId,
  ]);
}

async function setKycStatus(userId, status) {
  await run("UPDATE users SET kyc_status = ?, updated_at = datetime('now') WHERE id = ?", [
    status,
    userId,
  ]);
}

async function setTotp(userId, { secret, enabled }) {
  await run(
    "UPDATE users SET totp_secret = ?, totp_enabled = ?, updated_at = datetime('now') WHERE id = ?",
    [secret ?? null, enabled ? 1 : 0, userId],
  );
}

/** Credit (or with a negative amount, debit) the virtual cash balance. */
async function creditCash(userId, cents) {
  await run(
    "UPDATE users SET cash_balance_cents = cash_balance_cents + ?, updated_at = datetime('now') WHERE id = ?",
    [Math.round(cents), userId],
  );
}

module.exports = {
  create,
  byEmail: (email) =>
    get('SELECT * FROM users WHERE email = ?', [String(email || '').toLowerCase().trim()]),
  byId: (id) => get('SELECT * FROM users WHERE id = ?', [id]),
  verifyPassword,
  setPassword,
  setKycStatus,
  setTotp,
  creditCash,
  touch: (id) => run("UPDATE users SET updated_at = datetime('now') WHERE id = ?", [id]),
};
