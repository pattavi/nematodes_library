// Read-only mode for the GitHub Pages build: answers the app's /api/* GET requests from data.json
// (exported by scripts/build-static.js) so app.js runs unchanged. Writes are refused.
(() => {
  window.STATIC_SITE = true;
  const real = window.fetch.bind(window);
  let data;
  const load = () => data || (data = real('data.json').then((r) => r.json()));
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const lc = (s) => String(s || '').toLowerCase();
  const cmp = (a, b) => (lc(a) < lc(b) ? -1 : lc(a) > lc(b) ? 1 : 0);

  // Same rules as the server: name-prefix search, feeding group, first letter.
  const names = (d, genus) => (d.genus[genus.id] ? d.genus[genus.id].species : []).map((s) => `${genus.genus} ${s.species}`);
  function matches(q, d, row, level) {
    const text = lc(q.get('q')).trim();
    const feeding = q.get('feeding') || '';
    const letter = q.get('letter') || '';
    if (feeding && row.feeding_group !== feeding) return false;
    if (/^[a-z]$/i.test(letter) && !lc(row.genus).startsWith(lc(letter))) return false;
    if (!text) return true;
    if (lc(row.genus).startsWith(text)) return true;
    if (level === 'species') return lc(`${row.genus} ${row.species}`).startsWith(text);
    return names(d, row).some((n) => lc(n).startsWith(text));
  }

  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('/api/')) return real(input, init);
    if (url === '/api/session') return json({ admin: false, login_enabled: false });
    if (((init && init.method) || 'GET') !== 'GET') return json({ error: 'read_only' }, 403);

    const d = await load();
    const u = new URL(url, location.origin);
    const q = u.searchParams;
    const path = u.pathname;
    let m;

    if (path === '/api/genera') {
      const items = d.genera.filter((g) => matches(q, d, g, 'genus')).sort((a, b) => cmp(a.genus, b.genus));
      if (q.get('sort') === 'desc') items.reverse();
      return json({ items });
    }
    if ((m = /^\/api\/genera\/(\d+)$/.exec(path))) return d.genus[m[1]] ? json(d.genus[m[1]]) : json({ error: 'not_found' }, 404);
    if ((m = /^\/api\/species\/(\d+)$/.exec(path))) return d.species[m[1]] ? json(d.species[m[1]]) : json({ error: 'not_found' }, 404);
    if (path === '/api/locations') {
      const province = q.get('province') || '';
      return json({ items: d.locations.filter((l) => (!province || l.province === province) && matches(q, d, l, 'species')) });
    }
    if (path === '/api/locations/provinces') return json({ items: d.locationProvinces });
    if (path === '/api/provinces') return json({ items: d.provinces });
    if (path === '/api/meta') return json(d.meta);
    return json({ error: 'not_found' }, 404);
  };
})();
