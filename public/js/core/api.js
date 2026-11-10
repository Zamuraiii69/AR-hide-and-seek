import { adminHeaders, forgetAdminToken } from './adminToken.js';

async function request(url, options) {
  const response = await fetch(url, options);
  let body = null;
  try { body = await response.json(); } catch { /* non-JSON response */ }
  if (!response.ok) {
    const error = new Error(body?.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

export const getJSON = (url) => request(url);
export const postJSON = (url, body) => request(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

// Staff-only writes (placing a hide). A 401 forgets the stored token so the
// next attempt asks again instead of repeating a mistyped one forever.
export async function adminPostJSON(url, body) {
  try {
    return await request(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...adminHeaders() }, body: JSON.stringify(body),
    });
  } catch (error) {
    if (error.status === 401) forgetAdminToken();
    throw error;
  }
}
