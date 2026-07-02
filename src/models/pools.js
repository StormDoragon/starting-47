'use strict';

const { get, all } = require('../db');

module.exports = {
  all: () => all('SELECT * FROM pools ORDER BY sort_order ASC'),
  byId: (id) => get('SELECT * FROM pools WHERE id = ?', [id]),
  bySlug: (slug) => get('SELECT * FROM pools WHERE slug = ?', [slug]),
};
