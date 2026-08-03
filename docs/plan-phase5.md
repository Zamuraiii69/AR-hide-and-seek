# Phase 5 — Seeker Mode (+ backing plane, distance gate)

## Context

Phase 3 and 4 gave the hider a complete loop: place → lock → paint (with eyedropper and
marker-derived palette) → save. What is missing is the other half of the game: someone
has to actually look for the thing.

Phase 5 is bigger than the original plan's "3 taps and a hit test", because field testing
surfaced a defect that changes the design:

> **Moving the camera quickly desynchronises the silhouette from the marker.** The model
> visibly slides off the image and is instantly spotted.

This is not only a polish problem. It is a **gameplay exploit**: a seeker can shake the phone
and simply watch for the element that lags behind. Any seeker mode built before this is fixed
would ship with a trivial win condition.

Two changes address it, and both belong in Phase 5 because Phase 5 is the last point where
they can be designed in rather than bolted on:

1. **Backing plane** — render the marker image as a textured plane *underneath* the
   silhouette, inside the same anchor group, so tracking error moves both together.
2. **Distance gate** — in seeker mode, block the view when the camera gets too close, so the
   game is "spot it from a normal viewing distance", not "inspect it pixel by pixel".

---

## Current state (verified)

**Landed since the Phase 3 review:** F1 (`placement.move` returns `null` when not dragging),
F2 (brush zero-length guard), F3 (`applyTransform()` at boot), F4 (`storage.pngDimensions`
derives real dimensions in `PUT /:id/image`), R6 (`mask.js` decodes at `DECODE_RES = 256`).
Phase 4 shipped `markerSampler.js` and `palette.js`.

**Not done, and relevant here:**

| | State |
|---|---|
| `arSession.js:16` filter | **untouched** — `filterBeta: 0.01, missTolerance: 5` |
| `server/routes/seeks.js` | missing (the `seeks.insert` prepared statement already exists in `db.js`) |
| `public/seek.html`, `js/seek/seekApp.js` | missing |
| backing plane | does not exist; `silhouette.mesh.renderOrder = 10` is the only ordered object |

Reusable and already correct: `pickAnchorPlane`, `localToMeshUV` (rotation-aware since F1/R1),
`mask.isBody(u, v, tol)`, `bindPointer` (already reports `{ tap }` via `<12px` / `<600ms`),
`api.js`, `hud.js`, the `session.visible` guard discipline, and the
`depthTest:false` + `renderOrder` layering convention.

---

## Step 5.0 — Tune the tracking filter first (measure, then decide)

Before adding geometry, spend an hour on the two numbers that were set in Phase 2 and never
revisited. They are a deliberate trade-off that is currently pinned to one extreme.

- **`missTolerance: 5`** — MindAR keeps the anchor `visible` for 5 frames after detection
  fails, drawing with a **stale pose**. That is precisely the reported symptom.
- **`filterBeta: 0.01`** — MindAR uses a one-euro filter; `filterBeta` is the speed
  coefficient. A very low value barely adapts to motion, which buys stillness when the camera
  is stationary and pays for it with lag when the camera moves.

Try `missTolerance: 1–2` and `filterBeta: 0.05–0.1`. **Record the numbers you tried and what
you observed** — jitter when still, lag when moving. This is a genuine trade-off with no
universally right answer, and the result determines how hard the backing plane has to work.

Do not skip to 5.1 assuming the filter is irrelevant. Equally, do not expect tuning alone to
be sufficient: it reduces lag but never reaches zero, so the shake-to-find exploit survives.
Only the backing plane closes that.

---

## Step 5.1 — Backing plane (`core/backdrop.js`)

A plane textured with the marker image, sized to the marker exactly, sitting just below the
silhouette in the same anchor group.

```js
// core/backdrop.js
export function createBackdrop({ texture, aspect })
// → { mesh, dispose }
```

Requirements:

- `PlaneGeometry(1, aspect)` — anchor space has marker width = 1, height = aspect
- position `(0, 0, 0)`; the silhouette already sits at `z = 0.001`
- `MeshBasicMaterial` (unlit), `toneMapped: false`, `depthTest: false`, `depthWrite: false`
- `renderOrder = 5` (silhouette is 10, so the plane draws first / underneath)
- **`texture.colorSpace = THREE.SRGBColorSpace`** — same trap as the paint texture; the
  default is `NoColorSpace` and getting it wrong shifts every colour
- added to `session.group`, **before** the silhouette

**Reuse the image Phase 4 already downloaded.** `markerSampler.js` fetches and decodes
`marker.imageUrl` for the eyedropper. Have it expose the decoded image (or its bitmap) so the
backdrop texture costs no second network round trip and no second decode.

