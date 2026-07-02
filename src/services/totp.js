'use strict';

const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const config = require('../config');

/** Generate a fresh TOTP secret + provisioning QR (data URL) for enrolment. */
async function generate(email) {
  const secret = speakeasy.generateSecret({
    name: `${config.brand.name} (${email})`,
    length: 20,
  });
  const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url, { margin: 1, width: 220 });
  return { base32: secret.base32, otpauthUrl: secret.otpauth_url, qrDataUrl };
}

/** Verify a 6-digit token against a base32 secret (±1 step tolerance). */
function verify(base32, token) {
  if (!base32 || !token) return false;
  return speakeasy.totp.verify({
    secret: base32,
    encoding: 'base32',
    token: String(token).replace(/\s+/g, ''),
    window: 1,
  });
}

module.exports = { generate, verify };
