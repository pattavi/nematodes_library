const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'nematodes.db');

// Schema v2: genera (genus level) -> species -> images / locations.
// Images and locations belong to a species. A record only identified to genus uses the species "sp.".
const SCHEMA = `
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

  CREATE TABLE IF NOT EXISTS species (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    genus_id      INTEGER NOT NULL REFERENCES genera(id) ON DELETE CASCADE,
    species       TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(species)) > 0),
    authority     TEXT,
    internal_code TEXT,
    notes_th      TEXT,
    notes_en      TEXT,
    is_sample     INTEGER NOT NULL DEFAULT 0,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (genus_id, species)
  );

  CREATE TABLE IF NOT EXISTS images (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    species_id INTEGER NOT NULL REFERENCES species(id) ON DELETE CASCADE,
    file       TEXT NOT NULL,
    caption_th TEXT,
    caption_en TEXT,
    credit     TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS locations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    species_id   INTEGER NOT NULL REFERENCES species(id) ON DELETE CASCADE,
    lat          REAL NOT NULL CHECK (lat BETWEEN 5.5 AND 20.5),
    lng          REAL NOT NULL CHECK (lng BETWEEN 97.3 AND 105.7),
    province     TEXT NOT NULL CHECK (length(trim(province)) > 0),
    collected_at TEXT,
    note         TEXT,
    is_sample    INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_species_genus ON species(genus_id);
  CREATE INDEX IF NOT EXISTS idx_images_species ON images(species_id, sort_order);
  CREATE INDEX IF NOT EXISTS idx_locations_species ON locations(species_id);
  CREATE INDEX IF NOT EXISTS idx_locations_province ON locations(province);
`;

const hasColumn = (db, table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);

// v1 -> v2: images/locations used to hang off genera directly. Every genus that has any of them
// gets a species "sp." and its images/locations move there. Nothing is deleted.
function migrateV1(db) {
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(SCHEMA.split('CREATE TABLE IF NOT EXISTS images')[0]); // genera + species only
      db.exec(`INSERT OR IGNORE INTO species (genus_id, species, is_sample)
               SELECT id, 'sp.', is_sample FROM genera
               WHERE id IN (SELECT genus_id FROM images UNION SELECT genus_id FROM locations)`);
      db.exec('ALTER TABLE images RENAME TO images_v1; ALTER TABLE locations RENAME TO locations_v1;');
      db.exec('DROP INDEX IF EXISTS idx_images_genus; DROP INDEX IF EXISTS idx_locations_genus; DROP INDEX IF EXISTS idx_locations_province;');
      db.exec(SCHEMA); // creates the new images/locations + indexes (genera/species already exist)
      db.exec(`INSERT INTO images (id, species_id, file, caption_th, caption_en, credit, sort_order)
               SELECT i.id, s.id, i.file, i.caption_th, i.caption_en, i.credit, i.sort_order
               FROM images_v1 i JOIN species s ON s.genus_id = i.genus_id AND s.species = 'sp.'`);
      db.exec(`INSERT INTO locations (id, species_id, lat, lng, province, collected_at, note, is_sample)
               SELECT l.id, s.id, l.lat, l.lng, l.province, l.collected_at, l.note, l.is_sample
               FROM locations_v1 l JOIN species s ON s.genus_id = l.genus_id AND s.species = 'sp.'`);
      const lost = db.prepare(`SELECT (SELECT COUNT(*) FROM images_v1) - (SELECT COUNT(*) FROM images) AS i,
                                      (SELECT COUNT(*) FROM locations_v1) - (SELECT COUNT(*) FROM locations) AS l`).get();
      if (lost.i !== 0 || lost.l !== 0) throw new Error(`migration would lose rows: ${JSON.stringify(lost)}`); // rolls back
      db.exec('DROP TABLE images_v1; DROP TABLE locations_v1;');
      db.pragma('user_version = 2');
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

function open(file = DB_PATH) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const hasOld = hasColumn(db, 'locations', 'genus_id');
  if (hasOld) migrateV1(db);
  else {
    db.exec(SCHEMA);
    if (db.pragma('user_version', { simple: true }) < 2) db.pragma('user_version = 2');
  }
  return db;
}

module.exports = { open, DB_PATH };
