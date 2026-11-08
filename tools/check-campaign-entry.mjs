// tools/check-campaign-entry.mjs — opening a marker from an ARmap campaign link.
//
// ARmap launches https://liff.line.me/<id>/?source=linearmap&…&marker=<slug>.
// After liff.init resolves liff.state, the home page reads `marker`, looks the
// marker up by slug and jumps straight into a seek round on it.
//
// Run: node tools/check-campaign-entry.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

const { campaignMarkerSlug, enterCampaign } = await import('../public/js/campaignEntry.js');

check('reads the marker slug from the launch query', campaignMarkerSlug('?marker=soi-maew-07&source=linearmap') === 'soi-maew-07');
check('rejects a slug with spaces or capitals', campaignMarkerSlug('?marker=Soi%20Maew') === null);
check('rejects an over-long slug', campaignMarkerSlug(`?marker=${'a'.repeat(65)}`) === null);
check('no marker means no campaign entry', campaignMarkerSlug('') === null && campaignMarkerSlug('?source=linearmap') === null);

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function fakeFetch(routes) {
  return async (url) => {
    if (!(url in routes)) throw new Error(`unexpected ${url}`);
    const route = routes[url];
    if (route instanceof Error) throw route;
    return json(...route);
  };
}

let replaced = null;
let result = await enterCampaign('soi-maew-07', {
  fetchImpl: fakeFetch({
    '/api/markers/by-slug/soi-maew-07': [200, { id: 5, slug: 'soi-maew-07' }],
    '/api/markers/5/hides?pick=random&limit=1': [200, [{ id: 42 }]],
  }),
  replace: (url) => { replaced = url; },
});
check('a marker with hides opens a seek round on one of them', result.ok === true && replaced === '/seek.html?hide=42', replaced);

replaced = null;
result = await enterCampaign('nope', { fetchImpl: fakeFetch({ '/api/markers/by-slug/nope': [404, { error: 'marker not found' }] }), replace: (url) => { replaced = url; } });
check('an unknown marker explains itself and stays put', !result.ok && result.message === 'ไม่พบจุดเล่นนี้ กรุณาติดต่อเจ้าหน้าที่' && replaced === null);

result = await enterCampaign('empty', { fetchImpl: fakeFetch({
  '/api/markers/by-slug/empty': [200, { id: 6 }],
  '/api/markers/6/hides?pick=random&limit=1': [200, []],
}), replace: () => {} });
check('a marker without hides says so', !result.ok && result.message === 'จุดนี้ยังไม่มีแมวซ่อนอยู่ กรุณาลองจุดอื่น');

result = await enterCampaign('down', { fetchImpl: fakeFetch({ '/api/markers/by-slug/down': new Error('offline') }), replace: () => {} });
check('a network failure asks to retry', !result.ok && result.message === 'โหลดเกมไม่สำเร็จ กรุณาลองใหม่');

result = await enterCampaign('flaky', { fetchImpl: fakeFetch({ '/api/markers/by-slug/flaky': [503, { error: 'x' }] }), replace: () => {} });
check('a server error asks to retry', !result.ok && result.message === 'โหลดเกมไม่สำเร็จ กรุณาลองใหม่');

// --- back to ARmap -----------------------------------------------------------
const { wireBackToMap } = await import('../public/js/campaignEntry.js');
let closed = 0;
const button = { hidden: true, onclick: null };
wireBackToMap(button, { isInClient: () => true, closeWindow: () => { closed++; } });
button.onclick?.();
check('inside LINE the back button shows and closes the game window', button.hidden === false && closed === 1);
const outside = { hidden: true, onclick: null };
wireBackToMap(outside, { isInClient: () => false, closeWindow: () => { closed++; } });
check('outside LINE the back button stays hidden', outside.hidden === true && outside.onclick === null);
const noSdk = { hidden: true, onclick: null };
wireBackToMap(noSdk, undefined);
check('without the LIFF SDK the back button stays hidden', noSdk.hidden === true);

// --- server routes ----------------------------------------------------------
const require = createRequire(import.meta.url);
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-entry-'));
const express = require('express');
const { stmt } = require('../server/db.js');
stmt.markers.insert.run('soi-maew-07', 'Soi Maew 7', 100, 80, 0.8, '[]', '[]');
const app = express();
app.use('/api/markers', require('../server/routes/markers'));
app.use('/api/config', require('../server/routes/config'));
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
try {
  let res = await fetch(`${base}/api/markers/by-slug/soi-maew-07`);
  const body = await res.json();
  check('by-slug returns the marker detail', res.status === 200 && body.slug === 'soi-maew-07' && Number.isInteger(body.id), `status ${res.status}`);
  res = await fetch(`${base}/api/markers/by-slug/missing`);
  check('by-slug 404s an unknown slug', res.status === 404 && (await res.json()).error === 'marker not found');
  delete process.env.GAME_LIFF_ID;
  res = await fetch(`${base}/api/config`);
  check('config has a null LIFF id when unset', JSON.stringify(await res.json()) === '{"liffId":null}');
  process.env.GAME_LIFF_ID = '2010387907-AbCd';
  res = await fetch(`${base}/api/config`);
  check('config returns the LIFF id', (await res.json()).liffId === '2010387907-AbCd');
} finally {
  await new Promise((resolve) => server.close(resolve));
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); }
console.log('\nALL PASS');
