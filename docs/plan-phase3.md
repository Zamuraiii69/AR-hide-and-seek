# Phase 3 — โหมดคนซ่อน (Hide mode)

## Context

Phase 1 (server + DB) และ Phase 2 (AR core: `anchorPick`, `arSession`, `silhouette`, `mask`)
เสร็จแล้ว — มีชิ้นส่วนพอที่จะเอาโมเดลขึ้นจอบน marker ได้ แต่ยังไม่มีใครขยับหรือระบายสีมันได้
และยังไม่มีทางบันทึกลง DB

Phase 3 ทำให้ **loop ของคนซ่อนครบวง**: ส่องกล้อง → เห็นโมเดล → ลากเข้ากรอบรูป →
ล็อคตำแหน่ง → ระบายสี → ตรวจดูเทียบกล้องจริง → บันทึกลง DB ได้ hide id กลับมา

จบ Phase 3 แล้วจะยังหาไม่ได้ (Phase 5) และจานสียังเป็นสีตายตัว (Phase 4 ค่อยใส่ eyedropper)
แต่ **ข้อมูลใน DB จะครบพอให้ Phase 5 อ่านไปเล่นได้ทันที**

---

## Gate — ต้องเสร็จก่อนเริ่ม

จาก [review-phase1-2.md](review-phase1-2.md): **R1, R2, R3, R4**

- **R1** ใส่ rotation ให้ `localToMeshUV` (หรือตัด rotation ออกทั้งระบบ) — Phase 3 แตะฟังก์ชันนี้ทุกบรรทัด
- **R2** `savePngDataUrl` ใส่ size cap + PNG magic check — ปุ่มบันทึกเรียกใช้ทันที
- **R3** `status='ready'` ต้องมีทั้ง image และ mind
- **R4** error middleware + JSON 404 — ไม่งั้น debug API ตาบอด

> **ตัดสินใจเรื่อง rotation ก่อนลงมือ** เพราะมันเปลี่ยนทั้ง `placement.js` และ HUD
> ข้อเสนอ: **ใส่ให้ครบ** — ซ่อนแนวทแยงตามขอบรูปเป็นจุดซ่อนที่ดีจริง
> แต่ **ยังไม่ต้องมี pinch-to-rotate** ใน Phase 3 ใช้ slider ก่อน (ดู "ตัดออกจาก scope")

---

## ไฟล์ที่จะสร้าง / แก้

```
server/routes/hides.js          [ใหม่]  POST /api/hides, GET /api/hides/:id
server.js                       [แก้]   mount /api/hides

public/js/core/api.js           [ใหม่]  fetch wrapper + error ที่อ่านได้
public/js/core/pointer.js       [ใหม่]  pointer capture, coalesced events, tap-vs-drag
public/js/core/placement.js     [ใหม่]  drag + grab offset + clampToMarker (รู้จัก rotation)
public/js/core/brush.js         [ใหม่]  stroke engine + dirty flag
public/js/core/hud.js           [ใหม่]  status pill / overlay / ปุ่ม / slider ที่ใช้ร่วมกัน

public/hide.html                [ใหม่]  โครงหน้า + HUD + importmap
public/js/hide/hideApp.js       [ใหม่]  state machine PLACE → PAINT → REVIEW
public/index.html               [เขียนใหม่] เมนูจริง (แก้ S1)
public/app.js                   [ลบ]    PoC เดิม อ้าง socket.io ที่ถอดไปแล้ว
```

ไฟล์ core แต่ละตัวควรอยู่ใต้ ~120 บรรทัด · `hideApp.js` ~250 (state machine + wiring)

---

## Steps

### 3.1 `server/routes/hides.js` + mount

```
POST /api/hides
  body { markerId, hiderName?, silhouetteId?, transform:{x,y,rot,w,h}, paintDataUrl }
  → 201 { id, shareUrl: '/seek.html?hide=<id>' }
GET  /api/hides/:id
  → { id, markerId, silhouetteId, transform, paintUrl, paintRes,
      marker: { aspect, mindUrl, imageUrl }, stats }
```

