'use strict';

const config = require('./src/config');
const { createApp } = require('./src/app');
const engine = require('./src/services/performanceEngine');

const app = createApp();

const server = app.listen(config.port, config.host, () => {
  const url = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
  console.log(`\n  ${config.brand.name} — demo platform (simulation only)`);
  console.log(`  Listening on ${url}`);
  console.log(`  ${config.brand.disclaimer}\n`);
  // Start the live simulated performance engine.
  engine.start();
});

function shutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down...`);
  engine.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = server;
