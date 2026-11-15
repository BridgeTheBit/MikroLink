'use strict';

const { hashPassword, verifyPassword, issueToken, randomSecret, id, seal, unseal, leaseCapability, verifyLeaseCapability } = require('./security');
const { allocateAddress } = require('./address');

const PROTOCOLS = new Set(['wireguard', 'openvpn', 'ikev2']);
const WG_KEY = /^[A-Za-z0-9+/]{43}=$/;

class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }

function positiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new ApiError(400, 'Invalid numeric policy');
  return value;
}
function validDeviceId(value) { return typeof value === 'string' && /^[a-zA-Z0-9._-]{4,100}$/.test(value); }
function routerCounter(value) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('Invalid RouterOS byte counter');
  return number;
}
function expired(user) { return !user.enabled || (user.expiresAt && Date.parse(user.expiresAt) <= Date.now()) || (user.quotaBytes > 0 && user.usedBytes >= user.quotaBytes); }
function publicUser(user) { return { id: user.id, username: user.username, enabled: user.enabled, maxConnections: user.maxConnections, quotaBytes: user.quotaBytes, usedBytes: user.usedBytes, expiresAt: user.expiresAt, allowedConfigs: user.allowedConfigs }; }

class Service {
  constructor(store, router, config) { this.store = store; this.router = router; this.config = config; }
  async login(username, password) {
    const user = this.store.state.users.find(x => x.username === username);
    if (!user || !verifyPassword(password, user.passwordHash) || expired(user)) throw new ApiError(401, 'Invalid credentials or inactive account');
    return issueToken(user.id, this.config.tokenSecret);
  }
  userById(id) { return this.store.state.users.find(x => x.id === id && !expired(x)); }
  catalog(user) { return this.store.state.configs.filter(x => x.enabled && user.allowedConfigs.includes(x.id)).map(({ id, name, protocol, description }) => ({ id, name, protocol, description })); }
  async apply(manifest) {
    if (!manifest || !Array.isArray(manifest.configs) || !Array.isArray(manifest.users)) throw new ApiError(400, 'Manifest needs configs and users arrays');
    return this.store.locked(async state => {
      const next = structuredClone(state);
      for (const item of manifest.configs) {
        if (!/^[a-zA-Z0-9._-]{2,60}$/.test(item.id || '') || !PROTOCOLS.has(item.protocol) || typeof item.name !== 'string' || item.name.length > 100) throw new ApiError(400, 'Invalid config');
        const existing = next.configs.find(x => x.id === item.id);
        if (existing && existing.protocol !== item.protocol) throw new ApiError(400, 'Config protocol is immutable');
        const entry = { id: item.id, name: item.name, protocol: item.protocol, description: String(item.description || '').slice(0, 300), enabled: item.enabled !== false };
        if (existing) Object.assign(existing, entry); else next.configs.push(entry);
      }
      for (const item of manifest.users) {
        if (!/^[a-zA-Z0-9._-]{3,64}$/.test(item.username || '')) throw new ApiError(400, 'Invalid username');
        if (item.password !== undefined && (typeof item.password !== 'string' || item.password.length < 10)) throw new ApiError(400, 'Password must have at least 10 characters');
        if (item.resetUsage !== undefined && typeof item.resetUsage !== 'boolean') throw new ApiError(400, 'resetUsage must be boolean');
        const allowedConfigs = item.allowedConfigs;
        if (!Array.isArray(allowedConfigs) || allowedConfigs.some(x => !next.configs.some(c => c.id === x))) throw new ApiError(400, 'Unknown allowed config');
        const maxConnections = positiveInt(item.maxConnections, 1, 20);
        if (maxConnections < 1) throw new ApiError(400, 'maxConnections must be at least 1');
        const quotaBytes = positiveInt(item.quotaBytes, 0);
        const expiresAt = item.expiresAt || null;
        if (expiresAt && Number.isNaN(Date.parse(expiresAt))) throw new ApiError(400, 'Invalid expiresAt');
        let user = next.users.find(x => x.username === item.username);
        if (!user) {
          if (!item.password) throw new ApiError(400, 'New user needs password');
          user = { id: id(), username: item.username, passwordHash: hashPassword(item.password), enabled: item.enabled !== false, maxConnections, quotaBytes, usedBytes: 0, expiresAt, allowedConfigs };
          next.users.push(user);
        } else {
          if (item.password) user.passwordHash = hashPassword(item.password);
          Object.assign(user, { enabled: item.enabled !== false, maxConnections, quotaBytes, expiresAt, allowedConfigs });
          if (item.resetUsage) user.usedBytes = 0;
        }
      }
      this.store.state = next;
      try { await this.store.save(); }
      catch (error) { this.store.state = state; throw error; }
      return { configs: next.configs.length, users: next.users.map(publicUser) };
    });
  }
  async provisionRadius(user, lease) {
    const credentials = lease.radius;
    const name = credentials.username;
    const profile = `${name}-profile`;
    const limit = `${name}-limit`;
    const duration = Math.max(1, Math.floor((Date.parse(lease.expiresAt) - Date.now()) / 1000));
    const remainingBytes = user.quotaBytes ? Math.max(1, user.quotaBytes - user.usedBytes) : 0;
    await this.router.upsert('user-manager/limitation', limit, { 'transfer-limit': String(remainingBytes), comment: `MikroLink ${lease.protocol} ${lease.id}` });
    await this.router.upsert('user-manager/profile', profile, { validity: `${duration}s`, 'starts-when': 'assigned' });
    const links = await this.router.get('user-manager/profile-limitation');
    if (!links.some(x => x.profile === profile && x.limitation === limit)) await this.router.put('user-manager/profile-limitation', { profile, limitation: limit });
    await this.router.upsert('user-manager/user', name, { password: unseal(credentials.password, this.config.tokenSecret), 'shared-users': '1', disabled: 'no', comment: `MikroLink ${user.id} ${lease.protocol}` });
    const assigned = await this.router.get('user-manager/user-profile');
    if (!assigned.some(x => x.user === name && x.profile === profile)) await this.router.put('user-manager/user-profile', { user: name, profile });
  }
  async cleanupRadius(lease) {
    const name = lease.radius?.username;
    if (!name) return true;
    let success = true;
    const targets = [
      ['user-manager/user-profile', x => x.user === name],
      ['user-manager/user', x => x.name === name],
      ['user-manager/profile-limitation', x => x.profile === `${name}-profile`],
      ['user-manager/profile', x => x.name === `${name}-profile`],
      ['user-manager/limitation', x => x.name === `${name}-limit`]
    ];
    for (const [path, predicate] of targets) {
      try { for (const row of (await this.router.get(path)).filter(predicate)) await this.router.delete(`${path}/${row['.id']}`); }
      catch (error) { success = false; console.error(`Could not clean up ${path}:`, error); }
    }
    return success;
  }
  async lease(user, configId, body) {
    return this.store.locked(async state => {
      const currentUser = state.users.find(x => x.id === user.id);
      if (!currentUser || expired(currentUser)) throw new ApiError(403, 'Account expired or disabled');
      const config = state.configs.find(x => x.id === configId && x.enabled && currentUser.allowedConfigs.includes(x.id));
      if (!config) throw new ApiError(404, 'Configuration unavailable');
      if (!validDeviceId(body?.deviceId)) throw new ApiError(400, 'Invalid deviceId');
      const active = state.leases.filter(x => x.userId === user.id && x.active && Date.parse(x.expiresAt) > Date.now());
      if (config.protocol === 'wireguard' && (!WG_KEY.test(body.publicKey || '') || Buffer.from(body.publicKey, 'base64').length !== 32)) throw new ApiError(400, 'Invalid WireGuard public key');
      const existing = active.find(x => x.deviceId === body.deviceId && x.configId === configId);
      if (existing) await this.revokeLease(existing);
      const remaining = active.filter(x => x.active);
      if (remaining.length >= currentUser.maxConnections) throw new ApiError(409, 'Simultaneous connection limit reached');
      const expiresAt = new Date(Math.min(Date.now() + this.config.leaseSeconds * 1000, currentUser.expiresAt ? Date.parse(currentUser.expiresAt) : Infinity)).toISOString();
      const entry = { id: id(), userId: user.id, configId, protocol: config.protocol, deviceId: body.deviceId, active: true, createdAt: new Date().toISOString(), expiresAt };
      let configuration;
      if (config.protocol === 'wireguard') {
        if (state.leases.some(x => x.active && x.publicKey === body.publicKey)) throw new ApiError(409, 'WireGuard key already in use');
        entry.publicKey = body.publicKey;
        entry.address = allocateAddress(this.config.wireguard.subnet, state.leases.filter(x => x.active && x.protocol === 'wireguard').map(x => x.address));
        const created = await this.router.put('interface/wireguard/peers', { interface: this.config.wireguard.interface, 'public-key': entry.publicKey, 'allowed-address': entry.address, comment: `MikroLink ${entry.id}` });
        entry.routerId = created?.['.id'];
        configuration = { address: entry.address, dns: this.config.wireguard.dns, peerPublicKey: this.config.wireguard.serverPublicKey, endpoint: `${this.config.publicHost}:${this.config.wireguard.port}`, allowedIps: '0.0.0.0/0', persistentKeepalive: 25 };
      } else {
        const username = `ml-${config.protocol === 'openvpn' ? 'o' : 'i'}-${entry.id.slice(0, 12)}`;
        const password = randomSecret(24);
        entry.radius = { username, password: seal(password, this.config.tokenSecret) };
        try { await this.provisionRadius(currentUser, entry); }
        catch (error) { await this.cleanupRadius(entry); throw error; }
        if (config.protocol === 'openvpn') {
          const { transport, port, caPem } = this.config.openvpn;
          const lines = ['client', 'dev tun', `proto ${transport === 'udp' ? 'udp' : 'tcp-client'}`, `remote ${this.config.publicHost} ${port}`, 'nobind', 'persist-key', 'persist-tun', 'remote-cert-tls server', `verify-x509-name ${this.config.publicHost} name`, 'setenv CLIENT_CERT 0', 'auth-user-pass', 'auth-nocache', 'cipher AES-256-CBC', 'data-ciphers AES-256-CBC', 'data-ciphers-fallback AES-256-CBC', 'auth SHA256', 'verb 3'];
          if (caPem) lines.push('<ca>', caPem.trim(), '</ca>');
          configuration = { profile: `${lines.join('\n')}\n`, username, password };
        } else configuration = { server: this.config.publicHost, identity: this.config.ikev2.identity, username, password, caCertificatePem: this.config.ikev2.caPem };
      }
      state.leases.push(entry);
      try { await this.store.save(); }
      catch (error) {
        state.leases.pop();
        if (entry.protocol === 'wireguard') await this.revokeLease(entry);
        else await this.cleanupRadius(entry);
        throw error;
      }
      return { id: entry.id, protocol: config.protocol, configuration, expiresAt, releaseToken: leaseCapability(entry, this.config.tokenSecret) };
    });
  }
  async revokeLease(entry) {
    if (entry.protocol === 'wireguard') {
      const peer = await this.router.find('interface/wireguard/peers', x => x['.id'] === entry.routerId || x.comment === `MikroLink ${entry.id}`);
      if (peer) {
        const bytes = routerCounter(peer.rx) + routerCounter(peer.tx), previous = routerCounter(entry.lastBytes);
        const user = this.store.state.users.find(x => x.id === entry.userId);
        if (user) user.usedBytes += bytes >= previous ? bytes - previous : bytes;
        entry.lastBytes = bytes;
        await this.router.delete(`interface/wireguard/peers/${peer['.id']}`);
      }
    }
    if (entry.radius) {
      const account = await this.router.find('user-manager/user', x => x.name === entry.radius.username);
      if (account) await this.router.patch(`user-manager/user/${account['.id']}`, { disabled: 'yes' });
      if (entry.protocol === 'openvpn') {
        const sessions = await this.router.get('ppp/active');
        for (const session of sessions.filter(x => x.name === entry.radius.username)) await this.router.delete(`ppp/active/${session['.id']}`);
      }
      // User Manager receives RADIUS accounting and disconnects sessions at profile limits.
      // RouterOS does not expose a safe per-user IPsec active-peer DELETE operation.
    }
    entry.active = false;
    entry.revokedAt ||= new Date().toISOString();
    entry.revokedAt ||= new Date().toISOString();
  }
  async release(user, leaseId) {
    return this.store.locked(async state => {
      const lease = state.leases.find(x => x.id === leaseId && x.userId === user.id);
      if (!lease) throw new ApiError(404, 'Lease not found');
      if (lease.active) await this.revokeLease(lease);
      await this.store.save();
    });
  }
  async releaseWithCapability(leaseId, capability) {
    return this.store.locked(async state => {
      const lease = state.leases.find(x => x.id === leaseId);
      if (!lease || !verifyLeaseCapability(lease, capability, this.config.tokenSecret)) throw new ApiError(401, 'Invalid lease capability');
      if (lease.active) await this.revokeLease(lease);
      await this.store.save();
    });
  }
  async reconcile() {
    return this.store.locked(async state => {
      const now = Date.now();
      const peers = await this.router.get('interface/wireguard/peers');
      const sessions = await this.router.get('user-manager/session');
      for (const lease of state.leases.filter(x => x.active && x.protocol === 'wireguard')) {
        const peer = peers.find(x => x['.id'] === lease.routerId || x.comment === `MikroLink ${lease.id}`);
        if (!peer) { lease.active = false; continue; }
        lease.routerId = peer['.id'];
        const bytes = routerCounter(peer.rx) + routerCounter(peer.tx);
        const previous = routerCounter(lease.lastBytes);
        const delta = bytes >= previous ? bytes - previous : bytes;
        const user = state.users.find(x => x.id === lease.userId);
        if (user) user.usedBytes += delta;
        lease.lastBytes = bytes;
      }
      for (const session of sessions) {
        const key = session['acct-session-id'];
        if (!key) continue;
        const lease = state.leases.find(x => x.radius?.username === session.user);
        const user = lease && state.users.find(x => x.id === lease.userId);
        if (!user) continue;
        const bytes = routerCounter(session.download) + routerCounter(session.upload);
        const tracked = state.radiusSessions[key];
        const previous = routerCounter(tracked && typeof tracked === 'object' ? tracked.bytes : tracked);
        user.usedBytes += bytes >= previous ? bytes - previous : bytes;
        state.radiusSessions[key] = { bytes, seenAt: new Date(now).toISOString(), leaseId: lease.id };
        lease.radiusSessionIds ||= [];
        if (!lease.radiusSessionIds.includes(key)) lease.radiusSessionIds.push(key);
      }
      for (const user of state.users) {
        let active = state.leases.filter(x => x.userId === user.id && x.active);
        if (expired(user)) { for (const lease of active) await this.revokeLease(lease); continue; }
        for (const lease of active.filter(x => !user.allowedConfigs.includes(x.configId))) await this.revokeLease(lease);
        active = state.leases.filter(x => x.userId === user.id && x.active).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
        for (const lease of active.slice(user.maxConnections)) await this.revokeLease(lease);
      }
      for (const lease of state.leases.filter(x => x.active && Date.parse(x.expiresAt) <= Date.now())) await this.revokeLease(lease);
      const activeRadiusUsers = new Set(sessions.filter(session =>
        ['yes', 'true'].includes(String(session.active).toLowerCase())
      ).map(session => session.user));
      const radiusCleanupMs = (this.config.radiusCleanupSeconds ?? 300) * 1000;
      for (const lease of state.leases.filter(x => !x.active && x.radius && !x.routerCleanedAt)) {
        const revoked = Date.parse(lease.revokedAt || lease.expiresAt);
        if (now - revoked < radiusCleanupMs ||
            activeRadiusUsers.has(lease.radius.username)) continue;
        if (await this.cleanupRadius(lease)) lease.routerCleanedAt = new Date(now).toISOString();
      }
      for (const [key, tracked] of Object.entries(state.radiusSessions)) {
        if (tracked && typeof tracked === 'object') continue;
        state.radiusSessions[key] = { bytes: routerCounter(tracked), seenAt: new Date(now).toISOString(), leaseId: null };
      }
      const retentionMs = (this.config.stateRetentionSeconds ?? 2592000) * 1000;
      const retained = [];
      for (const lease of state.leases) {
        const ended = Date.parse(lease.revokedAt || lease.expiresAt);
        const removable = !lease.active && now - ended >= retentionMs && (!lease.radius || lease.routerCleanedAt);
        if (!removable) retained.push(lease);
        else for (const key of lease.radiusSessionIds || []) delete state.radiusSessions[key];
      }
      state.leases = retained;
      for (const [key, tracked] of Object.entries(state.radiusSessions)) {
        if (tracked?.seenAt && now - Date.parse(tracked.seenAt) >= retentionMs &&
            !state.leases.some(lease => lease.id === tracked.leaseId)) delete state.radiusSessions[key];
      }
      await this.store.save();
    });
  }
}

module.exports = { Service, ApiError, publicUser };
