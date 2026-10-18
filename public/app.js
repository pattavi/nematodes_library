(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = { lang: 'th', q: '', feeding: '', letter: '', sort: 'asc' };
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
  }

  function writeUrl() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.feeding) p.set('feeding', state.feeding);
    if (state.letter) p.set('letter', state.letter);
    if (state.sort !== 'asc') p.set('sort', state.sort);
    if (state.lang === 'en') p.set('lang', 'en');
    const qs = p.toString();
    history.replaceState(null, "", (qs ? `?${qs}` : location.pathname) + location.hash);
  }

  const activeFilters = () => (state.q ? 1 : 0) + (state.feeding ? 1 : 0) + (state.letter ? 1 : 0);

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
        <div class="thumb">${esc(L.noImage)}</div>
        <div class="body">
          <h3>${esc(g.genus)}</h3>
          <div class="meta">${g.family ? `${esc(L.family)}: ${esc(g.family)}` : ''}</div>
          ${g.feeding_group ? `<span class="tag">${esc(L.feeding[g.feeding_group] || g.feeding_group)}</span>` : ''}
          <div class="meta">${g.image_count} ${esc(L.images)} · ${g.location_count} ${esc(L.points)}</div>
        </div></a>`;
    }
    $('grid').innerHTML = html;
  }

  async function load() {
    const my = ++seq;
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.feeding) p.set('feeding', state.feeding);
    if (state.letter) p.set('letter', state.letter);
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
        ${cap || (im && im.credit) ? `<p class="cap">${esc(cap)}${im.credit ? ` ${cap ? '· ' : ''}${esc(L.credit)}: ${esc(im.credit)}` : ''}</p>` : ''}
        <dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        ${note ? `<h3>${esc(L.notes)}</h3><p>${esc(note)}</p>` : ''}
        <h3>${esc(L.locations)} (${g.locations.length})</h3>
        ${g.locations.length ? `<div id="minimap" class="minimap"></div>
          <ul class="locs">${g.locations.map((p) => `<li>${esc(p.province)} · ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}${p.is_sample ? ` <span class="muted">(${esc(L.sample)})</span>` : ''}</li>`).join('')}</ul>`
          : `<p class="muted">${esc(L.noLocations)}</p>`}
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
    state.q = state.feeding = state.letter = ''; $('q').value = ''; update();
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.lang) {
      state.lang = b.dataset.lang;
      try { localStorage.setItem('lang', state.lang); } catch {}
      update();
    } else if (b.dataset.sort) { state.sort = b.dataset.sort; update(); }
    else if (b.classList.contains('chip')) { state.feeding = b.dataset.feeding; update(); }
    else if (b.dataset.letter) { state.letter = state.letter === b.dataset.letter ? '' : b.dataset.letter; update(); }
  });

  (async () => {
    readUrl();
    $('q').value = state.q;
    try { meta = await (await fetch('/api/meta')).json(); } catch {}
    update();
    loadSession();
    syncHash();
  })();
})();
