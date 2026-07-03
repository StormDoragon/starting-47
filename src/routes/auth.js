'use strict';

const express = require('express');
const router = express.Router();

const usersModel = require('../models/users');
const audit = require('../models/audit');
const totp = require('../services/totp');
const { authLimiter } = require('../security/rateLimit');
const { redirectIfAuthed } = require('../security/auth');
const v = require('../security/validate');

/** Regenerate the session on privilege change to prevent fixation. */
function login(req, user, cb) {
  req.session.regenerate((err) => {
    if (err) return cb(err);
    req.session.user = { id: user.id };
    req.session.meta = {
      ip: req.ip,
      userAgent: (req.get('user-agent') || '').slice(0, 300),
    };
    req.session.save(cb);
  });
}

// ---- Register -------------------------------------------------------------

router.get('/register', redirectIfAuthed, (req, res) => {
  res.render('auth/register', { title: 'Open an account', form: {}, errors: {} });
});

router.post('/register', authLimiter, redirectIfAuthed, (req, res, next) => {
  const email = v.clean(req.body.email).toLowerCase();
  const displayName = v.clean(req.body.display_name).slice(0, 80);
  const password = String(req.body.password || '');
  const confirm = String(req.body.confirm || '');

  const val = v.validator();
  val.check('email', v.isEmail(email), 'Enter a valid email address.');
  val.check('display_name', displayName.length >= 2, 'Tell us your name.');
  const pwErr = v.passwordError(password);
  val.check('password', !pwErr, pwErr || '');
  val.check('confirm', password === confirm, 'Passwords do not match.');
  if (val.ok && usersModel.byEmail(email)) {
    val.check('email', false, 'An account with that email already exists.');
  }

  if (!val.ok) {
    return res
      .status(422)
      .render('auth/register', { title: 'Open an account', form: { email, displayName }, errors: val.errors });
  }

  try {
    const user = usersModel.create({ email, password, displayName });
    // Bootstrap: an account registered with the configured admin email is
    // promoted to administrator immediately.
    if (email === require('../config').admin.email) {
      usersModel.setAdmin(user.id, true);
    }
    audit.log(user.id, 'account.created', `email=${email}`, req);
    login(req, user, (err) => {
      if (err) return next(err);
      req.flash('success', 'Welcome to Meridian. Let’s verify your identity to continue.');
      res.redirect('/portal/onboarding');
    });
  } catch (err) {
    next(err);
  }
});

// ---- Login (with optional 2FA challenge) ----------------------------------

router.get('/login', redirectIfAuthed, (req, res) => {
  res.render('auth/login', {
    title: 'Log in',
    form: {},
    errors: {},
    next: v.clean(req.query.next).slice(0, 200),
  });
});

router.post('/login', authLimiter, redirectIfAuthed, (req, res, next) => {
  const email = v.clean(req.body.email).toLowerCase();
  const password = String(req.body.password || '');
  const nextUrl = safeNext(req.body.next);

  const fail = () => {
    audit.log(null, 'login.failed', `email=${email}`, req);
    return res.status(401).render('auth/login', {
      title: 'Log in',
      form: { email },
      errors: { form: 'Invalid email or password.' },
      next: nextUrl,
    });
  };

  const user = usersModel.byEmail(email);
  if (!user || !usersModel.verifyPassword(user, password)) return fail();

  if (user.totp_enabled) {
    // Stage a pending 2FA challenge — not logged in until verified.
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.pending2fa = { userId: user.id, next: nextUrl };
      req.session.save((err2) => {
        if (err2) return next(err2);
        res.redirect('/login/2fa');
      });
    });
    return;
  }

  login(req, user, (err) => {
    if (err) return next(err);
    audit.log(user.id, 'login.success', null, req);
    res.redirect(nextUrl || (user.kyc_status === 'approved' ? '/portal' : '/portal/onboarding'));
  });
});

router.get('/login/2fa', (req, res) => {
  if (!req.session.pending2fa) return res.redirect('/login');
  res.render('auth/twofactor', { title: 'Two-factor verification', errors: {} });
});

router.post('/login/2fa', authLimiter, (req, res, next) => {
  const pending = req.session.pending2fa;
  if (!pending) return res.redirect('/login');
  const user = usersModel.byId(pending.userId);
  if (!user) return res.redirect('/login');

  if (!totp.verify(user.totp_secret, req.body.token)) {
    audit.log(user.id, '2fa.failed', null, req);
    return res
      .status(401)
      .render('auth/twofactor', { title: 'Two-factor verification', errors: { token: 'Incorrect code. Try again.' } });
  }

  const nextUrl = safeNext(pending.next);
  login(req, user, (err) => {
    if (err) return next(err);
    audit.log(user.id, 'login.success', '2fa=ok', req);
    res.redirect(nextUrl || (user.kyc_status === 'approved' ? '/portal' : '/portal/onboarding'));
  });
});

// ---- Logout ---------------------------------------------------------------

router.post('/logout', (req, res) => {
  const uid = req.user && req.user.id;
  req.session.destroy(() => {
    if (uid) audit.log(uid, 'logout', null, req);
    res.clearCookie(require('../config').session.cookieName);
    res.redirect('/');
  });
});

function safeNext(value) {
  const s = v.clean(value);
  // Only allow same-site absolute paths.
  return /^\/[a-zA-Z0-9/_\-?=&.]*$/.test(s) && !s.startsWith('//') ? s : '';
}

module.exports = router;
