import { DEMO_CONTEXT_KEY, MAX_REWARD, clearDemoContext, getDemoContext, initializeTopLevelDemoContext, parseDemoContext } from '../public/js/demoContext.js';
import { shareAndHandleResult } from '../public/js/hide/shareResult.js';
import { rewardPresentation } from '../public/js/rewardContent.js';

let failures = 0;
function check(name, ok, detail = '') { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failures++; }
function memoryStorage() { const data = new Map(); return { getItem: (key) => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key), data }; }
const valid = parseDemoContext('?source=linearmap&claim=earned&reward=20&treasure=AR%20Hide%20%26%20Seek');
check('parses a valid LINEARmap demo context', valid?.claim === 'earned' && valid.reward === 20 && valid.treasure === 'AR Hide & Seek');
check('rejects invalid source, claim, and non-integer reward', parseDemoContext('?source=other&claim=earned&reward=20') === null && parseDemoContext('?source=linearmap&claim=nope&reward=20') === null && parseDemoContext('?source=linearmap&claim=earned&reward=20.5') === null);
check('clamps an oversized reward and never awards already claims', parseDemoContext(`?source=linearmap&claim=earned&reward=${MAX_REWARD + 1}`)?.reward === MAX_REWARD && parseDemoContext('?source=linearmap&claim=already&reward=99')?.reward === 0);
const store = memoryStorage(); initializeTopLevelDemoContext('?source=linearmap&claim=earned&reward=20&treasure=Demo', store);
check('top-level demo entry persists context', getDemoContext(store)?.treasure === 'Demo'); initializeTopLevelDemoContext('', store);
check('normal top-level entry clears stale context', !store.data.has(DEMO_CONTEXT_KEY)); clearDemoContext(store);
let destination = null;
const outcome = await shareAndHandleResult({ share: async () => {}, payload: {}, context: valid, goToReward: (path) => { destination = path; } });
check('successful native share with context navigates to reward', outcome === 'reward' && destination === '/reward.html');
destination = null;
const cancelled = await shareAndHandleResult({ share: async () => { const error = new Error('cancelled'); error.name = 'AbortError'; throw error; }, payload: {}, context: valid, goToReward: (path) => { destination = path; } });
check('cancelled share stays on the share page', cancelled === 'cancelled' && destination === null);
destination = null;
const normal = await shareAndHandleResult({ share: async () => {}, payload: {}, context: null, goToReward: (path) => { destination = path; } });
check('normal successful share does not navigate to reward', normal === 'shared' && destination === null);
check('seek URLs remain isolated from reward context', !new URL('/seek.html?hide=42', 'https://example.test').searchParams.has('reward'));
const already = parseDemoContext('?source=linearmap&claim=already&reward=0');
check('already claim has no plus reward display', already?.reward === 0 && rewardPresentation(already).reward === null);
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`); process.exit(failures === 0 ? 0 : 1);
