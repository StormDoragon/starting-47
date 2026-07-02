'use strict';

const session = require('express-session');
const { db } = require('../db');

/**
 * A small SQLite-backed session store. Beyond persistence, it records the IP
 * and user-agent per session so the portal can render an "active sessions" list
 * and let the user revoke other sessions — a real feature, not a mock.
 */
class SqliteStore extends session.Store {
  constructor() {
    super();
    this.stmts = {
      get: db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?'),
      upsert: db.prepare(`
        INSERT INTO sessions (sid, user_id, data, ip, user_agent, expires_at, last_seen)
        VALUES (@sid, @user_id, @data, @ip, @user_agent, @expires_at, datetime('now'))
        ON CONFLICT(sid) DO UPDATE SET
          user_id=@user_id, data=@data, ip=@ip, user_agent=@user_agent,
          expires_at=@expires_at, last_seen=datetime('now')
      `),
      destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
      touch: db.prepare(
        "UPDATE sessions SET expires_at = ?, last_seen = datetime('now') WHERE sid = ?",
      ),
      byUser: db.prepare(
        'SELECT sid, ip, user_agent, created_at, last_seen, expires_at FROM sessions WHERE user_id = ? ORDER BY last_seen DESC',
      ),
      clearExpired: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
    };
  }

  get(sid, cb) {
    try {
      const row = this.stmts.get.get(sid);
      if (!row) return cb(null, null);
      if (row.expires_at < Date.now()) {
        this.stmts.destroy.run(sid);
        return cb(null, null);
      }
      return cb(null, JSON.parse(row.data));
    } catch (err) {
      return cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      const expires = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 1000 * 60 * 60 * 8;
      this.stmts.upsert.run({
        sid,
        user_id: (sess.user && sess.user.id) || null,
        data: JSON.stringify(sess),
        ip: sess.meta ? sess.meta.ip : null,
        user_agent: sess.meta ? sess.meta.userAgent : null,
        expires_at: expires,
      });
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      this.stmts.destroy.run(sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  touch(sid, sess, cb) {
    try {
      const expires = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 1000 * 60 * 60 * 8;
      this.stmts.touch.run(expires, sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  /** List a user's sessions (for the security dashboard). */
  listByUser(userId) {
    return this.stmts.byUser.all(userId);
  }

  clearExpired() {
    this.stmts.clearExpired.run(Date.now());
  }
}

module.exports = { SqliteStore };
