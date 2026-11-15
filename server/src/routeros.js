'use strict';

const https = require('node:https');

class RouterError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

class RouterOS {
  constructor(config) { this.config = config; }

  request(method, path, body) {
    const target = new URL(`${this.config.url}/${path.replace(/^\//, '')}`);
    if (target.protocol !== 'https:') throw new Error('RouterOS REST requires HTTPS');
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const request = https.request(target, {
        method,
        auth: `${this.config.user}:${this.config.password}`,
        ca: this.config.ca || undefined,
        rejectUnauthorized: true,
        timeout: 10000,
        headers: { 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': payload.length } : {}) }
      }, response => {
        const chunks = [];
        response.on('data', c => chunks.push(c));
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let result = null;
          try { result = raw ? JSON.parse(raw) : null; } catch { result = raw; }
          if (response.statusCode >= 400) reject(new RouterError(response.statusCode, typeof result === 'object' ? (result.detail || result.message || raw) : raw));
          else resolve(result);
        });
      });
      request.on('timeout', () => request.destroy(new Error('RouterOS request timed out')));
      request.on('error', reject);
      if (payload) request.write(payload);
      request.end();
    });
  }
  get(path) { return this.request('GET', path); }
  put(path, value) { return this.request('PUT', path, value); }
  patch(path, value) { return this.request('PATCH', path, value); }
  delete(path) { return this.request('DELETE', path); }
  post(path, value) { return this.request('POST', path, value); }
  async find(path, predicate) {
    const rows = await this.get(path);
    return Array.isArray(rows) ? rows.find(predicate) : undefined;
  }
  async upsert(path, name, value) {
    const existing = await this.find(path, x => x.name === name);
    if (existing) return this.patch(`${path}/${existing['.id']}`, value);
    return this.put(path, { name, ...value });
  }
}

module.exports = { RouterOS, RouterError };
