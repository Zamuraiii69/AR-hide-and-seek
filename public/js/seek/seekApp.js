// seekApp.js — the seeker's screen: LOADING → READY → HUNTING → RESULT.
//
// The distance gate is a SUB-STATE of HUNTING (hud[data-gated]), not a mode:
// it comes and goes as the player moves and there is nothing to dismiss.
//
// Rules carried over from the hider, each one paid for in Phase 3:
//   - act on end() with { tap: true }, never on start(). Otherwise every camera
//     reposition burns a guess.
//   - every handler returns early on !session.visible — a lost anchor keeps a
//     stale matrix, and a hit scored off a stale pose is indistinguishable from
//     cheating.
//   - fetch the hide at page load, never inside the start-camera handler: the
//     await would break the iOS user-gesture chain and the camera never opens.

import * as THREE from 'three';
import { createArSession, filterFromSearch } from '../core/arSession.js';
import { createSilhouette } from '../core/silhouette.js';
import { createBackdrop } from '../core/backdrop.js';
import { loadMask } from '../core/mask.js';
import {
  screenToNDC, pickAnchorPlane, localToMeshUV, localToMarkerUV, cameraDistance,
} from '../core/anchorPick.js';
import { getJSON, postJSON } from '../core/api.js';
import { bindPointer } from '../core/pointer.js';
import { loadMarkerImage } from '../core/markerSampler.js';
import { createDistanceGate } from '../core/distanceGate.js';
import { setMode, setText } from '../core/hud.js';

const $ = (id) => document.getElementById(id);

const HIT_TOL = 0.03;             // ring probe in mesh uv — lenient on purpose
const REVEAL_MS = 1500;
const REVEAL_PULSES = 3;
const HALO_GROW = 0.35;           // outline expands to 1.35× before fading
const START_TIMEOUT_MS = 15000;

const params = new URLSearchParams(location.search);
const hideId = Number(params.get('hide'));

const state = {
  mode: 'LOADING',
  started: false,
  taps: [],
  startedAt: 0,
};

const ndc = new THREE.Vector2();
const point = new THREE.Vector3();
const meshUv = new THREE.Vector2();
const markerUv = new THREE.Vector2();

const STATUS = {
  READY: 'พร้อมแล้ว — เปิดกล้องได้เลย',
  HUNTING: 'ส่องหาที่ซ่อน แล้วแตะตรงที่คิดว่าใช่',
};

function setStatus(text) {
  setText($('status'), text);
}

function showSpinner(show) {
  $('spinner').classList.toggle('hidden', !show);
}

function setState(mode) {
  state.mode = mode;
  setMode($('hud'), mode);
  if (STATUS[mode]) setStatus(STATUS[mode]);
}

/** Only ids we ship exist as assets; anything else is a corrupt row, not input. */
function silhouetteUrl(id) {
  const safe = /^[a-z0-9_]+$/.test(String(id || '')) ? id : 'human_a';
  return `/assets/silhouettes/${safe}.png`;
}

function startWithTimeout(session) {
  return Promise.race([
    session.start(),
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(
        'เปิดกล้องไม่สำเร็จ (timeout) — ลองเปิดลิงก์ https อีกครั้ง',
      )), START_TIMEOUT_MS);
    }),
  ]);
}

/** Expanding ring at the tap point — a miss should still feel like it landed. */
function ripple(event) {
  const el = document.createElement('div');
  el.className = 'ripple';
  el.style.left = `${event.clientX}px`;
  el.style.top = `${event.clientY}px`;
  el.addEventListener('animationend', () => el.remove());
  $('hud').appendChild(el);
}

