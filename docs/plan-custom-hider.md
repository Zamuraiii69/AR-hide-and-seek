# Custom Hider — per-marker player-supplied silhouette

Written in English to match `plan-phase5.md` / `plan-phase7.md` / `plan-phase9.md`.

| | |
|---|---|
| **Author** | tech lead (spec + execution plan)
| **Date** | 2026-08-21 |
| **Branch** | `feat/custom-hider`, off `main` @ `cccda2f` |
| **Depends on** | Phase 9 merged (pose row, `human_default` migration at `server/db.js:69`) |
| **Does not touch** | Phase 8 white-balance gain; the seek rules (`MAX_TAPS`); the reward/demo flow |

Every `file:line` below was read on `main` @ `cccda2f`, not remembered.

---

## 1. What we are building

A marker creator can tick **"Use a custom hider"** on the Create Marker page and
upload one image. That image becomes the *only* silhouette anyone can hide with
at that marker. Markers without it keep the four built-in poses exactly as
today.

**Confirmed with the product owner:**

| Question | Decision |
|---|---|
| Arbitrary uploads vs. strict asset contract | **Normalise in the browser** — accept any raster image, convert to the white-on-black 1024² mask the engine needs |
| Converted file fails the mask contract | **Block on the client before submit** — show the preview, the coverage number and the reason; the marker is never created half-configured |
| Editable after creation | **Set once, at creation time.** No edit/delete endpoint |
| Pose id written into `hides` | **`custom_1`** — indexed, so `custom_2..N` can be added later without a migration |
| Number of custom slots | **1 for now.** `MAX_CUSTOM_POSES = 1`; raise it after playtesting |

---

## 2. Why this is not a small change

The knowledge "which silhouette ids are legal, and what URL does each resolve
to" is currently duplicated across **four** places, all of which assume every
pose id is an asset *we* ship:

| Location | What it hardcodes |
|---|---|
| `public/js/core/poses.js:12,15` | `POSE_IDS` + `/assets/silhouettes/${id}.png` |
| `server/gameRules.js:8` | `SILHOUETTE_IDS` (deliberate CJS/ESM mirror — Decision D8) |
| `server/routes/hides.js:21-22` | default `'human_a'` + `SILHOUETTE_IDS.includes()` gate |
| `public/js/seek/seekApp.js:71-74` | its own `silhouetteUrl()` with a regex and a `'human_a'` fallback |

A per-marker silhouette breaks that assumption in all four. The design's core
move is to **collapse this into one server-side module and have the server hand
clients a resolved pose list**, so neither client keeps id-to-URL logic.

Second duplication to resolve: the mask contract (bimodal >= 95 %, coverage
3–45 %, bbox inside [0,1]) lives only inside `tools/check-mask.js` today,
together with a PNG decoder. The new upload route must enforce the same
contract. Two copies of it would drift, so the decoder and the contract get
extracted first.

---

## 3. Architecture — Approach A (chosen)

Rejected alternatives, for the record:

- **B — a `marker_silhouettes(marker_id, slot, path)` table.** Natively N
  poses, but there is one slot today. Extra join and CRUD for capability we do
  not use. Extending A to N poses is "write `-pose-2.png`, bump the count" — no
  migration — so B buys nothing now.
- **C — write uploads into `public/assets/silhouettes/custom_<id>_1.png`.**
  Rejected: user content inside the static app directory, `tools/check-mask.js`
  globs that whole directory and would fail on every upload, and no cache
  versioning.

### 3.1 Schema — one column

`server/db.js`, in the `CREATE TABLE markers` block:

```sql
custom_pose_count INTEGER NOT NULL DEFAULT 0   -- 0 = built-in poses; N = custom_1..custom_N
```

and a guarded migration next to the existing one at `server/db.js:69`:

```js
if (db.prepare('PRAGMA user_version').get().user_version < 2) {
  const cols = db.prepare('PRAGMA table_info(markers)').all().map((c) => c.name);
  if (!cols.includes('custom_pose_count')) {
    db.exec('ALTER TABLE markers ADD COLUMN custom_pose_count INTEGER NOT NULL DEFAULT 0');
  }
  db.exec('PRAGMA user_version = 2');
}
```

