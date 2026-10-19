// Builds a read-only copy of the library into docs/ for GitHub Pages.
//   npm run build:static
// Reads the live database through the app's own API, so the snapshot matches what the server shows.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs');
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');

async function main() {
  const app = require('../src/server');
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p) => {
    const r = await fetch(base + p);
    if (!r.ok) throw new Error(`${p} -> ${r.status}`);
    return r.json();
  };

  try {
    const data = { genus: {}, species: {} };
    data.genera = (await get('/api/genera')).items;
    for (const g of data.genera) {
      const detail = await get(`/api/genera/${g.id}`);
      data.genus[g.id] = detail;
      for (const s of detail.species) data.species[s.id] = await get(`/api/species/${s.id}`);
    }
    data.locations = (await get('/api/locations')).items;
    data.locationProvinces = (await get('/api/locations/provinces')).items;
    data.provinces = (await get('/api/provinces')).items;
    data.meta = await get('/api/meta');

    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(path.join(OUT, 'uploads', 'thumbs'), { recursive: true });
    fs.writeFileSync(path.join(OUT, 'data.json'), JSON.stringify(data));
    fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

    // Pages live under /<repo>/, so absolute "/x" links become relative.
    const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')
      .replace(/(href|src)="\/(favicon\.svg|style\.css|i18n\.js|app\.js)"/g, '$1="$2"')
      .replace('<link rel="stylesheet" href="style.css">', '<link rel="stylesheet" href="style.css">\n<link rel="stylesheet" href="static.css">')
      .replace('<script src="i18n.js"></script>', '<script src="static-shim.js"></script>\n<script src="i18n.js"></script>');
    fs.writeFileSync(path.join(OUT, 'index.html'), html);
    for (const f of ['style.css', 'i18n.js', 'app.js', 'favicon.svg']) fs.copyFileSync(path.join(PUBLIC, f), path.join(OUT, f));
    for (const f of ['static-shim.js', 'static.css']) fs.copyFileSync(path.join(__dirname, 'static', f), path.join(OUT, f));

    // Only pictures that are used by a species, plus their thumbnails.
    const files = new Set(Object.values(data.species).flatMap((s) => s.images.map((i) => i.file)));
    let copied = 0;
    for (const file of files) {
      const thumb = file.replace(/\.[^.]+$/, '.jpg');
      for (const rel of [file, path.join('thumbs', thumb)]) {
        const src = path.join(UPLOADS, rel);
        if (!fs.existsSync(src)) { console.warn(`missing: ${rel}`); continue; }
        fs.copyFileSync(src, path.join(OUT, 'uploads', rel));
        copied++;
      }
    }
    console.log(`docs/ ready: ${data.genera.length} genera, ${Object.keys(data.species).length} species, ${data.locations.length} points, ${copied} image files`);
  } finally {
    server.close();
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
