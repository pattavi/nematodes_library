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

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
}

module.exports = app;
