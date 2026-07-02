'use strict';

const { db } = require('../db');
const { newId } = require('../utils/id');

const insert = db.prepare(`
  INSERT INTO positions
    (id, user_id, pool_id, principal_cents, deposited_at, lock_end_at, status)
  VALUES (@id, @user_id, @pool_id, @principal_cents, @deposited_at, @lock_end_at, 'active')
`);
const byUser = db.prepare(
  "SELECT * FROM positions WHERE user_id = ? ORDER BY created_at ASC",
);
const activeByUser = db.prepare(
  "SELECT * FROM positions WHERE user_id = ? AND status = 'active' ORDER BY created_at ASC",
);
const byId = db.prepare('SELECT * FROM positions WHERE id = ?');
const allActive = db.prepare("SELECT * FROM positions WHERE status = 'active'");

function create({ userId, poolId, principalCents, depositedAt, lockEndAt }) {
  const id = newId('pos');
  insert.run({
    id,
    user_id: userId,
    pool_id: poolId,
    principal_cents: principalCents,
    deposited_at: depositedAt,
    lock_end_at: lockEndAt,
  });
  return byId.get(id);
}

function markWithdrawn(id) {
  db.prepare("UPDATE positions SET status = 'withdrawn' WHERE id = ?").run(id);
}

module.exports = {
  create,
  byId: (id) => byId.get(id),
  byUser: (uid) => byUser.all(uid),
  activeByUser: (uid) => activeByUser.all(uid),
  allActive: () => allActive.all(),
  markWithdrawn,
};
