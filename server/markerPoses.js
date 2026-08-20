// server/markerPoses.js — the single source of truth for which silhouette ids
// are legal at a marker and what URL each resolves to. Collapses what used to
// be duplicated across poses.js, gameRules.js, hides.js and seekApp.js into
// one server-side module; the server hands clients a resolved pose list so
// neither client keeps id-to-URL logic.
//
// posesFor() and resolveSilhouetteUrl() have deliberately different jobs:
// human_default is readable but not selectable — a legacy id from the Phase 9
// migration (server/db.js, the user_version < 1 block). posesFor() must never
// offer it; resolveSilhouetteUrl() must still serve it so old hunts keep
// rendering.

const { SILHOUETTE_IDS } = require('./gameRules');
const storage = require('./storage');

const MAX_CUSTOM_POSES = 1;

// human_a -> A, human_b -> B, ...
const builtinLabel = (id) => id.split('_').pop().toUpperCase();

function builtinPoses() {
  return SILHOUETTE_IDS.map((id) => ({
    id,
    url: `/assets/silhouettes/${id}.png`,
    label: builtinLabel(id),
  }));
}

function customPoses(markerRow) {
  const poses = [];
  for (let slot = 1; slot <= markerRow.custom_pose_count; slot++) {
    poses.push({
      id: `custom_${slot}`,
      url: storage.markerPoseUrl(markerRow.id, slot),
      label: 'Custom',
    });
  }
  return poses;
}

// posesFor(markerRow) -> [{ id, url, label }] offered to a new hider.
// custom_1..N when the marker has a custom hider (trusts custom_pose_count,
// does not stat the file — the pose route writes the PNG before it
// increments the count, so a non-zero count always has a file behind it),
// otherwise the four built-ins in SILHOUETTE_IDS order.
function posesFor(markerRow) {
  if (markerRow.custom_pose_count > 0) return customPoses(markerRow);
  return builtinPoses();
}

// resolveSilhouetteUrl(markerRow, id) -> a URL, or null if `id` is not legal
// for this marker. Returns null for anything not on the allow-list — covers
// both corrupt rows and hostile ids, no regex sanitising, no fallback guess.
// Also serves the legacy human_default id, which posesFor() never offers.
function resolveSilhouetteUrl(markerRow, id) {
  const pose = posesFor(markerRow).find((p) => p.id === id);
  if (pose) return pose.url;
  if (id === 'human_default') return '/assets/silhouettes/human_default.png';
  return null;
}

module.exports = { MAX_CUSTOM_POSES, posesFor, resolveSilhouetteUrl };
