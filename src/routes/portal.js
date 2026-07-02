'use strict';

const express = require('express');
const router = express.Router();

const config = require('../config');
const usersModel = require('../models/users');
const kycModel = require('../models/kyc');
const poolsModel = require('../models/pools');
const positionsModel = require('../models/positions');
const transactionsModel = require('../models/transactions');
const audit = require('../models/audit');

const portfolio = require('../services/portfolio');
const engine = require('../services/performanceEngine');
const totp = require('../services/totp');

const { requireAuth, requireKyc } = require('../security/auth');
const { sensitiveLimiter, authLimiter } = require('../security/rateLimit');
const v = require('../security/validate');
const { addYears, iso, countdown } = require('../utils/time');
const ah = require('../utils/asyncHandler');

router.use(requireAuth);

/** In lazy (serverless) mode, bring the user's series up to date on read. */
async function lazyRefresh(userId) {
  if (config.engine.mode === 'lazy') {
    await engine.refreshUserPositions(userId);
  }
}

// ---- Onboarding / mock KYC ------------------------------------------------

router.get(
  '/onboarding',
  ah(async (req, res) => {
    if (req.user.kycStatus === 'approved') return res.redirect('/portal');
    const existing = await kycModel.byUser(req.user.id);
    res.render('portal/onboarding', { title: 'Verify your identity', form: existing || {}, errors: {} });
  }),
);

router.post(
  '/onboarding',
  sensitiveLimiter,
  ah(async (req, res) => {
    const form = {
      full_name: v.clean(req.body.full_name).slice(0, 120),
      dob: v.clean(req.body.dob).slice(0, 20),
      country: v.clean(req.body.country).slice(0, 60),
      address: v.clean(req.body.address).slice(0, 240),
      id_doc_type: v.clean(req.body.id_doc_type).slice(0, 40),
      // We store only a filename reference; nothing is uploaded to a real service.
      id_doc_ref: v.clean(req.body.id_doc_ref || req.body.id_doc_filename || 'document.jpg').slice(0, 160),
    };

    const val = v.validator();
    val.check('full_name', form.full_name.length >= 2, 'Enter your full legal name.');
    val.check('dob', /^\d{4}-\d{2}-\d{2}$/.test(form.dob), 'Enter your date of birth.');
    if (/^\d{4}-\d{2}-\d{2}$/.test(form.dob)) {
      const age = (Date.now() - new Date(form.dob).getTime()) / (365.25 * 24 * 3600 * 1000);
      val.check('dob', age >= 18 && age < 120, 'You must be at least 18 years old.');
    }
    val.check('country', form.country.length >= 2, 'Select your country.');
    val.check('address', form.address.length >= 5, 'Enter your residential address.');
    val.check('id_doc_type', form.id_doc_type.length >= 2, 'Choose an ID document type.');
    val.check('id_doc_ref', form.id_doc_ref.length >= 3, 'Attach a document reference.');

    if (!val.ok) {
      return res.status(422).render('portal/onboarding', { title: 'Verify your identity', form, errors: val.errors });
    }

    await kycModel.create({ user_id: req.user.id, ...form });
    await usersModel.setKycStatus(req.user.id, 'approved');
    audit.log(req.user.id, 'kyc.submitted', 'auto-approved (demo)', req);
    req.flash('success', 'Identity verified (auto-approved for this demo). You can now fund your account.');
    res.redirect('/portal/deposit');
  }),
);

// ---- Dashboard ------------------------------------------------------------

router.get(
  '/',
  requireKyc,
  ah(async (req, res) => {
    await lazyRefresh(req.user.id);
    const snap = await portfolio.snapshot(req.user.id);
    const transactions = (await transactionsModel.byUser(req.user.id)).slice(0, 12);

    // Next unlock date across active positions.
    let nextUnlock = null;
    for (const p of snap.positions) {
      if (!nextUnlock || new Date(p.lockEndAt) < new Date(nextUnlock)) nextUnlock = p.lockEndAt;
    }

    res.render('portal/dashboard', {
      title: 'Your portfolio',
      snap,
      transactions,
      nextUnlock,
      countdown: nextUnlock ? countdown(nextUnlock) : null,
      tickIntervalMs: config.engine.tickIntervalMs,
    });
  }),
);

// ---- Deposit --------------------------------------------------------------

router.get(
  '/deposit',
  requireKyc,
  ah(async (req, res) => {
    res.render('portal/deposit', {
      title: 'Fund your account',
      pools: await poolsModel.all(),
      form: {},
      errors: {},
    });
  }),
);

