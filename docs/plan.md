# Meccha Chameleon — Web AR Hide & Seek (PoC)

## Context

โปรเจกต์นี้ต้องการสร้างเกมซ่อนหา "Meccha Chameleon" บนเว็บ AR โดยใช้ image tracking:
คนซ่อนวางโมเดลคนลงบนรูป marker แล้วระบายสีให้กลืนไปกับรูป → บันทึกลง DB;
คนหาส่องกล้องไปที่ marker เดียวกันแล้วพยายามแตะหาตัวโมเดลที่ถูกพรางไว้

ในโฟลเดอร์นี้มีของเดิมอยู่แล้ว — **AR Status PoC** (MindAR + three.js + Socket.io)
ซึ่งพิสูจน์แล้วว่า image tracking ทำงานได้ทั้ง iOS Safari และ Android Chrome
เราจะ **ต่อยอดจากฐานนี้** ไม่ใช่เริ่มใหม่: เก็บส่วน MindAR bootstrap + fix จอดำ
แต่ **ลบ Socket.io ทิ้งทั้งหมด** เพราะเกมนี้เป็น asynchronous ผ่าน DB ไม่ต้องมี realtime channel

**ผลลัพธ์ที่ต้องการ:** ระบบ PoC ที่รันได้จริงบนมือถือ 2 เครื่อง — เครื่องหนึ่งซ่อน อีกเครื่องหา
โดยตำแหน่งและ texture ที่ระบายถูกเก็บไว้ที่ server

---

## Decisions (ยืนยันกับผู้ใช้แล้ว)

| หัวข้อ | เลือก |
|---|---|
| โมเดลคน | **Flat silhouette plane** แนบระนาบ marker, unlit (`MeshBasicMaterial`) — เพื่อให้สีที่ระบายตรงกับรูปได้จริง |
| Storage | **`node:sqlite`** (built-in, Node v24.15.0 ยืนยันแล้วว่ามี) + ไฟล์ binary บนดิสก์ |
| Game flow | **Async ผ่าน DB** — ไม่มีห้อง ไม่มี realtime |
| Marker intake | หน้า upload ที่ **compile `.mind` ในเบราว์เซอร์** ด้วย `MINDAR.IMAGE.Compiler` |
| จานสี | **Eyedropper ดูดสีจากรูป marker** + swatch สีเด่นที่ extract อัตโนมัติ |
| กติกาคนหา | **3 ครั้ง**, hit นับเฉพาะเมื่อโดนตัวโมเดลจริง (alpha-aware) |
| ลำดับงาน | **Spike 2 ตัวก่อน** แล้วค่อยสร้างเต็ม |

> `node:sqlite` แทน `better-sqlite3` — ตัดปัญหา native build บน Windows ทิ้งทั้งหมด
> API คล้ายกัน (`DatabaseSync`, `.prepare/.run/.get/.all/.exec`) แต่ **ไม่มี** `db.transaction()` helper
> ต้องใช้ `BEGIN` / `COMMIT` / `ROLLBACK` เอง

---

## ข้อเท็จจริงที่ตรวจสอบแล้วจาก bundle จริง (three r160 / MindAR 1.2.5)

สิ่งเหล่านี้ขัดกับสมมติฐานตั้งต้น — **ต้องทำตามนี้ ไม่ใช่ตามความจำ**:

1. **`Raycaster` ไม่สนใจ `visible:false`** — object ที่ซ่อนอยู่ (และลูกของ group ที่ซ่อน) ยัง raycast โดนอยู่
   → ทุก pointer handler ต้องมี `if (!session.visible) return;` มิฉะนั้นตอน tracking หลุด
   จะได้ hit จาก anchor matrix เก่าค้าง
2. **Compiler global คือ `window.MINDAR.IMAGE.Compiler`** ไม่ใช่ `window.MINDAR.Compiler`
   และ `mindar-image.prod.js` เป็น **ES module** (ต้อง `<script type="module">`)
