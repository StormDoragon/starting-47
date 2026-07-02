'use strict';

const { db } = require('../db');

const insert = db.prepare(
  'INSERT INTO audit_log (user_id, event, detail, ip, user_agent) VALUES (?, ?, ?, ?, ?)',
);
const byUser = db.prepare(
  'SELECT * FROM audit_log WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
);

/**
 * Record a security-relevant event. `req` is optional; when supplied we capture
 * IP + user-agent for the "security & trust" activity log.
 */
function log(userId, event, detail = null, req = null) {
  const ip = req ? req.ip || req.headers['x-forwarded-for'] || null : null;
  const ua = req ? req.headers['user-agent'] || null : null;
  insert.run(userId || null, event, detail, ip, ua);
}

module.exports = {
  log,
  byUser: (uid, limit = 50) => byUser.all(uid, limit),
};
