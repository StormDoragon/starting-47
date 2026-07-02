'use strict';

const { run, get, all } = require('../db');
const { newId } = require('../utils/id');

async function create({ userId, poolId, principalCents, depositedAt, lockEndAt }) {
  const id = newId('pos');
  await run(
    `INSERT INTO positions
       (id, user_id, pool_id, principal_cents, deposited_at, lock_end_at, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    [id, userId, poolId, principalCents, depositedAt, lockEndAt],
  );
  return get('SELECT * FROM positions WHERE id = ?', [id]);
}

function markWithdrawn(id) {
  return run("UPDATE positions SET status = 'withdrawn' WHERE id = ?", [id]);
}

module.exports = {
  create,
  byId: (id) => get('SELECT * FROM positions WHERE id = ?', [id]),
  byUser: (uid) => all('SELECT * FROM positions WHERE user_id = ? ORDER BY created_at ASC', [uid]),
  activeByUser: (uid) =>
    all("SELECT * FROM positions WHERE user_id = ? AND status = 'active' ORDER BY created_at ASC", [
      uid,
    ]),
  allActive: () => all("SELECT * FROM positions WHERE status = 'active'"),
  markWithdrawn,
};