router.post(
  '/deposit',
  sensitiveLimiter,
  requireKyc,
  ah(async (req, res) => {
    const pools = await poolsModel.all();
    const method = ['card', 'bank', 'crypto'].includes(req.body.method) ? req.body.method : 'card';

    // Read a per-pool dollar amount for each pool (blank = 0).
    const allocations = [];
    let totalCents = 0;
    const form = { method, amounts: {} };
    for (const pool of pools) {
      const raw = req.body[`amount_${pool.id}`];
      form.amounts[pool.id] = v.clean(raw);
      if (!raw || v.clean(raw) === '') continue;
      const cents = v.parseMoney(raw);
      if (cents === null && !/^0+(\.0{1,2})?$/.test(v.clean(raw))) {
        return res.status(422).render('portal/deposit', {
          title: 'Fund your account',
          pools,
          form,
          errors: { form: `Enter a valid amount for ${pool.name}.` },
        });
      }
      if (!cents) continue; // "0" means: skip this pool
      if (cents > config.terms.maxDeposit * 100) {
        return res.status(422).render('portal/deposit', {
          title: 'Fund your account',
          pools,
          form,
          errors: {
            form: `The maximum per pool in this demo is ${config.terms.currency} ${config.terms.maxDeposit.toLocaleString()}.`,
          },
        });
      }
      allocations.push({ pool, cents });
      totalCents += cents;
    }

    const minCents = config.terms.minDeposit * 100;
    if (totalCents < minCents) {
      return res.status(422).render('portal/deposit', {
        title: 'Fund your account',
        pools,
        form,
        errors: {
          form: `Minimum total deposit is ${config.terms.currency} ${config.terms.minDeposit.toLocaleString()}. You allocated ${(totalCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}.`,
        },
      });
    }

    const now = new Date();
    const lockEnd = addYears(now, config.terms.lockYears);
    const created = [];
    for (const alloc of allocations) {
      const pos = await positionsModel.create({
        userId: req.user.id,
        poolId: alloc.pool.id,
        principalCents: alloc.cents,
        depositedAt: iso(now),
        lockEndAt: iso(lockEnd),
      });
      await engine.backfillPosition(pos);
      await transactionsModel.create({
        userId: req.user.id,
        positionId: pos.id,
        type: 'deposit',
        amountCents: alloc.cents,
        status: 'completed',
        meta: { method, pool: alloc.pool.name },
      });
      created.push(pos);
    }
    audit.log(
      req.user.id,
      'deposit.completed',
      `${created.length} position(s), total=${(totalCents / 100).toFixed(2)} via ${method}`,
      req,
    );
    req.flash(
      'success',
      `Deposit of ${(totalCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} credited to your virtual balance across ${created.length} pool(s).`,
    );
    res.redirect('/portal');
  }),
);

// ---- Withdrawals ----------------------------------------------------------

router.get(
  '/withdraw',
  requireKyc,
  ah(async (req, res) => {
    await lazyRefresh(req.user.id);
    const active = await positionsModel.activeByUser(req.user.id);
    const positions = [];
    for (const pos of active) {
      const pool = await poolsModel.byId(pos.pool_id);
      const preview = await portfolio.earlyWithdrawalPreview(pos);
      positions.push({ pos, pool, preview, countdown: countdown(pos.lock_end_at) });
    }
    res.render('portal/withdraw', { title: 'Withdraw funds', positions });
  }),
);

router.post(
  '/withdraw/:positionId',
  sensitiveLimiter,
  requireKyc,
  ah(async (req, res) => {
    const pos = await positionsModel.byId(req.params.positionId);
    if (!pos || pos.user_id !== req.user.id || pos.status !== 'active') {
      req.flash('error', 'That position could not be found.');
      return res.redirect('/portal/withdraw');
    }
    const preview = await portfolio.earlyWithdrawalPreview(pos);
    if (preview.mature) {
      await positionsModel.markWithdrawn(pos.id);
      await usersModel.creditCash(req.user.id, preview.netCents);
      await transactionsModel.create({
        userId: req.user.id,
        positionId: pos.id,
        type: 'withdrawal',
        amountCents: preview.netCents,
        status: 'completed',
        meta: { mature: true },
      });
      audit.log(req.user.id, 'withdrawal.completed', `position=${pos.id}`, req);
      req.flash('success', 'Matured position withdrawn to your virtual cash balance (simulated).');
      return res.redirect('/portal');
    }

    // Early withdrawal requires explicit confirmation of the penalty.
    if (req.body.confirm_penalty !== 'yes') {
      req.flash('error', 'Early withdrawal requires explicit confirmation of the penalty terms.');
      return res.redirect('/portal/withdraw');
    }
    await positionsModel.markWithdrawn(pos.id);
    // Simulated processing settles instantly: the net amount (after penalty)
    // lands in the virtual cash balance right away.
    await usersModel.creditCash(req.user.id, preview.netCents);
    await transactionsModel.create({
      userId: req.user.id,
      positionId: pos.id,
      type: 'withdrawal_request',
      amountCents: preview.netCents,
      status: 'completed',
      meta: {
        early: true,
        penaltyPct: preview.penaltyPct,
        penaltyCents: preview.penaltyCents,
        grossCents: preview.valueCents,
      },
    });
    audit.log(
      req.user.id,
      'withdrawal.early_request',
      `position=${pos.id} penalty=${(preview.penaltyPct * 100).toFixed(0)}%`,
      req,
    );
    req.flash(
      'success',
      `Early withdrawal processed (simulated — no real payout). A ${(preview.penaltyPct * 100).toFixed(0)}% penalty was applied; the net amount was credited to your virtual cash balance.`,
    );
    res.redirect('/portal');
  }),
);

