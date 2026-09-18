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
  screenToNDC, pickAnchorPlane, pickHitItem, localToMarkerUV, cameraDistance,
} from '../core/anchorPick.js';
import { getJSON, postJSON } from '../core/api.js';
import { bindPointer } from '../core/pointer.js';
import { loadMarkerImage } from '../core/markerSampler.js';
import { createDistanceGate } from '../core/distanceGate.js';
import { setMode, setText } from '../core/hud.js';

const $ = (id) => document.getElementById(id);

const HIT_TOL = 0.03;             // ring probe in mesh uv — lenient on purpose
const MAX_ITEMS = 8;              // ponytail: flat cap, paginate if markers ever get crowded
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
  $('stats-link').href = `/stats.html?hide=${hideId}`;

  // Every active hide on this marker plays in the same round — not just the
  // one this link points at. The API already returns them all when `limit`
  // is omitted, so this is the whole trick: no new endpoint, no schema change.
  const siblings = await getJSON(`/api/markers/${hide.markerId}/hides`);
  if (!siblings.length) throw new Error('ที่ซ่อนนี้ถูกลบไปแล้ว');

  // Anyone can keep adding hides to a popular marker, so that list has no
  // upper bound. Each item costs a 512² paint canvas plus two textures, and
  // one shared tap budget makes a round of more than a handful unplayable
  // anyway. Keep the linked hide first — a share link must always include its
  // own item — then the newest of the rest.
  const roster = [
    ...siblings.filter((h) => h.id === hideId),
    ...siblings.filter((h) => h.id !== hideId),
  ].slice(0, MAX_ITEMS);

  // The marker image is optional the same way it is in hide mode: without it
  // there is no backdrop, the game still runs against the live camera image.
  const image = hide.marker.imageUrl
    ? await loadMarkerImage(hide.marker.imageUrl).catch((error) => {
      console.warn('backdrop unavailable:', error.message);
      return null;
    })
    : null;

  const session = createArSession({
    container: $('ar'),
    mindUrl: hide.marker.mindUrl,
    filter: filterFromSearch(location.search),
    onFound: () => { if (state.mode === 'HUNTING') setStatus(STATUS.HUNTING); },
    onLost: () => { if (state.mode === 'HUNTING') setStatus('หา marker ไม่เจอ — เล็งกล้องไปที่รูป'); },
  });

  const backdrop = image ? createBackdrop({ image, aspect: hide.marker.aspect }) : null;
  if (backdrop) session.group.add(backdrop.mesh);

  // --- reveal ---------------------------------------------------------------
  // A copy of the silhouette shape drawn UNDER it (renderOrder one below) and
  // scaled up, so the pulse reads as an outline. alphaTest is low here because
  // the halo fades via opacity, and the render cutoff would clip it off.

  function buildHalo(silhouette, renderOrder) {
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        alphaMap: silhouette.maskTexture, color: 0xffe9a8,
        transparent: true, alphaTest: 0.05, opacity: 0,
        depthTest: false, depthWrite: false,
        side: THREE.DoubleSide, toneMapped: false, fog: false,
      }),
    );
    halo.renderOrder = renderOrder;
    halo.frustumCulled = false;
    halo.visible = false;
    return halo;
  }

  // Every hide on the marker gets its own mask/silhouette/halo, all sharing
  // this one AR session — MindAR tracks one image target regardless of how
  // many items are anchored under it (§arSession.js). renderOrder is
  // diversified per item so overlapping silhouettes don't draw in an
  // undefined order (they'd otherwise all default to the same value).
  const items = await Promise.all(roster.map(async (h, index) => {
    if (!h.silhouetteUrl) throw new Error('ไม่พบรูปทรงของที่ซ่อนบางชิ้น — ข้อมูลอาจเสียหาย');
    const renderOrder = 10 + index * 2;
    const [mask, silhouette] = await Promise.all([
      loadMask(h.silhouetteUrl),
      createSilhouette({ maskUrl: h.silhouetteUrl, renderOrder }),
    ]);
    // The saved paint IS the camouflage — a failure here would show the
    // hider's flat base colour, which gives the answer away. Let it reject boot().
    await silhouette.loadPaint(h.paintUrl);
    silhouette.setTransform(h.transform);
    const halo = buildHalo(silhouette, renderOrder - 1);
    session.group.add(silhouette.mesh);
    session.group.add(halo);
    return {
      id: h.id, silhouette, mask, halo, revealStart: 0, found: false,
    };
  }));

  function tickReveal(item, now) {
    if (!item.revealStart) return;
    const t = (now - item.revealStart) / REVEAL_MS;
    if (t >= 1) {
      item.halo.visible = false;
      item.revealStart = 0;
      return;
    }
    const cycle = (t * REVEAL_PULSES) % 1;
    const k = 1 + cycle * HALO_GROW;
    item.halo.visible = true;
    item.halo.position.copy(item.silhouette.mesh.position);
    item.halo.rotation.z = item.silhouette.mesh.rotation.z;
    item.halo.scale.set(item.silhouette.mesh.scale.x * k, item.silhouette.mesh.scale.y * k, 1);
    item.halo.material.opacity = (1 - cycle) * 0.85;
  }

  // --- distance gate --------------------------------------------------------

  const gate = createDistanceGate();

  function applyGate(gated) {
    $('hud').dataset.gated = String(gated);
  }

  session.onFrame((now) => {
    for (const item of items) tickReveal(item, now);
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
    const foundCount = items.filter((item) => item.found).length;
    setText($('found-label'), items.length > 1 ? `เจอแล้ว ${foundCount}/${items.length}` : '');
  }

  async function finish() {
    setState('RESULT');
    // The frame loop stops updating the gate outside HUNTING, so drop it here
    // rather than leaving an overlay nobody can clear.
    if (gate.reset()) applyGate(false);
    const now = performance.now();
    for (const item of items) if (!item.found) item.revealStart = now; // reveal the rest — that is the payoff

    const foundCount = items.filter((item) => item.found).length;
    const allFound = foundCount === items.length;
    const tally = items.length > 1 ? `เจอ ${foundCount}/${items.length} — ` : '';
    setText($('result-title'), allFound ? 'เจอแล้ว! 🎉' : 'หมดสิทธิ์แล้ว');
    setText($('result-note'), allFound
      ? `${tally}ใช้ไป ${state.taps.length} ครั้ง`
      : `${tally}ตำแหน่งที่ซ่อนถูกเปิดให้ดูแล้ว — ลองสังเกตรอยแปรงรอบ ๆ`);
    setText($('result-stats'), '');

    // One /api/seeks row per hide, all sharing this round's tap list — each
    // recomputes its own `hit` flags so the server's existing per-hide
    // validation (found === some tap hit) passes unmodified for every item.
    const results = await Promise.allSettled(items.map((item) => {
      const taps = state.taps.map((t) => ({ u: t.u, v: t.v, hit: t.hitId === item.id }));
      return postJSON('/api/seeks', {
        hideId: item.id,
        found: item.found ? 1 : 0,
        tapsUsed: taps.length,
        durationMs: Math.round(now - state.startedAt),
        taps,
      });
    }));
    const failed = results.find((r) => r.status === 'rejected');
    setText($('result-stats'), failed
      ? `บันทึกผลบางส่วนไม่สำเร็จ: ${failed.reason.message}`
      : `บันทึกผลครบ ${items.length} ที่ซ่อนแล้ว`);
  }

  function guess(event) {
    screenToNDC(event, session.renderer.domElement, ndc);
    const p = pickAnchorPlane(ndc, session.camera, session.group, point);
    if (!p) return;

    // Two different spaces on purpose: the hit test needs the tap relative to
    // each silhouette (mesh uv), while the stored heatmap point must be
    // relative to the MARKER — that is what stays comparable across hides and
    // shows whether players searched sensibly (§5.5).
    localToMarkerUV(p, hide.marker.aspect, markerUv);
    if (markerUv.x < 0 || markerUv.x > 1 || markerUv.y < 0 || markerUv.y > 1) {
      setStatus('แตะบนรูป marker');
      window.setTimeout(() => {
        if (state.mode === 'HUNTING') setStatus(STATUS.HUNTING);
      }, 1200);
      return;
    }
    const hitItem = pickHitItem(p, items, meshUv, HIT_TOL);

    state.taps.push({ u: markerUv.x, v: markerUv.y, hitId: hitItem ? hitItem.id : null });
    renderGuesses();

    if (hitItem) {
      hitItem.found = true;
      hitItem.revealStart = performance.now();
    } else {
      ripple(event);
    }

    // The budget check must run on a HIT too. A hit that does not complete the
    // set still spends the tap, and letting the round continue past maxTaps
    // pushes state.taps over the server's cap — /api/seeks then rejects every
    // item's submission (seeks.js: taps.length > MAX_TAPS) and the whole
    // round is lost, not just the overflow.
    if (items.every((item) => item.found) || state.taps.length >= maxTaps) finish();
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
