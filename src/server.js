try { process.loadEnvFile(); } catch {} // .env is optional
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const { open } = require('./db');
const { PROVINCES, isProvince } = require('./provinces');

const app = express();
app.disable('x-powered-by');
// Behind a reverse proxy, set TRUST_PROXY=1 so the login lockout sees real client IPs.
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

// Pages only load scripts/styles from this server and cdnjs (Leaflet); map tiles from OpenStreetMap.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com", // inline style="" attributes are used in the UI
  "img-src 'self' data: blob: https://tile.openstreetmap.org https://cdnjs.cloudflare.com",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin', // OSM tile servers require a Referer
  });
  next();
});
const db = open();
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

const auth = require('./auth').create();

app.use(express.json());
app.use('/api', auth.guardWrites);
app.post('/api/login', auth.login);
app.post('/api/logout', auth.logout);
app.get('/api/session', auth.status);
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/upload', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'upload.html')));

app.get('/api/health', (req, res) => {
  const n = db.prepare('SELECT COUNT(*) AS n FROM genera').get().n;
  const s = db.prepare('SELECT COUNT(*) AS n FROM species').get().n;
  res.json({ ok: true, genera: n, species: s });
});

// ---- filters ----
// Free-text search is by name prefix: "a" shows every name starting with a, "ap" narrows it. "Meloidogyne inc" works too.
const likeOf = (q) => `%${q.trim().replace(/[\\%_]/g, '\\$&')}%`;

// Genus level (alias g): a genus matches if its name or any of its "Genus species" names starts with the text.
function genusFilter(query) {
  const { q = '', feeding = '', letter = '' } = query;
  const where = [];
  const args = {};
  if (q.trim()) {
    // List search is by name prefix: typing "a" shows every genus starting with a, "ap" narrows it, and so on.
    // A species also counts when "Genus species" starts with the text (e.g. "Meloidogyne inc").
    where.push(`(g.genus LIKE @q ESCAPE '\\' OR EXISTS (SELECT 1 FROM species s WHERE s.genus_id = g.id
      AND (g.genus || ' ' || s.species) LIKE @q ESCAPE '\\'))`);
    args.q = likeOf(q).slice(1); // anchored at the start: drop the leading %
  }
  if (feeding) { where.push('g.feeding_group = @feeding'); args.feeding = feeding; }
  if (/^[a-z]$/i.test(letter)) { where.push('g.genus LIKE @letter'); args.letter = `${letter}%`; }
  return { where, args };
}

// Species level (aliases g and s): a species matches if its genus name or "Genus species" starts with the text.
function speciesFilter(query) {
  const { q = '', feeding = '', letter = '' } = query;
  const where = [];
  const args = {};
  if (q.trim()) { // same name-prefix search as the genus list
    where.push(`(g.genus LIKE @q ESCAPE '\\' OR (g.genus || ' ' || s.species) LIKE @q ESCAPE '\\')`);
    args.q = likeOf(q).slice(1);
  }
  if (feeding) { where.push('g.feeding_group = @feeding'); args.feeding = feeding; }
  if (/^[a-z]$/i.test(letter)) { where.push('g.genus LIKE @letter'); args.letter = `${letter}%`; }
  return { where, args };
}

const COUNTS = `
  (SELECT COUNT(*) FROM images i JOIN species s2 ON s2.id = i.species_id WHERE s2.genus_id = g.id) AS image_count,
  (SELECT COUNT(*) FROM locations l JOIN species s2 ON s2.id = l.species_id WHERE s2.genus_id = g.id) AS location_count,
  (SELECT COUNT(*) FROM species s2 WHERE s2.genus_id = g.id) AS species_count,
  (SELECT i.file FROM images i JOIN species s2 ON s2.id = i.species_id WHERE s2.genus_id = g.id
     ORDER BY s2.species COLLATE NOCASE, i.sort_order, i.id LIMIT 1) AS cover`;

// List genera. Filters: q, feeding, letter; sort=asc|desc by genus name.
app.get('/api/genera', (req, res) => {
  const sort = req.query.sort === 'desc' ? 'DESC' : 'ASC';
  const { where, args } = genusFilter(req.query);
  const sql = `SELECT g.id, g.genus, g.family, g.feeding_group, g.cp_value, ${COUNTS}
    FROM genera g ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY g.genus COLLATE NOCASE ${sort}`;
  res.json({ items: db.prepare(sql).all(args) });
});

