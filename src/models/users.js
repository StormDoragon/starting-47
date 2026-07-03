'use strict';

const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { newId } = require('../utils/id');
const config = require('../config');

const insert = db.prepare(`
  INSERT INTO users (id, email, password_hash, display_name)
  VALUES (@id, @email, @password_hash, @display_name)
`);
const byEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const byId = db.prepare('SELECT * FROM users WHERE id = ?');
const touch = db.prepare("UPDATE users SET updated_at = datetime('now') WHERE id = ?");

function create({ email, password, displayName }) {
  const id = newId('usr');
  const password_hash = bcrypt.hashSync(password, config.security.bcryptRounds);
  insert.run({
    id,
    email: email.toLowerCase().trim(),
    password_hash,
    display_name: displayName || null,
  });
  return byId.get(id);
}

function verifyPassword(user, password) {
  return bcrypt.compareSync(password, user.password_hash);
}

function setPassword(userId, password) {
  const hash = bcrypt.hashSync(password, config.security.bcryptRounds);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(
    hash,
    userId,
  );
}

function setKycStatus(userId, status) {
  db.prepare("UPDATE users SET kyc_status = ?, updated_at = datetime('now') WHERE id = ?").run(
    status,
    userId,
  );
}

function setTotp(userId, { secret, enabled }) {
  db.prepare(
    "UPDATE users SET totp_secret = ?, totp_enabled = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(secret ?? null, enabled ? 1 : 0, userId);
}

/** Credit (or with a negative amount, debit) the virtual cash balance. */
function creditCash(userId, cents) {
  db.prepare(
    "UPDATE users SET cash_balance_cents = cash_balance_cents + ?, updated_at = datetime('now') WHERE id = ?",
  ).run(Math.round(cents), userId);
}

/** Grant or revoke administrator (back-office dashboard) access. */
function setAdmin(userId, isAdmin) {
  db.prepare(
    "UPDATE users SET is_admin = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(isAdmin ? 1 : 0, userId);
}

/**
 * Promote an existing account to admin by email. Used to bootstrap the first
 * administrator from config without exposing a self-service path. Returns the
 * updated user row, or null if no account with that email exists yet.
 */
function promoteByEmail(email) {
  const user = byEmail.get(String(email || '').toLowerCase().trim());
  if (!user) return null;
  if (!user.is_admin) setAdmin(user.id, true);
  return byId.get(user.id);
}

module.exports = {
  create,
  byEmail: (email) => byEmail.get(String(email || '').toLowerCase().trim()),
  byId: (id) => byId.get(id),
  verifyPassword,
  setPassword,
  setKycStatus,
  setTotp,
  creditCash,
  setAdmin,
  promoteByEmail,
  touch: (id) => touch.run(id),
};
