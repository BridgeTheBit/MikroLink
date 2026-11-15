'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { Store } = require('../src/store');
const { Service } = require('../src/service');
const { createHandler } = require('../src/http');
const { verifyToken } = require('../src/security');

class FakeRouter {
  constructor() { this.tables = new Map(); this.next = 1; }
  table(path) { if (!this.tables.has(path)) this.tables.set(path, []); return this.tables.get(path); }
  async get(path) { return this.table(path).map(x => ({ ...x })); }
  async put(path, value) { const row = { '.id': `*${this.next++}`, ...value }; this.table(path).push(row); return row; }
  async patch(path, value) {
    const [base, id] = path.match(/^(.*)\/([^/]+)$/).slice(1);
    const row = this.table(base).find(x => x['.id'] === id);
    assert.ok(row, `Missing ${path}`);
    Object.assign(row, value); return { ...row };
  }
  async delete(path) {
    const [base, id] = path.match(/^(.*)\/([^/]+)$/).slice(1);
    const table = this.table(base), index = table.findIndex(x => x['.id'] === id);
    assert.ok(index >= 0, `Missing ${path}`); table.splice(index, 1);
  }
  async find(path, predicate) { return (await this.get(path)).find(predicate); }
  async upsert(path, name, value) { const row = await this.find(path, x => x.name === name); return row ? this.patch(`${path}/${row['.id']}`, value) : this.put(path, { name, ...value }); }
}

async function fixture() {
  const file = path.join(__dirname, `${crypto.randomUUID()}.json`);
  const store = new Store(file); await store.load();
  const router = new FakeRouter();
  const config = {
    tokenSecret: 't'.repeat(40), publicHost: 'vpn.example.test', leaseSeconds: 3600,
    wireguard: { interface: 'ml-wg', serverPublicKey: Buffer.alloc(32, 3).toString('base64'), port: 51820, subnet: '10.77.0.0/24', dns: '1.1.1.1' },
    openvpn: { transport: 'tcp', port: 1194, caPem: null },
    ikev2: { identity: 'vpn.example.test', caPem: null }
  };
  const service = new Service(store, router, config);
  const manifest = {
    configs: [
      { id: 'wg', name: 'WireGuard', protocol: 'wireguard' },
      { id: 'ovpn', name: 'OpenVPN', protocol: 'openvpn' },
      { id: 'ike', name: 'IKEv2', protocol: 'ikev2' }
    ],
    users: [{ username: 'alice', password: 'strong-password-123', allowedConfigs: ['wg', 'ovpn', 'ike'], maxConnections: 2, quotaBytes: 100 }]
  };
  await service.apply(manifest);
  const user = store.state.users[0];
  return { file, store, router, config, service, user };
}

test('login token, permitted catalog, device-owned WireGuard key and quota revocation', async () => {
  const f = await fixture();
  try {
    const session = await f.service.login('alice', 'strong-password-123');
    assert.equal(verifyToken(session.token, f.config.tokenSecret), f.user.id);
    await assert.rejects(f.service.login('alice', 'wrong-password'), /Invalid credentials/);
    assert.equal(f.service.catalog(f.user).length, 3);
    const publicKey = Buffer.alloc(32, 1).toString('base64');
    const lease = await f.service.lease(f.user, 'wg', { deviceId: 'phone-1', publicKey });
    assert.equal(lease.protocol, 'wireguard');
    assert.equal(lease.configuration.address, '10.77.0.2/32');
    assert.equal(lease.configuration.endpoint, 'vpn.example.test:51820');
    assert.equal(lease.configuration.privateKey, undefined);
    assert.equal(f.router.table('interface/wireguard/peers')[0]['public-key'], publicKey);
    f.router.table('interface/wireguard/peers')[0].rx = '51';
    f.router.table('interface/wireguard/peers')[0].tx = '50';
    await f.service.reconcile();
    assert.equal(f.user.usedBytes, 101);
    assert.equal(f.router.table('interface/wireguard/peers').length, 0);
    await assert.rejects(f.service.lease(f.user, 'wg', { deviceId: 'phone-2', publicKey }), /expired or disabled/);
  } finally { await fs.unlink(f.file); }
});

test('OpenVPN and IKEv2 leases get distinct revocable User Manager accounts', async () => {
  const f = await fixture();
  try {
    const ovpn = await f.service.lease(f.user, 'ovpn', { deviceId: 'phone-1' });
    const ike = await f.service.lease(f.user, 'ike', { deviceId: 'phone-2' });
    assert.match(ovpn.configuration.profile, /remote vpn\.example\.test 1194/);
    assert.match(ovpn.configuration.profile, /cipher AES-256-CBC/);
    assert.match(ovpn.configuration.profile, /setenv CLIENT_CERT 0/);
    assert.notEqual(ovpn.configuration.username, ike.configuration.username);
    assert.equal(f.router.table('user-manager/user').length, 2);
    assert.equal(f.router.table('user-manager/profile').length, 2);
    await assert.rejects(f.service.lease(f.user, 'ovpn', { deviceId: 'phone-3' }), /limit reached/);
    await f.service.release(f.user, ovpn.id);
    const account = f.router.table('user-manager/user').find(x => x.name === ovpn.configuration.username);
    assert.equal(account.disabled, 'yes');
  } finally { await fs.unlink(f.file); }
});