3. **`compiler.exportData()` คืน `Uint8Array` ที่เป็น view บน shared buffer ที่ใหญ่เกิน**
   → ต้องส่ง `new Blob([bytes])` เท่านั้น; **`bytes.buffer` จะได้ไฟล์ `.mind` เสีย**
   (อาการคือ "target ไม่ถูกตรวจจับเลย" — debug ยากมาก)
4. **Compiler ไม่ downscale ให้** และ feature detection รัน **บน main thread** ผ่าน TFJS
   → ต้อง downscale เอง (≤1024px, ≥512px) ก่อนเรียก
5. **`CanvasTexture.colorSpace` default = `NoColorSpace`** → ต้องตั้ง `SRGBColorSpace` บน paint texture
   แต่ **ห้ามตั้งบน mask** (จะทำให้ขอบ alpha เพี้ยน)
6. **`alphaMap` อ่าน channel สีเขียว** (`texture2D(alphaMap, uv).g`) ไม่ใช่ `.a`
   → asset silhouette เป็น PNG ทึบ ตัวคนสีขาว พื้นดำ; hit test ก็ต้องอ่าน green channel เช่นกัน
7. **`anchor.group.matrixAutoUpdate === false`** และ MindAR **แทนที่ object `group.matrix` ทั้งก้อน**
   → ห้ามเก็บ reference ไว้; ต้อง `updateWorldMatrix(true,false)` ก่อนอ่าน `matrixWorld` ใน pointer handler
8. **ต้อง pin `three` ที่ `0.160.0` เป๊ะ** — MindAR import `sRGBEncoding` ซึ่งถูกลบไปใน r165
9. **`express.json()` default limit = 100kb** → paint dataURL จะ 413 เงียบๆ; ต้องตั้ง `limit:'8mb'`
10. **ไม่มี z-fighting กับ marker** — marker คือ pixel ใน `<video>` ที่อยู่ *หลัง* canvas WebGL
    depth buffer ไม่เคยเห็นมัน → ใช้ `depthTest:false, depthWrite:false` + `renderOrder` แทนการจูน epsilon

---

## Architecture

### Coordinate system (แกนหลักของทั้งระบบ)

MindAR anchor space: **origin = จุดกึ่งกลางรูป, ความกว้างรูป = 1.0 unit, ความสูง = aspect (h/w)**
→ ระนาบรูปกินพื้นที่ `x ∈ [-0.5, 0.5]`, `y ∈ [-aspect/2, aspect/2]`, `z = 0`

เก็บ transform ของ hide เป็น **anchor-local units** (ไม่ใช่ pixel) → hide เดิมจะปรากฏตรงเป๊ะ
บนทุกเครื่อง ทุกกล้อง ทุกขนาดที่พิมพ์ออกมา

### หัวใจเดียวที่ทุกอย่างพึ่งพา — `anchorPick.js`

การกระทำทั้ง 4 อย่างในเกม (ระบายสี / ดูดสี / ลากย้าย / แตะหา) คือ
**การตัดกันของ ray จากนิ้ว กับระนาบ z=0 ใน anchor space** อันเดียวกัน
→ เขียน primitive ตัวเดียว ใช้ซ้ำทั้งหมด **อย่าใช้ `THREE.Raycaster`** (ดูข้อ 1 ข้างบน)

```js
export function pickAnchorPlane(ndc, camera, anchorGroup, out) {
  anchorGroup.updateWorldMatrix(true, false);          // matrixAutoUpdate=false — ต้องบังคับเอง
  _invAnchor.copy(anchorGroup.matrixWorld).invert();
  _origin.setFromMatrixPosition(camera.matrixWorld);
  _dir.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(_origin).normalize();
  _origin.applyMatrix4(_invAnchor);
  _dir.transformDirection(_invAnchor);
  if (Math.abs(_dir.z) < 1e-6) return null;            // ray ขนานกับระนาบ
  const t = -_origin.z / _dir.z;
  if (t <= 0) return null;                             // ระนาบอยู่หลังกล้อง
  return out.copy(_dir).multiplyScalar(t).add(_origin);
}
// + localToMarkerUV(p, aspect)  -> uv บนรูป marker (สำหรับ eyedropper)
// + localToMeshUV(p, mesh)      -> uv บนตัวโมเดล (สำหรับ paint / hit test)
```

