'use strict';

const crypto = require('crypto');

/**
 * Double-submit-cookie CSRF protection. A random token is stored in the session
 * and echoed in a non-httpOnly cookie + a hidden form field / header. On unsafe
 * methods we require the submitted token to match the session token using a
 * constant-time comparison.
 */
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const COOKIE = 'meridian.csrf';

function issueToken(req, res) {
  if (!req.session) return null;
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  // Readable by client JS so fetch() can send it as a header.
  res.cookie(COOKIE, req.session.csrfToken, {
    httpOnly: false,
    sameSite: 'lax',
    secure: req.app.get('trust proxy') ? true : req.secure,
    path: '/',
  });
  return req.session.csrfToken;
}

function middleware(req, res, next) {
  const token = issueToken(req, res);
  // Expose to templates.
  res.locals.csrfToken = token;

  if (SAFE.has(req.method)) return next();

  const submitted =
    (req.body && req.body._csrf) ||
    req.get('x-csrf-token') ||
    req.get('x-xsrf-token');

  const expected = req.session && req.session.csrfToken;
  if (
    !expected ||
    !submitted ||
    submitted.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(expected))
  ) {
    res.status(403);
    if (req.accepts('json') && !req.accepts('html')) {
      return res.json({ error: 'Invalid or missing CSRF token.' });
    }
    return res.render('errors/403', {
      title: 'Security check failed',
      message: 'Your session security token was missing or invalid. Please reload and try again.',
    });
  }
  return next();
}

module.exports = { middleware, issueToken, COOKIE };
