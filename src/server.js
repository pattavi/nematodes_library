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
  res.json({ ok: true, genera: n });
});

// List genera. Filters: q (genus/family/notes), feeding, letter; sort=asc|desc by genus name.
// Shared by the list and the map: q, feeding, letter filters on genera (alias g).
function genusFilter(query) {
  const { q = '', feeding = '', letter = '' } = query;
  const where = [];
  const args = [];
  if (q.trim()) {
    const like = `%${q.trim().replace(/[\\%_]/g, '\\$&')}%`;
    where.push(`(g.genus LIKE ? ESCAPE '\\' OR g.family LIKE ? ESCAPE '\\'
      OR g.notes_th LIKE ? ESCAPE '\\' OR g.notes_en LIKE ? ESCAPE '\\')`);
    args.push(like, like, like, like);
  }
  if (feeding) { where.push('g.feeding_group = ?'); args.push(feeding); }
  if (/^[a-z]$/i.test(letter)) { where.push('g.genus LIKE ?'); args.push(`${letter}%`); }
  return { where, args };
}

app.get('/api/genera', (req, res) => {
  const sort = req.query.sort === 'desc' ? 'DESC' : 'ASC';
  const { where, args } = genusFilter(req.query);
  const sql = `SELECT g.id, g.genus, g.family, g.feeding_group, g.cp_value,
      (SELECT COUNT(*) FROM images i WHERE i.genus_id = g.id) AS image_count,
      (SELECT file FROM images i WHERE i.genus_id = g.id ORDER BY sort_order, id LIMIT 1) AS cover,
      (SELECT COUNT(*) FROM locations l WHERE l.genus_id = g.id) AS location_count
    FROM genera g ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY g.genus COLLATE NOCASE ${sort}`;
  res.json({ items: db.prepare(sql).all(...args) });
});

app.use('/uploads', express.static(UPLOAD_DIR, { fallthrough: false }));

app.get('/api/genera/:id', (req, res) => {
  const id = Number(req.params.id);
  const genus = Number.isInteger(id) ? db.prepare('SELECT * FROM genera WHERE id = ?').get(id) : null;
  if (!genus) return res.status(404).json({ error: 'not_found' });
  genus.images = db.prepare(`SELECT id, file, caption_th, caption_en, credit FROM images
    WHERE genus_id = ? ORDER BY sort_order, id`).all(id);
  genus.locations = db.prepare(`SELECT id, lat, lng, province, collected_at, note, is_sample FROM locations
    WHERE genus_id = ? ORDER BY province, id`).all(id);
  res.json(genus);
});

// ---- create / update / delete (admin only: enforced by auth.guardWrites) ----
const FEEDING_KNOWN = ['plant-parasite', 'bacterivore', 'fungivore', 'predator', 'omnivore', 'entomopathogen'];
const feedingOptions = () => [...new Set([...FEEDING_KNOWN,
  ...db.prepare(`SELECT DISTINCT feeding_group AS k FROM genera WHERE feeding_group IS NOT NULL AND feeding_group != ''`).all().map((r) => r.k)])];

// Returns { value } or { error: { field, code } }. Text is trimmed; empty optional fields become null.
function validateGenus(body, selfId) {
  const b = body && typeof body === 'object' ? body : {};
  const text = (k, max) => {
    const v = b[k];
    if (v == null) return null;
    if (typeof v !== 'string' || v.length > max) throw { field: k, code: 'invalid' };
    return v.trim() || null;
  };
  try {
    const genus = text('genus', 100);
    if (!genus) return { error: { field: 'genus', code: 'required' } };
    const dup = db.prepare('SELECT id FROM genera WHERE genus = ? COLLATE NOCASE').get(genus);
    if (dup && dup.id !== selfId) return { error: { field: 'genus', code: 'duplicate' } };
    const feeding = text('feeding_group', 50);
    if (feeding && !feedingOptions().includes(feeding)) return { error: { field: 'feeding_group', code: 'invalid' } };
    let cp = b.cp_value;
    if (cp === '' || cp == null) cp = null;
    else if (!Number.isInteger(cp) || cp < 1 || cp > 5) return { error: { field: 'cp_value', code: 'invalid' } };
    return { value: {
      genus, family: text('family', 100), feeding_group: feeding, cp_value: cp,
      internal_code: text('internal_code', 50), notes_th: text('notes_th', 5000), notes_en: text('notes_en', 5000),
    } };
  } catch (e) { if (e && e.field) return { error: e }; throw e; }
}

