// tools/check-mask.js — decode silhouette PNGs independently and validate the
// mask contract mask.js relies on: green channel bimodal, coverage in range, bbox
// inside [0,1].
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// PNG decoder — handles filters 0-4 and colour types 0/2/4/6, non-interlaced, 8-bit.
function decode(file) {
  const buf = fs.readFileSync(file);
  let p = 8, width, height, color, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error(`${file}: bit depth ${data[8]} unsupported`);
      if (data[12] !== 0) throw new Error(`${file}: interlaced`);
      color = data[9];
    }
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') break;
    p += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[color];
  if (!channels) throw new Error(`${file}: colour type ${color} unsupported`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= channels ? prev[i - channels] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
  }
  return { width, height, channels, color, data: out };
}

// Helper to extract green channel value at pixel (x, y).
function getGreenChannel(decoded, x, y) {
  const { width, channels, color, data } = decoded;
  const pixelOffset = y * width * channels + x * channels;

  // For color type 0 (grayscale, 1 channel) and 4 (grayscale+alpha, 2 channels),
  // use channel 0. For color type 2 (RGB, 3 channels) and 6 (RGBA, 4 channels),
  // use channel 1 (green).
  const greenIndex = (color === 0 || color === 4) ? 0 : 1;
  return data[pixelOffset + greenIndex];
}

// Check a single PNG file against the assertions.
function checkFile(filePath, fileName) {
  let failures = 0;

  try {
    const decoded = decode(filePath);
    const { width, height, channels, color, data } = decoded;

    // Assertion 1: 8-bit, non-interlaced, colour type ∈ {0,2,4,6}
    const colorTypeValid = [0, 2, 4, 6].includes(color);
    const pass1 = colorTypeValid;
    console.log(`${pass1 ? 'PASS' : 'FAIL'}  ${fileName}: 8-bit, non-interlaced, colour type ${color}`);
    if (!pass1) failures++;

    // Extract green channel and compute statistics.
    const greenPixels = [];
    let bodyPx = 0;
    let x0 = width, y0 = height, x1 = -1, y1 = -1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const g = getGreenChannel(decoded, x, y);
        greenPixels.push(g);

        if (g > 127) {
          bodyPx++;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }

    // Assertion 2: green channel is bimodal (≥95% < 8 or > 247).
    const bimodalPixels = greenPixels.filter(g => g < 8 || g > 247).length;
    const bimodalRatio = bimodalPixels / greenPixels.length;
    const pass2 = bimodalRatio >= 0.95;
    console.log(`${pass2 ? 'PASS' : 'FAIL'}  ${fileName}: green channel bimodal (${(bimodalRatio * 100).toFixed(1)}% ≥ 95%)`);
    if (!pass2) failures++;

    // Assertion 3: body coverage between 3% and 45%.
    const coverage = (bodyPx / (width * height)) * 100;
    const pass3 = coverage >= 3 && coverage <= 45;
    console.log(`${pass3 ? 'PASS' : 'FAIL'}  ${fileName}: body coverage ${coverage.toFixed(1)}% (3–45% range)`);
    if (!pass3) failures++;

    // Assertion 4: bbox non-empty and fully inside [0,1].
    let pass4 = false;
    let bboxDetail = '';
    if (bodyPx > 0) {
      const u0 = x0 / width;
      const u1 = (x1 + 1) / width;
      const v0 = 1 - (y1 + 1) / height;
      const v1 = 1 - y0 / height;

      pass4 = u0 >= 0 && u1 <= 1 && v0 >= 0 && v1 <= 1;
      bboxDetail = `bbox (${u0.toFixed(3)}, ${u1.toFixed(3)}, ${v0.toFixed(3)}, ${v1.toFixed(3)})`;
    } else {
      bboxDetail = 'empty (no body pixels)';
    }
    console.log(`${pass4 ? 'PASS' : 'FAIL'}  ${fileName}: bbox inside [0,1]  — ${bboxDetail}`);
    if (!pass4) failures++;

    return failures;
  } catch (err) {
    console.log(`FAIL  ${fileName}: decode error  — ${err.message}`);
    return 4; // All assertions failed due to decode error.
  }
}

// Main: glob public/assets/silhouettes/*.png and check each.
const silhouetteDir = path.join(__dirname, '..', 'public', 'assets', 'silhouettes');
const files = fs.readdirSync(silhouetteDir)
  .filter(f => f.endsWith('.png'))
  .sort();

let totalFailures = 0;
for (const fileName of files) {
  const filePath = path.join(silhouetteDir, fileName);
  totalFailures += checkFile(filePath, fileName);
}

// poses.js (browser ESM) vs gameRules.js (CommonJS) can't be linked with a
// shared require/import, so this is the parity check that keeps them from
// silently drifting apart. Dynamic import() works from a CommonJS file even
// though require() can't reach an ESM module directly — that's why the
// summary + exit below have to live inside this async IIFE instead of after
// the synchronous loop above: exiting early would race the import.
(async () => {
  const { POSE_IDS } = await import('../public/js/core/poses.js');
  const { SILHOUETTE_IDS } = require('../server/gameRules.js');

  const idsMatch = POSE_IDS.length === SILHOUETTE_IDS.length
    && POSE_IDS.every((id, i) => id === SILHOUETTE_IDS[i]);
  console.log(`${idsMatch ? 'PASS' : 'FAIL'}  poses.js/gameRules.js parity  — POSE_IDS: [${POSE_IDS.join(',')}]  SILHOUETTE_IDS: [${SILHOUETTE_IDS.join(',')}]`);
  if (!idsMatch) totalFailures++;

  const missingFile = POSE_IDS.filter((id) => !fs.existsSync(path.join(silhouetteDir, `${id}.png`)));
  const filesOk = missingFile.length === 0;
  console.log(`${filesOk ? 'PASS' : 'FAIL'}  every POSE_IDS entry resolves to a file  — ${filesOk ? 'ok' : 'missing: ' + missingFile.join(',')}`);
  if (!filesOk) totalFailures++;

  console.log(totalFailures === 0 ? '\nALL PASS' : `\n${totalFailures} FAILED`);
  process.exit(totalFailures === 0 ? 0 : 1);
})();
