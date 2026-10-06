/* Filmmuziekkaart: stromingen en componisten als stamboom en op de wereldkaart. */
(async function () {
  const SOR = window.SOR;
  const $ = s => document.querySelector(s);
  const [data, routes, world] = await Promise.all([
    SOR.load('data/kaart.json'),
    SOR.load('data/routes.json').catch(() => []),
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then(r => r.json()).catch(() => null)
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

  const state = { mode: 'tree', year: YMAX, fams: new Set(fams.map(f => f.id)), comps: true, sel: null, path: null, step: 0, playing: false, sound: false };
  try { if (localStorage.getItem('film-kaart-comps') === '0') state.comps = false; } catch (e) {}

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
    state.comps = compBox.checked; try { localStorage.setItem('film-kaart-comps', state.comps ? '1' : '0'); } catch (e) {}
    if (!state.comps && state.sel && isComp(state.sel)) clearSelection();
    layoutTree(); drawBack(); applyVisibility(); place(true);
  });
  const sel = $('#k-path');
  sel.innerHTML = '<option value="">Alles</option>' + routes.map(r => `<option value="${r.id}">${r.title}</option>`).join('');
  if (!routes.length) sel.closest('label').hidden = true;
  const dl = $('#k-genres');
  dl.innerHTML = G.slice().sort((a, b) => a.name.localeCompare(b.name, 'nl')).map(g => `<option value="${g.name}">`).join('');
  $('#k-search').addEventListener('change', e => { const v = SOR.norm(e.target.value); const g = G.find(x => SOR.norm(x.name) === v) || G.find(x => SOR.norm(x.name).includes(v)); if (g) { if (isComp(g) && !state.comps) { compBox.checked = true; compBox.dispatchEvent(new Event('change')); } select(g, true); e.target.value = ''; } });

  // ---------- SVG ----------
  const stage = $('.k-stage');
  const svg = d3.select(stage).append('svg').attr('role', 'img').attr('aria-label', 'Filmmuziekkaart');
  const root = svg.append('g');
  const gBack = root.append('g');
  const gGrid = root.append('g');
  const gLinks = root.append('g');
  const gPath = root.append('g');
  const gNodes = root.append('g');
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
      .attr('aria-label', d => isComp(d) ? `${d.name}, componist, ${d.year}` : `${d.name}, ${d.year}, ${d.place.name}`);
    n.append('circle').attr('class', 'hit').attr('r', d => isComp(d) ? 9 : 14);
    n.append('circle').attr('class', 'ring').attr('r', d => isComp(d) ? 5 : 8);
    n.append('circle').attr('class', 'dot').attr('r', d => isComp(d) ? 4 : 7).attr('fill', d => famById.get(d.family)?.color || '#999');
    n.append('text').attr('x', d => isComp(d) ? 7 : 11).attr('dy', '.35em').text(d => d.name);
    return n;
  });
  const linkSel = gLinks.selectAll('path.link').data(links).join('path').attr('class', d => 'link ' + d.type).attr('stroke', d => famById.get(d.target.family)?.color || '#888');

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
      ln.append('rect').attr('class', 'bg').attr('x', 0).attr('width', 158).attr('fill', '#121110').attr('opacity', .92);
      ln.append('rect').attr('class', 'bar').attr('x', 0).attr('width', 5).attr('fill', d => d.f.color);
      ln.append('text').attr('class', 'lane-name').attr('x', 14).attr('y', d => d.y + 22).attr('fill', d => d.f.color).text(d => d.f.name);
      stickLaneNames(d3.zoomTransform(svg.node()));
    } else {
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
  // Namen die over elkaar zouden vallen weglaten. Stromingen gaan voor; componistnamen pas bij inzoomen of als ze gemarkeerd zijn.
  function cullLabels() {
    const placed = [];
    const hl = d => root.classed('dim') && nodeSel.filter(x => x === d).classed('hl');
    const prio = d => (d === state.sel ? 0 : hl(d) ? 1 : isComp(d) ? 3 : 2);
    const compZoom = state.mode === 'tree' ? T.k >= 1.15 : T.k >= 3;
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

  function fit(animate) { const t = fitTransform(); (animate ? svg.transition().duration(700) : svg).call(zoom.transform, t); }
  function fitTransform() {
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
  function visible(d) { return state.fams.has(d.family) && d.year <= state.year && (!isComp(d) || state.comps); }
  function applyVisibility() {
    nodeSel.classed('future', d => !visible(d));
    linkSel.classed('future', l => !visible(l.source) || !visible(l.target));
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
    const s = set || (d ? lineage(d) : null);
    root.classed('dim', !!s);
    nodeSel.classed('hl', x => !!s && s.has(x.id));
    linkSel.classed('hl', l => !!s && s.has(l.source.id) && s.has(l.target.id));
    cullLabels();
  }

  // ---------- Paneel ----------
  const panel = $('.k-panel');
  function chip(id) { const g = byId.get(id); return g ? `<button class="kp-chip${isComp(g) ? ' comp' : ''}" type="button" data-id="${g.id}" style="--c:${famById.get(g.family)?.color}"><i></i>${g.name}</button>` : ''; }
  function films(d) { return (d.films || []).length ? `<div><p class="kp-h">Films</p><p class="kp-films">${d.films.map(f => `<span>${f}</span>`).join('')}</p></div>` : ''; }
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
        <div class="fam">${isComp(d) ? 'Componist · ' : ''}${f?.name || ''}</div>
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
        ${mem.length ? `<div><p class="kp-h">Componisten</p><div class="kp-links">${mem.map(c => chip(c.id)).join('')}</div></div>` : ''}
        ${infl.length ? `<div><p class="kp-h">Invloed van</p><div class="kp-links">${infl.map(chip).join('')}</div></div>` : ''}
        ${inflOn.length ? `<div><p class="kp-h">Invloed op</p><div class="kp-links">${inflOn.map(chip).join('')}</div></div>` : ''}
        ${parentsS.length ? `<div><p class="kp-h">Komt voort uit</p><div class="kp-links">${parentsS.map(chip).join('')}</div></div>` : ''}
        ${kidsS.length ? `<div><p class="kp-h">Leidde tot</p><div class="kp-links">${kidsS.map(chip).join('')}</div></div>` : ''}
      </div>`;
    panel.hidden = false;
    panel.scrollTop = 0;
    panel.querySelectorAll('.sor-play').forEach(b => b.addEventListener('click', () => SOR.play(trackFor(tracks[+b.dataset.t]))));
    syncButtons();
  }
  const trackFor = t => ({ ...t, artist: t.artist, title: t.film ? t.film + ' · ' + t.title : t.title });
  panel.addEventListener('click', e => {
    const c = e.target.closest('[data-id]'); if (c) { const g = byId.get(c.dataset.id); if (isComp(g) && !state.comps) { compBox.checked = true; compBox.dispatchEvent(new Event('change')); } select(g, true); return; }
    const s = e.target.closest('[data-step]'); if (s) { goStep(state.step + +s.dataset.step, true); return; }
    if (e.target.closest('.kp-close')) clearSelection();
  });
  function syncButtons() {
    const d = state.sel; if (!d) return;
    const tracks = (d.tracks || []).filter(t => t.audio);
    panel.querySelectorAll('.sor-play').forEach(b => { const on = SOR.isPlaying(tracks[+b.dataset.t]); b.classList.toggle('on', on); b.innerHTML = on ? SOR.pauseIcon : SOR.playIcon; });
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
    if (state.path) highlight(null, new Set(state.path.list.map(g => g.id))); else highlight(d);
    renderPanel(d);
    resizeStage();
    if (center) centerOn(d);
    const tr = (d.tracks || []).filter(t => t.audio);
    if (playFirst && tr[0]) SOR.play(trackFor(tr[0]));
    history.replaceState(null, '', '#' + (state.path ? state.path.id + '/' : '') + d.id);
  }
  function clearSelection() {
    state.sel = null; nodeSel.classed('sel', false);
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
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
    if (state.mode === b.dataset.mode) return;
    state.mode = b.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    drawBack(); svg.interrupt(); suppress = true; svg.call(zoom.transform, fitTransform()); place(true); setTimeout(() => { suppress = false; cullLabels(); }, 950); setTimeout(cullLabels, 1300);
    if (state.sel) setTimeout(() => centerOn(state.sel), 950);
  }));
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
  function setSpeed(v) { speed = v; speedBtns.forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.speed === v))); try { localStorage.setItem('film-kaart-tempo', String(v)); } catch (e) {} }
  speedBtns.forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
  try { const v = +localStorage.getItem('film-kaart-tempo'); if (speedBtns.some(b => +b.dataset.speed === v)) setSpeed(v); } catch (e) {}
  const playBtn = $('#k-play');
  function stopTape() { clearTimeout(timer); timer = null; state.playing = false; playBtn.innerHTML = playBtn.dataset.play; }
  playBtn.dataset.play = playBtn.innerHTML;
  playBtn.addEventListener('click', () => {
    if (state.playing) { stopTape(); return; }
    if (state.path) { sel.value = ''; setPath(null); }
    clearSelection();
    if (state.year >= YMAX) state.year = YMIN;
    state.playing = true;
    playBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zM14 5h3v14h-3z"/></svg>Pauze';
    const tick = () => {
      state.year += 1; syncYear(); applyVisibility();
      const born = G.filter(g => g.year === state.year && visible(g));
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
  let seen = false; try { seen = localStorage.getItem('film-kaart-intro') === '1'; } catch (e) {}
  if (!seen && !location.hash && !location.search.includes('nointro')) intro.hidden = false;
  document.querySelectorAll('[data-close-intro]').forEach(b => b.addEventListener('click', () => { intro.hidden = true; try { localStorage.setItem('film-kaart-intro', '1'); } catch (e) {} }));
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
    if (routes.some(r => r.id === a)) { sel.value = a; setPath(a); if (b && byId.has(b)) select(byId.get(b), true); return; }
    if (byId.has(a)) { const g = byId.get(a); if (isComp(g) && !state.comps) { compBox.checked = true; compBox.dispatchEvent(new Event('change')); } select(g, true); }
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
