// maskNormalize.js — pure, no DOM reads: turns already-rasterized RGBA pixel
// data into the white-on-black opaque mask the AR engine expects, plus the
// same coverage/bimodal/bbox numbers server/maskContract.js checks. The
// caller (maskFile.js) owns getting a File into a res×res RGBA buffer —
// that's what makes this module testable in plain Node.
//
// Two extraction paths:
//   - alpha (primary): the source has a real alpha channel — body is
//     wherever alpha is high.
//   - luminance (fallback): no usable alpha — Otsu-threshold the grayscale
//     image, then use the outermost 1px ring (background by definition) to
//     decide which side of the threshold is the body.

export const MASK_RES = 1024;
export const MASK_LIMITS = { minCoverage: 3, maxCoverage: 45, minBimodal: 0.95 };

const ALPHA_TRANSPARENT_BELOW = 250; // any pixel below this means "real alpha"
const ALPHA_BODY_ABOVE = 127;
const BIMODAL_DARK_BELOW = 8;
const BIMODAL_LIGHT_ABOVE = 247;

/**
 * Otsu's method: the threshold (0-255) maximising between-class variance of
 * a 256-bin histogram. Works on any histogram, not just a bimodal one — a
 * smooth ramp just yields the point that best splits it in two.
 */
export function otsuThreshold(histogram) {
  let total = 0;
  let sumAll = 0;
  for (let v = 0; v < 256; v++) { total += histogram[v]; sumAll += v * histogram[v]; }
  if (total === 0) return 127;

  let sumB = 0;
  let weightB = 0;
  let best = 0;
  let bestVariance = -1;
  for (let t = 0; t < 256; t++) {
    weightB += histogram[t];
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;
    sumB += t * histogram[t];
    const meanB = sumB / weightB;
    const meanF = (sumAll - sumB) / weightF;
    const variance = weightB * weightF * (meanB - meanF) * (meanB - meanF);
    if (variance > bestVariance) {
      bestVariance = variance;
      best = t;
    }
  }
  return best;
}

const luminanceOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * maskFromRgba(rgba, res) -> { bytes, coverage, bimodalRatio, bbox, source }
 *
 * rgba is a flat, top-down (row 0 = top) RGBA buffer of length res*res*4 —
 * the ImageData.data convention. `bytes` comes back in the same shape: body
 * pixels opaque white (255,255,255,255), background opaque black. coverage
 * is a percentage (0-100); bimodalRatio is a fraction (0-1); bbox is
 * { u0, u1, v0, v1 } in three's v-up convention, or null with zero body
 * pixels — never throws on a degenerate (e.g. fully transparent) input.
 */
export function maskFromRgba(rgba, res) {
  const totalPx = res * res;

  let hasAlpha = false;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < ALPHA_TRANSPARENT_BELOW) { hasAlpha = true; break; }
  }

  const isBody = new Uint8Array(totalPx);
  let source;

  if (hasAlpha) {
    source = 'alpha';
    for (let p = 0; p < totalPx; p++) {
      isBody[p] = rgba[p * 4 + 3] > ALPHA_BODY_ABOVE ? 1 : 0;
    }
  } else {
    source = 'luminance';
    const lum = new Uint8ClampedArray(totalPx);
    const histogram = new Array(256).fill(0);
    for (let p = 0; p < totalPx; p++) {
      const v = Math.round(luminanceOf(rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]));
      lum[p] = v;
      histogram[v]++;
    }
    const t = otsuThreshold(histogram);

    // Border-ring vote: the outermost 1px ring is background by definition.
    let ringSum = 0;
    let ringCount = 0;
    for (let x = 0; x < res; x++) {
      ringSum += lum[x] + lum[(res - 1) * res + x];
      ringCount += 2;
    }
    for (let y = 1; y < res - 1; y++) {
      ringSum += lum[y * res] + lum[y * res + res - 1];
      ringCount += 2;
    }
    const ringMean = ringCount > 0 ? ringSum / ringCount : 0;
    // Ring brighter than the threshold -> background is bright -> body is
    // the dark region. Ring darker -> body is the bright region.
    const bodyIsDark = ringMean > t;
    for (let p = 0; p < totalPx; p++) {
      isBody[p] = bodyIsDark ? (lum[p] <= t ? 1 : 0) : (lum[p] > t ? 1 : 0);
    }
  }

  const bytes = new Uint8ClampedArray(totalPx * 4);
  let bodyPx = 0;
  let bimodalPx = 0;
  let x0 = res, y0 = res, x1 = -1, y1 = -1;
  for (let p = 0; p < totalPx; p++) {
    const body = isBody[p] === 1;
    const v = body ? 255 : 0;
    bytes[p * 4] = v; bytes[p * 4 + 1] = v; bytes[p * 4 + 2] = v; bytes[p * 4 + 3] = 255;
    if (v < BIMODAL_DARK_BELOW || v > BIMODAL_LIGHT_ABOVE) bimodalPx++;
    if (body) {
      bodyPx++;
      const x = p % res, y = Math.floor(p / res);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }

  const coverage = (bodyPx / totalPx) * 100;
  const bimodalRatio = bimodalPx / totalPx;
  let bbox = null;
  if (bodyPx > 0) {
    bbox = {
      u0: x0 / res,
      u1: (x1 + 1) / res,
      v0: 1 - (y1 + 1) / res,
      v1: 1 - y0 / res,
    };
  }

  return { bytes, coverage, bimodalRatio, bbox, source };
}