### Enable it in BOTH modes, not just seek

This is easy to get wrong. If the hider paints against the live camera image but the seeker
views a virtual plane, the two do not match and the hider's work is wasted. The backdrop must
be present in hide mode too — a retrofit to `hideApp.js`.

The payoff for making them consistent is large:

- The silhouette no longer camouflages against *what the camera sees* (auto-exposure, auto
  white balance, tone curve — a 10–30% moving target). It camouflages against **the source
  file**, whose pixels are known exactly.
- The Phase 4 eyedropper becomes **exact** rather than approximate, because it samples the
  same file the plane renders.
- **Phase 8 (white-balance gain) may become unnecessary.** Re-evaluate it once this lands
  rather than building it on principle.

### Known cost, and why it is acceptable

The real marker is replaced by a virtual copy, so paper glare, shadows and specular highlights
disappear. Under strong or very dim lighting the marker rectangle will read as "too clean"
against its surroundings.

This is a uniform, whole-rectangle effect. It does **not** indicate where the silhouette is,
so it does not leak the answer — it only costs some physical-presence realism. That is a good
trade for closing the exploit.

### Scope: cover the whole marker

Covering only a patch around the silhouette puts the seam in the middle of the artwork, where
any misregistration shows as a doubled feature — far more visible. Covering the whole marker
puts the seam on the paper edge, which is already a natural boundary. **Cover the whole
marker.**

---

## Step 5.2 — Distance gate (seek mode only)

### Measuring distance is free and scale-invariant

MindAR keeps the camera at the origin and stores the marker pose in camera space, so the
length of the anchor's world-space translation is the camera-to-marker distance **in units of
marker width**. One threshold therefore works for any printed size — A4, A3, or a phone
screen — with no physical calibration.

`pickAnchorPlane` already computes the camera position in anchor space. Expose a sibling
helper rather than duplicating the matrix work:

```js
// anchorPick.js
export function cameraDistance(camera, anchorGroup)  // → distance in marker widths
```

### Rules

- **Hysteresis is mandatory.** A single threshold flickers on and off at the boundary.
  Engage below `0.8`, release above `0.95`. Tune on a real device.
- **A gated tap must not count.** The overlay covers the canvas with `pointer-events: auto`
  and the tap handler returns early while gated. Losing one of three guesses to the overlay
  would be infuriating.
- **Not a modal.** A blur/vignette plus a short "Move back a little" line that clears itself
  when the player retreats. Nothing to dismiss.
- **Do not apply it in hide mode** (or set a much closer threshold there). The hider needs to
  get close to paint detail. This asymmetry is deliberate — state it in the code comment so
  nobody "fixes" it later.

### Frame the rule honestly

The gate limits close inspection *through the screen*. It cannot stop someone walking up and
looking at the paper with their eyes. Treat it as a rule that keeps the game fun, not as an
anti-cheat mechanism, and do not invest in hardening it further.

---

## Step 5.3 — `server/routes/seeks.js`

```
POST /api/seeks
  body { hideId, seekerName?, found, tapsUsed, durationMs?, taps: [{u, v, hit}] }
  → 201 { id, stats: { attempts, found, foundRate, avgTaps } }
```

- `db.js` already has `stmt.seeks.insert` and `stmt.hides.seekStats` — wire them up
- validate: `hideId` exists and `is_active`; `found` is 0/1; `tapsUsed` is 1–3;
  `taps` is an array of at most 3 finite `{u, v, hit}` entries
- clamp `taps_json` to a sane size before storing
- follow the error-handling shape agreed in the Phase 3 review: validation failures return
  400 JSON; anything else goes to `next(err)` and becomes a 500 — do **not** wrap the whole
  handler in a catch that reports 400 (that was finding P5)
- mount in `server.js` next to `/api/hides`

`GET /api/hides/:id` already embeds the marker, so the seeker still needs only one round trip
before `MindARThree` can be constructed.

---

## Step 5.4 — `seek.html` + `js/seek/seekApp.js`

State machine:

```
LOADING → READY → HUNTING → RESULT
                    │
                    └── gated (distance overlay) — a sub-state of HUNTING, not a mode
```

Flow:

1. Read `?hide=<id>`, `GET /api/hides/:id` **at page load** (never inside the click handler —
   it breaks the iOS user-gesture chain)
2. Build backdrop + silhouette; apply the saved `transform`; load `paintUrl` into the paint
   canvas via `silhouette.loadPaint()`
