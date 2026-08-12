// poses.js — the single source of truth for selectable pose ids.
//
// `human_default` is a legacy id (old hunts still render it — see the phase 9
// migration) but is deliberately excluded here: it is readable, not
// selectable, so it must never appear in this list. `server/gameRules.js`
// keeps an independently-declared mirror of this array (Decision D8 — server
// code is CommonJS, this file is browser ESM, so it's two copies on purpose,
// not one shared import). Keep both lists identical and in the same order —
// `tools/check-mask.js` asserts the parity.

/** Selectable pose ids, in picker order. POSE_IDS[0] is the default pose. */
export const POSE_IDS = ['human_a', 'human_b', 'human_c', 'human_d'];

/** Asset URL for a pose id. Callers must pass one of POSE_IDS — no fallback. */
export function silhouetteUrl(id) {
  return `/assets/silhouettes/${id}.png`;
}