The `table_info` guard is required, not defensive noise: a fresh database gets
the column from `CREATE TABLE`, so an unguarded `ALTER` would throw
`duplicate column name` on first boot.

New prepared statement: `stmt.markers.setPoseCount`.

### 3.2 Storage — parallel to the existing marker binaries

```
data/media/markers/:id.png            existing — source marker image
data/media/markers/:id.mind           existing — compiled MindAR target
data/media/markers/:id-pose-1.png     NEW     — custom silhouette, slot 1
```

`server/storage.js` gains `markerPosePath` / `markerPoseRelPath` /
`markerPoseUrl` `(id, slot)`, reusing `writeAtomic` and `versionedUrl`
unchanged.

**`slot` arrives from the URL and is interpolated into a filesystem path.** It
must be validated as an integer in `1..MAX_CUSTOM_POSES` *before* it reaches
`path.join`. This is the one path-traversal surface the feature adds.

### 3.3 `server/markerPoses.js` — the single source of truth (new)

Two functions with deliberately different jobs:

| Function | Called when | Returns |
|---|---|---|
| `posesFor(markerRow)` | **offering** choices to a new hider | `[{ id, url, label }]` — `custom_1..N` when `custom_pose_count > 0`, otherwise the four built-ins in `SILHOUETTE_IDS` order |
| `resolveSilhouetteUrl(markerRow, id)` | **reading back** a saved hide | a URL, or `null` if `id` is not legal for this marker |

They are separate because `human_default` is **readable but not selectable** — a
legacy id from the Phase 9 migration (`server/db.js:69`, explained at
`public/js/core/poses.js:3-7`). `posesFor` must never offer it;
`resolveSilhouetteUrl` must still serve it so old hunts keep rendering. The
codebase states this distinction in a comment today; this module makes it
executable.

`resolveSilhouetteUrl` returns `null` for anything not on the allow-list, which
covers both corrupt rows and hostile ids — no regex sanitising, no fallback
guess. That deletes `seekApp.js:71-74` outright.

`MAX_CUSTOM_POSES = 1` lives here.

`posesFor` trusts `custom_pose_count` and does **not** stat the file. That is
safe because the route writes the PNG atomically *before* it increments the
count (§3.5), so a non-zero count always has a file behind it. Contrast this
with `targetState()` (`server/routes/markers.js:41`), which does stat the
`.mind` — that check exists because a truncated `.mind` is a real failure the
compiler can produce, not because the write is unordered. Do not copy that
pattern here without a reason.

### 3.4 `server/pngDecode.js` + `server/maskContract.js` (new, extracted)

Move the PNG decoder at `tools/check-mask.js:8-56` (row filters 0–4, colour
types 0/2/4/6, 8-bit, non-interlaced) into `server/pngDecode.js`, and the
assertions at `tools/check-mask.js:100-133` into `server/maskContract.js`:

```js
validateMaskBuffer(buffer) -> { ok, coverage, bimodalRatio, bbox, error }
```

Thresholds unchanged: bimodal >= 0.95, coverage 3–45 %, bbox non-empty and
inside [0,1]. `tools/check-mask.js` then requires both and becomes a thin driver
over `public/assets/silhouettes/*.png`.

**Do this extraction first, as its own commit, with `npm test` green and no
behaviour change** — it keeps the feature diff readable.

### 3.5 API

| Endpoint | Change |
|---|---|
| `PUT /api/markers/:id/pose/:slot` | **new** — raw `image/png`, max 1 MB |
| `GET /api/markers/:id` | `toDetail` (`server/routes/markers.js:71`) gains `poses: [{id, url, label}]` |
| `GET /api/markers` | `toSummary` (`:56`) gains `customHider: boolean` |
| `POST /api/hides` | `server/routes/hides.js:21-22` — default becomes `posesFor(marker)[0].id` instead of `'human_a'`; the gate becomes membership in `posesFor(marker)` instead of the global `SILHOUETTE_IDS` |
| `GET /api/hides/:id` | response (`:64-66`) gains `silhouetteUrl` |
| `GET /api/markers/:id/hides` | each row (`:176`) gains `silhouetteUrl` |

The `POST /api/hides` change is what actually enforces *"a hider at this marker
gets the custom hider and nothing else"*. Hiding the picker in the UI is
cosmetic; this is the rule.