app.use('/uploads', express.static(UPLOAD_DIR, { fallthrough: false }));

const speciesRows = (genusId) => db.prepare(`SELECT s.id, s.species, s.authority,
    (SELECT COUNT(*) FROM images i WHERE i.species_id = s.id) AS image_count,
    (SELECT COUNT(*) FROM locations l WHERE l.species_id = s.id) AS location_count,
    (SELECT i.file FROM images i WHERE i.species_id = s.id ORDER BY i.sort_order, i.id LIMIT 1) AS cover
  FROM species s WHERE s.genus_id = ? ORDER BY s.species COLLATE NOCASE`).all(genusId);

// Genus detail: the genus, its species, and every point of all its species (for the pooled mini map).
app.get('/api/genera/:id', (req, res) => {
  const id = Number(req.params.id);
  const genus = Number.isInteger(id) ? db.prepare('SELECT * FROM genera WHERE id = ?').get(id) : null;
  if (!genus) return res.status(404).json({ error: 'not_found' });
  genus.species = speciesRows(id);
  genus.locations = db.prepare(`SELECT l.id, l.species_id, s.species, l.lat, l.lng, l.province, l.collected_at, l.note, l.is_sample
    FROM locations l JOIN species s ON s.id = l.species_id WHERE s.genus_id = ?
    ORDER BY s.species COLLATE NOCASE, l.province, l.id`).all(id);
  res.json(genus);
});

// Species detail: the species, its genus, images and points.
app.get('/api/species/:id', (req, res) => {
  const id = Number(req.params.id);
  const sp = Number.isInteger(id) ? db.prepare('SELECT * FROM species WHERE id = ?').get(id) : null;
  if (!sp) return res.status(404).json({ error: 'not_found' });
  sp.genus = db.prepare('SELECT id, genus, family, feeding_group, cp_value, notes_th, notes_en FROM genera WHERE id = ?').get(sp.genus_id);
  sp.images = db.prepare(`SELECT id, file, caption_th, caption_en, credit FROM images
    WHERE species_id = ? ORDER BY sort_order, id`).all(id);
  sp.locations = db.prepare(`SELECT id, lat, lng, province, collected_at, note, is_sample FROM locations
    WHERE species_id = ? ORDER BY province, id`).all(id);
  sp.siblings = speciesRows(sp.genus_id).map(({ id: sid, species }) => ({ id: sid, species }));
  res.json(sp);
});

// ---- create / update / delete (admin only: enforced by auth.guardWrites) ----
const FEEDING_KNOWN = ['plant-parasite', 'bacterivore', 'fungivore', 'predator', 'omnivore', 'entomopathogen'];
const feedingOptions = () => [...new Set([...FEEDING_KNOWN,
  ...db.prepare(`SELECT DISTINCT feeding_group AS k FROM genera WHERE feeding_group IS NOT NULL AND feeding_group != ''`).all().map((r) => r.k)])];

const textField = (b, k, max) => {
  const v = b[k];
  if (v == null) return null;
  if (typeof v !== 'string' || v.length > max) throw { field: k, code: 'invalid' };
  return v.trim() || null;
};
const fail = (field, code) => ({ error: { field, code } });
const status = (e) => (e.code === 'duplicate' ? 409 : 400);

// Returns { value } or { error: { field, code } }. Text is trimmed; empty optional fields become null.
function validateGenus(body, selfId) {
  const b = body && typeof body === 'object' ? body : {};
  try {
    const genus = textField(b, 'genus', 100);
    if (!genus) return fail('genus', 'required');
    const dup = db.prepare('SELECT id FROM genera WHERE genus = ? COLLATE NOCASE').get(genus);
    if (dup && dup.id !== selfId) return fail('genus', 'duplicate');
    const feeding = textField(b, 'feeding_group', 50);
    if (feeding && !feedingOptions().includes(feeding)) return fail('feeding_group', 'invalid');
    let cp = b.cp_value;
    if (cp === '' || cp == null) cp = null;
    else if (!Number.isInteger(cp) || cp < 1 || cp > 5) return fail('cp_value', 'invalid');
    return { value: {
      genus, family: textField(b, 'family', 100), feeding_group: feeding, cp_value: cp,
      internal_code: textField(b, 'internal_code', 50), notes_th: textField(b, 'notes_th', 5000), notes_en: textField(b, 'notes_en', 5000),
    } };
  } catch (e) { if (e && e.field) return { error: e }; throw e; }
}

