'use strict';

const { db } = require('../db');
const { newId } = require('../utils/id');

const insert = db.prepare(`
  INSERT INTO kyc_submissions
    (id, user_id, full_name, dob, country, address, id_doc_type, id_doc_ref, status)
  VALUES (@id, @user_id, @full_name, @dob, @country, @address, @id_doc_type, @id_doc_ref, @status)
`);
const byUser = db.prepare(
  'SELECT * FROM kyc_submissions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
);
const byId = db.prepare('SELECT * FROM kyc_submissions WHERE id = ?');
const setStatus = db.prepare('UPDATE kyc_submissions SET status = ? WHERE id = ?');

function create(data) {
  const id = newId('kyc');
  // Demo submissions may be auto-approved by configuration; otherwise they stay
  // pending for review by whatever production workflow is added later.
  insert.run({ id, status: data.status || 'pending', ...data });
  return byUser.get(data.user_id);
}

module.exports = {
  create,
  byUser: (uid) => byUser.get(uid),
  byId: (id) => byId.get(id),
  setStatus: (id, status) => setStatus.run(status, id),
};
