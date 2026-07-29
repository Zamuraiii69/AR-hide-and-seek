// markerSampler.js — the eyedropper's only source of truth: real marker pixels.
//
// Rules below are not preferences; each one comes from something that broke:
//   - crossOrigin='anonymous' or the canvas is tainted and getImageData throws.
//     Same-origin today, but a CDN later must not silently kill the eyedropper.
//   - getImageData ONCE at load. A readback from a GPU-backed canvas stalls, and
//     a per-tap stall lands exactly where the user is staring at the result.
//   - Release the canvas after decode (canvas.width = height = 0), keep only the
//     typed array — same iOS canvas-memory reason as S8 in mask.js.
//   - Average a small disc, never one pixel. JPEG ringing and print screening
//     make single pixels swing hard on precisely the textured surfaces this game
//     wants; one pixel would report a colour that is nowhere on the paper.
//
// Coordinates: uv follows three (v=0 = bottom), same as mask.js.
//   pixel x = u*W ; pixel row y = (1-v)*H
//
// A caveat worth keeping in mind while using this: the colour in the FILE is not
// the colour the camera reports (auto-exposure / auto-WB / tone curve differ by
// 10–30%). This removes the guesswork, not the need to look — per-channel gain
// compensation is Phase 8.

import { MIN_ALPHA, toHex } from './palette.js';

// Downscale ceiling. 1024 keeps the array at ≤4 MB and costs nothing in colour
// accuracy: every read is a disc mean, so detail below a few pixels is averaged
// away regardless.
const MAX_DIM = 1024;
const SAMPLE_RADIUS = 4;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';   // must precede src, or it has no effect
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load marker image ${url}`));
    img.src = url;
  });
}

/**
 * Build the sampler API around a decoded RGBA buffer.
 * Separated from the DOM loading so the pixel maths can be checked in node
 * against synthetic buffers with known answers (tools/check-palette.mjs).
 */
export function makeSampler(data, W, H, aspect) {
  /**
   * Mean colour of a disc of `radius` px around (u,v).
   * Returns { r, g, b, hex } or null when uv is off the image / fully
   * transparent there — null means "no colour", never a silent black.
   */
  function sample(u, v, radius = SAMPLE_RADIUS) {
    if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null;
    const cx = Math.min(W - 1, (u * W) | 0);
    const cy = Math.min(H - 1, ((1 - v) * H) | 0);
    const r = Math.max(0, Math.round(radius));
    const rSq = r * r;

    let sumR = 0, sumG = 0, sumB = 0, count = 0;
    for (let dy = -r; dy <= r; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= H) continue;
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > rSq) continue;      // disc, not square
        const x = cx + dx;
        if (x < 0 || x >= W) continue;
        const i = (y * W + x) * 4;
        if (data[i + 3] < MIN_ALPHA) continue;
        sumR += data[i];
        sumG += data[i + 1];
        sumB += data[i + 2];
        count++;
      }
    }
    if (count === 0) return null;

    const r0 = sumR / count, g0 = sumG / count, b0 = sumB / count;
    return { r: r0, g: g0, b: b0, hex: toHex(r0, g0, b0) };
  }

  return { W, H, aspect, data, sample };
}

/**
 * Decode a marker image into a sampler. Downscales to `maxDim` on the long edge.
 * `aspect` is derived from the image's own natural size (height / width) — the
 * same quantity the server now reads from the PNG IHDR, so a mismatch between
 * the two is a real signal that something upstream is wrong.
 */
export async function loadMarkerSampler(url, maxDim = MAX_DIM) {
  const img = await loadImage(url);
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  if (!naturalW || !naturalH) throw new Error(`marker image has no dimensions: ${url}`);

  const scale = Math.min(1, maxDim / Math.max(naturalW, naturalH));
  const W = Math.max(1, Math.round(naturalW * scale));
  const H = Math.max(1, Math.round(naturalH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);
  canvas.width = canvas.height = 0;               // release before we hold on

  return makeSampler(data, W, H, naturalH / naturalW);
}
