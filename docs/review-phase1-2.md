# Code Review — Phase 1 (server) + Phase 2 (AR core)

ตรวจเมื่อ 2026-07-30 · ทุกข้อด้านล่าง **รันจริงเพื่อยืนยันแล้ว** ไม่ใช่อ่านโค้ดเอา
ยังไม่มีการแก้ไขไฟล์ใดๆ — เอกสารนี้คือแผนการแก้

---

## สิ่งที่ทำได้ดี (ไม่ต้องแตะ)

- **`silhouette.js` material config ถูกต้องเป๊ะทุกจุดที่แผนเตือนไว้** — `SRGBColorSpace`
  บน paint texture, คง `NoColorSpace` บน mask, `depthTest/Write:false` + `renderOrder`,
  `alphaTest:0.5` + `transparent:true`, `toneMapped:false`, `PAINT_RES=512`
  และ invariant "paint canvas ทึบ 100%" มีจริงใน `fillRect` ตอนสร้าง
- **`mask.js` อ่าน green channel** ตรงกับ `alphamap_fragment` ของ three (ไม่ใช่ `.a`)
  และ `isBody()` มี ring probe เข้าข้างผู้เล่นตามที่ออกแบบ
- **`anchorPick.js` ไม่ใช้ `THREE.Raycaster`** และบังคับ `updateWorldMatrix` เอง — ถูกต้อง
- **`gen-silhouette.js` + `check-mask.js` เป็นคู่ที่ดีมาก** — asset ถูกสร้างแบบ deterministic
  แล้วมีตัวตรวจอิสระยืนยัน contract: `1024×1024, body coverage 12.0%,`
  `bbox u0=.346 u1=.654 v0=.086 v1=.918 → PASS` (กลางภาพ + สูง = ร่างคนยืน สมเหตุสมผล)
- **atomic write** (`tmp` → `rename`) และ **two-phase raw PUT** ทำตามแผน

---

## ปัญหาที่พบ (เรียงตามความรุนแรง)

### 🔴 S1 — หน้าแรกของเว็บพังสนิท

`public/index.html` + `public/app.js` **ยังเป็นไฟล์ PoC เดิม** ที่อ้าง socket.io
ซึ่งถูกถอดออกจาก `server.js` และ `package.json` ไปแล้ว

ยืนยันแล้ว:
```
GET /                        → 200
GET /socket.io/socket.io.js  → 404
```
`app.js:21` เรียก `const socket = io();` ที่ top level → เมื่อ script tag 404
ตัวแปร `io` ไม่มีอยู่ → `ReferenceError` ทันทีที่โหลด → หน้าแรกตายทั้งหน้า

**แก้:** ลบ `public/app.js`, เขียน `public/index.html` เป็นหน้าเมนูจริง
(แผนเดิมกำหนดให้ index เป็นเมนูอยู่แล้ว — แค่ยังไม่ได้ทำ)

---

### 🔴 S2 — `localToMeshUV` ไม่รองรับ rotation แต่ `setTransform` รับ `rot`

`silhouette.js:58` `setTransform({ rot })` ใส่ `mesh.rotation.z = rot`
แต่ `anchorPick.js:65` `localToMeshUV` แมปแบบ axis-aligned ล้วน **ไม่ถอด rotation ออก**
→ แผนต้นฉบับมีสูตรที่ถอด rotation ไว้แล้ว แต่ตอน implement หายไป

พิสูจน์ด้วยตัวเลข (จุด "หัวกลางตัว" ซึ่ง uv ต้องเป็น `(0.5, 1.0)` เสมอ):

| rot | จุดใน anchor space | ที่โค้ดคืนมา | ที่ถูกต้อง |
|---|---|---|---|
| 0° | (0, 0.15) | (0.5, 1.0) ✓ | (0.5, 1.0) |
| 30° | (-0.075, 0.13) | **(0.25, 0.933)** ✗ | (0.5, 1.0) |
| 90° | (-0.15, 0) | **(0.0, 0.5)** ✗ | (0.5, 1.0) |