**`PUT /api/markers/:id/pose/:slot` contract**

| Status | Condition |
|---|---|
| `204` | file written, *then* `custom_pose_count` set to `slot` — in that order |
| `404` | marker does not exist |
| `409` | `custom_pose_count >= slot` — **this is the "set once" rule**, enforced server-side |
| `409` | the marker already has hides (`stmt.markers.hideCount > 0`) — unreachable through the normal flow, but the API is open |
| `400` | not a PNG / not square / edge outside 256–1024 / fails `validateMaskBuffer`, with the measured numbers in the message |

Body limit is 1 MB: a normalised 1024² two-tone PNG compresses to roughly
20–60 KB, so 1 MB is generous and still far under the 8 MB marker-image cap.

### 3.6 Upload ordering closes the only race

```
POST /api/markers               -> pending row
PUT  /api/markers/:id/pose/1    -> NEW, goes first
PUT  /api/markers/:id/image
PUT  /api/markers/:id/target    -> the call that flips status = 'ready'
```

`POST /api/markers` is **unchanged** — it carries no `customHider` flag. The
checkbox exists only in the browser; the server learns about a custom hider from
the `PUT /pose/1` call itself, which is also what sets `custom_pose_count`. One
fact, one writer.

`target` is already the step that makes a marker playable
(`server/routes/markers.js:139-141`). Putting the pose upload ahead of it means
**a marker can never be `ready` with a half-configured custom hider** — a failed
pose PUT aborts the flow before the marker is playable. No new readiness rule,
no extra state.

---

## 4. Client — normalisation and validation

### 4.1 Two modules, split the way `previewUv.js` was split

**`public/js/core/maskNormalize.js` — pure, no DOM, therefore testable in Node**

```js
export const MASK_RES = 1024;
export const MASK_LIMITS = { minCoverage: 3, maxCoverage: 45, minBimodal: 0.95 };
export function otsuThreshold(histogram);
export function maskFromRgba(rgba, res);   // -> { bytes, coverage, bimodalRatio, bbox, source }
```

**`public/js/core/maskFile.js` — thin DOM glue**

```js
export async function normalizeMaskFile(file);
// -> { blob, previewDataUrl, coverage, bimodalRatio, bbox, source, ok, error }
```

`uploadApp.js` calls only the second one and never touches a pixel.

### 4.2 Algorithm

```
createImageBitmap(file)
  -> clearRect, then contain-fit draw into a 1024² canvas (aspect preserved, centred)
  -> getImageData
  -> if the file has real alpha (any pixel a < 250):  body = alpha > 127            [primary path]
     else:                                            body = Otsu + border-ring vote [fallback]
  -> write body = (255,255,255,255), background = (0,0,0,255)   // 100 % opaque, same as the shipped assets
  -> canvas.toBlob('image/png')
```

**Border-ring vote** is what makes the fallback path explainable: the outermost
1-px ring is background by definition. If that ring is bright, the subject is the
dark region (ink on paper); if it is dark, the subject is the bright region (the
format `human_a`–`human_d` already use). Otsu supplies the threshold instead of a
hardcoded 128, so grey line art and low-contrast scans still resolve.

Contain-fit — not stretch — is required: a 500 × 1000 upload stretched to square
would deform the body, and the resulting hit test would not match what the player
drew.

### 4.3 What the client check actually catches

After normalisation the output contains only 0 and 255, so **`bimodalRatio` is
100 % by construction**. The bimodal rule catches nothing on the normal path; it
exists for buffers posted straight to the API. State this plainly rather than
letting a reader assume the client check is stronger than it is.

The rules that bite on the client are coverage and a non-empty bbox:

| Result | Message (Thai, user-facing) | Submit |
|---|---|---|
| coverage < 3 % | "รูปทรงเล็กเกินไป (1.2%) — ลองครอปให้ตัวเต็มเฟรมกว่านี้" | blocked |
| coverage > 45 % | "รูปทรงใหญ่เกินไป (58%) — เกมจะหาง่ายเกิน ลองครอปให้เหลือแค่ตัวคน" | blocked |
| empty bbox | "อ่านรูปทรงจากไฟล์นี้ไม่ได้ — ลองใช้ PNG พื้นหลังโปร่งใส" | blocked |
| pass | preview + coverage % shown | allowed |

