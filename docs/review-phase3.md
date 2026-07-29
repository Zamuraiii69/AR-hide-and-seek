# Code Review — Phase 3 (โหมดคนซ่อน)

ตรวจเมื่อ 2026-07-30 · ทุกข้อ **รันจริงเพื่อยืนยันแล้ว** · ยังไม่แก้ไฟล์ใดๆ

---

## R1–R4 จาก review รอบก่อน: ผ่านหมด ✅

| | สถานะ | ยืนยันด้วย |
|---|---|---|
| **R1** rotation ใน `localToMeshUV` | ✅ | สูตรถอด rotation ตรงตามแบบ (`anchorPick.js:66-75`) |
| **R2** `savePngDataUrl` cap + magic bytes | ✅ | POST payload ที่ไม่ใช่ PNG → `400 {"error":"expected PNG magic bytes"}` |
| **R3** `status='ready'` ต้องครบทั้งคู่ | ✅ | `CASE WHEN` ทั้ง `setImage`/`setTarget` + **migration UPDATE ตอน boot** ซ่อมแถวเก่าให้ด้วย (คิดมาดี) |
| **R4** error middleware + JSON 404 | ✅ | `/api/nope` → `404 application/json` · JSON เพี้ยน → `400 application/json` |
| **R5** relative path ใน DB | ✅ | `image_path = "markers/1.png"` |
| **R7** cache busting | ✅ | `imageUrl = /media/markers/1.png?v=1785360375821` |
| **S9/S10** rename `listWithHideCount`, PNG magic บน PUT image | ✅ | |

**Phase 3 API ใช้งานได้จริง** — ทดสอบครบทั้ง happy path และ 4 เคสที่ต้องพัง:

```
POST /api/hides (ถูกต้อง)            → 201 {"id":2,"shareUrl":"/seek.html?hide=2"}
GET  /api/hides/1                    → มี marker.mindUrl ฝังมาด้วย ✓ (network รอบเดียว)
markerId ไม่มีจริง                    → 404 {"error":"marker not found"}
w = 0                                → 400 {"error":"transform ... between 0 and 2"}
paintDataUrl ไม่ใช่ PNG               → 400 {"error":"expected PNG magic bytes"}
ไม่ส่ง paintDataUrl                   → 400 {"error":"expected a data:image/png;base64 URL"}
```

**ที่ทำได้ดีเพิ่มเติม:** `placement.js` clamp ด้วยมุมทั้งสี่ของ bbox ที่หมุนแล้ว (ถูกต้อง ไม่ใช่ AABB ดิบ)
· mode gating ทำด้วย CSS `[data-mode=...]` สะอาดกว่าสลับ JS · `index.html` escape HTML
และแยกสถานะ pending/ready · `hide.html` มี `overscroll-behavior:none` + `position:fixed` ครบ
· `boot()` fetch/decode ตอนโหลดหน้า แล้ว click handler เรียกแค่ `session.start()` — ถูกต้องตาม iOS gesture chain

---

## ปัญหาที่พบ

### 🔴 P1 — soft brush ส่ง NaN เข้า canvas เมื่อนิ้วไม่ขยับ

`brush.js:18` — `move()` หาร `n / d` โดยที่ `d` คือระยะที่นิ้วขยับ
ถ้า `pointermove` ยิงมาที่พิกัดเดิมเป๊ะ `d === 0` → `0/0 = NaN`

ยืนยันแล้ว (import โมดูลจริงมารัน แล้ว stub ctx):
```
brush.setSoft(true); brush.start({x:.5,y:.5}); brush.move({x:.5,y:.5});
→ createRadialGradient(NaN, NaN, 0, NaN, NaN, 16)
→ any NaN passed to canvas? YES
```
ตาม Canvas 2D spec อาร์กิวเมนต์ที่ไม่ finite ทำให้ `createRadialGradient` **throw**
→ exception หลุดออกจาก `pointermove` handler → เส้นที่กำลังลากขาดกลางคัน

เบราว์เซอร์ยิง `pointermove` ที่พิกัดเดิมได้จริง (เช่นตอนแรงกดเปลี่ยนแต่ตำแหน่งเท่าเดิม)
และ `getCoalescedEvents()` ยิ่งเพิ่มโอกาส

