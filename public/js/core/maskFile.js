// maskFile.js — thin DOM glue around maskNormalize.js. Owns getting a File
// into a MASK_RES² RGBA buffer (createImageBitmap, contain-fit canvas draw,
// getImageData) and turning the resulting mask back into a blob + preview
// URL. All the actual extraction logic lives in the pure, DOM-free
// maskNormalize.js — uploadApp.js calls only this module and never touches
// a pixel itself.

import { MASK_RES, MASK_LIMITS, maskFromRgba } from './maskNormalize.js';

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the mask as PNG.'))),
    'image/png',
  ));
}

// Contain-fit — not stretch: a non-square upload stretched to square would
// deform the body, and the resulting hit test would not match what the
// player drew. Cleared to transparent first so a source with real alpha
// keeps its actual transparency outside the fitted region.
function drawContainFit(bitmap, res) {
  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, res, res);
  const scale = Math.min(res / bitmap.width, res / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (res - w) / 2, (res - h) / 2, w, h);
  return ctx;
}

// The rules that bite here are coverage and a non-empty bbox — after
// normalisation the output contains only 0 and 255, so bimodalRatio is
// 100% by construction and the bimodal rule catches nothing on this path.
function evaluate(coverage, bbox) {
  if (!bbox) return 'อ่านรูปทรงจากไฟล์นี้ไม่ได้ — ลองใช้ PNG พื้นหลังโปร่งใส';
  if (coverage < MASK_LIMITS.minCoverage) {
    return `รูปทรงเล็กเกินไป (${coverage.toFixed(1)}%) — ลองครอปให้ตัวเต็มเฟรมกว่านี้`;
  }
  if (coverage > MASK_LIMITS.maxCoverage) {
    return `รูปทรงใหญ่เกินไป (${coverage.toFixed(0)}%) — เกมจะหาง่ายเกิน ลองครอปให้เหลือแค่ตัวคน`;
  }
  return null;
}

// normalizeMaskFile(file) -> { blob, previewDataUrl, coverage, bimodalRatio,
// bbox, source, ok, error }. The preview is the normalised mask (white on
// black), not the original file — the player must see the shape the game
// will use, not the source image.
export async function normalizeMaskFile(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const ctx = drawContainFit(bitmap, MASK_RES);
    const { data } = ctx.getImageData(0, 0, MASK_RES, MASK_RES);
    const { bytes, coverage, bimodalRatio, bbox, source } = maskFromRgba(data, MASK_RES);

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = MASK_RES;
    maskCanvas.height = MASK_RES;
    maskCanvas.getContext('2d').putImageData(new ImageData(bytes, MASK_RES, MASK_RES), 0, 0);

    const blob = await canvasBlob(maskCanvas);
    const previewDataUrl = maskCanvas.toDataURL('image/png');
    const error = evaluate(coverage, bbox);

    return { blob, previewDataUrl, coverage, bimodalRatio, bbox, source, ok: !error, error };
  } finally {
    bitmap.close();
  }
}
