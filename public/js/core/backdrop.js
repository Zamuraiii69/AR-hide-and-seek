// backdrop.js — the marker image, redrawn as a plane inside the anchor group.
//
// Why this exists (plan-phase5 §5.1): tracking error moves the silhouette but
// not the real paper, so a fast camera move visibly slides the model off the
// marker. That is not only ugly, it is a free win for the seeker — shake the
// phone and look for the thing that lags. Rendering the marker as a sibling of
// the silhouette makes both drift together, so there is nothing to spot.
//
// Second, larger payoff: the hider now camouflages against the SOURCE FILE
// rather than against what the camera happens to be doing to it (auto-exposure,
// auto white balance, tone curve — a 10-30% moving target). The Phase 4
// eyedropper samples that same file, so a picked colour is now exact.
//
// Known cost, accepted: glare, shadow and specular highlight on the paper
// disappear, so the rectangle reads as "too clean" under harsh light. It is a
// whole-rectangle effect that does not point at the silhouette, so it costs
// realism without leaking the answer.
//
// Layering: backdrop 5 → silhouette 10, both depthTest:false. There is nothing
// to z-fight against because the real marker lives in the <video> BEHIND the
// WebGL canvas — the z offsets here are for parallax feel, not depth sorting.

import * as THREE from 'three';

const RENDER_ORDER = 5;                   // silhouette.js uses 10

/**
 * Plane textured with the marker image, sized to anchor space exactly
 * (width = 1, height = aspect) and centred on the marker.
 *
 * Takes the decoded image rather than a ready-made THREE.Texture: the texture
 * needs colorSpace/needsUpdate set correctly (getting colorSpace wrong shifts
 * every colour, the same trap as the paint texture), and owning it here means
 * dispose() can be trusted to actually free it.
 *
 * @param {{ image: TexImageSource, aspect: number }} opts
 */
export function createBackdrop({ image, aspect }) {
  if (!image) throw new Error('createBackdrop needs a decoded image');
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error(`bad aspect: ${aspect}`);

  const texture = new THREE.Texture(image);
  texture.colorSpace = THREE.SRGBColorSpace;   // default NoColorSpace — must set
  texture.needsUpdate = true;                  // TextureLoader does this for you; we must

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    depthTest: false, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false, fog: false,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, aspect), material);
  mesh.position.set(0, 0, 0);
  mesh.renderOrder = RENDER_ORDER;
  mesh.frustumCulled = false;      // MindAR replaces group.matrix wholesale

  function dispose() {
    mesh.geometry.dispose();
    material.dispose();
    texture.dispose();
  }

  return { mesh, material, texture, dispose };
}
