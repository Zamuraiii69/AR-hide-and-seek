// anchorPick.js — the single geometry primitive the whole game leans on.
//
// All four game actions (paint / eyedrop / drag / seek-tap) are the SAME
// operation: intersect the ray from the finger with the z=0 plane in the
// marker's anchor-local space. Write it once, reuse everywhere.
//
// Do NOT use THREE.Raycaster:
//   - it ignores visible:false (a lost anchor still raycasts off a stale matrix)
//   - anchor.group has matrixAutoUpdate=false and MindAR REPLACES group.matrix
//     wholesale each frame, so we must force updateWorldMatrix ourselves.
//
// Anchor space: origin = image centre, image width = 1.0 unit, height = aspect.
//   x ∈ [-0.5, 0.5], y ∈ [-aspect/2, aspect/2], z = 0.

import * as THREE from 'three';

const _inv = new THREE.Matrix4();
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();

/** DOM pointer event → normalized device coords in `out` (Vector2). */
export function screenToNDC(ev, el, out) {
  const r = el.getBoundingClientRect();
  out.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  out.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  return out;
}

/**
 * Intersect the camera ray through `ndc` with the anchor's z=0 plane.
 * Returns `out` (anchor-local Vector3) or null if the ray is parallel / behind.
 */
export function pickAnchorPlane(ndc, camera, anchorGroup, out) {
  anchorGroup.updateWorldMatrix(true, false);   // matrixAutoUpdate=false — force it
  _inv.copy(anchorGroup.matrixWorld).invert();

  _origin.setFromMatrixPosition(camera.matrixWorld);
  _dir.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(_origin).normalize();

  // Move ray into anchor space, then solve for z=0.
  _origin.applyMatrix4(_inv);
  _dir.transformDirection(_inv);
  if (Math.abs(_dir.z) < 1e-6) return null;       // ray parallel to plane
  const t = -_origin.z / _dir.z;
  if (t <= 0) return null;                         // plane is behind the camera
  return out.copy(_dir).multiplyScalar(t).add(_origin);
}

/**
 * Camera → marker distance, in MARKER WIDTHS (anchor space has width = 1).
 *
 * That unit is the point: one threshold then works for an A4 print, an A3 print
 * or a phone screen with no physical calibration. MindAR keeps the camera at the
 * origin and moves the anchor, so this is just the length of the camera position
 * re-expressed in anchor space. Only meaningful while the anchor is visible.
 */
export function cameraDistance(camera, anchorGroup) {
  anchorGroup.updateWorldMatrix(true, false);
  _inv.copy(anchorGroup.matrixWorld).invert();
  _origin.setFromMatrixPosition(camera.matrixWorld);
  return _origin.applyMatrix4(_inv).length();
}

/**
 * Anchor-local point → UV on the marker image (for the eyedropper).
 * u = x + 0.5 ; v = y/aspect + 0.5  (three's v=0 is the bottom).
 */
export function localToMarkerUV(p, aspect, out) {
  out.x = p.x + 0.5;
  out.y = p.y / aspect + 0.5;
  return out;
}

/**
 * Anchor-local point → UV on the silhouette mesh (for paint / hit test).
 * The mesh is a PlaneGeometry(1,1) scaled by (w,h), positioned at (px,py),
 * then rotated around z. Undo that transform before mapping to UV.
 * Returns null-ish coords outside [0,1] — callers decide whether to clamp;
 * hit test treats out-of-range as a miss.
 */
export function localToMeshUV(p, mesh, out) {
  const w = mesh.scale.x, h = mesh.scale.y;
  const dx = p.x - mesh.position.x;
  const dy = p.y - mesh.position.y;
  const c = Math.cos(-mesh.rotation.z);
  const s = Math.sin(-mesh.rotation.z);
  out.x = (dx * c - dy * s) / w + 0.5;
  out.y = (dx * s + dy * c) / h + 0.5;
  return out;
}