### Material ของ silhouette

```js
new THREE.MeshBasicMaterial({
  map: paintTexture,        // CanvasTexture 512² — colorSpace = SRGBColorSpace (บังคับ)
  alphaMap: maskTexture,    // PNG ตัวคนขาว พื้นดำ — คง NoColorSpace ไว้
  color: 0xffffff,          // ใช้เป็น per-channel gain สำหรับ white balance (Phase 8)
  transparent: true, alphaTest: 0.5,
  depthTest: false, depthWrite: false,
  side: THREE.DoubleSide, toneMapped: false, fog: false,
})
```

**Invariant สำคัญ:** paint canvas **ทึบ 100% เสมอ** (เริ่มด้วย `fillRect` สีพื้น)
→ alpha ที่เรนเดอร์ออกมา ≡ green channel ของ mask เป๊ะ
→ hit test ของคนหาจึงอ่านจาก **mask** ไม่ใช่ paint canvas (ถูกต้องแม้จะเพิ่มยางลบทีหลัง)

**`PAINT_RES = 512` ไม่ใช่ 1024** — `CanvasTexture.needsUpdate` ทำ full `texImage2D` re-upload
1024² RGBA = 4 MiB/upload × 60fps = 240 MiB/s → มือถือกลางๆ เฟรมตกตอนระบายสีพอดี
512² = 1 MiB และสูงกว่าความละเอียดจริงบนจอแล้ว

### State machine ของคนซ่อน

```
PLACE  → ลากย้าย + สเกล (ห้ามระบายสี)
  ↓ [ล็อคตำแหน่ง]
PAINT  → ระบายสี + ดูดสีจาก marker (ห้ามย้าย)
  ↓ [ตรวจสอบ]
REVIEW → ปุ่ม peek สลับซ่อน/แสดง เทียบกับกล้องจริง → [บันทึก]
```
บังคับ 2 กฎในที่เดียว: (ก) ทุก handler `return` ถ้า `!session.visible`
(ข) PLACE ไม่ระบายสี / PAINT ไม่ย้าย — เพราะพื้นที่แตะทับกัน 100%
และการเผลอลากตัวที่ระบายไปครึ่งหนึ่งคือความเสียหายที่กู้ไม่ได้

> คุณสมบัติดีที่ควรบอกใน UI: การย้ายตำแหน่ง **ไม่ทำให้สีที่ระบายหาย**
> เพราะสีอยู่ใน UV space ของตัวโมเดลเอง ไม่ใช่ของ marker

### Database

```sql
PRAGMA journal_mode = WAL;  PRAGMA foreign_keys = ON;

CREATE TABLE markers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | ready
  image_path TEXT, mind_path TEXT,
  image_width INTEGER NOT NULL, image_height INTEGER NOT NULL,
  aspect REAL NOT NULL,                        -- h/w — client ต้องใช้ก่อนเฟรมแรก
  palette_json TEXT NOT NULL DEFAULT '[]',     -- สีเด่นทั้งรูป
  grid_json TEXT NOT NULL DEFAULT '[]',        -- สีเฉลี่ยราย cell 4x4
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE hides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marker_id INTEGER NOT NULL REFERENCES markers(id) ON DELETE CASCADE,
  hider_name TEXT, silhouette_id TEXT NOT NULL DEFAULT 'human_a',
  pos_x REAL NOT NULL, pos_y REAL NOT NULL, rot_z REAL NOT NULL DEFAULT 0,
  size_w REAL NOT NULL, size_h REAL NOT NULL,   -- ทั้งหมดเป็น anchor-local units
  paint_path TEXT NOT NULL, paint_res INTEGER NOT NULL DEFAULT 512,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_hides_marker ON hides(marker_id, is_active, created_at DESC);

CREATE TABLE seeks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hide_id INTEGER NOT NULL REFERENCES hides(id) ON DELETE CASCADE,
  seeker_name TEXT, found INTEGER NOT NULL, taps_used INTEGER NOT NULL,
  duration_ms INTEGER, taps_json TEXT NOT NULL DEFAULT '[]',   -- [{u,v,hit}] ทำ heatmap ได้
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_seeks_hide ON seeks(hide_id);
```

