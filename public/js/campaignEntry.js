// Campaign entry: an ARmap portal opens the game at /?…&marker=<slug>. Resolve
// the marker by slug and go straight into a seek round on it. Pure enough to
// test in Node: fetch and navigation are injected.
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const MESSAGES = Object.freeze({
  unknownMarker: 'ไม่พบจุดเล่นนี้ กรุณาติดต่อเจ้าหน้าที่',
  noHides: 'จุดนี้ยังไม่มีแมวซ่อนอยู่ กรุณาลองจุดอื่น',
  unavailable: 'โหลดเกมไม่สำเร็จ กรุณาลองใหม่',
});

/**
 * The query ARmap launched us with. A liff.line.me URL arrives as
 * ?liff.state=<path+query>; liff.init normally redirects to unpack it, but if
 * init fails or skips the redirect, unpack it here so the marker is not lost.
 */
export function launchSearch(search) {
  const state = new URLSearchParams(search || '').get('liff.state');
  if (!state) return search || '';
  const query = state.indexOf('?');
  return query === -1 ? '' : state.slice(query);
}

export function campaignMarkerSlug(search) {
  const slug = new URLSearchParams(launchSearch(search)).get('marker');
  return slug && slug.length <= 64 && SLUG_RE.test(slug) ? slug : null;
}

/**
 * Inside LINE the game is a LIFF window opened from ARmap; closing it returns
 * the player to the map. isInClient/closeWindow work before liff.init.
 */
export function wireBackToMap(button, liff = globalThis.liff) {
  if (!button || !liff?.isInClient?.()) return;
  button.hidden = false;
  button.onclick = () => liff.closeWindow();
}

export async function enterCampaign(slug, { fetchImpl = globalThis.fetch, replace = (url) => globalThis.location.replace(url) } = {}) {
  try {
    const markerRes = await fetchImpl(`/api/markers/by-slug/${encodeURIComponent(slug)}`);
    if (markerRes.status === 404) return { ok: false, message: MESSAGES.unknownMarker };
    if (!markerRes.ok) return { ok: false, message: MESSAGES.unavailable };
    const marker = await markerRes.json();
    const hidesRes = await fetchImpl(`/api/markers/${marker.id}/hides?pick=random&limit=1`);
    if (!hidesRes.ok) return { ok: false, message: MESSAGES.unavailable };
    const [hide] = await hidesRes.json();
    if (!hide) return { ok: false, message: MESSAGES.noHides };
    replace(`/seek.html?hide=${hide.id}`);
    return { ok: true };
  } catch {
    return { ok: false, message: MESSAGES.unavailable };
  }
}
