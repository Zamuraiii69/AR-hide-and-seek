// tools/check-marker-poses.mjs — server/markerPoses.js against fake marker
// rows. No DB, no storage writes — posesFor()/resolveSilhouetteUrl() are pure
// functions of a row shape, so plain objects are enough to pin their
// behaviour down.
//
// Run: node tools/check-marker-poses.mjs

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { MAX_CUSTOM_POSES, posesFor, resolveSilhouetteUrl } = require('../server/markerPoses.js');

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

const plainRow = { id: 42, custom_pose_count: 0 };
const customRow = { id: 42, custom_pose_count: 1 };

// count 0 -> four built-ins in order.
{
  const poses = posesFor(plainRow);
  const ids = poses.map((p) => p.id);
  const expected = ['human_a', 'human_b', 'human_c', 'human_d'];
  check(
    'count 0 -> four built-ins in order',
    ids.length === expected.length && ids.every((id, i) => id === expected[i]),
    `got [${ids.join(',')}]`,
  );
  check(
    'built-in poses carry A-D labels',
    poses.every((p, i) => p.label === ['A', 'B', 'C', 'D'][i]),
    `got [${poses.map((p) => p.label).join(',')}]`,
  );
}

// count 1 -> custom_1 alone, URL /media/markers/:id-pose-1.png.
{
  const poses = posesFor(customRow);
  const expectedUrl = `/media/markers/${customRow.id}-pose-1.png`;
  check(
    'count 1 -> custom_1 alone',
    poses.length === 1 && poses[0].id === 'custom_1',
    `got [${poses.map((p) => p.id).join(',')}]`,
  );
  check(
    'custom_1 URL resolves to markers/:id-pose-1.png',
    poses[0]?.url === expectedUrl,
    `got ${poses[0]?.url}`,
  );
}

// resolveSilhouetteUrl(plainRow, 'human_default') -> a URL (legacy stays readable).
{
  const url = resolveSilhouetteUrl(plainRow, 'human_default');
  check('human_default stays readable on a plain marker', typeof url === 'string' && url.length > 0, `got ${url}`);
}

// resolveSilhouetteUrl(customRow, 'human_a') -> null (custom-only enforced).
{
  const url = resolveSilhouetteUrl(customRow, 'human_a');
  check('a built-in id is rejected once a marker has a custom hider', url === null, `got ${url}`);
}

// resolveSilhouetteUrl(row, '../../etc/passwd') -> null.
{
  const url = resolveSilhouetteUrl(plainRow, '../../etc/passwd');
  check('a hostile id resolves to null, not a guess', url === null, `got ${url}`);
}

check('MAX_CUSTOM_POSES is 1', MAX_CUSTOM_POSES === 1, `got ${MAX_CUSTOM_POSES}`);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
