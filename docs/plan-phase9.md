# Phase 9 — Pose selection + HUD paint preview

Written in English to match `plan-phase5.md` / `plan-phase7.md`.

| | |
|---|---|
| **Author** | tech lead (spec only — no implementation in this document) |
| **Date** | 2026-08-13 |
| **Branch** | `feat/hud-pose-and-preview-paint`, off `main` @ `7ccfc5d` |
| **Design refs** | `docs/img-ref/UI_1_1.png` (PLACE), `docs/img-ref/UI_2_1.png` (PAINT) |
| **Depends on** | Phase 7 complete; light theme merged into `main` (PR #1) |
| **Does not touch** | Phase 8 (white-balance gain) — still undecided in `plan.md:297` |

Part 1 records what already landed and what is broken *right now*. Part 2 is the
execution plan. Every file:line below was read on this branch, not remembered.

---

# Part 1 — State of the branch

## 1.1 Already landed (do not redo)

| Item | Detail |
|---|---|
| `main` synced | Fast-forwarded to `origin/main` (`af39152`), then merged `agent/light-theme-remove-phase3`. Resulting tree is **byte-identical** to the deployed `codex/render-linearmap-deploy`. Pushed as `7ccfc5d`. |
| Housekeeping §7.5 item 2 | `spike-compile.html`, `spike-camouflage.html` moved `public/` → `tools/spikes/`. Nothing in `public/` or `server/` linked to them (only `docs/` prose does). |
| Housekeeping §7.5 item 3 | `README.md` refreshed: pose mention, 4 test suites, spike relocation. |
| Housekeeping §7.5 item 1 | Was already done in an earlier phase — `package.json` `test` runs all four suites. |

## 1.2 Asset audit — the four new poses

Answers task 1.2 ("check the images are valid"). Measured by decoding each PNG
directly (full filter support), reading the **green channel**, threshold `> 127`
— the exact rule `public/js/core/mask.js:43` and `:71` apply.

| File | Size | Type | Row filters | Green range | Body coverage | bbox (u0,u1,v0,v1) |
|---|---|---|---|---|---|---|
| `human_default.png` | 1024² | RGB8 | `[0]` | 0–255 | 12.0 % | 0.346, 0.654, 0.086, 0.918 |
| `human_a.png` | 1024² | RGB8 | `[1,2,3,4]` | 0–255 | 17.3 % | 0.289, 0.742, 0.093, 0.900 |
| `human_b.png` | 1024² | RGB8 | `[1,2,3,4]` | 0–255 | 16.6 % | 0.307, 0.798, 0.094, 0.898 |
| `human_c.png` | 1024² | RGB8 | `[1,2,3,4]` | 0–255 | 17.0 % | 0.229, 0.874, 0.247, 0.899 |
| `human_d.png` | 1024² | RGB8 | `[1,2,3,4]` | 0–255 | 17.0 % | 0.241, 0.870, 0.094, 0.899 |

**Verdict: all four are valid.** Same geometry (1024², 8-bit, colour type 2,
non-interlaced) as the original, white body on black background, green channel
saturating at 255 inside the body and 0 outside. `loadMask`, the `alphaMap`, and
`isBody` will all behave. Two consequences worth writing down:

- **`human_c` is a wide, crouching pose**: its bbox is 0.645 wide × 0.652 tall,
  versus 0.31 × 0.81 for `human_default`. At the same `scale` slider value it
  covers a very different footprint, so `clampToMarker`
  (`public/js/core/placement.js:3`) will reject sizes that fit for other poses.
  This is correct behaviour, not a bug — but the pose switch **must re-clamp**
  (see §2.2.4) or the mesh keeps a position that is no longer legal.
- **The new files use PNG row filters 1–4.** The old one used filter 0 only.
  This breaks `tools/check-mask.js` today — see B1.

## 1.3 Blockers found (must clear before feature work)

### 🔴 B1 — `npm test` fails right now

`tools/check-mask.js:24` throws `row <n> filter <f> != 0` on any PNG that is not
stored with filter 0. `human_a.png` now is. The test suite is the first thing a
reviewer runs, and it dies on line 1 of 4.

The same file also hardcodes `human_a.png` (`:7`), so it would never have covered
`b`/`c`/`d` even after the decoder is fixed.

Its final assertion (`:38-41`, "centered + tall") is a *plausible standing body*
heuristic. `human_c` fails it legitimately (`u1 = 0.874 > 0.8`, height
`0.652 < 0.7`). Keeping that assertion would mean rejecting a valid asset.

**Fix (Step 9.0.1):** generalise the decoder and re-aim the assertions at the
contract the code actually depends on, not at body shape. A working reference
decoder (all five filter types, colour types 0/2/4/6) was written during this
audit and is attached in §2.0.1 — lift it.

New assertions, per file, for every `*.png` in `public/assets/silhouettes/`:

| Assert | Why |
|---|---|
| 8-bit, non-interlaced, colour type ∈ {0,2,4,6} | `loadMask` decodes via canvas, but the check tool decodes by hand |
| green channel is **bimodal**: ≥ 95 % of pixels are `< 8` or `> 247` | a soft/greyish mask makes `alphaTest: 0.5` and `isBody`'s `> 127` disagree at the edge |
| body coverage between 3 % and 45 % | catches an all-white or empty file |
| bbox non-empty and fully inside `[0,1]` | `clampToMarker` divides by it |
| every id in the pose list has a file | catches a typo'd allowlist entry |

### 🟠 B2 — the generator would destroy the new art

`tools/gen-silhouette.js:1` and `:106` write **`public/assets/silhouettes/human_a.png`**.
That path now holds hand-made art. Anyone who runs the generator to regenerate
the default body silently overwrites pose A.

**Fix (Step 9.0.2):** repoint the generator's output to `human_default.png` and
update its header comment. One line each.

### 🟡 B3 — `human_default.png` is currently unreferenced

Nothing in `public/`, `server/`, or `tools/` mentions it. It is the renamed
original. Decision (§3, D6): **keep it** as the generator's output and as a
documented non-selectable asset. It is not offered in the pose picker and not
added to the write allowlist.

### 🔴 B5 — every existing hide points at art that changed under it

`human_a` used to be the generated default body. It is now a **different pose**,
and the old art moved to `human_default.png`. The database was not told:

```text
sqlite> SELECT silhouette_id, count(*), min(created_at), max(created_at) FROM hides GROUP BY silhouette_id;
human_a | 7 | 2026-07-29 23:53:17 | 2026-08-04 16:25:15
```

All 7 rows in the local `data/app.db` — and whatever the Render instance holds in
its own `DATA_DIR` — were painted against the **old** shape. `seekApp` resolves
`silhouette_id` → PNG at run time (`public/js/seek/seekApp.js:72-75`), so those
hunts now render the saved 512² paint through a mask it was never painted for:
paint bleeds where the new pose has body and vanishes where it does not. The
camouflage those hiders tuned by eye is destroyed, silently, with no error.

**Fix (Step 9.0.3):** a one-time, guarded migration. `PRAGMA user_version` is 0
today, so it is free to use as the schema marker (`server/db.js` already has an
unguarded `db.exec` fix-up block at `:60-66` — do **not** copy that pattern here;
this one must run exactly once).

```js
// server/db.js — after table creation, before prepared statements.
// Phase 9 renamed the generated default body to human_default and gave
// 'human_a' to new hand-drawn art. Rows written before that point were painted
// against the old shape and must follow it, or their camouflage is nonsense.
if (db.prepare('PRAGMA user_version').get().user_version < 1) {
  db.exec(`UPDATE hides SET silhouette_id = 'human_default' WHERE silhouette_id = 'human_a';`);
  db.exec('PRAGMA user_version = 1');
}
```

Ordering matters: this must ship **before** the pose picker can write a genuine
`human_a`, otherwise the migration cannot tell old rows from new ones. That makes
it part of Step 9.0, not a later cleanup.

It also means `human_default` must stay a **readable** id forever, even though it
is not selectable (D6). `seekApp.silhouetteUrl`'s permissive regex already allows
it; the write-side allowlist (§9.1.5) deliberately does not.

### ⚪ B4 — stale product name

`package.json:2` (`meccha-chameleon-poc`), `public/hide.html:5` (`Hide | Meccha
Chameleon`), and the share payload in `public/js/hide/hideApp.js:357`
(`title: 'Meccha Chameleon'`) still carry the old name; the project was renamed
in `520308b`. Fold into Step 9.3, not a blocker.

---

# Part 2 — Execution plan

## Step 9.0 — Clear the blockers

Nothing else starts until `npm test` is green.

### 9.0.1 Rewrite `tools/check-mask.js`

Keep it dependency-free (it is the only test that reads a binary asset). Reference
decoder — correct for filters 0–4 and colour types 0/2/4/6, non-interlaced,
8-bit:

```js
function decode(file) {
  const buf = fs.readFileSync(file);
  let p = 8, width, height, color, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error(`${file}: bit depth ${data[8]} unsupported`);
      if (data[12] !== 0) throw new Error(`${file}: interlaced`);
      color = data[9];
    }
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') break;
    p += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[color];
  if (!channels) throw new Error(`${file}: colour type ${color} unsupported`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= channels ? prev[i - channels] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
  }
  return { width, height, channels, color, data: out };
}
```

Then loop the pose list (imported from the shared module in §2.2.5, **not**
re-typed) plus `human_default`, and apply the assertion table from B1. Print one
`PASS`/`FAIL` line per file per assertion in the style of `check-seek.mjs`, and
`process.exit(1)` on any failure.

### 9.0.2 Repoint `tools/gen-silhouette.js`

`human_a.png` → `human_default.png` at `:1` (comment) and `:106` (write path).

### 9.0.3 One-time `silhouette_id` migration

Code and reasoning in **B5**. Ship it before the pose picker can write a real
`human_a` — after that, old and new rows are indistinguishable.

Deploy note: the Render instance has its own `DATA_DIR` and its own rows. The
migration is guarded by `PRAGMA user_version`, so it runs once per database at
startup and is a no-op on every boot after that — nothing manual to remember.

**Gate for Step 9.1:** `npm test` green with all five assets asserted, and the
migration verified against a copy of a real `data/app.db` (§5).

---

## Step 9.1 — Feature A: pose selector (PLACE panel)

Reference: `docs/img-ref/UI_1_1.png`.

### 9.1.1 Target layout

The mock is a 1080 × 1920 render of a ~360 CSS px viewport, so **divide mock
pixels by 3** for CSS values. Treat these as targets to eyeball, not gospel.

```
┌─ .panel ────────────────────────────────────────────────┐
│  Pose    [img][img][img][img]                           │   ← new row
│  Scale   ●━━━━━━━━━━━━━━━━━━      ┌───────────────────┐  │
│  Rotate  ●━━━━━━━━━━━━━━━━━━      │  Lock Position    │  │   ← spans 2 rows
│                                    └───────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

| Element | Target |
|---|---|
| Label column | ~56 px, 14 px / 600, `#3a4146` |
| Pose button | 34 × 34 px, radius 8 px, gap 9 px |
| Pose button — idle | `background:#fff`, `border:1px solid #d2d4cf`, glyph `#5f6870` |
| Pose button — selected | `background:#e44a24`, `border-color:transparent`, glyph `#fff` |
| Glyph inside button | ~17 px square, centred |
| Sliders | existing `accent-color:#e44a24` |
| Lock Position | existing primary button, `grid-row: span 2`, ~95 px wide |

The current `.place-only` is a flat `.controls` flexbox
(`public/hide.html:28`). It becomes a grid:

```html
<div class="place-only place-grid">
  <span class="row-label">Pose</span>
  <div id="pose-row" class="pose-row"><!-- 4 buttons, built in JS --></div>
  <label class="stacked" for="scale">Scale</label>
  <input id="scale" type="range" min="0.08" max="1.2" step="0.01" value="0.30">
  <label class="stacked" for="rotate">Rotate</label>
  <input id="rotate" type="range" min="-180" max="180" step="1" value="0">
  <button id="lock" type="button">Lock Position</button>
  <span id="fit"></span>
</div>
```

```css
.place-grid { display:grid; grid-template-columns:56px 1fr auto; gap:10px 9px; align-items:center; }
.place-grid #lock { grid-column:3; grid-row:2 / span 2; align-self:center; }
.place-grid #pose-row { grid-column:2 / -1; }
.place-grid #fit { grid-column:1 / -1; }
.pose-row { display:flex; gap:9px; }
```

Note the global `label { display:grid; grid-template-columns:72px 1fr }`
(`public/hide.html:17`) currently wraps each slider. Moving the label out of the
`<label>` wrapper into its own grid cell is what lets the Lock button span rows —
keep `for=`/`id=` so the label still targets the input.

Text changes: `Lock position` → **`Lock Position`** (mock is title case).

### 9.1.2 Pose thumbnails — how to draw them

The assets are **white-on-black opaque RGB**. Dropping one into an `<img>` shows
a black square. Three options were considered:

| Option | Verdict |
|---|---|
| `filter: invert(1)` on an `<img>` | Cheapest, but gives a black figure on a white square — cannot produce the white-on-orange selected state without a second filter chain. Rejected. |
| CSS `mask-image` + `mask-mode: luminance` | Exactly right in theory; `mask-mode` support on iOS Safari is recent enough to be a field risk on the phones this PoC targets. Rejected. |
| **Build an alpha PNG at boot, use it as a `mask-image`** | Chosen. |

**Chosen approach.** New module `public/js/core/poseThumb.js`:

```js
/**
 * Decode a white-on-black silhouette PNG into a small ALPHA-ONLY data URL:
 * rgb = 0, alpha = green channel. Used as a CSS mask-image so the button can
 * tint the glyph with `background: currentColor` and follow its own state.
 */
export async function poseThumbnail(url, size = 64) { /* draw → getImageData → a=g, rgb=0 → toDataURL */ }
```

Button markup produced in JS:

```html
<button type="button" class="pose" aria-pressed="false" aria-label="Pose A">
  <span class="pose-glyph" style="--thumb:url(data:image/png;base64,…)"></span>
</button>
```

```css
.pose-glyph { width:17px; height:17px; background:currentColor;
  -webkit-mask:var(--thumb) center/contain no-repeat; mask:var(--thumb) center/contain no-repeat; }
.pose { color:#5f6870; }
.pose[aria-pressed=true] { background:#e44a24; border-color:transparent; color:#fff; }
```

Cost: four 1024² decodes at 64² during boot. Do them **sequentially** (not in one
`Promise.all` with the mask and sampler decode) so peak memory on a low-end phone
stays flat, and `await` them *after* the AR session is constructed so they never
delay first paint. If a thumbnail fails to decode, fall back to the letter
(`A`/`B`/`C`/`D`) as the button's text — a pose the hider cannot preview is still
better than a pose they cannot select.

### 9.1.3 State and boot changes — `public/js/hide/hideApp.js`

```js
// replaces `const SILHOUETTE_URL` at :34
import { POSE_IDS, silhouetteUrl } from '../core/poses.js';
const DEFAULT_POSE = POSE_IDS[0];            // 'human_a'
```

`state` (`:43`) gains `pose: DEFAULT_POSE`.

`boot()` (`:97-106`) loads `loadMask(silhouetteUrl(state.pose))` and
`createSilhouette({ maskUrl: silhouetteUrl(state.pose) })` as today, but `mask`
must become **`let`**, not a destructured `const` — §9.1.4 reassigns it.

### 9.1.4 Switching pose

Rebuilding the whole silhouette would mean re-adding the mesh to `session.group`,
re-creating the brush bound to `silhouette.pctx`, and losing the transform. Do
not. Swap only what changes:

1. **`silhouette.js` gains `setMask(url)`** — load the new texture with the same
   settings as `:26-28`, assign `material.alphaMap`, set
   `material.needsUpdate = true`, then `dispose()` the *old* texture (in that
   order — disposing first can flash an untextured frame).
2. **Reload the hit-test mask**: `mask = await loadMask(silhouetteUrl(id))`.
3. **Rebuild placement**: `placement = createPlacement(silhouette.mesh, marker.aspect, mask.bbox)`.
   `createPlacement` is a closure over `bbox` (`placement.js:18`), so a stale one
   clamps against the previous pose's footprint. Rebuilding also resets its
   `grab`, which is correct — a pose switch is never mid-drag.
4. **Re-clamp**: call `applyTransform()`. Scale and rotation are deliberately
   **kept**; only the legality of the position changes. If the new pose no longer
   fits, the existing `updateFit()` (`:142-146`) already shows *Too large to hide*
   and disables Lock. No new UI needed.
5. **Refill the paint base**: `silhouette.fillBase()`. Pose can only be changed in
   PLACE, which is strictly before any painting (§3, D2), so nothing is lost — but
   the call keeps the invariant "paint canvas is 100 % opaque and matches the
   current pose" true unconditionally.
6. Guard against overlapping switches: a fast double-tap on two poses starts two
   `await` chains and the loser can land last. Keep a `let switching = false` (or
   a token counter) and ignore clicks while one is in flight; disable the row for
   the duration so the UI says so.

### 9.1.5 Save path and the server allowlist

- `hideApp.js:313` — `silhouetteId: 'human_a'` becomes `silhouetteId: state.pose`.
- **Server has no allowlist today.** `server/routes/hides.js:21,40` accepts any
  string and truncates to 80 chars. A typo therefore persists a hide that the
  seeker cannot render: `seekApp.silhouetteUrl` (`public/js/seek/seekApp.js:72-75`)
  only sanitises the *shape* of the id, so an unknown-but-well-formed id yields a
  404 on the PNG, `loadMask` rejects, and `boot()` dies with a broken hunt.
  Add to `server/gameRules.js` (which already exists for exactly this purpose):

  ```js
  const SILHOUETTE_IDS = ['human_a', 'human_b', 'human_c', 'human_d'];
  ```

  and 400 in `POST /api/hides` on anything not in it.

- **Do not duplicate the list on the client.** This is the same trap as F7-3
  (`MAX_TAPS` declared twice, `plan-phase7.md:79`): add a pose to the client only
  and every save 400s *after* the hider finished the work. Two acceptable
  resolutions — pick one:
  - **(preferred, cheap)** single source `public/js/core/poses.js`, imported by
    the browser *and* by `tools/check-mask.js`; `server/gameRules.js` keeps its
    own copy, and a new assertion in `check-mask.js` fails if the two lists
    differ. Drift is caught by `npm test`, not by a user.
  - (heavier) serve the list from `GET /api/silhouettes` and build the row from
    the response. Correct, but adds a request to the hider's critical path for a
    list that changes when art changes, i.e. never at runtime.
- Existing rows keep working: `is_active` hides created before this phase carry
  `human_a`, which is still a valid id (`server/db.js:38` default).

### 9.1.6 Files touched — Feature A

| File | Change |
|---|---|
| `public/js/core/poses.js` | **new** — `POSE_IDS`, `silhouetteUrl(id)` |
| `public/js/core/poseThumb.js` | **new** — `poseThumbnail(url, size)` |
| `public/js/core/silhouette.js` | `setMask(url)` |
| `public/js/hide/hideApp.js` | pose state, row build, switch handler, `silhouetteId` |
| `public/hide.html` | `.place-grid` markup + CSS, `Lock Position` |
| `server/gameRules.js` | `SILHOUETTE_IDS` |
| `server/routes/hides.js` | validate `silhouetteId`, 400 on unknown |
| `tools/check-mask.js` | all assets + list-parity assertion |
| `public/js/seek/seekApp.js` | optional: import the shared `silhouetteUrl` instead of its private copy (`:72`) — keeps the permissive fallback, removes the third definition |

---

## Step 9.2 — Feature B: paint panel

Reference: `docs/img-ref/UI_2_1.png`.

### 9.2.1 Target layout

```
┌─ .panel ─────────────────────────────────────────────┐
│  Color                    │  Paint Here              │
│  ▪▪▪▪▪  (5 swatches)      │  ┌────────────────────┐  │
│  ▪▪▪▪▪  (5 swatches)      │  │                    │  │
│  Brush                    │  │   white bg +       │  │
│  ●━━━━━━━━━━━             │  │   painted body     │  │
│  Eyedropper    Edge       │  │                    │  │
│  (◍)  ●     [ Hard  ⌄ ]   │  └────────────────────┘  │
│  ┌──────────┐             │                          │
│  │  Review  │             │                          │
│  └──────────┘             │                          │
└──────────────────────────────────────────────────────┘
```

| Element | Target |
|---|---|
| Panel | `display:grid; grid-template-columns:1fr 1fr; gap:14px`, `min-width:0` on both children; background `rgba(243,243,241,.94)` per §4.4 |
| `Color` / `Paint Here` | 17 px / 700, `#16181a` |
| Swatch grid | `repeat(5, 1fr)`, gap 8 px, `aspect-ratio:1`, radius 8 px, ~23 px at 360 px viewport |
| `Brush` / `Eyedropper` / `Edge` | 14 px / 600, `#3a4146`, **above** their control (unlike PLACE) |
| Eyedropper + current colour | two ~22 px circles, side by side |
| `Edge` select | white, `border:1px solid #d2d4cf`, radius 8 px |
| `Review` | primary, left column only, not full width |
| Preview canvas | `width:100%; aspect-ratio:1; background:#fff; border:1px solid #e2e3df; border-radius:6px` |

`Review` keeps its id. The Thai row labels (`สีเด่น`, `ที่ดูดมา`) disappear with
their rows; `#palette-note`'s Thai fallback strings become English (§3, D7).

The mock's top bar reads *"Maker found."* — that is a typo in the mock.
`hideApp.js:123` already sets **`Marker found.`**; keep the correct spelling.

### 9.2.2 Colour — two rows only (task 2.1)

- `extractPalette(sampler.data, sampler.W, sampler.H)` defaults to `n = 8`
  (`public/js/core/palette.js:54`). Call it with **`n = 10`** so a 5-column grid
  fills exactly two rows. `FALLBACK_PALETTE` (`:18`) already has exactly 10.
- **Delete the zone row**: `#palette-zone` (`hide.html:36`, CSS `:22`), the
  `gridPalette` import and call (`hideApp.js:27,196-197`), and `ZONE_GRID`
  (`:35`). Keep `gridPalette` exported from `palette.js` — `tools/check-palette.mjs`
  covers it and removing it would break a green test for no gain.
- **Delete the picked row**: `#palette-picked` (`hide.html:37`), `PICKED_MAX`
  (`:36`), the `picked` array and `addPicked`'s row rendering (`:179-187`).
  `addPicked(color)` collapses into `selectColor(color, null)` — the eyedropped
  colour becomes the current colour and shows in the `#current-color` dot, which
  is what the mock shows. **Cost, accept knowingly:** the hider loses the
  most-recent-6 memory; re-picking from the marker is one tap.
- `extractPalette` drops near-duplicates rather than padding (`:88-92`), so a
  near-flat marker can yield fewer than 10 swatches and leave the second row
  short. That is honest — do not pad it out with repeats.

### 9.2.3 Paint into the preview canvas (task 2.2) — the core change

Today a finger on the **AR canvas** paints (`hideApp.js:246-284`). After this
phase, a finger on the **preview canvas** paints, and the AR canvas keeps only
the eyedropper tap.

**What the preview shows.** The paint canvas *is* mesh-UV space (512², square,
upright). So the preview is a direct blit of it, masked by the pose:

```
white fill  →  drawImage(paintCanvas)  →  destination-in  →  drawImage(maskAlpha)
```

Build `maskAlpha` once per pose — a 512² canvas whose alpha is the mask's green
channel — with the **same helper as the thumbnails** (`poseThumb.js`, called at
`paintRes` instead of 64). Compose on an offscreen `body` canvas, then draw
`white` + `body` into the visible preview; compositing straight onto the visible
canvas would flash white-only frames mid-composite.

**Coordinates.** No ray picking, no `localToMeshUV`:

```js
const r = previewCanvas.getBoundingClientRect();
uv.x = (event.clientX - r.left) / r.width;
uv.y = 1 - (event.clientY - r.top) / r.height;      // three's v=0 is the bottom
```

**Decision to state loudly (§3, D3):** the preview is **texture space, not screen
space**. The figure stands upright even when the mesh is rotated 90° on the
marker. The mock shows exactly this. Rotating the preview to match the AR view
would make the brush feel right-handed but would put the drag direction at odds
with the stroke direction under `rot ≠ 0`. Upright wins; it is also what the
saved PNG looks like.

**Handlers.** `bindPointer(previewCanvas, …)` — a second, independent binding.
`bindPointer` sets `touch-action:none` itself (`pointer.js:2`), which the canvas
needs since `.panel` is `pointer-events:auto` inside a `pointer-events:none` HUD.

```js
bindPointer($('paint-preview'), {
  start(e) { if (state.mode !== 'PAINT' || state.tool !== 'BRUSH') return;
             toPreviewUV(e, meshUv); if (mask.isBody(meshUv.x, meshUv.y)) brush.start(meshUv); },
  move(e)  { if (state.mode !== 'PAINT' || state.tool !== 'BRUSH') return;
             toPreviewUV(e, meshUv);
             if (meshUv.x >= 0 && meshUv.x <= 1 && meshUv.y >= 0 && meshUv.y <= 1) brush.move(meshUv); },
  end()    { brush.end(); },
});
```

The `mask.isBody` gate on `start` and the `[0,1]` gate on `move` are carried over
unchanged from `:257` and `:275` — same rules, new input device. Note that
`session.visible` is deliberately **not** checked here: painting the preview must
work while the marker is out of frame (§3, D4).

The AR-canvas binding loses its PLACE-and-PAINT branching in `start`/`move` and
keeps only `placement` for PLACE plus the eyedropper tap in `end` (`:282`).

**Redraw path.** Both surfaces must update from one signal. `createBrush` already
takes a `markDirty` callback (`hideApp.js:138`). Extend it:

```js
const brush = createBrush(silhouette.pctx, silhouette.paintRes, () => {
  state.dirty = true;            // AR: consumed by session.onFrame (:286-290)
  requestPreviewRedraw();        // HUD: rAF-coalesced, independent of the AR loop
});
```

`requestPreviewRedraw` must be its own `requestAnimationFrame` coalescer and
**must not** hang off `session.onFrame`: that loop only ticks once the camera has
started, and the HUD is live before then. Also call it after `fillBase()`, after
a pose switch, and once when entering PAINT.

**Sizing.** Set the canvas backing store to `clientWidth * devicePixelRatio`
(capped at, say, 2) on entering PAINT and on `resize`, or the 512² source blits
into a blurry 163 px box. Redraw after any resize.

### 9.2.4 Eyedropper — unchanged, and why

The eyedropper still samples the **marker image through the AR view**
(`hideApp.js:224-237`), because that is the whole point of it: it reads the
pixels the seeker will actually see, at the spot the hider is aiming at. It
cannot move into the preview — the preview shows the *silhouette*, not the
marker. The mock agrees: the pipette sits in the HUD, but there is nothing to
sample inside "Paint Here". Behaviour after a pick is unchanged: switch back to
`BRUSH`, set the current colour.

One consequence to keep: with painting moved off the AR canvas, a tap on the AR
view in PAINT mode now does *nothing* unless the eyedropper is armed. Status text
should say so when the hider first enters PAINT — `STATUS.PAINT` (`:59`) becomes
something like `Paint on the preview. Use the eyedropper to pick marker colours.`

### 9.2.5 Files touched — Feature B

| File | Change |
|---|---|
| `public/hide.html` | two-column `.paint-only`, preview canvas, drop zone/picked rows, English labels |
| `public/js/hide/hideApp.js` | `n=10`, drop `gridPalette`/`ZONE_GRID`/`PICKED_MAX`/`picked`, preview build + redraw + pointer binding, AR-canvas handlers trimmed, `STATUS.PAINT` |
| `public/js/core/poseThumb.js` | reused at `paintRes` for the mask-alpha canvas |
| `public/js/core/silhouette.js` | `BASE_COLOR` → `#b1b1b1` (D9 / §4.1) |

---

## Step 9.3 — Cleanup carried along

- B4 naming: `package.json` name, `hide.html` `<title>`, share `title`.
- `docs/plan.md` — Phase 9 section pointing at this file. **Already done** as part
  of authoring this spec; do not repeat it. Phase 8's text stays untouched.

## Step 9.4 — Balance instrumentation (from D11)

The owner chose to adjust balance for four poses. This step builds the only thing
that makes that possible and **stops short of tuning anything**.

### 9.4.1 Per-pose aggregate query

`statsFor` answers "how did *this hide* go". Rebalancing needs "how does *this
pose* go, across every hide that used it". `seeks` has no `silhouette_id` of its
own — it joins through `hides` (`server/db.js:47-53`), which is enough:

```sql
SELECT h.silhouette_id                       AS poseId,
       count(*)                              AS attempts,
       sum(s.found)                          AS found,
       avg(s.taps_used)                      AS avgTaps,
       avg(s.duration_ms)                    AS avgDurationMs,
       count(DISTINCT h.id)                  AS hides
FROM seeks s JOIN hides h ON h.id = s.hide_id
GROUP BY h.silhouette_id
ORDER BY attempts DESC;
```

Expose it as `GET /api/stats/poses`. Keep it a plain read with no parameters —
this is a PoC instrument, not an analytics product (same restraint as
`plan-phase7.md:207`). Round `foundRate` the way `seekStats.js:8` already does so
the two surfaces agree.

Reuse it rather than inventing a second shape: `statsFor` and this query should
return the same field names for the fields they share (`attempts`, `found`,
`foundRate`, `avgTaps`).

### 9.4.2 Surface it

Add a small table to `stats.html` — pose id, attempts, hides, found rate, average
taps — below the existing per-hide view. One `<table>`, no chart. The point is to
be able to read the numbers, not to present them.

### 9.4.3 What NOT to do in this phase

- **Do not** set a per-pose `MAX_TAPS`. It is global today
  (`server/gameRules.js:1`) and must stay global until the table above has real
  rows. A per-pose allowance also means the seeker's pre-flight
  `GET /api/hides/:id` has to carry it — which F7-3 already made server-authoritative
  (`plan-phase7.md:87-89`), so the seam exists when it is needed.
- **Do not** give `human_c` a different default scale to "compensate" for its
  wide footprint. The clamp already communicates the limit (§6).
- **Do not** treat the two seek rows on record as a baseline. After B5 they belong
  to `human_default`, a pose nobody can select. Balancing starts from zero.

**Exit criterion for the rebalance itself (a later change, not this one):** at
least ~20 attempts per pose across more than one marker. Below that, found-rate
differences between poses are noise, and tuning on noise is worse than not tuning.

---

# 3. Decision register

| # | Decision | Rationale |
|---|---|---|
| **D1** | Pose is chosen in **PLACE only** | There is no PAINT → PLACE path in the mode machine (`hideApp.js:294-298`), so pose can never change after paint exists. Keeps §9.1.4 step 5 free. If a "back" button is ever added, this decision must be re-opened *before* it ships. |
| **D2** | Pose switch keeps scale/rotation, re-clamps position | The hider has already dialled in a size; throwing it away on every pose tap makes comparison impossible. Position is the only value that can become illegal. |
| **D3** | Preview is **texture space**, upright, unrotated | Matches the mock and the saved PNG. A rotated preview desynchronises drag direction from stroke direction. |
| **D4** | Preview painting works while the marker is out of frame | The AR-canvas path required `session.visible` because a ray needs a tracked anchor. The preview needs no anchor. Removing the gate is a real usability gain: the hider can keep painting when tracking drops. |
| **D5** | Picked-colour row removed, eyedrop → current colour | The mock has no picked row. Cost is a 6-slot memory, recovered by one re-pick. |
| **D6** | `human_default.png` kept, not selectable | It is the generator's output and the historical default. Adding it to the picker would make five poses where the design says four. |
| **D7** | English strings on both panels touched here | The mocks are in English, and `plan-phase5/7` + `README` are English. `seek.html` stays Thai for now — the mixed-language UI is a real inconsistency and is listed as a follow-up, not silently "fixed" halfway. |
| **D8** | One pose list, drift caught by `npm test` | Direct application of the F7-3 lesson (`plan-phase7.md:79-89`): a client/server constant pair that gates validation fails *after* the user's work is done. |
| **D9** | `BASE_COLOR` `#8a7a5e` → `#b1b1b1` | Owner decision, 2026-08-13. Matches the mock exactly; makes unpainted area obvious to the hider. Full reasoning and the accepted cost in §4.1. |
| **D10** | Pose buttons render the real silhouettes | Owner decision, 2026-08-13. The mock's glyphs are placeholders. §9.1.2 unchanged. |
| **D11** | Rebalance from per-pose data, and build the query first | Owner decision, 2026-08-13. Four poses are not one pose; but no per-pose attempt data exists, so Step 9.4 adds the instrumentation and explicitly refuses to pre-tune. |
| **D12** | Ship `#e44a24`, not the mock's `#d45535` | One orange used everywhere beats a truer orange on one page. A global swap is its own change. §4.4. |
| **D13** | Migrate pre-Phase-9 rows to `human_default` before the picker ships | Their paint was made for the old shape; leaving them on `human_a` silently ruins camouflage the hider tuned by eye. B5. |

# 4. Answers received — 2026-08-13

All three open questions were answered by the product owner. They are now D9–D11
in the register above; the reasoning and the work they create is here.

## 4.1 Unpainted body colour → grey, per the mock

Sampled from `UI_2_1.png`: the figure is a flat **`#b1b1b1`** on a `#ffffff`
preview ground. So `BASE_COLOR` (`public/js/core/silhouette.js:16`) changes
`#8a7a5e` → `#b1b1b1`.

**Where this actually lands.** `createSilhouette` fills the paint canvas with
`BASE_COLOR` once (`:34-35`), so it is the colour of every not-yet-painted pixel.
It shows in exactly two places:

- the new HUD preview, and
- the silhouette on the marker through the camera, in hide mode.

It does **not** reach seek mode. `loadPaint` (`:71-83`) draws the saved PNG over
the whole 512² canvas before the first frame, and a failure there rejects `boot()`
rather than falling back — so a seeker never sees the base colour.

**The trade-off, stated plainly.** `#8a7a5e` was an earthy mid-tone chosen to be
inoffensive against a typical marker; `#b1b1b1` is lighter and more neutral, so a
*partially* painted hide reads more strongly against the marker. That cuts both
ways and, on balance, in our favour:

- ✅ unpainted area is now obvious to the hider — "I missed a spot" is visible at
  a glance instead of blending into the camouflage and shipping half-done
- ✅ the preview matches the mock, and the preview is the whole point of §9.2.3
- ⚠️ a hider who saves early ships an easier hunt than they would have before

Accepted knowingly. The mitigation is the hider's own eyes, which is the design
premise this PoC already rests on (`plan.md:310`).

## 4.2 Pose buttons → real silhouettes, confirmed

§9.1.2 stands as written: thumbnails are generated from the actual pose PNGs, not
from the mock's placeholder glyphs (circle / square / triangle / arch). No change
to the plan; the ambiguity is closed.

## 4.3 Game balance → adjust (new Step 9.4)

The owner chose to rebalance rather than assume four poses play like one. This
adds real work, because **the data needed to rebalance does not exist yet**:

- `statsFor` (`server/seekStats.js:3-11`) aggregates per *hide*. There is no query
  that groups by `silhouette_id`, so "is `human_c` easier to find than `human_b`"
  is currently unanswerable.
- `MAX_TAPS` is a single global (`server/gameRules.js:1`) applied to every hide
  regardless of pose.
- The two seek rows on record predate poses entirely, and after B5's migration
  they belong to `human_default` — so the baseline is **n=2 on a pose that is not
  even selectable**. Treat the existing seek data as gone for balancing purposes.

See Step 9.4. The one thing not to do is pre-tune: Phase 7 §7.3 already settled
that (`plan-phase7.md:213-215`), and guessing per-pose difficulty before any
attempts exist would repeat exactly the mistake that rule was written to prevent.

## 4.4 Colour audit — mock vs. shipped theme

Sampled from both mocks with a lossless decode, so these are the designer's
literal values, not screenshots of the running app.

| Token | Mock | Light theme on `main` | Verdict |
|---|---|---|---|
| Primary / buttons | `#d45535` | `#e44a24` | **Discrepancy — see below** |
| Panel background | `#f3f3f1` (opaque) | `rgba(255,255,255,.94)` | Adopt `rgba(243,243,241,.94)` on the two panels in scope |
| Preview ground | `#ffffff` | — (new) | Use as specified |
| Unpainted body | `#b1b1b1` | `#8a7a5e` | Changed per §4.1 |

**The primary is not the same orange.** `#d45535` is consistent across every
button in both mocks — top bar, Lock Position, Review, selected pose — so it is
deliberate, not a rendering artefact. But `#e44a24` is already shipped across
`index`, `upload`, `hide`, `seek`, `stats` and `reward` from the merged PR #1.

**Recommendation: keep `#e44a24` and do not change it in this phase.** Applying
`#d45535` to `hide.html` alone would leave the hider's screen a different orange
from every other page — worse than either colour used consistently. If the owner
wants `#d45535`, it is a one-line-per-page global swap and belongs in its own
change, not buried in a HUD feature. **Flagging, not asking** — this phase ships
`#e44a24` unless told otherwise.

# 5. Verification

**Automated — must be green before review:**

```bash
npm test          # 4 suites; check-mask now covers all 5 assets + list parity
```

New assertions to add:

- `check-mask.js`: the B1 table, per asset.
- `check-mask.js`: `POSE_IDS` (client) === `SILHOUETTE_IDS` (server), and every id
  resolves to a file on disk.
- Consider a small addition to `check-seek.mjs` or a new `check-pose.mjs` for the
  pure part of the preview mapping — `toPreviewUV` is a 4-line function with no
  DOM dependency if the rect is passed in, so it is worth extracting and testing
  (v-flip is exactly the kind of thing that silently paints upside down).

**Migration (B5) — on a COPY of a real `data/app.db`, never the original:**

```bash
cp -r data data-backup                       # do this first, every time
node -e "…"                                  # or: npm start, then stop it
# expected after one boot:
#   SELECT silhouette_id, count(*) FROM hides GROUP BY silhouette_id;
#     human_default | 7
#   PRAGMA user_version; -> 1
# boot a second time: counts unchanged, user_version still 1
```

Then open one of those migrated hunts on a phone and confirm the paint still
lines up with the body — that is the only check that proves the migration did
what it was for.

**API:**

```bash
curl -s -X POST localhost:3000/api/hides -H 'Content-Type: application/json' \
  -d '{"markerId":1,"silhouetteId":"human_z","transform":{"x":0,"y":0,"rot":0,"w":.3,"h":.3},"paintDataUrl":"data:image/png;base64,…"}'
# → 400, not a persisted broken hunt
curl -s -X POST … -d '{… "silhouetteId":"human_default" …}'   # → 400: readable, not writable (D6)
curl -s localhost:3000/api/hides/<id> | grep silhouetteId     # round-trips the chosen pose
curl -s localhost:3000/api/stats/poses                        # 9.4.1 — one row per pose seen
```

**Device — the parts a Node suite cannot reach:**

1. PLACE: tap each of the four poses — the mesh shape changes on the marker, the
   button state follows, scale/rotate keep their values.
2. Select `human_c` (the wide one) at a large scale — *Too large to hide* appears
   and Lock is disabled; scale down and it clears.
3. Double-tap two poses fast — no flicker, no stale mask, the last tap wins.
4. PAINT, before any stroke: the body reads as flat grey `#b1b1b1` in **both** the
   preview and on the marker (D9). If the two differ, the preview is lying and
   §9.2.3's composition is wrong.
5. PAINT: paint in the preview — colour appears **in the preview and on the
   marker** in the same frame.
6. Point the camera away from the marker and keep painting — the preview still
   works (D4).
7. Eyedropper: pick from the marker, paint in the preview with the picked colour.
8. Rotate the silhouette 90° in PLACE, then paint — the preview stays upright and
   the stroke lands where the finger went (D3).
9. Save, open the hunt on a second phone — the seeker sees the **same pose** and
   the same paint.
10. Open a **pre-Phase-9 hunt** (migrated by B5) — its paint still lines up.
11. Regression, carried forward from Phase 7: shake the phone hard while pointing
    at the marker — the silhouette stays locked to the backdrop.

# 6. Out of scope

| Excluded | Why |
|---|---|
| Pose after paint / undo | D1 keeps the mode machine linear; undo is a bigger feature than this phase |
| Eraser | The paint canvas is opaque by invariant; an eraser means "repaint with base", worth doing but not here |
| Per-pose default scale | Tempting for `human_c`, but the clamp already communicates the limit |
| Per-pose `MAX_TAPS`, or any tuning | D11 / §9.4.3 — build the query, collect attempts, then decide |
| New pose art | Four is the brief |
| Translating `seek.html` | D7 — a language pass is its own change |
| Global `#e44a24` → `#d45535` swap | D12 — a rebrand across six pages, not a HUD change |
| Phase 8 white balance | Still gated on the two-lighting device test (`plan.md:293-297`) |

# 7. Order and estimate

| # | Step | Blocks | Est. |
|---|---|---|---|
| 1 | 9.0.1 `check-mask.js` rewrite | everything | 45 min |
| 2 | 9.0.2 generator repoint | — | 5 min |
| 3 | **9.0.3 `user_version` migration (B5)** | **must precede 6** | 25 min |
| 4 | 9.1.5 server allowlist + list module | 9.1.3 | 20 min |
| 5 | 9.1.2 `poseThumb.js` | 9.1.4, 9.2.3 | 40 min |
| 6 | 9.1.1 PLACE markup + CSS | — | 30 min |
| 7 | 9.1.3–9.1.4 pose state + switching | 3, 4, 5 | 60 min |
| 8 | 9.2.1–9.2.2 PAINT markup, CSS, palette trim, `BASE_COLOR` | — | 45 min |
| 9 | 9.2.3 preview canvas + pointer rebind | 5, 8 | 90 min |
| 10 | 9.4 per-pose stats query + table | — | 45 min |
| 11 | 9.3 cleanup | — | 10 min |
| 12 | Verification pass (§5) | all | 70 min |

Steps 1–3 are the gate; **3 is the one with a deadline** — once a real `human_a`
can be written, old rows are indistinguishable from new ones and the migration
becomes guesswork. Steps 6, 8 and 10 are independent and can run in parallel with
4–5 if more than one person is on this.