กระทบ **ทั้งการระบายสีและการตัดสินของคนหา** — ที่ 90° สีจะลงผิดตำแหน่งไปคนละที่
ตอนนี้ยัง**ไม่ระเบิด** เพราะไม่มีใครเรียก `setTransform` ด้วย `rot≠0`
แต่ Phase 3 คือที่ที่มันจะระเบิด

**แก้ (เลือกทางใดทางหนึ่ง — แนะนำทาง ก):**
- **ก) ใส่ rotation ให้ครบ** (6 บรรทัด) + ทำ clamp ให้รู้จัก rotation ด้วย
  ซ่อนแนวทแยงตามขอบรูปเป็นจุดซ่อนที่ดี คุ้มกับความยุ่ง
  ```js
  const dx = p.x - mesh.position.x, dy = p.y - mesh.position.y;
  const c = Math.cos(-mesh.rotation.z), s = Math.sin(-mesh.rotation.z);
  out.x = (dx * c - dy * s) / mesh.scale.x + 0.5;
  out.y = (dx * s + dy * c) / mesh.scale.y + 0.5;
  ```
- ข) ตัด rotation ออกให้หมด — ลบ `rot` จาก `setTransform` และ drop `rot_z` จาก payload
  (คอลัมน์ใน DB คงไว้ได้ ไม่เสียหาย)

> ห้ามปล่อยสภาพปัจจุบัน: รับ `rot` เข้ามาแต่คำนวณผิด คือกับดักที่หา bug ยากที่สุด

---

### 🟠 S3 — marker ขึ้นสถานะ `ready` ได้ทั้งที่ยังไม่มีรูป

`markers.js:126` `setTarget` ตั้ง `status='ready'` แบบไม่มีเงื่อนไข
แผนระบุว่าต้อง ready เฉพาะเมื่อมี **ทั้ง** image และ mind

ยืนยันแล้ว — POST แล้ว PUT เฉพาะ target (ไม่ PUT รูป):
```json
{ "status": "ready", "imageUrl": null, "mindUrl": "/media/markers/1.mind" }
```
marker แบบนี้จะทำให้โหมดคนซ่อนพัง เพราะ eyedropper (Phase 4) ต้องใช้รูปต้นฉบับ

**แก้:** ตั้ง ready เมื่อครบทั้งคู่เท่านั้น (ทำใน SQL เดียว)
```sql
UPDATE markers SET mind_path = ?,
  status = CASE WHEN image_path IS NOT NULL THEN 'ready' ELSE 'pending' END
WHERE id = ?
```
และทำสมมาตรใน `setImage` ด้วย (ถ้ามี mind แล้วค่อยขึ้น ready)

---

### 🟠 S4 — cache `immutable` 1 ปี บน URL ที่เขียนทับได้

`server.js:28` เสิร์ฟ `/media` ด้วย `immutable, maxAge:'1y'` แต่ API อนุญาตให้
PUT ทับ id เดิมได้ → เบราว์เซอร์/CDN จะยึดของเก่าไว้ 1 ปี โดยไม่มีทาง bust

ยืนยันแล้ว: header คือ `Cache-Control: public, max-age=31536000, immutable`
และ re-PUT ไบต์ชุดใหม่ลง id เดิม **สำเร็จ (204)** ไฟล์บนดิสก์เปลี่ยนจริง

นี่คือประเภทปัญหาที่กินเวลา debug เป็นชั่วโมง — "ทำไมอัปโหลด marker ใหม่แล้วยัง track ไม่ได้"

**แก้ (แนะนำข้อแรก):**
- ใส่ `?v=` จาก `updated_at`/hash ลงใน URL ที่ API คืน แล้วคง `immutable` ไว้ — ได้ทั้งสองอย่าง
- หรือระหว่าง PoC เปลี่ยนเป็น `maxAge:0, etag:true` ไปก่อน

