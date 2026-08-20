// tools/check-normalize.mjs — maskNormalize.js against synthetic RGBA
// buffers. No canvas/DOM available in Node, so these are hand-built pixel
// grids rather than real decoded images — that is exactly what
// maskNormalize.js being DOM-free buys us.
//
// Run: node tools/check-normalize.mjs

import { MASK_LIMITS, otsuThreshold, maskFromRgba } from '../public/js/core/maskNormalize.js';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

// A filled circle, alpha channel: alpha=255 inside, alpha=0 outside. Body
// RGB is irrelevant on the alpha path.
function circleAlpha(res, radius, cx, cy) {
  const rgba = new Uint8ClampedArray(res * res * 4);
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const inside = Math.hypot(x - cx, y - cy) <= radius;
      const p = (y * res + x) * 4;
      rgba[p] = 200; rgba[p + 1] = 50; rgba[p + 2] = 50;
      rgba[p + 3] = inside ? 255 : 0;
    }
  }
  return rgba;
}

// A filled circle, no alpha (opaque throughout): grayscale bodyValue inside,
// bgValue outside. R=G=B so luminance equals the value exactly.
function circleLuminance(res, radius, cx, cy, bodyValue, bgValue) {
  const rgba = new Uint8ClampedArray(res * res * 4);
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const inside = Math.hypot(x - cx, y - cy) <= radius;
      const v = inside ? bodyValue : bgValue;
      const p = (y * res + x) * 4;
      rgba[p] = v; rgba[p + 1] = v; rgba[p + 2] = v; rgba[p + 3] = 255;
    }
  }
  return rgba;
}

// --- alpha path: coverage matches pi*r^2 -----------------------------------
{
  const res = 256, radius = 64, cx = 128, cy = 128;
  const rgba = circleAlpha(res, radius, cx, cy);
  const result = maskFromRgba(rgba, res);
  const expected = (Math.PI * radius * radius / (res * res)) * 100;
  check(
    'alpha path: filled circle coverage matches pi*r^2',
    result.source === 'alpha' && Math.abs(result.coverage - expected) < 1,
    `expected ~${expected.toFixed(1)}%, got ${result.coverage.toFixed(1)}%`,
  );
}

// --- luminance path: dark-on-light and light-on-dark must agree ------------
{
  const res = 256, radius = 64, cx = 128, cy = 128;
  const darkOnLight = maskFromRgba(circleLuminance(res, radius, cx, cy, 20, 220), res);
  const lightOnDark = maskFromRgba(circleLuminance(res, radius, cx, cy, 220, 20), res);
  const expected = (Math.PI * radius * radius / (res * res)) * 100;
  check(
    'luminance path: dark-on-light finds the dark circle',
    darkOnLight.source === 'luminance' && Math.abs(darkOnLight.coverage - expected) < 1,
    `expected ~${expected.toFixed(1)}%, got ${darkOnLight.coverage.toFixed(1)}%`,
  );
  check(
    'luminance path: light-on-dark finds the light circle',
    lightOnDark.source === 'luminance' && Math.abs(lightOnDark.coverage - expected) < 1,
    `expected ~${expected.toFixed(1)}%, got ${lightOnDark.coverage.toFixed(1)}%`,
  );
  check(
    'both polarities agree on coverage',
    Math.abs(darkOnLight.coverage - lightOnDark.coverage) < 0.5,
    `dark-on-light ${darkOnLight.coverage.toFixed(1)}% vs light-on-dark ${lightOnDark.coverage.toFixed(1)}%`,
  );
}

// --- Otsu on a grey ramp: symmetric, so the split should land mid-range ----
{
  const histogram = new Array(256).fill(1);
  const t = otsuThreshold(histogram);
  check('Otsu on a uniform grey ramp returns a mid-range threshold', t >= 64 && t <= 192, `t=${t}`);
}
{
  const t = otsuThreshold(new Array(256).fill(0));
  check('Otsu on an empty histogram does not throw', t === 127, `t=${t}`);
}

// --- output contains only 0 and 255 -----------------------------------------
{
  const res = 64;
  const result = maskFromRgba(circleAlpha(res, 20, 32, 32), res);
  const onlyBinary = Array.from(result.bytes).every((v, i) => (i % 4 === 3 ? v === 255 : v === 0 || v === 255));
  check('output contains only 0 and 255', onlyBinary);
}

// --- coverage outside limits -> would be blocked, with a reason ------------
{
  const res = 128;
  const result = maskFromRgba(circleAlpha(res, 3, 64, 64), res); // tiny — well under 3%
  const withinLimits = result.coverage >= MASK_LIMITS.minCoverage && result.coverage <= MASK_LIMITS.maxCoverage;
  check(
    'a too-small body falls outside MASK_LIMITS.minCoverage',
    !withinLimits && result.coverage < MASK_LIMITS.minCoverage,
    `coverage=${result.coverage.toFixed(2)}% (limit ${MASK_LIMITS.minCoverage}-${MASK_LIMITS.maxCoverage}%)`,
  );
}

// --- fully transparent input does not throw ---------------------------------
{
  const res = 32;
  const rgba = new Uint8ClampedArray(res * res * 4); // all zero: r=g=b=a=0
  let threw = false;
  let result;
  try {
    result = maskFromRgba(rgba, res);
  } catch {
    threw = true;
  }
  check(
    'fully transparent input does not throw',
    !threw && result.coverage === 0 && result.bbox === null,
    threw ? 'threw' : `coverage=${result.coverage}, bbox=${JSON.stringify(result.bbox)}`,
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
