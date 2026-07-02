'use strict';

const rateLimit = require('express-rate-limit');

const json = (req, res) =>
  res.status(429).json({ error: 'Too many attempts. Please slow down and try again shortly.' });

const html = (req, res) =>
  res.status(429).render('errors/429', {
    title: 'Too many attempts',
    message: 'You have made too many attempts in a short window. Please wait a minute and retry.',
  });

/** Strict limiter for auth endpoints (login/register/2fa). */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => (req.accepts('html') ? html(req, res) : json(req, res)),
});

/** Looser limiter for money-movement actions. */
const sensitiveLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => (req.accepts('html') ? html(req, res) : json(req, res)),
});

/** Baseline limiter applied to the whole app. */
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => (req.accepts('html') ? html(req, res) : json(req, res)),
});

module.exports = { authLimiter, sensitiveLimiter, globalLimiter };