- **ฝัง `marker` ไว้ใน response ของ `GET /api/hides/:id`** → คนหายิง network รอบเดียว
  ก่อนสร้าง `MindARThree` ได้ (จำเป็น เพราะต้องมี `mindUrl` ก่อน construct)
- **ลำดับการเขียนต้อง atomic:** insert row ใน `tx()` → เอา `lastInsertRowid` มาตั้งชื่อไฟล์ →
  เขียนไฟล์ paint → ค่อย COMMIT ถ้าเขียนไฟล์ล้ม ให้ ROLLBACK จะไม่เหลือ row ที่ไม่มีไฟล์
  (`paint_path` เป็น `NOT NULL` — ใส่ค่า relative ตาม R8 ไปเลยตั้งแต่ต้น)
- **validate ให้ครบ**: `markerId` ต้องมีอยู่และ `status='ready'`;
  `x,y,rot,w,h` ต้อง finite; `w,h` ต้อง > 0 และ ≤ 2 (กันค่าเพี้ยน);
  `paintDataUrl` ผ่าน `savePngDataUrl` ที่แข็งแล้ว (R2)

**ตรวจ:** `curl` POST ด้วย dataURL 1×1 px → ต้องได้ 201 + ไฟล์โผล่ใน `data/media/hides/`
แล้ว `GET /api/hides/1` ต้องคืน `marker.mindUrl` มาด้วย · ลอง `markerId` ที่ไม่มี → 404 JSON

### 3.2 `api.js` + `pointer.js`

`api.js` — บาง: `getJSON`/`postJSON` ที่โยน `Error` พร้อม `status` + `body.error`
(พึ่ง R4 ที่ทำให้ error เป็น JSON)

`pointer.js` — ตามแผนหลัก:
- `el.style.touchAction = 'none'` + `userSelect:none`
- `setPointerCapture`, สนใจแค่ `e.isPrimary`
- ใช้ `getCoalescedEvents()` (fallback `[e]` สำหรับ Safari เก่า) → เส้นไม่ขาดตอนลากเร็ว
- ปล่อยที่ `pointerup` / `pointercancel` / `lostpointercapture` ทั้งสามตัว
- แยก **tap** ออกจาก **drag**: `< 12px` และ `< 600ms` = tap

### 3.3 `placement.js` — PLACE mode

- drag ด้วย **grab offset** (`_grab = mesh.position - hitPoint`) ไม่ให้โมเดลกระโดดมาใต้นิ้ว
- `clampToMarker(mesh, aspect, mask.bbox)` — clamp ด้วย **tight bbox ของพิกเซลตัวคน**
  ไม่ใช่ขอบ quad (quad โปร่งใสเป็นส่วนใหญ่ ถ้า clamp ด้วย quad จะซ่อนชิดขอบรูปไม่ได้
  ซึ่งเป็นจุดซ่อนที่ดีที่สุด) — `mask.bbox` มีให้แล้วจาก Phase 2
- **ถ้าใส่ rotation:** clamp ต้องใช้มุมทั้งสี่ของ bbox ที่หมุนแล้ว ไม่ใช่ AABB ดิบ
- **กันเคส `minX > maxX`** (ผู้เล่นขยายตัวใหญ่กว่า marker) → จับไว้กลางภาพ
  แล้ว disable ปุ่มบันทึกพร้อมข้อความ "ตัวใหญ่เกินกว่าจะซ่อนได้"
- ทุก handler `return` ทันทีถ้า `!session.visible`

**ตรวจ:** ลากออกนอกกรอบรูปไม่ได้ทั้งสี่ด้าน · ขยายจนใหญ่กว่า marker แล้วปุ่มบันทึกต้องถูก disable

### 3.4 `brush.js` — PAINT mode