async function boot() {
  if (!Number.isInteger(hideId) || hideId < 1) throw new Error('ลิงก์นี้ไม่มีรหัสที่ซ่อน (?hide=)');
  const hide = await getJSON(`/api/hides/${hideId}`);
  const maxTaps = Number(hide.maxTaps);
  if (!Number.isInteger(maxTaps) || maxTaps < 1) throw new Error('กติกาจำนวนครั้งที่ทายไม่ถูกต้อง');
  const maskUrl = silhouetteUrl(hide.silhouetteId);
  $('stats-link').href = `/stats.html?hide=${hideId}`;

  // The marker image is optional the same way it is in hide mode: without it
  // there is no backdrop, the game still runs against the live camera image.
  const [mask, silhouette, image] = await Promise.all([
    loadMask(maskUrl),
    createSilhouette({ maskUrl }),
    hide.marker.imageUrl
      ? loadMarkerImage(hide.marker.imageUrl).catch((error) => {
        console.warn('backdrop unavailable:', error.message);
        return null;
      })
      : null,
  ]);

  // The saved paint IS the camouflage — a failure here would show the hider's
  // flat base colour, which gives the answer away. Let it reject boot().
  await silhouette.loadPaint(hide.paintUrl);
  silhouette.setTransform(hide.transform);

  const session = createArSession({
    container: $('ar'),
    mindUrl: hide.marker.mindUrl,
    filter: filterFromSearch(location.search),
    onFound: () => { if (state.mode === 'HUNTING') setStatus(STATUS.HUNTING); },
    onLost: () => { if (state.mode === 'HUNTING') setStatus('หา marker ไม่เจอ — เล็งกล้องไปที่รูป'); },
  });

  const backdrop = image ? createBackdrop({ image, aspect: hide.marker.aspect }) : null;
  if (backdrop) session.group.add(backdrop.mesh);
  session.group.add(silhouette.mesh);

  // --- reveal ---------------------------------------------------------------
  // A copy of the silhouette shape drawn UNDER it (renderOrder 9 vs 10) and
  // scaled up, so the pulse reads as an outline. alphaTest is low here because
  // the halo fades via opacity, and the render cutoff would clip it off.

  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      alphaMap: silhouette.maskTexture, color: 0xffe9a8,
      transparent: true, alphaTest: 0.05, opacity: 0,
      depthTest: false, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false, fog: false,
    }),
  );
  halo.renderOrder = 9;
  halo.frustumCulled = false;
  halo.visible = false;
  session.group.add(halo);

  let revealStart = 0;

  function tickReveal(now) {
    if (!revealStart) return;
    const t = (now - revealStart) / REVEAL_MS;
    if (t >= 1) {
      halo.visible = false;
      revealStart = 0;
      return;
    }
    const cycle = (t * REVEAL_PULSES) % 1;
    const k = 1 + cycle * HALO_GROW;
    halo.visible = true;
    halo.position.copy(silhouette.mesh.position);
    halo.rotation.z = silhouette.mesh.rotation.z;
    halo.scale.set(silhouette.mesh.scale.x * k, silhouette.mesh.scale.y * k, 1);
    halo.material.opacity = (1 - cycle) * 0.85;
  }

  // --- distance gate --------------------------------------------------------

  const gate = createDistanceGate();

  function applyGate(gated) {
    $('hud').dataset.gated = String(gated);
  }

  session.onFrame((now) => {
    tickReveal(now);
    if (state.mode !== 'HUNTING') return;
    if (!session.visible) {
      // No pose, no distance. Drop the overlay rather than freeze it on screen.
      if (gate.reset()) applyGate(false);
      return;
    }
    if (gate.update(cameraDistance(session.camera, session.group))) applyGate(gate.gated);
  });

  // --- guesses --------------------------------------------------------------

  function renderGuesses() {
    const left = maxTaps - state.taps.length;
    $('dots').replaceChildren(...Array.from({ length: maxTaps }, (_, i) => {
      const dot = document.createElement('span');
      dot.className = i < left ? 'dot' : 'dot spent';
      return dot;
    }));
    setText($('guess-label'), `เหลือ ${left} ครั้ง`);
  }

  async function finish(found) {
    setState('RESULT');
    // The frame loop stops updating the gate outside HUNTING, so drop it here
    // rather than leaving an overlay nobody can clear.
    if (gate.reset()) applyGate(false);
    revealStart = performance.now();      // reveal on a loss too — that is the payoff
    setText($('result-title'), found ? 'เจอแล้ว! 🎉' : 'หมดสิทธิ์แล้ว');
    setText($('result-note'), found
      ? `ใช้ไป ${state.taps.length} ครั้ง`
      : 'ตำแหน่งที่ซ่อนถูกเปิดให้ดูแล้ว — ลองสังเกตรอยแปรงรอบ ๆ');
    setText($('result-stats'), '');

    try {
      const result = await postJSON('/api/seeks', {
        hideId,
        found: found ? 1 : 0,
        tapsUsed: state.taps.length,
        durationMs: Math.round(performance.now() - state.startedAt),
        taps: state.taps,
      });
      const { attempts, found: foundCount, avgTaps } = result.stats;
      setText($('result-stats'),
        `ที่ซ่อนนี้ถูกตามหา ${attempts} ครั้ง เจอ ${foundCount} ครั้ง`
        + (avgTaps === null ? '' : ` เฉลี่ย ${avgTaps} ทาย/ครั้ง`));
    } catch (error) {
      setText($('result-stats'), `บันทึกผลไม่สำเร็จ: ${error.message}`);
    }
  }

  function guess(event) {
    screenToNDC(event, session.renderer.domElement, ndc);
    const p = pickAnchorPlane(ndc, session.camera, session.group, point);
    if (!p) return;

    // Two different spaces on purpose: the hit test needs the tap relative to
    // the silhouette (mesh uv), while the stored heatmap point must be relative
    // to the MARKER — that is what stays comparable across hides and shows
    // whether players searched sensibly (§5.5).
    localToMeshUV(p, silhouette.mesh, meshUv);
    localToMarkerUV(p, hide.marker.aspect, markerUv);
    if (markerUv.x < 0 || markerUv.x > 1 || markerUv.y < 0 || markerUv.y > 1) {
      setStatus('แตะบนรูป marker');
      window.setTimeout(() => {
        if (state.mode === 'HUNTING') setStatus(STATUS.HUNTING);
      }, 1200);
      return;
    }
    const hitBody = mask.isBody(meshUv.x, meshUv.y, HIT_TOL);

    state.taps.push({ u: markerUv.x, v: markerUv.y, hit: hitBody });
    renderGuesses();

    if (hitBody) {
      finish(true);
      return;
    }
    ripple(event);
    if (state.taps.length >= maxTaps) finish(false);
  }

  bindPointer(session.renderer.domElement, {
    end(event, info) {
      if (state.mode !== 'HUNTING' || !info?.tap) return;
      if (!session.visible) return;
      // Belt and braces: the overlay already swallows taps, but a drag that
      // STARTED before the gate engaged still has pointer capture on the canvas.
      if (gate.gated) return;
      guess(event);
    },
  });

  // --- start ----------------------------------------------------------------

  $('again').addEventListener('click', () => location.reload());

  setState('READY');
  $('start').disabled = false;
  $('start').addEventListener('click', async () => {
    if (state.started) return;
    showSpinner(true);
    $('start').disabled = true;
    try {
      await startWithTimeout(session);
      state.started = true;
      state.startedAt = performance.now();
      renderGuesses();
      setState('HUNTING');
    } catch (error) {
      try { await session.dispose(); } catch { /* already stopped */ }
      setStatus(error.message);
      $('start').disabled = false;
    } finally {
      showSpinner(false);
    }
  });
}

boot().catch((error) => setStatus(error.message || 'เปิดหน้าตามหาไม่ได้'));
