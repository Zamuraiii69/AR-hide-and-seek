// server/db.js — node:sqlite open + migrate + prepared statements
//
// Uses the built-in `node:sqlite` (stable in Node v24.15.0, no native build).
// API note: DatabaseSync has NO `db.transaction()` helper — we drive
// BEGIN / COMMIT / ROLLBACK by hand where atomicity is needed.

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'app.db');
const db = new DatabaseSync(DB_PATH);

// WAL for concurrent read while writing; enforce FK cascade deletes.
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// --- Schema (idempotent) --------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS markers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | ready
  image_path TEXT, mind_path TEXT,
  image_width INTEGER NOT NULL, image_height INTEGER NOT NULL,
  aspect REAL NOT NULL,                        -- h/w — client needs before first frame
  palette_json TEXT NOT NULL DEFAULT '[]',     -- dominant colours (whole image)
  grid_json TEXT NOT NULL DEFAULT '[]',        -- per-cell average colour 4x4
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marker_id INTEGER NOT NULL REFERENCES markers(id) ON DELETE CASCADE,
  hider_name TEXT, silhouette_id TEXT NOT NULL DEFAULT 'human_a',
  pos_x REAL NOT NULL, pos_y REAL NOT NULL, rot_z REAL NOT NULL DEFAULT 0,
  size_w REAL NOT NULL, size_h REAL NOT NULL,   -- all anchor-local units
  paint_path TEXT NOT NULL, paint_res INTEGER NOT NULL DEFAULT 512,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hides_marker ON hides(marker_id, is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS seeks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hide_id INTEGER NOT NULL REFERENCES hides(id) ON DELETE CASCADE,
  seeker_name TEXT, found INTEGER NOT NULL, taps_used INTEGER NOT NULL,
  duration_ms INTEGER, taps_json TEXT NOT NULL DEFAULT '[]',   -- [{u,v,hit}] -> heatmap
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_seeks_hide ON seeks(hide_id);
`);

db.exec(`
UPDATE markers
SET status = CASE
  WHEN image_path IS NOT NULL AND mind_path IS NOT NULL THEN 'ready'
  ELSE 'pending'
END;
`);

// --- Prepared statements ---------------------------------------------------
// Grouped by table; reused across requests. node:sqlite .run() returns
// { changes, lastInsertRowid }; .get()/.all() return plain objects.
const stmt = {
  markers: {
    insert: db.prepare(`
      INSERT INTO markers (slug, name, image_width, image_height, aspect, palette_json, grid_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)`),
    byId: db.prepare('SELECT * FROM markers WHERE id = ?'),
    bySlug: db.prepare('SELECT * FROM markers WHERE slug = ?'),
    listWithHideCount: db.prepare(`
      SELECT m.*, (SELECT COUNT(*) FROM hides h WHERE h.marker_id = m.id AND h.is_active = 1) AS hide_count
      FROM markers m
      ORDER BY m.created_at DESC`),
    setImage: db.prepare(`
       UPDATE markers SET image_path = ?, image_width = ?, image_height = ?, aspect = ?,
         status = CASE WHEN mind_path IS NOT NULL THEN 'ready' ELSE 'pending' END
       WHERE id = ?`),
    setTarget: db.prepare(`
      UPDATE markers SET mind_path = ?,
        status = CASE WHEN image_path IS NOT NULL THEN 'ready' ELSE 'pending' END
      WHERE id = ?`),
    hideCount: db.prepare('SELECT COUNT(*) AS n FROM hides WHERE marker_id = ? AND is_active = 1'),
  },
  hides: {
    insert: db.prepare(`
      INSERT INTO hides (marker_id, hider_name, silhouette_id, pos_x, pos_y, rot_z, size_w, size_h, paint_path, paint_res)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    byId: db.prepare('SELECT * FROM hides WHERE id = ?'),
    setPaintPath: db.prepare('UPDATE hides SET paint_path = ? WHERE id = ?'),
    byMarker: db.prepare(`
      SELECT * FROM hides WHERE marker_id = ? AND is_active = 1
      ORDER BY created_at DESC`),
    seekStats: db.prepare(`
      SELECT COUNT(*) AS attempts, COALESCE(SUM(found), 0) AS found_count
      FROM seeks WHERE hide_id = ?`),
  },
  seeks: {
    insert: db.prepare(`
      INSERT INTO seeks (hide_id, seeker_name, found, taps_used, duration_ms, taps_json)
      VALUES (?, ?, ?, ?, ?, ?)`),
  },
};

// Manual transaction helper (no db.transaction() in node:sqlite).
function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { db, stmt, tx, DATA_DIR, DB_PATH };
