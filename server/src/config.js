'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isIP } = require('node:net');

function requireValue(env, name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integer(env, name, fallback, minimum, maximum) {
  const value = Number(env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function validHost(value) {
  if (isIP(value) === 4) return true;
  return value.length <= 253 && value.includes('.') && value.split('.').every(label =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)
  );
}

function validIpv4(value) { return isIP(value) === 4; }

function validWgSubnet(value) {
  const [address, prefix, extra] = String(value).split('/');
  const bits = Number(prefix);
  return !extra && validIpv4(address) && Number.isInteger(bits) && bits >= 16 && bits <= 30;
}

function validWgKey(value) {
  return typeof value === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(value) &&
    Buffer.from(value, 'base64').length === 32;
}

function loadConfig(env = process.env) {
  const routerUrl = requireValue(env, 'ROUTEROS_URL');
  let parsedRouterUrl;
  try { parsedRouterUrl = new URL(routerUrl); } catch { throw new Error('ROUTEROS_URL must be a valid HTTPS URL'); }
  if (parsedRouterUrl.protocol !== 'https:' || parsedRouterUrl.username || parsedRouterUrl.password ||
      parsedRouterUrl.search || parsedRouterUrl.hash) throw new Error('ROUTEROS_URL must be a valid HTTPS URL');
  if (!/^\/rest\/?$/.test(parsedRouterUrl.pathname)) throw new Error('ROUTEROS_URL path must be /rest');
  const publicHost = requireValue(env, 'PUBLIC_HOST');
  if (!validHost(publicHost)) throw new Error('PUBLIC_HOST must be a valid DNS name or IP address');
  const tokenSecret = requireValue(env, 'TOKEN_SECRET');
  const adminKey = requireValue(env, 'ADMIN_KEY');
  if (tokenSecret.length < 32 || adminKey.length < 32) throw new Error('TOKEN_SECRET and ADMIN_KEY must each be at least 32 characters');
  if (tokenSecret === adminKey) throw new Error('TOKEN_SECRET and ADMIN_KEY must be different');
  const routerPassword = requireValue(env, 'ROUTEROS_PASSWORD');
  if (routerPassword.length < 16) throw new Error('ROUTEROS_PASSWORD must have at least 16 characters');
  const wgServerPublicKey = requireValue(env, 'WG_SERVER_PUBLIC_KEY');
  if (!validWgKey(wgServerPublicKey)) throw new Error('WG_SERVER_PUBLIC_KEY must be a WireGuard public key');
  const wgSubnet = env.WG_SUBNET || '10.77.0.0/24';
  if (!validWgSubnet(wgSubnet)) throw new Error('WG_SUBNET must be an IPv4 /16 to /30');
  const wgDns = env.WG_DNS || '1.1.1.1';
  if (!validIpv4(wgDns)) throw new Error('WG_DNS must be an IPv4 address');
  const ovpnTransport = env.OVPN_TRANSPORT || 'tcp';
  if (!['tcp', 'udp'].includes(ovpnTransport)) throw new Error('OVPN_TRANSPORT must be tcp or udp');
  const ikev2Identity = env.IKEV2_IDENTITY || publicHost;
  if (!validHost(ikev2Identity)) throw new Error('IKEV2_IDENTITY must be a valid DNS name or IPv4 address');
  if (Boolean(env.API_TLS_CERT) !== Boolean(env.API_TLS_KEY)) throw new Error('API_TLS_CERT and API_TLS_KEY must be set together');
  if (!env.API_TLS_CERT && env.API_BEHIND_PROXY !== '1') throw new Error('Set API_TLS_CERT/API_TLS_KEY or API_BEHIND_PROXY=1');
  return {
    apiHost: env.API_HOST || '0.0.0.0',
    apiPort: integer(env, 'API_PORT', env.API_BEHIND_PROXY === '1' ? 8080 : 8443, 1, 65535),
    behindProxy: env.API_BEHIND_PROXY === '1',
    maxLoginFailureKeys: integer(env, 'MAX_LOGIN_FAILURE_KEYS', 10000, 100, 1000000),
    dataFile: env.DATA_FILE || '/data/state.json',
    tokenSecret, adminKey,
    tlsCert: env.API_TLS_CERT ? fs.readFileSync(env.API_TLS_CERT) : null,
    tlsKey: env.API_TLS_KEY ? fs.readFileSync(env.API_TLS_KEY) : null,
    router: { url: routerUrl.replace(/\/$/, ''), user: requireValue(env, 'ROUTEROS_USER'), password: routerPassword, ca: env.ROUTEROS_CA_CERT ? fs.readFileSync(env.ROUTEROS_CA_CERT) : null },
    publicHost,
    wireguard: {
      interface: env.WG_INTERFACE || 'bridge-wg',
      serverPublicKey: wgServerPublicKey,
      port: integer(env, 'WG_PORT', 51820, 1, 65535),
      subnet: wgSubnet,
      dns: wgDns
    },
    openvpn: {
      port: integer(env, 'OVPN_PORT', 1194, 1, 65535),
      transport: ovpnTransport,
      caPem: fs.readFileSync(env.OVPN_CA_CERT || path.join(__dirname, '..', 'certs', 'isrgrootx1.pem'), 'utf8')
    },
    ikev2: {
      identity: ikev2Identity,
      caPem: env.IKEV2_CA_CERT ? fs.readFileSync(env.IKEV2_CA_CERT, 'utf8') : null
    },
    leaseSeconds: integer(env, 'LEASE_SECONDS', 86400, 60, 31536000),
    reconcileSeconds: integer(env, 'RECONCILE_SECONDS', 15, 5, 3600),
    radiusCleanupSeconds: integer(env, 'RADIUS_CLEANUP_SECONDS', 300, 0, 604800),
    stateRetentionSeconds: integer(env, 'STATE_RETENTION_SECONDS', 2592000, 3600, 31536000)
  };
}

module.exports = { loadConfig };
