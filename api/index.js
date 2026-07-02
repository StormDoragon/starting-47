'use strict';

/**
 * Vercel serverless entry point. All routes are rewritten here (see
 * vercel.json); static assets in public/ are served by Vercel's CDN before
 * this function is reached.
 *
 * The Express app is built once per warm instance and reused across
 * invocations. There is no long-running tick loop in this environment —
 * config.engine.mode resolves to 'lazy' (VERCEL env), so performance ticks
 * are generated on portfolio reads plus a daily cron catch-up.
 */

const { createApp } = require('../src/app');

let appPromise = null;

module.exports = async (req, res) => {
  if (!appPromise) appPromise = createApp();
  const app = await appPromise;
  return app(req, res);
};
