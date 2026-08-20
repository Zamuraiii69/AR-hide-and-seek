// server/routes/markers.js — marker intake + read API
//
// Two-phase upload for the big binaries (image 0.5–3 MB, .mind up to a few MB):
//   1. POST /api/markers          create pending row (metadata + palette/grid)
//   2. PUT  /api/markers/:id/image   raw image/png
//   3. PUT  /api/markers/:id/target  raw application/octet-stream -> status 'ready'
// Raw PUT avoids base64 bloat + a multi-MB JSON.parse blocking the event loop.

const express = require('express');
const fs = require('fs');
const { stmt } = require('../db');
const storage = require('../storage');
const { validateMaskBuffer } = require('../maskContract');
const { MAX_CUSTOM_POSES, posesFor, resolveSilhouetteUrl } = require('../markerPoses');

const router = express.Router();

// Accept raw bodies up to 8 MB for the binary PUTs.
const rawImage = express.raw({ type: 'image/png', limit: '8mb' });
const rawBinary = express.raw({ type: 'application/octet-stream', limit: '8mb' });
const rawPose = express.raw({ type: 'image/png', limit: '1mb' });
const MIN_MIND_BYTES = 10 * 1024;
const POSE_MIN_EDGE = 256;
const POSE_MAX_EDGE = 1024;
const MAX_POSE_BYTES = 1024 * 1024;

// --- helpers ---------------------------------------------------------------

function slugify(name) {
  const base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'marker';
}

// Ensure slug uniqueness by appending -2, -3, … on collision.
function uniqueSlug(name) {
  const base = slugify(name);
  let slug = base;
  for (let n = 2; stmt.markers.bySlug.get(slug); n++) slug = `${base}-${n}`;
  return slug;
}

function safeParse(json, fallback) {
  try { return JSON.parse(json); } catch { return fallback; }
}

function targetState(row) {
  if (!row.mind_path) return { ready: false, error: null };
  try {
    const size = fs.statSync(storage.markerMindPath(row.id)).size;
    if (size >= MIN_MIND_BYTES) return { ready: true, error: null };
    return { ready: false, error: 'Marker target is invalid. Re-upload the compiled .mind file.' };
  } catch {
    return { ready: false, error: 'Marker target file is missing. Re-upload the compiled .mind file.' };
  }
}

// DB row -> summary object used by the marker list.
function toSummary(row) {
  const target = targetState(row);
  const ready = row.status === 'ready' && target.ready;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: ready ? 'ready' : target.error ? 'target-invalid' : row.status,
    aspect: row.aspect,
    imageUrl: row.image_path ? storage.markerImageUrl(row.id) : null,
    hideCount: row.hide_count ?? 0,
    customHider: row.custom_pose_count > 0,
  };
}

// DB row -> full object used by hide/seek clients.
function toDetail(row) {
  const target = targetState(row);
  const ready = row.status === 'ready' && target.ready;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: ready ? 'ready' : target.error ? 'target-invalid' : row.status,
    targetError: target.error,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    aspect: row.aspect,
    imageUrl: row.image_path ? storage.markerImageUrl(row.id) : null,
    mindUrl: ready ? storage.markerMindUrl(row.id) : null,
    palette: safeParse(row.palette_json, []),
    grid: safeParse(row.grid_json, []),
    poses: posesFor(row),
    createdAt: row.created_at,
  };
}

// --- routes ----------------------------------------------------------------

// GET /api/markers → list (newest first)
router.get('/', (_req, res) => {
  res.json(stmt.markers.listWithHideCount.all().map(toSummary));
});

// POST /api/markers → create pending row
router.post('/', (req, res) => {
  const { name, imageWidth, imageHeight, palette, grid } = req.body || {};
  const w = Number(imageWidth), h = Number(imageHeight);
  if (!name || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return res.status(400).json({ error: 'name, imageWidth, imageHeight required' });
  }
  const slug = uniqueSlug(name);
  const aspect = h / w;
  const info = stmt.markers.insert.run(
    slug, String(name), w, h, aspect,
    JSON.stringify(palette ?? []), JSON.stringify(grid ?? []),
  );
  const row = stmt.markers.byId.get(info.lastInsertRowid);
  res.status(201).json(toDetail(row));
});

// GET /api/markers/:id → full detail
router.get('/:id', (req, res) => {
  const row = stmt.markers.byId.get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'marker not found' });
  res.json(toDetail(row));
});

