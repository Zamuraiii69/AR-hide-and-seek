const express = require('express');
const { stmt, tx } = require('../db');
const storage = require('../storage');
const { MAX_TAPS, SILHOUETTE_IDS } = require('../gameRules');
const { statsFor } = require('../seekStats');

const router = express.Router();

function fail(res, status, error) {
  return res.status(status).json({ error });
}

function validTransform(value) {
  if (!value || typeof value !== 'object') return null;
  const transform = Object.fromEntries(['x', 'y', 'rot', 'w', 'h'].map((key) => [key, Number(value[key])]));
  if (!Object.values(transform).every(Number.isFinite) || transform.w <= 0 || transform.h <= 0 || transform.w > 2 || transform.h > 2) return null;
  return transform;
}

router.post('/', (req, res, next) => {
  const { markerId, hiderName, silhouetteId = 'human_a', transform, paintDataUrl } = req.body || {};
  if (!SILHOUETTE_IDS.includes(silhouetteId)) return fail(res, 400, 'silhouetteId not recognised');
  const id = Number(markerId);
  const marker = stmt.markers.byId.get(id);
  if (!marker) return fail(res, 404, 'marker not found');
  if (marker.status !== 'ready') return fail(res, 400, 'marker is not ready');
  const t = validTransform(transform);
  if (!t) return fail(res, 400, 'transform x, y, rot, w, h must be finite; w and h must be between 0 and 2');

  let paintBuffer;
  try {
    paintBuffer = storage.pngBufferFromDataUrl(paintDataUrl);
  } catch (err) {
    return fail(res, 400, err.message || 'could not save hide');
  }

  let paintPath;
  try {
    const hideId = tx(() => {
      const info = stmt.hides.insert.run(
        id, hiderName ? String(hiderName).slice(0, 120) : null, silhouetteId,
        t.x, t.y, t.rot, t.w, t.h, 'hides/pending.png', 512,
      );
      const newId = Number(info.lastInsertRowid);
      paintPath = storage.hidePaintPath(newId);
      storage.writeAtomic(paintPath, paintBuffer);
      // paint_path is NOT NULL, so update its placeholder before the transaction commits.
      stmt.hides.setPaintPath.run(storage.hidePaintRelPath(newId), newId);
      return newId;
    });
    res.status(201).json({ id: hideId, shareUrl: `/seek.html?hide=${hideId}` });
  } catch (err) {
    if (paintPath) storage.removeQuiet(paintPath);
    return next(err);
  }
});

router.get('/:id', (req, res) => {
  const row = stmt.hides.byId.get(Number(req.params.id));
  if (!row || !row.is_active) return fail(res, 404, 'hide not found');
  const marker = stmt.markers.byId.get(row.marker_id);
  if (!marker) return fail(res, 404, 'marker not found');
  res.json({
    id: row.id, markerId: row.marker_id, silhouetteId: row.silhouette_id,
    transform: { x: row.pos_x, y: row.pos_y, rot: row.rot_z, w: row.size_w, h: row.size_h },
    paintUrl: storage.hidePaintUrl(row.id), paintRes: row.paint_res,
    marker: { aspect: marker.aspect, mindUrl: storage.markerMindUrl(marker.id), imageUrl: storage.markerImageUrl(marker.id) },
    maxTaps: MAX_TAPS,
    stats: statsFor(row.id),
  });
});

// GET /api/hides/:id/seeks -> capped attempt rows for the PoC heatmap.
router.get('/:id/seeks', (req, res) => {
  const id = Number(req.params.id);
  const hide = stmt.hides.byId.get(id);
  if (!hide || !hide.is_active) return fail(res, 404, 'hide not found');

  const seeks = stmt.seeks.byHide.all(id, 200).map((row) => ({
    id: row.id,
    found: Boolean(row.found),
    tapsUsed: row.taps_used,
    durationMs: row.duration_ms,
    taps: (() => {
      try { return JSON.parse(row.taps_json); } catch { return []; }
    })(),
    createdAt: row.created_at,
  }));
  res.json({ hideId: id, stats: statsFor(id), seeks });
});

module.exports = router;
