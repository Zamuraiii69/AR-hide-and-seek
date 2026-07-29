// tools/check-palette.mjs — Phase 4 unit checks against buffers with KNOWN answers.
//
// Palette bugs come out looking like "greyish, seems fine", which is
// indistinguishable from a correct result by eye. Synthetic images are the only
// way to tell. Imports the real browser modules (public/js is type:module).
//
// Run: node tools/check-palette.mjs

import { extractPalette, gridPalette, toHex } from '../public/js/core/palette.js';
import { makeSampler, loadMarkerSampler } from '../public/js/core/markerSampler.js';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

// --- synthetic images ------------------------------------------------------

/** RGBA buffer where colorAt(x, y) → [r,g,b] (alpha 255). */
function image(W, H, colorAt) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = colorAt(x, y);
      const i = (y * W + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return data;
}

const W = 256, H = 256;
const RED = [220, 30, 30], BLUE = [30, 40, 220];
const halves = image(W, H, (x) => (x < W / 2 ? RED : BLUE));
const solid = image(W, H, () => [130, 120, 100]);

const near = (hex, [r, g, b], tol = 2) => {
  const v = parseInt(hex.slice(1), 16);
  return Math.abs((v >> 16) - r) <= tol
    && Math.abs(((v >> 8) & 255) - g) <= tol
    && Math.abs((v & 255) - b) <= tol;
};

// --- extractPalette --------------------------------------------------------

// Order between the two is a genuine tie at exactly 50/50, so assert membership
// rather than position — what matters is that neither got averaged into purple.
const dominant = extractPalette(halves, W, H);
check(
  'extractPalette(half red / half blue) returns red and blue, not purple',
  dominant.length === 2
    && dominant.some((c) => near(c, RED))
    && dominant.some((c) => near(c, BLUE)),
  JSON.stringify(dominant),
);

const flat = extractPalette(solid, W, H);
check(
  'extractPalette(solid colour) returns one swatch, not 8 duplicates',
  flat.length === 1 && near(flat[0], [130, 120, 100]),
  JSON.stringify(flat),
);

// --- gridPalette -----------------------------------------------------------

const zones = gridPalette(halves, W, H, 4);
const leftCols = [], rightCols = [];
for (let row = 0; row < 4; row++) {
  leftCols.push(zones[row * 4], zones[row * 4 + 1]);
  rightCols.push(zones[row * 4 + 2], zones[row * 4 + 3]);
}
check(
  'gridPalette(G=4): 16 cells, left two columns red, right two blue',
  zones.length === 16
    && leftCols.every((c) => near(c, RED))
    && rightCols.every((c) => near(c, BLUE)),
  `left=${leftCols[0]} right=${rightCols[0]}`,
);

// Row order must be image order (index 0 = TOP-left) so the HUD reads like the
// printed marker. Vertical split proves it: top half green, bottom half black.
const GREEN = [20, 200, 90], DARK = [10, 10, 10];
const stacked = image(W, H, (_x, y) => (y < H / 2 ? GREEN : DARK));
const stackedZones = gridPalette(stacked, W, H, 4);
check(
  'gridPalette index 0 is the TOP-left cell (image row order)',
  near(stackedZones[0], GREEN) && near(stackedZones[12], DARK),
  `[0]=${stackedZones[0]} [12]=${stackedZones[12]}`,
);

// --- the "all grey" failure mode -------------------------------------------
// A real marker is textured, and the way this goes wrong is not a crash: it is
// a palette of plausible-looking greys, which is indistinguishable from a good
// result by eye. Three coloured regions + heavy per-pixel noise must still come
// back as three separated colours, never their average.

const REGIONS = [[150, 80, 40], [70, 110, 60], [190, 175, 130]];
let seed = 12345;
const noise = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;   // fixed LCG: repeatable
  return ((seed >> 8) % 61) - 30;
};
const textured = image(W, H, (x, y) => {
  const base = REGIONS[(Math.floor(y / (H / 3))) % 3];
  return base.map((c) => Math.max(0, Math.min(255, c + noise())));
});

