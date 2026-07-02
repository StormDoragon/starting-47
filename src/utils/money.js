'use strict';

/** Money helpers — everything internal is integer cents. */

function toCents(dollars) {
  return Math.round(Number(dollars) * 100);
}

function fromCents(cents) {
  return (Number(cents) || 0) / 100;
}

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usd0 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Format integer cents as $1,234.56 */
function formatCents(cents) {
  return usd.format(fromCents(cents));
}

/** Format integer cents as $1,235 (no decimals) */
function formatCents0(cents) {
  return usd0.format(fromCents(cents));
}

function formatPct(fraction, digits = 2) {
  const sign = fraction > 0 ? '+' : '';
  return `${sign}${(fraction * 100).toFixed(digits)}%`;
}

module.exports = { toCents, fromCents, formatCents, formatCents0, formatPct };
