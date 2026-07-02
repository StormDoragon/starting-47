'use strict';

/**
 * Small, dependency-free validation & sanitisation helpers. Every form handler
 * runs its input through these before anything touches the database (and all DB
 * access uses parameterised prepared statements, so there is no SQL-injection
 * surface regardless).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v) {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/** Collapse whitespace and trim. */
function clean(v) {
  return str(v).replace(/\s+/g, ' ').trim();
}

/** Escape HTML special chars for safe echo (defence in depth; EJS also escapes). */
function escapeHtml(v) {
  return str(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isEmail(v) {
  const s = clean(v).toLowerCase();
  return EMAIL_RE.test(s) && s.length <= 254;
}

/** Password policy: length + a bit of variety. Returns null or an error string. */
function passwordError(v) {
  const s = str(v);
  if (s.length < 10) return 'Password must be at least 10 characters.';
  if (s.length > 200) return 'Password is too long.';
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(s)).length;
  if (classes < 3) {
    return 'Use at least three of: lowercase, uppercase, numbers, symbols.';
  }
  return null;
}

/** Positive money amount in dollars → cents; returns null if invalid. */
function parseMoney(v) {
  const s = clean(v).replace(/[$,]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  return Number.isFinite(cents) && cents > 0 ? cents : null;
}

/** Build a simple validation result collector. */
function validator() {
  const errors = {};
  return {
    check(field, condition, message) {
      if (!errors[field] && !condition) errors[field] = message;
      return this;
    },
    get errors() {
      return errors;
    },
    get ok() {
      return Object.keys(errors).length === 0;
    },
  };
}

module.exports = {
  clean,
  escapeHtml,
  isEmail,
  passwordError,
  parseMoney,
  validator,
};