- แปลง uv → พิกเซล canvas ด้วย `(uv.x*S, (1-uv.y)*S)` (ตรงกับ `flipY:true` ที่ Phase 2 ใช้)
- **hard brush** = `lineTo` + `lineCap:'round'` → ไม่มีรอยขาดโดยธรรมชาติ
- **soft brush** = ปั๊ม radial gradient ทุกระยะ `radius*0.25` ตามเส้น
  `globalAlpha` ต้องเป็น 1 เสมอ ให้ stamp ทับกันแล้วอิ่มตัว ไม่งั้นจะได้รอย "สร้อยลูกปัด"
  และ gradient stop ปลายต้องเป็น **rgb เดิม alpha 0** ไม่ใช่สีดำ ไม่งั้นได้ขอบมืด
- **throttle `needsUpdate` ด้วย dirty flag ที่ consume ครั้งเดียวต่อเฟรม** ใน `session.onFrame`
  — ไม่ใช่ `setTimeout` นี่คือ upload ต่อเฟรมที่น้อยที่สุดเท่าที่ทำได้
- paint อยู่ใน UV space ของตัวโมเดลเอง → **ย้ายตำแหน่งทีหลังสีไม่หาย** (บอกใน UI ด้วย)
- Phase 3 ใช้ **จานสีตายตัว ~10 สีโทนดิน** ไปก่อน — Phase 4 จะแทนด้วย eyedropper + สีที่ extract จากรูป

**ตรวจ:** ลากเร็วๆ ต้องไม่มีรอยขาด · สีไม่ล้นออกนอกรูปร่างคน (alphaMap clip ให้)
· ระหว่างระบายให้เอากล้องออกจาก marker แล้วกลับมา **ต้องไม่มีรอยสีลากพาดตัว**

### 3.5 REVIEW + บันทึก

- ปุ่ม **peek** สลับซ่อน/แสดงตัว เทียบกับกล้องจริง
  (นี่คือตัวช่วย camouflage ที่ได้ผลที่สุดตามผล Spike B — สายตาคนปิด loop ทั้งหมดให้เอง)
- ปุ่ม **บันทึก** → `getPaintDataUrl()` + transform → `POST /api/hides` → โชว์ `shareUrl`
- ระหว่างรอ response ต้อง disable ปุ่ม (กันกดซ้ำสร้าง hide ซ้ำ)

### 3.6 `hide.html` + `hideApp.js` — state machine

```
PLACE  → ลาก/สเกล/หมุน   (ห้ามระบายสี)
  ↓ [ล็อคตำแหน่ง]
PAINT  → ระบายสี          (ห้ามย้าย)
  ↓ [ตรวจสอบ]
REVIEW → peek + บันทึก
  ↑ [แก้ไขต่อ] กลับไป PAINT
```

บังคับกฎในที่เดียว (ไม่ใช่กระจายเป็น flag):
- ทุก pointer handler `return` ถ้า `!session.visible`
- PLACE ไม่ระบายสี / PAINT ไม่ย้าย — **พื้นที่แตะทับกัน 100%** และการเผลอลากตัวที่ระบาย
  ไปครึ่งทางคือความเสียหายที่กู้ไม่ได้

CSS ของหน้าต้องมีให้ครบ (แผนเตือนไว้ 4 กับดัก):
`touch-action:none` · HUD container `pointer-events:none` แต่ปุ่ม `auto`
· `overscroll-behavior:none` · `html,body{overflow:hidden;position:fixed}`
(`arSession` จัดการ `cssRenderer` pointer-events ให้แล้ว)

ต้องมี **spinner ระหว่างกดปุ่มเริ่มกับเฟรมแรก** — cold start ~3.5 MB
ถ้าไม่มี feedback ผู้ใช้จะกดซ้ำจนเปิดกล้องสอง stream

**สำคัญ:** fetch marker + decode asset **ตอนโหลดหน้า ไม่ใช่ใน click handler**
— `await` ใน handler จะทำลาย user-gesture chain ของ iOS
click ควรเรียกแค่ `session.start()`