---

### 🟡 S5 — เก็บ absolute filesystem path ลง DB

`markers.js:113,126` เก็บผลของ `storage.markerImagePath(id)` ซึ่งเป็น path เต็ม
สวนทางกับ comment ใน schema ที่เขียนว่า *"relative to DATA_DIR"*

ยืนยันแล้ว:
```
mind_path = "C:\Users\User\OneDrive\Desktop\AR status\data\media\markers\1.mind"
```
ตอนนี้ยังไม่รั่วออก API เพราะ `toDetail` สร้าง URL จาก `id` ไม่ใช่จาก path
แต่ย้าย `DATA_DIR` แล้วแถวเก่าพังทันที และเสี่ยงรั่ว path ของเครื่องถ้าเผลอ serialize

**แก้:** เก็บ `markers/1.mind` (relative) หรือเก็บแค่ flag boolean ก็พอ เพราะ path ถูก derive จาก id ได้อยู่แล้ว

---

### 🟡 S6 — error response เป็น HTML ไม่ใช่ JSON

ยังไม่มี error middleware และไม่มี JSON 404 สำหรับ `/api/*` — ยืนยันครบ 3 เคส:

| เคส | ได้ | ควรได้ |
|---|---|---|
| JSON เพี้ยน POST /api/markers | `400 text/html` | `400 application/json` |
| `GET /api/nope` | `404 text/html` | `404 application/json` |
| raw PUT 9 MB (เกิน 8mb) | `413 text/html` | `413 application/json` |

client ที่ `await res.json()` จะพังด้วย parse error บังหน้า error จริง

**แก้:** ปิดท้าย `server.js` ด้วย 404 handler สำหรับ `/api` + error middleware
ที่ map `err.type === 'entity.too.large'` → 413 และ `entity.parse.failed` → 400

---

### 🟡 S7 — `savePngDataUrl` ขาดการป้องกันที่แผนระบุไว้

`storage.js:39` ไม่มี **size cap** และไม่มี **PNG magic-byte check** (แผนกำหนดไว้ทั้งคู่:
`maxBytes = 4MB` + ตรวจ `89 50 4E 47 0D 0A 1A 0A`) ตรวจแค่ prefix ของ string ซึ่งปลอมง่าย

ยังไม่ถูกเรียกใช้ (ยังไม่มี route hides) แต่ **Phase 3 จะเรียกทันที** ตอนกดบันทึก
→ ต้องแก้ก่อนเข้า Phase 3

---

### 🟡 S8 — mask decode ที่ 1024² กินหน่วยความจำเกินจำเป็น

`mask.js` ใช้ `res = img.naturalWidth` = **1024** → `Uint8Array` 1 MB
บวก `_canvas` ที่เป็น **module-level ตัวเดียวร่วมกัน** ขนาด 1024² = backing store ~4 MB
ที่ค้างอยู่ตลอดอายุหน้า แผนกำหนดไว้ที่ **256 (64 KB)**

แผนเตือนเรื่อง iOS canvas memory ไว้แล้ว (ความเสี่ยงข้อ 6) — และ hit test ไม่ได้ต้องการ
ความละเอียดระดับนั้นเลย

**แก้:** decode ลง 256 (`ctx.drawImage(img, 0, 0, 256, 256)`), ปล่อย canvas หลัง decode
(`_canvas.width = _canvas.height = 0`) และเลิกใช้ canvas ร่วมกันแบบ module-level
(ถ้าเรียก `loadMask` สองครั้งพร้อมกัน สองตัวจะเขียนทับกัน)

---

### ⚪ S9 — เรื่องเล็กน้อย

- `stmt.markers.listReady` **ไม่ได้กรอง** `status='ready'` — ชื่อไม่ตรงพฤติกรรม
  (ตั้งใจให้เมนูเห็น marker ที่ยังไม่เสร็จก็ได้ แต่ต้องเปลี่ยนชื่อ)
