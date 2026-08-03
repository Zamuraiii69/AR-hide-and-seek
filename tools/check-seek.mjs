// tools/check-seek.mjs — Phase 5 unit checks (plan-phase5 §Verification).
//
// Covers the three things that are cheap to get wrong and expensive to notice
// on a phone: the distance maths, the hysteresis (a flickering overlay is worse
// than no overlay), and the hit test at the silhouette's edge.
//
// `three` is a devDependency purely so these can import the real browser
// modules instead of a parallel copy that drifts. The pages still load three
// from the CDN importmap — nothing here changes what ships.
// arSession.js stays untestable this way: it imports mind-ar, which is a
// browser-only bundle. Same for anything touching document/canvas.
//
// Run: node tools/check-seek.mjs

import * as THREE from 'three';
import { cameraDistance } from '../public/js/core/anchorPick.js';
import { createDistanceGate, ENGAGE_BELOW, RELEASE_ABOVE } from '../public/js/core/distanceGate.js';
import { createBackdrop } from '../public/js/core/backdrop.js';
import { makeMask } from '../public/js/core/mask.js';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

// --- cameraDistance --------------------------------------------------------
// MindAR pins the camera at the origin and writes the marker pose into the
// anchor group's matrix, with matrixAutoUpdate off. Reproduce exactly that.

function anchorAt(position, euler = new THREE.Euler()) {
  const group = new THREE.Object3D();
  group.matrixAutoUpdate = false;
  group.matrix.compose(position, new THREE.Quaternion().setFromEuler(euler), new THREE.Vector3(1, 1, 1));
  return group;
}

const camera = new THREE.PerspectiveCamera();
camera.matrixAutoUpdate = false;      // we set matrixWorld by hand below

const straightOn = anchorAt(new THREE.Vector3(0, 0, -2));
check('cameraDistance: marker 2 marker-widths straight ahead → 2',
  Math.abs(cameraDistance(camera, straightOn) - 2) < 1e-6,
  String(cameraDistance(camera, straightOn)));

// Rotating the marker must not change how far away it is.
const tilted = anchorAt(new THREE.Vector3(0.3, -0.4, -1.2), new THREE.Euler(0.6, -0.4, 1.1));
check('cameraDistance: unaffected by marker orientation (rigid pose)',
  Math.abs(cameraDistance(camera, tilted) - Math.hypot(0.3, 0.4, 1.2)) < 1e-6,
  String(cameraDistance(camera, tilted)));

// A camera that is not at the origin must still be measured correctly.
camera.matrixWorld.makeTranslation(0, 0, 1);
check('cameraDistance: honours the camera position, not just the anchor',
  Math.abs(cameraDistance(camera, straightOn) - 3) < 1e-6,
  String(cameraDistance(camera, straightOn)));
camera.matrixWorld.identity();

// --- distance gate ---------------------------------------------------------

const gate = createDistanceGate();
const ramp = [1.2, 1.1, 1.0, 0.9, 0.85, 0.82, 0.8, 0.75, 0.6, 0.5,
  0.6, 0.75, 0.82, 0.85, 0.9, 0.94, 0.95, 1.0, 1.1, 1.2];
const transitions = [];
for (const d of ramp) if (gate.update(d)) transitions.push({ d, gated: gate.gated });

check('gate: a 1.2 → 0.5 → 1.2 ramp engages exactly once and releases exactly once',
  transitions.length === 2 && transitions[0].gated === true && transitions[1].gated === false,
  JSON.stringify(transitions));
check('gate: engages below the engage threshold, releases above the release one',
  transitions[0]?.d < ENGAGE_BELOW && transitions[1]?.d >= RELEASE_ABOVE,
  `engaged at ${transitions[0]?.d}, released at ${transitions[1]?.d}`);
check('gate: ends the ramp open', gate.gated === false);

