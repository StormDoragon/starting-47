'use strict';

const crypto = require('crypto');

/** URL-safe unique id with an optional short prefix, e.g. usr_ab12cd... */
function newId(prefix = '') {
  const raw = crypto.randomBytes(12).toString('hex');
  return prefix ? `${prefix}_${raw}` : raw;
}

module.exports = { newId };
