'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

function env(overrides = {}) {
  return {
    ROUTEROS_URL: 'https://vpn.example.com:8443/rest',
    ROUTEROS_USER: 'mikrolink-api',
    ROUTEROS_PASSWORD: 'router-password-long',
    PUBLIC_HOST: 'vpn.example.com',
    TOKEN_SECRET: 't'.repeat(40),
    ADMIN_KEY: 'a'.repeat(40),
    WG_SERVER_PUBLIC_KEY: Buffer.alloc(32, 3).toString('base64'),
    API_BEHIND_PROXY: '1',
    ...overrides
  };
}

test('loads a valid RouterOS-backed proxy configuration', () => {
  const config = loadConfig(env());
  assert.equal(config.behindProxy, true);
  assert.equal(config.apiPort, 8080);
  assert.equal(config.publicHost, 'vpn.example.com');
  assert.equal(config.wireguard.port, 51820);
});

test('rejects unsafe or ambiguous runtime configuration', () => {
  assert.throws(() => loadConfig(env({ ROUTEROS_URL: 'http://vpn.example.com:8443/rest' })), /HTTPS/);
  assert.throws(() => loadConfig(env({ WG_SERVER_PUBLIC_KEY: 'invalid' })), /WireGuard public key/);
  assert.throws(() => loadConfig(env({ WG_PORT: 'not-a-port' })), /WG_PORT/);
  assert.throws(() => loadConfig(env({ TOKEN_SECRET: 'a'.repeat(40), ADMIN_KEY: 'a'.repeat(40) })), /different/);
});