**แก้:** `if (d === 0) { stamp(next); last = next; markDirty(); return; }` ก่อนเข้า loop
(หรือ `const steps = Math.max(1, Math.ceil(d / step))` แล้ววนด้วย `i/steps`)

---

### 🔴 P2 — ลากแล้วขึ้น "Too large to hide" ผิดๆ พร้อมล็อคปุ่ม Lock

`placement.js:22` — `move()` คืน `false` เมื่อ `grab` เป็น null
แต่ `hideApp.js:44` ตีความค่าที่คืนมาเป็น "พอดีไหม": `state.fits = placement.move(p)`
→ `updateFit()` โชว์ "Too large to hide" และ `$('lock').disabled = true`

ยืนยันแล้ว:
```
placement.move({x:.1,y:.1}) โดยไม่เรียก start() → false
clampToMarker(...) ความจริงสำหรับ mesh เดียวกัน   → true
```
เกิดง่ายมาก: `start` bail เมื่อ `!session.visible` หรือ `!p` (นิ้วอยู่นอกระนาบ marker)
แล้ว `pointermove` ตัวถัดไปยิงเข้ามา → ผู้ใช้เจอ "ตัวใหญ่เกินกว่าจะซ่อนได้"
ทั้งที่ขนาดปกติ และ **กดล็อคไม่ได้ = ติดอยู่ใน PLACE ตลอด**

**แก้:** แยก "ไม่ได้ลาก" ออกจาก "ไม่พอดี" — ให้ `move()` คืน `null` เมื่อไม่มี grab
แล้ว `hideApp` อัปเดต `state.fits` เฉพาะเมื่อค่าไม่ใช่ null
(หรือให้ `move()` คืน `clampToMarker(...)` เสมอ แม้ไม่มี grab ก็ไม่ขยับตำแหน่ง)

---

### 🟠 P3 — ขนาดเริ่มต้นไม่ตรงกับ slider (ตัวใหญ่กว่าที่บอก 3.3 เท่า)

`silhouette.js` ตั้งแต่ `position` แต่ **ไม่เคยตั้ง `scale`** → PlaneGeometry(1,1) ทำให้
`mesh.scale = (1, 1, 1)` ส่วน `hide.html:25` slider `value="0.30"`
และ `applyTransform` ผูกกับ event `input` เท่านั้น — ไม่ถูกเรียกตอน boot

ยืนยันแล้ว: `mesh.scale.set(...)` ปรากฏที่เดียวคือใน `setTransform` ซึ่ง **เป็น dead code**
(`grep setTransform` ทั้ง `public/` → ไม่มีใครเรียก)

ผล: ตอนเปิดหน้า ตัวโมเดลกว้าง 1.0 anchor unit (= เต็มความกว้าง marker) แต่ slider อ่านว่า 0.30
แตะ slider ครั้งแรกตัวจะกระตุกหดลงทันที · และ `updateFit()` ตอน boot ก็คำนวณจากขนาดที่ผิด

**แก้:** เรียก `applyTransform()` หนึ่งครั้งตอนจบ `boot()` (แทน `updateFit()`)
แล้วใช้ `silhouette.setTransform()` ให้เป็นประโยชน์ หรือลบทิ้งถ้าไม่ใช้

---

### 🟠 P4 — server เชื่อขนาดรูปที่ client ส่งมา ทั้งที่ `aspect` คุมระบบพิกัดทั้งเกม

`markers.js:88` คำนวณ `aspect = h / w` จาก `imageWidth`/`imageHeight` ใน request body
**ไม่เคยตรวจกับรูปจริงที่ PUT ตามมา**

`aspect` เป็นตัวกำหนดขอบเขต drag clamp และ UV ของ eyedropper (Phase 4) ทั้งหมด
ถ้า client แจ้งผิด ทุกอย่างจะเพี้ยนแบบเงียบๆ — หาสาเหตุยากมาก

ยืนยันแล้วจากข้อมูลทดสอบที่มีอยู่: marker 1 มี `image_width=1, image_height=1, aspect=1`
และไฟล์จริงเป็น PNG 1×1 (70 ไบต์) — ตรงกันเพราะเป็นข้อมูลทดสอบที่ป้อนเอง
แต่ไม่มีอะไรบังคับให้ตรง และ `.mind` ที่เก็บไว้เป็น **ขยะ 3 ไบต์** (`\x01\x02\x03`)
ก็ยังทำให้ marker ขึ้นสถานะ `ready` ได้

