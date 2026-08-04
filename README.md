# AR hide and seek

Meccha Chameleon is a browser-based AR hide-and-seek proof of concept. A hider
places and paints a silhouette against a marker image, shares the hunt link, and
a seeker gets a limited number of taps to find it. MindAR tracks the marker,
three.js renders the camouflage, and Express with `node:sqlite` stores markers,
hides, attempts, and heatmap coordinates.

## Requirements

- Node.js 24 or newer
- A desktop browser for marker upload and MindAR target compilation
- An HTTPS URL for camera access on phones

## Run

```bash
npm install
npm start
```

Open <http://localhost:3000>. Upload a detailed marker image on desktop, then use
the marker menu to hide something or find a random active hide.

Marker compilation is CPU-heavy and can make a mobile browser unresponsive, so
the upload form is desktop-only by default. Tablets can use the explicit
continue option.

## Test On Phones

Camera access requires HTTPS outside localhost. Expose the local server with
ngrok:

```bash
npx ngrok http 3000
```

Open the resulting `https://…ngrok-free.app` URL on each phone. The hider can use
the system share sheet or copy the generated hunt link. Both phones must point
at the same physical marker image.

## Analytics

After a hunt, open `/stats.html?hide=<id>` to see attempts, found rate, average
taps, and a marker-space tap overlay. Hit and miss coordinates are stored with
each seek attempt; the view displays at most the latest 200 attempts.

## Verification

```bash
npm test
```

This runs the mask, palette/marker sampler, and seek/backdrop checks in sequence.
The physical-device checks still matter: camera permission, marker tracking,
distance gating, share-sheet behavior, and camouflage under different lighting
cannot be established by the Node test suite.

## Storage

SQLite data and uploaded media are written under `data/` by default. Set
`DATA_DIR` to use another directory. This PoC has no accounts or authorization;
do not expose it as a production service.
