import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const generator = resolve('deploy/generate-routeros.mjs');
const siteCreator = resolve('deploy/create-site.mjs');
const fixture = {
  publicHost: 'vpn.example.com',
  containerImage: 'ghcr.io/example/mikrolink:1.0',
  disk: 'disk1',
  routerOsUser: 'mikrolink-api',
  routerOsPassword: 'a_long_password_with_$_and_"_and_\\',
  adminKey: 'a'.repeat(40),
  tokenSecret: 'b'.repeat(40),
  radiusSecret: 'c'.repeat(40),
};

test('creates script-driven VPN setup with private REST and all three protocols', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mikrolink-'));
  try {
    const input = join(directory, 'site.json');
    const output = join(directory, 'install.rsc');
    writeFileSync(input, JSON.stringify(fixture));
    execFileSync(process.execPath, [generator, input, output]);
    const script = readFileSync(output, 'utf8');
    for (const text of [
      '/interface/wireguard/add name=bridge-wg',
      '/interface/ovpn-server/server/add name=mikrolink-ovpn',
      '/ip/ipsec/identity/add auth-method=eap-radius',
      '/container/add name=mikrolink-api',
      '/container/config/set registry-url=https://ghcr.io',
      'remote-image="example/mikrolink:1.0"',
      'available-from=172.31.222.2/32',
      'chain=input action=drop in-interface-list=WAN protocol=tcp dst-port=8443',
      'hosts="vpn.example.com=172.31.222.1"',
      'chain=forward action=accept src-address=10.77.0.0/24 out-interface-list=WAN',
      'chain=forward action=accept src-address=10.78.0.0/24 out-interface-list=WAN',
      'chain=forward action=accept src-address=10.79.0.0/24 out-interface-list=WAN',
      'chain=forward action=accept dst-address=10.77.0.0/24 in-interface-list=WAN connection-state=established,related',
      '/ip/ipsec/settings/set accounting=yes interim-update=1m',
      'policy=read,write,api,rest-api',
      'password="a_long_password_with_\\$_and_\\"_and_\\\\"',
    ]) assert.ok(script.includes(text), `missing ${text}`);
    assert.doesNotMatch(script, /policy=read,write,sensitive,api,rest-api/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects unsafe host before writing any RouterOS script', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mikrolink-'));
  try {
    const input = join(directory, 'site.json');
    const output = join(directory, 'install.rsc');
    writeFileSync(input, JSON.stringify({ ...fixture, publicHost: 'a.com; /system/reset-configuration' }));
    assert.throws(() => execFileSync(process.execPath, [generator, input, output], { stdio: 'pipe' }));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('creates a private site manifest with four distinct random secrets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mikrolink-'));
  try {
    const output = join(directory, 'site.json');
    const stdout = execFileSync(process.execPath, [
      siteCreator, 'VPN.Example.com', 'ghcr.io/example/mikrolink:1.0', 'disk1', output
    ], { encoding: 'utf8' });
    const site = JSON.parse(readFileSync(output, 'utf8'));
    const secrets = [site.routerOsPassword, site.adminKey, site.tokenSecret, site.radiusSecret];
    assert.equal(site.publicHost, 'vpn.example.com');
    assert.equal(new Set(secrets).size, 4);
    assert.ok(secrets.every(value => typeof value === 'string' && value.length >= 32));
    assert.ok(secrets.every(value => !stdout.includes(value)));
    assert.throws(() => execFileSync(process.execPath, [
      siteCreator, 'vpn.example.com', 'ghcr.io/example/mikrolink:1.0', 'disk1', output
    ], { stdio: 'pipe' }));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
