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

// If liff.init fails or does not redirect, the launch query is still packed in liff.state.
const { launchSearch } = await import('../public/js/campaignEntry.js');
const packed = `?liff.state=${encodeURIComponent('?source=linearmap&claim=earned&reward=15&treasure=Wall 7&marker=soi-maew-07')}`;
check('unpacks the launch query from liff.state', new URLSearchParams(launchSearch(packed)).get('claim') === 'earned');
check('reads the marker from liff.state when init did not redirect', campaignMarkerSlug(packed) === 'soi-maew-07');
check('unpacks liff.state that carries a path', campaignMarkerSlug(`?liff.state=${encodeURIComponent('/?marker=soi-maew-07')}`) === 'soi-maew-07');
check('a plain query passes through unchanged', launchSearch('?marker=a') === '?marker=a');

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
// closeWindow() closed the whole LIFF browser and dropped the player in the
// LINE OA chat. Going back means opening ARmap's map, not closing the game.
const { wireBackToMap, ARMAP_MAP_URL, resultDestination } = await import('../public/js/campaignEntry.js');
const ctx = { source: 'linearmap', claim: 'earned', reward: 15, treasure: 'Wall 7' };
let closed = 0;
let went = null;
const button = { hidden: true, onclick: null };
wireBackToMap(button, { liff: { isInClient: () => true, closeWindow: () => { closed++; } }, context: ctx, navigate: (url) => { went = url; } });
button.onclick?.();
check('inside LINE the back button shows and opens the ARmap map', button.hidden === false && went === ARMAP_MAP_URL && closed === 0, went);
check('the ARmap map URL is a bare liff.line.me link to /map', /^https:\/\/liff\.line\.me\/[0-9]+-[A-Za-z0-9]+\/map$/.test(ARMAP_MAP_URL), ARMAP_MAP_URL);
const outside = { hidden: true, onclick: null };
wireBackToMap(outside, { liff: { isInClient: () => false }, context: ctx, navigate: () => {} });
check('outside LINE the back button stays hidden', outside.hidden === true && outside.onclick === null);
const standalone = { hidden: true, onclick: null };
wireBackToMap(standalone, { liff: { isInClient: () => true }, context: null, navigate: () => {} });
check('a standalone round (no ARmap context) has no back-to-map button', standalone.hidden === true && standalone.onclick === null);

// --- reward screen after a found-all round ------------------------------------
check('finding every hide in an ARmap round goes to the reward screen', resultDestination({ allFound: true, context: ctx }) === '/reward.html');
check('running out of taps stays on the result panel', resultDestination({ allFound: false, context: ctx }) === null);
check('a standalone round never shows the ARmap reward', resultDestination({ allFound: true, context: null }) === null);

// --- campaign entry hides the staff page before anything paints ----------------
// The staff header (Upload marker) used to show while LIFF and two API calls
// ran. An inline script flags the page as a campaign entry before the body
// paints, and CSS hides the staff chrome.
{
  const vm = await import('node:vm');
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const inline = html.match(/<script>(\s*\/\/ campaign-entry-flag[\s\S]*?)<\/script>/);
  check('index.html carries the campaign-entry flag script', Boolean(inline));
  const flagged = (search) => {
    const classes = new Set();
    vm.runInNewContext(inline ? inline[1] : '', {
      location: { search }, URLSearchParams,
      document: { documentElement: { classList: { add: (c) => classes.add(c) } } },
    });
    return classes.has('campaign-entry');
  };
  check('a ?marker= launch is flagged', flagged('?source=linearmap&marker=soi-maew-01'));
  check('a liff.state launch is flagged', flagged(packed));
  check('the staff page is not flagged', !flagged('') && !flagged('?source=linearmap'));
  check('CSS hides the staff chrome on a campaign entry', /html\.campaign-entry header/.test(html));
}
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
