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
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
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

  function update() { writeUrl(); renderStatic(); renderChips(); load(); }

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
  })();
})();
