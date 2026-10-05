/* School of Rock · Genrekaart: stamboom en wereldkaart van dezelfde genres. */
(async function () {
  const SOR = window.SOR;
  const $ = s => document.querySelector(s);
  const [data, mixtapes, order, world] = await Promise.all([
    SOR.load('data/genres.json'),
    SOR.load('data/mixtapes.json'),
    SOR.load('data/order.json').catch(() => ({})),
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then(r => r.json()).catch(() => null)
  ]);

  const fams = data.families;
  const famById = new Map(fams.map(f => [f.id, f]));
  const G = data.genres.map(g => ({ ...g, children: [] }));
  const byId = new Map(G.map(g => [g.id, g]));
  G.forEach(g => (g.parents || []).forEach(p => byId.get(p) && byId.get(p).children.push(g.id)));
  const links = [];
  G.forEach(g => (g.parents || []).forEach(p => byId.has(p) && links.push({ source: byId.get(p), target: g })));
  const YMIN = Math.floor((d3.min(G, g => g.year) - 8) / 10) * 10;
  const YMAX = 2026;
  const mixById = new Map(mixtapes.map(m => [m.n, m]));

  const state = { mode: 'tree', year: YMAX, fams: new Set(fams.map(f => f.id)), sel: null, path: null, step: 0, playing: false, sound: false };

  // ---------- Opbouw van de bediening ----------
  const famBox = $('.k-fams');
  famBox.innerHTML = fams.map(f => `<button class="k-fam" type="button" aria-pressed="true" data-f="${f.id}" style="--c:${f.color}"><i></i>${f.name}</button>`).join('');
  famBox.addEventListener('click', e => {
    const b = e.target.closest('.k-fam'); if (!b) return;
    const on = b.getAttribute('aria-pressed') === 'true';
    if (e.altKey || e.shiftKey || (on && state.fams.size === fams.length)) { // eerste klik: alleen deze familie
      state.fams = new Set([b.dataset.f]);
    } else if (on) { state.fams.delete(b.dataset.f); if (!state.fams.size) state.fams = new Set(fams.map(f => f.id)); }
    else state.fams.add(b.dataset.f);
    famBox.querySelectorAll('.k-fam').forEach(x => x.setAttribute('aria-pressed', String(state.fams.has(x.dataset.f))));
    applyVisibility();
  });
  const sel = $('#k-path');
  sel.innerHTML = '<option value="">Alle genres</option>' + mixtapes.map(m => `<option value="${m.n}">Mixtape ${m.n} · ${m.title}</option>`).join('');
  const dl = $('#k-genres');
  dl.innerHTML = G.slice().sort((a, b) => a.name.localeCompare(b.name, 'nl')).map(g => `<option value="${g.name}">`).join('');
  $('#k-search').addEventListener('change', e => { const v = SOR.norm(e.target.value); const g = G.find(x => SOR.norm(x.name) === v) || G.find(x => SOR.norm(x.name).includes(v)); if (g) { select(g, true); e.target.value = ''; } });

  // ---------- SVG ----------
  const stage = $('.k-stage');
  const svg = d3.select(stage).append('svg').attr('role', 'img').attr('aria-label', 'Genrekaart');
  const root = svg.append('g');
  const gBack = root.append('g');      // banen of landen
  const gGrid = root.append('g');      // decennia
  const gLinks = root.append('g');
  const gPath = root.append('g');
  const gNodes = root.append('g');
  const gCities = root.append('g').attr('class', 'cities');
  const gLaneNames = svg.append('g');  // vast aan de linkerkant
  let T = d3.zoomIdentity, suppress = false;
  const zoom = d3.zoom().scaleExtent([0.3, 14]).on('zoom', ev => {
    T = ev.transform;
    gBack.attr('transform', T);
    updateGrid(); updateCities(); stickLaneNames(T);
    root.classed('zoomed', state.mode === 'world' && T.k > 2.4);
    if (!suppress) place(false);
  });
  svg.call(zoom).on('dblclick.zoom', null);
  svg.on('click', ev => { if (ev.target === svg.node()) { clearSelection(); } });

  let W = 0, H = 0;
  // ---------- Stamboom: tijd horizontaal, families als banen ----------
  const PX_PER_YEAR = 15, ROW = 22, LANE_PAD = 14, LEFT = 150;
  const tx = y => LEFT + (y - YMIN) * PX_PER_YEAR;
  let lanes = [];
  function layoutTree() {
    let y = 40;
    lanes = fams.map((f, i) => {
      const gs = G.filter(g => g.family === f.id).sort((a, b) => a.year - b.year || a.name.localeCompare(b.name));
      const rows = [];
      gs.forEach(g => {
        const x = tx(g.year);
        const w = 14 + g.name.length * 6.6;
        let r = rows.findIndex(end => end < x - 6);
        if (r < 0) { r = rows.length; rows.push(0); }
        rows[r] = x + w;
        g.tree = { x, y: 0, row: r };
      });
      const h = Math.max(1, rows.length) * ROW + LANE_PAD * 2;
      gs.forEach(g => { g.tree.y = y + LANE_PAD + g.tree.row * ROW + ROW / 2; });
      const lane = { f, y, h, alt: i % 2 === 1 };
      y += h;
      return lane;
    });
    return y;
  }
  const treeH = layoutTree();
  const treeW = tx(YMAX) + 160;

  // ---------- Wereld ----------
  let projection = null, countries = null;
  function layoutWorld() {
    projection = d3.geoNaturalEarth1().fitExtent([[20, 20], [Math.max(W, 900) - 20, Math.max(H, 520) - 20]], { type: 'Sphere' });
    if (world) countries = topojson.feature(world, world.objects.countries);
    // Genres in dezelfde stad uit elkaar duwen.
    const nodes = G.map(g => { const [x, y] = projection([g.place.lon, g.place.lat]); return { g, x, y, tx: x, ty: y }; });
    const sim = d3.forceSimulation(nodes).force('x', d3.forceX(d => d.tx).strength(.35)).force('y', d3.forceY(d => d.ty).strength(.35)).force('c', d3.forceCollide(9)).stop();
    for (let i = 0; i < 160; i++) sim.tick();
    nodes.forEach(n => { n.g.world = { x: n.x, y: n.y, ax: n.tx, ay: n.ty }; });
  }

  // ---------- Tekenen ----------
  const nodeSel = gNodes.selectAll('g.node').data(G, d => d.id).join(enter => {
    const n = enter.append('g').attr('class', 'node').attr('tabindex', 0).attr('role', 'button').attr('aria-label', d => `${d.name}, ${d.year}, ${d.place.name}`);
    n.append('circle').attr('class', 'ring').attr('r', 8);
    n.append('circle').attr('class', 'dot').attr('r', 7).attr('fill', d => famById.get(d.family)?.color || '#999');
    n.append('text').attr('x', 11).attr('dy', '.35em').text(d => d.name);
    return n;
  });
  const linkSel = gLinks.selectAll('path.link').data(links).join('path').attr('class', 'link').attr('stroke', d => famById.get(d.target.family)?.color || '#888');

  nodeSel.on('click', (ev, d) => { ev.stopPropagation(); select(d, false); })
    .on('keydown', (ev, d) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(d, false); } })
    .on('mouseenter', (ev, d) => { if (!state.sel && !state.path) highlight(d); })
    .on('mouseleave', () => { if (!state.sel && !state.path) highlight(null); });

  function pos(d) { return state.mode === 'tree' ? d.tree : d.world; }
  function P(d) { const p = pos(d); return { x: T.applyX(p.x), y: T.applyY(p.y) }; }
  function linkPath(l) {
    const a = P(l.source), b = P(l.target);
    if (state.mode === 'tree') { const mx = (a.x + b.x) / 2; return `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`; }
    const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy) || 1;
    const lift = Math.min(120, dist * .35);
    const cx = (a.x + b.x) / 2 - dy / dist * lift, cy = (a.y + b.y) / 2 + dx / dist * lift * (dx > 0 ? -1 : 1) * -1;
    return `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`;
  }

  function drawBack() {
    gBack.selectAll('*').remove(); gGrid.selectAll('*').remove(); gLaneNames.selectAll('*').remove(); gCities.selectAll('*').remove();
    root.classed('world', state.mode === 'world');
    if (state.mode === 'tree') {
      gBack.selectAll('rect').data(lanes).join('rect').attr('class', d => 'lane-bg' + (d.alt ? ' alt' : '')).attr('x', -4000).attr('width', treeW + 8000).attr('y', d => d.y).attr('height', d => d.h);
      const decades = d3.range(Math.ceil(YMIN / 10) * 10, YMAX, 10);
      const dg = gGrid.selectAll('g').data(decades).join('g').attr('class', 'decade');
      dg.append('line');
      dg.append('text').attr('y', 16).text(d => d);
      updateGrid();
      const ln = gLaneNames.selectAll('g').data(lanes).join('g');
      ln.append('rect').attr('class', 'bg').attr('x', 0).attr('width', LEFT - 20).attr('fill', '#121110').attr('opacity', .92);
      ln.append('rect').attr('class', 'bar').attr('x', 0).attr('width', 5).attr('fill', d => d.f.color);
      ln.append('text').attr('class', 'lane-name').attr('x', 14).attr('y', d => d.y + 22).attr('fill', d => d.f.color).text(d => d.f.name);
      stickLaneNames(d3.zoomTransform(svg.node()));
    } else {
      const path = d3.geoPath(projection);
      gBack.append('path').attr('class', 'graticule').attr('d', path(d3.geoGraticule10()));
      if (countries) gBack.selectAll('path.country').data(countries.features).join('path').attr('class', 'country').attr('d', path);
      const cities = d3.rollups(G, v => v, g => g.place.name).map(([name, v]) => ({ name, n: v.length, x: d3.mean(v, g => g.world.ax), y: d3.min(v, g => g.world.y) }));
      gCities.selectAll('text').data(cities).join('text').attr('text-anchor', 'middle').attr('font-size', 11).text(d => d.name + (d.n > 1 ? ' · ' + d.n : ''));
      updateCities();
    }
  }
  function stickLaneNames(t) {
    if (state.mode !== 'tree') { gLaneNames.attr('display', 'none'); return; }
    gLaneNames.attr('display', null);
    gLaneNames.selectAll('g').each(function (d) {
      const top = t.y + d.y * t.k, h = d.h * t.k, g = d3.select(this);
      g.select('rect.bg').attr('y', top).attr('height', h);
      g.select('rect.bar').attr('y', top).attr('height', h);
      g.select('text').attr('y', top + Math.min(22, h / 2 + 5)).attr('opacity', h < 16 ? 0 : 1);
    });
  }
  function updateGrid() {
    gGrid.selectAll('g.decade').each(function (d) { const x = T.applyX(tx(d)); const g = d3.select(this); g.select('line').attr('x1', x).attr('x2', x).attr('y1', Math.max(22, T.applyY(26))).attr('y2', T.applyY(treeH)); g.select('text').attr('x', x + 4); });
  }
  function updateCities() {
    const placed = [];
    gCities.selectAll('text').sort((a, b) => b.n - a.n).each(function (d) {
      const x = T.applyX(d.x), y = T.applyY(d.y) - 14, w = this.getComputedTextLength ? this.getComputedTextLength() : d.name.length * 7, h = 12;
      const box = [x - w / 2 - 4, y - h, x + w / 2 + 4, y + 3];
      const hit = placed.some(b => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]));
      if (!hit) placed.push(box);
      d3.select(this).attr('x', x).attr('y', y).attr('visibility', hit ? 'hidden' : null);
    });
  }
  function place(animate) {
    const t = animate ? d3.transition().duration(900).ease(d3.easeCubicInOut) : null;
    (t ? nodeSel.transition(t) : nodeSel).attr('transform', d => { const q = P(d); return `translate(${q.x},${q.y})`; });
    (t ? linkSel.transition(t) : linkSel).attr('d', linkPath);
    drawPath();
    if (!animate) cullLabels(); else setTimeout(cullLabels, 950);
  }
  // Namen die over elkaar zouden vallen weglaten; geselecteerde en gemarkeerde genres gaan voor.
  function cullLabels() {
    const placed = [];
    const prio = d => (d === state.sel ? 0 : root.classed('dim') && nodeSel.filter(x => x === d).classed('hl') ? 1 : 2);
    const list = G.filter(d => visible(d)).map(d => ({ d, q: P(d), p: prio(d) })).sort((a, b) => a.p - b.p || a.d.year - b.d.year);
    const show = new Set();
    list.forEach(({ d, q }) => {
      const w = d.name.length * 6.4 + 12;
      const box = [q.x - 8, q.y - 8, q.x + w, q.y + 8];
      if (q.x < -50 || q.y < -20 || q.x > W + 50 || q.y > H + 20) return;
      if (!placed.some(b => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) { placed.push(box); show.add(d.id); }
    });
    nodeSel.select('text').attr('visibility', d => show.has(d.id) ? null : 'hidden');
  }

  function fit(animate) { const t = fitTransform(); (animate ? svg.transition().duration(700) : svg).call(zoom.transform, t); }
  function fitTransform() {
    let t;
    if (state.mode === 'tree') {
      const kk = Math.max(Math.min(1, (H - 20) / (treeH + 10)), Math.min(1, (W - 20) / treeW));
      t = d3.zoomIdentity.translate(Math.min(0, (W - treeW * kk) / 2), 0).scale(kk);
    } else {
      const xs = G.map(g => g.world.x), ys = G.map(g => g.world.y);
      const x0 = d3.min(xs) - 60, x1 = d3.max(xs) + 60, y0 = d3.min(ys) - 50, y1 = d3.max(ys) + 50;
      const k = Math.max(.8, Math.min(5, Math.min(W / (x1 - x0), H / (y1 - y0))));
      t = d3.zoomIdentity.translate(W / 2 - (x0 + x1) / 2 * k, H / 2 - (y0 + y1) / 2 * k).scale(k);
    }
    return t;
  }
  function resize() {
    W = stage.clientWidth; H = stage.clientHeight;
    svg.attr('viewBox', null);
    layoutWorld();
    drawBack(); place(false);
  }

  // ---------- Zichtbaarheid: families, tijd, selectie ----------
  function visible(d) { return state.fams.has(d.family) && d.year <= state.year; }
  function applyVisibility() {
    nodeSel.classed('future', d => !visible(d));
    linkSel.classed('future', l => !visible(l.source) || !visible(l.target));
  }
  function lineage(d) {
    const up = new Set(), down = new Set();
    (function walkUp(x) { (x.parents || []).forEach(p => { if (!up.has(p) && byId.has(p)) { up.add(p); walkUp(byId.get(p)); } }); })(d);
    (function walkDown(x) { x.children.forEach(c => { if (!down.has(c)) { down.add(c); walkDown(byId.get(c)); } }); })(d);
    return new Set([d.id, ...up, ...down]);
  }
  function highlight(d, set) {
    const s = set || (d ? lineage(d) : null);
    root.classed('dim', !!s);
    nodeSel.classed('hl', x => !!s && s.has(x.id));
    linkSel.classed('hl', l => !!s && s.has(l.source.id) && s.has(l.target.id) && (!d || set || isChain(l, d)));
    cullLabels();
  }
  function isChain(l, d) { // alleen lijnen in de directe lijn van afstamming
    const s = lineage(d);
    return s.has(l.source.id) && s.has(l.target.id);
  }

  // ---------- Paneel ----------
  const panel = $('.k-panel');
  function chip(id) { const g = byId.get(id); return g ? `<button class="kp-chip" type="button" data-id="${g.id}" style="--c:${famById.get(g.family)?.color}"><i></i>${g.name}</button>` : ''; }
  function renderPanel(d) {
    const f = famById.get(d.family);
    const tracks = (d.tracks || []).filter(t => t.audio);
    const step = state.path ? `<div class="kp-step"><button type="button" data-step="-1" ${state.step <= 0 ? 'disabled' : ''}>← Vorige</button><span>Leerpad Mixtape ${state.path.n} · ${state.step + 1}/${state.path.list.length}</span><button type="button" data-step="1" ${state.step >= state.path.list.length - 1 ? 'disabled' : ''}>Volgende →</button></div>` : '';
    panel.innerHTML = `
      <div class="kp-head" style="--c:${f?.color}">
        <button class="kp-close" type="button" aria-label="Sluit">×</button>
        <div class="fam">${f?.name || ''}</div>
        <h2>${d.name}</h2>
        <div class="meta">${d.year}${d.peak ? ` · bloei ${d.peak[0]}-${d.peak[1]}` : ''} · ${d.place.name}</div>
      </div>
      <div class="kp-body">
        ${step}
        <p>${d.text}</p>
        ${d.listen ? `<p class="kp-listen">${d.listen}</p>` : ''}
        ${tracks.length ? `<div><p class="kp-h">Luister</p><div class="kp-tracks">${tracks.map((t, i) => `<div class="kp-track"><button class="sor-play" type="button" data-t="${i}" aria-label="Speel ${t.artist}">${SOR.playIcon}</button><img src="${t.cover || ''}" alt=""><div><b>${t.artist}</b><span>${t.title}${t.year ? ' · ' + t.year : ''}</span></div></div>`).join('')}</div></div>` : ''}
        ${(d.parents || []).length ? `<div><p class="kp-h">Komt voort uit</p><div class="kp-links">${d.parents.map(chip).join('')}</div></div>` : ''}
        ${d.children.length ? `<div><p class="kp-h">Leidde tot</p><div class="kp-links">${d.children.map(chip).join('')}</div></div>` : ''}
        ${(d.mixtapes || []).length ? `<div><p class="kp-h">Lees in de reader</p><div class="kp-read">${d.mixtapes.map(m => { const mx = mixById.get(m.n); return `<a href="mixtape/${String(m.n).padStart(2, '0')}.html#${SOR.slug(m.heading)}"><small>${String(m.n).padStart(2, '0')}</small><b>${m.heading}</b><span>Mixtape ${m.n} · ${mx ? mx.title : ''} · ${m.track || ''}</span></a>`; }).join('')}</div></div>` : ''}
        ${(d.mixtapes || []).length ? `<div class="kp-links">${[...new Set(d.mixtapes.map(m => m.n))].map(n => { const mx = mixById.get(n); return mx && mx.spotify ? `<a class="kp-chip" href="${mx.spotify}" target="_blank" rel="noopener"><i style="background:#1DB954"></i>Playlist Mixtape ${n}</a>` : ''; }).join('')}</div>` : ''}
      </div>`;
    panel.hidden = false;
    panel.scrollTop = 0;
    panel.querySelectorAll('.sor-play').forEach(b => b.addEventListener('click', () => SOR.play({ ...tracks[+b.dataset.t] })));
    syncButtons();
  }
  panel.addEventListener('click', e => {
    const c = e.target.closest('[data-id]'); if (c) { select(byId.get(c.dataset.id), true); return; }
    const s = e.target.closest('[data-step]'); if (s) { goStep(state.step + +s.dataset.step, true); return; }
    if (e.target.closest('.kp-close')) clearSelection();
  });
  function syncButtons() {
    const d = state.sel; if (!d) return;
    panel.querySelectorAll('.sor-play').forEach(b => { const t = d.tracks[+b.dataset.t]; const on = SOR.isPlaying(t); b.classList.toggle('on', on); b.innerHTML = on ? SOR.pauseIcon : SOR.playIcon; });
  }
  SOR.onChange((t, playing) => {
    syncButtons();
    nodeSel.classed('playing', d => playing && (d.tracks || []).some(x => t && x.audio === t.audio));
  });

  function select(d, center, playFirst) {
    if (!d) return;
    if (!state.fams.has(d.family)) { state.fams.add(d.family); famBox.querySelector(`[data-f="${d.family}"]`).setAttribute('aria-pressed', 'true'); }
    if (d.year > state.year) { state.year = YMAX; syncYear(); }
    applyVisibility();
    state.sel = d;
    nodeSel.classed('sel', x => x === d);
    if (state.path) highlight(null, new Set([...state.path.list.map(g => g.id)]));
    else highlight(d);
    renderPanel(d);
    resizeStage();
    if (center) centerOn(d);
    if (playFirst && d.tracks && d.tracks[0]) SOR.play({ ...d.tracks[0] });
    history.replaceState(null, '', '#' + (state.path ? 'mixtape-' + state.path.n + '/' : '') + d.id);
  }
  function clearSelection() {
    state.sel = null; nodeSel.classed('sel', false);
    if (state.path) highlight(null, new Set(state.path.list.map(g => g.id))); else highlight(null);
    panel.hidden = true; resizeStage();
    history.replaceState(null, '', location.pathname + (state.path ? '#mixtape-' + state.path.n : ''));
  }
  function centerOn(d) {
    const p = pos(d), t = d3.zoomTransform(svg.node());
    const k = Math.max(t.k, state.mode === 'tree' ? 1 : 1.6);
    svg.transition().duration(650).call(zoom.transform, d3.zoomIdentity.translate(W / 2 - p.x * k, H / 2 - p.y * k).scale(k));
  }

  // ---------- Leerpad per mixtape ----------
  function trackNo(m) { const x = (m.track || '').match(/\d+/); return x ? +x[0] : 99; }
  function setPath(n) {
    if (!n) { state.path = null; gPath.selectAll('*').remove(); clearSelection(); return; }
    const list = G.filter(g => (g.mixtapes || []).some(m => m.n === n)).map(g => ({ g, m: g.mixtapes.find(m => m.n === n) }));
    // Volgorde van het hoofdstuk: de sides staan in de reader al in leesvolgorde; binnen een side op tracknummer, daarna jaar.
    const ord = order[n] || [];
    const idx = m => { const i = ord.indexOf(SOR.slug(m.heading)); return i < 0 ? 999 : i; };
    list.sort((a, b) => idx(a.m) - idx(b.m) || a.g.year - b.g.year);
    state.path = { n, list: list.map(x => x.g) };
    state.fams = new Set(fams.map(f => f.id)); famBox.querySelectorAll('.k-fam').forEach(x => x.setAttribute('aria-pressed', 'true'));
    state.year = YMAX; syncYear(); applyVisibility();
    highlight(null, new Set(state.path.list.map(g => g.id)));
    drawPath();
    goStep(0, false);
  }
  function drawPath() {
    gPath.selectAll('*').remove();
    if (!state.path) return;
    const pts = state.path.list.map(g => P(g));
    gPath.append('path').attr('class', 'path-line').attr('d', d3.line().curve(d3.curveCatmullRom.alpha(.5))(pts.map(p => [p.x, p.y])));
    const b = gPath.selectAll('g').data(state.path.list).join('g').attr('transform', d => { const q = P(d); return `translate(${q.x - 18},${q.y - 18})`; });
    b.append('circle').attr('class', 'path-badge').attr('r', 9);
    b.append('text').attr('class', 'path-num').attr('text-anchor', 'middle').attr('dy', '.35em').text((d, i) => i + 1);
  }
  function goStep(i, play) {
    if (!state.path) return;
    state.step = Math.max(0, Math.min(state.path.list.length - 1, i));
    select(state.path.list[state.step], true, play);
  }
  sel.addEventListener('change', () => setPath(+sel.value || null));

  // ---------- Modus ----------
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
    if (state.mode === b.dataset.mode) return;
    state.mode = b.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    drawBack(); suppress = true; svg.call(zoom.transform, fitTransform()); place(true); setTimeout(() => { suppress = false; }, 950);
    if (state.sel) setTimeout(() => centerOn(state.sel), 950);
  }));
  $('#k-zin').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 1.4));
  $('#k-zout').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 1 / 1.4));
  $('#k-fit').addEventListener('click', () => fit(true));

  // ---------- Tijdlijn: speel de geschiedenis af ----------
  const range = $('#k-range'), yearLbl = $('#k-yearlbl'), yearBig = $('.k-yearbig');
  range.min = YMIN; range.max = YMAX; range.value = YMAX;
  function syncYear() { range.value = state.year; yearLbl.textContent = state.year >= YMAX ? 'nu' : state.year; yearBig.textContent = state.year >= YMAX ? '' : state.year; }
  range.addEventListener('input', () => { state.year = +range.value; syncYear(); applyVisibility(); });
  $('#k-sound').addEventListener('change', e => { state.sound = e.target.checked; });
  let timer = null, lastSound = 0;
  const playBtn = $('#k-play');
  function stopTape() { clearInterval(timer); timer = null; state.playing = false; playBtn.innerHTML = playBtn.dataset.play; }
  playBtn.dataset.play = playBtn.innerHTML;
  playBtn.addEventListener('click', () => {
    if (state.playing) { stopTape(); return; }
    if (state.path) { sel.value = ''; setPath(null); }
    clearSelection();
    if (state.year >= YMAX) state.year = YMIN;
    state.playing = true;
    playBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zM14 5h3v14h-3z"/></svg>Pauze';
    timer = setInterval(() => {
      const prev = state.year; state.year += 1; syncYear(); applyVisibility();
      const born = G.filter(g => g.year === state.year && state.fams.has(g.family));
      if (born.length) {
        nodeSel.filter(d => born.includes(d)).classed('pulse', false).each(function () { void this.getBBox(); }).classed('pulse', true);
        const now = Date.now();
        if (state.sound && now - lastSound > 5000) { const g = born.find(x => x.tracks && x.tracks[0]); if (g) { SOR.play({ ...g.tracks[0] }); lastSound = now; } }
      }
      if (state.year >= YMAX) { state.year = YMAX; syncYear(); stopTape(); }
    }, state.sound ? 260 : 140);
  });

  // ---------- Uitleg bij eerste bezoek ----------
  const intro = $('.k-intro');
  let seen = false; try { seen = localStorage.getItem('sor-kaart-intro') === '1'; } catch (e) {}
  if (!seen && !location.hash && !location.search.includes('nointro')) intro.hidden = false;
  document.querySelectorAll('[data-close-intro]').forEach(b => b.addEventListener('click', () => { intro.hidden = true; try { localStorage.setItem('sor-kaart-intro', '1'); } catch (e) {} }));
  $('.k-help').addEventListener('click', () => { intro.hidden = false; });

  // ---------- Start ----------
  function resizeStage() { const w = stage.clientWidth, h = stage.clientHeight; if (w !== W || h !== H) { W = w; H = h; layoutWorld(); drawBack(); place(false); } }
  resize();
  applyVisibility();
  fit(false);
  window.addEventListener('resize', () => resizeStage());
  function fromHash() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (!h) return;
    const m = h.match(/^mixtape-(\d+)(?:\/(.+))?$/);
    if (m) { sel.value = m[1]; setPath(+m[1]); if (m[2] && byId.has(m[2])) select(byId.get(m[2]), true); return; }
    if (byId.has(h)) select(byId.get(h), true);
  }
  fromHash();
  window.addEventListener('hashchange', fromHash);
  if (new URLSearchParams(location.search).get('mode') === 'world') document.querySelector('[data-mode=world]').click();
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, select')) return;
    if (e.key === 'Escape') { intro.hidden = true; clearSelection(); }
    if (state.path && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) goStep(state.step + (e.key === 'ArrowRight' ? 1 : -1), true);
  });
})();
