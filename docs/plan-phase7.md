# Phase 7 — Wiring it together (+ Phase 5/6 fixes)

Part 1 reviews what shipped in Phase 5 and 6 and lists the fixes. Part 2 is the
Phase 7 execution plan. Written in English to match `plan-phase5.md`.

---

# Part 1 — Phase 5 / 6 review

Reviewed 2026-08-02. Every finding below was reproduced by running the code, not
inferred from reading. No files were modified.

## What works

**Phase 5 is in good shape.** `tools/check-seek.mjs` passes all 23 assertions
covering `cameraDistance`, the hysteresis ramp, mask hit tolerance, and backdrop
geometry/colour-space. The `POST /api/seeks` contract behaves correctly:

```
happy path            → 201 {"id":1,"stats":{"attempts":1,"found":1,"foundRate":1,"avgTaps":2}}
hideId 999            → 404 {"error":"hide not found"}
tapsUsed 9            → 400 {"error":"tapsUsed must be an integer between 1 and 3"}
taps "nope"           → 400 {"error":"taps must be an array of at most 3 …"}
found 2               → 400 {"error":"found must be 0 or 1"}
durationMs -5         → 400 {"error":"durationMs must be a non-negative number"}
```

Specific things done well, worth keeping:

- **The backdrop landed in *both* modes**, and `hideApp.js:297` gets the subtle
  part right — peek hides the silhouette but not the backdrop, because that is
  what the seeker sees. That was the easiest thing in Phase 5 to get wrong.
- **`filterFromSearch` (`?beta=&miss=`)** is a genuinely good addition that was
  not in the plan. Step 5.0 kept not getting done because every trial cost an
  edit and a redeploy; this makes on-device tuning free. The defaults moved to
  `filterBeta: 0.05, missTolerance: 1` with an honest comment that they are not
  yet device-measured.
- **`seeks.js` error shape follows the Phase 3 P5 finding** — validation returns
  explicit 400/404, everything else goes to `next(err)`. The regression did not
  come back.
- `distanceGate.js` is deliberately free of three.js and the DOM, which is why
  the ramp can be asserted in Node. `avg_taps` was correctly added to the
  `seekStats` SQL, so `statsFor` does not blow up on a hide with no attempts.
- `uploadApp.js` uses `new Blob([bytes])` for the compiler output — the
  shared-buffer trap from Spike A is handled.

## Findings

### 🔴 F7-1 — The upload page has no desktop-only gate (Phase 6)

Spike A's conclusion, recorded in `plan.md` as the reason marker intake moved to
desktop, was never implemented. `public/upload.html` has no mobile detection, and
`index.html:164` was rewritten during Phase 6 so its old "ควรทำบน desktop" notice
is gone too. **There is now no warning anywhere.**

A phone user who taps "Upload marker" gets a multi-second main-thread freeze —
TFJS feature detection runs on the main thread — or a tab crash, with no
explanation.

**Fix:** gate the upload form behind a coarse-pointer / small-viewport check and
show a short notice explaining why, with a "continue anyway" escape for tablets.
Restore a one-line desktop hint next to the button on `index.html`.

### 🟠 F7-2 — A tap far outside the marker still burns a guess (Phase 5)

`pickAnchorPlane` intersects an **unbounded** z=0 plane. `seekApp.guess()` only
rejects a null hit, so a tap on the table beside the poster — or anywhere else on
that infinite plane — produces a valid point, misses the mask, and spends one of
only three guesses.

The silhouette is always inside the marker (the Phase 3 drag clamp guarantees
it), so an off-marker tap **can never be a hit**. Counting it is pure punishment
for a slip.

**Fix:** `guess()` already computes `markerUv` for the heatmap, so the bounds
check is free — if `u` or `v` falls outside `[0, 1]`, return without pushing a
tap and show a brief "แตะบนรูป" hint. Keep rejecting null hits as it does now.

### 🟠 F7-3 — `MAX_TAPS` is duplicated across client and server (Phase 5)

`seekApp.js:31` and `seeks.js:17` each declare `MAX_TAPS = 3`, bound only by a
comment (*"must match seekApp's allowance"*). Plan §5.5 explicitly intends to
raise this from real data. Raising it on the client alone makes the server reject
every submission with a 400 — after the player has finished the hunt, so the
result is lost.

**Fix:** make the server authoritative and send the allowance to the client.
`GET /api/hides/:id` is already the seeker's single pre-flight request; add
`maxTaps` to its response and delete the client constant.