### 4.4 Threshold parity across the CJS/ESM boundary

`MASK_LIMITS` (browser ESM) and `server/maskContract.js` (CommonJS) cannot share
an import — the same constraint that forces `POSE_IDS` / `SILHOUETTE_IDS` to be
two declarations (Decision D8). Follow the existing remedy: declare both, and add
a parity assertion to `tools/check-mask.js` alongside the POSE_IDS one at
`tools/check-mask.js:159-164`.

---

## 5. Client — UI

### 5.1 `public/upload.html` — below the Marker image field

```
+- Marker image --------------------------+
| [ Choose file ]                          |
| Use a detailed image...                  |
+------------------------------------------+
+- [x] Use a custom hider -----------------+   <- checkbox
| Anyone hiding at this marker will use     |
| this shape only - no other poses.         |
+------------------------------------------+
+- Hider silhouette ------------- [hidden] +   <- revealed by the checkbox
| [ Choose file ]  transparent PNG works best|
|  +----------+   Coverage   17.3 %         |
|  | (shape)  |   Size       1024 x 1024    |
|  | preview  |   Source     alpha channel  |
|  +----------+                             |
|  ! error line                             |
+------------------------------------------+
```

**The preview shows the normalised mask (white on black), not the original
file.** The player must see the shape *the game will use*; showing their source
image would hide exactly the failure this feature is most likely to produce.

- `accept="image/png,image/jpeg,image/webp"` — not `image/*`. SVG decoding
  through `createImageBitmap` is unreliable on iOS Safari.
- `setBusy()` (`public/js/uploadApp.js:37`) gains
  `submit.disabled ||= (customOn && !validMask)`.
- Unticking the checkbox clears the stored blob and metrics, so an abandoned
  attempt can never be uploaded.

### 5.2 `public/js/hide/hideApp.js` — stop knowing about poses

| Today | Becomes |
|---|---|
| `import { POSE_IDS, silhouetteUrl }` (`:28`) | removed — read `marker.poses` |
| `DEFAULT_POSE = POSE_IDS[0]` (`:37`) | `marker.poses[0].id` |
| `loadMask(silhouetteUrl(state.pose))` (`:101-102`) | `loadMask(marker.poses[0].url)` |
| `for (const id of POSE_IDS)` (`:208`) | `for (const pose of marker.poses)` |
| `poseLetter(id)` (`:201`) | dropped — use `pose.label` from the server |
| `poseThumbnail(silhouetteUrl(...))` (`:231`, `:325`) | look the URL up in `marker.poses` |

`poseLetter` splits on `_` and uppercases the tail (`'human_a'` -> `'A'`), which
would render `custom_1` as `'1'`. Rather than special-casing it on the client,
the server sends `label` in the pose descriptor (`"A".."D"`, `"Custom"`).

**When `marker.poses.length === 1`, hide the whole Pose row** — both `#pose-row`
and its `.row-label` at `public/hide.html:36`. A single button that does nothing
when pressed is dead UI. The loop stays generic; only the row's visibility is
conditional.

### 5.3 `public/js/seek/seekApp.js` — deletion only

Delete `silhouetteUrl()` (`:71-74`) entirely, regex fallback included, and use
`hide.silhouetteUrl` from the API. If the server returns `null`, throw a clear
message instead of letting `loadMask` 404 into the generic camera-timeout error
at `:80-84`.

### 5.4 Minor

- `public/index.html` — a "Custom" badge in the marker list, from `customHider`
  in the summary payload.
- `public/js/statsApp.js` — render `custom_1` as "Custom 1".

---

## 6. Testing

The repo runs plain Node scripts through `npm test` (`package.json:8`) with no
test framework. Keep that.

