// tools/check-hide-duplicates.mjs — saving the same hide twice must not stack.
//
// The hide screen left Save enabled after a save, so a second press posted the
// exact same transform again (soi-maew-02 hides 9 and 10, 10 s apart). Stacked
// hides are indistinguishable to a seeker, and the lower one can never be
// tapped. The server refuses an active hide that repeats one on the marker.
//
// Run: node tools/check-hide-duplicates.mjs

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
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-dup-'));
const TOKEN = 'a'.repeat(32);
process.env.ADMIN_TOKEN = TOKEN;
const express = require('express');
const { db } = require('../server/db');
const app = express();
app.use(express.json({ limit: '8mb' }));
app.use('/api/markers', require('../server/routes/markers'));
app.use('/api/hides', require('../server/routes/hides'));
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const headers = { 'Content-Type': 'application/json', 'X-Admin-Token': TOKEN };

// 1×1 PNG — the route only needs a real PNG, not a 512² canvas.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const SPOT = { x: -0.10201333815898717, y: 0.18436334253057565, rot: 0, w: 0.18, h: 0.18 };

try {
  let res = await fetch(`${base}/api/markers`, { method: 'POST', headers, body: JSON.stringify({ name: 'soi-maew-02', imageWidth: 100, imageHeight: 80 }) });
  const marker = await res.json();
  db.prepare("UPDATE markers SET status = 'ready' WHERE id = ?").run(marker.id);
  const hide = (transform) => fetch(`${base}/api/hides`, { method: 'POST', headers, body: JSON.stringify({ markerId: marker.id, transform, paintDataUrl: PNG }) });

  res = await hide(SPOT);
  check('the first save creates the hide', res.status === 201, `status ${res.status}`);

  res = await hide(SPOT);
  const body = await res.json().catch(() => ({}));
  check('saving the same transform again is refused', res.status === 409 && body.error === 'duplicate hide', `status ${res.status} ${body.error}`);
  const n = db.prepare('SELECT COUNT(*) AS n FROM hides WHERE marker_id = ? AND is_active = 1').get(marker.id).n;
  check('only one active hide exists after the double save', n === 1, `count ${n}`);

  res = await hide({ ...SPOT, x: SPOT.x + 0.05 });
  check('a hide moved to another spot still saves', res.status === 201, `status ${res.status}`);

  res = await hide({ ...SPOT, rot: 0.5 });
  check('the same spot with a different rotation still saves', res.status === 201, `status ${res.status}`);

  await fetch(`${base}/api/markers/${marker.id}/hides`, { method: 'DELETE', headers });
  res = await hide(SPOT);
  check('a cleared spot can be hidden in again', res.status === 201, `status ${res.status}`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); }
console.log('\nALL PASS');
