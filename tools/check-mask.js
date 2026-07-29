// tools/check-mask.js — decode human_a.png independently and validate the
// mask contract mask.js relies on: green channel + tight, centered bbox.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const buf = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'silhouettes', 'human_a.png'));
let p = 8; // skip signature
let width, height, idat = [];
while (p < buf.length) {
  const len = buf.readUInt32BE(p); const type = buf.toString('ascii', p + 4, p + 8);
  const data = buf.subarray(p + 8, p + 8 + len);
  if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
  if (type === 'IDAT') idat.push(data);
  if (type === 'IEND') break;
  p += 12 + len;
}
const raw = zlib.inflateSync(Buffer.concat(idat));
const stride = width * 3;
// every row filter byte must be 0 (as written); read green channel.
let x0 = width, y0 = height, x1 = -1, y1 = -1, bodyPx = 0;
for (let y = 0; y < height; y++) {
  const filter = raw[y * (stride + 1)];
  if (filter !== 0) throw new Error(`row ${y} filter ${filter} != 0`);
  for (let x = 0; x < width; x++) {
    const g = raw[y * (stride + 1) + 1 + x * 3 + 1]; // +1 filter, +1 for green
    if (g > 127) {
      bodyPx++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
}
const bbox = { u0: x0 / width, u1: (x1 + 1) / width, v0: 1 - (y1 + 1) / height, v1: 1 - y0 / height };
const cover = (bodyPx / (width * height) * 100).toFixed(1);
console.log(`size ${width}x${height}  body coverage ${cover}%`);
console.log('bbox uv:', JSON.stringify(bbox, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v));
const centeredX = bbox.u0 > 0.2 && bbox.u1 < 0.8;
const tallY = (bbox.v1 - bbox.v0) > 0.7;
console.log(centeredX && tallY ? 'PASS: mask is centered + tall (a plausible standing body)'
                               : 'FAIL: bbox not shaped like a centered body');
