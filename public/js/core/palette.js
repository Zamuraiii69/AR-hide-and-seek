// palette.js — turn marker pixels into swatches.
//
// Two rows, and the SECOND one is the one that actually helps camouflage:
//   extractPalette → dominant colours of the whole image
//   gridPalette    → mean colour per cell of a G×G grid
// Camouflage is a LOCAL problem. A whole-image mean answers "what colour is
// this marker on average", which is nearly useless when the hider needs
// "what colour is the marker right *here*".
//
// Bucket-then-average, not bucket centre: the centre of a 64-bucket cube is
// visibly quantised (banded greys), while the mean of the pixels that landed in
// the bucket is the real colour. k-means costs far more than the difference.
//
// Both functions take the raw RGBA array from a single getImageData — the same
// array markerSampler.js keeps — so extracting costs no extra decode.

/** Fallback swatches for markers with no usable source image (§4.5). */
export const FALLBACK_PALETTE = [
  '#405b38', '#65734d', '#8c8060', '#a49470', '#615e46',
  '#7d7062', '#8f6751', '#a8553f', '#4f6c6d', '#526177',
];

// Pixels below this alpha carry no colour information (transparent PNG areas
// decode as black, which would drag every average toward black).
// Shared with markerSampler.js.
export const MIN_ALPHA = 8;

// ~40k samples is plenty: the answer is a bucket mean, and doubling the sample
// count moves it by less than a colour step while doubling the stall.
const SAMPLE_TARGET = 40000;

// Squared sRGB distance below which two swatches read as "the same colour" and
// the second one is a wasted slot in the HUD.
const DUP_DISTANCE_SQ = 800;

// Cells sampled along each axis for gridPalette: G² cells share ~40k samples.
const GRID_SAMPLES_PER_AXIS = 200;

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** (r,g,b) → '#rrggbb'. Accepts fractional channel means. */
export function toHex(r, g, b) {
  const packed = (1 << 24) | (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b);
  return `#${packed.toString(16).slice(1)}`;
}

const distSq = (a, b) => (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;

/**
 * Dominant colours of the whole image, most common first.
 * Returns up to `n` '#rrggbb' strings — fewer when the image is near-flat,
 * because near-duplicates are dropped rather than padded out.
 */
export function extractPalette(data, W, H, n = 8) {
  const total = W * H;
  // Stride counted in PIXELS. A byte stride that is not a multiple of 4 reads
  // r/g/b from three different pixels and returns mud, so never stride bytes.
  const stride = Math.max(1, Math.floor(total / SAMPLE_TARGET));

  // 4×4×4 = 64 buckets, each accumulating [sumR, sumG, sumB, count].
  const buckets = new Float64Array(64 * 4);
  for (let p = 0; p < total; p += stride) {
    const i = p * 4;
    if (data[i + 3] < MIN_ALPHA) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const slot = (((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6)) * 4;
    buckets[slot] += r;
    buckets[slot + 1] += g;
    buckets[slot + 2] += b;
    buckets[slot + 3] += 1;
  }

  const means = [];
  for (let bucket = 0; bucket < 64; bucket++) {
    const slot = bucket * 4;
    const count = buckets[slot + 3];
    if (count === 0) continue;
    means.push({
      r: buckets[slot] / count,
      g: buckets[slot + 1] / count,
      b: buckets[slot + 2] / count,
      count,
    });
  }
  means.sort((a, b) => b.count - a.count);

  const kept = [];
  for (const mean of means) {
    if (kept.length >= n) break;
    if (kept.some((c) => distSq(c, mean) < DUP_DISTANCE_SQ)) continue;
    kept.push(mean);
  }
  return kept.map((c) => toHex(c.r, c.g, c.b));
}

/**
 * Mean colour per cell of a G×G grid over the image.
 * Returns G*G entries in IMAGE row order — index 0 is the TOP-LEFT cell — so
 * the HUD row reads left-to-right, top-to-bottom like the printed marker.
 * A cell with no opaque pixels yields null; callers skip those.
 */
export function gridPalette(data, W, H, G = 4) {
  const xStep = Math.max(1, Math.floor(W / GRID_SAMPLES_PER_AXIS));
  const yStep = Math.max(1, Math.floor(H / GRID_SAMPLES_PER_AXIS));
  const sums = new Float64Array(G * G * 4);

  for (let y = 0; y < H; y += yStep) {
    const gy = Math.min(G - 1, Math.floor((y / H) * G));
    for (let x = 0; x < W; x += xStep) {
      const i = (y * W + x) * 4;
      if (data[i + 3] < MIN_ALPHA) continue;
      const gx = Math.min(G - 1, Math.floor((x / W) * G));
      const slot = (gy * G + gx) * 4;
      sums[slot] += data[i];
      sums[slot + 1] += data[i + 1];
      sums[slot + 2] += data[i + 2];
      sums[slot + 3] += 1;
    }
  }

  const cells = [];
  for (let cell = 0; cell < G * G; cell++) {
    const slot = cell * 4;
    const count = sums[slot + 3];
    cells.push(count === 0
      ? null
      : toHex(sums[slot] / count, sums[slot + 1] / count, sums[slot + 2] / count));
  }
  return cells;
}