### API

```
GET  /api/markers                   → [{id,slug,name,aspect,imageUrl,hideCount}]
POST /api/markers                   {name,imageWidth,imageHeight,palette,grid} → 201 {id,slug,...}
PUT  /api/markers/:id/image         raw image/png                    → 204
PUT  /api/markers/:id/target        raw application/octet-stream     → 204 (status→'ready')
GET  /api/markers/:id               → {..., imageUrl, mindUrl, palette, grid}
GET  /api/markers/:id/hides?pick=random&limit=1

POST /api/hides                     {markerId,transform:{x,y,rot,w,h},paintDataUrl,...} → 201
GET  /api/hides/:id                 → {transform, paintUrl, marker:{aspect,mindUrl,imageUrl}, stats}
POST /api/seeks                     {hideId,found,tapsUsed,durationMs,taps[]} → 201 {stats}

GET  /media/markers/:id.png | .mind   static, immutable
GET  /media/hides/:id.png             static, immutable
GET  /health                          (คงของเดิม)
```

**Marker ใช้ raw `PUT` สองเฟส** (ไฟล์ใหญ่ 0.5–3 MB — base64 พองอีก 33% และ `JSON.parse`
ของ string 5 MB บล็อค event loop) แต่ **hide ใช้ JSON POST ก้อนเดียว** พร้อม dataURL
(ไฟล์เล็กกว่า และได้ atomicity — ไม่มีทางเกิด row ที่ไม่มีไฟล์ paint)

`GET /api/hides/:id` ฝัง `marker` เข้าไปด้วย → คนหายิง network **รอบเดียว**
ก่อนสร้าง `MindARThree` ได้

เขียนไฟล์แบบ atomic เสมอ: `writeFileSync(tmp)` → `renameSync(tmp, final)`
เพื่อไม่ให้ serve `.mind` ที่เขียนค้างครึ่งทาง

### Module layout

```
server.js                    express bootstrap, static, /health          [แก้: ถอด socket.io]
server/db.js                 node:sqlite open + migrate + prepared stmts
server/storage.js            DATA_DIR paths, savePngDataUrl, atomic write
server/routes/{markers,hides,seeks}.js

public/index.html            เมนู / รายการ marker                        [ใหม่]
public/upload.html           เลือกรูป → downscale → compile → palette → POST
public/hide.html             PLACE/PAINT/REVIEW
public/seek.html             3 taps → reveal → POST /api/seeks

public/js/core/
  arSession.js       fetch marker → MindARThree → fix จอดำ → RAF   [ดูดมาจาก startAR() เดิม]
  anchorPick.js      ★ primitive เรขาคณิตตัวเดียวที่ทุกอย่างพึ่ง
  silhouette.js      mesh + material + paint canvas
  mask.js            decode green channel, isBody(), tight bbox
  brush.js           stroke engine + dirty flag
  markerSampler.js   offscreen marker image + eyedropper
  palette.js         extractPalette (bucket 4³ + average), gridPalette
  placement.js       clampToMarker, drag + grab offset
  pointer.js         pointer capture, coalesced events, tap-vs-drag
  api.js, hud.js

public/assets/silhouettes/human_a.png   1024² ทึบ, ตัวคนขาว พื้นดำ, ขอบ feather ~4px
```

ไฟล์ไหนก็ไม่เกิน ~150 บรรทัด ยกเว้น `hideApp.js` (~250, state machine + HUD)