const COLS = ['genus', 'family', 'feeding_group', 'cp_value', 'internal_code', 'notes_th', 'notes_en'];

app.post('/api/genera', (req, res) => {
  const { value, error } = validateGenus(req.body, null);
  if (error) return res.status(status(error)).json({ error: error.code, field: error.field });
  const id = db.prepare(`INSERT INTO genera (${COLS.join(',')}) VALUES (${COLS.map((c) => '@' + c).join(',')})`)
    .run(value).lastInsertRowid;
  res.status(201).json({ id: Number(id) });
});

app.put('/api/genera/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || !db.prepare('SELECT 1 FROM genera WHERE id = ?').get(id)) return res.status(404).json({ error: 'not_found' });
  const { value, error } = validateGenus(req.body, id);
  if (error) return res.status(status(error)).json({ error: error.code, field: error.field });
  db.prepare(`UPDATE genera SET ${COLS.map((c) => `${c} = @${c}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`)
    .run({ ...value, id });
  res.json({ id });
});

app.delete('/api/genera/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).json({ error: 'not_found' });
  const files = db.prepare(`SELECT i.file FROM images i JOIN species s ON s.id = i.species_id WHERE s.genus_id = ?`).all(id).map((r) => r.file);
  const r = db.prepare('DELETE FROM genera WHERE id = ?').run(id); // species, images, locations rows cascade
  if (!r.changes) return res.status(404).json({ error: 'not_found' });
  files.forEach(removeImageFiles);
  res.json({ ok: true });
});

// Species epithet: letters (any script), digits, spaces and . ' ( ) - only. "sp." is the genus-only placeholder.
const EPITHET = /^[\p{L}\p{N} .'()\-]+$/u;

function validateSpecies(body, genusId, selfId) {
  const b = body && typeof body === 'object' ? body : {};
  try {
    const species = textField(b, 'species', 100);
    if (!species) return fail('species', 'required');
    if (!EPITHET.test(species)) return fail('species', 'invalid');
    const dup = db.prepare('SELECT id FROM species WHERE genus_id = ? AND species = ? COLLATE NOCASE').get(genusId, species);
    if (dup && dup.id !== selfId) return fail('species', 'duplicate');
    return { value: {
      species, authority: textField(b, 'authority', 200), internal_code: textField(b, 'internal_code', 50),
      notes_th: textField(b, 'notes_th', 5000), notes_en: textField(b, 'notes_en', 5000),
    } };
  } catch (e) { if (e && e.field) return { error: e }; throw e; }
}

const SCOLS = ['species', 'authority', 'internal_code', 'notes_th', 'notes_en'];

app.post('/api/genera/:id/species', (req, res) => {
  const gid = Number(req.params.id);
  if (!Number.isInteger(gid) || !db.prepare('SELECT 1 FROM genera WHERE id = ?').get(gid)) return res.status(404).json({ error: 'not_found' });
  const { value, error } = validateSpecies(req.body, gid, null);
  if (error) return res.status(status(error)).json({ error: error.code, field: error.field });
  const id = db.prepare(`INSERT INTO species (genus_id, ${SCOLS.join(',')}) VALUES (@gid, ${SCOLS.map((c) => '@' + c).join(',')})`)
    .run({ ...value, gid }).lastInsertRowid;
  res.status(201).json({ id: Number(id) });
});

app.put('/api/species/:id', (req, res) => {
  const id = Number(req.params.id);
  const cur = Number.isInteger(id) ? db.prepare('SELECT genus_id FROM species WHERE id = ?').get(id) : null;
  if (!cur) return res.status(404).json({ error: 'not_found' });
  const { value, error } = validateSpecies(req.body, cur.genus_id, id);
  if (error) return res.status(status(error)).json({ error: error.code, field: error.field });
  db.prepare(`UPDATE species SET ${SCOLS.map((c) => `${c} = @${c}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`)
    .run({ ...value, id });
  res.json({ id });
});

app.delete('/api/species/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).json({ error: 'not_found' });
  const row = db.prepare('SELECT genus_id FROM species WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const files = db.prepare('SELECT file FROM images WHERE species_id = ?').all(id).map((r) => r.file);
  db.prepare('DELETE FROM species WHERE id = ?').run(id); // images and locations cascade
  files.forEach(removeImageFiles);
  res.json({ ok: true, genus_id: row.genus_id });
});

// ---- provinces and map points ----
app.get('/api/provinces', (req, res) => {
  res.json({ items: Object.entries(PROVINCES).map(([key, th]) => ({ key, th })) });
});

// Points for the map, one row per point, honouring the list filters plus an optional province.
app.get('/api/locations', (req, res) => {
  const { where, args } = speciesFilter(req.query);
  const province = String(req.query.province || '');
  if (province) { where.push('l.province = @province'); args.province = province; }
  const rows = db.prepare(`SELECT l.id, l.species_id, s.species, g.id AS genus_id, g.genus, g.feeding_group,
      l.lat, l.lng, l.province, l.is_sample
    FROM locations l JOIN species s ON s.id = l.species_id JOIN genera g ON g.id = s.genus_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY g.genus COLLATE NOCASE, s.species COLLATE NOCASE, l.id`).all(args);
  res.json({ items: rows });
});

// Provinces that actually have points (map filter offers only these).
app.get('/api/locations/provinces', (req, res) => {
  const rows = db.prepare('SELECT province AS key, COUNT(*) AS count FROM locations GROUP BY province ORDER BY province').all();
  res.json({ items: rows.map((r) => ({ ...r, th: PROVINCES[r.key] || r.key })) });
});

// ---- locations (admin) ----
const LAT = [5.5, 20.5], LNG = [97.3, 105.7]; // Thailand bounding box, decimal degrees
function validateLocation(body) {
  const b = body && typeof body === 'object' ? body : {};
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const lat = num(b.lat), lng = num(b.lng);
  if (lat == null || lat < LAT[0] || lat > LAT[1]) return { error: { field: 'lat', code: 'out_of_range' } };
  if (lng == null || lng < LNG[0] || lng > LNG[1]) return { error: { field: 'lng', code: 'out_of_range' } };
  if (typeof b.province !== 'string' || !isProvince(b.province)) return { error: { field: 'province', code: 'invalid' } };
  let when = b.collected_at;
  if (when === '' || when == null) when = null;
  else if (typeof when !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(when) || Number.isNaN(Date.parse(when))) return { error: { field: 'collected_at', code: 'invalid' } };
  let note = b.note;
  if (note == null || note === '') note = null;
  else if (typeof note !== 'string' || note.length > 500) return { error: { field: 'note', code: 'invalid' } };
  else note = note.trim() || null;
  return { value: { lat, lng, province: b.province, collected_at: when, note } };
}

const speciesExists = (id) => Number.isInteger(id) && !!db.prepare('SELECT 1 FROM species WHERE id = ?').get(id);

app.post('/api/species/:id/locations', (req, res) => {
  const sid = Number(req.params.id);
  if (!speciesExists(sid)) return res.status(404).json({ error: 'not_found' });
  const { value, error } = validateLocation(req.body);
  if (error) return res.status(400).json({ error: error.code, field: error.field });
  const id = db.prepare('INSERT INTO locations (species_id, lat, lng, province, collected_at, note) VALUES (@sid, @lat, @lng, @province, @collected_at, @note)')
    .run({ ...value, sid }).lastInsertRowid;
  res.status(201).json({ id: Number(id) });
});

app.put('/api/locations/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || !db.prepare('SELECT 1 FROM locations WHERE id = ?').get(id)) return res.status(404).json({ error: 'not_found' });
  const { value, error } = validateLocation(req.body);
  if (error) return res.status(400).json({ error: error.code, field: error.field });
  db.prepare('UPDATE locations SET lat=@lat, lng=@lng, province=@province, collected_at=@collected_at, note=@note, is_sample=0 WHERE id=@id')
    .run({ ...value, id });
  res.json({ id });
});

