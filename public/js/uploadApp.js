import { extractPalette, gridPalette } from './core/palette.js';
import { MASK_RES } from './core/maskNormalize.js';
import { normalizeMaskFile } from './core/maskFile.js';

const MAX_DIM = 1024;
const MIN_DIM = 512;

const $ = (id) => document.getElementById(id);
const form = $('marker-form');
const fileInput = $('file');
const nameInput = $('name');
const submit = $('submit');
const reset = $('reset');
const preview = $('preview');
const previewImage = $('preview-image');
const progressArea = $('progress-area');
const progress = $('progress');
const phase = $('phase');
const status = $('status');
const desktopGate = $('desktop-gate');
const continueUpload = $('continue-upload');
const customHiderToggle = $('custom-hider-toggle');
const poseField = $('pose-field');
const poseFileInput = $('pose-file');
const posePreview = $('pose-preview');
const posePreviewImage = $('pose-preview-image');
const poseCoverage = $('pose-coverage');
const poseSize = $('pose-size');
const poseSource = $('pose-source');
const poseStatus = $('pose-status');

let prepared = null;
let previewUrl = null;
let uploading = false;
let markerId = null;
let poseMask = null; // { blob, coverage, bbox, source, ok } once normalizeMaskFile() passes

function setStatus(message = '', kind = '') {
  status.textContent = message;
  status.dataset.kind = kind;
}

function setPoseStatus(message = '', kind = '') {
  poseStatus.textContent = message;
  poseStatus.dataset.kind = kind;
}

function setPhase(message, value = null) {
  progressArea.style.display = 'grid';
  phase.textContent = message;
  if (value !== null) progress.value = value;
}

function setBusy(busy) {
  uploading = busy;
  fileInput.disabled = busy;
  nameInput.disabled = busy;
  customHiderToggle.disabled = busy;
  poseFileInput.disabled = busy;
  reset.disabled = busy || !prepared;
  const customOn = customHiderToggle.checked;
  const validMask = Boolean(poseMask?.ok);
  submit.disabled = busy || !prepared || !nameInput.value.trim() || (customOn && !validMask);
}

function fileStem(file) {
  return file.name.replace(/\.[^.]+$/, '').trim() || 'Marker';
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('Could not encode the marker as PNG.')),
    'image/png',
  ));
}

async function prepareImage(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const original = { width: bitmap.width, height: bitmap.height };
    const scale = Math.min(1, MAX_DIM / Math.max(original.width, original.height));
    const width = Math.max(1, Math.round(original.width * scale));
    const height = Math.max(1, Math.round(original.height * scale));
    if (Math.min(width, height) < MIN_DIM) {
      throw new Error(`Marker images need a prepared short edge of at least ${MIN_DIM}px.`);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    const sourceDataUrl = canvas.toDataURL('image/png');
    const pngBlob = await canvasBlob(canvas);

    return {
      original,
      width,
      height,
      pngBlob,
      sourceDataUrl,
      palette: extractPalette(data, width, height),
      grid: gridPalette(data, width, height),
    };
  } finally {
    bitmap.close();
  }
}

async function request(url, options) {
  const response = await fetch(url, options);
  if (response.ok) return response.status === 204 ? null : response.json();
  const body = await response.json().catch(() => null);
  throw new Error(body?.error || `Request failed (${response.status})`);
}

async function compilerConstructor() {
  const module = await import('mindar-image');
  const Compiler = module.Compiler || window.MINDAR?.IMAGE?.Compiler;
  if (!Compiler) throw new Error('MindAR image compiler could not be loaded.');
  return Compiler;
}

function assertWebglSupport() {
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2') || probe.getContext('webgl');
  if (!gl) {
    throw new Error(
      'This browser cannot compile AR targets — WebGL is unavailable. Enable hardware '
      + 'acceleration in your browser settings and reload, or use a different device.',
    );
  }
}

async function compileTarget(sourceDataUrl) {
  assertWebglSupport();
  const source = new Image();
  source.src = sourceDataUrl;
  await source.decode();
  const Compiler = await compilerConstructor();
  const compiler = new Compiler();
  await new Promise((resolve) => requestAnimationFrame(resolve));

  // mind-ar's tfjs backend can throw from a detached async task (e.g. a missing
  // CPU-backend kernel after WebGL init silently fails) that never reaches
  // compileImageTargets' own promise chain — without this listener that leaves
  // the page hung on "Compiling..." forever instead of surfacing an error.
  let onLeak;
  const leaked = new Promise((_, reject) => {
    onLeak = (event) => reject(event.reason instanceof Error ? event.reason : new Error(String(event.reason)));
    window.addEventListener('unhandledrejection', onLeak);
  });

  let bytes;
  try {
    await Promise.race([
      compiler.compileImageTargets([source], (percent) => {
        const value = Math.round(Number(percent));
        setPhase(`Compiling AR target... ${value}%`, value);
      }),
      leaked,
    ]);
    bytes = await compiler.exportData();
  } finally {
    window.removeEventListener('unhandledrejection', onLeak);
  }
  if (!bytes?.byteLength) throw new Error('MindAR compiler produced an empty target.');
  return new Blob([bytes], { type: 'application/octet-stream' });
}

