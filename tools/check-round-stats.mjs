// tools/check-round-stats.mjs — round accounting + clearing hides.
//
// Both bugs this covers were invisible in code review and obvious on a phone:
// a marker showed "4 hides" after two were hidden (nothing ever retired the old
// ones), and one play-through was reported as four attempts (one seek row per
// hide, with no way to tell siblings apart).
//
// Runs against a throwaway DATA_DIR so it never touches real data.
//
// Run: node tools/check-round-stats.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

const require = createRequire(import.meta.url);
const { tapsForItem } = await import('../public/js/core/seekRound.js');

// db.js reads DATA_DIR at require time, so set it before the require below.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-round-'));
process.env.DATA_DIR = dataDir;
const { db, stmt } = require('../server/db.js');
const { statsFor, statsByPose } = require('../server/seekStats.js');

// --- tapsForItem -----------------------------------------------------------

const taps = [
  { u: 0.1, v: 0.1, hitId: null },
  { u: 0.2, v: 0.2, hitId: 7 },     // hide 7 found on tap 2
  { u: 0.3, v: 0.3, hitId: null },
  { u: 0.4, v: 0.4, hitId: 9 },     // hide 9 found on tap 4
];

const forSeven = tapsForItem(taps, 7);
check('tapsForItem: a found hide stops at the tap that found it',
  forSeven.length === 2 && forSeven[1].hit === true,
  `${forSeven.length} taps, last hit=${forSeven[1]?.hit}`);
check('tapsForItem: taps spent on OTHER hides are not charged to this one',
  forSeven.every((t, i) => t.hit === (i === 1)),
  JSON.stringify(forSeven.map((t) => t.hit)));
check('tapsForItem: a hide that was never found keeps the whole round',
  tapsForItem(taps, 99).length === 4 && tapsForItem(taps, 99).every((t) => !t.hit));
check('tapsForItem: a hit on the first tap yields exactly one tap',
  tapsForItem([{ u: 0, v: 0, hitId: 3 }], 3).length === 1);

// --- fixture: one marker, four hides, ONE round ----------------------------

const markerId = Number(stmt.markers.insert.run('m', 'm', 100, 200, 2, '[]', '[]').lastInsertRowid);
const hideIds = ['human_b', 'human_b', 'human_c', 'human_c'].map((pose, i) => Number(
  stmt.hides.insert.run(markerId, null, pose, 0, 0, 0, 0.2, 0.2, `hides/${i}.png`, 512).lastInsertRowid,
));

const roundId = 'round-1';
hideIds.forEach((id, i) => {
  const found = i === 0 ? 1 : 0;              // one of four found, in three taps
  const list = found
    ? [{ u: 0.1, v: 0.1, hit: false }, { u: 0.2, v: 0.2, hit: true }]
    : [{ u: 0.1, v: 0.1, hit: false }, { u: 0.2, v: 0.2, hit: false }, { u: 0.3, v: 0.3, hit: false }];
  stmt.seeks.insert.run(id, null, found, list.length, 1000, JSON.stringify(list), roundId);
});

const byPose = statsByPose(markerId);
const rounds = byPose.reduce((max, p) => Math.max(max, p.rounds), 0);
check('one play-through counts as one round, not one per hide',
  rounds === 1, `rounds=${rounds}`);
check('attempts still counts the per-hide hunts behind that round',
  byPose.reduce((n, p) => n + p.attempts, 0) === 4,
  `attempts=${byPose.reduce((n, p) => n + p.attempts, 0)}`);
check('a found hide records only the taps it cost',
  statsFor(hideIds[0]).avgTaps === 2, `avgTaps=${statsFor(hideIds[0]).avgTaps}`);

// A second marker's history must not leak into the first marker's table —
// that mismatch is what made the stats page contradict its own header.
const otherId = Number(stmt.markers.insert.run('o', 'o', 100, 200, 2, '[]', '[]').lastInsertRowid);
const otherHide = Number(
  stmt.hides.insert.run(otherId, null, 'human_b', 0, 0, 0, 0.2, 0.2, 'hides/o.png', 512).lastInsertRowid,
);
stmt.seeks.insert.run(otherHide, null, 1, 1, 500, '[{"u":0,"v":0,"hit":true}]', 'round-2');
check('the per-marker table ignores other markers',
  statsByPose(markerId).reduce((n, p) => n + p.attempts, 0) === 4);
check('the global table still sees every marker',
  statsByPose(null).reduce((n, p) => n + p.attempts, 0) === 5);

// Legacy rows predate round_id; each must count as a round of its own rather
// than collapsing into one NULL group.
stmt.seeks.insert.run(hideIds[1], null, 0, 1, 500, '[{"u":0,"v":0,"hit":false}]', null);
stmt.seeks.insert.run(hideIds[1], null, 0, 1, 500, '[{"u":0,"v":0,"hit":false}]', null);
check('rows written before round_id count as separate rounds',
  statsByPose(markerId).find((p) => p.poseId === 'human_b').rounds === 3,
  `rounds=${statsByPose(markerId).find((p) => p.poseId === 'human_b').rounds}`);

// --- clearing --------------------------------------------------------------

check('before clearing, the marker reports every hide ever made on it',
  stmt.markers.hideCount.get(markerId).n === 4);
const cleared = stmt.hides.deactivateByMarker.run(markerId).changes;
check('clearing retires exactly the marker\'s active hides', cleared === 4, `cleared=${cleared}`);
check('a cleared marker reports no hides', stmt.markers.hideCount.get(markerId).n === 0);
check('a cleared marker offers nothing to seek', stmt.hides.byMarker.all(markerId).length === 0);
check('clearing twice is a no-op', stmt.hides.deactivateByMarker.run(markerId).changes === 0);
check('clearing keeps the history for the stats pages',
  statsByPose(markerId).reduce((n, p) => n + p.attempts, 0) === 6);
check('clearing one marker leaves others alone',
  stmt.markers.hideCount.get(otherId).n === 1);

db.close();   // Windows keeps the .db file locked until the handle goes
fs.rmSync(dataDir, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
