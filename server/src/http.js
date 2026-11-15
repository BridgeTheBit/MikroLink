'use strict';

const { verifyToken, safeEqual } = require('./security');
const { ApiError } = require('./service');
const { isIP } = require('node:net');

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

async function body(req) {
  let size = 0, chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new ApiError(413, 'Request too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'Invalid JSON'); }
}

function createHandler(service, config, now = Date.now) {
  const failures = new Map();
  const failureWindow = 60000;
  const maxFailureKeys = config.maxLoginFailureKeys || 10000;
  let loginRequests = 0;
  const clientAddress = req => {
    if (config.behindProxy) {
      const real = req.headers['x-real-ip'];
      if (typeof real === 'string' && isIP(real.trim())) return real.trim();
      const forwarded = req.headers['x-forwarded-for'];
      const first = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '';
      if (isIP(first)) return first;
    }
    return req.socket.remoteAddress || 'unknown';
  };
  const pruneFailures = moment => {
    for (const [key, value] of failures) {
      if (moment - value.since >= failureWindow) failures.delete(key);
    }
    while (failures.size >= maxFailureKeys) failures.delete(failures.keys().next().value);
  };
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'https://mikrolink.invalid');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/health') return json(res, 200, { status: 'ok', service: 'MikroLink' });
      if (req.method === 'POST' && path === '/v1/admin/apply') {
        if (!safeEqual(req.headers['x-admin-key'], config.adminKey)) throw new ApiError(401, 'Unauthorized');
        return json(res, 200, await service.apply(await body(req)));
      }
      if (req.method === 'POST' && path === '/v1/auth/login') {
        const input = await body(req);
        if (typeof input.username !== 'string' || typeof input.password !== 'string') throw new ApiError(400, 'Username and password required');
        const moment = now();
        if (++loginRequests % 128 === 0 || failures.size >= maxFailureKeys) pruneFailures(moment);
        const key = `${clientAddress(req)}:${input.username}`;
        const previous = failures.get(key);
        const failure = previous && moment - previous.since < failureWindow ? previous : null;
        if (failure && failure.count >= 5) throw new ApiError(429, 'Try again later');
        try {
          const session = await service.login(input.username, input.password);
          failures.delete(key);
          return json(res, 200, session);
        } catch (error) {
          failures.set(key, { count: (failure?.count || 0) + 1, since: failure?.since ?? moment });
          throw error;
        }
      }
      const releasePath = /^\/v1\/leases\/([a-f0-9-]+)$/.exec(path);
      const leaseAuth = /^Lease (.+)$/.exec(req.headers.authorization || '');
      if (req.method === 'DELETE' && releasePath && leaseAuth) {
        await service.releaseWithCapability(releasePath[1], leaseAuth[1]);
        res.writeHead(204, { 'Cache-Control': 'no-store' }); return res.end();
      }
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '');
      const userId = bearer ? verifyToken(bearer[1], config.tokenSecret) : null;
      const user = userId ? service.userById(userId) : null;
      if (!user) throw new ApiError(401, 'Unauthorized');
      if (req.method === 'GET' && path === '/v1/configs') return json(res, 200, service.catalog(user));
      if (req.method === 'GET' && path === '/v1/me') return json(res, 200, { username: user.username, quotaBytes: user.quotaBytes, usedBytes: user.usedBytes, maxConnections: user.maxConnections, expiresAt: user.expiresAt });
      const leasePath = /^\/v1\/configs\/([a-zA-Z0-9._-]+)\/lease$/.exec(path);
      if (req.method === 'POST' && leasePath) return json(res, 201, await service.lease(user, leasePath[1], await body(req)));
      if (req.method === 'DELETE' && releasePath) { await service.release(user, releasePath[1]); res.writeHead(204, { 'Cache-Control': 'no-store' }); return res.end(); }
      throw new ApiError(404, 'Not found');
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 502;
      if (!(error instanceof ApiError)) console.error('Request error:', error);
      if (!res.headersSent) json(res, status, { error: error instanceof ApiError ? error.message : 'Router or server error' });
    }
  };
}

module.exports = { createHandler };