const COLS = ['genus', 'family', 'feeding_group', 'cp_value', 'internal_code', 'notes_th', 'notes_en'];

app.post('/api/genera', (req, res) => {
  const { value, error } = validateGenus(req.body, null);
  if (error) return res.status(error.code === 'duplicate' ? 409 : 400).json({ error: error.code, field: error.field });
  const id = db.prepare(`INSERT INTO genera (${COLS.join(',')}) VALUES (${COLS.map((c) => '@' + c).join(',')})`)
    .run(value).lastInsertRowid;
  res.status(201).json({ id: Number(id) });
});

app.put('/api/genera/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || !db.prepare('SELECT 1 FROM genera WHERE id = ?').get(id)) return res.status(404).json({ error: 'not_found' });
  const { value, error } = validateGenus(req.body, id);
  if (error) return res.status(error.code === 'duplicate' ? 409 : 400).json({ error: error.code, field: error.field });
  db.prepare(`UPDATE genera SET ${COLS.map((c) => `${c} = @${c}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`)
    .run({ ...value, id });
  res.json({ id });
});

app.delete('/api/genera/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).json({ error: 'not_found' });
  const files = db.prepare('SELECT file FROM images WHERE genus_id = ?').all(id).map((r) => r.file);
  const r = db.prepare('DELETE FROM genera WHERE id = ?').run(id); // images/locations rows cascade
  if (!r.changes) return res.status(404).json({ error: 'not_found' });
  files.forEach(removeImageFiles);
  res.json({ ok: true });
});

// ---- provinces and map points ----
app.get('/api/provinces', (req, res) => {
  res.json({ items: Object.entries(PROVINCES).map(([key, th]) => ({ key, th })) });
});

// Points for the map, honouring the same filters as the list plus an optional province.
app.get('/api/locations', (req, res) => {
  const { where, args } = genusFilter(req.query);
  const province = String(req.query.province || '');
  if (province) { where.push('l.province = ?'); args.push(province); }
  const rows = db.prepare(`SELECT l.id, l.genus_id, g.genus, g.feeding_group, l.lat, l.lng, l.province, l.is_sample
    FROM locations l JOIN genera g ON g.id = l.genus_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY g.genus COLLATE NOCASE, l.id`).all(...args);
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

app.post('/api/genera/:id/locations', (req, res) => {
  const gid = Number(req.params.id);
  if (!Number.isInteger(gid) || !db.prepare('SELECT 1 FROM genera WHERE id = ?').get(gid)) return res.status(404).json({ error: 'not_found' });
  const { value, error } = validateLocation(req.body);
  if (error) return res.status(400).json({ error: error.code, field: error.field });
  const id = db.prepare('INSERT INTO locations (genus_id, lat, lng, province, collected_at, note) VALUES (@gid, @lat, @lng, @province, @collected_at, @note)')
    .run({ ...value, gid }).lastInsertRowid;
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

app.post('/api/genera/:id/images', (req, res) => {
  const gid = Number(req.params.id);
  if (!Number.isInteger(gid) || !db.prepare('SELECT 1 FROM genera WHERE id = ?').get(gid)) return res.status(404).json({ error: 'not_found' });
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
    let order = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM images WHERE genus_id = ?').get(gid).m;
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
        const id = db.prepare('INSERT INTO images (genus_id, file, caption_th, caption_en, credit, sort_order) VALUES (?,?,?,?,?,?)')
          .run(gid, name, cleanText(th[i], 300), cleanText(en[i], 300), credit, ++order).lastInsertRowid;
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