function resetPrepared() {
  prepared = null;
  markerId = null;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  previewImage.removeAttribute('src');
  preview.style.display = 'none';
  progressArea.style.display = 'none';
  reset.disabled = true;
  submit.disabled = true;
  setStatus();
}

async function onFileChange() {
  const file = fileInput.files?.[0];
  resetPrepared();
  if (!file) return;
  setBusy(true);
  setPhase('Preparing marker image...', 0);
  try {
    prepared = await prepareImage(file);
    previewUrl = URL.createObjectURL(prepared.pngBlob);
    previewImage.src = previewUrl;
    $('original-size').textContent = `${prepared.original.width} x ${prepared.original.height}`;
    $('prepared-size').textContent = `${prepared.width} x ${prepared.height}`;
    $('palette-size').textContent = `${prepared.palette.length} colors + 4 x 4 grid`;
    $('target-size').textContent = 'Not compiled';
    preview.style.display = 'grid';
    if (!nameInput.value.trim()) nameInput.value = fileStem(file);
    setPhase('Image prepared.', 0);
    setStatus('Ready to compile the AR target.');
  } catch (error) {
    setStatus(error.message || 'Could not prepare the selected image.', 'error');
  } finally {
    setBusy(false);
  }
}

async function onPoseFileChange() {
  const file = poseFileInput.files?.[0];
  poseMask = null;
  posePreview.style.display = 'none';
  setPoseStatus();
  if (!file) {
    setBusy(false);
    return;
  }
  setBusy(true);
  try {
    const result = await normalizeMaskFile(file);
    poseCoverage.textContent = `${result.coverage.toFixed(1)}%`;
    poseSize.textContent = `${MASK_RES} x ${MASK_RES}`;
    poseSource.textContent = result.source === 'alpha' ? 'alpha channel' : 'luminance (auto)';
    posePreviewImage.src = result.previewDataUrl;
    posePreview.style.display = 'grid';
    if (result.ok) {
      poseMask = result;
      setPoseStatus();
    } else {
      setPoseStatus(result.error, 'error');
    }
  } catch (error) {
    setPoseStatus(error.message || 'Could not read this image.', 'error');
  } finally {
    setBusy(false);
  }
}

async function uploadMarker(targetBlob) {
  if (!markerId) {
    const marker = await request('/api/markers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: nameInput.value.trim(),
        imageWidth: prepared.width,
        imageHeight: prepared.height,
        palette: prepared.palette,
        grid: prepared.grid,
      }),
    });
    markerId = marker.id;
  }

  // Pose upload goes first — a failed pose PUT aborts the flow before the
  // marker can ever become 'ready', so a marker can never be playable with a
  // half-configured custom hider.
  if (poseMask) {
    setPhase('Uploading hider silhouette...', 100);
    await request(`/api/markers/${markerId}/pose/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: poseMask.blob,
    });
  }

  setPhase('Uploading marker image...', 100);
  await request(`/api/markers/${markerId}/image`, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/png' },
    body: prepared.pngBlob,
  });

  setPhase('Uploading AR target...', 100);
  await request(`/api/markers/${markerId}/target`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: targetBlob,
  });
}

fileInput.addEventListener('change', onFileChange);
nameInput.addEventListener('input', () => setBusy(uploading));
reset.addEventListener('click', () => {
  fileInput.value = '';
  resetPrepared();
});

customHiderToggle.addEventListener('change', () => {
  poseField.hidden = !customHiderToggle.checked;
  if (!customHiderToggle.checked) {
    // Unticking clears the stored blob and metrics, so an abandoned attempt
    // can never be uploaded.
    poseFileInput.value = '';
    poseMask = null;
    posePreview.style.display = 'none';
    setPoseStatus();
  }
  setBusy(uploading);
});
poseFileInput.addEventListener('change', onPoseFileChange);

if (matchMedia('(pointer: coarse)').matches || matchMedia('(max-width: 700px)').matches) {
  desktopGate.hidden = false;
  form.hidden = true;
  continueUpload.addEventListener('click', () => {
    desktopGate.hidden = true;
    form.hidden = false;
  }, { once: true });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!prepared || uploading || !nameInput.value.trim()) return;
  if (customHiderToggle.checked && !poseMask?.ok) return;
  setBusy(true);
  setStatus();
  try {
    setPhase('Compiling can take 10-30 seconds and the page may not respond.', 0);
    const targetBlob = await compileTarget(prepared.sourceDataUrl);
    $('target-size').textContent = `${Math.round(targetBlob.size / 1024)} KB`;
    await uploadMarker(targetBlob);
    setPhase('Marker saved.', 100);
    setStatus('Marker is ready. Opening hide mode...', 'success');
    window.setTimeout(() => { location.href = `/hide.html?marker=${markerId}`; }, 400);
  } catch (error) {
    setStatus(error.message || 'Could not create this marker.', 'error');
    setPhase('Marker creation stopped.', progress.value);
  } finally {
    setBusy(false);
  }
});
