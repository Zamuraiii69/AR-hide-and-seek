// silhouette.js — the flat, unlit body mesh: geometry + material + paint canvas.
//
// Invariants that the rest of the game depends on (see plan §Material):
//   - MeshBasicMaterial (unlit) so painted colour == displayed colour.
//   - paint canvas is ALWAYS 100% opaque (starts with a fillRect) → rendered
//     alpha ≡ mask green channel, so hit test reads the mask, not the paint.
//   - PAINT_RES = 512: CanvasTexture.needsUpdate re-uploads the whole texture
//     each paint frame; 1024² would be 4 MiB/upload and drop frames on mobile.
//   - depthTest/Write off + renderOrder: the marker lives in the <video> BEHIND
//     the WebGL canvas, so there is nothing to z-fight; no epsilon tuning.

import * as THREE from 'three';

export const PAINT_RES = 512;
const Z_SILHOUETTE = 0.001;               // hair above the marker plane
const BASE_COLOR = '#b1b1b1';             // opaque neutral until first paint

const _texLoader = new THREE.TextureLoader();

/**
 * Build a silhouette. `maskUrl` supplies the alphaMap (green channel = body).
 * Returns the mesh plus paint surface handles and small transform helpers.
 */
export async function createSilhouette({ maskUrl, paintRes = PAINT_RES, baseColor = BASE_COLOR } = {}) {
  // --- alpha mask texture (keep NoColorSpace; SRGB would shift the alpha edge) ---
  let maskTexture = await _texLoader.loadAsync(maskUrl);
  maskTexture.generateMipmaps = false;
  maskTexture.minFilter = maskTexture.magFilter = THREE.LinearFilter;

  // --- paint canvas + texture (opaque base) ---
  const paintCanvas = document.createElement('canvas');
  paintCanvas.width = paintCanvas.height = paintRes;
  const pctx = paintCanvas.getContext('2d', { willReadFrequently: true });
  pctx.fillStyle = baseColor;
  pctx.fillRect(0, 0, paintRes, paintRes);

  const paintTexture = new THREE.CanvasTexture(paintCanvas);
  paintTexture.colorSpace = THREE.SRGBColorSpace;   // default NoColorSpace — must set
  paintTexture.generateMipmaps = false;
  paintTexture.minFilter = paintTexture.magFilter = THREE.LinearFilter;

  const material = new THREE.MeshBasicMaterial({
    map: paintTexture,
    alphaMap: maskTexture,
    color: 0xffffff,                 // per-channel gain hook for white balance (Phase 8)
    transparent: true, alphaTest: 0.5,
    depthTest: false, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false, fog: false,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.position.set(0, 0, Z_SILHOUETTE);
  mesh.renderOrder = 10;
  mesh.frustumCulled = false;

  // --- helpers ---------------------------------------------------------------
  // All transform values are anchor-local units.
  function setTransform({ x = 0, y = 0, rot = 0, w = 0.3, h = 0.3 } = {}) {
    mesh.position.x = x; mesh.position.y = y;
    mesh.scale.set(w, h, 1);
    mesh.rotation.z = rot;
  }

  // Swap the alpha mask texture on the existing mesh (pose switch) without
  // rebuilding the silhouette. Assign the new texture first, dispose the old
  // one second — reversing the order risks a frame rendered with no alpha map.
  async function setMask(url) {
    const next = await _texLoader.loadAsync(url);
    next.generateMipmaps = false;
    next.minFilter = next.magFilter = THREE.LinearFilter;
    material.alphaMap = next;
    material.needsUpdate = true;
    maskTexture.dispose();   // dispose the OLD texture — AFTER assigning the new one, never before (a flash of untextured frame)
    maskTexture = next;
  }

  function fillBase(color = baseColor) {
    pctx.fillStyle = color;
    pctx.fillRect(0, 0, paintRes, paintRes);
    paintTexture.needsUpdate = true;
  }

  // Load a previously-saved paint texture (seek mode) over the base.
  function loadPaint(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        pctx.drawImage(img, 0, 0, paintRes, paintRes);
        paintTexture.needsUpdate = true;
        resolve();
      };
      img.onerror = () => reject(new Error(`failed to load paint ${url}`));
      img.src = url;
    });
  }

  const getPaintDataUrl = () => paintCanvas.toDataURL('image/png');

  function dispose() {
    mesh.geometry.dispose();
    material.dispose();
    paintTexture.dispose();
    maskTexture.dispose();
  }

  return {
    mesh, material, paintCanvas, pctx, paintTexture, maskTexture, paintRes,
    setTransform, setMask, fillBase, loadPaint, getPaintDataUrl, dispose,
  };
}
