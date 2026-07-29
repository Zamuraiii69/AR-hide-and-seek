// server/storage.js — media paths + atomic file writes
//
// Layout under DATA_DIR:
//   media/markers/:id.png     source marker image
//   media/markers/:id.mind    compiled MindAR target
//   media/hides/:id.png       painted silhouette texture
//
// Every write is atomic: writeFileSync(tmp) -> renameSync(tmp, final)
// so a client can never fetch a half-written .mind / .png.

const path = require('path');
const fs = require('fs');
const { DATA_DIR } = require('./db');

const MEDIA_DIR = path.join(DATA_DIR, 'media');
const MARKERS_DIR = path.join(MEDIA_DIR, 'markers');
const HIDES_DIR = path.join(MEDIA_DIR, 'hides');

for (const dir of [MARKERS_DIR, HIDES_DIR]) fs.mkdirSync(dir, { recursive: true });

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PNG_BYTES = 4 * 1024 * 1024;

// Absolute paths on disk.
const markerImagePath = (id) => path.join(MARKERS_DIR, `${id}.png`);
const markerMindPath = (id) => path.join(MARKERS_DIR, `${id}.mind`);
const hidePaintPath = (id) => path.join(HIDES_DIR, `${id}.png`);

// Relative paths stored in the DB. Public URLs are still derived from ids.
const markerImageRelPath = (id) => `markers/${id}.png`;
const markerMindRelPath = (id) => `markers/${id}.mind`;
const hidePaintRelPath = (id) => `hides/${id}.png`;

// Public URLs (served static + immutable — see server.js).
function versionedUrl(url, finalPath) {
  try {
    const mtime = fs.statSync(finalPath).mtimeMs.toFixed(0);
    return `${url}?v=${mtime}`;
  } catch {
    return url;
  }
}

const markerImageUrl = (id) => versionedUrl(`/media/markers/${id}.png`, markerImagePath(id));
const markerMindUrl = (id) => versionedUrl(`/media/markers/${id}.mind`, markerMindPath(id));
const hidePaintUrl = (id) => versionedUrl(`/media/hides/${id}.png`, hidePaintPath(id));

// Atomic write. tmp lives in the same dir so rename stays on one filesystem.
function writeAtomic(finalPath, buffer) {
  const tmp = `${finalPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, finalPath);
}

function assertPngBuffer(buffer, { maxBytes = MAX_PNG_BYTES } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('PNG body required');
  }
  if (buffer.length > maxBytes) {
    throw new Error(`PNG exceeds ${maxBytes} byte limit`);
  }
  if (buffer.length < PNG_MAGIC.length || !buffer.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    throw new Error('expected PNG magic bytes');
  }
}

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('expected PNG IHDR');
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width === 0 || height === 0) {
    throw new Error('PNG dimensions must be positive');
  }
  return { width, height };
}

function pngBufferFromDataUrl(dataUrl, { maxBytes = MAX_PNG_BYTES } = {}) {
  if (typeof dataUrl !== 'string') {
    throw new Error('expected a data:image/png;base64 URL');
  }
  const comma = dataUrl.indexOf(',');
  if (comma < 0 || !/^data:image\/png;base64/i.test(dataUrl)) {
    throw new Error('expected a data:image/png;base64 URL');
  }
  const payload = dataUrl.slice(comma + 1);
  if (!/^[a-z0-9+/=\s]+$/i.test(payload)) {
    throw new Error('invalid PNG base64 payload');
  }
  const buffer = Buffer.from(payload, 'base64');
  assertPngBuffer(buffer, { maxBytes });
  return buffer;
}

// Decode a `data:image/png;base64,....` URL into a Buffer and write it.
function savePngDataUrl(finalPath, dataUrl, options) {
  writeAtomic(finalPath, pngBufferFromDataUrl(dataUrl, options));
}

function removeQuiet(p) {
  try { fs.unlinkSync(p); } catch { /* already gone */ }
}

module.exports = {
  MEDIA_DIR, MARKERS_DIR, HIDES_DIR,
  markerImagePath, markerMindPath, hidePaintPath,
  markerImageRelPath, markerMindRelPath, hidePaintRelPath,
  markerImageUrl, markerMindUrl, hidePaintUrl,
  writeAtomic, assertPngBuffer, pngDimensions, pngBufferFromDataUrl, savePngDataUrl, removeQuiet,
};
