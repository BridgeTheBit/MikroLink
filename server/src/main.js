'use strict';

const http = require('node:http');
const https = require('node:https');
const { loadConfig } = require('./config');
const { Store } = require('./store');
const { RouterOS } = require('./routeros');
const { Service } = require('./service');
const { createHandler } = require('./http');

async function main() {
  const config = loadConfig();
  const store = new Store(config.dataFile);
  await store.load();
  const service = new Service(store, new RouterOS(config.router), config);
  const handler = createHandler(service, config);
  const server = config.tlsCert ? https.createServer({ cert: config.tlsCert, key: config.tlsKey }, handler) : http.createServer(handler);
  server.listen(config.apiPort, config.apiHost, () => console.log(`MikroLink API listening on ${config.apiHost}:${config.apiPort}`));
  const timer = setInterval(() => service.reconcile().catch(error => console.error('Reconcile error:', error)), config.reconcileSeconds * 1000);
  timer.unref();
  process.on('SIGTERM', () => server.close());
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
