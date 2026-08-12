// tools/check-pose.mjs — Phase 9 unit checks for the pure preview-UV mapping.
//
// toPreviewUV is a 4-line function, but the y-flip is exactly the kind of
// thing that silently paints every stroke upside down with nothing catching
// it — it was only ever checked by manual browser observation during
// Task 9. These cases pin down the flip direction against a known rect.
// Imports the real browser module directly (public/js is type:module).
//
// Run: node tools/check-pose.mjs

import { toPreviewUV } from '../public/js/core/previewUv.js';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

const rect = { left: 10, top: 20, width: 100, height: 100 };
const out = { x: NaN, y: NaN };

// Top-left corner of the rect: top of the screen = top of the body = v close
// to 1 (three's v=0 is the bottom). This is the exact case that would
// silently invert if the flip were backwards.
toPreviewUV(10, 20, rect, out);
check(
  'top-left corner of the rect -> uv ~ {x:0, y:1}',
  near(out.x, 0) && near(out.y, 1),
  `got {x:${out.x}, y:${out.y}}`,
);

// Bottom-right corner: uv ~ {x:1, y:0}.
toPreviewUV(110, 120, rect, out);
check(
  'bottom-right corner of the rect -> uv ~ {x:1, y:0}',
  near(out.x, 1) && near(out.y, 0),
  `got {x:${out.x}, y:${out.y}}`,
);

// Centre: uv ~ {x:0.5, y:0.5}.
toPreviewUV(60, 70, rect, out);
check(
  'centre of the rect -> uv ~ {x:0.5, y:0.5}',
  near(out.x, 0.5) && near(out.y, 0.5),
  `got {x:${out.x}, y:${out.y}}`,
);

// A point well below top+height falls outside the rect. The function does
// NOT clamp — the caller (hideApp.js) owns the [0,1] range check, not this
// function — so uv.y must come out negative here, not 0.
toPreviewUV(10, 220, rect, out);
check(
  'point below the rect is not clamped -> uv.y is negative',
  out.y < 0,
  `got y:${out.y}`,
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