### 3.7 `index.html` เมนู (ปิด S1)

- `GET /api/markers` → การ์ดรายการ marker (รูป + ชื่อ + จำนวน hide)
- เลือก marker → ไป `/hide.html?marker=<id>`
- ปุ่มไป `/upload.html` พร้อมหมายเหตุ **"ทำบน desktop เท่านั้น"** (ผล Spike A)
- **ลบ `public/app.js`**

---

## ตัดออกจาก scope Phase 3 (ตั้งใจ)

| ตัดอะไร | ทำไม |
|---|---|
| Eyedropper + สีที่ extract จากรูป | Phase 4 — Phase 3 ใช้จานสีตายตัวก่อน |
| pinch-to-scale / pinch-to-rotate | ชนกับ drag นิ้วเดียว ใช้ slider ก่อน เพิ่มทีหลังได้ |
| ยางลบ | invariant "paint canvas ทึบ 100%" ต้องคิดใหม่ถ้าใส่ (hit test อ่าน mask อยู่แล้วจึงยังปลอดภัย) |
| Undo | เก็บ canvas snapshot กิน memory บน iOS — ใส่ทีหลังถ้าจำเป็น |
| หลาย silhouette | `human_a` ตัวเดียวพอ; คอลัมน์ `silhouette_id` รองรับอนาคตไว้แล้ว |
| `routes/seeks.js` | Phase 5 |

---

## Verification (จบ Phase 3)

**ระดับ API (ไม่ต้องมีกล้อง):**
```bash
npm start
# สร้าง marker ปลอมให้ครบทั้ง image + mind แล้ว
curl -s -X POST localhost:3000/api/hides -H 'Content-Type: application/json' \
  -d '{"markerId":1,"transform":{"x":0.1,"y":-0.2,"rot":0,"w":0.3,"h":0.3},
       "paintDataUrl":"data:image/png;base64,iVBORw0KGgo..."}'
curl -s localhost:3000/api/hides/1     # ต้องมี marker.mindUrl ฝังมาด้วย
ls data/media/hides/                   # ต้องมี 1.png
```
เคสที่ต้องพัง: `markerId` ไม่มีจริง → 404 JSON · `paintDataUrl` ไม่ใช่ PNG → 400 JSON
· `w = 0` → 400 JSON

**ระดับเครื่องจริง (มือถือ + marker พิมพ์กระดาษด้าน + `npx ngrok http 3000`):**
1. เปิด `/` → เห็นรายการ marker → เลือก → เข้า `/hide.html?marker=1`
2. กดเริ่ม → เห็น spinner → กล้องติด → ส่องที่ marker → โมเดลโผล่
3. **PLACE:** ลากได้ลื่น · ลากออกนอกกรอบรูปไม่ได้ · slider สเกล/หมุนทำงาน
4. กดล็อค → **PAINT:** ลากเร็วๆ เส้นไม่ขาด · สีไม่ล้นออกนอกตัว · ย้ายไม่ได้แล้ว
5. **ทดสอบ tracking หลุด:** ระหว่างระบาย เอากล้องออกแล้วกลับมา → ห้ามมีรอยสีพาดตัว
6. กดตรวจสอบ → **REVIEW:** peek สลับเห็น/ไม่เห็น เทียบกับรูปจริง
7. กดบันทึก → ได้ `shareUrl` → ตรวจ DB มี row ใน `hides` + ไฟล์ paint บนดิสก์
8. **reload หน้าแล้วซ่อนใหม่อีกครั้ง** → ได้ hide id ที่ 2 ไม่ทับของเดิม

**ตัวที่พิสูจน์ว่าฐานถูก (สำคัญที่สุด):** ถ้า R1 เลือกทาง "ใส่ rotation ให้ครบ"
ให้หมุนตัว 90° แล้วระบายสีที่ **หัว** — สีต้องลงที่หัว ไม่ใช่ที่ไหล่หรือแขน
นี่คือการทดสอบที่จับ bug S2 ได้ตรงๆ
