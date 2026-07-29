// mask.js — the silhouette shape, decoded from its PNG once at load.
//
// three's alphaMap samples the GREEN channel (`texture2D(alphaMap, uv).g`),
// so the hit test must read the SAME green channel — never the paint canvas.
// The paint canvas is 100% opaque by invariant, so rendered alpha ≡ mask green;
// reading the mask keeps hit test correct even after an eraser is added.
//
// Coordinates: uv follows three (v=0 = bottom). Pixel row = (1-v)*res.

const DECODE_RES = 256;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';   // same-origin asset, but keep canvas untainted
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load mask ${url}`));
    img.src = url;
  });
}

/**
 * Load a silhouette PNG and decode its green channel into a flat Uint8Array.
 * Returns a mask object with a tight body bbox and an alpha-aware isBody().
 */
export async function loadMask(url) {
  const img = await loadImage(url);
  const res = DECODE_RES;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = res;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, res, res);
  ctx.drawImage(img, 0, 0, res, res);
  const px = ctx.getImageData(0, 0, res, res).data;
  canvas.width = canvas.height = 0;

  const data = new Uint8Array(res * res);
  let x0 = res, y0 = res, x1 = -1, y1 = -1;
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const g = px[(y * res + x) * 4 + 1];        // GREEN — matches alphamap_fragment
      data[y * res + x] = g;
      if (g > 127) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }

  // Empty mask guard (shouldn't happen with a real asset).
  const bbox = x1 < 0
    ? { u0: 0, u1: 1, v0: 0, v1: 1 }
    : { u0: x0 / res, u1: (x1 + 1) / res, v0: 1 - (y1 + 1) / res, v1: 1 - y0 / res };

  return makeMask(res, data, bbox);
}

/** Build the mask API around a decoded green-channel buffer. */
export function makeMask(res, data, bbox) {
  // Nearest-sample the green channel at a uv (v=0 = bottom). Out of range → 0.
  function greenAt(u, v) {
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0;
    const x = Math.min(res - 1, (u * res) | 0);
    const y = Math.min(res - 1, ((1 - v) * res) | 0);
    return data[y * res + x];
  }

  // Alpha-aware hit test. Centre-hit if green>127; otherwise a small ring probe
  // (radius = tol in uv) so near-misses still count — intentionally lenient vs
  // the alphaTest 0.5 render cutoff, biased toward the player finding the target.
  function isBody(u, v, tol = 0.03) {
    if (greenAt(u, v) > 127) return true;
    if (tol <= 0) return false;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (greenAt(u + Math.cos(a) * tol, v + Math.sin(a) * tol) > 127) return true;
    }
    return false;
  }

  return { res, data, bbox, greenAt, isBody };
}
