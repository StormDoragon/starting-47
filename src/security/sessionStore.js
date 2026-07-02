'use strict';

const session = require('express-session');
const { run, get, all } = require('../db');

/**
 * A small libSQL/SQLite-backed session store. Beyond persistence, it records
 * the IP and user-agent per session so the portal can render an "active
 * sessions" list and let the user revoke other sessions — a real feature, not
 * a mock. The express-session Store API is callback-based; internals are async.
 */
class SqliteStore extends session.Store {
  get(sid, cb) {
    get('SELECT data, expires_at FROM sessions WHERE sid = ?', [sid])
      .then(async (row) => {
        if (!row) return cb(null, null);
        if (row.expires_at < Date.now()) {
          await run('DELETE FROM sessions WHERE sid = ?', [sid]);
          return cb(null, null);
        }
        return cb(null, JSON.parse(row.data));
      })
      .catch(cb);
  }

  set(sid, sess, cb) {
    const expires =
      sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 1000 * 60 * 60 * 8;
    run(
      `INSERT INTO sessions (sid, user_id, data, ip, user_agent, expires_at, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(sid) DO UPDATE SET
         user_id=excluded.user_id, data=excluded.data, ip=excluded.ip,
         user_agent=excluded.user_agent, expires_at=excluded.expires_at,
         last_seen=datetime('now')`,
      [
        sid,
        (sess.user && sess.user.id) || null,
        JSON.stringify(sess),
        sess.meta ? sess.meta.ip : null,
        sess.meta ? sess.meta.userAgent : null,
        expires,
      ],
    )
      .then(() => cb && cb(null))
      .catch((err) => cb && cb(err));
  }

  destroy(sid, cb) {
    run('DELETE FROM sessions WHERE sid = ?', [sid])
      .then(() => cb && cb(null))
      .catch((err) => cb && cb(err));
  }

  touch(sid, sess, cb) {
    const expires =
      sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 1000 * 60 * 60 * 8;
    run("UPDATE sessions SET expires_at = ?, last_seen = datetime('now') WHERE sid = ?", [
      expires,
      sid,
    ])
      .then(() => cb && cb(null))
      .catch((err) => cb && cb(err));
  }

  /** List a user's sessions (for the security dashboard). */
  listByUser(userId) {
    return all(
      'SELECT sid, ip, user_agent, created_at, last_seen, expires_at FROM sessions WHERE user_id = ? ORDER BY last_seen DESC',
      [userId],
    );
  }

  clearExpired() {
    return run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);
  }
}

module.exports = { SqliteStore };