**ใช้ซ้ำจาก PoC เดิม:** importmap (pin `three@0.160.0`), โครง `#ar-container`/`#overlay`/`#status`
+ CSS, pattern ปุ่ม start สำหรับ iOS gesture, ค่า filter ของ MindAR
(`filterMinCF:0.0001, filterBeta:0.01, missTolerance:5, warmupTolerance:5` — ค่า smoothing
แรงๆ นี้ **ถูกต้องแล้ว** สำหรับ overlay นิ่งๆ อย่าไปผ่อน), fix จอดำ (`clearAlpha` + z-index),
`isSecureContext` guard, วินัย `updateWorldMatrix` ก่อนอ่าน `matrixWorld`

**ลบทิ้ง:** `socket.io` (ทั้ง dependency, `<script>`, handler ฝั่ง server, `peers` Map,
`createPeer`/`removePeer`, `broadcastPose`, `makeLabelSprite`, `pose_update`/`user_left`),
ไฟทั้งสองดวง และ debug cube (`MeshBasicMaterial` ไม่สนใจไฟอยู่แล้ว — เก็บไว้ทำให้คนอ่านโค้ดเข้าใจผิด)

---

## Phases

### Phase 0 — Spikes (ทำก่อน; ตอบคำถามที่ล้มโปรเจกต์ได้)

หน้า test เล็กๆ 2 หน้า ทิ้งได้หลังตอบคำถามเสร็จ

- **Spike A — in-browser compile บนมือถือจริง:** เลือกรูป → downscale ≤1024 → `Compiler.compileImageTargets()`
  พร้อม progress → `new Blob([bytes])` → `URL.createObjectURL` → ยัดเข้า `MindARThree` → ยืนยันว่า track ได้
  **วัดเวลาและดูว่า tab ค้าง/แครชไหม**
  → *ถ้าช้าเกินรับได้:* ย้าย upload ไปทำเฉพาะบน desktop (marker intake เปลี่ยน, ตัวเกมไม่เปลี่ยน)
- **Spike B — camouflage อ่านออกจริงไหม:** plane `MeshBasicMaterial` ระบายสีมือ วางทาบ marker
  ที่พิมพ์ออกมา (**กระดาษด้าน** ไม่ใช่กระดาษมัน) ส่องกล้องดู **ถ่ายรูปผลลัพธ์เก็บไว้**
  → ตอบว่าแนวคิดหลักของเกมเวิร์คไหม ก่อนลงทุนกับ DB/UI

**Gate:** ทั้งสองข้อต้องผ่านก่อนเข้า Phase 1

### Phase 1 — Server + DB
`server/db.js` (`node:sqlite` + migrate), `storage.js`, routes ของ markers, mount `/media`
ถอด socket.io ออกจาก `server.js` และ `package.json`, ตั้ง `express.json({limit:'8mb'})`

### Phase 2 — AR core ที่ใช้ร่วมกัน
`anchorPick.js` → `arSession.js` → `silhouette.js` → `mask.js`
**ทำ `anchorPick.js` ให้ถูกก่อน** ที่เหลือคืองานจดบัญชี

### Phase 3 — โหมดคนซ่อน
State machine PLACE → PAINT → REVIEW, `brush.js`, `placement.js`, `pointer.js`, ปุ่มบันทึก
Drag clamp ใช้ **tight bbox ของ pixel ทึบใน mask** ไม่ใช่ขอบ quad
(ไม่งั้นจะซ่อนชิดขอบรูปไม่ได้ ซึ่งเป็นจุดซ่อนที่ดีที่สุด) และต้องกันเคส `minX > maxX`
เมื่อผู้เล่นขยายตัวใหญ่กว่า marker

### Phase 4 — Eyedropper + จานสี
`markerSampler.js` (`getImageData` **ครั้งเดียวตอนโหลด**, เฉลี่ยเป็นวงกลม r≈4px
เพื่อกัน noise จาก JPEG/halftone), `palette.js` (รัน**ตอน upload** เก็บผลลง DB — runtime cost เป็นศูนย์)
แสดง 2 แถว: สีเด่นทั้งรูป + สีราย cell 4×4 (แถวหลังคือแถวที่ช่วยพรางจริง เพราะพรางคือเรื่อง *เฉพาะที่*)

