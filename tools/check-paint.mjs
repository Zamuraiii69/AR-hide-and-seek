import assert from 'node:assert/strict';
import { localToMeshUV } from '../public/js/core/anchorPick.js';
import { createPaintStroke, meshUVToMarkerUV, markerPreviewTransform } from '../public/js/core/paintInput.js';

// Forward/inverse agreement and the actual canvas affine transform must agree
// at off-centre points, including nonuniform scale and portrait markers.
let cases = 0;
for (const angle of [0, Math.PI / 2, -Math.PI / 2, Math.PI, 0.731]) {
  for (const aspect of [0.6, 1, 1.7]) {
    const mesh = { position: { x: 0.12, y: -0.09 }, scale: { x: 0.32, y: 0.21 }, rotation: { z: angle } };
    const matrix = markerPreviewTransform(mesh, aspect, 640, 640, 1200, 1200 * aspect);
    for (const uv of [{ x: 0, y: 1 }, { x: 0.3, y: 0.72 }, { x: 1, y: 0 }]) {
      const marker = meshUVToMarkerUV(uv, mesh, aspect);
      const roundtrip = localToMeshUV({ x: marker.x - 0.5, y: (marker.y - 0.5) * aspect }, mesh, {});
      assert.ok(Math.abs(roundtrip.x - uv.x) < 1e-10 && Math.abs(roundtrip.y - uv.y) < 1e-10);
      const px = marker.x * 1200, py = (1 - marker.y) * 1200 * aspect;
      const [a, b, c, d, e, f] = matrix;
      assert.ok(Math.abs(a * px + c * py + e - uv.x * 640) < 1e-8);
      assert.ok(Math.abs(b * px + d * py + f - (1 - uv.y) * 640) < 1e-8);
      cases++;
    }
  }
}
const events = [];
const brush = Object.fromEntries(['start', 'move', 'end'].map(name => [name, () => events.push(name)]));
const stroke = createPaintStroke(brush, (u, v) => u > 0 && u < 1 && v > 0 && v < 1);
const uv = { x: 0.5, y: 0.5 };
stroke.begin('ar', uv); stroke.move('ar', uv); stroke.end('ar');
const ended = events.length;
stroke.move('ar', uv); // tracking reacquired while the old finger is still down
assert.equal(events.length, ended);
stroke.begin('preview', uv); stroke.move('preview', uv);
stroke.end('ar'); // stale release / tracking loss cannot cancel the preview
assert.equal(events.at(-1), 'move');
stroke.move('preview', { x: -1, y: 0 }); stroke.move('preview', uv);
assert.equal(events.at(-1), 'start'); // never bridge across an invalid region
stroke.begin('ar', uv);
const switched = events.length;
stroke.move('preview', uv); stroke.end('preview');
assert.equal(events.length, switched);
stroke.move('ar', uv); assert.equal(events.at(-1), 'move');
stroke.end();
console.log(`PASS ${cases} transformed coordinate / backdrop cases; shared stroke ownership, tracking loss, channel switches and boundary re-entry`);
