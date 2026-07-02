'use strict';

const { run, all } = require('../db');
const { newId } = require('../utils/id');

async function create({ userId, positionId = null, type, amountCents, status = 'completed', meta = null }) {
  const id = newId('txn');
  await run(
    `INSERT INTO transactions (id, user_id, position_id, type, amount_cents, status, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, positionId, type, amountCents, status, meta ? JSON.stringify(meta) : null],
  );
  return id;
}

module.exports = {
  create,
  byUser: async (uid) =>
    (
      await all('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC, id DESC', [
        uid,
      ])
    ).map((t) => ({ ...t, meta: t.meta ? JSON.parse(t.meta) : null })),
};
