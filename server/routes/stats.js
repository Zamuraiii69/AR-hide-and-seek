// server/routes/stats.js — read-only balance instrumentation (plan §9.4)
//
// Per-pose aggregates across the hides that used each pose, optionally scoped
// to one marker (?marker=N). This is a PoC instrument, not an analytics
// product — no pagination, no other filters.

const express = require('express');
const { statsByPose } = require('../seekStats');

const router = express.Router();

router.get('/poses', (req, res) => {
  const marker = Number(req.query.marker);
  res.json({ poses: statsByPose(Number.isInteger(marker) && marker > 0 ? marker : null) });
});

module.exports = router;
