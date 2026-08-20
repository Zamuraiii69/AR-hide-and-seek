// server/pngDecode.js — minimal PNG decoder for the silhouette assets and
// uploads. Handles filters 0-4 and colour types 0/2/4/6, non-interlaced,
// 8-bit only (the format the mask contract requires). Extracted from
// tools/check-mask.js so server/maskContract.js and the driver script share
// one implementation instead of two copies drifting apart.
const zlib = require('zlib');

function decodePng(buf) {
  let p = 8, width, height, color, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error(`bit depth ${data[8]} unsupported`);
      if (data[12] !== 0) throw new Error('interlaced');
      color = data[9];
    }
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') break;
    p += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[color];
  if (!channels) throw new Error(`colour type ${color} unsupported`);
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

// For color type 0 (grayscale, 1 channel) and 4 (grayscale+alpha, 2 channels),
// use channel 0. For color type 2 (RGB, 3 channels) and 6 (RGBA, 4 channels),
// use channel 1 (green).
function getGreenChannel(decoded, x, y) {
  const { width, channels, color, data } = decoded;
  const pixelOffset = y * width * channels + x * channels;
  const greenIndex = (color === 0 || color === 4) ? 0 : 1;
  return data[pixelOffset + greenIndex];
}

module.exports = { decodePng, getGreenChannel };
