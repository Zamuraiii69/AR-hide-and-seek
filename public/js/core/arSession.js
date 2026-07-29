// arSession.js — MindAR bootstrap shared by hide + seek pages.
//
// Distilled from the original PoC startAR(): create MindARThree against a
// compiled .mind, add anchor 0, wire found/lost, then start() applies the
// black-screen fix, pixel-ratio cap, and pointer routing before running a
// single RAF loop that fans out to registered onFrame callbacks.
//
// The anchor group is only meaningful while `visible` is true — every pointer
// handler must bail on !visible (a lost anchor keeps a stale matrix).

import * as THREE from 'three';
import { MindARThree } from 'mindar-image-three';

// Strong smoothing tuned for a still overlay — do NOT loosen (see plan).
export const DEFAULT_FILTER = {
  filterMinCF: 0.0001, filterBeta: 0.01, missTolerance: 5, warmupTolerance: 5,
};

/**
 * Create an AR session against a compiled marker.
 * @param {{ container: HTMLElement, mindUrl: string, filter?: object,
 *           onFound?: Function, onLost?: Function }} opts
 */
export function createArSession({ container, mindUrl, filter, onFound, onLost }) {
  const mindarThree = new MindARThree({
    container,
    imageTargetSrc: mindUrl,
    ...DEFAULT_FILTER,
    ...(filter || {}),
  });
  const { renderer, scene, camera } = mindarThree;
  const anchor = mindarThree.addAnchor(0);

  let visible = false;
  anchor.onTargetFound = () => { visible = true; onFound && onFound(); };
  anchor.onTargetLost = () => { visible = false; onLost && onLost(); };

  const frameCbs = new Set();
  let started = false;

  async function start() {
    if (!window.isSecureContext) {
      const err = new Error('Camera needs a secure context (open the https/ngrok URL).');
      err.code = 'INSECURE_CONTEXT';
      throw err;
    }
    await mindarThree.start();               // prompts for camera permission
    started = true;

    // Black-screen fix: transparent WebGL canvas over the camera <video>.
    renderer.setClearColor(0x000000, 0);
    renderer.setClearAlpha(0);
    scene.background = null;
    if (mindarThree.video) mindarThree.video.style.zIndex = '1';
    renderer.domElement.style.zIndex = '2';

    // Cap DPR for iOS framebuffer headroom; route touches to our canvas.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.touchAction = 'none';
    // MindAR's CSS3DRenderer shares the container and would swallow pointers.
    if (mindarThree.cssRenderer) mindarThree.cssRenderer.domElement.style.pointerEvents = 'none';

    renderer.setAnimationLoop(() => {
      const now = performance.now();
      for (const cb of frameCbs) cb(now, session);
      renderer.render(scene, camera);
    });
  }

  /** Register a per-frame callback (now, session). Returns an unsubscribe fn. */
  function onFrame(cb) {
    frameCbs.add(cb);
    return () => frameCbs.delete(cb);
  }

  async function dispose() {
    frameCbs.clear();
    renderer.setAnimationLoop(null);
    if (started) { try { await mindarThree.stop(); } catch { /* already stopped */ } }
  }

  const session = {
    mindarThree, anchor, renderer, scene, camera,
    group: anchor.group,
    get visible() { return visible; },
    get started() { return started; },
    start, onFrame, dispose,
  };
  return session;
}
