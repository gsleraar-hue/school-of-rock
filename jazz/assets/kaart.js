/* Jazzkaart (Blue Hour): stijlen en musici als stamboom, op de wereldkaart en als netwerk van wie met wie speelde. */
(async function () {
  const SOR = window.SOR;
  const $ = s => document.querySelector(s);
  const [data, routes, world, titels, top400, topJaren] = await Promise.all([
    SOR.load('data/kaart.json'),
    SOR.load('data/routes.json').catch(() => []),
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then(r => r.json()).catch(() => null),
    Promise.resolve({}),
    Promise.resolve([]), // geen Top 400 bij de jazz
    Promise.resolve({})
  ]);

  const fams = data.families;
  const famById = new Map(fams.map(f => [f.id, f]));
  // Stromingen (grote punten) en componisten (kleine punten) in één lijst.
  const S = data.stromingen.map(s => ({ ...s, kind: 's', children: [] }));
  const sById = new Map(S.map(s => [s.id, s]));
  const C = data.componisten.filter(c => sById.has(c.stroming)).map(c => ({ ...c, kind: 'c', family: sById.get(c.stroming).family, children: [] }));
  const G = [...S, ...C];
  const byId = new Map(G.map(g => [g.id, g]));
  // Herkomst: stromingen via parents, componisten via hun stroming en hun invloeden.
  G.forEach(g => { g.up = g.kind === 's' ? (g.parents || []) : [g.stroming, ...(g.influences || [])]; g.up = [...new Set(g.up)].filter(p => byId.has(p) && p !== g.id); });
  G.forEach(g => g.up.forEach(p => byId.get(p).children.push(g.id)));
  const links = [];
  G.forEach(g => g.up.forEach(p => links.push({ source: byId.get(p), target: g, type: g.kind === 's' ? 'stroom' : p === g.stroming ? 'lid' : 'invloed' })));
  const members = id => C.filter(c => c.stroming === id || (c.alsoIn || []).includes(id)).sort((a, b) => a.year - b.year);
  const YMIN = Math.floor((d3.min(G, g => g.year) - 6) / 10) * 10;
  const YMAX = 2026;
  const isComp = d => d.kind === 'c';
  // Bands: wie speelde met wie. Elke band hangt aan zijn musici; kleur van de leider.
  const isBand = d => d && d.kind === 'b';
  const B = (data.bands || []).map(b => ({ ...b, kind: 'b', year: b.years[0], members: [...new Set(b.members || [])].filter(id => byId.has(id) && isComp(byId.get(id))) })).filter(b => b.members.length > 1);
  B.forEach(b => { const l = byId.get(b.leader) || byId.get(b.members[0]); b.family = l.family; });
  const bandById = new Map(B.map(b => [b.id, b]));
  const bandsOf = id => B.filter(b => b.members.includes(id)).sort((a, b) => a.year - b.year);
  const NETL = B.flatMap(b => b.members.map(m => ({ band: b, m: byId.get(m) })));
  let netDone = false;
  function layoutNet() {
    if (netDone) return; netDone = true;
    const inNet = new Set(NETL.map(l => l.m.id));
    const nodes = [...B.map(o => ({ o })), ...C.filter(c => inNet.has(c.id)).map(o => ({ o }))];
    const idx = new Map(nodes.map(n => [n.o, n]));
    // tijd ruwweg van links (oud) naar rechts (nieuw); vaste beginwaarden, zodat het netwerk elke keer hetzelfde oogt
    const X = o => (o.year - YMIN) * 11;
    nodes.forEach((n, i) => { n.x = X(n.o); n.y = (((i * 9301 + 49297) % 233280) / 233280 - .5) * 500; });
    const L = NETL.map(l => ({ source: idx.get(l.band), target: idx.get(l.m) }));
    const sim = d3.forceSimulation(nodes).force('link', d3.forceLink(L).distance(44).strength(.6)).force('charge', d3.forceManyBody().strength(-110))
      .force('x', d3.forceX(n => X(n.o)).strength(.1)).force('y', d3.forceY(0).strength(.05)).force('c', d3.forceCollide(n => isBand(n.o) ? 16 : 9)).stop();
    for (let i = 0; i < 450; i++) sim.tick();
    nodes.forEach(n => { n.o.net = { x: n.x, y: n.y }; });
  }
  // Top 400: elke notering hoort bij de componist(en) op de kaart en krijgt de kleur van diens familie.
  const TOP = top400.filter(t => t.year).map(t => {
    const comps = (t.comps || []).filter(id => byId.has(id));
    return { ...t, comps, family: comps.length ? byId.get(comps[0]).family : null };
  });
  const topByComp = new Map();
  TOP.forEach(t => t.comps.forEach(id => { if (!topByComp.has(id)) topByComp.set(id, []); topByComp.get(id).push(t); }));
  if (!TOP.length) document.querySelector('[data-mode=top]')?.remove();

  const state = { mode: 'tree', year: YMAX, fams: new Set(fams.map(f => f.id)), comps: true, sel: null, path: null, step: 0, playing: false, sound: false };
  try { if (localStorage.getItem('jazz-kaart-comps') === '0') state.comps = false; } catch (e) {}

  // ---------- Opbouw van de bediening ----------
  const famBox = $('.k-fams');
  famBox.innerHTML = fams.map(f => `<button class="k-fam" type="button" aria-pressed="true" data-f="${f.id}" style="--c:${f.color}"><i></i>${f.name}</button>`).join('');
  famBox.addEventListener('click', e => {
    const b = e.target.closest('.k-fam'); if (!b) return;
    const on = b.getAttribute('aria-pressed') === 'true';
    if (e.altKey || e.shiftKey || (on && state.fams.size === fams.length)) state.fams = new Set([b.dataset.f]);
    else if (on) { state.fams.delete(b.dataset.f); if (!state.fams.size) state.fams = new Set(fams.map(f => f.id)); }
    else state.fams.add(b.dataset.f);
    famBox.querySelectorAll('.k-fam').forEach(x => x.setAttribute('aria-pressed', String(state.fams.has(x.dataset.f))));
    applyVisibility();
  });
  const compBox = $('#k-comps');
  compBox.checked = state.comps;
  compBox.addEventListener('change', () => {
    state.comps = compBox.checked; try { localStorage.setItem('jazz-kaart-comps', state.comps ? '1' : '0'); } catch (e) {}
    if (!state.comps && state.sel && isComp(state.sel)) clearSelection();
    layoutTree(); drawBack(); applyVisibility(); place(true);
  });
  const sel = $('#k-path');
  sel.innerHTML = '<option value="">Alles</option>' + routes.map(r => `<option value="${r.id}">${r.title}</option>`).join('');
  if (!routes.length) sel.closest('label').hidden = true;
  const dl = $('#k-genres');
  // zoeken op stroming, componist of film (films uit de lijst van de knoop en uit de fragmenten)
  const filmKey = s => SOR.norm(String(s).replace(/\s*\((tv|\d{4}[^)]*)\)\s*$/i, ''));
  const filmIdx = new Map(); // genormaliseerde titel → { label, nodes: [] }
  G.forEach(g => [...(g.films || []), ...(g.tracks || []).map(t => t.film)].filter(Boolean).forEach(f => {
    const k = filmKey(f); if (!k) return;
    const e = filmIdx.get(k) || { label: String(f).replace(/\s*\(tv\)\s*$/i, ''), nodes: [] };
    if (!e.nodes.includes(g)) e.nodes.push(g); filmIdx.set(k, e);
    const base = String(f).replace(/\s*\((tv|\d{4}[^)]*)\)\s*$/i, ''), en = titels[base];
    if (en) { const ka = filmKey(en); const a = filmIdx.get(ka) || { label: en + ' (' + base + ')', nodes: [] }; if (!a.nodes.includes(g)) a.nodes.push(g); filmIdx.set(ka, a); }
  }));
  const filmLabel = e => 'Album: ' + e.label;
  dl.innerHTML = [...G.slice().sort((a, b) => a.name.localeCompare(b.name, 'nl')).map(g => `<option value="${g.name}">`),
    ...[...filmIdx.values()].sort((a, b) => a.label.localeCompare(b.label, 'nl')).map(e => `<option value="${filmLabel(e).replace(/"/g, '&quot;')}">`),
    ...B.map(b => `<option value="Band: ${b.name.replace(/"/g, '&quot;')}">`)].join('');
  $('#k-search').addEventListener('change', e => {
    const raw = e.target.value; const v = SOR.norm(raw.replace(/^(Album|Band):\s*/i, ''));
    if (/^Band:/i.test(raw) || (!G.some(x => SOR.norm(x.name) === v) && B.some(b => SOR.norm(b.name) === v))) { const b = B.find(x => SOR.norm(x.name) === v) || B.find(x => SOR.norm(x.name).includes(v)); if (b) { selectBand(b, true); e.target.value = ''; return; } }
    if (state.mode === 'top' && v) {
      // in de Top 400: eerst op titel, dan op componist (hoogste notering)
      const base = SOR.norm(raw.replace(/^Film:\s*/i, '').replace(/\s*\(.*$/, ''));
      const t = TOP.find(x => SOR.norm(x.title) === base) || TOP.find(x => SOR.norm(x.title).includes(base))
        || TOP.find(x => SOR.norm(x.artist).includes(v) || x.comps.some(id => SOR.norm(byId.get(id).name) === v));
      if (t) { selectTop(t, true); e.target.value = ''; return; }
    }
    let g = /^Album:/i.test(raw) ? null : (G.find(x => SOR.norm(x.name) === v) || null);
    if (!g) { const f = [...filmIdx.values()].find(e => filmLabel(e) === raw) || filmIdx.get(filmKey(raw.replace(/^Album:\s*/i, ''))) || [...filmIdx.entries()].find(([k]) => k.includes(v))?.[1]; if (f) g = f.nodes.find(isComp) || f.nodes[0]; }
    if (!g) g = G.find(x => SOR.norm(x.name).includes(v));
    if (g) { if (state.mode === 'top' || (state.mode === 'net' && !g.net)) setMode('tree'); if (isComp(g) && !state.comps) { compBox.checked = true; compBox.dispatchEvent(new Event('change')); } select(g, true); e.target.value = ''; }
  });

  // ---------- SVG ----------
  const stage = $('.k-stage');
  const svg = d3.select(stage).append('svg').attr('role', 'img').attr('aria-label', 'Jazzkaart');
  const root = svg.append('g');
  const gBack = root.append('g');
  const gGrid = root.append('g');
  const gLinks = root.append('g');
  const gPath = root.append('g');
  const gNodes = root.append('g');
  const gTop = root.append('g').attr('class', 'top400');
  const gCities = root.append('g').attr('class', 'cities');
  const gLaneNames = svg.append('g');
  let T = d3.zoomIdentity, suppress = false;
  const zoom = d3.zoom().scaleExtent([0.3, 14]).on('zoom', ev => {
    T = ev.transform;
    gBack.attr('transform', T);
    updateGrid(); updateCities(); stickLaneNames(T);
    root.classed('zoomed', state.mode === 'world' && T.k > 2.4);
    if (!suppress) place(false);
  });
  svg.call(zoom).on('dblclick.zoom', null);
  svg.on('click', ev => { if (ev.target === svg.node()) clearSelection(); });

  let W = 0, H = 0;
  // ---------- Stamboom: tijd horizontaal, families als banen; componisten op eigen rijen onder de stromingen ----------
  const PX_PER_YEAR = 17, ROW = 22, ROWC = 16, LANE_PAD = 14, LEFT = 290;
  const tx = y => LEFT + (y - YMIN) * PX_PER_YEAR;
  let lanes = [], treeH = 0;
  function rowsFor(list, charW, base, rowH, y0) {
    const rows = [];
    list.forEach(g => {
      const x = tx(g.year), w = 14 + g.name.length * charW;
      let r = rows.findIndex(end => end < x - 6);
      if (r < 0) { r = rows.length; rows.push(0); }
      rows[r] = x + w;
      g.tree = { x, y: y0 + base + r * rowH + rowH / 2 };
    });
    return rows.length * rowH;
  }
  function layoutTree() {
    let y = 40;
    lanes = fams.map((f, i) => {
      const ss = S.filter(g => g.family === f.id).sort((a, b) => a.year - b.year || a.name.localeCompare(b.name));
      const cs = C.filter(g => g.family === f.id).sort((a, b) => a.year - b.year || a.name.localeCompare(b.name));
      const hs = rowsFor(ss, 6.6, LANE_PAD, ROW, y);
      let hc = 0;
      if (state.comps) hc = rowsFor(cs, 5.6, LANE_PAD + hs + (cs.length ? 4 : 0), ROWC, y) + (cs.length ? 4 : 0);
      else cs.forEach(g => { g.tree = { x: tx(g.year), y: y + LANE_PAD + hs / 2 }; });
      const h = Math.max(ROW, hs + hc) + LANE_PAD * 2;
      const lane = { f, y, h, alt: i % 2 === 1 };
      y += h;
      return lane;
    });
    treeH = y;
    return y;
  }
  layoutTree();
  const treeW = tx(YMAX) + 160;

  // ---------- Top 400: jaar horizontaal (zelfde tijdas als de stamboom), plaats in de lijst verticaal ----------
  // Hoeveel noteringen je ziet (top 10, 50, 100 of 400): de verticale as rekt mee, zodat een korte lijst ruim en rustig oogt.
  const TOP_Y0 = 56, TOP_SPAN = 900;
  let topN = 50;
  try { const v = +localStorage.getItem('film-kaart-topn'); if ([10, 50, 100, 400].includes(v)) topN = v; } catch (e) {}
  const topY = p => TOP_Y0 + (p - 1) * TOP_SPAN / Math.max(1, topN - 1);
  const topH = () => topY(topN) + 30;
  const topYmin = TOP.length ? d3.min(TOP, t => t.year) - 3 : YMIN;
  const topTicks = () => ({ 10: d3.range(1, 11), 50: [1, 10, 20, 30, 40, 50], 100: [1, 25, 50, 75, 100] }[topN] || [1, 50, 100, 150, 200, 250, 300, 350, 400]);
  // binnen een jaar een beetje spreiden, zodat noteringen uit hetzelfde jaar niet op één lijn vallen
  function layoutTop() { TOP.forEach(t => { const j = ((t.pos * 37) % 11) / 10 - .5; t.at = { x: tx(t.year + .5 + j * .8), y: topY(Math.min(t.pos, topN + 2)) }; }); }
  layoutTop();

  // ---------- Wereld ----------
  let projection = null, countries = null;
  function layoutWorld() {
    projection = d3.geoNaturalEarth1().fitExtent([[20, 20], [Math.max(W, 900) - 20, Math.max(H, 520) - 20]], { type: 'Sphere' });
    if (world) countries = topojson.feature(world, world.objects.countries);
    const nodes = G.map(g => { const [x, y] = projection([g.place.lon, g.place.lat]); return { g, x, y, tx: x, ty: y }; });
    const sim = d3.forceSimulation(nodes).force('x', d3.forceX(d => d.tx).strength(.6)).force('y', d3.forceY(d => d.ty).strength(.6)).force('c', d3.forceCollide(d => isComp(d.g) ? 4 : 6.5)).stop();
    for (let i = 0; i < 160; i++) sim.tick();
    nodes.forEach(n => { n.g.world = { x: n.x, y: n.y, ax: n.tx, ay: n.ty }; });
  }

  // ---------- Tekenen ----------
  const nodeSel = gNodes.selectAll('g.node').data(G, d => d.id).join(enter => {
    const n = enter.append('g').attr('class', d => 'node' + (isComp(d) ? ' comp' : '')).attr('tabindex', 0).attr('role', 'button')
      .attr('aria-label', d => isComp(d) ? `${d.name}, musicus, ${d.year}` : `${d.name}, ${d.year}, ${d.place.name}`);
    n.append('circle').attr('class', 'hit').attr('r', d => isComp(d) ? 9 : 14);
    n.append('circle').attr('class', 'ring').attr('r', d => isComp(d) ? 5 : 8);
    n.append('circle').attr('class', 'dot').attr('r', d => isComp(d) ? 4 : 7).attr('fill', d => famById.get(d.family)?.color || '#999');
    n.append('text').attr('x', d => isComp(d) ? 7 : 11).attr('dy', '.35em').text(d => d.name);
    return n;
  });
  const topColor = t => (t.family && famById.get(t.family)?.color) || '#8A857C';
  const topSel = gTop.selectAll('g.tnode').data(TOP, t => t.pos).join(enter => {
    const n = enter.append('g').attr('class', t => 'tnode' + (t.pos <= 10 ? ' top10' : '')).attr('tabindex', 0).attr('role', 'button')
      .attr('aria-label', t => `Nummer ${t.pos}: ${t.title}, ${t.artist}, ${t.year}`);
    n.append('circle').attr('class', 'hit').attr('r', 8);
    n.append('circle').attr('class', 'ring').attr('r', 6);
    n.append('circle').attr('class', 'dot').attr('r', t => t.pos <= 10 ? 6 : t.pos <= 100 ? 4.5 : 3.5).attr('fill', topColor);
    n.append('text').attr('x', t => t.pos <= 10 ? 10 : 8).attr('dy', '.35em').text(t => `${t.pos}. ${t.title}`);
    return n;
  });
  topSel.on('click', (ev, t) => { ev.stopPropagation(); selectTop(t, false); })
    .on('keydown', (ev, t) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectTop(t, false); } })
    .on('mouseenter', (ev, t) => { if (!state.topSel) highlightTop(t); })
    .on('mouseleave', () => { if (!state.topSel) highlightTop(null); });
  const gNet = root.insert('g', () => gNodes.node()).attr('class', 'knet');
  const netSel = gNet.selectAll('line').data(NETL).join('line');
  const gBands = root.insert('g', () => gTop.node()).attr('class', 'gbands');
  const bandSel = gBands.selectAll('g.band').data(B, b => b.id).join(enter => {
    const n = enter.append('g').attr('class', 'band').attr('tabindex', 0).attr('role', 'button').attr('aria-label', b => `${b.name}, band, ${b.years.join('–')}`);
    n.append('rect').attr('class', 'sq').attr('x', -6).attr('y', -6).attr('width', 12).attr('height', 12).attr('transform', 'rotate(45)');
    n.append('text').attr('x', 12).attr('dy', '.35em').text(b => b.name);
    return n;
  });
  bandSel.on('click', (ev, b) => { ev.stopPropagation(); selectBand(b, false); })
    .on('keydown', (ev, b) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectBand(b, false); } });
  const linkSel = gLinks.selectAll('path.link').data(links).join('path').attr('class', d => 'link ' + d.type).attr('stroke', d => d.type === 'invloed' ? '#D9894A' : famById.get(d.target.family)?.color || '#888')
    ;
  svg.insert('defs', ':first-child').html('<marker id="k-arrow" viewBox="0 0 10 10" refX="16" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" fill="#D9894A"/></marker>');

  nodeSel.on('click', (ev, d) => { ev.stopPropagation(); select(d, false); })
    .on('keydown', (ev, d) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(d, false); } })
    .on('mouseenter', (ev, d) => { if (!state.sel && !state.path) highlight(d); })
    .on('mouseleave', () => { if (!state.sel && !state.path) highlight(null); });

  function pos(d) { return state.mode === 'world' ? d.world : state.mode === 'net' ? (d.net || d.tree) : d.tree; }
  function PN(o) { return { x: T.applyX(o.net.x), y: T.applyY(o.net.y) }; }
  function PT(t) { return { x: T.applyX(t.at.x), y: T.applyY(t.at.y) }; }
  function P(d) { const p = pos(d); return { x: T.applyX(p.x), y: T.applyY(p.y) }; }
  function linkPath(l) {
    const a = P(l.source), b = P(l.target);
    if (state.mode !== 'world') { const mx = (a.x + b.x) / 2; return `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`; }
    const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy) || 1;
    const lift = Math.min(120, dist * .35);
    const cx = (a.x + b.x) / 2 - dy / dist * lift, cy = (a.y + b.y) / 2 + dx / dist * lift * (dx > 0 ? -1 : 1) * -1;
    return `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`;
  }

  function drawBack() {
    gBack.selectAll('*').remove(); gGrid.selectAll('*').remove(); gLaneNames.selectAll('*').remove(); gCities.selectAll('*').remove();
    root.classed('world', state.mode === 'world');
    root.classed('topmode', state.mode === 'top');
    root.classed('netmode', state.mode === 'net');
    if (state.mode === 'top') {
      const decades = d3.range(Math.ceil(topYmin / 10) * 10, YMAX, 10);
      const dg = gGrid.selectAll('g.decade').data(decades).join('g').attr('class', 'decade');
      dg.append('line');
      dg.append('text').attr('y', 16).text(d => d);
      const rg = gGrid.selectAll('g.rank').data(topTicks()).join('g').attr('class', 'rank');
      rg.append('line');
      rg.append('text').attr('text-anchor', 'end').attr('dy', '.35em').text(d => d);
      updateGrid();
    } else if (state.mode === 'tree') {
      gBack.selectAll('rect').data(lanes).join('rect').attr('class', d => 'lane-bg' + (d.alt ? ' alt' : '')).attr('x', -4000).attr('width', treeW + 8000).attr('y', d => d.y).attr('height', d => d.h);
      const decades = d3.range(Math.ceil(YMIN / 10) * 10, YMAX, 10);
      const dg = gGrid.selectAll('g').data(decades).join('g').attr('class', 'decade');
      dg.append('line');
      dg.append('text').attr('y', 16).text(d => d);
      updateGrid();
      const ln = gLaneNames.selectAll('g').data(lanes).join('g');
      ln.append('rect').attr('class', 'bg').attr('x', 0).attr('width', 158).attr('fill', '#121110').attr('opacity', .92);
      ln.append('rect').attr('class', 'bar').attr('x', 0).attr('width', 5).attr('fill', d => d.f.color);
      ln.append('text').attr('class', 'lane-name').attr('x', 14).attr('y', d => d.y + 22).attr('fill', d => d.f.color).text(d => d.f.name);
      stickLaneNames(d3.zoomTransform(svg.node()));
    } else if (state.mode === 'world') {
      const path = d3.geoPath(projection);
      gBack.append('path').attr('class', 'graticule').attr('d', path(d3.geoGraticule10()));
      if (countries) gBack.selectAll('path.country').data(countries.features).join('path').attr('class', 'country').attr('d', path);
      const cities = d3.rollups(S, v => v, g => g.place.name).map(([name, v]) => ({ name, n: v.length, x: d3.mean(v, g => g.world.ax), y: d3.min(v, g => g.world.y) }));
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
    const bottom = state.mode === 'top' ? topH() : treeH;
    gGrid.selectAll('g.decade').each(function (d) { const x = T.applyX(tx(d)); const g = d3.select(this); g.select('line').attr('x1', x).attr('x2', x).attr('y1', Math.max(22, T.applyY(26))).attr('y2', T.applyY(bottom)); g.select('text').attr('x', x + 4); });
    // plaatsen in de lijst als lijnen, met het getal links in beeld
    const x0 = Math.max(44, T.applyX(tx(topYmin)));
    gGrid.selectAll('g.rank').each(function (d) { const y = T.applyY(topY(d)); const g = d3.select(this); g.select('line').attr('x1', x0).attr('x2', T.applyX(tx(YMAX))).attr('y1', y).attr('y2', y); g.select('text').attr('x', x0 - 6).attr('y', y); });
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
    (t && state.mode === 'top' ? topSel.transition(t) : topSel).attr('transform', d => { const q = PT(d); return `translate(${q.x},${q.y})`; });
    if (state.mode === 'net') {
      (t ? bandSel.transition(t) : bandSel).attr('transform', b => { const q = PN(b); return `translate(${q.x},${q.y})`; });
      (t ? netSel.transition(t) : netSel).attr('x1', l => PN(l.band).x).attr('y1', l => PN(l.band).y).attr('x2', l => PN(l.m).x).attr('y2', l => PN(l.m).y);
    }
    drawPath();
    if (!animate) cullLabels(); else setTimeout(cullLabels, 950);
  }
  // Namen die over elkaar zouden vallen weglaten. Stromingen gaan voor; componistnamen pas bij inzoomen of als ze gemarkeerd zijn.
  function cullLabels() {
    if (state.mode === 'top') { cullTop(); return; }
    const placed = [];
    const hl = d => root.classed('dim') && nodeSel.filter(x => x === d).classed('hl');
    const prio = d => (d === state.sel ? 0 : hl(d) ? 1 : isComp(d) ? 3 : 2);
    const compZoom = state.mode === 'tree' ? T.k >= 1.15 : state.mode === 'net' ? T.k >= 1.5 : T.k >= 3;
    // in het netwerk gaan de bandnamen voor
    if (state.mode === 'net') {
      bandSel.select('text').attr('visibility', function (b) {
        if (b.year > state.year) return 'hidden';
        const q = PN(b), w = b.name.length * 6.6 + 14, box = [q.x - 8, q.y - 8, q.x + w, q.y + 8];
        if (placed.some(p => !(box[2] < p[0] || box[0] > p[2] || box[3] < p[1] || box[1] > p[3]))) return 'hidden';
        placed.push(box); return null;
      });
    }
    const list = G.filter(d => visible(d)).map(d => ({ d, q: P(d), p: prio(d) })).sort((a, b) => a.p - b.p || a.d.year - b.d.year);
    const show = new Set();
    list.forEach(({ d, q, p }) => {
      if (isComp(d) && p === 3 && !compZoom) return;
      const w = d.name.length * (isComp(d) ? 5.6 : 6.4) + 12;
      const box = [q.x - 6, q.y - 7, q.x + w, q.y + 7];
      if (q.x < -50 || q.y < -20 || q.x > W + 50 || q.y > H + 20) return;
      const free = !placed.some(b => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))
        && !list.some(o => o.d !== d && o.q.x + 5 > box[0] + 12 && o.q.x - 5 < box[2] && o.q.y + 5 > box[1] && o.q.y - 5 < box[3]);
      if (free) { placed.push(box); show.add(d.id); }
    });
    nodeSel.select('text').attr('visibility', d => show.has(d.id) ? null : 'hidden');
    if (state.mode === 'world') {
      updateCities();
      gCities.selectAll('text').each(function () {
        if (this.getAttribute('visibility') === 'hidden') return;
        const b = this.getBBox(), box = [b.x - 2, b.y - 1, b.x + b.width + 2, b.y + b.height + 1];
        if (placed.some(p => !(box[2] < p[0] || box[0] > p[2] || box[3] < p[1] || box[1] > p[3]))) this.setAttribute('visibility', 'hidden');
      });
    }
  }

  // Top 400: titels van de hoogste noteringen eerst, de rest pas bij inzoomen of als ze gemarkeerd zijn.
  function cullTop() {
    const placed = [], show = new Set();
    const hl = t => root.classed('dim') && topSel.filter(x => x === t).classed('hl');
    const prio = t => (t === state.topSel ? 0 : hl(t) ? 1 : 2);
    const list = TOP.filter(topVisible).map(t => ({ t, q: PT(t), p: prio(t) })).sort((a, b) => a.p - b.p || a.t.pos - b.t.pos);
    const limit = topN <= 50 ? topN : T.k >= 2.2 ? 400 : T.k >= 1.3 ? 100 : 25;
    list.forEach(({ t, q, p }) => {
      if (p === 2 && t.pos > limit) return;
      if (q.x < -50 || q.y < -20 || q.x > W + 50 || q.y > H + 20) return;
      const w = (String(t.pos).length + 2 + t.title.length) * 6.2 + 12;
      const box = [q.x - 4, q.y - 7, q.x + w, q.y + 7];
      if (!placed.some(b => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) { placed.push(box); show.add(t.pos); }
    });
    topSel.select('text').attr('visibility', t => show.has(t.pos) ? null : 'hidden');
  }

  function fit(animate) { const t = fitTransform(); (animate ? svg.transition().duration(700) : svg).call(zoom.transform, t); }
  function fitTransform() {
    if (state.mode === 'top') {
      const x0 = tx(topYmin) - 40, x1 = tx(YMAX) + 20, y0 = 0, y1 = topH();
      const k = Math.max(.1, Math.min((W - 20) / (x1 - x0), (H - 10) / (y1 - y0)));
      return d3.zoomIdentity.translate(W / 2 - (x0 + x1) / 2 * k, 4 - y0 * k).scale(k);
    }
    if (state.mode === 'net') {
      const pts = [...B, ...C.filter(c => c.net)].map(g => g.net);
      const x0 = d3.min(pts, p => p.x) - 60, x1 = d3.max(pts, p => p.x) + 180, y0 = d3.min(pts, p => p.y) - 40, y1 = d3.max(pts, p => p.y) + 40;
      const k = Math.max(.2, Math.min(4, Math.min(W / (x1 - x0), H / (y1 - y0))));
      return d3.zoomIdentity.translate(W / 2 - (x0 + x1) / 2 * k, H / 2 - (y0 + y1) / 2 * k).scale(k);
    }
    if (state.mode === 'tree') {
      const kk = Math.max(Math.min(1, (H - 20) / (treeH + 10)), Math.min(1, (W - 190) / (treeW - LEFT + 40)));
      return d3.zoomIdentity.translate(170 - LEFT * kk, 0).scale(kk);
    }
    const xs = S.map(g => g.world.x), ys = S.map(g => g.world.y);
    const x0 = d3.min(xs) - 60, x1 = d3.max(xs) + 60, y0 = d3.min(ys) - 50, y1 = d3.max(ys) + 50;
    const k = Math.max(.8, Math.min(5, Math.min(W / (x1 - x0), H / (y1 - y0))));
    return d3.zoomIdentity.translate(W / 2 - (x0 + x1) / 2 * k, H / 2 - (y0 + y1) / 2 * k).scale(k);
  }
  function resize() { W = stage.clientWidth; H = stage.clientHeight; layoutWorld(); drawBack(); place(false); }

  // ---------- Zichtbaarheid ----------
  function visible(d) { return state.fams.has(d.family) && d.year <= state.year && (!isComp(d) || state.comps || state.mode === 'net') && (state.mode !== 'net' || !!d.net); }
  function topVisible(t) { return t.pos <= topN && t.year <= state.year && (!t.family || state.fams.has(t.family)); }
  const topR = t => topN <= 10 ? 9 : topN <= 50 ? (t.pos <= 10 ? 7.5 : 6) : topN <= 100 ? (t.pos <= 10 ? 6.5 : 5) : (t.pos <= 10 ? 6 : t.pos <= 100 ? 4.5 : 3.5);
  function setTopN(n, animate = true, keep = true) {
    topN = n; if (keep) try { localStorage.setItem('film-kaart-topn', String(n)); } catch (e) {}
    document.querySelectorAll('[data-topn]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.topn === n)));
    layoutTop();
    topSel.select('circle.dot').attr('r', topR);
    topSel.select('text').attr('x', t => topR(t) + 4);
    applyVisibility();
    if (state.mode !== 'top') return;
    drawBack(); svg.interrupt(); suppress = true;
    svg.call(zoom.transform, fitTransform());
    place(animate); setTimeout(() => { suppress = false; cullLabels(); }, animate ? 950 : 0);
  }
  document.querySelectorAll('[data-topn]').forEach(b => b.addEventListener('click', () => { if (state.topSel && state.topSel.pos > +b.dataset.topn) clearSelection(); setTopN(+b.dataset.topn); }));
  setTopN(topN, false);
  function applyVisibility() {
    nodeSel.classed('future', d => !visible(d));
    nodeSel.classed('netoff', d => state.mode === 'net' && !d.net);
    bandSel.classed('future', b => b.year > state.year || !state.fams.has(b.family));
    netSel.classed('future', l => l.band.year > state.year || !visible(l.m));
    linkSel.classed('future', l => !visible(l.source) || !visible(l.target));
    topSel.classed('future', t => !topVisible(t));
  }
  // bij een notering lichten ook de andere noteringen van dezelfde componist(en) op
  function highlightTop(t) {
    const s = t ? new Set(TOP.filter(x => x === t || x.comps.some(id => t.comps.includes(id))).map(x => x.pos)) : null;
    root.classed('dim', !!s);
    topSel.classed('hl', x => !!s && s.has(x.pos));
    cullLabels();
  }
  function lineage(d) {
    const up = new Set(), down = new Set();
    (function walkUp(x) { x.up.forEach(p => { if (!up.has(p)) { up.add(p); walkUp(byId.get(p)); } }); })(d);
    (function walkDown(x) { x.children.forEach(c => { if (!down.has(c)) { down.add(c); if (isComp(d) || !isComp(byId.get(c))) walkDown(byId.get(c)); } }); })(d);
    // bij een stroming horen ook de componisten erbinnen
    if (!isComp(d)) members(d.id).forEach(c => down.add(c.id));
    return new Set([d.id, ...up, ...down]);
  }
  function highlight(d, set) {
    const net = state.mode === 'net' && d && !set;
    const s = set || (d ? (net ? new Set([d.id, ...bandsOf(d.id).flatMap(b => b.members)]) : lineage(d)) : null);
    bandSel.classed('hl', b => !!net && b.members.includes(d.id));
    netSel.classed('hl', l => !!net && (l.m === d || bandsOf(d.id).includes(l.band)));
    root.classed('dim', !!s);
    nodeSel.classed('hl', x => !!s && s.has(x.id));
    linkSel.classed('hl', l => !!s && s.has(l.source.id) && s.has(l.target.id));
    cullLabels();
  }

  // ---------- Paneel ----------
  const panel = $('.k-panel');
  function chip(id) { const g = byId.get(id); return g ? `<button class="kp-chip${isComp(g) ? ' comp' : ''}" type="button" data-id="${g.id}" style="--c:${famById.get(g.family)?.color}"><i></i>${g.name}</button>` : ''; }
  function films(d) { return (d.films || []).length ? `<div><p class="kp-h">Albums en opnames</p><p class="kp-films">${d.films.map(f => `<span>${f}</span>`).join('')}</p></div>` : ''; }
  function renderPanel(d) {
    const f = famById.get(d.family);
    const tracks = (d.tracks || []).filter(t => t.audio);
    const step = state.path ? `<div class="kp-step"><button type="button" data-step="-1" ${state.step <= 0 ? 'disabled' : ''}>← Vorige</button><span>${state.path.title} · ${state.step + 1}/${state.path.list.length}</span><button type="button" data-step="1" ${state.step >= state.path.list.length - 1 ? 'disabled' : ''}>Volgende →</button></div>` : '';
    const meta = isComp(d) ? `${d.born || ''}${d.died ? '–' + d.died : d.born ? '' : ''} · ${d.place.name}` : `${d.year}${d.peak ? ` · bloei ${d.peak[0]}-${d.peak[1]}` : ''} · ${d.place.name}`;
    const parentsS = isComp(d) ? '' : (d.parents || []).filter(p => sById.has(p));
    const kidsS = d.children.filter(c => !isComp(byId.get(c)));
    const mem = isComp(d) ? [] : members(d.id);
    const infl = isComp(d) ? (d.influences || []).filter(p => byId.has(p)) : [];
    const inflOn = isComp(d) ? d.children : [];
    panel.innerHTML = `
      <div class="kp-head" style="--c:${f?.color}">
        <button class="kp-close" type="button" aria-label="Sluit">×</button>
        <div class="fam">${isComp(d) ? 'Musicus · ' : ''}${f?.name || ''}</div>
        <h2>${d.name}</h2>
        <div class="meta">${meta}</div>
      </div>
      <div class="kp-body">
        ${step}
        ${isComp(d) ? `<div class="kp-links">${[d.stroming, ...(d.alsoIn || [])].map(chip).join('')}</div>` : ''}
        ${d.text ? `<p>${d.text}</p>` : ''}
        ${d.listen ? `<p class="kp-listen">${d.listen}</p>` : ''}
        ${tracks.length ? `<div><p class="kp-h">Luister</p><div class="kp-tracks">${tracks.map((t, i) => `<div class="kp-track${t.cover ? '' : ' nocover'}"><button class="sor-play" type="button" data-t="${i}" aria-label="Speel ${t.title}">${SOR.playIcon}</button>${t.cover ? `<img src="${t.cover}" alt="" loading="lazy" onerror="this.remove()">` : ''}<div><b>${t.film || t.artist}</b><span>${t.title}${t.year ? ' · ' + t.year : ''}</span></div></div>`).join('')}</div></div>` : ''}
        ${films(d)}
        ${topByComp.has(d.id) ? `<div><p class="kp-h">In de Top 400 van NPO Klassiek</p><div class="kp-tops">${topByComp.get(d.id).map(topChip).join('')}</div></div>` : ''}
        ${mem.length ? `<div><p class="kp-h">Musici</p><div class="kp-links">${mem.map(c => chip(c.id)).join('')}</div></div>` : ''}
        ${isComp(d) && bandsOf(d.id).length ? `<div><p class="kp-h">Speelde in</p><div class="kp-links">${bandsOf(d.id).map(bandChip).join('')}</div></div>` : ''}
        ${infl.length ? `<div><p class="kp-h">Invloed van</p><div class="kp-links">${infl.map(chip).join('')}</div></div>` : ''}
        ${inflOn.length ? `<div><p class="kp-h">Invloed op</p><div class="kp-links">${inflOn.map(chip).join('')}</div></div>` : ''}
        ${parentsS.length ? `<div><p class="kp-h">Komt voort uit</p><div class="kp-links">${parentsS.map(chip).join('')}</div></div>` : ''}
        ${kidsS.length ? `<div><p class="kp-h">Leidde tot</p><div class="kp-links">${kidsS.map(chip).join('')}</div></div>` : ''}
      </div>`;
    panel.hidden = false;
    panel.scrollTop = 0;
    panelTracks = tracks;
    panel.querySelectorAll('.sor-play').forEach(b => b.addEventListener('click', () => SOR.play(trackFor(tracks[+b.dataset.t]))));
    syncButtons();
  }
  let panelTracks = [];
  function contrast() {
    const h = panel.querySelector('.kp-head'); if (!h) return;
    const m = (h.style.getPropertyValue('--c') || '').trim().match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i); if (!m) return;
    const [r, g, b] = m.slice(1).map(x => parseInt(x, 16) / 255);
    h.classList.toggle('light', .2126 * r + .7152 * g + .0722 * b > .6);
  }
  new MutationObserver(contrast).observe(panel, { childList: true });
  const bandChip = b => `<button class="kp-chip" type="button" data-band="${b.id}" style="--c:${famById.get(b.family)?.color}"><i></i>${b.name} <small>${b.years[0]}${b.years[1] && b.years[1] !== b.years[0] ? '–' + b.years[1] : ''}</small></button>`;
  function renderBandPanel(b) {
    const f = famById.get(b.family), lead = byId.get(b.leader);
    const mem = b.members.map(id => byId.get(id)).sort((x, y) => (x === lead ? -1 : y === lead ? 1 : x.year - y.year));
    const others = [...new Set(mem.flatMap(m => bandsOf(m.id)))].filter(x => x !== b);
    panel.innerHTML = `
      <div class="kp-head" style="--c:${f?.color}">
        <button class="kp-close" type="button" aria-label="Sluit">×</button>
        <div class="fam">Band · ${b.years[0]}${b.years[1] && b.years[1] !== b.years[0] ? '–' + b.years[1] : ''}</div>
        <h2>${b.name}</h2>
        <div class="meta">${lead ? 'Leider: ' + lead.name : ''}</div>
      </div>
      <div class="kp-body">
        ${b.text ? `<p>${b.text}</p>` : ''}
        <div><p class="kp-h">Musici</p><div class="kp-links">${mem.map(m => chip(m.id)).join('')}</div></div>
        ${others.length ? `<div><p class="kp-h">Dezelfde musici speelden ook in</p><div class="kp-links">${others.map(bandChip).join('')}</div></div>` : ''}
      </div>`;
    panel.hidden = false; panel.scrollTop = 0; panelTracks = [];
  }
  function selectBand(b, center) {
    if (!b) return;
    if (state.mode !== 'net') setMode('net');
    if (!state.fams.has(b.family)) { state.fams.add(b.family); famBox.querySelector(`[data-f="${b.family}"]`).setAttribute('aria-pressed', 'true'); }
    if (b.year > state.year) { state.year = YMAX; syncYear(); }
    applyVisibility();
    state.sel = null; nodeSel.classed('sel', false);
    state.band = b;
    bandSel.classed('sel', x => x === b);
    const s = new Set(b.members);
    root.classed('dim', true);
    nodeSel.classed('hl', x => s.has(x.id));
    bandSel.classed('hl', x => x === b);
    netSel.classed('hl', l => l.band === b);
    cullLabels();
    renderBandPanel(b);
    resizeStage();
    if (center) setTimeout(() => { const k = Math.max(d3.zoomTransform(svg.node()).k, 1.4); svg.transition().duration(650).call(zoom.transform, d3.zoomIdentity.translate(W / 2 - b.net.x * k, H / 2 - b.net.y * k).scale(k)); }, state.modeSwitching ? 950 : 0);
    history.replaceState(null, '', '#band/' + b.id);
  }
  const topChip = t => `<button class="kp-top" type="button" data-top="${t.pos}" style="--c:${topColor(t)}"><b>${t.pos}</b><span>${t.title}</span><em>${t.year}</em></button>`;
  // Paneel bij een notering uit de Top 400
  function renderTopPanel(t) {
    const f = t.family && famById.get(t.family);
    // fragment: de preview uit de lijst, anders een fragment van dezelfde film op de kaart
    // drie fragmenten per film: NPO en iTunes uit de lijst, aangevuld met fragmenten van dezelfde film op de kaart
    const own = (t.tracks || []).map(x => ({ audio: x.audio, artist: t.artist, title: t.title + ' · ' + x.label, cover: x.cover || t.cover, year: t.year, film: t.title, label: x.label, own: true }));
    const fromMap = t.comps.flatMap(id => (byId.get(id).tracks || []).filter(x => x.audio && x.film && filmKey(x.film) === filmKey(t.title)));
    const tracks = [...own, ...fromMap.filter(x => !own.some(o => o.audio === x.audio))].slice(0, 3);
    const move = !t.prev ? 'nieuw in de lijst' : t.prev === t.pos ? 'zelfde plek als vorig jaar' : `vorig jaar ${t.prev}`;
    const others = TOP.filter(x => x !== t && x.comps.some(id => t.comps.includes(id)));
    const kind = { serie: 'Tv-serie', game: 'Game', anders: '' }[t.kind] || 'Film';
    panel.innerHTML = `
      <div class="kp-head" style="--c:${topColor(t)}">
        <button class="kp-close" type="button" aria-label="Sluit">×</button>
        <div class="fam">NPO Klassiek Filmmuziek Top 400 · nr. ${t.pos}</div>
        <h2>${t.title}</h2>
        <div class="meta">${[kind, t.year, t.artist].filter(Boolean).join(' · ')}</div>
      </div>
      <div class="kp-body">
        <p class="kp-rank"><b>${t.pos}</b><span>${move}</span></p>
        ${spark(t)}
        ${t.note ? `<p>${t.note}</p>` : ''}
        ${tracks.length ? `<div><p class="kp-h">Luister</p><div class="kp-tracks">${tracks.map((x, i) => `<div class="kp-track${x.cover ? '' : ' nocover'}"><button class="sor-play" type="button" data-t="${i}" aria-label="Speel ${x.title}">${SOR.playIcon}</button>${x.cover ? `<img src="${x.cover}" alt="" loading="lazy" onerror="this.remove()">` : ''}<div><b>${x.own ? x.label : (x.film || x.artist)}</b><span>${x.own ? t.artist : x.title}</span></div></div>`).join('')}</div></div>` : ''}
        ${t.comps.length ? `<div><p class="kp-h">Op de kaart</p><div class="kp-links">${t.comps.map(chip).join('')}${f ? '' : ''}</div></div>` : `<p class="kp-listen">${t.artist} staat (nog) niet als componist op de kaart.</p>`}
        ${others.length ? `<div><p class="kp-h">Meer van ${t.comps.length === 1 ? byId.get(t.comps[0]).name : 'deze componisten'} in de lijst</p><div class="kp-tops">${others.map(topChip).join('')}</div></div>` : ''}
      </div>`;
    panel.hidden = false;
    panel.scrollTop = 0;
    panelTracks = tracks;
    panel.querySelectorAll('.sor-play').forEach(b => b.addEventListener('click', () => SOR.play(trackFor(tracks[+b.dataset.t]))));
    syncButtons();
  }
  // Verloop door de edities: plaats op een logaritmische as (1 bovenaan), grijs vlak = hoe lang de lijst dat jaar was.
  function spark(t) {
    const years = Object.keys(topJaren).map(Number).sort((a, b) => a - b);
    if (years.length < 2) return '';
    const h = { ...(t.hist || {}), [years.at(-1)]: t.pos };
    const W2 = 300, H2 = 120, L = 30, R = 10, Tp = 10, B = 20;
    const x = y => L + (y - years[0]) / (years.at(-1) - years[0]) * (W2 - L - R);
    const yy = p => Tp + Math.log(p) / Math.log(400) * (H2 - Tp - B);
    const area = years.map(y => `${x(y)},${yy(topJaren[y])}`);
    const band = `M${x(years[0])},${yy(1) - 4} L${area.join(' L')} L${x(years.at(-1))},${yy(1) - 4} Z`;
    // lijn alleen tussen opeenvolgende edities waarin het nummer stond
    let d = '', prev = null;
    years.forEach(y => { if (h[y]) { d += (prev && h[prev] ? ' L' : ' M') + x(y) + ',' + yy(h[y]); } prev = y; });
    const dots = years.filter(y => h[y]).map(y => `<circle cx="${x(y)}" cy="${yy(h[y])}" r="3"/><text x="${x(y)}" y="${yy(h[y]) - 6}" text-anchor="middle">${h[y]}</text>`).join('');
    const ticks = [1, 10, 100, 400].map(p => `<text class="ax" x="${L - 6}" y="${yy(p) + 3}" text-anchor="end">${p}</text>`).join('');
    const yl = years.filter((y, i) => i % 2 === 0 || y === years.at(-1)).map(y => `<text class="ax" x="${x(y)}" y="${H2 - 4}" text-anchor="middle">'${String(y).slice(2)}</text>`).join('');
    const first = years.find(y => h[y]);
    const lead = first === years[0] ? `Staat er al in sinds de eerste lijst (${first}).` : first === years.at(-1) ? 'Voor het eerst in de lijst.' : `In de lijst sinds ${first}.`;
    return `<div class="kp-spark"><p class="kp-h">Verloop ${years[0]}–${years.at(-1)}</p><svg viewBox="0 0 ${W2} ${H2}" role="img" aria-label="Verloop van de plaats in de lijst">${ticks}${yl}<path class="band" d="${band}"/><path class="line" d="${d}" style="stroke:${topColor(t)}"/><g style="fill:${topColor(t)}">${dots}</g></svg><p class="kp-spark-note">${lead} Grijs: hoe ver de lijst dat jaar reikte (top 40 tot top 400).</p></div>`;
  }
  function selectTop(t, center) {
    if (!t) return;
    if (state.mode !== 'top') setMode('top');
    if (t.pos > topN) setTopN([10, 50, 100, 400].find(n => n >= t.pos), false, false);
    if (t.family && !state.fams.has(t.family)) { state.fams.add(t.family); famBox.querySelector(`[data-f="${t.family}"]`).setAttribute('aria-pressed', 'true'); }
    if (t.year > state.year) { state.year = YMAX; syncYear(); }
    applyVisibility();
    state.sel = null; nodeSel.classed('sel', false);
    state.topSel = t;
    topSel.classed('sel', x => x === t);
    highlightTop(t);
    renderTopPanel(t);
    resizeStage();
    if (center) setTimeout(() => centerOnTop(t), state.modeSwitching ? 950 : 0);
    history.replaceState(null, '', '#top/' + t.pos);
  }
  function centerOnTop(t) {
    const k = Math.max(d3.zoomTransform(svg.node()).k, 1.6);
    svg.transition().duration(650).call(zoom.transform, d3.zoomIdentity.translate(W / 2 - t.at.x * k, H / 2 - t.at.y * k).scale(k));
  }
  const trackFor = t => ({ ...t, artist: t.artist, title: t.film ? t.film + ' · ' + t.title : t.title });
  panel.addEventListener('click', e => {
    const tp = e.target.closest('[data-top]'); if (tp) { selectTop(TOP.find(t => t.pos === +tp.dataset.top), true); return; }
    const bd = e.target.closest('[data-band]'); if (bd) { selectBand(bandById.get(bd.dataset.band), true); return; }
    const c = e.target.closest('[data-id]'); if (c) { const g = byId.get(c.dataset.id); if (state.mode === 'top' || (state.mode === 'net' && !g.net)) setMode('tree'); if (isComp(g) && !state.comps) { compBox.checked = true; compBox.dispatchEvent(new Event('change')); } select(g, true); return; }
    const s = e.target.closest('[data-step]'); if (s) { goStep(state.step + +s.dataset.step, true); return; }
    if (e.target.closest('.kp-close')) clearSelection();
  });
  function syncButtons() {
    if (panel.hidden) return;
    const tracks = panelTracks;
    panel.querySelectorAll('.sor-play').forEach(b => { const on = SOR.isPlaying(tracks[+b.dataset.t]); b.classList.toggle('on', on); b.innerHTML = on ? SOR.pauseIcon : SOR.playIcon; });
  }
  SOR.onChange((t, playing) => {
    syncButtons();
    nodeSel.classed('playing', d => playing && (d.tracks || []).some(x => t && x.audio === t.audio));
    topSel.classed('playing', x => playing && !!t && !!x.preview && x.preview === t.audio);
  });

  function select(d, center, playFirst) {
    if (!d) return;
    if (!state.fams.has(d.family)) { state.fams.add(d.family); famBox.querySelector(`[data-f="${d.family}"]`).setAttribute('aria-pressed', 'true'); }
    if (d.year > state.year) { state.year = YMAX; syncYear(); }
    applyVisibility();
    state.sel = d;
    state.band = null; bandSel.classed('sel', false);
    nodeSel.classed('sel', x => x === d);
    if (state.path) highlight(null, new Set(state.path.list.map(g => g.id))); else highlight(d);
    renderPanel(d);
    resizeStage();
    if (center) centerOn(d);
    const tr = (d.tracks || []).filter(t => t.audio);
    if (playFirst && tr[0]) SOR.play(trackFor(tr[0]));
    if (center && state.modeSwitching) setTimeout(() => centerOn(d), 950);
    history.replaceState(null, '', '#' + (state.path ? state.path.id + '/' : '') + d.id);
  }
  function clearSelection() {
    state.sel = null; nodeSel.classed('sel', false);
    state.topSel = null; topSel.classed('sel', false).classed('hl', false);
    state.band = null; bandSel.classed('sel', false).classed('hl', false); netSel.classed('hl', false);
    if (state.path) highlight(null, new Set(state.path.list.map(g => g.id))); else highlight(null);
    panel.hidden = true; resizeStage();
    history.replaceState(null, '', location.pathname + (state.path ? '#' + state.path.id : ''));
  }
  function centerOn(d) {
    const p = pos(d), t = d3.zoomTransform(svg.node());
    const k = Math.max(t.k, state.mode === 'tree' ? (isComp(d) ? 1.2 : 1) : 1.6);
    svg.transition().duration(650).call(zoom.transform, d3.zoomIdentity.translate(W / 2 - p.x * k, H / 2 - p.y * k).scale(k));
  }

  // ---------- Routes ----------
  function setPath(id) {
    const r = routes.find(x => x.id === id);
    if (!r) { state.path = null; gPath.selectAll('*').remove(); clearSelection(); return; }
    const list = r.steps.map(s => byId.get(s)).filter(Boolean);
    if (list.some(isComp) && !state.comps) { state.comps = true; compBox.checked = true; layoutTree(); drawBack(); place(false); }
    state.path = { id: r.id, title: r.title, list };
    state.fams = new Set(fams.map(f => f.id)); famBox.querySelectorAll('.k-fam').forEach(x => x.setAttribute('aria-pressed', 'true'));
    state.year = YMAX; syncYear(); applyVisibility();
    highlight(null, new Set(list.map(g => g.id)));
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
  sel.addEventListener('change', () => setPath(sel.value || null));

  // ---------- Modus ----------
  function setMode(m) {
    if (state.mode === m) return;
    const was = state.mode;
    // naar of van de Top 400: de selectie hoort bij de andere weergave, dus die vervalt
    if (m === 'net') layoutNet();
    // naar het netwerk: alleen musici met een band staan erin; een gekozen stijl of route past daar niet
    if (m === 'net' && ((state.sel && !state.sel.net) || state.path)) { if (state.path) { sel.value = ''; setPath(null); } clearSelection(); }
    if (was === 'net' && state.band) clearSelection();
    if (m === 'top' || was === 'top') {
      if (state.path) { sel.value = ''; setPath(null); }
      clearSelection();
    }
    state.mode = m;
    document.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.mode === m)));
    sel.closest('label').hidden = m === 'top' || m === 'net' || !routes.length;
    compBox.closest('label').hidden = m === 'top' || m === 'net';
    const tn = $('.k-topn'); if (tn) tn.hidden = m !== 'top';
    const sub = $('.k-title p'); if (!sub.dataset.def) sub.dataset.def = sub.textContent;
    sub.textContent = m === 'net' ? 'Wie speelde met wie · ruitjes zijn bands · klik een band of musicus' : sub.dataset.def;
    applyVisibility();
    state.modeSwitching = true;
    drawBack(); svg.interrupt(); suppress = true; svg.call(zoom.transform, fitTransform()); place(true); setTimeout(() => { suppress = false; state.modeSwitching = false; cullLabels(); }, 950); setTimeout(cullLabels, 1300);
    if (state.sel) setTimeout(() => centerOn(state.sel), 950);
  }
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('#k-zin').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 1.4));
  $('#k-zout').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 1 / 1.4));
  $('#k-fit').addEventListener('click', () => fit(true));

  // ---------- Tijdlijn ----------
  const range = $('#k-range'), yearLbl = $('#k-yearlbl'), yearBig = $('.k-yearbig');
  range.min = YMIN; range.max = YMAX; range.value = YMAX;
  function syncYear() { range.value = state.year; yearLbl.textContent = state.year >= YMAX ? 'nu' : state.year; yearBig.textContent = state.year >= YMAX ? '' : state.year; }
  range.addEventListener('input', () => { state.year = +range.value; syncYear(); applyVisibility(); });
  $('#k-sound').addEventListener('change', e => { state.sound = e.target.checked; });
  let timer = null, lastSound = 0, speed = 1;
  const speedBtns = [...document.querySelectorAll('.k-speed button')];
  function setSpeed(v) { speed = v; speedBtns.forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.speed === v))); try { localStorage.setItem('jazz-kaart-tempo', String(v)); } catch (e) {} }
  speedBtns.forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
  try { const v = +localStorage.getItem('jazz-kaart-tempo'); if (speedBtns.some(b => +b.dataset.speed === v)) setSpeed(v); } catch (e) {}
  const playBtn = $('#k-play');
  function stopTape() { clearTimeout(timer); timer = null; state.playing = false; playBtn.innerHTML = playBtn.dataset.play; }
  playBtn.dataset.play = playBtn.innerHTML;
  playBtn.addEventListener('click', () => {
    if (state.playing) { stopTape(); return; }
    if (state.path) { sel.value = ''; setPath(null); }
    clearSelection();
    if (state.year >= YMAX) state.year = state.mode === 'top' ? Math.floor(topYmin) : YMIN;
    state.playing = true;
    playBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zM14 5h3v14h-3z"/></svg>Pauze';
    const tick = () => {
      state.year += 1; syncYear(); applyVisibility();
      if (state.mode === 'top') {
        const nu = TOP.filter(t => t.year === state.year && topVisible(t));
        topSel.filter(t => nu.includes(t)).classed('pulse', false).each(function () { void this.getBBox(); }).classed('pulse', true);
        cullLabels();
        const now = Date.now(), t = nu.filter(x => x.preview).sort((a, b) => a.pos - b.pos)[0];
        if (state.sound && t && now - lastSound > 5000 / Math.min(speed, 2)) { SOR.play({ audio: t.preview, artist: t.artist, title: t.title, cover: t.cover, year: t.year }); lastSound = now; }
      }
      const born = state.mode === 'top' ? [] : G.filter(g => g.year === state.year && visible(g));
      if (born.length) {
        nodeSel.filter(d => born.includes(d)).classed('pulse', false).each(function () { void this.getBBox(); }).classed('pulse', true);
        const now = Date.now();
        if (state.sound && now - lastSound > 5000 / Math.min(speed, 2)) { const g = born.find(x => (x.tracks || []).some(t => t.audio)); if (g) { SOR.play(trackFor(g.tracks.find(t => t.audio))); lastSound = now; } }
      }
      if (state.year >= YMAX) { state.year = YMAX; syncYear(); stopTape(); return; }
      timer = setTimeout(tick, 220 / speed);
    };
    tick();
  });

  // ---------- Uitleg ----------
  const intro = $('.k-intro');
  let seen = false; try { seen = localStorage.getItem('jazz-kaart-intro') === '1'; } catch (e) {}
  if (!seen && !location.hash && !location.search.includes('nointro')) intro.hidden = false;
  document.querySelectorAll('[data-close-intro]').forEach(b => b.addEventListener('click', () => { intro.hidden = true; try { localStorage.setItem('jazz-kaart-intro', '1'); } catch (e) {} }));
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
    const [a, b] = h.split('/');
    if (a === 'band') { const bb = bandById.get(b); if (bb) selectBand(bb, true); else setMode('net'); return; }
    if (a === 'top') { const t = TOP.find(x => x.pos === +b); if (t) selectTop(t, true); else setMode('top'); return; }
    if (routes.some(r => r.id === a)) { sel.value = a; setPath(a); if (b && byId.has(b)) select(byId.get(b), true); return; }
    if (byId.has(a)) { const g = byId.get(a); if (isComp(g) && !state.comps) { compBox.checked = true; compBox.dispatchEvent(new Event('change')); } select(g, true); }
  }
  fromHash();
  window.addEventListener('hashchange', fromHash);
  const qm = new URLSearchParams(location.search).get('mode');
  if (qm === 'world' || qm === 'net') setMode(qm);
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, select')) return;
    if (e.key === 'Escape') { intro.hidden = true; clearSelection(); }
    if (state.path && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) goStep(state.step + (e.key === 'ArrowRight' ? 1 : -1), true);
  });
})();
