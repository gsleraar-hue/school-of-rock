/* De hitfabriek · stamboom. GEMAAKT DOOR tijdlijnen/maak.ts uit site/assets/kaart.js; niet met de hand bewerken. */
(async function () {
  const SOR = window.SOR;
  const $ = s => document.querySelector(s);
  const [data, mixtapes, order, tech, world] = await Promise.all([
    SOR.load('data/genres.json'),
    SOR.load('data/mixtapes.json'),
    SOR.load('data/order.json').catch(() => ({})),
    SOR.load('data/tech.json').catch(() => null),
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
    focusFams();
  });
  const sel = $('#k-path');
  sel.innerHTML = '<option value="">Alle genres</option>' + mixtapes.map(m => `<option value="${m.n}">Mixtape ${m.n} · ${m.title}</option>`).join('');
  const dl = $('#k-genres');
  // zoeken op genre, uitvinding of artiest (de artiesten van de luisterfragmenten)
  let searchList = [];
  function buildSearch() {
    const seen = new Set(), L = [];
    const add = (label, go, kind, who) => { const k = SOR.norm(label); if (!seen.has(k)) { seen.add(k); L.push({ label, k, go, kind, a: who ? SOR.norm(who) : k }); } };
    G.forEach(g => add(g.name, () => select(g, true), 0));
    TI.forEach(d => add(d.name, () => selectTech(d, true), 1));
    G.forEach(g => (g.tracks || []).forEach(x => x.artist && add(`${x.artist} · ${g.name}`, () => select(g, true), 2, x.artist)));
    TI.forEach(d => (d.tracks || []).forEach(x => x.artist && add(`${x.artist} · ${d.name}`, () => selectTech(d, true), 3, x.artist)));
    searchList = L;
  }
  // Eigen suggestielijst in plaats van een datalist: met ruim 900 opties haperde het typen.
  // Toont hooguit tien treffers, pas na een korte pauze in het typen.
  const sInput = $('#k-search');
  sInput.removeAttribute('list'); dl.remove();
  const sBox = document.createElement('ul');
  sBox.className = 'k-sugg'; sBox.hidden = true; sBox.setAttribute('role', 'listbox');
  sInput.parentElement.style.position = 'relative';
  sInput.parentElement.appendChild(sBox);
  const sCss = document.createElement('style');
  sCss.textContent = '.k-sugg{position:absolute;top:100%;right:0;z-index:60;min-width:260px;max-width:360px;margin:4px 0 0;padding:4px 0;list-style:none;background:#232120;border:1px solid #3A3833;border-radius:4px;box-shadow:0 8px 24px rgba(0,0,0,.4);font:14px/1.3 Inter,sans-serif;text-transform:none;letter-spacing:0}' +
    '.k-sugg li{padding:7px 12px;color:#EDE9E1;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.k-sugg li small{color:#9C978D;margin-left:6px}.k-sugg li.on,.k-sugg li:hover{background:#3A3833}';
  document.head.appendChild(sCss);
  let sHits = [], sOn = -1, sTimer = 0;
  const KIND = ['genre', 'techniek', '', ''];
  function suggest() {
    const v = SOR.norm(sInput.value);
    if (!v) { sBox.hidden = true; sHits = []; return; }
    // begin van de naam eerst, dan het begin van een los woord erin (dus "pri" vindt Prince, niet Rites of Spring)
    const raw = SOR.slug(sInput.value);
    const word = s => SOR.slug(s).split('-').some(w => w.startsWith(raw.split('-')[0])) && SOR.norm(s).includes(v);
    const rank = o => (o.kind < 2 ? (o.k.startsWith(v) ? 0 : word(o.label) ? 2 : 9) : (o.a.startsWith(v) ? 1 : word(o.label.split(' · ')[0]) ? 3 : 9));
    sHits = searchList.map(o => [rank(o), o]).filter(([r]) => r < 9).sort((a, b) => a[0] - b[0] || a[1].label.length - b[1].label.length).slice(0, 10).map(([, o]) => o);
    sOn = -1;
    sBox.innerHTML = sHits.map((o, i) => `<li role="option" data-i="${i}">${o.label}${KIND[o.kind] ? `<small>${KIND[o.kind]}</small>` : ''}</li>`).join('');
    sBox.hidden = !sHits.length;
  }
  function pick(o) { o.go(); sInput.value = ''; sBox.hidden = true; sHits = []; sInput.blur(); }
  sInput.addEventListener('input', () => { clearTimeout(sTimer); sTimer = setTimeout(suggest, 90); });
  sInput.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!sHits.length) return; e.preventDefault();
      sOn = (sOn + (e.key === 'ArrowDown' ? 1 : -1) + sHits.length) % sHits.length;
      sBox.querySelectorAll('li').forEach((li, i) => li.classList.toggle('on', i === sOn));
    } else if (e.key === 'Enter') {
      e.preventDefault(); clearTimeout(sTimer);
      if (sOn >= 0 && sHits[sOn]) pick(sHits[sOn]); else { sBox.hidden = true; sInput.dispatchEvent(new Event('k-go')); }
    } else if (e.key === 'Escape') { sBox.hidden = true; }
  });
  sBox.addEventListener('mousedown', e => { const li = e.target.closest('li'); if (li) { e.preventDefault(); pick(sHits[+li.dataset.i]); } });
  sInput.addEventListener('blur', () => setTimeout(() => { sBox.hidden = true; }, 150));
  sInput.addEventListener('k-go', e => {
    const v = SOR.norm(e.target.value); if (!v) return;
    const done = () => { e.target.value = ''; e.target.blur(); };
    const o = searchList.find(x => x.k === v) || searchList.find(x => x.kind < 2 && x.k.includes(v)) || searchList.find(x => x.kind >= 2 && x.a === v);
    if (o) { o.go(); done(); return; }
    // daarna de naam als los woord in de teksten (eerst genres, dan uitvindingen), niet als begin van een langere naam
    const raw = e.target.value.trim().toLowerCase();
    if (raw.length >= 3) {
      const re = new RegExp('(^|[^a-zà-ÿ])' + raw.replace(/[^a-z0-9à-ÿ ]/g, '.') + '(?=$|[^a-zà-ÿ])', 'gi');
      const has = s => { s = (s || '').replace(/<[^>]+>/g, ''); for (const m of s.matchAll(re)) if (!/^ [A-Z]/.test(s.slice(m.index + m[0].length))) return true; return false; };
      const g = G.find(x => has(x.text)); if (g) { select(g, true); done(); return; }
      const d = TI.find(x => has(x.text)); if (d) { selectTech(d, true); done(); return; }
    }
    const o2 = searchList.find(x => x.kind >= 2 && x.a.startsWith(v)) || searchList.find(x => x.kind >= 2 && x.a.includes(v)) || searchList.find(x => x.k.includes(v));
    if (o2) { o2.go(); done(); return; }
    e.target.animate([{ borderColor: '#E0603F' }, { borderColor: '#3A3833' }], { duration: 900 });
  });

  // ---------- SVG ----------
  const stage = $('.k-stage');
  const svg = d3.select(stage).append('svg').attr('role', 'img').attr('aria-label', "De hitfabriek · stamboom");
  const root = svg.append('g');
  const gBack = root.append('g');      // banen of landen
  const gGrid = root.append('g');      // decennia
  const gLinks = root.append('g');
  const gPath = root.append('g');
  const gTechLinks = root.append('g').attr('class', 'tech-links');
  const gTech = root.append('g').attr('class', 'tech-items');
  const gNodes = root.append('g');
  const gCities = root.append('g').attr('class', 'cities');
  const gLaneNames = svg.append('g');  // vast aan de linkerkant
  let T = d3.zoomIdentity, suppress = false, userPan = 0, lichtPan = false, lastCull = 0;
  const zoom = d3.zoom().scaleExtent([0.3, 14]).on('zoom', ev => {
    if (ev.sourceEvent) userPan = Date.now();
    T = ev.transform;
    gBack.attr('transform', T);
    updateGrid(); updateCities(); stickLaneNames(T);
    root.classed('zoomed', state.mode === 'world' && T.k > 2.4);
    if (!suppress) place(false);
  });
  svg.call(zoom).on('dblclick.zoom', null);
  // trackpad: twee vingers verschuiven de kaart, knijpen (of Ctrl + wiel) zoomt; een muiswiel blijft zoomen.
  // Boven de namenbalk links is het altijd scrollen.
  const laneBarW = () => gLaneNames.attr('display') === 'none' ? 0 : +(gLaneNames.select('rect.bg').attr('width') || 0);
  const isPanWheel = ev => !ev.ctrlKey && (ev.offsetX < laneBarW() || ev.shiftKey || (ev.deltaMode === 0 && (ev.deltaX !== 0 || !Number.isInteger(ev.deltaY) || Math.abs(ev.deltaY) < 50)));
  zoom.filter(ev => ev.type === 'wheel' ? !isPanWheel(ev) : (!ev.ctrlKey && !ev.button));
  svg.node().addEventListener('wheel', ev => {
    if (!isPanWheel(ev)) return;
    ev.preventDefault();
    const k = d3.zoomTransform(svg.node()).k, dx = ev.shiftKey && !ev.deltaX ? ev.deltaY : ev.deltaX, dy = ev.shiftKey && !ev.deltaX ? 0 : ev.deltaY;
    svg.call(zoom.translateBy, -dx / k, -dy / k);
  }, { passive: false });
  svg.on('click', ev => { if (ev.target === svg.node()) { clearSelection(); } });

  let W = 0, H = 0;
  // ---------- Stamboom: tijd horizontaal, families als banen ----------
  const PX_PER_YEAR = 15, ROW = 22, LANE_PAD = 14, LEFT = 290;
  // De hitfabriek · stamboom: 1950-2026 breed uitgetrokken, daarvoor en daarna samengedrukt
  const SEG = [[1891,75],[1893,5],[1899,75],[1901,5],[1903,75],[1905,5],[1909,75],[1915,5],[1919,75],[1921,5],[1939,75],[1941,110],[1943,75],[1945,5],[1951,75],[1955,5],[1957,145],[1959,75],[1961,110],[1963,180],[1965,75],[1969,5],[1971,75],[1977,5],[1981,75],[1983,5],[1985,145],[1987,110],[1991,75],[1993,5],[1997,110],[1999,75],[2001,5],[2005,75],[2007,110],[2009,75],[2019,110],[2021,5],[2023,110],[2025,5],[2027,5]];
  const SEGX = []; { let x = 0; SEG.forEach(([y], i) => { SEGX.push(x); if (i < SEG.length - 1) x += (SEG[i + 1][0] - y) * SEG[i][1]; }); }
  const tx = y => { y = Math.max(SEG[0][0], y); let i = SEG.length - 2; while (i > 0 && y < SEG[i][0]) i--; return LEFT + SEGX[i] + (y - SEG[i][0]) * SEG[i][1]; };
  const xToYear = x => { x -= LEFT; let i = SEG.length - 2; while (i > 0 && x < SEGX[i]) i--; return SEG[i][0] + (x - SEGX[i]) / SEG[i][1]; };
  const MAAND = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  const fmtD = d => { if (!d.date) return String(Math.floor(d.year)); const [y, m, dd] = String(d.date).split('-').map(Number); return (dd ? dd + ' ' : '') + (m ? MAAND[m - 1] + ' ' : '') + y; };
  const fmtT = y => { const j = Math.floor(y), m = Math.min(11, Math.floor((y - j) * 12)); return j >= 1950 && j < 2026 ? MAAND[m].slice(0, 3) + ' ' + j : String(j); };
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

  // ---------- TECHNIEK: uitvindingen in vier banen boven de stamboom ----------
  const TL = tech ? tech.lanes : [], TI = tech ? tech.items.map(d => ({ ...d })) : [];
  const tById = new Map(TI.map(d => [d.id, d]));
  const tLaneById = new Map(TL.map(l => [l.id, l]));
  // enabled: maakte het genre mogelijk; shaped: speelde er een rol in (verspreidde of veranderde het)
  const techFor = gid => TI.filter(d => (d.enabled || []).includes(gid));
  const techShaped = gid => TI.filter(d => (d.shaped || []).includes(gid));
  let techLanes = [], techTop = 0;
  (function layoutTech() {
    const heights = TL.map(l => {
      const rows = [];
      TI.filter(d => d.lane === l.id).sort((a, b) => a.year - b.year).forEach(d => {
        const x = tx(d.year), w = 16 + d.name.length * 6.6;
        let r = rows.findIndex(e => e < x - 8); if (r < 0) { r = rows.length; rows.push(0); } rows[r] = x + w; d.row = r;
      });
      return Math.max(1, rows.length) * ROW + LANE_PAD * 2;
    });
    const total = heights.reduce((a, b) => a + b, 0) + 24;
    let y = 40 - total; techTop = y;
    techLanes = TL.map((l, i) => { const lane = { f: { name: l.name, color: l.color }, y, h: heights[i], alt: i % 2 === 1, tech: true }; TI.filter(d => d.lane === l.id).forEach(d => { d.pos = { x: tx(d.year), y: y + LANE_PAD + d.row * ROW + ROW / 2 }; }); y += heights[i]; return lane; });
  })();
  const techLinks = TI.flatMap(d => [...(d.enabled || []).map(id => [id, false]), ...(d.shaped || []).map(id => [id, true])].filter(([id]) => byId.has(id)).map(([id, sh]) => ({ s: d, g: byId.get(id), sh })));
  const techAfter = TI.flatMap(d => (d.after || []).filter(id => tById.has(id)).map(id => ({ s: tById.get(id), t: d })));
  buildSearch();

  // ---------- Wereld ----------
  let projection = null, countries = null;
  function layoutWorld() {
    projection = d3.geoNaturalEarth1().fitExtent([[20, 20], [Math.max(W, 900) - 20, Math.max(H, 520) - 20]], { type: 'Sphere' });
    if (world) countries = topojson.feature(world, world.objects.countries);
    // Genres in dezelfde stad uit elkaar duwen.
    const nodes = G.map(g => { const [x, y] = projection([g.place.lon, g.place.lat]); return { g, x, y, tx: x, ty: y }; });
    const sim = d3.forceSimulation(nodes).force('x', d3.forceX(d => d.tx).strength(.6)).force('y', d3.forceY(d => d.ty).strength(.6)).force('c', d3.forceCollide(6.5)).stop();
    for (let i = 0; i < 160; i++) sim.tick();
    nodes.forEach(n => { n.g.world = { x: n.x, y: n.y, ax: n.tx, ay: n.ty }; });
  }

  // ---------- Tekenen ----------
  const nodeSel = gNodes.selectAll('g.node').data(G, d => d.id).join(enter => {
    const n = enter.append('g').attr('class', 'node').attr('tabindex', 0).attr('role', 'button').attr('aria-label', d => `${d.name}, ${fmtD(d)}, ${d.place.name}`);
    n.append('circle').attr('class', 'hit').attr('r', 14);
    n.append('circle').attr('class', 'ring').attr('r', 8);
    n.append('circle').attr('class', 'dot').attr('r', 7).attr('fill', d => famById.get(d.family)?.color || '#999');
    n.append('text').attr('x', 11).attr('dy', '.35em').text(d => d.name);
    return n;
  });
  const linkSel = gLinks.selectAll('path.link').data(links).join('path').attr('class', 'link').attr('stroke', d => famById.get(d.target.family)?.color || '#888');

  const techCss = document.createElement('style');
  techCss.textContent = '.tech-links,.tech-items{display:none}.techmode .tech-links,.techmode .tech-items{display:inline}' +
    '.titem{cursor:pointer}.titem rect{stroke:#121110;stroke-width:1.5}.titem text{font:12px Inter,sans-serif;fill:#EDE9E1;paint-order:stroke;stroke:#121110;stroke-width:3px}' +
    '.titem.sel rect{stroke:#fff;stroke-width:2.5}.dim .titem:not(.hl){opacity:.18}' +
    '.tlink{fill:none;stroke-width:1.2;stroke-opacity:0;stroke-dasharray:4 3}.tlink{stroke-dasharray:none}.tlink.sh{stroke-dasharray:2 5}.tlink.hl{stroke-opacity:.9;stroke-width:1.8}.tafter{fill:none;stroke:#8A857C;stroke-opacity:.35;stroke-width:1.2}.dim .tafter:not(.hl){stroke-opacity:.05}.tafter.hl{stroke:#F2D500;stroke-opacity:.9}' +
    '.lane-bg.tech{fill:#0E0D0C}.lane-bg.tech.alt{fill:#131210}';
  document.head.appendChild(techCss);
  const tAfterSel = gTechLinks.selectAll('path.tafter').data(techAfter).join('path').attr('class', 'tafter');
  const tLinkSel = gTechLinks.selectAll('path.tlink').data(techLinks).join('path').attr('class', l => 'tlink' + (l.sh ? ' sh' : '')).attr('stroke', l => tLaneById.get(l.s.lane)?.color || '#999');
  const tSel = gTech.selectAll('g.titem').data(TI, d => d.id).join(enter => {
    const n = enter.append('g').attr('class', 'titem').attr('tabindex', 0).attr('role', 'button').attr('aria-label', d => `${d.name}, ${d.year}`);
    n.append('rect').attr('x', -6).attr('y', -6).attr('width', 12).attr('height', 12).attr('rx', 2).attr('transform', 'rotate(45)').attr('fill', d => tLaneById.get(d.lane)?.color || '#999');
    n.append('text').attr('x', 12).attr('dy', '.35em').text(d => d.name);
    return n;
  });
  tSel.on('click', (ev, d) => { ev.stopPropagation(); selectTech(d, false); }).on('keydown', (ev, d) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectTech(d, false); } })
    .on('mouseenter', (ev, d) => { if (!state.sel && !state.tsel && !state.path) highlightTech(d); })
    .on('mouseleave', () => { if (!state.sel && !state.tsel && !state.path) highlight(null); });
  function PT(d) { return { x: T.applyX(d.pos.x), y: T.applyY(d.pos.y) }; }
  function techChain(d) { const s = new Set([d.id]); (function up(n) { (n.after || []).forEach(a => { if (tById.has(a) && !s.has(a)) { s.add(a); up(tById.get(a)); } }); })(d); TI.forEach(o => { if ((o.after || []).includes(d.id)) s.add(o.id); }); return s; }
  function highlightTech(d) {
    const ts = techChain(d), gs = new Set([...(d.enabled || []), ...(d.shaped || [])]);
    root.classed('dim', true);
    tSel.classed('hl', o => ts.has(o.id)); tAfterSel.classed('hl', l => ts.has(l.s.id) && ts.has(l.t.id));
    tLinkSel.classed('hl', l => l.s === d);
    nodeSel.classed('hl', x => gs.has(x.id)); linkSel.classed('hl', false);
    cullLabels();
  }
  function renderTechPanel(d) {
    const lane = tLaneById.get(d.lane), tracks = (d.tracks || []).filter(x => x.audio);
    const tchip = o => `<button class="kp-chip" type="button" data-tech="${o.id}" style="--c:${tLaneById.get(o.lane)?.color}"><i></i>${o.name}</button>`;
    const after = (d.after || []).map(id => tById.get(id)).filter(Boolean), next = TI.filter(o => (o.after || []).includes(d.id));
    const gen = (d.enabled || []).filter(id => byId.has(id)), shp = (d.shaped || []).filter(id => byId.has(id));
    panel.innerHTML = `<div class="kp-head" style="--c:${lane?.color}"><button class="kp-close" type="button" aria-label="Sluit">×</button><div class="fam">Techniek · ${lane?.name || ''}</div><h2>${d.name}</h2><div class="meta">${d.year}${d.who ? ' · ' + d.who : ''}${d.place?.name ? ' · ' + d.place.name : ''}</div></div>
      <div class="kp-body"><p>${d.text}</p>${d.listen ? `<p class="kp-listen">${d.listen}</p>` : ''}
      ${tracks.length ? `<div><p class="kp-h">Luister</p><div class="kp-tracks">${tracks.map((x, i) => `<div class="kp-track${x.cover ? '' : ' nocover'}"><button class="sor-play" type="button" data-t="${i}" aria-label="Speel ${x.artist}">${SOR.playIcon}</button>${x.cover ? `<img src="${SOR.thumb(x.cover)}" alt="" loading="lazy">` : ''}<div><b>${x.artist}</b><span>${x.title}${x.year ? ' · ' + x.year : ''}</span>${SOR.storeOf(x) ? `<a class="kp-store" href="${SOR.storeOf(x)}" target="_blank" rel="noopener" aria-label="Luister op Apple Music" title="Luister op Apple Music">${SOR.storeBadge}</a>` : ''}</div></div>`).join('')}</div></div>` : ''}
      ${gen.length ? `<div><p class="kp-h">Maakte mogelijk</p><div class="kp-links">${gen.map(chip).join('')}</div></div>` : ''}
      ${shp.length ? `<div><p class="kp-h">Speelde ook een rol bij</p><div class="kp-links">${shp.map(chip).join('')}</div></div>` : ''}
      ${after.length ? `<div><p class="kp-h">Bouwt voort op</p><div class="kp-links">${after.map(tchip).join('')}</div></div>` : ''}
      ${next.length ? `<div><p class="kp-h">Leidde tot</p><div class="kp-links">${next.map(tchip).join('')}</div></div>` : ''}</div>`;
    panel.hidden = false; panel.scrollTop = 0;
    panel.querySelectorAll('.sor-play').forEach(b => b.addEventListener('click', () => { const x = tracks[+b.dataset.t]; SOR.play({ audio: x.audio, artist: x.artist, title: x.title, cover: x.cover, year: x.year }); }));
  }
  function selectTech(d, center) {
    if (!d) return;
    if (state.mode !== 'tech') setMode('tech');
    if (state.path) { sel.value = ''; state.path = null; gPath.selectAll('*').remove(); }
    state.sel = null; nodeSel.classed('sel', false);
    state.tsel = d; tSel.classed('sel', o => o === d);
    highlightTech(d); renderTechPanel(d); resizeStage();
    if (center) setTimeout(() => { const k = Math.max(d3.zoomTransform(svg.node()).k, 1); svg.transition().duration(650).call(zoom.transform, d3.zoomIdentity.translate(W / 2 - d.pos.x * k, H / 2 - d.pos.y * k).scale(k)); }, 50);
    history.replaceState(null, '', '#tech/' + d.id);
  }

  nodeSel.on('click', (ev, d) => { ev.stopPropagation(); kiesMoment(d); })
    .on('keydown', (ev, d) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); kiesMoment(d); } })
    .on('mouseenter', (ev, d) => { if (!state.sel && !state.path) highlight(d); })
    .on('mouseleave', () => { if (!state.sel && !state.path) highlight(null); });

  function pos(d) { return state.mode === 'world' ? d.world : d.tree; }
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
    root.classed('techmode', state.mode === 'tech');
    if (state.mode === 'tree' || state.mode === 'tech') {
      const LL = state.mode === 'tech' ? [...techLanes, ...lanes] : lanes;
      gBack.selectAll('rect').data(LL).join('rect').attr('class', d => 'lane-bg' + (d.alt ? ' alt' : '') + (d.tech ? ' tech' : '')).attr('x', -4000).attr('width', treeW + 8000).attr('y', d => d.y).attr('height', d => d.h);
      const decades = [1880,1890,1900,1910,1920,1930,1940,1950,1952,1954,1956,1958,1960,1962,1964,1966,1968,1970,1972,1974,1976,1978,1980,1982,1984,1986,1988,1990,1992,1994,1996,1998,2000,2002,2004,2006,2008,2010,2012,2014,2016,2018,2020,2022,2024];
      const dg = gGrid.selectAll('g').data(decades).join('g').attr('class', 'decade');
      dg.append('line');
      dg.append('text').attr('y', 16).text(d => d);
      updateGrid();
      const ln = gLaneNames.selectAll('g').data(LL).join('g');
      ln.append('rect').attr('class', 'bg').attr('x', 0).attr('width', 158).attr('fill', '#121110').attr('opacity', .92);
      ln.append('rect').attr('class', 'bar').attr('x', 0).attr('width', 5).attr('fill', d => d.f.color);
      ln.append('text').attr('class', 'lane-name').attr('x', 14).attr('y', d => d.y + 22).attr('fill', d => d.f.color).text(d => d.f.name);
      stickLaneNames(d3.zoomTransform(svg.node()));
      // breedte van het naamvlak afstemmen op de langste naam (ook als het lettertype later binnenkomt)
      const fitNames = () => { const w = d3.max(ln.selectAll('text').nodes(), n => n.getComputedTextLength()) || 0; ln.selectAll('rect.bg').attr('width', Math.max(158, Math.ceil(w) + 30)); };
      fitNames(); if (document.fonts) document.fonts.ready.then(fitNames);
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
    if (state.mode === 'world') { gLaneNames.attr('display', 'none'); return; }
    gLaneNames.attr('display', null);
    gLaneNames.selectAll('g').each(function (d) {
      const top = t.y + d.y * t.k, h = d.h * t.k, g = d3.select(this);
      g.select('rect.bg').attr('y', top).attr('height', h);
      g.select('rect.bar').attr('y', top).attr('height', h);
      g.select('text').attr('y', top + Math.min(22, h / 2 + 5)).attr('opacity', h < 16 ? 0 : 1);
    });
  }
  function updateGrid() {
    gGrid.selectAll('g.decade').each(function (d) { const x = T.applyX(tx(d)); const g = d3.select(this); g.select('line').attr('x1', x).attr('x2', x).attr('y1', Math.max(22, T.applyY(state.mode === 'tech' ? techTop : 26))).attr('y2', T.applyY(treeH)); g.select('text').attr('x', x + 4); });
    // jaartallen boven het raster die elkaar zouden raken weglaten
    { let last = -1e9; gGrid.selectAll('g.decade text').each(function () { const x = +this.getAttribute('x'), w = this.getComputedTextLength ? this.getComputedTextLength() : 40; if (x > last + 10) { this.removeAttribute('visibility'); last = x + w; } else this.setAttribute('visibility', 'hidden'); }); }
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
    if (state.mode === 'tech') {
      tSel.attr('transform', d => { const q = PT(d); return `translate(${q.x},${q.y})`; });
      tAfterSel.attr('d', l => { const a = PT(l.s), b = PT(l.t), mx = (a.x + b.x) / 2; return `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`; });
      tLinkSel.attr('d', l => { const a = PT(l.s), b = P(l.g), my = (a.y + b.y) / 2; return `M${a.x},${a.y} C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`; });
    }
    drawPath();
    if (!animate) { if (!lichtPan || performance.now() - lastCull > 400) { lastCull = performance.now(); cullLabels(); } } else setTimeout(cullLabels, 950);
  }
  // Namen die over elkaar zouden vallen weglaten; geselecteerde en gemarkeerde genres gaan voor.
  function cullLabels() {
    const placed = [];
    const prio = d => (d === state.sel ? 0 : root.classed('dim') && nodeSel.filter(x => x === d).classed('hl') ? 1 : 2);
    const list = G.filter(d => visible(d)).map(d => ({ d, q: P(d), p: prio(d) })).sort((a, b) => a.p - b.p || a.d.year - b.d.year);
    const show = new Set();
    const dots = list;
    list.forEach(({ d, q }) => {
      const w = d.name.length * 6.4 + 12;
      const box = [q.x - 8, q.y - 8, q.x + w, q.y + 8];
      if (q.x < -50 || q.y < -20 || q.x > W + 50 || q.y > H + 20) return;
      const free = !placed.some(b => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))
        && !dots.some(o => o.d !== d && o.q.x + 6 > box[0] + 14 && o.q.x - 6 < box[2] && o.q.y + 6 > box[1] && o.q.y - 6 < box[3]);
      if (free) { placed.push(box); show.add(d.id); }
    });
    nodeSel.select('text').attr('visibility', d => show.has(d.id) ? null : 'hidden');
    // namen van uitvindingen: dezelfde regel, de geselecteerde en gemarkeerde gaan voor
    if (state.mode === 'tech') {
      const tp = [], tprio = d => (d === state.tsel ? 0 : root.classed('dim') && tSel.filter(x => x === d).classed('hl') ? 1 : 2);
      const tshow = new Set();
      TI.map(d => ({ d, q: PT(d), p: tprio(d) })).sort((a, b) => a.p - b.p || a.d.year - b.d.year).forEach(({ d, q }) => {
        const box = [q.x - 8, q.y - 8, q.x + d.name.length * 6.6 + 14, q.y + 8];
        if (!tp.some(b => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) { tp.push(box); tshow.add(d.id); }
      });
      tSel.select('text').attr('visibility', d => tshow.has(d.id) ? null : 'hidden');
    }
    // plaatsnamen wijken voor genrenamen
    if (state.mode === 'world') {
      updateCities();
      gCities.selectAll('text').each(function () {
        if (this.getAttribute('visibility') === 'hidden') return;
        const b = this.getBBox(), box = [b.x - 2, b.y - 1, b.x + b.width + 2, b.y + b.height + 1];
        if (placed.some(p => !(box[2] < p[0] || box[0] > p[2] || box[3] < p[1] || box[1] > p[3]))) this.setAttribute('visibility', 'hidden');
      });
    }
  }

  // familieknop: ga naar de gekozen familie(s) in plaats van de kaart af te laten zoeken
  function focusFams() {
    if (state.mode !== 'tree' && state.mode !== 'world') return;
    if (state.fams.size === fams.length) { fit(true); return; }
    const gs = G.filter(g => state.fams.has(g.family) && pos(g) && (typeof isComp !== 'function' || !isComp(g) || state.comps));
    if (!gs.length) return;
    const P = gs.map(g => pos(g)), xs = P.map(p => p.x), ys = P.map(p => p.y);
    const x0 = d3.min(xs) - 60, x1 = d3.max(xs) + 120, y0 = d3.min(ys) - 40, y1 = d3.max(ys) + 40;
    const k = Math.max(state.mode === 'world' ? .8 : .6, Math.min(state.mode === 'world' ? 5 : 1.6, (W - 190) / (x1 - x0), (H - 20) / (y1 - y0)));
    const t = state.mode === 'world'
      ? d3.zoomIdentity.translate(W / 2 - (x0 + x1) / 2 * k, H / 2 - (y0 + y1) / 2 * k).scale(k)
      : d3.zoomIdentity.translate(170 - x0 * k, H / 2 - (y0 + y1) / 2 * k).scale(k);
    svg.transition().duration(650).call(zoom.transform, t);
  }
  function fit(animate) { const t = fitTransform(); (animate ? svg.transition().duration(700) : svg).call(zoom.transform, t); }
  function fitTransform() {
    let t;
    if (state.mode === 'tech') {
      const hh = treeH - techTop + 20, kk = Math.max(Math.min(1, (H - 20) / hh), Math.min(1, (W - 190) / (treeW - LEFT + 40)), .35);
      t = d3.zoomIdentity.translate(170 - LEFT * kk, 10 - techTop * kk).scale(kk);
    } else if (state.mode === 'tree') {
      // de tijdlijn begint rechts van de kolom met familienamen
      const kk = Math.max(Math.min(1, (H - 20) / (treeH + 10)), Math.min(1, (W - 190) / (treeW - LEFT + 40)));
      t = d3.zoomIdentity.translate(170 - tx(1880) * kk, 0).scale(kk);
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
  // komen er genres bij of vallen er weg (afspelen, tijdbalk, familieknoppen), dan de namen opnieuw verdelen
  var shownCount; // var: applyVisibility() loopt al tijdens het opstarten
  function applyVisibility() {
    nodeSel.classed('future', d => !visible(d));
    linkSel.classed('future', l => !visible(l.source) || !visible(l.target));
    const n = G.reduce((s, d) => s + (visible(d) ? 1 : 0), 0);
    if (shownCount !== undefined && n !== shownCount) cullLabels();
    shownCount = n;
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
        <div class="meta">${fmtD(d)} · ${d.place.name}</div>
      </div>
      <div class="kp-body">
        ${step}
        <p>${d.text}</p>
        ${d.listen ? `<p class="kp-listen">${d.listen}</p>` : ''}
        ${tracks.length ? `<div><p class="kp-h">Luister</p><div class="kp-tracks">${tracks.map((t, i) => `<div class="kp-track${t.cover ? '' : ' nocover'}"><button class="sor-play" type="button" data-t="${i}" aria-label="Speel ${t.artist}">${SOR.playIcon}</button>${t.cover ? `<img src="${SOR.thumb(t.cover)}" alt="" loading="lazy" onerror="this.remove();this.parentNode&&0">` : ''}<div><b>${t.artist}</b><span>${t.title}${t.year ? ' · ' + t.year : ''}</span>${SOR.storeOf(t) ? `<a class="kp-store" href="${SOR.storeOf(t)}" target="_blank" rel="noopener" aria-label="Luister op Apple Music" title="Luister op Apple Music">${SOR.storeBadge}</a>` : ''}</div></div>`).join('')}</div></div>` : ''}
        ${techFor(d.id).length ? `<div><p class="kp-h">Techniek die dit mogelijk maakte</p><div class="kp-links">${techFor(d.id).map(o => `<button class="kp-chip" type="button" data-tech="${o.id}" style="--c:${tLaneById.get(o.lane)?.color}"><i></i>${o.name}</button>`).join('')}</div></div>` : ''}
        ${techShaped(d.id).length ? `<div><p class="kp-h">Techniek die er ook een rol in speelde</p><div class="kp-links">${techShaped(d.id).map(o => `<button class="kp-chip" type="button" data-tech="${o.id}" style="--c:${tLaneById.get(o.lane)?.color}"><i></i>${o.name}</button>`).join('')}</div></div>` : ''}
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
    const tc = e.target.closest('[data-tech]'); if (tc) { selectTech(tById.get(tc.dataset.tech), true); return; }
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
    state.tsel = null; tSel.classed('sel', false);
    if (state.mode === 'tech') { const ts = new Set([...techFor(d.id), ...techShaped(d.id)].map(x => x.id)); tSel.classed('hl', o => ts.has(o.id)); tLinkSel.classed('hl', l => l.g === d); tAfterSel.classed('hl', false); }
    renderPanel(d);
    resizeStage();
    if (center) centerOn(d);
    if (playFirst && d.tracks && d.tracks[0]) SOR.play({ ...d.tracks[0] });
    history.replaceState(null, '', '#' + (state.path ? 'mixtape-' + state.path.n + '/' : '') + d.id);
  }
  function clearSelection() {
    state.sel = null; nodeSel.classed('sel', false);
    state.tsel = null; tSel.classed('sel', false).classed('hl', false); tLinkSel.classed('hl', false); tAfterSel.classed('hl', false);
    if (state.path) highlight(null, new Set(state.path.list.map(g => g.id))); else highlight(null);
    panel.hidden = true; resizeStage();
    history.replaceState(null, '', location.pathname + (state.path ? '#mixtape-' + state.path.n : ''));
  }
  function centerOn(d) {
    const p = pos(d), t = d3.zoomTransform(svg.node());
    const k = Math.max(t.k, state.mode === 'world' ? 1.6 : 1);
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
  function setMode(m) {
    if (state.mode === m) return;
    if (state.tsel && m !== 'tech') clearSelection();
    state.mode = m;
    document.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.mode === m)));
    drawBack(); svg.interrupt(); suppress = true; svg.call(zoom.transform, fitTransform()); place(true); setTimeout(() => { suppress = false; cullLabels(); place(false); }, 950); setTimeout(cullLabels, 1300);
    if (state.sel) { const s0 = state.sel; select(s0, false); setTimeout(() => { if (state.sel === s0) centerOn(s0); }, 950); }
  }
  if (!TI.length) document.querySelector('[data-mode=tech]')?.remove();
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('#k-zin').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 1.4));
  $('#k-zout').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 1 / 1.4));
  $('#k-fit').addEventListener('click', () => fit(true));

  // ---------- Tijdlijn: speel de geschiedenis af ----------
  const range = $('#k-range'), yearLbl = $('#k-yearlbl'), yearBig = $('.k-yearbig');
  range.min = Math.round(tx(YMIN)); range.max = Math.round(tx(YMAX)); range.step = 1; range.value = range.max;
  function syncYear() { range.value = Math.round(tx(state.year)); yearLbl.textContent = state.year >= YMAX ? "nu" : fmtT(state.year); yearBig.textContent = state.year >= YMAX ? '' : fmtT(state.year); }
  range.addEventListener('input', () => { state.year = Math.min(YMAX, xToYear(+range.value)); syncYear(); applyVisibility(); knopTekst(); });
  $('#k-sound').addEventListener('change', e => { state.sound = e.target.checked; });
  let timer = null, lastSound = 0, speed = 1;
  // Tempo: aantal jaren per seconde, onthouden per bezoeker
  const speedBtns = [...document.querySelectorAll('.k-speed button')];
  function setSpeed(v) { speed = v; speedBtns.forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.speed === v))); try { localStorage.setItem('sor-kaart-tempo', String(v)); } catch (e) {} }
  speedBtns.forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
  try { const v = +localStorage.getItem('sor-kaart-tempo'); if (speedBtns.some(b => +b.dataset.speed === v)) setSpeed(v); } catch (e) {}
  let meeScrollen = true; try { meeScrollen = localStorage.getItem('sor-tijdlijn-mee') !== '0'; } catch (e) {}
  const meeBox = $('#k-mee'); if (meeBox) { meeBox.checked = meeScrollen; meeBox.addEventListener('change', () => { meeScrollen = meeBox.checked; try { localStorage.setItem('sor-tijdlijn-mee', meeScrollen ? '1' : '0'); } catch (e) {} if (meeScrollen) { userPan = 0; follow(true); } }); }
  let volgFrame = 0, lastTick = 0;
  function follow(start) {
    if (!meeScrollen || state.mode !== 'tree') return;
    const t = d3.zoomTransform(svg.node()), sx = t.applyX(tx(state.year));
    if (start && (sx < 60 || sx > W - 60)) { svg.call(zoom.transform, t.translate((W * 0.3 - sx) / t.k, 0)); }
    if (!volgFrame) volgFrame = requestAnimationFrame(volg);
  }
  function volg() {
    volgFrame = 0;
    if (!state.playing || !meeScrollen || state.mode !== 'tree') return;
    if (Date.now() - userPan > 4000) {
      const t = d3.zoomTransform(svg.node());
      const f = Math.min(1, (performance.now() - lastTick) / (220 / speed));
      const px = tx(state.year) - 12 + 12 * f;
      const achter = t.x - (W * 0.6 - px * t.k);
      if (achter > 0.05) {
        const stap = achter > 30 ? Math.max(2, achter * 0.1) : achter;
        lichtPan = true; svg.call(zoom.transform, d3.zoomIdentity.translate(t.x - stap, t.y).scale(t.k)); lichtPan = false;
      }
    }
    volgFrame = requestAnimationFrame(volg);
  }
  const playBtn = $('#k-play');
  function knopTekst() { const b = $('#k-play'); if (b && b.dataset.play && !state.playing) b.innerHTML = state.year < YMAX ? b.dataset.play.replace('Speel de geschiedenis af', 'Verder') : b.dataset.play; }
  function stopTape() { clearTimeout(timer); timer = null; state.playing = false; knopTekst(); }
  function kiesMoment(d) {
    const liep = state.playing; if (liep) stopTape();
    select(d, false);
    if (liep && state.sound && d.tracks && d.tracks[0]) SOR.play({ ...d.tracks[0] });
  }
  playBtn.dataset.play = playBtn.innerHTML;
  // weg van deze pagina (de site wisselt pagina's zonder herladen): het afspelen van de geschiedenis stopt
  document.addEventListener('sor:leave', () => { if (state.playing) stopTape(); });
  // zet iemand de speler zelf op pauze of klikt hem weg, dan stopt ook het geluid van de afspeelknop
  document.addEventListener('sor:userpause', () => { if (!state.sound) return; state.sound = false; const b = document.getElementById('k-sound'); if (b) b.checked = false; });
  playBtn.addEventListener('click', () => {
    if (state.playing) { stopTape(); return; }
    if (state.path) { sel.value = ''; setPath(null); }
    clearSelection();
    if (state.year >= YMAX) state.year = Math.max(YMIN, xToYear(tx(d3.min(G.filter(g => state.fams.has(g.family)), g => g.year) ?? YMIN) - 24));
    state.playing = true; follow(true);
    playBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zM14 5h3v14h-3z"/></svg>Pauze';
    const tick = () => {
      const prev = state.year; state.year = Math.min(YMAX, xToYear(tx(prev) + 12)); syncYear(); applyVisibility();
      const born = G.filter(g => g.year > prev && g.year <= state.year && state.fams.has(g.family));
      if (born.length) {
        nodeSel.filter(d => born.includes(d)).classed('pulse', false).each(function () { void this.getBBox(); }).classed('pulse', true);
        const now = Date.now();
        if (state.sound && now - lastSound > 5000 / Math.min(speed, 2)) { const g = born.find(x => x.tracks && x.tracks[0]); if (g) { SOR.play({ ...g.tracks[0] }); lastSound = now; } }
      }
      if (state.year >= YMAX) { state.year = YMAX; syncYear(); stopTape(); return; }
      lastTick = performance.now(); timer = setTimeout(tick, 220 / speed);
    };
    tick();
  });

  // ---------- Uitleg bij eerste bezoek ----------
  const intro = $('.k-intro');
  let seen = false; try { seen = localStorage.getItem('hitfabriek-intro') === '1'; } catch (e) {}
  if (!seen && !location.hash && !location.search.includes('nointro')) intro.hidden = false;
  document.querySelectorAll('[data-close-intro]').forEach(b => b.addEventListener('click', () => { intro.hidden = true; try { localStorage.setItem('hitfabriek-intro', '1'); } catch (e) {} }));
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
    const tm = h.match(/^tech\/(.+)$/); if (tm) { if (tById.has(tm[1])) selectTech(tById.get(tm[1]), true); else setMode('tech'); return; }
    if (byId.has(h)) select(byId.get(h), true);
  }
  fromHash();
  window.addEventListener('hashchange', fromHash);
  const qm = new URLSearchParams(location.search).get('mode'); if (qm === 'world' || qm === 'tech') setMode(qm);
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, select')) return;
    if (e.key === 'Escape') { intro.hidden = true; clearSelection(); }
    if (state.path && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) goStep(state.step + (e.key === 'ArrowRight' ? 1 : -1), true);
  });
})();
