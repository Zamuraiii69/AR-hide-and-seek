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

// Tracking filter. A live trade-off, not settled numbers (plan-phase5 §5.0):
//   missTolerance — frames MindAR keeps the anchor `visible` AFTER detection
//     fails, drawing a stale pose. The Phase 2 value of 5 is the direct cause of
//     the silhouette sliding off the marker during fast motion, which is also a
//     gameplay exploit (shake the phone, watch for the thing that lags).
//   filterBeta — one-euro speed coefficient. Low = steady when still, laggy when
//     moving. 0.01 was pinned to the "still" extreme.
// Now at the middle of the range the plan asks to try. These have NOT been
// measured on a device; use ?beta=&miss= (filterFromSearch) to try others
// without a redeploy, then write the winner here.
export const DEFAULT_FILTER = {
  filterMinCF: 0.0001, filterBeta: 0.05, missTolerance: 1, warmupTolerance: 5,
};

// Query keys → MindAR filter keys, for the on-device tuning loop.
const FILTER_KEYS = [
  ['mincf', 'filterMinCF'], ['beta', 'filterBeta'],
  ['miss', 'missTolerance'], ['warmup', 'warmupTolerance'],
];

/**
 * Parse a filter override out of a query string: `?beta=0.1&miss=2`.
 * Step 5.0 is "try numbers on a phone and record what you see" — without this
 * every attempt costs an edit + redeploy, which is why it never got done.
 * Ignores absent / non-finite / negative values. Returns a partial filter.
 */
export function filterFromSearch(search) {
  const params = new URLSearchParams(search);
  const filter = {};
  for (const [key, name] of FILTER_KEYS) {
    const value = Number(params.get(key));
    if (params.get(key) !== null && Number.isFinite(value) && value >= 0) filter[name] = value;
  }
  return filter;
}

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
