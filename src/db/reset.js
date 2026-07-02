'use strict';

// Danger: wipes the demo database file and re-seeds. Demo convenience only —
// works for local embedded `file:` databases, not hosted libSQL/Turso.
const fs = require('fs');
const config = require('../config');

if (!config.db.url.startsWith('file:')) {
  console.error('reset only supports local file: databases (DB_URL is remote).');
  process.exit(1);
}

const file = config.db.url.slice('file:'.length);
for (const suffix of ['', '-wal', '-shm']) {
  if (fs.existsSync(file + suffix)) fs.rmSync(file + suffix);
}

require('./seed')
  .run()
  .then(() => {
    console.log('Database reset complete.');
    require('./index').client.close();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
