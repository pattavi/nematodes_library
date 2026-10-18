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

  function renderDetail() {
    if (!cur) return;
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
        <button class="d-close" data-close>${esc(L.close)}</button></div>
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
    } else { cur = g; slide = 0; renderDetail(); }
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

  function update() { writeUrl(); renderStatic(); renderChips(); load(); renderDetail(); }

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
    syncHash();
  })();
})();
