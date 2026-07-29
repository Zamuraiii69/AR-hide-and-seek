# AR Status — Shared AR Experience PoC

Two (or more) phones point their cameras at the **same marker image**. That image is the
shared **origin (0,0,0)**. Each device computes its camera pose relative to the marker and
broadcasts it over WebSockets. Every device renders a floating **"AR status"** label at the
real-world position of each other connected user.

Works on **iPhone (Safari)** and **Android (Chrome)** — it uses [MindAR](https://github.com/hiukim/mind-ar-js)
image tracking in the browser (not WebXR, which iOS does not support).

```
AR status/
├── package.json
├── server.js              # Express + Socket.io relay
├── README.md
└── public/
    ├── index.html
    ├── app.js             # three.js + MindAR + pose sync
    ├── targets.mind       # << YOU PROVIDE (compiled marker) — see step 2
    └── marker.png         # << YOU PROVIDE (the image to point at)
```

## Run locally

```bash
npm install
npm start            # http://localhost:3000
```

## Step 2 — the marker (required before AR works)

You need two files in `public/`:

- **`marker.png`** — the image everyone points their camera at (display it on a laptop screen
  or print it). Use a **feature-rich** image (a photo/poster). **Do NOT use a QR code** — flat
  high-contrast codes track poorly.
- **`targets.mind`** — the compiled version of that image.

Compile with the official tool: <https://hiukim.github.io/mind-ar-js-doc/tools/compile>
→ upload your image → download `targets.mind` → drop both files into `public/`.

### Quick start without compiling (use MindAR's sample card)

Want to test immediately? Use MindAR's example "card" target:

1. In `public/app.js` set:
   ```js
   imageTargetSrc: 'https://cdn.jsdelivr.net/gh/hiukim/mind-ar-js@1.2.5/examples/image-tracking/assets/card-example/card.mind'
   ```
2. Point both phones at the example card image:
   <https://github.com/hiukim/mind-ar-js/blob/master/examples/image-tracking/assets/card-example/card.png>
   (open it on a laptop screen).

## Step 3 — test on real phones (camera needs HTTPS)

```bash
npx ngrok http 3000        # → https://xxxx.ngrok-free.app
```

Open the **https** ngrok URL on each phone → tap **Start AR** → allow camera → point both at the
same marker. Each phone shows a red cube + "AR status" label where the other user is.

## How the shared origin works

- `mindarThree.addAnchor(0)` → `anchor.group` is the marker pose **in camera space**.
- This camera's pose relative to the marker = `inverse(anchor.group.matrixWorld)` → broadcast it.
- Peer poses are added as **children of `anchor.group`**, so they are placed in marker-relative
  coordinates automatically on every device — no manual coordinate conversion needed.

## Verify

- **Relay:** open two desktop tabs, watch the server console + browser console — one emits
  `pose_update`, the other receives it and spawns a mesh.
- **Tracking:** the green debug cube appears on the marker when detected.
- **Shared origin:** move phone A and watch A's label move on phone B's screen.
- **Cleanup:** close one tab → its label disappears on the other (`user_left`).

## Notes / limits (PoC)

- iOS requires a user gesture (the Start button) + HTTPS to open the camera.
- Marker-based accuracy depends on image quality and lighting; pose stops updating when the
  marker leaves the frame.
- The original prompt's **WebXR `image-tracking`** approach was dropped because iOS Safari has no
  WebXR support and the feature is experimental (Android + chrome flag only).
