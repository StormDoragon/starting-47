'use strict';

const { batch, migrate, client } = require('./index');
const pools = require('./pools');

const UPSERT = `
  INSERT INTO pools (id, slug, name, short_desc, description, risk_profile,
                     target_low_pct, target_high_pct, accent,
                     drift_daily, vol_daily, jump_prob, jump_scale, sort_order)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    slug=excluded.slug, name=excluded.name, short_desc=excluded.short_desc,
    description=excluded.description, risk_profile=excluded.risk_profile,
    target_low_pct=excluded.target_low_pct, target_high_pct=excluded.target_high_pct,
    accent=excluded.accent, drift_daily=excluded.drift_daily,
    vol_daily=excluded.vol_daily, jump_prob=excluded.jump_prob,
    jump_scale=excluded.jump_scale, sort_order=excluded.sort_order
`;

/** Insert (or refresh) the four investment pools. Idempotent. */
async function seedPools() {
  await batch(
    pools.map((p) => ({
      sql: UPSERT,
      args: [
        p.id, p.slug, p.name, p.short_desc, p.description, p.risk_profile,
        p.target_low_pct, p.target_high_pct, p.accent,
        p.drift_daily, p.vol_daily, p.jump_prob, p.jump_scale, p.sort_order,
      ],
    })),
  );
}

async function run() {
  await migrate();
  await seedPools();
  console.log(`Seeded ${pools.length} pools into the database.`);
}

if (require.main === module) {
  run()
    .then(() => client.close())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { seedPools, run };
