try { process.loadEnvFile(); } catch {} // .env is optional
const express = require('express');
const path = require('path');
const { open } = require('./db');

const app = express();
const db = open();

app.use(express.json());
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

// Values that exist in the data, so the UI only offers real choices.
app.get('/api/meta', (req, res) => {
  const feeding = db.prepare(`SELECT feeding_group AS key, COUNT(*) AS count FROM genera
    WHERE feeding_group IS NOT NULL AND feeding_group != '' GROUP BY feeding_group ORDER BY feeding_group`).all();
  const letters = db.prepare(`SELECT DISTINCT UPPER(SUBSTR(genus,1,1)) AS l FROM genera ORDER BY l`).all().map((r) => r.l);
  res.json({ feeding, letters });
});

const PORT =process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
}

module.exports = app;
