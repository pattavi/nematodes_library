(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = { lang: 'th', q: '', feeding: '', letter: '', sort: 'asc', view: 'list', province: '' };
  const PALETTE = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#0aa5c9', '#d6249f', '#9a6324', '#808000', '#008080', '#800000', '#000075'];
  const colorOf = (id) => PALETTE[id % PALETTE.length]; // one colour per species (colours repeat after 12)
  let provinces = {};      // key -> Thai name (all 77)
  let provUse = [];        // provinces that have points: [{key, count}]
  let mapData = [];        // current map points
  let msel = null;         // map selection: { k: 'g' | 's', id }
  let bigMap = null, bigLayer = null;
  let meta = { feeding: [], letters: [] };
  let seq = 0;

  const t = () => I18N[state.lang];
  const trimLead = (s) => s.replace(/^[^:：]+[:：]\s*/, ''); // "Point 1: text" -> "text"

  function readUrl() {
    const p = new URLSearchParams(location.search);
    let lang = p.get('lang');
    if (!lang) { try { lang = localStorage.getItem('lang'); } catch {} }
    state.lang = lang === 'en' ? 'en' : 'th';
    state.q = p.get('q') || '';
    state.feeding = p.get('feeding') || '';
    state.letter = (p.get('letter') || '').toUpperCase().slice(0, 1);
    state.sort = p.get('sort') === 'desc' ? 'desc' : 'asc';
    state.view = p.get('view') === 'map' ? 'map' : 'list';
    state.province = state.view === 'map' ? p.get('province') || '' : '';
  }

  function writeUrl() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.feeding) p.set('feeding', state.feeding);
    if (state.letter) p.set('letter', state.letter);
    if (state.sort !== 'asc') p.set('sort', state.sort);
    if (state.lang === 'en') p.set('lang', 'en');
    if (state.view === 'map') { p.set('view', 'map'); if (state.province) p.set('province', state.province); }
    const qs = p.toString();
    history.replaceState(null, '', (qs ? `?${qs}` : location.pathname) + location.hash);
  }

  // The province filter exists only in map view, so it only counts there.
  const activeFilters = () => (state.q ? 1 : 0) + (state.feeding ? 1 : 0) + (state.letter ? 1 : 0)
    + (state.view === 'map' && state.province ? 1 : 0);
  const provLabel = (k) => (state.lang === 'th' ? provinces[k] || k : k);

  function renderStatic() {
    const L = t();
    document.documentElement.lang = state.lang;
    $('title').textContent = L.title;
    $('subtitle').textContent = L.subtitle;
    document.title = L.title;
    $('q').placeholder = L.search;
    $('qclear').setAttribute('aria-label', L.clearSearch);
    document.querySelectorAll('[data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === state.lang));
    const [asc, desc] = document.querySelectorAll('[data-sort]');
    asc.textContent = L.sortAsc; desc.textContent = L.sortDesc;
    document.querySelectorAll('[data-sort]').forEach((b) => b.classList.toggle('on', b.dataset.sort === state.sort));
    $('upload-btn').textContent = L.uploadBtn;
    $('exp-btn').textContent = L.exportBtn;
    $('upload-btn').href = state.lang === 'en' ? '/upload?lang=en' : '/upload';
    document.querySelectorAll('[data-view]').forEach((b) => {
      b.textContent = b.dataset.view === 'map' ? L.viewMap : L.viewList;
      b.classList.toggle('on', b.dataset.view === state.view);
    });
    const isMap = state.view === 'map';
    $('grid').hidden = isMap; $('mapview').hidden = !isMap; $('prov').hidden = !isMap;
    renderProvSelect();
  }

  function renderProvSelect() {
    const L = t();
    $('prov').setAttribute('aria-label', L.province);
    $('prov').innerHTML = `<option value="">${esc(L.allProv)}</option>` +
      provUse.map((p) => `<option value="${esc(p.key)}"${state.province === p.key ? ' selected' : ''}>${esc(provLabel(p.key))} (${p.count})</option>`).join('');
  }

  function renderChips() {
    const L = t();
    const chip = (key, label, n) =>
      `<button class="chip${state.feeding === key ? ' on' : ''}" data-feeding="${esc(key)}">${esc(label)}${n != null ? ` (${n})` : ''}</button>`;
    $('chips').innerHTML = chip('', L.allGroups) +
      meta.feeding.map((f) => chip(f.key, L.feeding[f.key] || f.key, f.count)).join('');
    $('letters').innerHTML = meta.letters
      .map((l) => `<button class="${state.letter === l ? 'on' : ''}" data-letter="${l}" aria-label="${esc(L.letter)} ${l}">${l}</button>`)
      .join('');
  }

  function renderControls(n) {
    const L = t();
    $('qclear').hidden = !state.q;
    const a = activeFilters();
    $('clear').hidden = a === 0;
    $('clear').textContent = `${L.clear} (${a})`;
    $('count').textContent = L.count(n);
  }

  const UP = window.STATIC_SITE ? 'uploads/' : '/uploads/'; // the static build serves images relative to the page
  const thumbUrl = (file) => `${UP}thumbs/${encodeURIComponent(file.replace(/\.[^.]+$/, '.jpg'))}`;

  function renderGrid(items) {
    const L = t();
    const msg = $('msg');
    msg.hidden = items.length > 0;
    msg.textContent = L.empty;
    let html = '', last = '';
    for (const g of items) {
      const l = g.genus[0].toUpperCase();
      if (l !== last) { html += `<h2 class="letter-h">${esc(l)}</h2>`; last = l; }
      html += `<a class="card" href="#G${g.id}" style="text-decoration:none;color:inherit">
        <div class="thumb">${g.cover ? `<img loading="lazy" src="${thumbUrl(g.cover)}" alt="">` : esc(L.noImage)}</div>
        <div class="body">
          <h3>${esc(g.genus)}</h3>
          <div class="meta">${g.family ? `${esc(L.family)}: ${esc(g.family)}` : ''}</div>
          ${g.feeding_group ? `<span class="tag">${esc(L.feeding[g.feeding_group] || g.feeding_group)}</span>` : ''}
          <div class="meta">${g.species_count} ${esc(L.speciesWord)} · ${g.image_count} ${esc(L.images)} · ${g.location_count} ${esc(L.points)}</div>
        </div></a>`;
    }
    $('grid').innerHTML = html;
  }

  const filterParams = () => {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.feeding) p.set('feeding', state.feeding);
    if (state.letter) p.set('letter', state.letter);
    return p;
  };

  async function refreshProvinces() {
    try {
      const j = await (await fetch('/api/locations/provinces')).json();
      provUse = j.items.map(({ key, count }) => ({ key, count }));
      j.items.forEach((x) => { provinces[x.key] = x.th; });
    } catch {}
    if (state.province && !provUse.some((p) => p.key === state.province)) state.province = '';
    renderProvSelect();
  }

  async function loadMap() {
    const my = ++seq;
    const p = filterParams();
    if (state.province) p.set('province', state.province);
    try {
      const r = await fetch(`/api/locations?${p}`);
      if (!r.ok) throw new Error(r.status);
      const { items } = await r.json();
      if (my !== seq) return;
      mapData = items;
      renderMapView();
    } catch {
      if (my !== seq) return;
      $('maplist').textContent = t().error;
    }
  }

  // Map points are per species. The side list groups species under their genus.
  function renderMapView() {
    const L = t();
    const genera = new Map();
    for (const pt of mapData) {
      if (!genera.has(pt.genus_id)) genera.set(pt.genus_id, { id: pt.genus_id, genus: pt.genus, species: new Map(), n: 0 });
      const g = genera.get(pt.genus_id);
      if (!g.species.has(pt.species_id)) g.species.set(pt.species_id, { id: pt.species_id, species: pt.species, n: 0 });
      g.species.get(pt.species_id).n++; g.n++;
    }
    const speciesCount = [...genera.values()].reduce((s, g) => s + g.species.size, 0);
    if (msel && !(msel.k === 'g' ? genera.has(msel.id) : mapData.some((p) => p.species_id === msel.id))) msel = null;
    $('count').textContent = L.mapCount(genera.size, speciesCount, mapData.length);
    $('clear').hidden = activeFilters() === 0;
    $('clear').textContent = `${L.clear} (${activeFilters()})`;
    $('qclear').hidden = !state.q;

    $('maplist').innerHTML = (msel ? `<button class="link" data-mg-all>${esc(L.showAll)}</button>` : '') +
      (genera.size ? [...genera.values()].map((g) =>
        `<button class="mg genus${msel && msel.k === 'g' && msel.id === g.id ? ' on' : ''}" data-mg-g="${g.id}"><i>${esc(g.genus)}</i><span class="muted">${g.n} ${esc(L.pts)}</span></button>` +
        [...g.species.values()].map((s) =>
          `<button class="mg sp${msel && msel.k === 's' && msel.id === s.id ? ' on' : ''}" data-mg-s="${s.id}"><span class="sw" style="background:${colorOf(s.id)}"></span><i>${esc(s.species)}</i><span class="muted">${s.n} ${esc(L.pts)}</span></button>`).join('')).join('')
        : `<p class="muted">${esc(L.noPoints)}</p>`);

    const el = $('bigmap');
    if (!window.L) { el.textContent = L.mapFail; return; }
    if (!bigMap) {
      bigMap = window.L.map(el);
      window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, referrerPolicy: 'strict-origin-when-cross-origin', attribution: '&copy; OpenStreetMap contributors' }).addTo(bigMap);
      bigLayer = window.L.layerGroup().addTo(bigMap);
    }
    bigMap.invalidateSize();
    bigLayer.clearLayers();
    const shown = mapData.filter((pt) => !msel || (msel.k === 'g' ? pt.genus_id === msel.id : pt.species_id === msel.id));
    const bounds = [];
    for (const pt of shown) {
      const m = window.L.circleMarker([pt.lat, pt.lng], { radius: 8, color: '#fff', weight: 2, fillColor: colorOf(pt.species_id), fillOpacity: 0.95 }).addTo(bigLayer);
      const tip = document.createElement('span');
      tip.textContent = msel
        ? `${msel.k === 'g' ? `${pt.species} — ` : ''}${provLabel(pt.province)}`
        : `${pt.genus} ${pt.species} — ${provLabel(pt.province)} (${pt.lat.toFixed(4)}, ${pt.lng.toFixed(4)})`;
      m.bindTooltip(tip, { permanent: !!msel, direction: 'top' });
      m.on('click', () => { location.hash = `#S${pt.species_id}`; });
      bounds.push([pt.lat, pt.lng]);
    }
    if (bounds.length === 1) bigMap.setView(bounds[0], 9);
    else if (bounds.length) bigMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 10 });
    else bigMap.fitBounds([[5.6, 97.3], [20.5, 105.7]]);
  }

  async function load() {
    if (state.view === 'map') return loadMap();
    const my = ++seq;
    const p = filterParams();
    p.set('sort', state.sort);
    try {
      const r = await fetch(`/api/genera?${p}`);
      if (!r.ok) throw new Error(r.status);
      const { items } = await r.json();
      if (my !== seq) return; // a newer request superseded this one
      renderControls(items.length);
      renderGrid(items);
    } catch {
      if (my !== seq) return;
      $('grid').innerHTML = '';
      $('msg').hidden = false;
      $('msg').textContent = t().error;
    }
  }

  // ---- detail dialog: a genus (#G1) or a species (#S1) ----
  const dlg = $('detail');
  // cur = the loaded record plus cur.kind ('genus' | 'species')
  let cur = null, slide = 0, map = null, dseq = 0;
  const pick = (g, base) => g[`${base}_${state.lang}`] || g[`${base}_${state.lang === 'th' ? 'en' : 'th'}`] || '';
  const apiBase = (kind) => (kind === 'genus' ? 'genera' : 'species');
  const hashOf = (kind, id) => `#${kind === 'genus' ? 'G' : 'S'}${id}`;

  let ptEdit = null; // null | { id: number|null, ...fields } while the point form is open

  function ptFormHtml() {
    const L = t(), v = ptEdit;
    const opts = Object.keys(provinces).sort((a, b) => provLabel(a).localeCompare(provLabel(b), state.lang))
      .map((k) => `<option value="${esc(k)}"${v.province === k ? ' selected' : ''}>${esc(provLabel(k))}</option>`).join('');
    return `<form id="ptform" class="gform ptform" novalidate>
      <div class="row"><label>${esc(L.province)}<select name="province"><option value="">${esc(L.chooseProv)}</option>${opts}</select></label>
        <label>${esc(L.dateLbl)}<input name="collected_at" type="date" value="${esc(v.collected_at || '')}"></label></div>
      <div class="row"><label>${esc(L.lat)}<input name="lat" inputmode="decimal" value="${esc(v.lat ?? '')}"></label>
        <label>${esc(L.lng)}<input name="lng" inputmode="decimal" value="${esc(v.lng ?? '')}"></label></div>
      <p class="muted">${esc(L.coordBlank)}</p>
      <label>${esc(L.noteLbl)}<input name="note" maxlength="500" value="${esc(v.note || '')}"></label>
      <p class="ferr" id="pterr" role="alert"></p>
      <div class="btns"><button type="button" class="plain" data-ptcancel>${esc(L.cancel)}</button><button type="submit" class="primary">${esc(L.save)}</button></div></form>`;
  }

  function destroyMap() { if (map) { map.remove(); map = null; } }

  const factsHtml = (list) => `<dl class="facts">${list.filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;

  const headHtml = (title, actions) => `<div class="d-head"><h2 id="d-title">${title}</h2>
    <div class="d-actions">${actions}<button class="d-close" data-close>${esc(t().close)}</button></div></div>`;

  const exportRow = () => {
    const L = t();
    return `<div class="expgenus"><a class="plain btnlink" data-expx href="/api/${apiBase(cur.kind)}/${cur.id}/export.xlsx" download>${esc(cur.kind === 'genus' ? L.expGenus : L.expSpecies)}</a>
      <label class="chk"><input type="checkbox" data-expx-img> ${esc(L.expGenusImg)}</label></div>`;
  };

  function locationsHtml(locs, withSpecies) {
    const L = t();
    return `<h3>${esc(L.locations)} (${locs.length})</h3>
      ${locs.length ? `<div id="minimap" class="minimap"></div>
        <ul class="locs">${locs.map((p) => `<li>${withSpecies ? `<i>${esc(p.species)}</i> · ` : ''}${esc(provLabel(p.province))} · ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}${p.collected_at ? ` · ${esc(p.collected_at)}` : ''}${p.is_sample ? ` <span class="muted">(${esc(L.sample)})</span>` : ''}
          ${sess.admin && !withSpecies ? `<button class="mini" data-ept="${p.id}" aria-label="${esc(L.editGenus)}">✎</button><button class="mini" data-dpt="${p.id}" aria-label="${esc(L.deleteGenus)}">×</button>` : ''}</li>`).join('')}</ul>`
        : `<p class="muted">${esc(L.noLocations)}</p>`}`;
  }

  function renderDetail(force) {
    if (!cur) return;
    if (!force && dlg.querySelector('#gform, #sform, [data-confirm-del]')) return; // don't clobber an open form from a background refresh
    destroyMap();
    if (cur.kind === 'genus') renderGenus(); else renderSpecies();
  }

  function renderGenus() {
    const L = t(), g = cur;
    const note = pick(g, 'notes');
    const rows = g.species.map((s) => `<a class="sprow" href="#S${s.id}">
        <span class="spthumb">${s.cover ? `<img loading="lazy" src="${thumbUrl(s.cover)}" alt="">` : ''}</span>
        <span class="spmain"><i>${esc(g.genus)} ${esc(s.species)}</i>${s.authority ? `<span class="muted"> ${esc(s.authority)}</span>` : ''}</span>
        <span class="muted spcount">${s.image_count} ${esc(L.images)} · ${s.location_count} ${esc(L.points)}</span></a>`).join('');
    dlg.innerHTML = headHtml(esc(g.genus),
      sess.admin ? `<button data-edit>${esc(L.editGenus)}</button><button class="danger" data-del>${esc(L.deleteGenus)}</button>` : '') + `
      <div class="d-body">
        ${factsHtml([[L.family, g.family], [L.feeding_label, g.feeding_group && (L.feeding[g.feeding_group] || g.feeding_group)], [L.cp, g.cp_value], [L.code, g.internal_code]])}
        ${note ? `<h3>${esc(L.notes)}</h3><p>${esc(note)}</p>` : ''}
        ${exportRow()}
        <h3>${esc(L.speciesTitle)} (${g.species.length})</h3>
        ${g.species.length ? `<div class="splist">${rows}</div>` : `<p class="muted">${esc(L.noSpecies)}</p>`}
        ${sess.admin ? `<button class="plain" data-addsp>${esc(L.addSpecies)}</button>` : ''}
        ${locationsHtml(g.locations, true)}
      </div>`;
    if (g.locations.length) drawMiniMap(g.locations, (p) => `${p.species} — ${provLabel(p.province)}`, (p) => colorOf(p.species_id));
  }

  function renderSpecies() {
    const L = t(), s = cur, g = s.genus, n = s.images.length;
    slide = Math.min(slide, Math.max(0, n - 1));
    const im = s.images[slide];
    const cap = im ? pick(im, 'caption') : '';
    const note = pick(s, 'notes');
    const title = `${esc(g.genus)} ${esc(s.species)}`;
    dlg.innerHTML = headHtml(title,
      sess.admin ? `<button data-edit>${esc(L.editSpecies)}</button><button class="danger" data-del>${esc(L.deleteSpecies)}</button>` : '') + `
      <div class="d-body">
        <p class="crumb"><a href="#G${g.id}">← ${esc(g.genus)}</a></p>
        <div class="slides">${im ? `<img src="${UP}${encodeURIComponent(im.file)}" alt="${title.replace(/<[^>]+>/g, '')}">` : esc(L.noImage)}
          ${n > 1 ? `<button class="nav prev" data-slide="-1" aria-label="${esc(L.prev)}">‹</button>
                     <button class="nav next" data-slide="1" aria-label="${esc(L.next)}">›</button>` : ''}</div>
        ${n > 1 ? `<div class="dots">${s.images.map((_, i) => `<span class="${i === slide ? 'on' : ''}"></span>`).join('')}</div>` : ''}
        ${sess.admin ? `<a class="plain btnlink mini" href="/upload?species=${s.id}${state.lang === 'en' ? '&lang=en' : ''}">${esc(L.uploadBtn)}</a>` : ''}
        ${sess.admin && im ? `<button class="plain mini" data-delimg="${im.id}">${esc(L.delImg)}</button>` : ''}
        ${cap || (im && im.credit) ? `<p class="cap">${esc(cap)}${im.credit ? ` ${cap ? '· ' : ''}${esc(L.credit)}: ${esc(im.credit)}` : ''}</p>` : ''}
        ${factsHtml([[L.fAuthority, s.authority], [L.family, g.family], [L.feeding_label, g.feeding_group && (L.feeding[g.feeding_group] || g.feeding_group)],
          [L.cp, g.cp_value], [L.code, s.internal_code]])}
        ${note ? `<h3>${esc(L.notes)}</h3><p>${esc(note)}</p>` : ''}
        ${s.siblings.length > 1 ? `<h3>${esc(L.otherSpecies)}</h3><div class="chips">${s.siblings.filter((x) => x.id !== s.id)
          .map((x) => `<a class="chip" href="#S${x.id}"><i>${esc(x.species)}</i></a>`).join('')}</div>` : ''}
        ${exportRow()}
        ${locationsHtml(s.locations, false)}
        ${sess.admin ? (ptEdit ? ptFormHtml() : `<button class="plain" data-addpt>${esc(L.addPt)}</button>`) : ''}
      </div>`;
    if (s.locations.length) drawMiniMap(s.locations, (p) => `${provLabel(p.province)} (${p.lat.toFixed(4)}, ${p.lng.toFixed(4)})`, () => colorOf(s.id));
  }

  function drawMiniMap(locs, label, color) {
    const el = $('minimap');
    if (!window.L) { el.textContent = t().mapFail; return; }
    map = window.L.map(el, { scrollWheelZoom: false });
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, referrerPolicy: 'strict-origin-when-cross-origin', attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    const pts = locs.map((p) => {
      const m = window.L.circleMarker([p.lat, p.lng], { radius: 7, color: '#fff', weight: 2, fillColor: color(p), fillOpacity: 1 }).addTo(map);
      const tip = document.createElement('span');
      tip.textContent = label(p);
      m.bindTooltip(tip);
      return [p.lat, p.lng];
    });
    if (pts.length === 1) map.setView(pts[0], 9); else map.fitBounds(pts, { padding: [24, 24], maxZoom: 10 });
  }

  async function openDetail(kind, id) {
    const my = ++dseq;
    let rec = null;
    try {
      const r = await fetch(`/api/${apiBase(kind)}/${id}`);
      if (r.ok) rec = await r.json();
    } catch {}
    if (my !== dseq) return;
    ptEdit = null;
    if (!rec) {
      cur = null;
      dlg.innerHTML = `<div class="d-head"><h2>${esc(t().notFound)}</h2><button class="d-close" data-close>${esc(t().close)}</button></div>`;
    } else { cur = Object.assign(rec, { kind }); slide = 0; renderDetail(true); }
    if (!dlg.open) dlg.showModal();
    if (map) map.invalidateSize();
  }

  const hashRe = /^#([GS])(\d+)$/;
  function closeDetail() {
    dseq++;
    if (dlg.open) dlg.close();
    destroyMap(); cur = null;
    if (hashRe.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  }

  function syncHash() {
    const m = hashRe.exec(location.hash);
    if (m) openDetail(m[1] === 'G' ? 'genus' : 'species', m[2]);
    else if (dlg.open) { dseq++; dlg.close(); destroyMap(); cur = null; }
  }
  window.addEventListener('hashchange', syncHash);
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) return closeDetail();
    const s = e.target.closest('[data-slide]');
    if (s && cur && cur.kind === 'species') { const n = cur.images.length; slide = (slide + Number(s.dataset.slide) + n) % n; renderDetail(); }
  });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeDetail(); });
  dlg.addEventListener('keydown', (e) => {
    if (!cur || cur.kind !== 'species' || cur.images.length < 2) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      slide = (slide + (e.key === 'ArrowRight' ? 1 : -1) + cur.images.length) % cur.images.length; renderDetail();
    }
  });

  // ---- admin session ----
  const lgn = $('login');
  const sess = { admin: false, enabled: true };

  async function loadSession() {
    try {
      const j = await (await fetch('/api/session')).json();
      sess.admin = !!j.admin; sess.enabled = !!j.login_enabled;
    } catch { sess.admin = false; }
    renderAdminBtn(); renderAddBtn(); renderDetail();
  }

  function renderAdminBtn() {
    const L = t(), b = $('admin-btn');
    b.classList.toggle('on', sess.admin);
    b.textContent = sess.admin ? `${L.adminOn} · ${L.logout}` : L.adminLogin;
    if (!sess.admin && !sess.enabled) b.title = L.loginDisabled; else b.removeAttribute('title');
  }

  function openLogin() {
    const L = t();
    lgn.innerHTML = `<div class="d-head"><h2 id="l-title" style="font-style:normal">${esc(L.adminLogin)}</h2>
        <button class="d-close" type="button" data-lclose>${esc(L.close)}</button></div>
      ${sess.enabled ? `<form id="lform" autocomplete="off">
        <input id="lpw" type="password" placeholder="${esc(L.password)}" aria-label="${esc(L.password)}" maxlength="200" required>
        <p id="lerr" class="err" role="alert"></p>
        <button class="primary" type="submit">${esc(L.signIn)}</button></form>`
        : `<p class="info">${esc(L.loginDisabled)}</p>`}`;
    lgn.showModal();
    const pw = $('lpw'); if (pw) pw.focus();
  }

  lgn.addEventListener('click', (e) => { if (e.target === lgn || e.target.closest('[data-lclose]')) lgn.close(); });
  lgn.addEventListener('submit', async (e) => {
    e.preventDefault();
    const L = t(), err = $('lerr'), pw = $('lpw');
    err.textContent = '';
    try {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw.value }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { lgn.close(); await loadSession(); return; }
      pw.value = '';
      err.textContent = r.status === 401 ? L.wrongPw : r.status === 429 ? L.locked(j.retry_after || 60) : L.loginErr;
    } catch { err.textContent = L.loginErr; }
  });
  $('admin-btn').addEventListener('click', async () => {
    if (sess.admin) { try { await fetch('/api/logout', { method: 'POST' }); } catch {} await loadSession(); }
    else openLogin();
  });

  // ---- add / edit / delete: genus and species (admin) ----
  const GFIELDS = ['genus', 'family', 'feeding_group', 'cp_value', 'internal_code', 'notes_th', 'notes_en'];
  const SFIELDS = ['species', 'authority', 'internal_code', 'notes_th', 'notes_en'];

  function renderAddBtn() {
    const b = $('add-btn');
    b.hidden = !sess.admin;
    b.textContent = t().addGenus;
  }

  function openGenusForm(g) { // g = existing genus, or null for a new one
    const L = t(), v = g || {};
    const val = (k) => esc(v[k] ?? '');
    const opts = (meta.feeding_options || []).map((k) =>
      `<option value="${esc(k)}"${v.feeding_group === k ? ' selected' : ''}>${esc(L.feeding[k] || k)}</option>`).join('');
    const cps = [1, 2, 3, 4, 5].map((n) => `<option value="${n}"${v.cp_value === n ? ' selected' : ''}>${n}</option>`).join('');
    destroyMap();
    dlg.innerHTML = `<div class="d-head"><h2 id="d-title" style="font-style:normal">${esc(g ? `${L.editGenus}: ${g.genus}` : L.addGenus.replace(/^\+\s*/, ''))}</h2>
        <button class="d-close" type="button" data-close>${esc(L.close)}</button></div>
      <form class="gform" id="gform" data-id="${g ? g.id : ''}" novalidate>
        <label>${esc(L.fGenus)}<input name="genus" value="${val('genus')}" maxlength="100" required></label>
        <p class="ferr" data-err="genus"></p>
        <div class="row">
          <label>${esc(L.fFamily)}<input name="family" value="${val('family')}" maxlength="100"></label>
          <label>${esc(L.fCode)}<input name="internal_code" value="${val('internal_code')}" maxlength="50"></label>
        </div>
        <div class="row">
          <label>${esc(L.fFeeding)}<select name="feeding_group"><option value="">${esc(L.none)}</option>${opts}</select></label>
          <label>${esc(L.fCp)}<select name="cp_value"><option value="">${esc(L.none)}</option>${cps}</select></label>
        </div>
        <label>${esc(L.fNotesTh)}<textarea name="notes_th" maxlength="5000">${esc(v.notes_th ?? '')}</textarea></label>
        <label>${esc(L.fNotesEn)}<textarea name="notes_en" maxlength="5000">${esc(v.notes_en ?? '')}</textarea></label>
        <p class="ferr" data-err="form" role="alert"></p>
        <div class="btns"><button type="button" class="plain" data-cancel>${esc(L.cancel)}</button>
          <button type="submit" class="primary">${esc(L.save)}</button></div>
      </form>`;
    if (!dlg.open) dlg.showModal();
    dlg.querySelector('[name=genus]').focus();
  }

  // s = existing species (cur is the species) or null: add under the current genus (cur is the genus)
  function openSpeciesForm(s) {
    const L = t(), v = s || {};
    const val = (k) => esc(v[k] ?? '');
    const gname = s ? s.genus.genus : cur.genus;
    destroyMap();
    dlg.innerHTML = `<div class="d-head"><h2 id="d-title" style="font-style:normal">${esc(s ? `${L.editSpecies}: ${gname} ${s.species}` : `${L.addSpecies.replace(/^\+\s*/, '')}: ${gname}`)}</h2>
        <button class="d-close" type="button" data-close>${esc(L.close)}</button></div>
      <form class="gform" id="sform" data-id="${s ? s.id : ''}" novalidate>
        <label>${esc(L.fSpecies)}<input name="species" value="${val('species')}" maxlength="100" required placeholder="incognita"></label>
        <p class="ferr" data-err="species"></p>
        <div class="row">
          <label>${esc(L.fAuthority)}<input name="authority" value="${val('authority')}" maxlength="200"></label>
          <label>${esc(L.fCode)}<input name="internal_code" value="${val('internal_code')}" maxlength="50"></label>
        </div>
        <label>${esc(L.fNotesTh)}<textarea name="notes_th" maxlength="5000">${esc(v.notes_th ?? '')}</textarea></label>
        <label>${esc(L.fNotesEn)}<textarea name="notes_en" maxlength="5000">${esc(v.notes_en ?? '')}</textarea></label>
        <p class="ferr" data-err="form" role="alert"></p>
        <div class="btns"><button type="button" class="plain" data-cancel>${esc(L.cancel)}</button>
          <button type="submit" class="primary">${esc(L.save)}</button></div>
      </form>`;
    if (!dlg.open) dlg.showModal();
    dlg.querySelector('[name=species]').focus();
  }

  async function refreshMeta() {
    try { meta = await (await fetch('/api/meta')).json(); } catch {}
    await refreshProvinces();
    renderChips(); load();
  }

  async function submitForm(form) {
    const L = t();
    const isSpecies = form.id === 'sform';
    const id = form.dataset.id;
    const body = {};
    for (const k of isSpecies ? SFIELDS : GFIELDS) {
      const raw = form.elements[k].value;
      body[k] = k === 'cp_value' ? (raw === '' ? null : Number(raw)) : raw;
    }
    dlg.querySelectorAll('.ferr').forEach((e) => { e.textContent = ''; });
    const url = isSpecies ? (id ? `/api/species/${id}` : `/api/genera/${cur.id}/species`) : (id ? `/api/genera/${id}` : '/api/genera');
    let r, j = {};
    try {
      r = await fetch(url, { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      j = await r.json().catch(() => ({}));
    } catch { dlg.querySelector('[data-err=form]').textContent = L.eSave; return; }
    if (r.ok) {
      const kind = isSpecies ? 'species' : 'genus';
      const rid = id || j.id;
      history.replaceState(null, '', location.pathname + location.search + hashOf(kind, rid));
      await refreshMeta();
      return openDetail(kind, rid);
    }
    if (r.status === 401) { await loadSession(); dlg.querySelector('[data-err=form]').textContent = L.eAuth; return; }
    const field = isSpecies ? 'species' : 'genus';
    const msg = isSpecies
      ? { required: L.eSpeciesRequired, duplicate: L.eSpeciesDup, invalid: L.eSpeciesInvalid }[j.error]
      : { required: L.eRequired, duplicate: L.eDuplicate, invalid: L.eInvalid }[j.error];
    dlg.querySelector(`[data-err="${j.field === field ? field : 'form'}"]`).textContent = msg || L.eSave;
  }

  function confirmDelete() {
    const L = t();
    const isG = cur.kind === 'genus';
    const name = isG ? cur.genus : `${cur.genus.genus} ${cur.species}`;
    dlg.innerHTML = `<div class="d-head"><h2 style="font-style:normal">${esc(isG ? L.confirmDel(name) : L.confirmDelSp(name))}</h2></div>
      <div class="d-body"><p>${esc(isG ? L.confirmDelNote : L.confirmDelSpNote)}</p><p class="ferr" id="delerr" role="alert" style="color:#b3261e"></p>
        <div class="btns"><button class="plain" data-cancel>${esc(L.cancel)}</button>
        <button class="danger" data-confirm-del>${esc(isG ? L.deleteGenus : L.deleteSpecies)}</button></div></div>`;
  }

  async function doDelete() {
    const L = t();
    const kind = cur.kind, back = kind === 'species' ? cur.genus_id : null;
    try {
      const r = await fetch(`/api/${apiBase(kind)}/${cur.id}`, { method: 'DELETE' });
      if (r.ok || r.status === 404) {
        await refreshMeta();
        if (back) { history.replaceState(null, '', location.pathname + location.search + hashOf('genus', back)); return openDetail('genus', back); }
        return closeDetail();
      }
      if (r.status === 401) { await loadSession(); $('delerr').textContent = L.eAuth; return; }
    } catch {}
    $('delerr').textContent = L.eSave;
  }

  dlg.addEventListener('submit', (e) => {
    if (e.target.id === 'gform' || e.target.id === 'sform') { e.preventDefault(); submitForm(e.target); }
  });
  $('add-btn').addEventListener('click', () => { cur = null; dseq++; openGenusForm(null); });

  // ---- map controls, point + image editing ----
  async function reloadCurrent() {
    if (!cur) return;
    try {
      const r = await fetch(`/api/${apiBase(cur.kind)}/${cur.id}`);
      if (r.ok) { const kind = cur.kind; cur = Object.assign(await r.json(), { kind }); ptEdit = null; renderDetail(true); }
    } catch {}
    refreshMeta();
  }

  const authFail = async () => { await loadSession(); };

  $('prov').addEventListener('change', (e) => { state.province = e.target.value; msel = null; update(); });
  $('maplist').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const toggle = (k, id) => { msel = msel && msel.k === k && msel.id === id ? null : { k, id }; };
    if (b.hasAttribute('data-mg-all')) msel = null;
    else if (b.dataset.mgG) toggle('g', Number(b.dataset.mgG));
    else if (b.dataset.mgS) toggle('s', Number(b.dataset.mgS));
    renderMapView();
  });

  dlg.addEventListener('click', async (e) => {
    const L = t();
    const b = e.target.closest('button');
    if (b && b.hasAttribute('data-cancel')) { if (cur) renderDetail(true); else closeDetail(); return; }
    if (!b || !cur) return;
    if (b.hasAttribute('data-edit')) { if (cur.kind === 'genus') openGenusForm(cur); else openSpeciesForm(cur); }
    else if (b.hasAttribute('data-addsp')) openSpeciesForm(null);
    else if (b.hasAttribute('data-del')) confirmDelete();
    else if (b.hasAttribute('data-confirm-del')) doDelete();
    else if (b.hasAttribute('data-addpt')) { ptEdit = { id: null }; renderDetail(true); }
    else if (b.dataset.ept) {
      const p = cur.locations.find((x) => String(x.id) === b.dataset.ept);
      if (p) { ptEdit = { ...p }; renderDetail(true); }
    } else if (b.hasAttribute('data-ptcancel')) { ptEdit = null; renderDetail(true); }
    else if (b.dataset.dpt) {
      if (!confirm(L.confirmPt)) return;
      const r = await fetch(`/api/locations/${b.dataset.dpt}`, { method: 'DELETE' });
      if (r.status === 401) return authFail();
      reloadCurrent();
    } else if (b.dataset.delimg) {
      if (!confirm(L.confirmImg)) return;
      const r = await fetch(`/api/images/${b.dataset.delimg}`, { method: 'DELETE' });
      if (r.status === 401) return authFail();
      reloadCurrent();
    }
  });

  dlg.addEventListener('submit', async (e) => {
    if (e.target.id !== 'ptform') return;
    e.preventDefault();
    const L = t(), f = e.target.elements;
    const num = (v) => (!v.trim() ? null : /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN); // blank -> server defaults to the province's Mueang district
    const body = { province: f.province.value, lat: num(f.lat.value), lng: num(f.lng.value), collected_at: f.collected_at.value, note: f.note.value };
    const err = $('pterr');
    if (!body.province || (body.lat === null) !== (body.lng === null)) { err.textContent = trimLead(L.ePointIncomplete('')); return; }
    if (Number.isNaN(body.lat) || Number.isNaN(body.lng)) { err.textContent = trimLead(L.ePointRange('')); return; }
    const id = ptEdit && ptEdit.id;
    const r = await fetch(id ? `/api/locations/${id}` : `/api/species/${cur.id}/locations`, {
      method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 401) { await authFail(); err.textContent = L.eAuth; return; }
    if (!r.ok) { err.textContent = trimLead(L.ePointRange('')); return; }
    reloadCurrent();
  });

  // ---- Excel export ----
  const xdlg = $('exp');

  function exportHref(scope, embed) {
    const p = new URLSearchParams();
    if (scope === 'view') {
      p.set('scope', 'view');
      if (state.q) p.set('q', state.q);
      if (state.feeding) p.set('feeding', state.feeding);
      if (state.letter) p.set('letter', state.letter);
      p.set('sort', state.sort);
      if (state.view === 'map' && state.province) p.set('province', state.province); // province filter exists only in map view
    }
    if (embed) p.set('embed', '1');
    return `/api/export.xlsx?${p}`;
  }

  function openExport() {
    const L = t();
    xdlg.innerHTML = `<div class="d-head"><h2 id="x-title" style="font-style:normal">${esc(L.expTitle)}</h2>
        <button class="d-close" type="button" data-xclose>${esc(L.close)}</button></div>
      <div class="gform" style="padding:0 16px 16px">
        <label class="radio"><input type="radio" name="xs" value="view" checked> ${esc(L.expView)}</label>
        <label class="radio"><input type="radio" name="xs" value="all"> ${esc(L.expAll)}</label>
        <label class="chk"><input type="checkbox" id="xe"> ${esc(L.expEmbed)}</label>
        <div class="btns"><a class="primary btnlink" id="xgo" href="${exportHref('view', false)}" download>${esc(L.expDownload)}</a></div>
      </div>`;
    xdlg.showModal();
  }
  function syncExportLink() {
    const scope = xdlg.querySelector('[name=xs]:checked').value;
    $('xgo').href = exportHref(scope, $('xe').checked);
  }
  $('exp-btn').addEventListener('click', openExport);
  xdlg.addEventListener('change', syncExportLink);
  xdlg.addEventListener('click', (e) => {
    if (e.target === xdlg || e.target.closest('[data-xclose]')) xdlg.close();
    else if (e.target.closest('#xgo')) setTimeout(() => xdlg.close(), 300);
  });
  dlg.addEventListener('change', (e) => {
    if (!e.target.matches('[data-expx-img]') || !cur) return;
    dlg.querySelector('[data-expx]').href = `/api/${apiBase(cur.kind)}/${cur.id}/export.xlsx${e.target.checked ? '?embed=1' : ''}`;
  });

  function update() { writeUrl(); renderStatic(); renderChips(); load(); renderDetail(); renderAdminBtn(); renderAddBtn(); }

  let timer;
  $('q').addEventListener('input', (e) => {
    state.q = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(update, 200);
  });
  $('q').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { state.q = ''; e.target.value = ''; update(); }
  });
  $('qclear').addEventListener('click', () => { state.q = ''; $('q').value = ''; $('q').focus(); update(); });
  $('clear').addEventListener('click', () => {
    state.q = state.feeding = state.letter = state.province = ''; msel = null; $('q').value = ''; update();
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.lang) {
      state.lang = b.dataset.lang;
      try { localStorage.setItem('lang', state.lang); } catch {}
      update();
    } else if (b.dataset.sort) { state.sort = b.dataset.sort; update(); }
    else if (b.dataset.view) { state.view = b.dataset.view; update(); }
    else if (b.classList.contains('chip')) { state.feeding = b.dataset.feeding; update(); }
    else if (b.dataset.letter) { state.letter = state.letter === b.dataset.letter ? '' : b.dataset.letter; update(); }
  });

  (async () => {
    readUrl();
    $('q').value = state.q;
    try { meta = await (await fetch('/api/meta')).json(); } catch {}
    try { (await (await fetch('/api/provinces')).json()).items.forEach((p) => { provinces[p.key] = p.th; }); } catch {}
    await refreshProvinces();
    update();
    loadSession();
    syncHash();
  })();
})();
