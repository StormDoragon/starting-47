'use strict';

/**
 * The four investment pools. `drift_daily` / `vol_daily` / `jump_*` feed the
 * simulated performance engine so each pool has its own personality:
 *   - Forex   → higher-frequency, higher volatility swings
 *   - Real Estate → slow and steady, low volatility
 *   - Stocks  → moderate
 *   - IT Business → growth-oriented with occasional upward jumps
 */
module.exports = [
  {
    id: 'pool_stocks',
    slug: 'stocks',
    name: 'Global Equities',
    short_desc: 'Diversified large-cap equity exposure across developed markets.',
    description:
      'A broad basket of global blue-chip equities weighted toward quality and ' +
      'dividend durability. The pool aims to compound steadily with the market ' +
      'cycle while dampening single-name risk through diversification.',
    risk_profile: 'Moderate',
    target_low_pct: 8,
    target_high_pct: 14,
    accent: '#E0B44C',
    drift_daily: 0.000414,
    vol_daily: 0.011,
    jump_prob: 0.0,
    jump_scale: 0.0,
    sort_order: 1,
  },
  {
    id: 'pool_forex',
    slug: 'forex',
    name: 'FX & Macro',
    short_desc: 'Actively managed major-currency and macro rate strategies.',
    description:
      'A systematic currency book trading the major pairs (EUR, GBP, JPY, CHF, ' +
      'AUD) alongside macro rate signals. Designed to capture short-horizon ' +
      'dislocations, it carries the highest short-term volatility of the four pools.',
    risk_profile: 'High',
    target_low_pct: 6,
    target_high_pct: 18,
    accent: '#48C9B0',
    drift_daily: 0.00035,
    vol_daily: 0.017,
    jump_prob: 0.0,
    jump_scale: 0.0,
    sort_order: 2,
  },
  {
    id: 'pool_realestate',
    slug: 'real-estate',
    name: 'Real Estate',
    short_desc: 'Income-oriented commercial and residential property exposure.',
    description:
      'A stabilised portfolio of income-producing property interests. Returns ' +
      'accrue slowly and steadily, driven by rent yield and gradual appreciation ' +
      'rather than market sentiment — the lowest-volatility pool of the four.',
    risk_profile: 'Low',
    target_low_pct: 5,
    target_high_pct: 9,
    accent: '#5FA8D3',
    drift_daily: 0.000268,
    vol_daily: 0.0035,
    jump_prob: 0.0,
    jump_scale: 0.0,
    sort_order: 3,
  },
  {
    id: 'pool_it',
    slug: 'it-business',
    name: 'IT & Ventures',
    short_desc: 'Growth-stage technology and software business exposure.',
    description:
      'A concentrated growth sleeve of technology and software businesses. It ' +
      'targets the highest long-run return of the four pools and can post ' +
      'occasional sharp upward re-ratings — with commensurately higher risk.',
    risk_profile: 'High / Growth',
    target_low_pct: 12,
    target_high_pct: 28,
    accent: '#A78BFA',
    drift_daily: 0.000561,
    vol_daily: 0.014,
    jump_prob: 0.02,
    jump_scale: 0.045,
    sort_order: 4,
  },
];
