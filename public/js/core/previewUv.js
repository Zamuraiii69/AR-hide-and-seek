// previewUv.js — pointer → mesh UV mapping for the paint-preview canvas.
//
// Pure coordinate math, no DOM reads: the caller supplies the target's
// bounding rect (typically from `getBoundingClientRect()`) instead of this
// module reading it itself, which is what makes it testable without a DOM.

/**
 * Map a pointer event's client coords to mesh UV, given the target's
 * bounding rect. Pure — no DOM reads. three's v=0 is the bottom, so y flips.
 */
export function toPreviewUV(clientX, clientY, rect, out) {
  out.x = (clientX - rect.left) / rect.width;
  out.y = 1 - (clientY - rect.top) / rect.height;
  return out;
}
