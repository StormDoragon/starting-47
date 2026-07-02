'use strict';

const { db, migrate } = require('./index');
const pools = require('./pools');

/** Insert (or refresh) the four investment pools. Idempotent. */
function seedPools() {
  const upsert = db.prepare(`
    INSERT INTO pools (id, slug, name, short_desc, description, risk_profile,
                       target_low_pct, target_high_pct, accent,
                       drift_daily, vol_daily, jump_prob, jump_scale, sort_order)
    VALUES (@id, @slug, @name, @short_desc, @description, @risk_profile,
            @target_low_pct, @target_high_pct, @accent,
            @drift_daily, @vol_daily, @jump_prob, @jump_scale, @sort_order)
    ON CONFLICT(id) DO UPDATE SET
      slug=@slug, name=@name, short_desc=@short_desc, description=@description,
      risk_profile=@risk_profile, target_low_pct=@target_low_pct,
      target_high_pct=@target_high_pct, accent=@accent,
      drift_daily=@drift_daily, vol_daily=@vol_daily, jump_prob=@jump_prob,
      jump_scale=@jump_scale, sort_order=@sort_order
  `);
  const tx = db.transaction((rows) => rows.forEach((r) => upsert.run(r)));
  tx(pools);
}

function run() {
  migrate();
  seedPools();
  console.log(`Seeded ${pools.length} pools into the database.`);
}

if (require.main === module) run();

module.exports = { seedPools, run };