// The flicker case: standing still in the dead band must produce NO events.
const still = createDistanceGate();
still.update(0.5);                                   // engage
let churn = 0;
for (let i = 0; i < 40; i++) if (still.update(0.85 + (i % 2) * 0.02)) churn++;
check('gate: hovering inside the dead band never toggles (no flicker)',
  churn === 0 && still.gated === true, `${churn} toggles`);

const approach = createDistanceGate();
let earlyChurn = 0;
for (let i = 0; i < 40; i++) if (approach.update(0.9 - (i % 2) * 0.02)) earlyChurn++;
check('gate: hovering above the engage threshold never engages',
  earlyChurn === 0 && approach.gated === false, `${earlyChurn} toggles`);

// A lost anchor gives no distance — hold, do not silently release.
const lost = createDistanceGate();
lost.update(0.5);
lost.update(NaN);
lost.update(undefined);
check('gate: a non-finite distance holds the current state', lost.gated === true);
check('gate: reset() drops the gate and reports the change',
  lost.reset() === true && lost.gated === false && lost.reset() === false);

try {
  createDistanceGate({ engageBelow: 0.9, releaseAbove: 0.9 });
  check('gate: rejects thresholds that would remove the hysteresis', false);
} catch {
  check('gate: rejects thresholds that would remove the hysteresis', true);
}

// --- mask.isBody at the silhouette edge ------------------------------------
// Body = the square [0.25, 0.75] in uv. v=0 is the BOTTOM, so rows invert.

const RES = 64;
const data = new Uint8Array(RES * RES);
for (let y = 16; y < 48; y++) for (let x = 16; x < 48; x++) data[y * RES + x] = 255;
const mask = makeMask(RES, data, { u0: 0.25, u1: 0.75, v0: 0.25, v1: 0.75 });

check('mask: a tap in the middle of the body is a hit', mask.isBody(0.5, 0.5) === true);
check('mask: just inside the left edge is a hit', mask.isBody(0.26, 0.5) === true);
check('mask: just OUTSIDE the edge still hits, within the ring tolerance',
  mask.isBody(0.23, 0.5, 0.03) === true);
check('mask: beyond the tolerance is a miss', mask.isBody(0.20, 0.5, 0.03) === false);
check('mask: well outside the body is a miss', mask.isBody(0.05, 0.05, 0.03) === false);
check('mask: off the mesh entirely is a miss, not a wrap-around hit',
  mask.isBody(-0.4, 0.5, 0.03) === false && mask.isBody(0.5, 1.6, 0.03) === false);

// --- backdrop --------------------------------------------------------------
// colorSpace is the one that fails silently: wrong value, every colour shifts,
// and the camouflage the hider tuned no longer matches what the seeker sees.

const backdrop = createBackdrop({ image: { width: 8, height: 8 }, aspect: 1.5 });
const geometry = backdrop.mesh.geometry.parameters;
check('backdrop: plane is exactly marker-sized (1 × aspect)',
  geometry.width === 1 && geometry.height === 1.5, `${geometry.width} × ${geometry.height}`);
check('backdrop: texture is sRGB and flagged for upload',
  backdrop.texture.colorSpace === THREE.SRGBColorSpace && backdrop.texture.version > 0,
  `${backdrop.texture.colorSpace} v${backdrop.texture.version}`);
check('backdrop: draws under the silhouette (renderOrder 5 < 10) with depth off',
  backdrop.mesh.renderOrder === 5
  && backdrop.material.depthTest === false && backdrop.material.depthWrite === false);
check('backdrop: sits at the marker plane, z = 0',
  backdrop.mesh.position.x === 0 && backdrop.mesh.position.y === 0 && backdrop.mesh.position.z === 0);

for (const [name, opts] of [['no image', { aspect: 1 }], ['aspect 0', { image: {}, aspect: 0 }]]) {
  try {
    createBackdrop(opts);
    check(`backdrop: rejects ${name}`, false);
  } catch {
    check(`backdrop: rejects ${name}`, true);
  }
}

backdrop.dispose();

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