### Phase 5 — โหมดคนหา
3 taps, alpha-aware hit (`mask.isBody(u,v,tol)` อ่าน green channel, `tol≈0.03`),
แยก tap ออกจาก drag (`< 12px` และ `< 600ms` — ไม่งั้นการขยับกล้องกินสิทธิ์แตะทิ้ง),
reveal + POST `/api/seeks`

> เกณฑ์เรนเดอร์ (`alphaTest 0.5`) กับเกณฑ์ hit (`>127` + ring probe) **จงใจไม่ตรงกันเล็กน้อย**
> โดยเข้าข้างผู้เล่น — ถูกต้องแล้วสำหรับเป้าที่มองเห็นยาก

### Phase 6 — หน้า upload
downscale → compile (`type="module"`, `window.MINDAR.IMAGE.Compiler`) → extract palette →
POST metadata → PUT image → PUT `.mind` (`new Blob([bytes])`)

### Phase 7 — หน้าเมนู + ร้อยทุกอย่างเข้าด้วยกัน

สถานะ 2026-08-02: implementation เสร็จแล้ว แต่การตัดสิน Phase 8 ยังรอผลทดสอบบน
อุปกรณ์จริงสองสภาพแสง (ไฟในอาคารโทนอุ่นและแสงใกล้หน้าต่าง) จึงยังไม่ลบ Phase 8
ออกจากแผน การตัดสินต้องอิงผลทดสอบนี้ ไม่ใช่ desktop simulation

### Phase 8 — White-balance gain (ทำท้ายสุด, เป็นของแถม)
`whiteBalance.js`: เทียบสีที่กล้องเห็นบน marker กับสีในไฟล์ต้นฉบับ → ได้ per-channel gain →
ใส่ที่ `material.color` (เพราะ `MeshBasicMaterial` คำนวณ `diffuse = color * map`)
คำนวณใหม่ทุก 1 วินาที และ lerp เข้าหาค่าใหม่เพื่อไม่ให้กระพริบตอนกล้อง auto-exposure ไล่

### Phase 9 — Pose selection + HUD paint preview

แผนงานละเอียดอยู่ที่ [`plan-phase9.md`](plan-phase9.md) — เลือกท่าทาง 4 แบบในโหมด
PLACE, จานสีเหลือ 2 แถว, และย้ายการระบายสีจากจอ AR ไปลง preview canvas ใน HUD
(อ้างอิง `docs/img-ref/UI_1_1.png`, `UI_2_1.png`) ไม่เกี่ยวกับ Phase 8 และไม่แตะ
การตัดสินใจของ Phase 8

---

## ความเสี่ยงที่ต้องรู้ล่วงหน้า

1. **HTTPS บนมือถือ — จะบล็อคตั้งแต่วันแรก** `getUserMedia` ต้องการ secure context;
   `http://192.168.x.x:3000` ไม่ใช่ → ใช้ ngrok/cloudflared **จัดการเรื่องนี้ก่อนเขียนโค้ดเกม**
2. **Camouflage ไม่เนียนจากการดูดสีอย่างเดียว** สีที่กล้องเห็นผ่าน auto-exposure/auto-WB/tone curve
   ต่างจากสีในไฟล์ 10–30% ในความสว่าง และ 300–800K ในอุณหภูมิสี
   → ตัวช่วยที่ได้ผลที่สุดคือ **ให้คนซ่อนระบายสีขณะมองผ่านกล้องจริง + ปุ่ม peek** (Phase 3)
   สายตาคนปิด loop ทั้งหมดให้เอง; ส่วนต่างระหว่างแสงตอนซ่อนกับตอนหาเป็นสิ่งที่แก้ไม่ได้
   → **และนี่ไม่ใช่เรื่องแย่ทั้งหมด**: ถ้าพรางได้สมบูรณ์แบบ เกมจะหาไม่เจอใน 3 ครั้ง
   ความคลาดเคลื่อน ~10% คือเส้นแบ่งระหว่าง "เป็นไปไม่ได้" กับ "ยากกำลังดี"