const texturePalette = extractPalette(textured, W, H);
const spread = (hex) => {
  const v = parseInt(hex.slice(1), 16);
  const ch = [v >> 16, (v >> 8) & 255, v & 255];
  return Math.max(...ch) - Math.min(...ch);
};
check(
  'extractPalette on a noisy textured image keeps the regions apart (not all grey)',
  texturePalette.length >= 3 && texturePalette.filter((c) => spread(c) > 25).length >= 3,
  JSON.stringify(texturePalette),
);
check(
  'gridPalette on the same image gives distinct zones, not 16 copies',
  new Set(gridPalette(textured, W, H, 4)).size >= 3,
  `${new Set(gridPalette(textured, W, H, 4)).size} distinct of 16`,
);

// Cost check: this runs on every hide-page load, on a phone.
const big = image(1024, 1024, (x, y) => [x & 255, y & 255, (x ^ y) & 255]);
const t0 = performance.now();
extractPalette(big, 1024, 1024);
gridPalette(big, 1024, 1024, 4);
const ms = performance.now() - t0;
check(`extract + grid on 1024² stays cheap (${ms.toFixed(1)} ms)`, ms < 200);

// --- sampler.sample() ------------------------------------------------------

// Smooth ramp: r varies with x, b with y — every pixel colour is predictable,
// and a disc mean around a linear ramp equals the centre value.
const ramp = image(W, H, (x, y) => [Math.round(x / (W - 1) * 255), 128, Math.round(y / (H - 1) * 255)]);
const sampler = makeSampler(ramp, W, H, H / W);

// v=0 is the BOTTOM (three convention) → pixel row = (1-v)*H.
const cases = [
  { u: 0.5, v: 0.5, want: [128, 128, 127] },
  { u: 0.25, v: 0.75, want: [64, 128, 64] },   // left-ish, near the top
  { u: 0.75, v: 0.25, want: [191, 128, 191] },
];
for (const { u, v, want } of cases) {
  const got = sampler.sample(u, v);
  check(
    `sample(${u}, ${v}) within ±2 of the known pixel`,
    got !== null && near(got.hex, want),
    `got ${got?.hex} want ${toHex(...want)}`,
  );
}

check('sample() rejects uv outside [0,1] instead of clamping',
  sampler.sample(-0.01, 0.5) === null && sampler.sample(0.5, 1.4) === null);

// A single flat pixel value must survive the disc mean untouched.
const flatSampler = makeSampler(solid, W, H, 1);
check('sample() on a solid image returns exactly that colour',
  near(flatSampler.sample(0.1, 0.9).hex, [130, 120, 100], 0),
  flatSampler.sample(0.1, 0.9).hex);

// Fully transparent pixels carry no colour → null, never black.
const clear = new Uint8ClampedArray(16 * 16 * 4);
check('sample() returns null over fully transparent pixels (not black)',
  makeSampler(clear, 16, 16, 1).sample(0.5, 0.5) === null);

// --- loadMarkerSampler with DOM stubs -------------------------------------
// Checks the parts only the load path can get wrong: aspect from natural size,
// downscale to maxDim, and releasing the canvas after decode.

const released = [];
globalThis.Image = class {
  constructor() { this.naturalWidth = 372; this.naturalHeight = 674; }
  set src(_v) { setTimeout(() => this.onload?.(), 0); }
};
globalThis.document = {
  createElement() {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage() {},
        getImageData: (_x, _y, w, h) => ({ data: image(w, h, () => [1, 2, 3]) }),
      }),
    };
    released.push(canvas);
    return canvas;
  },
};

const loaded = await loadMarkerSampler('stub://card.png', 256);
check('loadMarkerSampler derives aspect from natural size (372×674 → 1.812)',
  Math.abs(loaded.aspect - 674 / 372) < 1e-9, String(loaded.aspect));
check('loadMarkerSampler downscales the long edge to maxDim',
  loaded.H === 256 && loaded.W === Math.round(372 * 256 / 674), `${loaded.W}x${loaded.H}`);
check('loadMarkerSampler releases the canvas after decode (iOS canvas memory)',
  released.length === 1 && released[0].width === 0 && released[0].height === 0);
check('loaded sampler still samples after the canvas is gone',
  near(loaded.sample(0.5, 0.5).hex, [1, 2, 3], 0));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
