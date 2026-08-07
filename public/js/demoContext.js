// Demo context deliberately contains presentation-only values. It never carries
// credentials, identity, or a redirect destination between the two products.
export const DEMO_CONTEXT_KEY = 'ar-hide-and-seek.linearmap-demo-context';
export const MAX_REWARD = 100000;
const MAX_TREASURE_LENGTH = 120;

function safeStorage(storage) {
  return storage || globalThis.sessionStorage;
}

function parseReward(value) {
  if (!/^\d+$/.test(String(value || ''))) return null;
  const reward = Number(value);
  if (!Number.isSafeInteger(reward)) return null;
  return Math.min(Math.max(reward, 0), MAX_REWARD);
}

function normalizeTreasure(value) {
  return String(value || '').trim().slice(0, MAX_TREASURE_LENGTH) || 'AR Hide & Seek';
}

export function parseDemoContext(search) {
  const params = new URLSearchParams(search || '');
  if (params.get('source') !== 'linearmap') return null;
  const claim = params.get('claim');
  if (claim !== 'earned' && claim !== 'already') return null;
  const reward = parseReward(params.get('reward'));
  if (reward === null) return null;
  return Object.freeze({ source: 'linearmap', claim, reward: claim === 'already' ? 0 : reward, treasure: normalizeTreasure(params.get('treasure')) });
}

export function isDemoContext(context) {
  return Boolean(context && context.source === 'linearmap'
    && (context.claim === 'earned' || context.claim === 'already')
    && Number.isSafeInteger(context.reward) && context.reward >= 0 && context.reward <= MAX_REWARD
    && typeof context.treasure === 'string');
}

export function saveDemoContext(context, storage) {
  if (!isDemoContext(context)) return false;
  safeStorage(storage).setItem(DEMO_CONTEXT_KEY, JSON.stringify(context));
  return true;
}

export function getDemoContext(storage) {
  try {
    const context = JSON.parse(safeStorage(storage).getItem(DEMO_CONTEXT_KEY) || 'null');
    return isDemoContext(context) ? Object.freeze(context) : null;
  } catch { return null; }
}

export function clearDemoContext(storage) {
  safeStorage(storage).removeItem(DEMO_CONTEXT_KEY);
}

// This runs only on the top-level home page. A normal new entry clears an old
// browser-session context so it cannot accidentally reach the reward screen.
export function initializeTopLevelDemoContext(search = globalThis.location?.search, storage) {
  const context = parseDemoContext(search);
  if (context) saveDemoContext(context, storage);
  else clearDemoContext(storage);
  return context;
}
