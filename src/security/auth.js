'use strict';

const usersModel = require('../models/users');

/** Attach the current user (if any) to req/res.locals for every request. */
function attachUser(req, res, next) {
  let user = null;
  if (req.session && req.session.user && req.session.user.id) {
    user = usersModel.byId(req.session.user.id);
    if (user) {
      // Never expose secrets to templates.
      const safe = {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        kycStatus: user.kyc_status,
        totpEnabled: !!user.totp_enabled,
        isAdmin: !!user.is_admin,
        cashBalanceCents: user.cash_balance_cents || 0,
      };
      req.user = safe;
      res.locals.currentUser = safe;
    } else {
      req.session.user = null;
    }
  }
  res.locals.currentUser = res.locals.currentUser || null;
  next();
}

/** Require a fully-authenticated session (2FA already satisfied). */
function requireAuth(req, res, next) {
  if (!req.user || (req.session && req.session.pending2fa)) {
    if (wantsJson(req)) return res.status(401).json({ error: 'Authentication required.' });
    const next_ = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login?next=${next_}`);
  }
  next();
}

/** Require an approved KYC before entering money flows. */
function requireKyc(req, res, next) {
  if (!req.user) return requireAuth(req, res, next);
  if (req.user.kycStatus !== 'approved') {
    return res.redirect('/portal/onboarding');
  }
  next();
}

/** Require an authenticated administrator (back-office dashboard). */
function requireAdmin(req, res, next) {
  if (!req.user || (req.session && req.session.pending2fa)) {
    if (wantsJson(req)) return res.status(401).json({ error: 'Authentication required.' });
    const next_ = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login?next=${next_}`);
  }
  if (!req.user.isAdmin) {
    if (wantsJson(req)) return res.status(403).json({ error: 'Administrator access required.' });
    return res.status(403).render('errors/403', {
      title: 'Access denied',
      message: 'This area is restricted to platform administrators.',
    });
  }
  next();
}

/** Redirect already-authenticated users away from auth pages. */
function redirectIfAuthed(req, res, next) {
  if (req.user) return res.redirect('/portal');
  next();
}

function wantsJson(req) {
  return req.xhr || (req.get('accept') || '').includes('application/json');
}

module.exports = { attachUser, requireAuth, requireKyc, requireAdmin, redirectIfAuthed, wantsJson };
