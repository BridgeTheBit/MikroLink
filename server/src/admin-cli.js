'use strict';

const fs = require('node:fs/promises');

async function main() {
  const [file, apiUrl] = process.argv.slice(2);
  if (!file || !apiUrl || !process.env.ADMIN_KEY) throw new Error('Usage: ADMIN_KEY=... node src/admin-cli.js manifest.json https://vpn.example.com');
  if (!apiUrl.startsWith('https://')) throw new Error('Admin API URL must use HTTPS');
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/admin/apply`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': process.env.ADMIN_KEY }, body: JSON.stringify(manifest) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${result.error}`);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
