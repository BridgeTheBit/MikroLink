#!/usr/bin/env node
// Create a local deployment manifest with cryptographically random, distinct secrets.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [host, image, disk = 'disk1', output = 'deploy/site.json'] = process.argv.slice(2);
if (!host || !image) {
  console.error('Usage: node deploy/create-site.mjs <public-host> <container-image> [disk] [output.json]');
  process.exit(2);
}
if (host.length > 253 || !host.includes('.') || host.split('.').some(label =>
  !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) throw new Error('Invalid public host');
if (!/^[a-z0-9][a-z0-9._:/@-]+$/i.test(image)) throw new Error('Invalid container image');
if (!/^[a-z0-9][a-z0-9._-]*$/i.test(disk)) throw new Error('Invalid disk name');

const secret = () => randomBytes(32).toString('base64url');
const manifest = {
  publicHost: host.toLowerCase(),
  containerImage: image,
  disk,
  routerOsUser: 'mikrolink-api',
  routerOsPassword: secret(),
  adminKey: secret(),
  tokenSecret: secret(),
  radiusSecret: secret(),
  wgPort: 51820,
  wgDns: '1.1.1.1',
  ovpnPort: 1194,
  ovpnTransport: 'tcp'
};
const target = resolve(output);
writeFileSync(target, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(`Created ${target}. Secrets were written only to that file.`);
