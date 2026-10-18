const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'nematodes.db');

function open(file = DB_PATH) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS genera (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      genus         TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(genus)) > 0),
      family        TEXT,
      feeding_group TEXT,
      cp_value      INTEGER CHECK (cp_value IS NULL OR cp_value BETWEEN 1 AND 5),
      internal_code TEXT,
      notes_th      TEXT,
      notes_en      TEXT,
      is_sample     INTEGER NOT NULL DEFAULT 0,
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS images (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      genus_id   INTEGER NOT NULL REFERENCES genera(id) ON DELETE CASCADE,
      file       TEXT NOT NULL,
      caption_th TEXT,
      caption_en TEXT,
      credit     TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS locations (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      genus_id     INTEGER NOT NULL REFERENCES genera(id) ON DELETE CASCADE,
      lat          REAL NOT NULL CHECK (lat BETWEEN 5.5 AND 20.5),
      lng          REAL NOT NULL CHECK (lng BETWEEN 97.3 AND 105.7),
      province     TEXT NOT NULL CHECK (length(trim(province)) > 0),
      collected_at TEXT,
      note         TEXT,
      is_sample    INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_images_genus ON images(genus_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_locations_genus ON locations(genus_id);
    CREATE INDEX IF NOT EXISTS idx_locations_province ON locations(province);
  `);
  return db;
}

module.exports = { open, DB_PATH };
