// The 77 provinces of Thailand: English key (stored in the DB) -> Thai display name.
const PROVINCES = {
  'Amnat Charoen': 'อำนาจเจริญ', 'Ang Thong': 'อ่างทอง', 'Bangkok': 'กรุงเทพมหานคร', 'Bueng Kan': 'บึงกาฬ',
  'Buri Ram': 'บุรีรัมย์', 'Chachoengsao': 'ฉะเชิงเทรา', 'Chai Nat': 'ชัยนาท', 'Chaiyaphum': 'ชัยภูมิ',
  'Chanthaburi': 'จันทบุรี', 'Chiang Mai': 'เชียงใหม่', 'Chiang Rai': 'เชียงราย', 'Chon Buri': 'ชลบุรี',
  'Chumphon': 'ชุมพร', 'Kalasin': 'กาฬสินธุ์', 'Kamphaeng Phet': 'กำแพงเพชร', 'Kanchanaburi': 'กาญจนบุรี',
  'Khon Kaen': 'ขอนแก่น', 'Krabi': 'กระบี่', 'Lampang': 'ลำปาง', 'Lamphun': 'ลำพูน', 'Loei': 'เลย',
  'Lop Buri': 'ลพบุรี', 'Mae Hong Son': 'แม่ฮ่องสอน', 'Maha Sarakham': 'มหาสารคาม', 'Mukdahan': 'มุกดาหาร',
  'Nakhon Nayok': 'นครนายก', 'Nakhon Pathom': 'นครปฐม', 'Nakhon Phanom': 'นครพนม',
  'Nakhon Ratchasima': 'นครราชสีมา', 'Nakhon Sawan': 'นครสวรรค์', 'Nakhon Si Thammarat': 'นครศรีธรรมราช',
  'Nan': 'น่าน', 'Narathiwat': 'นราธิวาส', 'Nong Bua Lamphu': 'หนองบัวลำภู', 'Nong Khai': 'หนองคาย',
  'Nonthaburi': 'นนทบุรี', 'Pathum Thani': 'ปทุมธานี', 'Pattani': 'ปัตตานี', 'Phang Nga': 'พังงา',
  'Phatthalung': 'พัทลุง', 'Phayao': 'พะเยา', 'Phetchabun': 'เพชรบูรณ์', 'Phetchaburi': 'เพชรบุรี',
  'Phichit': 'พิจิตร', 'Phitsanulok': 'พิษณุโลก', 'Phra Nakhon Si Ayutthaya': 'พระนครศรีอยุธยา', 'Phrae': 'แพร่',
  'Phuket': 'ภูเก็ต', 'Prachin Buri': 'ปราจีนบุรี', 'Prachuap Khiri Khan': 'ประจวบคีรีขันธ์', 'Ranong': 'ระนอง',
  'Ratchaburi': 'ราชบุรี', 'Rayong': 'ระยอง', 'Roi Et': 'ร้อยเอ็ด', 'Sa Kaeo': 'สระแก้ว', 'Sakon Nakhon': 'สกลนคร',
  'Samut Prakan': 'สมุทรปราการ', 'Samut Sakhon': 'สมุทรสาคร', 'Samut Songkhram': 'สมุทรสงคราม',
  'Saraburi': 'สระบุรี', 'Satun': 'สตูล', 'Sing Buri': 'สิงห์บุรี', 'Sisaket': 'ศรีสะเกษ', 'Songkhla': 'สงขลา',
  'Sukhothai': 'สุโขทัย', 'Suphan Buri': 'สุพรรณบุรี', 'Surat Thani': 'สุราษฎร์ธานี', 'Surin': 'สุรินทร์',
  'Tak': 'ตาก', 'Trang': 'ตรัง', 'Trat': 'ตราด', 'Ubon Ratchathani': 'อุบลราชธานี', 'Udon Thani': 'อุดรธานี',
  'Uthai Thani': 'อุทัยธานี', 'Uttaradit': 'อุตรดิตถ์', 'Yala': 'ยะลา', 'Yasothon': 'ยโสธร',
};