app.delete('/api/locations/:id', (req, res) => {
  const r = db.prepare('DELETE FROM locations WHERE id = ?').run(Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

// ---- images (admin) ----
const THUMB_DIR = path.join(UPLOAD_DIR, 'thumbs');
fs.mkdirSync(THUMB_DIR, { recursive: true });
const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp' };
const MAX_BYTES = 10 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 20 } });

function removeImageFiles(file) {
  const base = path.basename(file);
  for (const p of [path.join(UPLOAD_DIR, base), path.join(THUMB_DIR, base.replace(/\.[^.]+$/, '.jpg'))]) {
    try { fs.unlinkSync(p); } catch {}
  }
}

const cleanText = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

app.post('/api/species/:id/images', (req, res) => {
  const sid = Number(req.params.id);
  if (!speciesExists(sid)) return res.status(404).json({ error: 'not_found' });
  upload.array('images', 20)(req, res, async (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'file_too_large' : 'bad_upload' });
    }
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'no_files' });
    const list = (k) => [].concat(req.body[k] ?? []);
    const th = list('caption_th'), en = list('caption_en'), credit = cleanText(req.body.credit, 200);
    const created = [], rejected = [];
    let order = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM images WHERE species_id = ?').get(sid).m;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        const meta = await sharp(f.buffer).metadata(); // real content type, not the client's claim
        const ext = EXT[meta.format];
        if (!ext) throw new Error('type');
        const name = `${crypto.randomUUID()}.${ext}`;
        await sharp(f.buffer).rotate().resize({ width: 480, withoutEnlargement: true }).jpeg({ quality: 80 })
          .toFile(path.join(THUMB_DIR, name.replace(/\.[^.]+$/, '.jpg')));
        fs.writeFileSync(path.join(UPLOAD_DIR, name), f.buffer);
        const id = db.prepare('INSERT INTO images (species_id, file, caption_th, caption_en, credit, sort_order) VALUES (?,?,?,?,?,?)')
          .run(sid, name, cleanText(th[i], 300), cleanText(en[i], 300), credit, ++order).lastInsertRowid;
        created.push({ id: Number(id), file: name });
      } catch {
        rejected.push({ name: String(f.originalname || '').slice(0, 100), error: 'invalid_image' });
      }
    }
    res.status(created.length ? 201 : 400).json({ created, rejected });
  });
});

