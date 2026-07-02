'use strict';

const { db } = require('../db');

const all = db.prepare('SELECT * FROM pools ORDER BY sort_order ASC');
const byId = db.prepare('SELECT * FROM pools WHERE id = ?');
const bySlug = db.prepare('SELECT * FROM pools WHERE slug = ?');

module.exports = {
  all: () => all.all(),
  byId: (id) => byId.get(id),
  bySlug: (slug) => bySlug.get(slug),
};
