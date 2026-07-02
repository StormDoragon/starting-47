'use strict';

const { run, all } = require('../db');

/**
 * Record a security-relevant event. `req` is optional; when supplied we capture
 * IP + user-agent for the "security & trust" activity log. Returns a promise —
 * callers may await it or fire-and-forget; failures never crash a request.
 */
function log(userId, event, detail = null, req = null) {
  const ip = req ? req.ip || req.headers['x-forwarded-for'] || null : null;
  const ua = req ? req.headers['user-agent'] || null : null;
  return run(
    'INSERT INTO audit_log (user_id, event, detail, ip, user_agent) VALUES (?, ?, ?, ?, ?)',
    [userId || null, event, detail, ip, ua],
  ).catch((err) => console.error('audit log failed:', err.message));
}

module.exports = {
  log,
  byUser: (uid, limit = 50) =>
    all('SELECT * FROM audit_log WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?', [
      uid,
      limit,
    ]),
};