**แก้:** อ่าน IHDR จาก buffer ที่มีอยู่แล้วใน `PUT /:id/image` (กว้าง = byte 16-19, สูง = 20-23)
แล้ว **เขียน `image_width/image_height/aspect` ทับจากค่าจริง** — เลิกเชื่อ client
และเช็คขนาดขั้นต่ำของ `.mind` (ไฟล์จริง 444–691 KB จากผล Spike A; อะไรที่เล็กกว่า ~10 KB คือของปลอม)

---

### 🟡 P5 — `catch` ใน POST /api/hides กลืน server error เป็น 400 ทั้งหมด

`hides.js:40-42` — `catch (err) { return fail(res, 400, err.message) }`
ครอบทั้ง `tx()` ดังนั้นดิสก์เต็ม / `SQLITE_BUSY` / bug ในโค้ดเรา จะกลายเป็น **400** ทั้งหมด
ซึ่งบอก client ว่า "คุณส่งข้อมูลผิด" ทั้งที่เป็นความผิดของ server
และ `err.message` ที่หลุดออกไปอาจมี path ของเครื่อง

**แก้:** validate `paintDataUrl` **ก่อน** เข้า `tx()` (ให้ 400 เฉพาะกรณีนั้น)
ส่วน error อื่นให้ `next(err)` ไปให้ error middleware ตอบ 500

### 🟡 P6 — rollback ไม่ลบไฟล์ที่เขียนไปแล้ว

`hides.js:28-38` — ถ้า `setPaintPath` ล้มหลัง `savePngDataUrl` สำเร็จ `tx` จะ ROLLBACK แถว
แต่ไฟล์ `hides/<id>.png` ยังค้างบนดิสก์ · `storage.removeQuiet` มีอยู่แล้วแต่ไม่ถูกใช้
ความรุนแรงต่ำ (ROLLBACK คืน `sqlite_sequence` ทำให้ id ถูกใช้ซ้ำแล้วเขียนทับ) แต่ควรเก็บให้สะอาด

### 🟡 P7 — `bindPointer` คืนฟังก์ชัน "unsubscribe" ที่ทำลาย canvas

`pointer.js:28` — `return () => { el.replaceWith(el.cloneNode(true)); }`
`el` คือ **canvas ของ WebGL** — โคลนมันคือได้ canvas เปล่าที่ไม่มี GL context
ถ้าใครเรียกฟังก์ชันนี้ AR จะดับทั้งหน้า ตอนนี้ยังไม่มีใครเรียก แต่เป็นกับดักรอ

**แก้:** ใช้ `AbortController` แล้ว `signal` ให้ทุก `addEventListener` → unsubscribe = `abort()`

### 🟡 P8 — hard brush ไม่ตอบสนองการเปลี่ยนสี/ขนาดกลางเส้น

`brush.js:17` ตั้ง `ctx.strokeStyle`/`lineWidth` ตอน `start()` ครั้งเดียว
`move()` พึ่งค่าที่ค้างอยู่ใน ctx → เปลี่ยน swatch หรือเลื่อน slider ระหว่างลากจะไม่มีผลจนปล่อยนิ้ว
ไม่ใช่บั๊กร้าย แต่จะรู้สึกเหมือนแอปไม่ตอบสนอง **แก้:** ตั้งค่าใน `move()` ทุกครั้ง

### 🟡 P9 — `setBusy` ทำ label หายถ้าถูกเรียกซ้อน

`hud.js:3` — เรียก `setBusy(btn,true)` สองครั้งติดจะเก็บ `dataset.label = 'Saving...'`
แล้วตอนคืนค่าปุ่มจะค้างเป็น "Saving..." ตลอด
ตอนนี้ยังไม่เกิดเพราะมี `try/finally` แต่แก้ง่าย: เก็บ label เฉพาะเมื่อยังไม่มี

### ⚪ P10 — เรื่องเล็กน้อย

- **`hideApp.js` เขียนอัดหลาย statement ต่อบรรทัด** — บรรทัด 20, 34-38, 43-44, 54, 59
  ยาวมาก (บรรทัด 44 มี 3 เงื่อนไขซ้อน + เรียกฟังก์ชัน 2 ตัว) ไฟล์ 64 บรรทัดแต่จริงๆ คือ ~250 statement
  ผิดจากสไตล์ของไฟล์อื่นในโปรเจกต์ที่จัดบรรทัดสวยงาม และแก้ไข/debug ยาก
