// server/maskContract.js — the mask contract mask.js relies on: green channel
// bimodal, coverage in range, bbox inside [0,1]. Extracted from
// tools/check-mask.js so the PUT /api/markers/:id/pose/:slot upload route can
// enforce the same rule the shipped silhouette assets are checked against.
const { decodePng, getGreenChannel } = require('./pngDecode');

const BIMODAL_MIN = 0.95;
const COVERAGE_MIN = 3;
const COVERAGE_MAX = 45;

// validateMaskBuffer(buffer) -> { ok, coverage, bimodalRatio, bbox, error, ... }
// coverage is a percentage (0-100); bimodalRatio is a fraction (0-1); bbox is
// { u0, u1, v0, v1 } or null when the mask has no body pixels. `error`, when
// set, is a human-readable message with the measured numbers included, meant
// to be shown back to the uploader.
function validateMaskBuffer(buffer) {
  let decoded;
  try {
    decoded = decodePng(buffer);
  } catch (err) {
    return {
      ok: false,
      coverage: null,
      bimodalRatio: null,
      bbox: null,
      colorType: null,
      colorTypeValid: false,
      width: null,
      height: null,
      decodeError: err.message,
      error: `decode error: ${err.message}`,
    };
  }

  const { width, height, color } = decoded;
  const colorTypeValid = [0, 2, 4, 6].includes(color);

  // Counted in one pass rather than collected into an array — a 1024² asset
  // is a million samples, and the assertions below only need the tallies.
  const totalPx = width * height;
  let bimodalPx = 0;
  let bodyPx = 0;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const g = getGreenChannel(decoded, x, y);
      if (g < 8 || g > 247) bimodalPx++;
      if (g > 127) {
        bodyPx++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }

  const bimodalRatio = bimodalPx / totalPx;
  const bimodalOk = bimodalRatio >= BIMODAL_MIN;

  const coverage = (bodyPx / totalPx) * 100;
  const coverageOk = coverage >= COVERAGE_MIN && coverage <= COVERAGE_MAX;

  let bbox = null;
  let bboxOk = false;
  if (bodyPx > 0) {
    const u0 = x0 / width;
    const u1 = (x1 + 1) / width;
    const v0 = 1 - (y1 + 1) / height;
    const v1 = 1 - y0 / height;
    bboxOk = u0 >= 0 && u1 <= 1 && v0 >= 0 && v1 <= 1;
    bbox = { u0, u1, v0, v1 };
  }

  const errors = [];
  if (!colorTypeValid) errors.push(`colour type ${color} unsupported`);
  if (!bimodalOk) errors.push(`green channel not bimodal (${(bimodalRatio * 100).toFixed(1)}% < ${BIMODAL_MIN * 100}%)`);
  if (!coverageOk) errors.push(`body coverage ${coverage.toFixed(1)}% outside ${COVERAGE_MIN}-${COVERAGE_MAX}% range`);
  if (!bboxOk) errors.push(bodyPx > 0 ? 'bbox outside [0,1]' : 'bbox empty (no body pixels)');

  return {
    ok: colorTypeValid && bimodalOk && coverageOk && bboxOk,
    coverage,
    bimodalRatio,
    bbox,
    colorType: color,
    colorTypeValid,
    width,
    height,
    decodeError: null,
    error: errors.length ? errors.join('; ') : null,
  };
}

module.exports = { validateMaskBuffer, BIMODAL_MIN, COVERAGE_MIN, COVERAGE_MAX };
