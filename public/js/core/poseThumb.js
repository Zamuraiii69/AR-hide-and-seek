// poseThumb.js — decode a silhouette PNG into an alpha-only mask-image data URL.
//
// Pose silhouette assets are white-on-black opaque RGB PNGs, same format
// mask.js decodes (green channel = shape, matching alphamap_fragment's `.g`
// sample). A silhouette dropped straight into an <img> shows a black square,
// not a usable button glyph — CSS mask-image needs a real alpha channel, so
// this builds one at boot: rgb = 0, alpha = green channel. The caller then
// uses it as a CSS mask-image with `background: currentColor` so the glyph
// tints with the button's own state instead of being baked to one colour.

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';   // same-origin asset, but keep canvas untainted
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load pose thumbnail ${url}`));
    img.src = url;
  });
}

/**
 * Decode a white-on-black silhouette PNG into a small ALPHA-ONLY data URL:
 * rgb = 0, alpha = green channel. Used as a CSS mask-image so the button can
 * tint the glyph with `background: currentColor` and follow its own state.
 */
export async function poseThumbnail(url, size = 64) {
  const img = await loadImage(url);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(img, 0, 0, size, size);
  const src = ctx.getImageData(0, 0, size, size);

  const out = new Uint8ClampedArray(src.data.length);
  for (let i = 0; i < src.data.length; i += 4) {
    // rgb = 0 (colour comes from `currentColor` via mask-image), alpha = green.
    out[i] = 0;
    out[i + 1] = 0;
    out[i + 2] = 0;
    out[i + 3] = src.data[i + 1];
  }

  ctx.putImageData(new ImageData(out, size, size), 0, 0);
  const dataUrl = canvas.toDataURL();
  canvas.width = canvas.height = 0;
  return dataUrl;
}