- `versionedUrl` เรียก `statSync` ทุกครั้งที่สร้าง URL → `GET /api/markers` ที่มี N marker
  ทำ 2N syscall ต่อ request (ยอมรับได้ใน PoC แต่ควรรู้ไว้)
- `silhouette.setTransform` = dead code (ดู P3)
- `index.html:188` ใส่ `marker.imageUrl` ลง `src` โดยไม่ escape (ค่ามาจาก server จึงปลอดภัยตอนนี้)
- `validTransform` ปล่อย `rot` ค่าใหญ่ผิดปกติผ่านได้ (เช่น 1e9) — cos/sin รับได้ แต่ควร normalize
- `arSession.dispose()` ยังไม่ `await mindarThree.stop()` (ยกมาจาก review ก่อน ยังไม่แก้)

---

## ช่องว่างที่ยังไม่ได้ปิด (ตามแผน ไม่ใช่ข้อบกพร่อง)

- **`/seek.html` ยังไม่มี** — `shareUrl` ที่ได้หลังบันทึกชี้ไปหน้าที่ 404
  ควรใส่ข้อความว่า "โหมดคนหายังไม่พร้อม (Phase 5)" กันผู้ใช้สับสน
- **`upload.html` เป็นแค่ redirect ไป `spike-compile.html`** ซึ่ง **ไม่เคย POST เข้า API เลย**
  (`grep -c "api/markers" spike-compile.html` → 0)
  → ตอนนี้สร้าง marker ได้ทางเดียวคือ `curl` ด้วยมือ · Phase 6 จะปิดช่องนี้
- `routes/seeks.js` — Phase 5

---

## แผนการแก้ (เรียงลำดับการลงมือ)

| # | แก้อะไร | ทำไมลำดับนี้ | ประเมิน |
|---|---|---|---|
| **F1** | P2 `placement.move` แยก "ไม่ได้ลาก" จาก "ไม่พอดี" | ทำให้ติดอยู่ใน PLACE กดล็อคไม่ได้ = โหมดคนซ่อนใช้งานไม่ได้จริง | 10 นาที |
| **F2** | P1 brush `d === 0` | เส้นขาดกลางคันตอนระบายสี ซึ่งเป็นแกนของ Phase 3 | 5 นาที |
| **F3** | P3 เรียก `applyTransform()` ตอน boot | ขนาดเริ่มต้นผิด 3.3 เท่า กระทบทั้ง fit และความรู้สึกตอนใช้ | 5 นาที |
| **F4** | P4 derive `aspect` จาก IHDR จริง + เช็คขนาด `.mind` | **ต้องเสร็จก่อน Phase 4** — eyedropper แมป UV ด้วย `aspect` | 25 นาที |
| **F5** | P5 + P6 error handling ใน POST /api/hides | ก่อนมีผู้ใช้จริงหลายคน | 20 นาที |
| **F6** | P7 `AbortController` แทน `replaceWith` | ก่อนที่ Phase 5 จะ reuse `bindPointer` | 10 นาที |
| **F7** | P8 + P9 brush mid-stroke + `setBusy` | เก็บกวาด UX | 15 นาที |
| **F8** | P10 จัดบรรทัด `hideApp.js` ให้อ่านได้ | ก่อนไฟล์นี้โตขึ้นอีกใน Phase 4 | 20 นาที |
| **F9** | ใส่ข้อความ "Phase 5" ที่ `shareUrl` | กันสับสน | 5 นาที |

**F1–F4 คือ gate ของ Phase 4** · F5–F9 ทำคู่ขนานได้

**วิธีตรวจว่าแก้แล้วได้ผล**
```bash
# F2: import โมดูลจริงมารันด้วย ctx stub — ต้องไม่มี NaN หลุดเข้า canvas
# F1: placement.move() ก่อน start() ต้องไม่ทำให้ state.fits กลายเป็น false
# F3: เปิด hide.html แล้วอ่าน silhouette.mesh.scale.x ต้องเท่ากับ 0.30 ทันทีที่ boot จบ
# F4: PUT รูป 372x674 ทับ marker ที่แจ้งไว้ 1x1 -> GET ต้องคืน aspect ~1.812 ไม่ใช่ 1
```