// PUT /api/markers/:id/image → raw image/png
router.put('/:id/image', rawImage, (req, res) => {
  const id = Number(req.params.id);
  const row = stmt.markers.byId.get(id);
  if (!row) return res.status(404).json({ error: 'marker not found' });
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: 'raw image/png body required' });
  }
  try {
    storage.assertPngBuffer(req.body, { maxBytes: 8 * 1024 * 1024 });
    const { width, height } = storage.pngDimensions(req.body);
    storage.writeAtomic(storage.markerImagePath(id), req.body);
    stmt.markers.setImage.run(storage.markerImageRelPath(id), width, height, height / width, id);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.sendStatus(204);
});

// PUT /api/markers/:id/target → raw .mind, marks marker 'ready'
router.put('/:id/target', rawBinary, (req, res) => {
  const id = Number(req.params.id);
  const row = stmt.markers.byId.get(id);
  if (!row) return res.status(404).json({ error: 'marker not found' });
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: 'raw application/octet-stream body required' });
  }
  if (req.body.length < MIN_MIND_BYTES) {
    return res.status(400).json({ error: `target body must be at least ${MIN_MIND_BYTES} bytes` });
  }
  storage.writeAtomic(storage.markerMindPath(id), req.body);
  stmt.markers.setTarget.run(storage.markerMindRelPath(id), id);
  res.sendStatus(204);
});

// PUT /api/markers/:id/pose/:slot → raw image/png, sets the marker's custom
// hider silhouette. Slot is validated as an integer in 1..MAX_CUSTOM_POSES
// before it ever reaches a filesystem path — the one path-traversal surface
// this feature adds. "Set once": a slot that already has a pose 409s instead
// of overwriting.
router.put('/:id/pose/:slot', rawPose, (req, res) => {
  const id = Number(req.params.id);
  const slot = Number(req.params.slot);
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_CUSTOM_POSES) {
    return res.status(400).json({ error: `slot must be an integer between 1 and ${MAX_CUSTOM_POSES}` });
  }
  const row = stmt.markers.byId.get(id);
  if (!row) return res.status(404).json({ error: 'marker not found' });
  if (row.custom_pose_count >= slot) {
    return res.status(409).json({ error: 'custom hider for this slot is already set' });
  }
  if (stmt.markers.hideCount.get(id).n > 0) {
    return res.status(409).json({ error: 'marker already has hides' });
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: 'raw image/png body required' });
  }

  let width, height;
  try {
    storage.assertPngBuffer(req.body, { maxBytes: MAX_POSE_BYTES });
    ({ width, height } = storage.pngDimensions(req.body));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (width !== height) {
    return res.status(400).json({ error: `pose image must be square — got ${width}x${height}` });
  }
  if (width < POSE_MIN_EDGE || width > POSE_MAX_EDGE) {
    return res.status(400).json({ error: `pose image edge must be between ${POSE_MIN_EDGE} and ${POSE_MAX_EDGE} — got ${width}` });
  }

  const mask = validateMaskBuffer(req.body);
  if (!mask.ok) {
    return res.status(400).json({ error: mask.error });
  }

  // File written, then custom_pose_count set — in that order. posesFor()
  // trusts the count without statting, so a non-zero count must never be
  // visible before the file behind it exists.
  storage.writeAtomic(storage.markerPosePath(id, slot), req.body);
  stmt.markers.setPoseCount.run(slot, id);
  res.sendStatus(204);
});

// GET /api/markers/:id/hides?pick=random&limit=1
router.get('/:id/hides', (req, res) => {
  const id = Number(req.params.id);
  const marker = stmt.markers.byId.get(id);
  if (!marker) return res.status(404).json({ error: 'marker not found' });

  let rows = stmt.hides.byMarker.all(id);
  if (req.query.pick === 'random') {
    // Fisher–Yates using a fixed shuffle — no Math.random dependency concerns here.
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
  }
  const limit = Number(req.query.limit);
  if (Number.isFinite(limit) && limit > 0) rows = rows.slice(0, limit);

  res.json(rows.map((h) => ({
    id: h.id,
    markerId: h.marker_id,
    silhouetteId: h.silhouette_id,
    silhouetteUrl: resolveSilhouetteUrl(marker, h.silhouette_id),
    transform: { x: h.pos_x, y: h.pos_y, rot: h.rot_z, w: h.size_w, h: h.size_h },
    paintRes: h.paint_res,
    paintUrl: storage.hidePaintUrl(h.id),
    createdAt: h.created_at,
  })));
});

module.exports = router;
