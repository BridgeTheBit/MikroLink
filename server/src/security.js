'use strict';

const crypto = require('node:crypto');

function hashPassword(password, salt = crypto.randomBytes(16)) {
  if (typeof password !== 'string' || password.length < 10) throw new Error('Password must have at least 10 characters');
  return `scrypt$${salt.toString('base64url')}$${crypto.scryptSync(password, salt, 64).toString('base64url')}`;
}

function verifyPassword(password, encoded) {
  try {
    const [name, salt, digest] = encoded.split('$');
    if (name !== 'scrypt') return false;
    const expected = Buffer.from(digest, 'base64url');
    const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64url'), expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}

function issueToken(userId, secret, seconds = 3600) {
  const expiresAt = new Date(Date.now() + seconds * 1000).toISOString();
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + seconds, nonce: crypto.randomBytes(8).toString('hex') })).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return { token: `${payload}.${mac}`, expiresAt };
}

function verifyToken(token, secret) {
  try {
    const [payload, mac, rest] = token.split('.');
    if (!payload || !mac || rest) return null;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest();
    const actual = Buffer.from(mac, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isInteger(data.exp) && data.exp > Date.now() / 1000 ? data.sub : null;
  } catch { return null; }
}

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a || '')).digest();
  const y = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(x, y);
}

function randomSecret(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
function id() { return crypto.randomUUID(); }

function leaseCapability(lease, secret) {
  return crypto.createHmac('sha256', secret).update(`release:${lease.id}:${lease.userId}:${lease.expiresAt}`).digest('base64url');
}
function verifyLeaseCapability(lease, capability, secret) { return safeEqual(leaseCapability(lease, secret), capability); }

function seal(value, secret) {
  const key = crypto.createHash('sha256').update(secret).digest();
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [nonce, cipher.getAuthTag(), ciphertext].map(x => x.toString('base64url')).join('.');
}

function unseal(value, secret) {
  const [nonce, tag, ciphertext] = value.split('.').map(x => Buffer.from(x, 'base64url'));
  const key = crypto.createHash('sha256').update(secret).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

module.exports = { hashPassword, verifyPassword, issueToken, verifyToken, safeEqual, randomSecret, id, seal, unseal, leaseCapability, verifyLeaseCapability };
