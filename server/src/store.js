'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

class Store {
  constructor(file) { this.file = file; this.state = { version: 1, users: [], configs: [], leases: [], radiusSessions: {} }; this.queue = Promise.resolve(); }
  async load() {
    try {
      const state = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (state.version !== 1 || !Array.isArray(state.users) || !Array.isArray(state.configs) || !Array.isArray(state.leases)) throw new Error('Unsupported or corrupt state');
      this.state = state;
      this.state.radiusSessions ||= {};
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.mkdir(path.dirname(this.file), { recursive: true });
  }
  async save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }
  locked(fn) {
    const run = this.queue.then(() => fn(this.state));
    this.queue = run.catch(() => {});
    return run;
  }
}

module.exports = { Store };