### 🟡 F7-4 — Server does not cross-check `tapsUsed` against `taps` (Phase 5)

Verified: `{"hideId":1,"found":1,"tapsUsed":1,"taps":[]}` is accepted. Likewise a
`found: 1` with no `hit: true` tap in the list.

`avgTaps` is computed from the `taps_used` column while heatmaps come from
`taps_json`, so the two can silently disagree — and §5.5 plans to rebalance the
game from exactly these numbers. Bad data here is worse than missing data,
because it looks fine.

**Fix:** require `tapsUsed === taps.length`, and `found === taps.some(t => t.hit)`.
Both are one line and turn a silent inconsistency into a 400.

### 🟡 F7-5 — `compileTarget` uses the decode path Spike A had trouble with (Phase 6)

`uploadApp.prepareImage` correctly uses `createImageBitmap(file)`, but
`compileTarget` (line 101-105) goes back to `new Image()` + `URL.createObjectURL(pngBlob)`
+ `await source.decode()`.

Honest framing: the Spike A investigation ended **ambiguous** — the observed
hangs could not be cleanly separated from tab-backgrounding throttling, and that
correction is on the record. But the mitigation adopted at the time
(`createImageBitmap`, then a `data:` URL for the `Image`) was dropped here, and
this is the longest and least recoverable step in the whole upload flow.

**Fix:** reuse the proven path — the canvas in `prepareImage` is already there, so
`canvas.toDataURL('image/png')` gives an `Image` source without a blob URL. Low
cost, removes a known-suspect path.

### ⚪ F7-6 — Minor

