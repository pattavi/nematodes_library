// Sample data written for development. Coordinates are made up (labelled is_sample=1)
// and must NOT be presented as real collection records.
const { open } = require('./db');

const P = {
  cm: ['Chiang Mai', 18.79, 98.98],
  cr: ['Chiang Rai', 19.91, 99.83],
  kk: ['Khon Kaen', 16.44, 102.83],
  ub: ['Ubon Ratchathani', 15.24, 104.85],
  np: ['Nakhon Pathom', 13.82, 100.06],
  sk: ['Songkhla', 7.2, 100.6],
  st: ['Surat Thani', 9.14, 99.33],
};

// [genus, family, feeding_group, cp, notes_th, notes_en, [province keys]]
const GENERA = [
  ['Meloidogyne', 'Meloidogynidae', 'plant-parasite', 3, 'ไส้เดือนฝอยรากปม ทำให้เกิดปมที่ราก พืชแคระแกร็น', 'Root-knot nematode; induces galls on roots and stunts plants.', ['cm', 'kk', 'np']],
  ['Pratylenchus', 'Pratylenchidae', 'plant-parasite', 3, 'ไส้เดือนฝอยรากเน่า เคลื่อนที่เข้าออกเนื้อเยื่อราก', 'Root-lesion nematode; migratory endoparasite causing root lesions.', ['cr', 'ub']],
  ['Heterodera', 'Heteroderidae', 'plant-parasite', 3, 'ไส้เดือนฝอยซิสต์ ตัวเมียกลายเป็นถุงไข่ที่ราก', 'Cyst nematode; the female body becomes a cyst holding eggs.', ['cm']],
  ['Radopholus', 'Pratylenchidae', 'plant-parasite', 3, 'พบในกล้วยและพืชเขตร้อน ทำให้รากเป็นแผลสีน้ำตาล', 'Burrowing nematode; common on banana and tropical crops.', ['st', 'sk']],
  ['Xiphinema', 'Longidoridae', 'plant-parasite', 5, 'ไส้เดือนฝอยกริช ตัวยาว เป็นพาหะของไวรัสพืชบางชนิด', 'Dagger nematode; large, can transmit some plant viruses.', ['cr', 'kk']],
  ['Helicotylenchus', 'Hoplolaimidae', 'plant-parasite', 3, 'ไส้เดือนฝอยเกลียว ตัวขดเป็นเกลียวเมื่อตาย', 'Spiral nematode; body coils in a spiral when relaxed.', ['np', 'ub', 'sk']],
  ['Rotylenchulus', 'Hoplolaimidae', 'plant-parasite', 3, 'ไส้เดือนฝอยไตเนื้อ ตัวเมียบวมคล้ายไต เกาะที่ราก', 'Reniform nematode; the mature female swells into a kidney shape.', ['st']],
  ['Aphelenchoides', 'Aphelenchoididae', 'fungivore', 2, 'กินเชื้อรา บางชนิดทำลายใบพืช', 'Feeds on fungi; some species damage foliage.', ['cm', 'np']],
  ['Ditylenchus', 'Anguinidae', 'fungivore', 2, 'บางชนิดกินเชื้อรา บางชนิดทำลายหัวและลำต้น', 'Some species feed on fungi, others attack bulbs and stems.', ['cr']],
  ['Rhabditis', 'Rhabditidae', 'bacterivore', 1, 'กินแบคทีเรีย พบมากในอินทรียวัตถุที่กำลังย่อยสลาย', 'Bacterial feeder abundant in decomposing organic matter.', ['kk', 'np', 'sk']],
  ['Acrobeloides', 'Cephalobidae', 'bacterivore', 2, 'กินแบคทีเรีย พบทั่วไปในดินเกษตร', 'Bacterial feeder common in agricultural soils.', ['cm', 'ub']],
  ['Mononchus', 'Mononchidae', 'predator', 4, 'ผู้ล่า มีช่องปากใหญ่ กินไส้เดือนฝอยชนิดอื่น', 'Predator with a large buccal cavity; feeds on other nematodes.', ['cr', 'st']],
  ['Dorylaimus', 'Dorylaimidae', 'omnivore', 4, 'กินได้หลายอย่าง ไวต่อการรบกวนดิน', 'Omnivore; sensitive to soil disturbance.', ['cm', 'ub']],
  ['Steinernema', 'Steinernematidae', 'entomopathogen', null, 'ไส้เดือนฝอยก่อโรคแมลง ใช้ควบคุมแมลงศัตรูพืช', 'Entomopathogenic nematode used for biological control of insects.', ['kk']],
];

function seed(db = open()) {
  const insG = db.prepare(`INSERT INTO genera (genus, family, feeding_group, cp_value, notes_th, notes_en, is_sample)
    VALUES (?, ?, ?, ?, ?, ?, 1)`);
  const insL = db.prepare(`INSERT INTO locations (genus_id, lat, lng, province, note, is_sample)
    VALUES (?, ?, ?, ?, 'sample data', 1)`);
  let g = 0, l = 0;
  db.transaction(() => {
    for (const [name, fam, feed, cp, th, en, provs] of GENERA) {
      if (db.prepare('SELECT 1 FROM genera WHERE genus = ?').get(name)) continue;
      const id = insG.run(name, fam, feed, cp, th, en).lastInsertRowid;
      g++;
      provs.forEach((k, i) => {
        const [prov, lat, lng] = P[k];
        const off = (i + id % 5) * 0.03; // small deterministic offset so dots do not overlap
        insL.run(id, +(lat + off).toFixed(4), +(lng + off).toFixed(4), prov);
        l++;
      });
    }
  })();
  return { genera: g, locations: l };
}

if (require.main === module) {
  const r = seed();
  console.log(`seeded ${r.genera} genera, ${r.locations} sample locations`);
}

module.exports = { seed };
