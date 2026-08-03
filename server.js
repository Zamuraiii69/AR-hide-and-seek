// Meccha Chameleon — Web AR Hide & Seek (PoC) server
// Node.js + Express + node:sqlite. No realtime: game flow is async through the DB.
//
// Responsibilities:
//   1. Serve the static frontend from /public
//   2. Serve immutable media (marker images/.mind, painted textures) from /media
//   3. Expose the JSON API under /api (markers, hides, seeks)

const path = require('path');
const express = require('express');

const { MEDIA_DIR } = require('./server/storage');
const { db } = require('./server/db');
const markersRouter = require('./server/routes/markers');
const hidesRouter = require('./server/routes/hides');
const seeksRouter = require('./server/routes/seeks');

const app = express();
const PORT = process.env.PORT || 3000;

// JSON bodies can carry an 8 MB paint dataURL — the express default 100kb
// would 413 silently. Raw binary PUTs set their own type/limit in the routers.
app.use(express.json({ limit: '8mb' }));

// --- Static frontend -------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

// --- Immutable media -------------------------------------------------------
// API responses add ?v=<file mtime> to media URLs, so long-cache them.
app.use('/media', express.static(MEDIA_DIR, {
  immutable: true,
  maxAge: '1y',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.mind')) res.type('application/octet-stream');
  },
}));

// --- API -------------------------------------------------------------------
app.use('/api/markers', markersRouter);
app.use('/api/hides', hidesRouter);
app.use('/api/seeks', seeksRouter);

// Health check
app.get('/health', (_req, res) => {
  db.prepare('SELECT 1 AS ok').get();
  res.json({ ok: true });
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not found' });
});

app.use((err, req, res, _next) => {
  const isApi = req.originalUrl && req.originalUrl.startsWith('/api');
  const status =
    err.type === 'entity.too.large' ? 413 :
    err.type === 'entity.parse.failed' ? 400 :
    err.statusCode || err.status || 500;

  if (!isApi) {
    res.status(status).send(status >= 500 ? 'Internal Server Error' : err.message);
    return;
  }

  const message =
    status === 413 ? 'request body too large' :
    status === 400 && err.type === 'entity.parse.failed' ? 'invalid JSON body' :
    status >= 500 ? 'internal server error' :
    err.message || 'request failed';
  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log('Meccha Chameleon PoC server running:');
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Expose for mobile testing with:  ngrok http ${PORT}`);
});
