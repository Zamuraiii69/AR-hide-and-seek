// hideApp.js — the hider's screen: PLACE → PAINT → REVIEW → save.
//
// PAINT carries a TOOL (BRUSH | EYEDROPPER) instead of adding states to the mode
// machine: modes gate which HUD panel shows (CSS [data-mode]), while the tool
// only changes what a finger does inside PAINT.
//
// Two rules the eyedropper depends on:
//   - it fires on TAP at pointerup, never at pointerdown. A small camera nudge
//     with the finger down would otherwise pick a colour from wherever the ray
//     drifted to.
//   - it maps the finger to the MARKER plane (localToMarkerUV), not to the mesh,
//     so colour can be picked anywhere on the marker — including from under the
//     silhouette, which is exactly where the hider needs it. That also means it
//     reads the source image, never the paint already applied.

import * as THREE from 'three';
import { createArSession, filterFromSearch } from '../core/arSession.js';
import { createSilhouette } from '../core/silhouette.js';
import { createBackdrop } from '../core/backdrop.js';
import { loadMask } from '../core/mask.js';
import { screenToNDC, pickAnchorPlane, localToMeshUV, localToMarkerUV } from '../core/anchorPick.js';
import { getJSON, postJSON } from '../core/api.js';
import { bindPointer } from '../core/pointer.js';
import { createPlacement } from '../core/placement.js';
import { createBrush } from '../core/brush.js';
import { loadMarkerSampler } from '../core/markerSampler.js';
import { extractPalette, gridPalette, FALLBACK_PALETTE } from '../core/palette.js';
import { setBusy, setMode, setText } from '../core/hud.js';
import { getDemoContext } from '../demoContext.js';
import { shareAndHandleResult } from './shareResult.js';

const $ = (id) => document.getElementById(id);

const SILHOUETTE_URL = '/assets/silhouettes/human_a.png';
const ZONE_GRID = 4;              // 4×4 zones — the row that actually helps
const PICKED_MAX = 6;             // most-recent-first, enough to work from
const ASPECT_TOLERANCE = 0.01;    // db vs image aspect: wider than this is a bug
const START_TIMEOUT_MS = 15000;

const params = new URLSearchParams(location.search);
const markerId = Number(params.get('marker'));

const state = {
  mode: 'PLACE',
  tool: 'BRUSH',
  started: false,
  dirty: false,
  fits: true,
  hidden: false,
};

const ndc = new THREE.Vector2();
const point = new THREE.Vector3();
const meshUv = new THREE.Vector2();
const markerUv = new THREE.Vector2();

const STATUS = {
  PLACE: 'Drag, scale, and rotate the silhouette.',
  PAINT: 'Paint directly on the silhouette.',
  REVIEW: 'Compare it with the real marker, then save.',
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
  setStatus(STATUS[mode] ?? '');
}

function startWithTimeout(session) {
  return Promise.race([
    session.start(),
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(
        'AR start timed out. Re-upload a valid compiled .mind target and try again.',
      )), START_TIMEOUT_MS);
    }),
  ]);
}

