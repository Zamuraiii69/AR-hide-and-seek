# Painting verification

Run `npm test` for the existing checks and `tools/check-paint.mjs`. The new
checks cover 45 coordinate cases (translated models, unequal scales, five
angles and three marker aspect ratios), background affine mapping, stroke
ownership, channel switches, boundary re-entry and stale moves after tracking
loss.

With `npm start` running on port 3000 and `playwright-cli` installed:

```powershell
playwright-cli open http://localhost:3000
playwright-cli --raw run-code --filename=tools/browser-paint-check.js
```

The browser check uses the actual application, Three.js renderer, brush,
paint canvas, image sampler, mask, export and seek texture loader. It mocks
the tracking session, marker API and save endpoint; it writes no database
fixtures. All 24 browser checks passed in Chromium, including:

- Paint in preview, then AR, after moving, scaling and rotating the model.
- Expand/shrink, hide/restore HUD and Escape preserve paint.
- Preview background and both eyedroppers agree with the source marker.
- Opacity affects rendering and preserves the exported PNG.
- Tracking loss ends the AR stroke; reacquisition cannot resume it, and
  preview remains editable without tracking.
- AR framebuffer colour agrees with the preview within two channel values.
- The save payload contains the exact shared paint PNG; the seek loader
  recreates that paint and the saved rotation.
- Expanded preview fits a 390 by 700 viewport.
- A failed marker-image request displays the fallback explanation and keeps
  painting usable. The resulting 404 and fallback warning are expected.

The simulated tracking session does not verify MindAR recognition, real camera
latency, touch hardware, or Safari/iOS behavior. Those require device testing.
The expanded preview fills the app viewport; it does not request the browser's
Fullscreen API. Preview keeps the model upright and inverse-transforms the
marker image beneath it, using the same source image and anchor geometry as
seek. Opacity is an editing aid, and neither it nor the preview background is
included in the saved PNG or transform schema.
