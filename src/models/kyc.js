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

function create(data) {
  const id = newId('kyc');
  // Demo: submissions are auto-approved. Nothing is verified against a real service.
  insert.run({ id, status: 'approved', ...data });
  return byUser.get(data.user_id);
}

module.exports = { create, byUser: (uid) => byUser.get(uid) };
