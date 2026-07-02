'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

function iso(date = new Date()) {
  return date.toISOString();
}

function addYears(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

/** Returns a human-friendly breakdown of the time between now and a future date. */
function countdown(toDate, from = new Date()) {
  const target = new Date(toDate);
  const ms = target.getTime() - from.getTime();
  const past = ms <= 0;
  const abs = Math.abs(ms);
  const days = Math.floor(abs / DAY_MS);
  const years = Math.floor(days / 365);
  const remDays = days - years * 365;
  const months = Math.floor(remDays / 30);
  const finalDays = remDays - months * 30;
  return { past, totalDays: days, years, months, days: finalDays };
}

/** Completed years between two dates (floored). */
function completedYears(fromDate, toDate = new Date()) {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  let years = to.getFullYear() - from.getFullYear();
  const anniversary = new Date(from);
  anniversary.setFullYear(from.getFullYear() + years);
  if (anniversary > to) years -= 1;
  return Math.max(0, years);
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(date) {
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

module.exports = {
  DAY_MS,
  iso,
  addYears,
  countdown,
  completedYears,
  formatDate,
  formatDateTime,
};
