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
import { screenToNDC, pickAnchorPlane, localToMarkerUV } from '../core/anchorPick.js';
import { toPreviewUV } from '../core/previewUv.js';
import { getJSON, postJSON } from '../core/api.js';
import { bindPointer } from '../core/pointer.js';
import { createPlacement } from '../core/placement.js';
import { createBrush } from '../core/brush.js';
import { loadMarkerSampler } from '../core/markerSampler.js';
import { poseThumbnail } from '../core/poseThumb.js';
import { extractPalette, FALLBACK_PALETTE } from '../core/palette.js';
import { setBusy, setMode, setText } from '../core/hud.js';
import { getDemoContext } from '../demoContext.js';
import { shareAndHandleResult } from './shareResult.js';

const $ = (id) => document.getElementById(id);

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
  pose: null,   // set from marker.poses[0].id once the marker is fetched, in boot()
};

const ndc = new THREE.Vector2();
const point = new THREE.Vector3();
const meshUv = new THREE.Vector2();
const markerUv = new THREE.Vector2();

const STATUS = {
  PLACE: 'Drag, scale, and rotate the silhouette.',
  PAINT: 'Paint on the preview. Use the eyedropper to pick marker colours.',
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
  if (!marker.poses?.length) throw new Error('This marker has no selectable pose.');
  state.pose = marker.poses[0].id;

  const poseUrlFor = (id) => marker.poses.find((p) => p.id === id)?.url;

  // The sampler is optional by design (§4.5): a marker with no image, or a decode
  // failure, degrades to the fallback palette — it must never break the page.
  let mask;
  const [maskResult, silhouette, sampler] = await Promise.all([
    loadMask(poseUrlFor(state.pose)),
    createSilhouette({ maskUrl: poseUrlFor(state.pose) }),
    marker.imageUrl
      ? loadMarkerSampler(marker.imageUrl).catch((error) => {
        console.warn('marker sampler unavailable:', error.message);
        return null;
      })
      : null,
  ]);
  mask = maskResult;

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

  // Fire-and-forget: thumbnail decoding must never delay first paint. The row
  // populates itself whenever its sequential decode loop finishes.
  buildPoseRow().catch((error) => console.error('pose row build failed:', error));

  // The backdrop must be here as well as in seek mode, not just there: if the
  // hider matches the live camera image while the seeker sees the source file,
  // the camouflage is tuned against the wrong target and the work is wasted.
  // It also makes the eyedropper exact — it samples the pixels now on screen.
  const backdrop = sampler?.image
    ? createBackdrop({ image: sampler.image, aspect: marker.aspect })
    : null;
  if (backdrop) session.group.add(backdrop.mesh);
  session.group.add(silhouette.mesh);

  let placement = createPlacement(silhouette.mesh, marker.aspect, mask.bbox);
  const brush = createBrush(silhouette.pctx, silhouette.paintRes, () => {
    state.dirty = true;
    requestPreviewRedraw();
  });

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

  // --- pose -------------------------------------------------------------------
  // Pose switching is PLACE-only by construction: the pose row is only visible
  // in PLACE mode (CSS .place-only), and the mode machine never returns to
  // PLACE from PAINT/REVIEW, so no extra guard is needed here (D1).

  let switching = false;

  async function switchPose(id) {
    if (switching || id === state.pose) return;
    switching = true;
    $('pose-row').querySelectorAll('.pose').forEach((b) => { b.disabled = true; });
    try {
      const url = poseUrlFor(id);
      // Decode the hit-test mask FIRST, swap the visible texture second: if the
      // decode fails we have changed nothing, instead of leaving the mesh
      // showing a pose that `mask`, `placement` and `state.pose` know nothing about.
      const nextMask = await loadMask(url);       // 1. hit-test mask for the new pose
      await silhouette.setMask(url);              // 2. new texture on the existing mesh
      mask = nextMask;
      placement = createPlacement(silhouette.mesh, marker.aspect, mask.bbox); // 3. rebuild, fresh bbox
      state.pose = id;
      applyTransform();                             // 4. re-clamp (scale/rotation kept, position re-clamped)
      silhouette.fillBase();                        // 5. paint canvas back to 100% opaque base for the new pose
      requestPreviewRedraw();
      $('pose-row').querySelectorAll('.pose').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.poseId === id));
      });
    } finally {
      switching = false;
      $('pose-row').querySelectorAll('.pose').forEach((b) => { b.disabled = false; });
    }
  }

  async function buildPoseRow() {
    const row = $('pose-row');
    // Always render the row, even for a single pose (custom hider markers):
    // it keeps the placement UI identical to the multi-pose layout instead of
    // reshuffling the panel when there's nothing to switch to.
    row.classList.remove('hidden');
    $('pose-row-label').classList.remove('hidden');

    const buttons = [];
    for (const pose of marker.poses) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pose';
      button.dataset.poseId = pose.id;
      button.setAttribute('aria-pressed', String(pose.id === state.pose));
      button.setAttribute('aria-label', `Pose ${pose.label}`);
      button.addEventListener('click', () => {
        switchPose(pose.id).catch((error) => {
          console.error('pose switch failed:', error);
          setStatus('Could not switch pose — try again.');
        });
      });
      buttons.push(button);
    }
    row.replaceChildren(...buttons);

    // Decode thumbnails SEQUENTIALLY (not Promise.all) to keep peak memory flat
    // on a low-end phone; fall back to the pose's label if a thumbnail fails to
    // decode — a pose the hider cannot preview is still better than one they
    // cannot select.
    for (const button of buttons) {
      try {
        const dataUrl = await poseThumbnail(poseUrlFor(button.dataset.poseId), 64);
        const glyph = document.createElement('span');
        glyph.className = 'pose-glyph';
        glyph.style.setProperty('--thumb', `url(${dataUrl})`);
        button.replaceChildren(glyph);
      } catch (error) {
        console.warn(`pose thumbnail failed for ${button.dataset.poseId}:`, error.message);
        button.textContent = marker.poses.find((p) => p.id === button.dataset.poseId)?.label ?? '?';
      }
    }
  }

  // --- palette --------------------------------------------------------------

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

  const dominant = sampler ? extractPalette(sampler.data, sampler.W, sampler.H, 10) : [];
  // An image that yields no colours (fully transparent) is as unusable to the
  // eyedropper as no image at all — same fallback, one flag for both paths.
  const canEyedrop = dominant.length > 0;

  $('palette').replaceChildren(...(canEyedrop ? dominant : FALLBACK_PALETTE).map(makeSwatch));
  if (!canEyedrop) {
    $('tool').classList.add('hidden');
    $('tool-label').classList.add('hidden');
    setText($('palette-note'), marker.imageUrl
      ? "Couldn't read colours from the marker image — using the fallback palette."
      : 'This marker has no source image — using the fallback palette.');
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
    setStatus(state.tool === 'EYEDROPPER' ? 'Tap the marker image to pick a colour.' : STATUS.PAINT);
  });

  function eyedrop(event) {
    const p = hit(event);
    if (!p) return;
    localToMarkerUV(p, marker.aspect, markerUv);
    const color = sampler.sample(markerUv.x, markerUv.y);
    if (!color) {
      setStatus('Tap inside the marker image — colour unchanged.');
      return;
    }
    selectColor(color.hex, null);
    // Straight back to the brush: the hider wants to pick, then paint at once.
    setTool('BRUSH');
    setStatus(`Picked ${color.hex} — keep painting.`);
  }

  // --- preview ----------------------------------------------------------------
  // The preview canvas is mesh-UV space (512², square, upright): a masked blit of
  // the paint canvas — white fill, then the paint, then clipped to the pose's
  // shape via destination-in with a per-pose alpha mask. Composited offscreen
  // first so the visible canvas never shows a white-only mid-composite frame.

  const previewCanvas = $('paint-preview');
  let maskAlphaImg = null;
  let maskAlphaPose = null;
  let maskAlphaPending = null;   // { pose, promise } — dedupes concurrent decodes
  let offscreenBody = null;
  let redrawScheduled = false;

  function decodeMaskAlpha(pose) {
    return poseThumbnail(poseUrlFor(pose), silhouette.paintRes).then((dataUrl) => {
      const img = new Image();
      return new Promise((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('preview mask-alpha decode failed'));
        img.src = dataUrl;
      });
    });
  }

  /**
   * Ensure `maskAlphaImg` holds the CURRENT pose's alpha mask. Returns false if
   * the decode it awaited belongs to a pose that has since been switched away
   * from — the pose id is captured before the await and re-checked after, or a
   * fast double-tap in PLACE caches the losing pose's mask under the winner's
   * id and the preview clips every stroke to the wrong body forever.
   */
  async function ensureMaskAlpha() {
    const pose = state.pose;
    if (maskAlphaPose === pose && maskAlphaImg) return true;
    if (maskAlphaPending?.pose !== pose) {
      // Drop a rejected decode from the cache so the next redraw retries it
      // instead of re-awaiting the same failure for the rest of the session.
      const pending = { pose, promise: decodeMaskAlpha(pose) };
      pending.promise.catch(() => { if (maskAlphaPending === pending) maskAlphaPending = null; });
      maskAlphaPending = pending;
    }
    const img = await maskAlphaPending.promise;   // read before any await: never null here
    if (state.pose !== pose) return false;   // stale — the winning switch owns the cache
    maskAlphaImg = img;
    maskAlphaPose = pose;
    return true;
  }

  function drawPreview() {
    if (!maskAlphaImg || maskAlphaPose !== state.pose) return;   // not ready yet — a later redraw will catch up
    const size = silhouette.paintRes;
    if (!offscreenBody) {
      offscreenBody = document.createElement('canvas');
      offscreenBody.width = offscreenBody.height = size;
    }
    const bctx = offscreenBody.getContext('2d');
    bctx.clearRect(0, 0, size, size);
    bctx.globalCompositeOperation = 'source-over';
    bctx.drawImage(silhouette.paintCanvas, 0, 0, size, size);
    bctx.globalCompositeOperation = 'destination-in';
    bctx.drawImage(maskAlphaImg, 0, 0, size, size);

    const pctx2 = previewCanvas.getContext('2d');
    pctx2.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    pctx2.fillStyle = '#ffffff';
    pctx2.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    pctx2.drawImage(offscreenBody, 0, 0, previewCanvas.width, previewCanvas.height);
  }

  function requestPreviewRedraw() {
    if (redrawScheduled) return;
    redrawScheduled = true;
    requestAnimationFrame(async () => {
      redrawScheduled = false;
      let fresh;
      try { fresh = await ensureMaskAlpha(); } catch (error) { console.error(error); return; }
      if (!fresh) return;   // a newer pose won; its own redraw will paint
      drawPreview();
    });
  }

  function sizePreviewCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(previewCanvas.clientWidth * dpr);
    if (previewCanvas.width !== w || previewCanvas.height !== w) {
      previewCanvas.width = previewCanvas.height = w;
    }
    requestPreviewRedraw();
  }

  window.addEventListener('resize', sizePreviewCanvas);

  // The rect is read once per stroke, not once per sample: bindPointer replays
  // every coalesced pointer sample through move(), and getBoundingClientRect()
  // forces a synchronous layout each call. The panel cannot move mid-stroke —
  // the page is position:fixed with no scrolling — so one read per stroke is exact.
  let previewRect = null;

  bindPointer(previewCanvas, {
    start(e) {
      if (state.mode !== 'PAINT' || state.tool !== 'BRUSH') return;
      previewRect = previewCanvas.getBoundingClientRect();
      toPreviewUV(e.clientX, e.clientY, previewRect, meshUv);
      if (mask.isBody(meshUv.x, meshUv.y)) brush.start(meshUv);
    },
    move(e) {
      if (!previewRect || state.mode !== 'PAINT' || state.tool !== 'BRUSH') return;
      toPreviewUV(e.clientX, e.clientY, previewRect, meshUv);
      if (meshUv.x >= 0 && meshUv.x <= 1 && meshUv.y >= 0 && meshUv.y <= 1) brush.move(meshUv);
    },
    end() { previewRect = null; brush.end(); },
  });

  // --- pointer --------------------------------------------------------------

  function hit(event) {
    screenToNDC(event, session.renderer.domElement, ndc);
    return pickAnchorPlane(ndc, session.camera, session.group, point);
  }

  // Since painting moved to the preview, PLACE is the only mode that needs a ray
  // — the eyedropper casts its own in eyedrop(). So the mode check comes BEFORE
  // hit(), or every coalesced pointermove in PAINT/REVIEW pays for a raycast
  // whose result is thrown away.
  bindPointer(session.renderer.domElement, {
    start(event) {
      if (state.mode !== 'PLACE' || !session.visible) return;
      const p = hit(event);
      if (p) placement.start(p);
    },

    move(event) {
      if (state.mode !== 'PLACE' || !session.visible) return;
      const p = hit(event);
      if (!p) return;
      // null = "not dragging", which is not the same as "does not fit".
      const fits = placement.move(p);
      if (fits !== null) {
        state.fits = fits;
        updateFit();
      }
    },

    end(event, info) {
      placement.end();
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
    if (state.fits) { setState('PAINT'); sizePreviewCanvas(); }
  });
  $('review').addEventListener('click', () => setState('REVIEW'));
  $('edit').addEventListener('click', () => { setState('PAINT'); sizePreviewCanvas(); });
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
        silhouetteId: state.pose,
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
              payload: { title: 'AR Hide and Seek', text: 'มาหาที่ซ่อนนี้', url: shareUrl },
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
