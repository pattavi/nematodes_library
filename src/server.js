try { process.loadEnvFile(); } catch {} // .env is optional
const express = require('express');
const path = require('path');
const { open } = require('./db');

const app = express();
const db = open();

const auth = require('./auth').create();

app.use(express.json());
app.use('/api', auth.guardWrites);
app.post('/api/login', auth.login);
app.post('/api/logout', auth.logout);
app.get('/api/session', auth.status);
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (req, res) => {
  const n = db.prepare('SELECT COUNT(*) AS n FROM genera').get().n;
  res.json({ ok: true, genera: n });
});

// List genera. Filters: q (genus/family/notes), feeding, letter; sort=asc|desc by genus name.
app.get('/api/genera', (req, res) => {
  const { q = '', feeding = '', letter = '' } = req.query;
  const sort = req.query.sort === 'desc' ? 'DESC' : 'ASC';
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
  const sql = `SELECT g.id, g.genus, g.family, g.feeding_group, g.cp_value,
      (SELECT COUNT(*) FROM images i WHERE i.genus_id = g.id) AS image_count,
      (SELECT COUNT(*) FROM locations l WHERE l.genus_id = g.id) AS location_count
    FROM genera g ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY g.genus COLLATE NOCASE ${sort}`;
  res.json({ items: db.prepare(sql).all(...args) });
});

app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), { fallthrough: false }));

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
  for (const f of files) {
    const p = path.join(__dirname, '..', 'uploads', path.basename(f));
    try { require('fs').unlinkSync(p); } catch {}
  }
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
