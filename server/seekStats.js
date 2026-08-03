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

module.exports = { statsFor };