- `PUT /:id/image` ไม่ตรวจ PNG magic bytes (สมมาตรกับ S7)
- `package.json` `engines: ">=22.5.0"` แต่ `DatabaseSync` เพิ่งนิ่งใน Node 24
  (เครื่องนี้ v24.15.0) — ควรเป็น `>=24.0.0` ไม่ให้ใครรันบน 22 แล้วเจอ API ต่าง
- `node_modules/@socket.io` ยังค้างอยู่ และ `package-lock.json` ยังไม่ถูก prune
  → `npm prune` (ไม่กระทบ runtime)
- `arSession.dispose()` ไม่ `await mindarThree.stop()` — camera track อาจค้างชั่วครู่
- `/health` ไม่แตะ DB — ตอบ ok แม้ DB พัง

---

## ยังไม่ได้สร้าง (ไม่ใช่ข้อบกพร่อง แค่ยังไม่ถึงคิว)

`server/routes/hides.js`, `server/routes/seeks.js` — แผนวางไว้ใน module layout
**`hides.js` เป็น dependency ของ Phase 3** (ต้องมีตอนกดบันทึก) จึงถูกดึงเข้า Phase 3

---

## แผนการแก้ (เรียงลำดับการลงมือ)

| # | แก้อะไร | ทำไมต้องอยู่ลำดับนี้ | ประเมิน |
|---|---|---|---|
| **R1** | S2 rotation — ตัดสินใจแล้วทำให้ครบ | Phase 3 แตะ `localToMeshUV` ทุกบรรทัด ถ้าไม่แก้ก่อนจะสร้างงานบนฐานที่ผิด | 20 นาที |
| **R2** | S7 `savePngDataUrl` (cap + magic bytes) | Phase 3 เรียกใช้ตอนกดบันทึก | 15 นาที |
| **R3** | S3 สถานะ `ready` ต้องครบทั้งคู่ | กันไม่ให้ Phase 3 เจอ marker ที่ไม่มีรูป | 10 นาที |
| **R4** | S6 error middleware + JSON 404 | Phase 3 เริ่มยิง API จริงจัง ต้องเห็น error ที่อ่านได้ | 20 นาที |
| **R5** | S1 ลบ `app.js` + เขียน `index.html` เป็นเมนู | รวมกับงาน Phase 3.7 อยู่แล้ว | ทำใน Phase 3 |
| **R6** | S8 mask decode 256 + ปล่อย canvas | ทำก่อนทดสอบบนมือถือจริง | 15 นาที |
| **R7** | S4 cache busting `?v=` | จะกัดตอนอัปโหลด marker ซ้ำใน Phase 6 | 20 นาที |
| **R8** | S5 relative path ใน DB | ไม่มีอะไรพังตอนนี้ ทำตอนแตะ markers.js รอบหน้า | 10 นาที |
| **R9** | S9 ทั้งชุด | เก็บกวาด | 20 นาที |

**R1–R4 คือ gate ของ Phase 3** — สี่ข้อนี้ต้องเสร็จก่อนเริ่มเขียนโหมดคนซ่อน
R6 ก่อนทดสอบมือถือ · R7 ก่อน Phase 6 · R5 รวมใน Phase 3.7 · R8/R9 เมื่อสะดวก

**วิธีตรวจว่าแก้แล้วได้ผล**
```bash
node tools/check-mask.js                 # ต้องยัง PASS หลังแก้ S8
npm start
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' localhost:3000/api/nope
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  -X POST localhost:3000/api/markers -H 'Content-Type: application/json' -d '{bad'
# ทั้งสองต้องเป็น application/json
```
สำหรับ S3: POST marker → PUT เฉพาะ target → `status` ต้องยังเป็น `pending`
สำหรับ S2: rerun ตารางพิสูจน์ rotation — ทั้งสามแถวต้องได้ `(0.5, 1.0)`
