'use strict';

/**
 * Wrap an async Express handler so rejections reach the error middleware —
 * Express 4 does not catch promise rejections on its own.
 */
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
