// tools/gen-silhouette.js — generate public/assets/silhouettes/human_a.png
//
// A 1024² OPAQUE PNG: white human body on black background, feathered ~4px edge.
// three's alphaMap samples the GREEN channel, so the body must be white(255)
// and the background black(0); alpha stays 255 everywhere (fully opaque).
//
// Shape is built from signed-distance capsules (limbs/torso) + a head disc,
// unioned by max-coverage. No canvas / native deps — pure math + zlib PNG.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const RES = 1024;
const FEATHER = 5;               // px of soft edge (anti-alias)
const S = RES / 512;             // spike used 512-space proportions; scale up ×2

// Body parts in 512-space (from the validated spike), then scaled by S.
// Capsule = segment (x0,y0)->(x1,y1) with half-thickness r.
const HEAD = { x: 256, y: 78, r: 36 };
const CAPSULES = [
  { x0: 256, y0: 114, x1: 256, y1: 286, w: 64 }, // torso
  { x0: 250, y0: 146, x1: 190, y1: 262, w: 26 }, // left arm
  { x0: 262, y0: 146, x1: 322, y1: 262, w: 26 }, // right arm
  { x0: 240, y0: 280, x1: 214, y1: 452, w: 32 }, // left leg
  { x0: 272, y0: 280, x1: 298, y1: 452, w: 32 }, // right leg
].map((c) => ({ x0: c.x0 * S, y0: c.y0 * S, x1: c.x1 * S, y1: c.y1 * S, r: (c.w / 2) * S }));
const HEAD_S = { x: HEAD.x * S, y: HEAD.y * S, r: HEAD.r * S };

// Distance from point p to segment a->b.
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// Coverage in [0,1]: 1 well inside a shape, 0 well outside, feathered across the edge.
function coverageAt(px, py) {
  let signedInside = -Infinity; // (r - dist); >0 inside. Take the max over shapes (union).
  signedInside = Math.max(signedInside, HEAD_S.r - Math.hypot(px - HEAD_S.x, py - HEAD_S.y));
  for (const c of CAPSULES) {
    signedInside = Math.max(signedInside, c.r - distToSegment(px, py, c.x0, c.y0, c.x1, c.y1));
  }
  // Map signed distance to coverage across the feather band centred on the edge.
  const cov = 0.5 + signedInside / FEATHER;
  return cov < 0 ? 0 : cov > 1 ? 1 : cov;
}

// Build RGB pixel buffer (opaque). value = round(coverage*255) on all 3 channels.
function buildRGB() {
  const buf = Buffer.alloc(RES * RES * 3);
  for (let y = 0; y < RES; y++) {
    for (let x = 0; x < RES; x++) {
      const v = Math.round(coverageAt(x + 0.5, y + 0.5) * 255);
      const i = (y * RES + x) * 3;
      buf[i] = v; buf[i + 1] = v; buf[i + 2] = v;
    }
  }
  return buf;
}

// --- minimal PNG encoder (color type 2, 8-bit RGB) -------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(rgb, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // color type: truecolor RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // raw scanlines: each row prefixed with filter byte 0
  const stride = w * 3;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// --- write -----------------------------------------------------------------
const outDir = path.join(__dirname, '..', 'public', 'assets', 'silhouettes');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'human_a.png');
fs.writeFileSync(outPath, encodePNG(buildRGB(), RES, RES));
console.log(`wrote ${outPath} (${RES}x${RES})`);