test('invalid manifest leaves current users and configs unchanged', async () => {
  const f = await fixture();
  try {
    const before = JSON.stringify(f.store.state);
    await assert.rejects(f.service.apply({ configs: [{ id: 'extra', name: 'Extra', protocol: 'wireguard' }], users: [{ username: 'bob', password: 'valid-password-123', allowedConfigs: ['extra'] }, { username: 'charlie', password: 'short', allowedConfigs: ['extra'] }] }), /Password must have at least 10 characters/);
    assert.equal(JSON.stringify(f.store.state), before);
  } finally { await fs.unlink(f.file); }
});

test('resetUsage explicitly clears an existing user counter', async () => {
  const f = await fixture();
  try {
    f.user.usedBytes = 91;
    await f.service.apply({
      configs: f.store.state.configs.map(({ id, name, protocol }) => ({ id, name, protocol })),
      users: [{ username: 'alice', allowedConfigs: ['wg', 'ovpn', 'ike'], quotaBytes: 100, maxConnections: 2, resetUsage: true }]
    });
    assert.equal(f.store.state.users[0].usedBytes, 0);
  } finally { await fs.unlink(f.file); }
});

test('partial User Manager provisioning is cleaned up', async () => {
  const f = await fixture();
  try {
    const put = f.router.put.bind(f.router);
    f.router.put = (path, value) => path === 'user-manager/user' ? Promise.reject(new Error('simulated RouterOS failure')) : put(path, value);
    await assert.rejects(f.service.lease(f.user, 'ovpn', { deviceId: 'phone-1' }), /simulated RouterOS failure/);
    assert.equal(f.store.state.leases.length, 0);
    for (const path of ['user-manager/limitation', 'user-manager/profile', 'user-manager/profile-limitation', 'user-manager/user']) assert.equal(f.router.table(path).length, 0);
  } finally { await fs.unlink(f.file); }
});

test('HTTP login, catalog, lease, release and admin-key rejection', async () => {
  const f = await fixture();
  const server = http.createServer(createHandler(f.service, { ...f.config, adminKey: 'a'.repeat(40) }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const admin = await fetch(`${base}/v1/admin/apply`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': 'wrong' }, body: JSON.stringify({ configs: [], users: [] }) });
    assert.equal(admin.status, 401);
    const login = await fetch(`${base}/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'strong-password-123' }) });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };
    const catalog = await fetch(`${base}/v1/configs`, { headers });
    assert.equal(catalog.status, 200);
    assert.equal((await catalog.json()).length, 3);
    const lease = await fetch(`${base}/v1/configs/wg/lease`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: 'phone-1', publicKey: Buffer.alloc(32, 1).toString('base64') }) });
    assert.equal(lease.status, 201);
    const leased = await lease.json();
    assert.equal(leased.configuration.address, '10.77.0.2/32');
    const badRelease = await fetch(`${base}/v1/leases/${leased.id}`, { method: 'DELETE', headers: { Authorization: 'Lease invalid' } });
    assert.equal(badRelease.status, 401);
    const release = await fetch(`${base}/v1/leases/${leased.id}`, { method: 'DELETE', headers: { Authorization: `Lease ${leased.releaseToken}` } });
    assert.equal(release.status, 204);
    assert.equal(f.router.table('interface/wireguard/peers').length, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.unlink(f.file);
  }
});

test('malformed RouterOS counters cannot corrupt quota state', async () => {
  const f = await fixture();
  try {
    await f.service.lease(f.user, 'wg', { deviceId: 'phone-1', publicKey: Buffer.alloc(32, 1).toString('base64') });
    f.router.table('interface/wireguard/peers')[0].rx = 'invalid';
    await assert.rejects(f.service.reconcile(), /Invalid RouterOS byte counter/);
    assert.equal(f.user.usedBytes, 0);
  } finally { await fs.unlink(f.file); }
});

test('login throttle resets after its one-minute window', async () => {
  const f = await fixture();
  let now = 1_000_000;
  const server = http.createServer(createHandler(f.service, { ...f.config, adminKey: 'a'.repeat(40) }, () => now));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/v1/auth/login`;
  const attempt = () => fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'wrong-password' })
  });
  try {
    for (let i = 0; i < 5; i++) assert.equal((await attempt()).status, 401);
    assert.equal((await attempt()).status, 429);
    now += 60_001;
    assert.equal((await attempt()).status, 401);
    for (let i = 0; i < 4; i++) assert.equal((await attempt()).status, 401);
    assert.equal((await attempt()).status, 429);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.unlink(f.file);
  }
});
