'use strict';

// Danger: wipes the demo database file and re-seeds. Demo convenience only.
const fs = require('fs');
const config = require('../config');

for (const suffix of ['', '-wal', '-shm']) {
  const f = config.db.file + suffix;
  if (fs.existsSync(f)) fs.rmSync(f);
}

require('./seed').run();
console.log('Database reset complete.');