// Approximate centre of each province's Mueang (capital) district, [lat, lng]. Used when a point is saved
// without coordinates. Bangkok has no Mueang district, so its centre is used.
const CENTERS = {
  'Amnat Charoen': [15.8657, 104.6258], 'Ang Thong': [14.5896, 100.4550], 'Bangkok': [13.7563, 100.5018], 'Bueng Kan': [18.3609, 103.6466],
  'Buri Ram': [14.9930, 103.1029], 'Chachoengsao': [13.6904, 101.0780], 'Chai Nat': [15.1851, 100.1251], 'Chaiyaphum': [15.8068, 102.0316],
  'Chanthaburi': [12.6114, 102.1039], 'Chiang Mai': [18.7883, 98.9853], 'Chiang Rai': [19.9072, 99.8325], 'Chon Buri': [13.3611, 100.9847],
  'Chumphon': [10.4930, 99.1800], 'Kalasin': [16.4315, 103.5060], 'Kamphaeng Phet': [16.4828, 99.5227], 'Kanchanaburi': [14.0228, 99.5328],
  'Khon Kaen': [16.4419, 102.8360], 'Krabi': [8.0863, 98.9063], 'Lampang': [18.2888, 99.4908], 'Lamphun': [18.5745, 99.0087],
  'Loei': [17.4860, 101.7223], 'Lop Buri': [14.7995, 100.6534], 'Mae Hong Son': [19.3020, 97.9654], 'Maha Sarakham': [16.1851, 103.3027],
  'Mukdahan': [16.5426, 104.7235], 'Nakhon Nayok': [14.2069, 101.2131], 'Nakhon Pathom': [13.8199, 100.0443], 'Nakhon Phanom': [17.4108, 104.7783],
  'Nakhon Ratchasima': [14.9799, 102.0978], 'Nakhon Sawan': [15.7047, 100.1372], 'Nakhon Si Thammarat': [8.4304, 99.9631], 'Nan': [18.7756, 100.7730],
  'Narathiwat': [6.4254, 101.8253], 'Nong Bua Lamphu': [17.2040, 102.4407], 'Nong Khai': [17.8783, 102.7420], 'Nonthaburi': [13.8621, 100.5144],
  'Pathum Thani': [14.0208, 100.5250], 'Pattani': [6.8696, 101.2501], 'Phang Nga': [8.4509, 98.5255], 'Phatthalung': [7.6167, 100.0779],
  'Phayao': [19.1665, 99.9015], 'Phetchabun': [16.4190, 101.1606], 'Phetchaburi': [13.1119, 99.9398], 'Phichit': [16.4429, 100.3488],
  'Phitsanulok': [16.8211, 100.2659], 'Phra Nakhon Si Ayutthaya': [14.3532, 100.5689], 'Phrae': [18.1446, 100.1410], 'Phuket': [7.8804, 98.3923],
  'Prachin Buri': [14.0509, 101.3727], 'Prachuap Khiri Khan': [11.8126, 99.7957], 'Ranong': [9.9529, 98.6085], 'Ratchaburi': [13.5283, 99.8134],
  'Rayong': [12.6814, 101.2816], 'Roi Et': [16.0538, 103.6520], 'Sa Kaeo': [13.8240, 102.0645], 'Sakon Nakhon': [17.1664, 104.1486],
  'Samut Prakan': [13.5991, 100.5998], 'Samut Sakhon': [13.5475, 100.2744], 'Samut Songkhram': [13.4098, 100.0023], 'Saraburi': [14.5289, 100.9101],
  'Satun': [6.6238, 100.0674], 'Sing Buri': [14.8907, 100.4029], 'Sisaket': [15.1186, 104.3220], 'Songkhla': [7.2075, 100.5967],
  'Sukhothai': [17.0056, 99.8264], 'Suphan Buri': [14.4745, 100.1177], 'Surat Thani': [9.1382, 99.3217], 'Surin': [14.8818, 103.4937],
  'Tak': [16.8840, 99.1258], 'Trang': [7.5563, 99.6114], 'Trat': [12.2428, 102.5175], 'Ubon Ratchathani': [15.2448, 104.8473],
  'Udon Thani': [17.4138, 102.7870], 'Uthai Thani': [15.3835, 100.0246], 'Uttaradit': [17.6200, 100.0993], 'Yala': [6.5410, 101.2804],
  'Yasothon': [15.7926, 104.1453],
};

module.exports = { PROVINCES, CENTERS, isProvince: (k) => Object.prototype.hasOwnProperty.call(PROVINCES, k) };
