const MAX_TAPS = 3;

// Mirrors public/js/core/poses.js POSE_IDS — same four ids, same order.
// Kept as a separate, independently-declared array on purpose (Decision D8):
// this file is CommonJS, poses.js is browser ESM, so they can't share one
// import. `human_default` is a legacy readable-but-not-selectable id and
// must NOT appear here — server/routes/hides.js rejects it via this list.
const SILHOUETTE_IDS = ['human_a', 'human_b', 'human_c', 'human_d'];

module.exports = { MAX_TAPS, SILHOUETTE_IDS };
