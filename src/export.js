const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { PROVINCES } = require('./provinces');

// Thai-capable font so Thai text does not depend on font fallback.
const FONT = { name: 'Tahoma', size: 10 };
const HEAD_FONT = { name: 'Tahoma', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F6F4E' } };
const MAX_EMBED = 200; // pictures embedded per workbook; keeps files and memory reasonable
const IMG_COL_W = 22, IMG_ROW_H = 90;

const FEEDING = {
  'plant-parasite': ['ปรสิตพืช', 'Plant parasite'],
  bacterivore: ['กินแบคทีเรีย', 'Bacterivore'],
  fungivore: ['กินเชื้อรา', 'Fungivore'],
  predator: ['ผู้ล่า', 'Predator'],
  omnivore: ['กินทั้งสองแบบ', 'Omnivore'],
  entomopathogen: ['ก่อโรคแมลง', 'Entomopathogen'],
};
const feedTh = (k) => (k ? (FEEDING[k] || [k, k])[0] : '');
const feedEn = (k) => (k ? (FEEDING[k] || [k, k])[1] : '');
const provTh = (k) => PROVINCES[k] || k || '';

function sheet(wb, name, columns) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map(([header, key, width]) => ({ header, key, width }));
  const head = ws.getRow(1);
  head.font = HEAD_FONT; head.fill = HEAD_FILL; head.alignment = { vertical: 'middle', wrapText: true };
  return ws;
}

function styleBody(ws) {
  ws.eachRow((row, n) => {
    if (n === 1) return;
    row.font = FONT;
    row.alignment = { vertical: 'top', wrapText: true };
  });
}

// Embeds each image's thumbnail next to its row. Returns how many pictures were embedded.
function embedImages(wb, ws, rows, thumbDir, col) {
  let done = 0;
  ws.getColumn(col + 1).width = IMG_COL_W;
  rows.forEach((im, i) => {
    if (done >= MAX_EMBED) return;
    const thumb = path.join(thumbDir, path.basename(im.file).replace(/\.[^.]+$/, '.jpg'));
    if (!fs.existsSync(thumb)) return;
    const id = wb.addImage({ buffer: fs.readFileSync(thumb), extension: 'jpeg' });
    const rowNo = i + 2; // row 1 is the header
    ws.getRow(rowNo).height = IMG_ROW_H;
    ws.addImage(id, { tl: { col, row: rowNo - 1 }, ext: { width: 120, height: 88 } });
    done++;
  });
  return done;
}

function addGenera(wb, genera) {
  const ws = sheet(wb, 'Genera', [
    ['ID', 'id', 6], ['Genus', 'genus', 20], ['Family', 'family', 18],
    ['Feeding group (TH)', 'feed_th', 16], ['Feeding group (EN)', 'feed_en', 16], ['c-p', 'cp', 6],
    ['Internal code', 'code', 14], ['Notes (TH)', 'notes_th', 40], ['Notes (EN)', 'notes_en', 40],
    ['Images', 'images', 8], ['Locations', 'locations', 10], ['Updated', 'updated', 19],
  ]);
  for (const g of genera) {
    ws.addRow({
      id: g.id, genus: g.genus, family: g.family, feed_th: feedTh(g.feeding_group), feed_en: feedEn(g.feeding_group),
      cp: g.cp_value, code: g.internal_code, notes_th: g.notes_th, notes_en: g.notes_en,
      images: g.image_count, locations: g.location_count, updated: g.updated_at,
    });
  }
  styleBody(ws);
  ws.autoFilter = { from: 'A1', to: 'L1' };
  return ws;
}

function addImagesSheet(wb, images, { embed, thumbDir }) {
  const ws = sheet(wb, 'Images', [
    ['Genus', 'genus', 20], ['File', 'file', 38], ['Caption (TH)', 'th', 30], ['Caption (EN)', 'en', 30],
    ['Credit', 'credit', 20], ['Order', 'order', 7],
  ]);
  for (const im of images) {
    ws.addRow({ genus: im.genus, file: im.file, th: im.caption_th, en: im.caption_en, credit: im.credit, order: im.sort_order });
  }
  styleBody(ws);
  let embedded = 0;
  if (embed) {
    ws.getCell(1, 7).value = 'Picture'; ws.getCell(1, 7).font = HEAD_FONT; ws.getCell(1, 7).fill = HEAD_FILL;
    embedded = embedImages(wb, ws, images, thumbDir, 6);
  }
  return embedded;
}

function addLocationsSheet(wb, locations) {
  const ws = sheet(wb, 'Locations', [
    ['Genus', 'genus', 20], ['Province (TH)', 'th', 20], ['Province (EN)', 'en', 20],
    ['Latitude', 'lat', 11], ['Longitude', 'lng', 11], ['Collected', 'date', 12], ['Note', 'note', 30], ['Sample data', 'sample', 11],
  ]);
  for (const l of locations) {
    ws.addRow({ genus: l.genus, th: provTh(l.province), en: l.province, lat: l.lat, lng: l.lng, date: l.collected_at, note: l.note, sample: l.is_sample ? 'yes' : '' });
  }
  ws.getColumn('lat').numFmt = '0.0000'; ws.getColumn('lng').numFmt = '0.0000';
  styleBody(ws);
  return ws;
}

function newWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Nematode Library';
  wb.created = new Date();
  return wb;
}

// genera: rows incl. image_count/location_count; images/locations carry a `genus` name column.
async function buildAll({ genera, images, locations, embed, thumbDir }) {
  const wb = newWorkbook();
  addGenera(wb, genera);
  const embedded = addImagesSheet(wb, images, { embed, thumbDir });
  addLocationsSheet(wb, locations);
  return { buffer: await wb.xlsx.writeBuffer(), embedded };
}

async function buildOne({ genus, images, locations, embed, thumbDir }) {
  const wb = newWorkbook();
  const ws = sheet(wb, 'Detail', [['Field', 'f', 22], ['TH', 'th', 50], ['EN', 'en', 50]]);
  const rows = [
    ['Genus', genus.genus, genus.genus],
    ['Family', genus.family, genus.family],
    ['Feeding group', feedTh(genus.feeding_group), feedEn(genus.feeding_group)],
    ['c-p value', genus.cp_value, genus.cp_value],
    ['Internal code', genus.internal_code, genus.internal_code],
    ['Notes', genus.notes_th, genus.notes_en],
    ['Images', images.length, images.length],
    ['Locations', locations.length, locations.length],
    ['Updated', genus.updated_at, genus.updated_at],
  ];
  rows.forEach(([f, th, en]) => ws.addRow({ f, th, en }));
  styleBody(ws);
  const embedded = addImagesSheet(wb, images.map((i) => ({ ...i, genus: genus.genus })), { embed, thumbDir });
  addLocationsSheet(wb, locations.map((l) => ({ ...l, genus: genus.genus })));
  return { buffer: await wb.xlsx.writeBuffer(), embedded };
}

const safeName = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'export';

module.exports = { buildAll, buildOne, safeName };
