// Header for admin-only writes (marker upload, hide placement, deletes).
// The token is entered once per browser and kept in localStorage; storage that
// throws (private mode, blocked site data) falls back to asking each time.
export const ADMIN_TOKEN_KEY = 'ar-hide-and-seek.admin-token';

export function adminHeaders({ storage = globalThis.localStorage, ask = globalThis.prompt } = {}) {
  let token = null;
  try { token = storage?.getItem(ADMIN_TOKEN_KEY) || null; } catch { token = null; }
  if (!token) {
    token = String(ask?.('Admin token') ?? '').trim() || null;
    if (token) {
      try { storage?.setItem(ADMIN_TOKEN_KEY, token); } catch { /* keep using it for this request */ }
    }
  }
  return token ? { 'X-Admin-Token': token } : {};
}

/** Called after a 401 so a mistyped token is asked for again on the next write. */
export function forgetAdminToken({ storage = globalThis.localStorage } = {}) {
  try { storage?.removeItem(ADMIN_TOKEN_KEY); } catch { /* nothing stored */ }
}