app.put('/api/images/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || !db.prepare('SELECT 1 FROM images WHERE id = ?').get(id)) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  db.prepare('UPDATE images SET caption_th = ?, caption_en = ?, credit = ? WHERE id = ?')
    .run(cleanText(b.caption_th, 300), cleanText(b.caption_en, 300), cleanText(b.credit, 200), id);
  res.json({ id });
});

app.delete('/api/images/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = Number.isInteger(id) ? db.prepare('SELECT file FROM images WHERE id = ?').get(id) : null;
  if (!row) return res.status(404).json({ error: 'not_found' });
  db.prepare('DELETE FROM images WHERE id = ?').run(id);
  removeImageFiles(row.file);
  res.json({ ok: true });
});

// ---- Excel export (public, read-only) ----
const exporter = require('./export');
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function sendXlsx(res, filename, { buffer, embedded }) {
  res.set({
    'Content-Type': XLSX_TYPE,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'X-Embedded-Images': String(embedded),
    'Cache-Control': 'no-store',
  });
  res.send(Buffer.from(buffer));
}

// Species rows joined with their genus, in the shape export.js expects.
const SPECIES_SELECT = `SELECT s.*, g.genus, g.family, g.feeding_group,
    (SELECT COUNT(*) FROM images i WHERE i.species_id = s.id) AS image_count,
    (SELECT COUNT(*) FROM locations l WHERE l.species_id = s.id) AS location_count
  FROM species s JOIN genera g ON g.id = s.genus_id`;

