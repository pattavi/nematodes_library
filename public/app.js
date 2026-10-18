(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = { lang: 'th', q: '', feeding: '', letter: '', sort: 'asc', view: 'list', province: '' };
  const PALETTE = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#0aa5c9', '#d6249f', '#9a6324', '#808000', '#008080', '#800000', '#000075'];
  const colorOf = (id) => PALETTE[id % PALETTE.length];
  let provinces = {};      // key -> Thai name (all 77)
  let provUse = [];        // provinces that have points: [{key, count}]
  let mapData = [];        // current map points
  let msel = null;         // genus id selected on the map
  let bigMap = null, bigLayer = null;
  let meta = { feeding: [], letters: [] };
  let seq = 0;

  const t = () => I18N[state.lang];

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
    history.replaceState(null, "", (qs ? `?${qs}` : location.pathname) + location.hash);
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
        <div class="thumb">${g.cover ? `<img loading="lazy" src="/uploads/thumbs/${encodeURIComponent(g.cover.replace(/\.[^.]+$/, '.jpg'))}" alt="">` : esc(L.noImage)}</div>
        <div class="body">
          <h3>${esc(g.genus)}</h3>
          <div class="meta">${g.family ? `${esc(L.family)}: ${esc(g.family)}` : ''}</div>
          ${g.feeding_group ? `<span class="tag">${esc(L.feeding[g.feeding_group] || g.feeding_group)}</span>` : ''}
          <div class="meta">${g.image_count} ${esc(L.images)} · ${g.location_count} ${esc(L.points)}</div>
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

  function renderMapView() {
    const L = t();
    const groups = new Map();
    for (const pt of mapData) {
      if (!groups.has(pt.genus_id)) groups.set(pt.genus_id, { id: pt.genus_id, genus: pt.genus, pts: [] });
      groups.get(pt.genus_id).pts.push(pt);
    }
    if (msel != null && !groups.has(msel)) msel = null;
    $('count').textContent = L.mapCount(groups.size, mapData.length);
    $('clear').hidden = activeFilters() === 0;
    $('clear').textContent = `${L.clear} (${activeFilters()})`;
    $('qclear').hidden = !state.q;

    const list = [...groups.values()];
    $('maplist').innerHTML = (msel != null ? `<button class="link" data-mg-all>${esc(L.showAll)}</button>` : '') +
      (list.length ? list.map((g) => `<button class="mg${msel === g.id ? ' on' : ''}" data-mg="${g.id}">
        <span class="sw" style="background:${colorOf(g.id)}"></span><i>${esc(g.genus)}</i><span class="muted">${g.pts.length} ${esc(L.pts)}</span></button>`).join('')
        : `<p class="muted">${esc(L.noPoints)}</p>`);

    const el = $('bigmap');
    if (!window.L) { el.textContent = L.mapFail; return; }
    if (!bigMap) {
      bigMap = window.L.map(el);
      window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(bigMap);
      bigLayer = window.L.layerGroup().addTo(bigMap);
    }
    bigMap.invalidateSize();
    bigLayer.clearLayers();
    const shown = mapData.filter((pt) => msel == null || pt.genus_id === msel);
    const bounds = [];
    for (const pt of shown) {
      const m = window.L.circleMarker([pt.lat, pt.lng], { radius: 8, color: '#fff', weight: 2, fillColor: colorOf(pt.genus_id), fillOpacity: 0.95 }).addTo(bigLayer);
      const tip = document.createElement('span');
      tip.textContent = msel != null ? provLabel(pt.province)
        : `${pt.genus} — ${provLabel(pt.province)} (${pt.lat.toFixed(4)}, ${pt.lng.toFixed(4)})`;
      m.bindTooltip(tip, { permanent: msel != null, direction: 'top' });
      m.on('click', () => { location.hash = `#G${pt.genus_id}`; });
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

  // ---- detail dialog ----
  const dlg = $('detail');
  let cur = null, slide = 0, map = null, dseq = 0;
  const pick = (g, base) => g[`${base}_${state.lang}`] || g[`${base}_${state.lang === 'th' ? 'en' : 'th'}`] || '';

  let ptEdit = null; // null | { id: number|null, ...fields } while the point form is open

  function ptFormHtml() {
    const L = t(), v = ptEdit;
    const opts = Object.keys(provinces).sort((a, b) => provLabel(a).localeCompare(provLabel(b), state.lang)).map((k) => [k])
      .map(([k]) => `<option value="${esc(k)}"${v.province === k ? ' selected' : ''}>${esc(provLabel(k))}</option>`).join('');
    return `<form id="ptform" class="gform ptform" novalidate>
      <div class="row"><label>${esc(L.province)}<select name="province"><option value="">${esc(L.chooseProv)}</option>${opts}</select></label>
        <label>${esc(L.dateLbl)}<input name="collected_at" type="date" value="${esc(v.collected_at || '')}"></label></div>
      <div class="row"><label>${esc(L.lat)}<input name="lat" inputmode="decimal" value="${esc(v.lat ?? '')}"></label>
        <label>${esc(L.lng)}<input name="lng" inputmode="decimal" value="${esc(v.lng ?? '')}"></label></div>
      <label>${esc(L.noteLbl)}<input name="note" maxlength="500" value="${esc(v.note || '')}"></label>
      <p class="ferr" id="pterr" role="alert"></p>
      <div class="btns"><button type="button" class="plain" data-ptcancel>${esc(L.cancel)}</button><button type="submit" class="primary">${esc(L.save)}</button></div></form>`;
  }

  function destroyMap() { if (map) { map.remove(); map = null; } }

  function renderDetail(force) {
    if (!cur) return;
    if (!force && dlg.querySelector('#gform, [data-confirm-del]')) return; // don't clobber an open form from a background refresh
    const L = t(), g = cur, n = g.images.length;
    slide = Math.min(slide, Math.max(0, n - 1));
    const im = g.images[slide];
    const cap = im ? pick(im, 'caption') : '';
    const facts = [
      [L.family, g.family], [L.feeding_label, g.feeding_group && (L.feeding[g.feeding_group] || g.feeding_group)],
      [L.cp, g.cp_value], [L.code, g.internal_code],
    ].filter(([, v]) => v != null && v !== '');
    const note = pick(g, 'notes');
    destroyMap();
    dlg.innerHTML = `
      <div class="d-head"><h2 id="d-title">${esc(g.genus)}</h2>
        <div class="d-actions">${sess.admin ? `<button data-edit>${esc(L.editGenus)}</button><button class="danger" data-del>${esc(L.deleteGenus)}</button>` : ''}
          <button class="d-close" data-close>${esc(L.close)}</button></div></div>
      <div class="d-body">
        <div class="slides">${im ? `<img src="/uploads/${encodeURIComponent(im.file)}" alt="${esc(g.genus)}">` : esc(L.noImage)}
          ${n > 1 ? `<button class="nav prev" data-slide="-1" aria-label="${esc(L.prev)}">‹</button>
                     <button class="nav next" data-slide="1" aria-label="${esc(L.next)}">›</button>` : ''}</div>
        ${n > 1 ? `<div class="dots">${g.images.map((_, i) => `<span class="${i === slide ? 'on' : ''}"></span>`).join('')}</div>` : ''}
        ${sess.admin && im ? `<button class="plain mini" data-delimg="${im.id}">${esc(L.delImg)}</button>` : ''}
        ${cap || (im && im.credit) ? `<p class="cap">${esc(cap)}${im.credit ? ` ${cap ? '· ' : ''}${esc(L.credit)}: ${esc(im.credit)}` : ''}</p>` : ''}
        <dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        ${note ? `<h3>${esc(L.notes)}</h3><p>${esc(note)}</p>` : ''}
        <div class="expgenus"><a class="plain btnlink" data-expgenus href="/api/genera/${g.id}/export.xlsx" download>${esc(L.expGenus)}</a>
          <label class="chk"><input type="checkbox" data-expgenus-img> ${esc(L.expGenusImg)}</label></div>
        <h3>${esc(L.locations)} (${g.locations.length})</h3>
        ${g.locations.length ? `<div id="minimap" class="minimap"></div>
          <ul class="locs">${g.locations.map((p) => `<li>${esc(provLabel(p.province))} · ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}${p.collected_at ? ` · ${esc(p.collected_at)}` : ''}${p.is_sample ? ` <span class="muted">(${esc(L.sample)})</span>` : ''}
            ${sess.admin ? `<button class="mini" data-ept="${p.id}" aria-label="${esc(L.editGenus)}">✎</button><button class="mini" data-dpt="${p.id}" aria-label="${esc(L.deleteGenus)}">×</button>` : ''}</li>`).join('')}</ul>`
          : `<p class="muted">${esc(L.noLocations)}</p>`}
        ${sess.admin ? (ptEdit ? ptFormHtml() : `<button class="plain" data-addpt>${esc(L.addPt)}</button>`) : ''}
      </div>`;
    if (g.locations.length) drawMiniMap(g.locations);
  }

  function drawMiniMap(locs) {
    const el = $('minimap');
    if (typeof L === 'undefined' || !window.L) { el.textContent = t().mapFail; return; }
    map = window.L.map(el, { scrollWheelZoom: false });
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    const pts = locs.map((p) => {
      const m = window.L.circleMarker([p.lat, p.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#2f6f4e', fillOpacity: 1 }).addTo(map);
      const tip = document.createElement('span');
      tip.textContent = `${p.province} (${p.lat.toFixed(4)}, ${p.lng.toFixed(4)})`;
      m.bindTooltip(tip);
      return [p.lat, p.lng];
    });
    if (pts.length === 1) map.setView(pts[0], 9); else map.fitBounds(pts, { padding: [24, 24], maxZoom: 10 });
  }

  async function openDetail(id) {
    const my = ++dseq;
    let g = null;
    try {
      const r = await fetch(`/api/genera/${id}`);
      if (r.ok) g = await r.json();
    } catch {}
    if (my !== dseq) return;
    if (!g) {
      cur = null;
      dlg.innerHTML = `<div class="d-head"><h2>${esc(t().notFound)}</h2><button class="d-close" data-close>${esc(t().close)}</button></div>`;
    } else { cur = g; slide = 0; renderDetail(true); }
    if (!dlg.open) dlg.showModal();
    if (map) map.invalidateSize();
  }

  function closeDetail() {
    dseq++;
    if (dlg.open) dlg.close();
    destroyMap(); cur = null;
    if (/^#G\d+$/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  }

  function syncHash() {
    const m = /^#G(\d+)$/.exec(location.hash);
    if (m) openDetail(m[1]); else if (dlg.open) { dseq++; dlg.close(); destroyMap(); cur = null; }
  }
  window.addEventListener('hashchange', syncHash);
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) return closeDetail();
    const s = e.target.closest('[data-slide]');
    if (s && cur) { const n = cur.images.length; slide = (slide + Number(s.dataset.slide) + n) % n; renderDetail(); }
  });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeDetail(); });
  dlg.addEventListener('keydown', (e) => {
    if (!cur || cur.images.length < 2) return;
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

  // ---- add / edit / delete genus (admin) ----
  const FIELDS = ['genus', 'family', 'feeding_group', 'cp_value', 'internal_code', 'notes_th', 'notes_en'];

  function renderAddBtn() {
    const b = $('add-btn');
    b.hidden = !sess.admin;
    b.textContent = t().addGenus;
  }

  function openForm(g) { // g = existing genus, or null for a new one
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

  async function refreshMeta() {
    try { meta = await (await fetch('/api/meta')).json(); } catch {}
    await refreshProvinces();
    renderChips(); load();
  }

  async function submitForm(form) {
    const L = t();
    const id = form.dataset.id;
    const body = {};
    for (const k of FIELDS) {
      const raw = form.elements[k].value;
      body[k] = k === 'cp_value' ? (raw === '' ? null : Number(raw)) : raw;
    }
    dlg.querySelectorAll('.ferr').forEach((e) => { e.textContent = ''; });
    let r, j = {};
    try {
      r = await fetch(id ? `/api/genera/${id}` : '/api/genera', { method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      j = await r.json().catch(() => ({}));
    } catch { dlg.querySelector('[data-err=form]').textContent = L.eSave; return; }
    if (r.ok) {
      const gid = id || j.id;
      history.replaceState(null, '', location.pathname + location.search + '#G' + gid);
      await refreshMeta();
      return openDetail(gid);
    }
    if (r.status === 401) { await loadSession(); dlg.querySelector('[data-err=form]').textContent = L.eAuth; return; }
    const msg = { required: L.eRequired, duplicate: L.eDuplicate, invalid: L.eInvalid }[j.error];
    dlg.querySelector(`[data-err="${j.field === 'genus' ? 'genus' : 'form'}"]`).textContent = msg || L.eSave;
  }

  function confirmDelete() {
    const L = t();
    dlg.innerHTML = `<div class="d-head"><h2 style="font-style:normal">${esc(L.confirmDel(cur.genus))}</h2></div>
      <div class="d-body"><p>${esc(L.confirmDelNote)}</p><p class="ferr" id="delerr" role="alert" style="color:#b3261e"></p>
        <div class="btns"><button class="plain" data-cancel>${esc(L.cancel)}</button>
        <button class="danger" data-confirm-del>${esc(L.deleteGenus)}</button></div></div>`;
  }

  async function doDelete() {
    const L = t();
    try {
      const r = await fetch(`/api/genera/${cur.id}`, { method: 'DELETE' });
      if (r.ok || r.status === 404) { closeDetail(); return refreshMeta(); }
      if (r.status === 401) { await loadSession(); $('delerr').textContent = L.eAuth; return; }
    } catch {}
    $('delerr').textContent = L.eSave;
  }

  dlg.addEventListener('submit', (e) => { if (e.target.id === 'gform') { e.preventDefault(); submitForm(e.target); } });
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-edit]') && cur) openForm(cur);
    else if (e.target.closest('[data-del]') && cur) confirmDelete();
    else if (e.target.closest('[data-confirm-del]')) doDelete();
    else if (e.target.closest('[data-cancel]')) { if (cur) renderDetail(true); else closeDetail(); }
  });
  $('add-btn').addEventListener('click', () => { cur = null; dseq++; openForm(null); });

  // ---- map controls, point + image editing ----
  async function reloadCurrent() {
    if (!cur) return;
    try {
      const r = await fetch(`/api/genera/${cur.id}`);
      if (r.ok) { cur = await r.json(); ptEdit = null; renderDetail(true); }
    } catch {}
    refreshMeta(); refreshProvinces();
  }

  const authFail = async () => { await loadSession(); };

  $('prov').addEventListener('change', (e) => { state.province = e.target.value; msel = null; update(); });
  $('maplist').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-mg-all')) msel = null;
    else if (b.dataset.mg) msel = msel === Number(b.dataset.mg) ? null : Number(b.dataset.mg);
    renderMapView();
  });

  dlg.addEventListener('click', async (e) => {
    const L = t();
    const b = e.target.closest('button');
    if (!b || !cur) return;
    if (b.hasAttribute('data-addpt')) { ptEdit = { id: null }; renderDetail(true); }
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
    const num = (v) => (/^\s*-?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN);
    const body = { province: f.province.value, lat: num(f.lat.value), lng: num(f.lng.value), collected_at: f.collected_at.value, note: f.note.value };
    const err = $('pterr');
    if (!body.province) { err.textContent = L.ePointIncomplete('').replace(/^[^:：]+[:：]s*/, ''); return; }
    if (Number.isNaN(body.lat) || Number.isNaN(body.lng)) { err.textContent = L.ePointRange('').replace(/^[^:：]+[:：]s*/, ''); return; }
    const id = ptEdit && ptEdit.id;
    const r = await fetch(id ? `/api/locations/${id}` : `/api/genera/${cur.id}/locations`, {
      method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 401) { await authFail(); err.textContent = L.eAuth; return; }
    if (!r.ok) { err.textContent = L.ePointRange('').replace(/^[^:：]+[:：]s*/, ''); return; }
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
    if (!e.target.matches('[data-expgenus-img]') || !cur) return;
    dlg.querySelector('[data-expgenus]').href = `/api/genera/${cur.id}/export.xlsx${e.target.checked ? '?embed=1' : ''}`;
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