3. Start camera on tap, then `HUNTING`: up to **3 taps**
4. Per tap: bail if `!session.visible` or gated → `pickAnchorPlane` → `localToMeshUV` →
   `mask.isBody(u, v, 0.03)`
5. Hit → reveal (outline pulse) and finish; miss → ripple at the tap point, decrement
6. On finish, `POST /api/seeks` with the full tap list, then show the result

Carry over from Phase 3, unchanged:

- act on `end()` with `{ tap: true }`, never on `start()` — otherwise repositioning the camera
  burns guesses
- every pointer handler returns early on `!session.visible`
- page CSS: `touch-action: none`, HUD container `pointer-events: none` with `auto` on
  controls, `overscroll-behavior: none`, `html, body { overflow: hidden; position: fixed }`
- spinner between the start tap and the first frame (cold start is several MB)

The render cutoff (`alphaTest 0.5`) and the hit threshold (green `> 127` plus an 8-point ring
probe at `tol = 0.03`) intentionally disagree slightly, in the player's favour. That is
correct for a hard-to-see target — keep it.

---

## Step 5.5 — Rebalance (do this last, with real players)

The backing plane makes hiding materially easier: the hider now matches a known file instead
of a live camera image. Seeker mode could land unfairly hard.

Do not pre-compensate. Ship 3 taps, watch real attempts, then use the data — `seeks.taps_json`
records every `{u, v, hit}` and is exactly the heatmap fodder needed to see whether players
are searching sensibly or flailing.

Levers, cheapest first:

- **Raise the tap allowance** (3 → 4 or 5). One number.
- **Tune the silhouette's z offset.** Because the model sits slightly above the backdrop, an
  oblique viewing angle produces genuine parallax between the two. This is an elegant tell: it
  rewards moving around the marker instead of staring, and raising the offset (`0.001` →
  `0.005`) makes the game easier in a way that is diegetic rather than arbitrary. **This is
  the most interesting lever — try it before adding hints.**
- **Hints after the first miss** (warmer/colder, or a quadrant).

Note that pixel-perfect camouflage is not actually reachable: brush strokes, brush radius and
a finite palette all leave residue. The floor is lower than it looks.

---

## Out of scope for Phase 5

| Excluded | Why |
|---|---|
| Switching AR engine | Evaluated and rejected separately — cost is distribution, not code |
| White-balance gain (Phase 8) | Re-evaluate *after* the backing plane; it may be moot |
| Upload flow | Phase 6 — markers are still created by hand via `curl` |
| Leaderboards, accounts | Not needed to answer "is this game fun?" |
| Hardening the distance gate | It is a fairness rule, not a security boundary |

---

## Verification

**API level (no camera):**

```bash
npm start
curl -s -X POST localhost:3000/api/seeks -H 'Content-Type: application/json' \
  -d '{"hideId":1,"found":1,"tapsUsed":2,"durationMs":8400,
       "taps":[{"u":0.2,"v":0.3,"hit":false},{"u":0.51,"v":0.62,"hit":true}]}'
curl -s localhost:3000/api/hides/1     # stats.attempts must increment
```

Must fail as JSON, not HTML: unknown `hideId` → 404; `tapsUsed: 9` → 400; `taps` not an
array → 400.

**Unit level** (import the real modules in Node, the pattern used to verify Phase 3):

- `cameraDistance` against a hand-built matrix with a known translation
- hysteresis: feed a distance ramp `1.2 → 0.5 → 1.2` and assert the gate engages once and
  releases once — **no oscillation** near the threshold
- `mask.isBody` at the bbox edges: just inside → hit, well outside → miss

**Device level** (two phones, matte-printed marker, `npx ngrok http 3000`):

1. Hide something on phone A, open the resulting `shareUrl` on phone B
2. **The exploit test — this is the one that matters.** Shake the phone hard while pointing at
   the marker. The silhouette must stay locked to the backdrop. If it separates, 5.1 is not
   done, regardless of how good it looks when held still.
3. Walk in until the overlay engages, then back out. It must engage and release **once** each,
   with no flicker at the boundary.
4. Tap through the overlay while gated — the guess counter must not move.
5. Miss twice, hit once → reveal fires, `POST /api/seeks` lands, DB row has sensible
   `taps_json`.
6. Miss three times → game ends, result recorded with `found = 0`.
7. Tracking-loss test: lose the marker mid-hunt and reacquire. No phantom taps, no stale-pose
   hits registered.
8. View the marker at a steep oblique angle. Confirm the parallax tell from 5.5 is visible but
   subtle — it should reward movement, not give the answer away.
