'use strict';

const helmet = require('helmet');

/**
 * Security headers. The Content-Security-Policy keeps the high-risk vector —
 * scripts — strictly first-party: `script-src 'self'` with NO inline executable
 * JavaScript anywhere in the app. Styles allow inline attributes because the UI
 * uses per-pool accent colours and layout hints inline (low risk, no script
 * execution). Images allow data: URLs for the 2FA QR code.
 */
module.exports = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'same-origin' },
});
