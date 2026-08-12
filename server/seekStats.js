const { stmt } = require('./db');

function statsFor(hideId) {
  const row = stmt.hides.seekStats.get(hideId);
  return {
    attempts: row.attempts,
    found: row.found_count,
    foundRate: row.attempts ? Number((row.found_count / row.attempts).toFixed(3)) : 0,
    avgTaps: row.avg_taps === null ? null : Number(row.avg_taps.toFixed(2)),
  };
}

// Per-pose aggregate across every hide that used it — a read-only balance
// instrument (plan §9.4.1). Not used to drive any per-pose tuning.
function statsByPose() {
  return stmt.stats.byPose.all().map((row) => ({
    poseId: row.poseId,
    attempts: row.attempts,
    hides: row.hides,
    found: row.found,
    foundRate: row.attempts ? Number((row.found / row.attempts).toFixed(3)) : 0,
    avgTaps: row.avgTaps === null ? null : Number(row.avgTaps.toFixed(2)),
    avgDurationMs: row.avgDurationMs === null ? null : Math.round(row.avgDurationMs),
  }));
}

module.exports = { statsFor, statsByPose };
