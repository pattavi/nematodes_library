// Sample data written for development. Species names are real taxa, but the descriptions are short
// paraphrased summaries and the coordinates are made up (is_sample = 1): they are NOT real collection
// records and must not be presented as such. Re-running replaces only sample rows; your own data is kept.
const { open } = require('./db');

const P = {
  cm: ['Chiang Mai', 18.79, 98.98], cr: ['Chiang Rai', 19.91, 99.83], kk: ['Khon Kaen', 16.44, 102.83],
  ub: ['Ubon Ratchathani', 15.24, 104.85], np: ['Nakhon Pathom', 13.82, 100.06], sk: ['Songkhla', 7.2, 100.6],
  st: ['Surat Thani', 9.14, 99.33],
};

// genus, family, feeding_group, cp, notes_th, notes_en, [ [epithet, notes_th, notes_en, [province keys]] ]
const DATA = [
  ['Meloidogyne', 'Meloidogynidae', 'plant-parasite', 3, 'ไส้เดือนฝอยรากปม ทำให้เกิดปมที่ราก พืชแคระแกร็น', 'Root-knot nematodes; induce galls on roots and stunt plants.', [
    ['incognita', 'พบได้กว้างขวางในพืชหลายชนิด รวมถึงพืชผัก', 'Widespread on many crops, including vegetables.', ['cm', 'kk']],
    ['javanica', 'พบมากในดินเขตร้อนและอบอุ่น', 'Common in tropical and warm soils.', ['np', 'cm']],
    ['graminicola', 'เกี่ยวข้องกับข้าวและพืชตระกูลหญ้า', 'Associated with rice and other grasses.', ['kk']],
  ]],
  ['Pratylenchus', 'Pratylenchidae', 'plant-parasite', 3, 'ไส้เดือนฝอยรากเน่า เคลื่อนที่เข้าออกเนื้อเยื่อราก', 'Root-lesion nematodes; migratory endoparasites causing root lesions.', [
    ['coffeae', 'พบในรากของพืชหลายชนิด เช่น กล้วยและกาแฟ', 'Found on roots of many crops such as banana and coffee.', ['cr', 'ub']],
    ['zeae', 'เกี่ยวข้องกับข้าวโพด อ้อย และข้าว', 'Associated with maize, sugarcane and rice.', ['ub', 'kk']],
  ]],
  ['Heterodera', 'Heteroderidae', 'plant-parasite', 3, 'ไส้เดือนฝอยซิสต์ ตัวเมียกลายเป็นถุงไข่ที่ราก', 'Cyst nematodes; the female body becomes a cyst holding eggs.', [
    ['glycines', 'ไส้เดือนฝอยซิสต์ของถั่วเหลือง', 'The soybean cyst nematode.', ['cm']],
    ['sacchari', 'ไส้เดือนฝอยซิสต์ที่พบกับอ้อยและข้าว', 'A cyst nematode reported on sugarcane and rice.', ['kk']],
  ]],
  ['Radopholus', 'Pratylenchidae', 'plant-parasite', 3, 'พบในกล้วยและพืชเขตร้อน ทำให้รากเป็นแผลสีน้ำตาล', 'Burrowing nematodes; common on banana and tropical crops.', [
    ['similis', 'ไส้เดือนฝอยรากชอนไชของกล้วย', 'The burrowing nematode of banana.', ['st', 'sk']],
  ]],
  ['Xiphinema', 'Longidoridae', 'plant-parasite', 5, 'ไส้เดือนฝอยกริช ตัวยาว เป็นพาหะของไวรัสพืชบางชนิด', 'Dagger nematodes; large, some transmit plant viruses.', [
    ['index', 'เกี่ยวข้องกับองุ่นและไวรัสใบด่างองุ่น', 'Associated with grapevine and grapevine fanleaf virus.', ['cr']],
    ['americanum', 'ไส้เดือนฝอยกริชที่พบในดินหลายแห่ง', 'A dagger nematode found in soils of many regions.', ['kk']],
  ]],
  ['Helicotylenchus', 'Hoplolaimidae', 'plant-parasite', 3, 'ไส้เดือนฝอยเกลียว ตัวขดเป็นเกลียวเมื่อตาย', 'Spiral nematodes; the body coils in a spiral when relaxed.', [
    ['multicinctus', 'พบบ่อยในรากกล้วย', 'Frequently found on banana roots.', ['np', 'sk']],
    ['dihystera', 'พบได้ทั่วไปในดินเกษตร', 'Common in agricultural soils.', ['ub']],
  ]],
  ['Rotylenchulus', 'Hoplolaimidae', 'plant-parasite', 3, 'ไส้เดือนฝอยไตเนื้อ ตัวเมียบวมคล้ายไต เกาะที่ราก', 'Reniform nematodes; the mature female swells into a kidney shape.', [
    ['reniformis', 'ไส้เดือนฝอยไตที่พบในพืชหลายชนิด รวมถึงฝ้าย', 'The reniform nematode found on many crops, including cotton.', ['st']],
  ]],
  ['Aphelenchoides', 'Aphelenchoididae', 'fungivore', 2, 'กินเชื้อรา บางชนิดทำลายใบพืช', 'Feeds on fungi; some species damage foliage.', [
    ['besseyi', 'ทำให้เกิดอาการปลายใบข้าวขาว', 'Causes white-tip disease of rice.', ['cm']],
    ['fragariae', 'ทำลายใบและยอดของสตรอว์เบอร์รีและไม้ประดับ', 'Attacks foliage of strawberry and ornamentals.', ['np']],
  ]],
  ['Ditylenchus', 'Anguinidae', 'fungivore', 2, 'บางชนิดกินเชื้อรา บางชนิดทำลายหัวและลำต้น', 'Some species feed on fungi, others attack bulbs and stems.', [
    ['dipsaci', 'ไส้เดือนฝอยลำต้นและหัว พบในพืชหลายชนิด', 'The stem and bulb nematode, on many hosts.', ['cr']],
    ['destructor', 'เกี่ยวข้องกับหัวมันฝรั่งเน่า', 'Associated with rot of potato tubers.', ['cm']],
  ]],
  ['Rhabditis', 'Rhabditidae', 'bacterivore', 1, 'กินแบคทีเรีย พบมากในอินทรียวัตถุที่กำลังย่อยสลาย', 'Bacterial feeders abundant in decomposing organic matter.', [
    ['sp.', 'ตัวอย่างที่จัดได้ถึงระดับสกุลเท่านั้น', 'A record identified only to genus.', ['kk', 'np', 'sk']],
  ]],
  ['Acrobeloides', 'Cephalobidae', 'bacterivore', 2, 'กินแบคทีเรีย พบทั่วไปในดินเกษตร', 'Bacterial feeders common in agricultural soils.', [
    ['nanus', 'พบทั่วไปในดินหลายชนิด', 'Common in many soil types.', ['cm']],
    ['buetschlii', 'พบในดินและอินทรียวัตถุ', 'Found in soil and organic matter.', ['ub']],
  ]],
  ['Mononchus', 'Mononchidae', 'predator', 4, 'ผู้ล่า มีช่องปากใหญ่ กินไส้เดือนฝอยชนิดอื่น', 'Predators with a large buccal cavity; feed on other nematodes.', [
    ['aquaticus', 'ผู้ล่าที่พบในดินชื้นและแหล่งน้ำ', 'A predator found in moist soil and freshwater habitats.', ['cr', 'st']],
  ]],
  ['Dorylaimus', 'Dorylaimidae', 'omnivore', 4, 'กินได้หลายอย่าง ไวต่อการรบกวนดิน', 'Omnivores; sensitive to soil disturbance.', [
    ['stagnalis', 'พบในดินและตะกอนน้ำจืด', 'Found in soil and freshwater sediments.', ['cm', 'ub']],
  ]],
  ['Steinernema', 'Steinernematidae', 'entomopathogen', null, 'ไส้เดือนฝอยก่อโรคแมลง ใช้ควบคุมแมลงศัตรูพืช', 'Entomopathogenic nematodes used for biological control of insects.', [
    ['carpocapsae', 'ใช้ควบคุมแมลงศัตรูพืชหลายชนิดทางชีวภาพ', 'Used for biological control of several insect pests.', ['kk']],
    ['feltiae', 'ทนอุณหภูมิต่ำกว่าหลายชนิดในสกุลเดียวกัน', 'Tolerates cooler temperatures than many congeners.', ['cm']],
  ]],
];