// scope=all (default): everything. scope=view: honours q, feeding, letter, sort and (map view) province.
app.get('/api/export.xlsx', async (req, res, next) => {
  try {
    const view = req.query.scope === 'view';
    const { where, args } = speciesFilter(view ? req.query : {});
    const province = view ? String(req.query.province || '') : '';
    if (province) {
      where.push('EXISTS (SELECT 1 FROM locations lp WHERE lp.species_id = s.id AND lp.province = @province)');
      args.province = province;
    }
    const W = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const dir = view && req.query.sort === 'desc' ? 'DESC' : 'ASC';
    const order = `ORDER BY g.genus COLLATE NOCASE ${dir}, s.species COLLATE NOCASE`;
    const locAnd = province ? 'AND lc.province = @province' : '';
    const species = db.prepare(`SELECT s.*, g.genus, g.family, g.feeding_group,
        (SELECT COUNT(*) FROM images i WHERE i.species_id = s.id) AS image_count,
        (SELECT COUNT(*) FROM locations lc WHERE lc.species_id = s.id ${locAnd}) AS location_count
      FROM species s JOIN genera g ON g.id = s.genus_id ${W} ${order}`).all(args);
    const genusIds = [...new Set(species.map((s) => s.genus_id))];
    const genera = genusIds.length ? db.prepare(`SELECT g.*, (SELECT COUNT(*) FROM species s WHERE s.genus_id = g.id) AS species_count
      FROM genera g WHERE g.id IN (${genusIds.map(() => '?').join(',')}) ORDER BY g.genus COLLATE NOCASE ${dir}`).all(...genusIds) : [];
    const images = db.prepare(`SELECT i.*, g.genus, s.species FROM images i JOIN species s ON s.id = i.species_id
      JOIN genera g ON g.id = s.genus_id ${W} ${order}, i.sort_order, i.id`).all(args);
    const locations = db.prepare(`SELECT l.*, g.genus, s.species FROM locations l JOIN species s ON s.id = l.species_id
      JOIN genera g ON g.id = s.genus_id ${W} ${W ? 'AND' : 'WHERE'} 1=1 ${province ? 'AND l.province = @province' : ''}
      ${order}, l.id`).all(args);
    const out = await exporter.buildAll({ genera, species, images, locations, embed: req.query.embed === '1', thumbDir: THUMB_DIR });
    sendXlsx(res, `nematodes-${new Date().toISOString().slice(0, 10)}.xlsx`, out);
  } catch (e) { next(e); }
});

app.get('/api/genera/:id/export.xlsx', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const genus = Number.isInteger(id) ? db.prepare('SELECT * FROM genera WHERE id = ?').get(id) : null;
    if (!genus) return res.status(404).json({ error: 'not_found' });
    const species = db.prepare(`${SPECIES_SELECT} WHERE s.genus_id = ? ORDER BY s.species COLLATE NOCASE`).all(id);
    const images = db.prepare(`SELECT i.*, g.genus, s.species FROM images i JOIN species s ON s.id = i.species_id
      JOIN genera g ON g.id = s.genus_id WHERE g.id = ? ORDER BY s.species COLLATE NOCASE, i.sort_order, i.id`).all(id);
    const locations = db.prepare(`SELECT l.*, g.genus, s.species FROM locations l JOIN species s ON s.id = l.species_id
      JOIN genera g ON g.id = s.genus_id WHERE g.id = ? ORDER BY s.species COLLATE NOCASE, l.province, l.id`).all(id);
    const out = await exporter.buildGenus({ genus, species, images, locations, embed: req.query.embed === '1', thumbDir: THUMB_DIR });
    sendXlsx(res, `nematode-${exporter.safeName(genus.genus)}.xlsx`, out);
  } catch (e) { next(e); }
});

app.get('/api/species/:id/export.xlsx', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sp = Number.isInteger(id) ? db.prepare(`${SPECIES_SELECT} WHERE s.id = ?`).get(id) : null;
    if (!sp) return res.status(404).json({ error: 'not_found' });
    const images = db.prepare('SELECT * FROM images WHERE species_id = ? ORDER BY sort_order, id').all(id);
    const locations = db.prepare('SELECT * FROM locations WHERE species_id = ? ORDER BY province, id').all(id);
    const out = await exporter.buildSpecies({ species: sp, images, locations, embed: req.query.embed === '1', thumbDir: THUMB_DIR });
    sendXlsx(res, `nematode-${exporter.safeName(`${sp.genus}_${sp.species}`)}.xlsx`, out);
  } catch (e) { next(e); }
});

// Values that exist in the data, so the UI only offers real choices.
app.get('/api/meta', (req, res) => {
  const feeding = db.prepare(`SELECT feeding_group AS key, COUNT(*) AS count FROM genera
    WHERE feeding_group IS NOT NULL AND feeding_group != '' GROUP BY feeding_group ORDER BY feeding_group`).all();
  const letters = db.prepare(`SELECT DISTINCT UPPER(SUBSTR(genus,1,1)) AS l FROM genera ORDER BY l`).all().map((r) => r.l);
  res.json({ feeding, letters, feeding_options: feedingOptions() });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

// Never leak server paths or stack traces in error responses.
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: status === 404 ? 'not_found' : status < 500 ? 'bad_request' : 'server_error' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
}

module.exports = app;