| File | Covers |
|---|---|
| `tools/check-mask.js` *(edit)* | requires `server/pngDecode.js` + `server/maskContract.js` instead of its own copies; adds `MASK_LIMITS` vs `maskContract` parity next to the existing POSE_IDS parity check |
| `tools/check-normalize.mjs` *(new)* | `maskNormalize.js` against synthetic RGBA: alpha path (filled circle -> coverage matches pi*r²); luminance path on both polarities (dark-on-light and light-on-dark) must agree; Otsu on a grey ramp; output contains only 0 and 255; coverage outside limits -> `ok:false` with a reason; fully transparent input does not throw |
| `tools/check-marker-poses.mjs` *(new)* | `markerPoses.js` against fake rows: `count 0` -> four built-ins in order; `count 1` -> `custom_1` alone, URL `/media/markers/:id-pose-1.png`; `resolveSilhouetteUrl(plainRow, 'human_default')` -> a URL (legacy stays readable); `resolveSilhouetteUrl(customRow, 'human_a')` -> `null` (custom-only enforced); `resolveSilhouetteUrl(row, '../../etc/passwd')` -> `null` |
| `tools/check-seek.mjs` | verified: it asserts mask/hit-test geometry, not the `/api/hides/:id` response shape — no change expected |

Add the two new scripts to the `test` script in `package.json`.

**Manual E2E (two phones, over ngrok):**

1. Create a marker *with* a custom hider -> hide -> seek. The seeker's hit test
   must follow the uploaded shape.
2. Create a marker *without* one -> all four poses still selectable, switching
   still works. This is the regression that matters most.
3. Upload a deliberately wide silhouette (like `human_c`, bbox 0.645 wide) and
   confirm `"Too large to hide"` appears at large scale values rather than the
   body escaping the marker. `applyTransform()` at `hideApp.js:591` already
   clamps at boot, so this is a verification, not a fix.
4. Re-open an existing pre-migration hunt and confirm `human_default` still
   renders.

---

## 7. Build order

Each step ends with `npm test` green.

| # | Step | Notes |
|---|---|---|
| 1 | Extract `server/pngDecode.js` + `server/maskContract.js` from `tools/check-mask.js` | pure refactor, zero behaviour change |
| 2 | Schema column + migration + storage paths + `server/markerPoses.js` | plus `tools/check-marker-poses.mjs` |
| 3 | `PUT /api/markers/:id/pose/:slot` | slot validation, 409 rules, `validateMaskBuffer` |
| 4 | Read paths: `poses[]`, `customHider`, `silhouetteUrl`; rewrite the `POST /api/hides` gate | the server-side enforcement of custom-only |
| 5 | `public/js/core/maskNormalize.js` | plus `tools/check-normalize.mjs` |
| 6 | `public/js/core/maskFile.js` + `upload.html` / `uploadApp.js` UI | checkbox, file field, preview, blocking |
| 7 | `hideApp.js` + `seekApp.js` move to server-supplied poses | net deletion on the seek side |
| 8 | `index.html` badge, `statsApp.js` label | |
| 9 | Manual E2E on two phones | |

Steps 3–4 and 5–6 are independent of each other and can be built in parallel;
everything depends on 1–2.

---

## 8. Accepted risks and known gaps

| # | Risk | Position |
|---|---|---|
| R1 | `/api/stats` groups by `silhouette_id` (`server/db.js:127-136`), so `custom_1` merges across every marker | Accepted. Fixing it means adding `marker_id` to the grouping — out of scope, recorded here |
| R2 | No auth, so anyone can `PUT /pose/1` on someone else's marker during the creation window | The system has no ownership model anywhere (`POST /api/hides` is equally open). This adds no new attack surface; closing it requires auth, which is out of scope |
| R3 | A wide custom bbox is rejected by `clampToMarker` at sizes a narrow pose allows | Correct behaviour. Verified already handled — `applyTransform()` runs at boot (`hideApp.js:591`). Covered by E2E case 3 |
| R4 | No moderation of uploaded imagery | Known PoC gap |
| R5 | `createImageBitmap` on SVG is unreliable in iOS Safari | Mitigated by narrowing `accept` to png/jpeg/webp |
| R6 | Player uploads a photo with no alpha and poor contrast; Otsu produces a blob | Caught by the coverage gate and shown in the preview before submit — the player sees the bad shape and picks another file |

---

## 9. Out of scope

- More than one custom pose (`MAX_CUSTOM_POSES = 1` until playtested)
- Editing or deleting a custom hider after creation
- Per-marker stats breakdown for `custom_1`
- Any authentication or ownership model
- Content moderation