// Remove previous sample rows (keeping anything that has real images or was added by a person).
function clearSamples(db) {
  db.prepare('DELETE FROM locations WHERE is_sample = 1').run();
  db.prepare(`DELETE FROM species WHERE is_sample = 1
    AND id NOT IN (SELECT species_id FROM images) AND id NOT IN (SELECT species_id FROM locations)`).run();
  db.prepare('DELETE FROM genera WHERE is_sample = 1 AND id NOT IN (SELECT genus_id FROM species)').run();
}

function seed(db = open()) {
  const insG = db.prepare(`INSERT INTO genera (genus, family, feeding_group, cp_value, notes_th, notes_en, is_sample)
    VALUES (?, ?, ?, ?, ?, ?, 1)`);
  const insS = db.prepare('INSERT INTO species (genus_id, species, notes_th, notes_en, is_sample) VALUES (?, ?, ?, ?, 1)');
  const insL = db.prepare(`INSERT INTO locations (species_id, lat, lng, province, note, is_sample)
    VALUES (?, ?, ?, ?, 'sample data', 1)`);
  const out = { genera: 0, species: 0, locations: 0 };
  db.transaction(() => {
    clearSamples(db);
    for (const [name, fam, feed, cp, gth, gen, species] of DATA) {
      let g = db.prepare('SELECT id FROM genera WHERE genus = ?').get(name);
      if (!g) { g = { id: insG.run(name, fam, feed, cp, gth, gen).lastInsertRowid }; out.genera++; }
      for (const [epithet, sth, sen, provs] of species) {
        if (db.prepare('SELECT 1 FROM species WHERE genus_id = ? AND species = ?').get(g.id, epithet)) continue;
        const sid = insS.run(g.id, epithet, sth, sen).lastInsertRowid;
        out.species++;
        provs.forEach((k, i) => {
          const [prov, lat, lng] = P[k];
          const off = (i + Number(sid) % 5) * 0.03; // small deterministic offset so dots do not overlap
          insL.run(sid, +(lat + off).toFixed(4), +(lng + off).toFixed(4), prov);
          out.locations++;
        });
      }
    }
  })();
  return out;
}

if (require.main === module) {
  const r = seed();
  console.log(`seeded ${r.genera} genera, ${r.species} species, ${r.locations} sample locations`);
}

module.exports = { seed };