- Compile blocks the main thread, so the `compileImageTargets` progress callback
  cannot repaint. The `requestAnimationFrame` await before compiling buys exactly
  one paint. Set expectations in the phase text instead ("this can take 10–30s
  and the page will not respond").
- `#gate` has no `z-index` while `.top`/`.panel` have `z-index: 1`, so the HUD
  panels sit above the blur. Looks deliberate — confirm it is.
- Three verification tools exist (`check-mask.js`, `check-palette.mjs`,
  `check-seek.mjs`) and **none are wired to `npm test`**. See Step 7.5.

## Fix order

| # | Fix | Why this order | Est. |
|---|---|---|---|
| **F7-1** | Desktop gate on upload | Only finding that hard-breaks a real user path | 30 min |
| **F7-2** | Bounds-check taps | Directly unfair, and cheap | 15 min |
| **F7-3** | Serve `maxTaps` from the API | Must land before anyone tunes §5.5 | 20 min |
| **F7-4** | Cross-check `tapsUsed`/`found` | Protects the data §5.5 depends on | 15 min |
| **F7-5** | Drop the blob-URL decode | Removes a suspect path in the riskiest step | 15 min |
| **F7-6** | Minor | Fold into Step 7.5 | — |

**F7-1 through F7-4 are the gate for Phase 7.** F7-5 can ride along with Step 7.2.

---

# Part 2 — Phase 7 execution plan

## Context

Every piece of the game now exists, but they are only reachable if you already
know the URL. There is no way to *browse* to a hunt: `seek.html` is reachable
only via a `shareUrl` handed out at save time, and `index.html` lists markers but
offers nothing except "Hide".

Phase 7 closes the loop so a person handed the site root can play both roles
without being told any URLs, and adds the one piece of instrumentation §5.5 needs
to rebalance the game from data instead of a hunch.

This is the last phase before the PoC is judged, so it also decides the fate of
Phase 8.

## Step 7.0 — Land F7-1 … F7-4

See Part 1. Do not start 7.1 until these are in; three of the four touch exactly
the files Phase 7 builds on.

## Step 7.1 — Seek entry from the menu

The server already has what is needed: `GET /api/markers/:id/hides?pick=random&limit=1`
was built in Phase 1 and has never been called.

On each marker card in `index.html`:

- **Hide here** → `/hide.html?marker=<id>` (existing)
- **Find someone** → fetch a random active hide for that marker → redirect to
  `/seek.html?hide=<id>`. Disable with an explanation when `hideCount === 0`.

`hideCount` is already in the marker list payload, so the button state costs no
extra request.

## Step 7.2 — Finish the share flow

Saving a hide currently drops a bare `location.origin + shareUrl` string into the
page. Make it usable on a phone:

- a **Copy link** button (`navigator.clipboard.writeText`, with a select-the-text
  fallback — clipboard access needs HTTPS, which ngrok gives us)
- **Share** via `navigator.share` when available; this is the actual path a phone
  user takes
- a link to open the hunt directly, for testing on the same device

Fold F7-5 in here since it is the same upload/share surface.

QR generation is tempting and is **out of scope** — it needs a dependency, and
`navigator.share` covers the real case.

## Step 7.3 — Minimal stats view

§5.5 says rebalance from real attempts. Nothing currently reads `taps_json` back.

Add one modest page, `stats.html?hide=<id>`:

- attempts, found count, found rate, average taps (all already returned by
  `statsFor`)
- the marker image with tap points drawn on it — `taps_json` stores marker-space
  uv precisely so this is a direct overlay, no transform needed
- colour hits and misses differently

This is the payoff for the Phase 5 decision to store marker-space rather than
mesh-space uv. Needs a small `GET /api/hides/:id/seeks` endpoint (cap the row
count; this is a PoC, not an analytics product).

**Decide from this data, not before it:** whether to raise `MAX_TAPS`, and
whether the parallax lever from §5.5 (silhouette z offset `0.001 → 0.005`) is
needed. Do not pre-tune.

## Step 7.4 — Decide Phase 8

`plan-phase5.md` §5.1 predicted that the backdrop would make white-balance gain
unnecessary, because the silhouette now camouflages against the source file
rather than the camera's rendition of it.

**Verify on a device, then write the decision down.** Hide something, view it
under warm indoor light and again near a window. If the silhouette still reads as
camouflaged in both, delete Phase 8 from `plan.md` with a one-line reason. If it
does not, Phase 8 survives with a narrower scope than originally written.

Either way this ends as a recorded decision, not an open item.

## Step 7.5 — Housekeeping

- **`npm test`** → run `check-mask.js`, `check-palette.mjs`, `check-seek.mjs` in
  sequence. Three real test suites currently need to be remembered by hand.
- **Retire the spike pages.** `spike-compile.html` and `spike-camouflage.html`
  answered their questions in Phase 0 and are now dead weight reachable from the
  web root. Move them under `tools/` or delete them — but first confirm nothing
  links to them (`upload.html` used to redirect to `spike-compile.html`).
- **Update `README.md`** — still describes the original "AR status" pose-sharing
  PoC with Socket.io, which no longer exists. Replace with: what the game is, how
  to run it, the ngrok requirement, and that upload is desktop-only.
- F7-6 items.

## Out of scope

| Excluded | Why |
|---|---|
| Accounts, auth | Anonymous play answers "is this fun?" |
| Rooms / matchmaking | The async-through-DB decision still holds |
| Multiple silhouettes | `silhouette_id` already carries the seam for later |
| Deleting / editing hides | No one has asked; add when a test session demands it |
| QR codes | `navigator.share` covers the real path without a dependency |
| Switching AR engine | Settled — the cost is distribution, not code |

## Verification

**API level:**

```bash
npm test                                   # all three suites green
npm start
curl -s "localhost:3000/api/markers/2/hides?pick=random&limit=1"   # non-empty
curl -s localhost:3000/api/hides/3 | grep maxTaps                  # F7-3
curl -s -X POST localhost:3000/api/seeks -H 'Content-Type: application/json' \
  -d '{"hideId":3,"found":1,"tapsUsed":1,"taps":[]}'               # F7-4 → 400
```

**Desktop:** open `/upload.html` in a narrow window or with device emulation on —
the desktop gate must appear (F7-1).

**Device — the full journey, told to nobody:** hand someone the site root on a
phone and watch without instructions.

1. They reach a hunt from the menu without being given a URL (7.1)
2. Hide on phone A → share to phone B via the share sheet (7.2)
3. On B: tap the table *beside* the poster — the guess counter must **not** move
   (F7-2)
4. Walk in until the gate engages, then out — engages and releases once, no
   flicker; taps while gated do not count
5. Shake the phone hard while pointing at the marker — silhouette stays locked to
   the backdrop (the Phase 5 exploit test; still the one that matters most)
6. Finish the hunt, open `stats.html?hide=<id>` — tap points land where they were
   actually tapped (7.3)
7. Same hide under two lighting conditions → record the Phase 8 verdict (7.4)

Step 3 is the new regression test for this phase. Steps 5 and 7 are carried
forward because they are the two claims the whole design rests on.
