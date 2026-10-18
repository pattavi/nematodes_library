(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LAT = [5.5, 20.5], LNG = [97.3, 105.7];
  const MAX = 10 * 1024 * 1024, OK_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  const params = new URLSearchParams(location.search);
  let lang = params.get('lang');
  if (!lang) { try { lang = localStorage.getItem('lang'); } catch {} }
  lang = lang === 'en' ? 'en' : 'th';
  const t = () => I18N[lang];

  const S = { admin: false, enabled: true, genera: [], provinces: [], feeding: [], files: [], points: [], busy: false, done: null,
    genusSel: '', speciesSel: '', speciesList: [], ng: null, ns: null };
  let nid = 0;
  const provName = (p) => (lang === 'th' ? p.th : p.key);

  // ---- data ----
  async function loadAll() {
    try {
      const [s, g, p, m] = await Promise.all(['/api/session', '/api/genera', '/api/provinces', '/api/meta'].map((u) => fetch(u).then((r) => r.json())));
      S.admin = !!s.admin; S.enabled = !!s.login_enabled;
      S.genera = g.items; S.provinces = p.items; S.feeding = m.feeding_options || [];
    } catch {}
  }

  async function loadSpecies(genusId) {
    S.speciesList = [];
    if (genusId && genusId !== 'new') {
      try { S.speciesList = (await (await fetch(`/api/genera/${genusId}`)).json()).species || []; } catch {}
    }
  }

  // /upload?species=ID selects both; /upload?genus=ID selects the genus only
  async function preselect() {
    const sp = params.get('species'), ge = params.get('genus');
    if (sp && /^\d+$/.test(sp)) {
      try {
        const r = await fetch(`/api/species/${sp}`);
        if (r.ok) {
          const j = await r.json();
          S.genusSel = String(j.genus_id); S.speciesSel = String(j.id); S.speciesList = j.siblings;
          return;
        }
      } catch {}
    }
    if (ge && /^\d+$/.test(ge) && S.genera.some((g) => String(g.id) === ge)) { S.genusSel = ge; await loadSpecies(ge); }
  }

  // ---- render ----
  function renderTop() {
    const L = t();
    document.documentElement.lang = lang;
    document.title = L.uploadTitle;
    $('title').textContent = L.uploadTitle;
    $('back').textContent = L.backHome;
    $('back').href = lang === 'en' ? '/?lang=en' : '/';
    document.querySelectorAll('[data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
    const ab = $('admin-btn');
    ab.hidden = !S.admin;
    ab.classList.add('on');
    ab.textContent = `${L.adminOn} · ${L.logout}`;
  }

  function provOptions(sel) {
    return `<option value="">${esc(t().chooseProv)}</option>` +
      S.provinces.slice().sort((x, y) => provName(x).localeCompare(provName(y), lang)).map((p) => `<option value="${esc(p.key)}"${sel === p.key ? ' selected' : ''}>${esc(provName(p))}</option>`).join('');
  }

  function render() {
    renderTop();
    const L = t(), root = $('root');
    if (!S.admin) {
      root.innerHTML = `<div class="upcard"><p>${esc(L.needLogin)}</p>
        ${S.enabled ? `<form id="lform" class="gform" autocomplete="off">
          <label>${esc(L.password)}<input id="lpw" type="password" maxlength="200" required></label>
          <p id="lerr" class="ferr" role="alert"></p>
          <div class="btns"><button class="primary" type="submit">${esc(L.signIn)}</button></div></form>`
          : `<p class="muted">${esc(L.loginDisabled)}</p>`}</div>`;
      return;
    }
    if (S.done) return renderDone();
    if (!S.points.length) S.points.push({ id: ++nid, province: '', lat: '', lng: '' });
    root.innerHTML = `<form id="up" class="upcard gform" novalidate>
      <label>${esc(L.selGenus)}
        <select id="genus">
          <option value="">${esc(L.chooseGenus)}</option>
          ${S.genera.map((g) => `<option value="${g.id}"${String(g.id) === S.genusSel ? ' selected' : ''}>${esc(g.genus)}</option>`).join('')}
          <option value="new"${S.genusSel === 'new' ? ' selected' : ''}>${esc(L.newGenusOpt)}</option>
        </select></label>
      <div id="newg" ${S.genusSel === 'new' ? '' : 'hidden'} class="newg">
        <label>${esc(L.gNameReq)}<input id="ng-name" maxlength="100" value="${esc(S.ng?.name || '')}"></label>
        <div class="row">
          <label>${esc(L.fFamily)}<input id="ng-fam" maxlength="100" value="${esc(S.ng?.fam || '')}"></label>
          <label>${esc(L.fFeeding)}<select id="ng-feed"><option value="">${esc(L.none)}</option>
            ${S.feeding.map((k) => `<option value="${esc(k)}"${S.ng?.feed === k ? ' selected' : ''}>${esc(L.feeding[k] || k)}</option>`).join('')}</select></label>
        </div>
        <label>${esc(L.fCp)}<select id="ng-cp"><option value="">${esc(L.none)}</option>
          ${[1, 2, 3, 4, 5].map((n) => `<option value="${n}"${String(S.ng?.cp) === String(n) ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <p class="ferr" data-err="genus"></p>

      <div id="spbox" class="spbox">${speciesBoxHtml()}</div>
      <p class="ferr" data-err="species"></p>

      <h3>${esc(L.imagesTitle)}</h3>
      <div id="drop" class="drop" tabindex="0" role="button">
        <div>${esc(L.dropHint)}</div><div class="muted">${esc(L.fileRules)}</div>
        <input id="file" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden>
      </div>
      <div id="files"></div>
      <p class="ferr" data-err="files"></p>
      <label>${esc(L.creditOpt)}<input id="credit" maxlength="200" value="${esc(S.credit || '')}"></label>

      <h3>${esc(L.pointsTitle)}</h3>
      <div id="points"></div>
      <div><button type="button" class="plain" id="addpt">${esc(L.addPoint)}</button></div>
      <p class="ferr" data-err="points"></p>

      <div id="prog" class="prog" hidden><div id="bar"></div><span id="ptxt"></span></div>
      <p class="ferr" data-err="form" role="alert"></p>
      <div class="btns"><button class="primary" type="submit" id="go">${esc(L.submitUp)}</button></div>
    </form>`;
    renderFiles(); renderPoints();
  }

  // Species picker: existing species of the chosen genus, or a new one (always new when the genus is new).
  function speciesBoxHtml() {
    const L = t();
    if (!S.genusSel) return `<p class="muted">${esc(L.pickGenusFirst)}</p>`;
    const isNewGenus = S.genusSel === 'new';
    const select = isNewGenus ? '' : `<label>${esc(L.selSpecies)}
        <select id="species">
          <option value="">${esc(L.chooseSpecies)}</option>
          ${S.speciesList.map((s) => `<option value="${s.id}"${String(s.id) === S.speciesSel ? ' selected' : ''}>${esc(s.species)}</option>`).join('')}
          <option value="new"${S.speciesSel === 'new' ? ' selected' : ''}>${esc(L.newSpeciesOpt)}</option>
        </select></label>`;
    const showNew = isNewGenus || S.speciesSel === 'new';
    const fields = showNew ? `<div class="newg">
        <label>${esc(L.nsNameReq)}<input id="ns-name" maxlength="100" placeholder="incognita" value="${esc(S.ns?.name || '')}"></label>
        <label>${esc(L.nsAuth)}<input id="ns-auth" maxlength="200" value="${esc(S.ns?.auth || '')}"></label>
        <p class="muted">${esc(L.spHint)}</p></div>` : '';
    return select + fields;
  }

  function renderSpeciesBox() { $('spbox').innerHTML = speciesBoxHtml(); }

  function renderFiles() {
    const L = t();
    $('files').innerHTML = S.files.map((f) => `<div class="frow" data-fid="${f.id}">
      <img src="${f.url}" alt="">
      <div class="fcols">
        <div class="fname">${esc(f.file.name)} <span class="muted">(${(f.file.size / 1048576).toFixed(1)} MB)</span></div>
        <input data-cap="th" placeholder="${esc(L.capTh)}" maxlength="300" value="${esc(f.th)}">
        <input data-cap="en" placeholder="${esc(L.capEn)}" maxlength="300" value="${esc(f.en)}">
      </div>
      <button type="button" class="plain" data-rmfile="${f.id}">${esc(L.remove)}</button></div>`).join('');
  }

  function renderPoints() {
    const L = t();
    $('points').innerHTML = S.points.map((p, i) => `<div class="prow" data-pid="${p.id}">
      <label>${esc(L.province)}<select data-f="province">${provOptions(p.province)}</select></label>
      <label>${esc(L.lat)}<input data-f="lat" inputmode="decimal" value="${esc(p.lat)}"></label>
      <label>${esc(L.lng)}<input data-f="lng" inputmode="decimal" value="${esc(p.lng)}"></label>
      <div class="pbtns"><button type="button" class="plain" data-pick="${p.id}">${esc(L.pick)}</button>
        <button type="button" class="plain" data-rmpt="${p.id}" aria-label="${esc(L.remove)} ${i + 1}">×</button></div></div>`).join('');
  }

  function renderDone() {
    const L = t(), d = S.done;
    $('root').innerHTML = `<div class="upcard"><h2>${esc(L.done)}</h2><p>${esc(L.doneSummary(d.images, d.points))}</p>
      ${d.warnings.map((w) => `<p class="ferr">${esc(w)}</p>`).join('')}
      <div class="btns"><a class="plain btnlink" href="/#G${d.genusId}">${esc(L.viewGenus)}</a>
        <a class="plain btnlink" href="/#S${d.speciesId}">${esc(L.viewSpecies)}</a>
        <button class="primary" id="more">${esc(L.uploadMore)}</button></div></div>`;
  }

  // ---- state helpers ----
  function addFiles(list) {
    const L = t(), errs = [];
    for (const f of list) {
      if (!OK_TYPES.includes(f.type)) { errs.push(L.eType(f.name)); continue; }
      if (f.size > MAX) { errs.push(L.eSize(f.name)); continue; }
      S.files.push({ id: ++nid, file: f, url: URL.createObjectURL(f), th: '', en: '' });
    }
    renderFiles();
    setErr('files', errs.join(' · '));
  }

  function setErr(k, msg) { const e = document.querySelector(`[data-err="${k}"]`); if (e) e.textContent = msg || ''; }

  const parseNum = (v) => (/^\s*-?\d+(\.\d+)?\s*$/.test(String(v)) ? Number(v) : NaN);

  // Rows left completely empty are ignored; a row with anything in it needs province + valid lat/lng.
  function collectPoints() {
    const L = t(), out = [];
    let n = 0;
    for (const p of S.points) {
      if (!p.province && !String(p.lat).trim() && !String(p.lng).trim()) continue;
      n++;
      if (!p.province || !String(p.lat).trim() || !String(p.lng).trim()) return { error: L.ePointIncomplete(n) };
      const lat = parseNum(p.lat), lng = parseNum(p.lng);
      if (!(lat >= LAT[0] && lat <= LAT[1] && lng >= LNG[0] && lng <= LNG[1])) return { error: L.ePointRange(n) };
      out.push({ province: p.province, lat, lng });
    }
    return { points: out };
  }

  const jpost = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  function sendImages(speciesId, files, credit, onProgress) {
    return new Promise((resolve) => {
      const fd = new FormData();
      files.forEach((f) => { fd.append('images', f.file); fd.append('caption_th', f.th); fd.append('caption_en', f.en); });
      if (credit) fd.append('credit', credit);
      const x = new XMLHttpRequest();
      x.open('POST', `/api/species/${speciesId}/images`);
      x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch {} resolve({ status: x.status, body: j }); };
      x.onerror = () => resolve({ status: 0, body: {} });
      x.send(fd);
    });
  }

  async function submit() {
    if (S.busy) return;
    const L = t();
    ['genus', 'files', 'points', 'form'].forEach((k) => setErr(k, ''));
    const sel = S.genusSel;
    const pts = collectPoints();
    if (!sel) return setErr('genus', L.eNeedGenus);
    const newSpecies = sel === 'new' || S.speciesSel === 'new';
    if (!newSpecies && !S.speciesSel) return setErr('species', L.eNeedSpecies);
    if (newSpecies && !(S.ns && S.ns.name && S.ns.name.trim())) return setErr('species', L.eSpeciesRequired);
    if (pts.error) return setErr('points', pts.error);
    if (!S.files.length && !pts.points.length) return setErr('form', L.eNeedAny);

    S.busy = true; $('go').disabled = true;
    const showProg = (frac, text) => { $('prog').hidden = false; $('bar').style.width = `${Math.round(frac * 100)}%`; $('ptxt').textContent = text || `${Math.round(frac * 100)}%`; };
    const warnings = [];
    try {
      let genusId = sel;
      if (sel === 'new') {
        const body = { genus: $('ng-name').value, family: $('ng-fam').value, feeding_group: $('ng-feed').value,
          cp_value: $('ng-cp').value === '' ? null : Number($('ng-cp').value) };
        const r = await jpost('/api/genera', body);
        const j = await r.json().catch(() => ({}));
        if (r.status === 401) { await loadAll(); render(); return; }
        if (!r.ok) {
          setErr('genus', { required: L.eRequired, duplicate: L.eDuplicate }[j.error] || L.eInvalid);
          return;
        }
        genusId = String(j.id);
        // from here on the genus exists: remember it so a retry does not try to create it again
        S.genera.push({ id: j.id, genus: body.genus.trim() });
        S.genusSel = genusId; S.ng = null;
        render(); // the form now shows the real genus
      }
      let speciesId = S.speciesSel;
      if (newSpecies) {
        const r = await jpost(`/api/genera/${genusId}/species`, { species: S.ns.name, authority: S.ns.auth || '' });
        const j = await r.json().catch(() => ({}));
        if (r.status === 401) { await loadAll(); render(); return; }
        if (!r.ok) {
          setErr('species', { required: L.eSpeciesRequired, duplicate: L.eSpeciesDup }[j.error] || L.eSpeciesInvalid);
          return;
        }
        speciesId = String(j.id);
        S.speciesList.push({ id: j.id, species: S.ns.name.trim() });
        S.speciesSel = speciesId; S.ns = null;
        render();
      }
      let imgCount = 0, ptCount = 0;
      if (S.files.length) {
        showProg(0, L.uploading);
        const res = await sendImages(speciesId, S.files, $('credit').value.trim(), (f) => showProg(f * 0.9, `${L.uploading} ${Math.round(f * 100)}%`));
        if (res.status === 401) { await loadAll(); render(); return; }
        if (res.status === 413) { setErr('files', L.eSize('')); return; }
        if (!res.body.created) { setErr('form', L.eSave); return; }
        imgCount = res.body.created.length;
        (res.body.rejected || []).forEach((r) => warnings.push(L.eServerImg(r.name)));
      }
      for (const p of pts.points) {
        showProg(0.95, L.uploading);
        const r = await jpost(`/api/species/${speciesId}/locations`, p);
        if (r.ok) ptCount++; else warnings.push(L.ePointRange(1));
      }
      showProg(1, '100%');
      S.files.forEach((f) => URL.revokeObjectURL(f.url));
      S.files = []; S.points = []; S.credit = '';
      S.done = { images: imgCount, points: ptCount, genusId, speciesId, warnings };
      render();
    } catch {
      setErr('form', L.eSave);
    } finally { S.busy = false; const g = $('go'); if (g) g.disabled = false; }
  }

  // ---- map picker ----
  let pmap = null;
  function openPicker(pid) {
    const L = t(), dlg = $('picker');
    dlg.innerHTML = `<div class="d-head"><h2 style="font-style:normal">${esc(L.pick)}</h2>
      <button class="d-close" type="button" data-pclose>${esc(L.close)}</button></div>
      <div class="d-body"><p class="muted">${esc(L.pickHint)}</p><div id="pmap" class="minimap" style="height:340px"></div>
      <p id="perr" class="ferr" role="alert"></p></div>`;
    dlg.showModal();
    if (!window.L) { $('pmap').textContent = L.mapFail; return; }
    pmap = window.L.map('pmap').setView([13.2, 101], 5); // centred on Thailand; user can zoom
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(pmap);
    let marker = null;
    const cur = S.points.find((p) => String(p.id) === String(pid));
    if (cur && !Number.isNaN(parseNum(cur.lat)) && !Number.isNaN(parseNum(cur.lng))) {
      marker = window.L.marker([parseNum(cur.lat), parseNum(cur.lng)]).addTo(pmap);
    }
    pmap.on('click', (e) => {
      const { lat, lng } = e.latlng;
      if (lat < LAT[0] || lat > LAT[1] || lng < LNG[0] || lng > LNG[1]) { $('perr').textContent = L.pickOutside; return; }
      $('perr').textContent = '';
      cur.lat = lat.toFixed(5); cur.lng = lng.toFixed(5);
      if (marker) marker.setLatLng(e.latlng); else marker = window.L.marker(e.latlng).addTo(pmap);
      setTimeout(() => { closePicker(); renderPoints(); }, 250);
    });
    setTimeout(() => { // the dialog has its final size now: re-measure, then fit
      if (!pmap) return;
      pmap.invalidateSize();
      if (marker) pmap.setView(marker.getLatLng(), 8); else pmap.setView([13.2, 101], 5);
    }, 50);
  }
  function closePicker() { if (pmap) { pmap.remove(); pmap = null; } if ($('picker').open) $('picker').close(); }
  $('picker').addEventListener('click', (e) => { if (e.target === $('picker') || e.target.closest('[data-pclose]')) closePicker(); });
  $('picker').addEventListener('cancel', (e) => { e.preventDefault(); closePicker(); });

  // ---- events ----
  document.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (e.target.id === 'up') return submit();
    if (e.target.id === 'lform') {
      const L = t();
      const r = await jpost('/api/login', { password: $('lpw').value });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { await loadAll(); return render(); }
      $('lpw').value = '';
      $('lerr').textContent = r.status === 401 ? L.wrongPw : r.status === 429 ? L.locked(j.retry_after || 60) : L.loginErr;
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'genus') {
      S.genusSel = e.target.value; $('newg').hidden = S.genusSel !== 'new';
      S.speciesSel = S.genusSel === 'new' ? 'new' : '';
      loadSpecies(S.genusSel).then(renderSpeciesBox);
      renderSpeciesBox();
      if (S.genusSel === 'new') $('ng-name').focus();
    } else if (e.target.id === 'species') {
      S.speciesSel = e.target.value; renderSpeciesBox();
      if (S.speciesSel === 'new') $('ns-name').focus();
    } else if (e.target.id === 'file') { addFiles([...e.target.files]); e.target.value = ''; }
    else if (e.target.closest('.prow')) {
      const p = S.points.find((x) => String(x.id) === e.target.closest('.prow').dataset.pid);
      if (p) p[e.target.dataset.f] = e.target.value;
    }
  });
  document.addEventListener('input', (e) => {
    const row = e.target.closest('.frow');
    if (row && e.target.dataset.cap) { const f = S.files.find((x) => String(x.id) === row.dataset.fid); if (f) f[e.target.dataset.cap] = e.target.value; }
    const pr = e.target.closest('.prow');
    if (pr && e.target.dataset.f) { const p = S.points.find((x) => String(x.id) === pr.dataset.pid); if (p) p[e.target.dataset.f] = e.target.value; }
    if (e.target.id === 'credit') S.credit = e.target.value;
    if (e.target.id === 'ng-name') (S.ng = S.ng || {}).name = e.target.value;
    if (e.target.id === 'ng-fam') (S.ng = S.ng || {}).fam = e.target.value;
    if (e.target.id === 'ns-name') (S.ns = S.ns || {}).name = e.target.value;
    if (e.target.id === 'ns-auth') (S.ns = S.ns || {}).auth = e.target.value;
  });

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button, #drop');
    if (!b) return;
    if (b.id === 'drop') return $('file').click();
    if (b.dataset.lang) { lang = b.dataset.lang; try { localStorage.setItem('lang', lang); } catch {} return render(); }
    if (b.id === 'admin-btn') { await fetch('/api/logout', { method: 'POST' }); await loadAll(); return render(); }
    if (b.id === 'addpt') { S.points.push({ id: ++nid, province: '', lat: '', lng: '' }); return renderPoints(); }
    if (b.dataset.rmpt) { S.points = S.points.filter((p) => String(p.id) !== b.dataset.rmpt); return renderPoints(); }
    if (b.dataset.pick) return openPicker(b.dataset.pick);
    if (b.dataset.rmfile) {
      const f = S.files.find((x) => String(x.id) === b.dataset.rmfile); if (f) URL.revokeObjectURL(f.url);
      S.files = S.files.filter((x) => String(x.id) !== b.dataset.rmfile); return renderFiles();
    }
    if (b.id === 'more') { S.done = null; return render(); }
  });
  document.addEventListener('keydown', (e) => { if (e.target.id === 'drop' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); $('file').click(); } });

  // drag and drop
  ['dragover', 'dragenter'].forEach((ev) => document.addEventListener(ev, (e) => {
    if (e.target.closest && e.target.closest('#drop')) { e.preventDefault(); $('drop').classList.add('over'); }
  }));
  ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => {
    const d = $('drop'); if (d) d.classList.remove('over');
    if (ev === 'drop' && e.target.closest && e.target.closest('#drop')) { e.preventDefault(); addFiles([...e.dataTransfer.files]); }
  }));

  (async () => {
    await loadAll();
    await preselect();
    if (S.points.length === 0) S.points.push({ id: ++nid, province: '', lat: '', lng: '' });
    render();
  })();
})();
