// server/routes/stats.js — read-only balance instrumentation (plan §9.4)
//
// A single unparameterized GET: per-pose aggregates across every hide that
// used each pose. This is a PoC instrument, not an analytics product — no
// filtering/pagination/params (plan-phase7.md:207's same restraint).

const express = require('express');
const { statsByPose } = require('../seekStats');

const router = express.Router();

router.get('/poses', (_req, res) => {
  res.json({ poses: statsByPose() });
});

module.exports = router;
