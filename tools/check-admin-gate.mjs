// tools/check-admin-gate.mjs — marker/hide writes are admin-only; play stays public.
//
// Campaign hides are curated by staff, so creating or deleting markers and hides
// needs X-Admin-Token. Seeking and reading never do. Runs against a throwaway
// DATA_DIR with the real routers on an ephemeral port.
//
// Run: node tools/check-admin-gate.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

const require = createRequire(import.meta.url);
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-admin-'));
const express = require('express');
const app = express();
app.use(express.json({ limit: '8mb' }));
app.use('/api/markers', require('../server/routes/markers'));
app.use('/api/hides', require('../server/routes/hides'));
app.use('/api/seeks', require('../server/routes/seeks'));
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}`;

const TOKEN = 'a'.repeat(32);
const createMarker = (headers = {}) => fetch(`${base}/api/markers`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ name: 'Soi Maew 7', imageWidth: 100, imageHeight: 80 }),
});

try {
  delete process.env.ADMIN_TOKEN;
  let res = await createMarker({ 'X-Admin-Token': TOKEN });
  check('writes are disabled when ADMIN_TOKEN is unset', res.status === 503 && (await res.json()).error === 'admin writes disabled', `status ${res.status}`);

  process.env.ADMIN_TOKEN = 'short';
  res = await createMarker({ 'X-Admin-Token': 'short' });
  check('a token shorter than 24 characters disables writes', res.status === 503, `status ${res.status}`);

  process.env.ADMIN_TOKEN = TOKEN;
  res = await createMarker();
  check('a missing header is rejected', res.status === 401 && (await res.json()).error === 'admin token required', `status ${res.status}`);
  res = await createMarker({ 'X-Admin-Token': 'b'.repeat(32) });
  check('a wrong token is rejected', res.status === 401, `status ${res.status}`);
  res = await createMarker({ 'X-Admin-Token': TOKEN });
  check('the right token creates a marker', res.status === 201, `status ${res.status}`);
  const marker = await res.json();

  for (const [method, url] of [
    ['PUT', `/api/markers/${marker.id}/image`],
    ['PUT', `/api/markers/${marker.id}/target`],
    ['PUT', `/api/markers/${marker.id}/pose/1`],
    ['POST', '/api/hides'],
    ['DELETE', `/api/markers/${marker.id}/hides`],
    ['DELETE', `/api/markers/${marker.id}`],
  ]) {
    res = await fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'DELETE' ? undefined : '{}' });
    check(`${method} ${url.replace(/\d+/g, ':id')} needs the token`, res.status === 401, `status ${res.status}`);
  }

  res = await fetch(`${base}/api/markers/${marker.id}/hides?pick=random&limit=1`);
  check('reading hides stays public', res.status === 200, `status ${res.status}`);
  res = await fetch(`${base}/api/seeks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hideId: 999 }) });
  check('posting a seek never asks for the token', res.status !== 401 && res.status !== 503, `status ${res.status}`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

// --- client helper ---------------------------------------------------------
const { adminHeaders, forgetAdminToken, ADMIN_TOKEN_KEY } = await import('../public/js/core/adminToken.js');
const memory = (initial = {}) => {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
};
let asked = 0;
const stored = memory({ [ADMIN_TOKEN_KEY]: TOKEN });
check('a stored token becomes the header without asking',
  adminHeaders({ storage: stored, ask: () => { asked++; return 'x'; } })['X-Admin-Token'] === TOKEN && asked === 0);
const empty = memory();
const first = adminHeaders({ storage: empty, ask: () => { asked++; return `  ${TOKEN}  `; } });
check('a missing token is asked for once, trimmed and remembered',
  first['X-Admin-Token'] === TOKEN && empty.data[ADMIN_TOKEN_KEY] === TOKEN && asked === 1);
const cancelled = memory();
check('a cancelled prompt sends no header and stores nothing',
  Object.keys(adminHeaders({ storage: cancelled, ask: () => null })).length === 0 && !(ADMIN_TOKEN_KEY in cancelled.data));
check('storage that throws still works from the prompt',
  adminHeaders({ storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }, ask: () => TOKEN })['X-Admin-Token'] === TOKEN);
const rejected = memory({ [ADMIN_TOKEN_KEY]: 'typo' });
forgetAdminToken({ storage: { ...rejected, removeItem: (k) => { delete rejected.data[k]; } } });
check('a rejected token is forgotten so the next write asks again', !(ADMIN_TOKEN_KEY in rejected.data));

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); }
console.log('\nALL PASS');