async function boot() {
  if (!Number.isInteger(markerId) || markerId < 1) throw new Error('A marker id is required.');
  const marker = await getJSON(`/api/markers/${markerId}`);
  if (marker.status !== 'ready' || !marker.mindUrl) {
    throw new Error(marker.targetError || 'This marker is not ready.');
  }

  // The sampler is optional by design (§4.5): a marker with no image, or a decode
  // failure, degrades to the fallback palette — it must never break the page.
  const [mask, silhouette, sampler] = await Promise.all([
    loadMask(SILHOUETTE_URL),
    createSilhouette({ maskUrl: SILHOUETTE_URL }),
    marker.imageUrl
      ? loadMarkerSampler(marker.imageUrl).catch((error) => {
        console.warn('marker sampler unavailable:', error.message);
        return null;
      })
      : null,
  ]);

  // marker.aspect defines anchor space, so it is what the eyedropper maps with.
  // The sampler derives the same number from the pixels it just decoded; if the
  // two disagree, picks are offset along y and the eyedropper looks broken while
  // the real fault is upstream metadata. Say so instead of letting it look random.
  if (sampler && Math.abs(sampler.aspect - marker.aspect) > ASPECT_TOLERANCE) {
    console.warn(
      `marker aspect mismatch: api=${marker.aspect} image=${sampler.aspect}`
      + ' — eyedropper picks will be offset along y',
    );
  }

  const session = createArSession({
    container: $('ar'),
    mindUrl: marker.mindUrl,
    filter: filterFromSearch(location.search),
    onFound: () => setStatus('Marker found.'),
    onLost: () => setStatus('Point the camera at the marker.'),
  });

  // The backdrop must be here as well as in seek mode, not just there: if the
  // hider matches the live camera image while the seeker sees the source file,
  // the camouflage is tuned against the wrong target and the work is wasted.
  // It also makes the eyedropper exact — it samples the pixels now on screen.
  const backdrop = sampler?.image
    ? createBackdrop({ image: sampler.image, aspect: marker.aspect })
    : null;
  if (backdrop) session.group.add(backdrop.mesh);
  session.group.add(silhouette.mesh);

  const placement = createPlacement(silhouette.mesh, marker.aspect, mask.bbox);
  const brush = createBrush(silhouette.pctx, silhouette.paintRes, () => { state.dirty = true; });

  // --- transform ------------------------------------------------------------

  function updateFit() {
    state.fits = placement.clamp();
    $('fit').textContent = state.fits ? '' : 'Too large to hide';
    $('lock').disabled = !state.fits;
  }

  function applyTransform() {
    silhouette.mesh.scale.setScalar(Number($('scale').value));
    silhouette.mesh.rotation.z = Number($('rotate').value) * Math.PI / 180;
    updateFit();
  }

  $('scale').addEventListener('input', applyTransform);
  $('rotate').addEventListener('input', applyTransform);

  // --- palette --------------------------------------------------------------

  const picked = [];

  function selectColor(color, button) {
    brush.setColor(color);
    $('current-color').style.background = color;
    document.querySelectorAll('.swatch').forEach((el) => el.setAttribute('aria-pressed', 'false'));
    button?.setAttribute('aria-pressed', 'true');
  }

  function makeSwatch(color) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'swatch';
    button.style.background = color;
    button.setAttribute('aria-label', color);
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => selectColor(color, button));
    return button;
  }

  function addPicked(color) {
    const seen = picked.indexOf(color);
    if (seen >= 0) picked.splice(seen, 1);
    picked.unshift(color);
    if (picked.length > PICKED_MAX) picked.length = PICKED_MAX;
    const row = $('palette-picked');
    row.replaceChildren(...picked.map(makeSwatch));
    selectColor(color, row.firstElementChild);
  }

  const dominant = sampler ? extractPalette(sampler.data, sampler.W, sampler.H) : [];
  // An image that yields no colours (fully transparent) is as unusable to the
  // eyedropper as no image at all — same fallback, one flag for both paths.
  const canEyedrop = dominant.length > 0;

  $('palette').replaceChildren(...(canEyedrop ? dominant : FALLBACK_PALETTE).map(makeSwatch));
  if (canEyedrop) {
    const zones = gridPalette(sampler.data, sampler.W, sampler.H, ZONE_GRID).filter(Boolean);
    $('palette-zone').replaceChildren(...zones.map(makeSwatch));
  } else {
    for (const id of ['tool', 'zone-label', 'palette-zone']) $(id).classList.add('hidden');
    setText($('palette-note'), marker.imageUrl
      ? 'อ่านสีจากรูป marker ไม่ได้ — ใช้จานสีสำรอง'
      : 'marker นี้ไม่มีรูปต้นฉบับ — ใช้จานสีสำรอง');
  }
  selectColor(
    canEyedrop ? dominant[0] : FALLBACK_PALETTE[0],
    $('palette').firstElementChild,
  );

  $('brush-size').addEventListener('input', (event) => brush.setRadius(event.target.value));
  $('brush-edge').addEventListener('change', (event) => brush.setSoft(event.target.value === 'soft'));

  // --- tool -----------------------------------------------------------------

  function setTool(tool) {
    state.tool = canEyedrop ? tool : 'BRUSH';
    $('tool').setAttribute('aria-pressed', String(state.tool === 'EYEDROPPER'));
  }

  $('tool').addEventListener('click', () => {
    setTool(state.tool === 'EYEDROPPER' ? 'BRUSH' : 'EYEDROPPER');
    setStatus(state.tool === 'EYEDROPPER' ? 'แตะบนรูป marker เพื่อดูดสี' : STATUS.PAINT);
  });

  function eyedrop(event) {
    const p = hit(event);
    if (!p) return;
    localToMarkerUV(p, marker.aspect, markerUv);
    const color = sampler.sample(markerUv.x, markerUv.y);
    if (!color) {
      setStatus('แตะนอกขอบรูป marker — สียังไม่เปลี่ยน');
      return;
    }
    addPicked(color.hex);
    // Straight back to the brush: the hider wants to pick, then paint at once.
    setTool('BRUSH');
    setStatus(`ดูดสี ${color.hex} แล้ว — ระบายต่อได้เลย`);
  }

  // --- pointer --------------------------------------------------------------

  function hit(event) {
    screenToNDC(event, session.renderer.domElement, ndc);
    return pickAnchorPlane(ndc, session.camera, session.group, point);
  }

  bindPointer(session.renderer.domElement, {
    start(event) {
      if (!session.visible) return;
      const p = hit(event);
      if (!p) return;
      if (state.mode === 'PLACE') {
        placement.start(p);
        return;
      }
      if (state.mode !== 'PAINT' || state.tool !== 'BRUSH') return;
      localToMeshUV(p, silhouette.mesh, meshUv);
      if (mask.isBody(meshUv.x, meshUv.y)) brush.start(meshUv);
    },

    move(event) {
      if (!session.visible) return;
      const p = hit(event);
      if (!p) return;
      if (state.mode === 'PLACE') {
        // null = "not dragging", which is not the same as "does not fit".
        const fits = placement.move(p);
        if (fits !== null) {
          state.fits = fits;
          updateFit();
        }
        return;
      }
      if (state.mode !== 'PAINT' || state.tool !== 'BRUSH') return;
      localToMeshUV(p, silhouette.mesh, meshUv);
      if (meshUv.x >= 0 && meshUv.x <= 1 && meshUv.y >= 0 && meshUv.y <= 1) brush.move(meshUv);
    },

    end(event, info) {
      placement.end();
      brush.end();
      if (!session.visible) return;
      if (state.mode === 'PAINT' && state.tool === 'EYEDROPPER' && info?.tap) eyedrop(event);
    },
  });

  session.onFrame(() => {
    if (!state.dirty) return;
    silhouette.paintTexture.needsUpdate = true;
    state.dirty = false;
  });

  // --- mode buttons ---------------------------------------------------------

  $('lock').addEventListener('click', () => {
    if (state.fits) setState('PAINT');
  });
  $('review').addEventListener('click', () => setState('REVIEW'));
  $('edit').addEventListener('click', () => setState('PAINT'));
  // Peek hides the silhouette but NOT the backdrop: the seeker sees the backdrop
  // too, so "what is left when the model goes away" is the right comparison.
  $('peek').addEventListener('click', () => {
    state.hidden = !state.hidden;
    silhouette.mesh.visible = !state.hidden;
    $('peek').textContent = state.hidden ? 'Show silhouette' : 'Hide silhouette';
  });

  $('save').addEventListener('click', async () => {
    setBusy($('save'), true);
    setText($('share'), '');
    try {
      const result = await postJSON('/api/hides', {
        markerId,
        silhouetteId: 'human_a',
        transform: {
          x: silhouette.mesh.position.x,
          y: silhouette.mesh.position.y,
          rot: silhouette.mesh.rotation.z,
          w: silhouette.mesh.scale.x,
          h: silhouette.mesh.scale.y,
        },
        paintDataUrl: silhouette.getPaintDataUrl(),
      });
      const shareUrl = new URL(result.shareUrl, location.href).href;
      const heading = document.createElement('p');
      heading.textContent = 'บันทึกแล้ว — ส่งลิงก์นี้ให้คนหา';

      const linkText = document.createElement('input');
      linkText.value = shareUrl;
      linkText.readOnly = true;
      linkText.setAttribute('aria-label', 'ลิงก์ค้นหาที่ซ่อน');

      const actions = document.createElement('div');
      actions.className = 'controls';
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'secondary';
      copy.textContent = 'Copy link';
      const open = document.createElement('a');
      open.className = 'button';
      open.href = shareUrl;
      open.textContent = 'Open hunt';
      const stats = document.createElement('a');
      stats.className = 'button secondary';
      stats.href = `/stats.html?hide=${result.id}`;
      stats.textContent = 'View stats';
      actions.append(copy);
      if (navigator.share) {
        const share = document.createElement('button');
        share.type = 'button';
        share.textContent = 'Share';
        share.addEventListener('click', async () => {
          if (share.disabled) return;
          share.disabled = true;
          try {
            await shareAndHandleResult({
              share: navigator.share.bind(navigator),
              payload: { title: 'Meccha Chameleon', text: 'มาหาที่ซ่อนนี้', url: shareUrl },
              context: getDemoContext(),
              goToReward: (path) => window.location.assign(path),
            });
          } catch (error) {
            if (error.name !== 'AbortError') setText(shareStatus, error.message);
          } finally {
            share.disabled = false;
          }
        });
        actions.append(share);
      }
      actions.append(open, stats);

      const shareStatus = document.createElement('span');
      shareStatus.className = 'share-status';
      shareStatus.setAttribute('role', 'status');
      copy.addEventListener('click', async () => {
        try {
          if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
          await navigator.clipboard.writeText(shareUrl);
          setText(shareStatus, 'คัดลอกลิงก์แล้ว');
        } catch {
          linkText.focus();
          linkText.select();
          setText(shareStatus, 'เลือกลิงก์แล้ว — คัดลอกจากช่องด้านบน');
        }
      });
      $('share').replaceChildren(heading, linkText, actions, shareStatus);
    } catch (error) {
      setText($('share'), error.message);
    } finally {
      setBusy($('save'), false);
    }
  });

  // --- camera start ---------------------------------------------------------
  // boot() already fetched and decoded everything, so the click handler only
  // calls session.start() — the iOS gesture chain stays intact.

  $('start').disabled = false;
  setStatus('Ready. Start camera when prompted.');
  $('start').addEventListener('click', async () => {
    if (state.started) return;
    showSpinner(true);
    $('start').disabled = true;
    try {
      await startWithTimeout(session);
      state.started = true;
      setStatus('Point the camera at the marker.');
    } catch (error) {
      try { await session.dispose(); } catch { /* already stopped */ }
      setStatus(error.message);
      $('start').disabled = false;
    } finally {
      showSpinner(false);
    }
  });

  applyTransform();
}

boot().catch((error) => setStatus(error.message || 'Could not prepare this marker.'));
