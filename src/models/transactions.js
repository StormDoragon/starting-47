'use strict';

const { db } = require('../db');
const { newId } = require('../utils/id');

const insert = db.prepare(`
  INSERT INTO transactions (id, user_id, position_id, type, amount_cents, status, meta)
  VALUES (@id, @user_id, @position_id, @type, @amount_cents, @status, @meta)
`);
const byUser = db.prepare(
  'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC, id DESC',
);

function create({ userId, positionId = null, type, amountCents, status = 'completed', meta = null }) {
  const id = newId('txn');
  insert.run({
    id,
    user_id: userId,
    position_id: positionId,
    type,
    amount_cents: amountCents,
    status,
    meta: meta ? JSON.stringify(meta) : null,
  });
  return id;
}

module.exports = {
  create,
  byUser: (uid) =>
    byUser.all(uid).map((t) => ({ ...t, meta: t.meta ? JSON.parse(t.meta) : null })),
};
