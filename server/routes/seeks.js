// POST /api/seeks — record one hunt (found or not) and return the hide's stats.
//
// taps_json keeps every {u, v, hit} because Phase 5.5 rebalancing is meant to be
// driven by real attempts, not by guessing: it is the heatmap fodder that shows
// whether players search sensibly or flail.
//
// Error shape follows the Phase 3 review (finding P5): validation failures are
// explicit 400/404 JSON, everything else goes to next(err) and becomes a 500.
// Do NOT wrap the handler in one try/catch that reports 400 — that turns a
// broken DB into "your request was invalid".

const express = require('express');
const { stmt } = require('../db');
const { MAX_TAPS } = require('../gameRules');
const { statsFor } = require('../seekStats');

const router = express.Router();

const MAX_TAPS_JSON = 4096;       // taps are bounded above, this is the backstop
const UV_DECIMALS = 4;            // ~0.1 px at 1024 — plenty for a heatmap

function fail(res, status, error) {
  return res.status(status).json({ error });
}

/** → array of {u, v, hit} (u/v rounded), or null if the shape is wrong. */
function validTaps(value) {
  if (!Array.isArray(value) || value.length > MAX_TAPS) return null;
  const taps = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const u = Number(raw.u);
    const v = Number(raw.v);
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
    taps.push({ u: Number(u.toFixed(UV_DECIMALS)), v: Number(v.toFixed(UV_DECIMALS)), hit: Boolean(raw.hit) });
  }
  return taps;
}

/** Accept 0/1 and true/false; reject anything else rather than coercing it. */
function validFound(value) {
  if (value === 1 || value === true) return 1;
  if (value === 0 || value === false) return 0;
  return null;
}

router.post('/', (req, res, next) => {
  const { hideId, seekerName, found, tapsUsed, durationMs, taps } = req.body || {};

  const id = Number(hideId);
  if (!Number.isInteger(id) || id < 1) return fail(res, 400, 'hideId must be a positive integer');
  const hide = stmt.hides.byId.get(id);
  if (!hide || !hide.is_active) return fail(res, 404, 'hide not found');

  const foundFlag = validFound(found);
  if (foundFlag === null) return fail(res, 400, 'found must be 0 or 1');

  const used = Number(tapsUsed);
  if (!Number.isInteger(used) || used < 1 || used > MAX_TAPS) {
    return fail(res, 400, `tapsUsed must be an integer between 1 and ${MAX_TAPS}`);
  }

  const tapList = validTaps(taps);
  if (!tapList) {
    return fail(res, 400, `taps must be an array of at most ${MAX_TAPS} entries of finite {u, v, hit}`);
  }
  if (used !== tapList.length) return fail(res, 400, 'tapsUsed must match taps.length');
  if (Boolean(foundFlag) !== tapList.some((tap) => tap.hit)) {
    return fail(res, 400, 'found must match whether taps contains a hit');
  }

  // durationMs is optional; absent and null both mean "not measured".
  let duration = null;
  if (durationMs !== undefined && durationMs !== null) {
    duration = Number(durationMs);
    if (!Number.isFinite(duration) || duration < 0) return fail(res, 400, 'durationMs must be a non-negative number');
    duration = Math.round(duration);
  }

  const tapsJson = JSON.stringify(tapList);
  if (tapsJson.length > MAX_TAPS_JSON) return fail(res, 400, 'taps payload is too large');

  try {
    const info = stmt.seeks.insert.run(
      hide.id,
      seekerName ? String(seekerName).slice(0, 120) : null,
      foundFlag, used, duration, tapsJson,
    );
    res.status(201).json({ id: Number(info.lastInsertRowid), stats: statsFor(hide.id) });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