// ---- Security & account settings ------------------------------------------

/** Everything the settings page needs, with optional overrides. */
async function settingsView(req, overrides = {}) {
  const store = req.app.get('sessionStore');
  const sessions = (await store.listByUser(req.user.id)).map((s) => ({
    ...s,
    current: s.sid === req.sessionID,
  }));
  return {
    title: 'Security & settings',
    activity: await audit.byUser(req.user.id, 40),
    sessions,
    passwordErrors: {},
    twofa: null,
    ...overrides,
  };
}

router.get(
  '/settings',
  ah(async (req, res) => {
    res.render('portal/settings', await settingsView(req));
  }),
);

router.post(
  '/settings/password',
  authLimiter,
  ah(async (req, res) => {
    const current = String(req.body.current || '');
    const next_ = String(req.body.new || '');
    const confirm = String(req.body.confirm || '');
    const user = await usersModel.byId(req.user.id);

    const val = v.validator();
    val.check('current', usersModel.verifyPassword(user, current), 'Current password is incorrect.');
    const pwErr = v.passwordError(next_);
    val.check('new', !pwErr, pwErr || '');
    val.check('confirm', next_ === confirm, 'New passwords do not match.');

    if (!val.ok) {
      return res
        .status(422)
        .render('portal/settings', await settingsView(req, { passwordErrors: val.errors }));
    }

    await usersModel.setPassword(req.user.id, next_);
    audit.log(req.user.id, 'password.changed', null, req);
    req.flash('success', 'Password updated.');
    res.redirect('/portal/settings');
  }),
);

// 2FA enrolment — generate a secret + QR, stash secret in session until verified.
router.post(
  '/settings/2fa/setup',
  authLimiter,
  ah(async (req, res) => {
    const user = await usersModel.byId(req.user.id);
    if (user.totp_enabled) {
      req.flash('error', 'Two-factor authentication is already enabled.');
      return res.redirect('/portal/settings');
    }
    const secret = await totp.generate(user.email);
    req.session.pendingTotpSecret = secret.base32;
    res.render(
      'portal/settings',
      await settingsView(req, { twofa: { qrDataUrl: secret.qrDataUrl, base32: secret.base32 } }),
    );
  }),
);

router.post(
  '/settings/2fa/enable',
  authLimiter,
  ah(async (req, res) => {
    const secret = req.session.pendingTotpSecret;
    if (!secret) {
      req.flash('error', 'Start the 2FA setup again.');
      return res.redirect('/portal/settings');
    }
    if (!totp.verify(secret, req.body.token)) {
      return res.status(422).render(
        'portal/settings',
        await settingsView(req, {
          twofa: { error: 'That code did not match. Try again.', qrDataUrl: null, base32: secret },
        }),
      );
    }
    await usersModel.setTotp(req.user.id, { secret, enabled: true });
    req.session.pendingTotpSecret = null;
    audit.log(req.user.id, '2fa.enabled', null, req);
    req.flash('success', 'Two-factor authentication is now enabled.');
    res.redirect('/portal/settings');
  }),
);

router.post(
  '/settings/2fa/disable',
  authLimiter,
  ah(async (req, res) => {
    const user = await usersModel.byId(req.user.id);
    if (!usersModel.verifyPassword(user, String(req.body.password || ''))) {
      req.flash('error', 'Password incorrect — 2FA not changed.');
      return res.redirect('/portal/settings');
    }
    await usersModel.setTotp(req.user.id, { secret: null, enabled: false });
    audit.log(req.user.id, '2fa.disabled', null, req);
    req.flash('success', 'Two-factor authentication disabled.');
    res.redirect('/portal/settings');
  }),
);

// Revoke another active session.
router.post(
  '/settings/sessions/revoke',
  ah(async (req, res) => {
    const sid = v.clean(req.body.sid);
    const store = req.app.get('sessionStore');
    const owned = (await store.listByUser(req.user.id)).some((s) => s.sid === sid);
    if (owned && sid !== req.sessionID) {
      store.destroy(sid, () => {});
      audit.log(req.user.id, 'session.revoked', `sid=${sid.slice(0, 8)}…`, req);
      req.flash('success', 'Session revoked.');
    }
    res.redirect('/portal/settings');
  }),
);

module.exports = router;
