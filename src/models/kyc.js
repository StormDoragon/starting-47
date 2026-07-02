'use strict';

const { run, get } = require('../db');
const { newId } = require('../utils/id');

const byUser = (uid) =>
  get('SELECT * FROM kyc_submissions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [uid]);

async function create(data) {
  const id = newId('kyc');
  // Demo: submissions are auto-approved. Nothing is verified against a real service.
  await run(
    `INSERT INTO kyc_submissions
       (id, user_id, full_name, dob, country, address, id_doc_type, id_doc_ref, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
    [
      id,
      data.user_id,
      data.full_name,
      data.dob,
      data.country,
      data.address,
      data.id_doc_type,
      data.id_doc_ref,
    ],
  );
  return byUser(data.user_id);
}

module.exports = { create, byUser };
