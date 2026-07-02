'use strict';

const config = require('./src/config');
const { createApp } = require('./src/app');
const engine = require('./src/services/performanceEngine');

let server;

createApp()
  .then((app) => {
    server = app.listen(config.port, config.host, () => {
      const url = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
      console.log(`\n  ${config.brand.name} — demo platform (simulation only)`);
      console.log(`  Listening on ${url}`);
      console.log(`  ${config.brand.disclaimer}\n`);
      // Start the live simulated performance engine (long-running hosts only;
      // in lazy mode ticks are generated on portfolio reads instead).
      if (config.engine.mode === 'interval') {
        engine.start();
      } else {
        console.log('  Engine mode: lazy (ticks are generated on portfolio reads)');
      }
    });
  })
  .catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
  });

function shutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down...`);
  engine.stop();
  if (server) server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
