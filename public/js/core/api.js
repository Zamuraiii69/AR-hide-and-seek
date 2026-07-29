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