3. **Pose jitter ทำลายการพรางเร็วกว่าสีที่เพี้ยน** — ตาคนไวต่อการเคลื่อนไหวมากกว่าเฉดสี
   ค่า filter เดิมของ PoC แรงพอดีแล้ว; พิจารณาเพิ่ม dead-zone (ขยับ < 0.002 unit → ไม่อัปเดต)
   **ทดสอบข้อนี้เร็วๆ — เป็นตัวตัดสินความเป็นไปได้ของทั้งแนวคิด**
4. **Cold start ~3.5 MB** (controller chunk 2.2 MB + three 1.2 MB จาก jsDelivr) → 5–10 วิบน cellular
   ถ้าจะเดโมบน wifi งาน ให้ vendor ลง `public/vendor/` แล้ว serve เอง
   และต้องมี spinner ระหว่างกดปุ่มกับเฟรมแรก ไม่งั้นผู้ใช้กดซ้ำจนเปิดกล้อง 2 stream
5. **Touch routing มี 4 กับดัก** — `touch-action:none`; HUD ต้อง `pointer-events:none`
   ที่ container และ `auto` ที่ปุ่ม; `mindarThree.cssRenderer.domElement.style.pointerEvents='none'`;
   iOS pull-to-refresh → `overscroll-behavior:none` + `html,body{overflow:hidden;position:fixed}`
6. **iOS memory** — canvas หลายผืน + framebuffer ที่ full DPR → ตั้ง
   `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))` หลัง `start()` (แทบไม่เห็นความต่าง แต่ได้ headroom จริง)
7. **คุณภาพ marker มองไม่เห็นจนกว่าจะพัง** — รูปสีเรียบหรือลายซ้ำ compile ผ่านแต่ track ห่วย
   compiler ไม่มี quality score ให้ → เช็คหยาบๆ ด้วย Sobel energy ตอน upload แล้วเตือนถ้าต่ำเกิน

---

## Verification

**หลัง Phase 0:** มีตัวเลขเวลา compile จากมือถือจริง + รูปถ่ายผลการพรางเทียบกับ marker ที่พิมพ์

**หลัง Phase 1** (ทดสอบด้วย `curl` ไม่ต้องมี UI):
```bash
npm start && curl -s localhost:3000/health && curl -s localhost:3000/api/markers
```
ยืนยันว่าไฟล์ `.db` ถูกสร้าง, ตารางครบ, POST/PUT marker แล้วอ่านกลับมาได้

**End-to-end (ต้องใช้มือถือ 2 เครื่อง + marker ที่พิมพ์บนกระดาษด้าน):**
```bash
npx ngrok http 3000
```
1. เปิด `/upload.html` บน desktop → อัปโหลดรูป feature-rich → รอ compile → เห็น marker ในเมนู
2. เครื่อง A เปิด `/hide.html?marker=1` → ส่องกล้อง → โมเดลปรากฏ → ลากให้อยู่ในกรอบรูป
   (ทดสอบว่าลากออกนอกกรอบไม่ได้) → ล็อค → ระบายสีด้วย eyedropper → peek สลับดู → บันทึก
3. เครื่อง B เปิด `/seek.html?hide=1` → ส่องกล้องที่ marker เดียวกัน → หาตัว
   - แตะที่ **พื้นที่ว่างข้างๆ ตัวโมเดล** → **ต้องนับเป็น miss** (นี่คือการพิสูจน์ alpha-aware raycast)
   - แตะโดนตัว → นับเป็น found
   - พลาดครบ 3 ครั้ง → จบเกม
4. ตรวจ DB ว่ามี row ใน `hides` และ `seeks` พร้อม `taps_json` ที่สมเหตุสมผล
5. **ทดสอบ tracking หลุด:** ระหว่างระบายสี ให้เอากล้องออกจาก marker แล้วกลับมา
   → ต้องไม่มีรอยสีลากพาดตัวโมเดล (พิสูจน์ guard `!session.visible`)
6. รีเฟรชเครื่อง B → hide เดิมต้องปรากฏที่ตำแหน่งเดิมเป๊ะ (พิสูจน์ว่า anchor-local units ถูกต้อง)
