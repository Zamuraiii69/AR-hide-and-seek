// tools/check-mask.js — drives server/maskContract.js against the shipped
// silhouette assets in public/assets/silhouettes/*.png, plus the POSE_IDS /
// SILHOUETTE_IDS parity check between the browser and server declarations.
const fs = require('fs');
const path = require('path');
const { validateMaskBuffer, BIMODAL_MIN, COVERAGE_MIN, COVERAGE_MAX } = require('../server/maskContract');

// Check a single PNG file against the mask contract, printing one line per
// assertion (kept granular for readability, even though validateMaskBuffer
// only needs to return ok/error for callers like the upload route).
function checkFile(filePath, fileName) {
  const buffer = fs.readFileSync(filePath);
  const result = validateMaskBuffer(buffer);

  if (result.decodeError) {
    console.log(`FAIL  ${fileName}: decode error  — ${result.decodeError}`);
    return 4; // All assertions failed due to decode error.
  }

  let failures = 0;

  const pass1 = result.colorTypeValid;
  console.log(`${pass1 ? 'PASS' : 'FAIL'}  ${fileName}: 8-bit, non-interlaced, colour type ${result.colorType}`);
  if (!pass1) failures++;

  const pass2 = result.bimodalRatio >= BIMODAL_MIN;
  console.log(`${pass2 ? 'PASS' : 'FAIL'}  ${fileName}: green channel bimodal (${(result.bimodalRatio * 100).toFixed(1)}% ≥ ${BIMODAL_MIN * 100}%)`);
  if (!pass2) failures++;

  const pass3 = result.coverage >= COVERAGE_MIN && result.coverage <= COVERAGE_MAX;
  console.log(`${pass3 ? 'PASS' : 'FAIL'}  ${fileName}: body coverage ${result.coverage.toFixed(1)}% (${COVERAGE_MIN}–${COVERAGE_MAX}% range)`);
  if (!pass3) failures++;

  const pass4 = !!result.bbox;
  const bboxDetail = result.bbox
    ? `bbox (${result.bbox.u0.toFixed(3)}, ${result.bbox.u1.toFixed(3)}, ${result.bbox.v0.toFixed(3)}, ${result.bbox.v1.toFixed(3)})`
    : 'empty (no body pixels)';
  console.log(`${pass4 ? 'PASS' : 'FAIL'}  ${fileName}: bbox inside [0,1]  — ${bboxDetail}`);
  if (!pass4) failures++;

  return failures;
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
