/* Navigatie zonder herladen: links binnen de site wisselen alleen de inhoud, zodat de speler doorspeelt. */
(function () {
  if (window.SOR_NAV) return;
  if (!window.fetch || !window.DOMParser || !history.pushState) return;
  window.SOR_NAV = true;

  // Luisteraars die paginascripts op window en document zetten, bijhouden en bij een paginawissel weer weghalen.
  const tracked = [];
  let tracking = false;
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
    target.addEventListener = function (type, fn, opts) { if (tracking) tracked.push([target, type, fn, opts, remove]); return add(type, fn, opts); };
  }
  function cleanup() {
    document.dispatchEvent(new Event('sor:leave')); // eerst de pagina zelf laten opruimen (bv. voorlezen stoppen)
    tracked.splice(0).forEach(([t, type, fn, opts, remove]) => remove(type, fn, opts));
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
  }

  const SKIP_EXT = /\.(pdf|mp3|m4a|wav|zip|json|png|jpe?g|svg|webp)$/i;
  const ALWAYS = /\/assets\/(player|nav)\.js$/;       // eenmalig geladen, nooit opnieuw
  const loaded = new Set([...document.scripts].filter(s => s.src).map(s => s.src));

  function sameSite(a) {
    if (!a || a.target && a.target !== '_self' || a.hasAttribute('download')) return false;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || SKIP_EXT.test(u.pathname)) return false;
    if (u.pathname === location.pathname && u.search === location.search && u.hash) return false; // anker op dezelfde pagina
    return u;
  }

  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href]'); const u = sameSite(a); if (!u) return;
    e.preventDefault();
    go(u.href, true);
  });
  let shown = location.pathname + location.search;
  window.addEventListener('popstate', () => { if (location.pathname + location.search === shown) return; go(location.href, false); });
  history.replaceState(Object.assign({}, history.state, { sor: true, y: scrollY }), '');

  let busy = 0;
  async function go(url, push) {
    const my = ++busy;
    document.documentElement.classList.add('sor-loading');
    let html;
    try { const r = await fetch(url); if (!r.ok) throw 0; html = await r.text(); }
    catch (e) { location.href = url; return; }
    if (my !== busy) return;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (push) { history.replaceState(Object.assign({}, history.state, { sor: true, y: scrollY }), ''); history.pushState({ sor: true, y: 0 }, '', url); }
    shown = location.pathname + location.search;
    cleanup();
    try { await swap(doc); } catch (e) { console.error(e); location.reload(); return; }
    document.documentElement.classList.remove('sor-loading');
    document.dispatchEvent(new Event('sor:ready'));
    const hash = new URL(url).hash;
    const target = hash && document.getElementById(decodeURIComponent(hash.slice(1)));
    if (target) target.scrollIntoView(); else if (!push && history.state && history.state.y) scrollTo(0, history.state.y); else scrollTo(0, 0);
    if (hash && !target) window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  async function swap(doc) {
    document.title = doc.title;
    // meta-tags (o.a. sor-root, dat per map verschilt)
    doc.head.querySelectorAll('meta[name]').forEach(m => { const cur = document.head.querySelector('meta[name="' + m.name + '"]'); if (cur) cur.content = m.content; else document.head.appendChild(m.cloneNode()); });
    // stijlen: wat de nieuwe pagina niet heeft weg, wat nieuw is erbij (en wachten tot het geladen is)
    const key = el => el.tagName === 'LINK' ? 'L:' + new URL(el.getAttribute('href'), location.href).href : 'S:' + el.textContent;
    const want = [...doc.head.querySelectorAll('link[rel="stylesheet"], style')];
    const wantKeys = new Set(want.map(key));
    const have = [...document.head.querySelectorAll('link[rel="stylesheet"], style')].filter(el => !el.hasAttribute('data-persist'));
    const haveKeys = new Set(have.map(key));
    const waits = [];
    want.forEach(el => { if (haveKeys.has(key(el))) return; const n = el.tagName === 'LINK' ? Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL(el.getAttribute('href'), location.href).href }) : Object.assign(document.createElement('style'), { textContent: el.textContent }); if (n.tagName === 'LINK') waits.push(new Promise(r => { n.onload = n.onerror = r; })); document.head.appendChild(n); });
    await Promise.race([Promise.all(waits), new Promise(r => setTimeout(r, 1500))]);
    have.forEach(el => { if (!wantKeys.has(key(el))) el.remove(); });
    // body: alles behalve de vaste onderdelen (speler) vervangen
    const body = document.body;
    [...body.attributes].forEach(a => body.removeAttribute(a.name));
    [...doc.body.attributes].forEach(a => body.setAttribute(a.name, a.value));
    const persist = [...body.children].filter(el => el.hasAttribute('data-persist'));
    [...body.childNodes].forEach(n => { if (!persist.includes(n)) n.remove(); });
    const frag = document.createDocumentFragment();
    [...doc.body.childNodes].forEach(n => frag.appendChild(document.adoptNode(n)));
    body.insertBefore(frag, persist[0] || null);
    // scripts uit de kop die nog niet geladen zijn (bv. d3 voor de genrekaart), daarna die uit de body, op volgorde
    for (const s of doc.head.querySelectorAll('script[src]')) await run(s, null);
    for (const s of [...body.querySelectorAll('script')]) await run(s, s);
  }

  function run(old, inPlace) {
    const type = (old.getAttribute('type') || '').trim();
    if (type && !/javascript|module/i.test(type)) return; // JSON-gegevens blijven gewoon staan
    const src = old.getAttribute('src') ? new URL(old.getAttribute('src'), location.href).href : '';
    if (src && (ALWAYS.test(new URL(src).pathname) || (loaded.has(src) && !/\/assets\//.test(new URL(src).pathname)))) { if (inPlace) inPlace.remove(); return; }
    return new Promise(resolve => {
      const s = document.createElement('script');
      [...old.attributes].forEach(a => s.setAttribute(a.name, a.value));
      if (src) { s.src = src; s.async = false; s.onload = s.onerror = () => { loaded.add(src); resolve(); }; }
      else s.textContent = old.textContent;
      if (inPlace) inPlace.replaceWith(s); else document.head.appendChild(s);
      if (!src) resolve();
    });
  }

  // Easter eggs: vijf keer snel klikken.
  // - op het logo: wisselt tussen School of Rock en De Droomfabriek (sorock.nl/film/); vanuit een verborgen deel terug naar School of Rock
  // - op de cassette van Mixtape 5 (Jazz Festival): opent Blue Hour (sorock.nl/jazz/)
  // De teller hoort bij het soort knop (logo of cassette), niet bij het element: een klik op het logo laadt de pagina
  // opnieuw, en dan is het logo een nieuw element. In sessionStorage, zodat de teller ook een volledige herlaadbeurt overleeft.
  const eggKey = 'sor-egg';
  const eggGet = () => { try { return JSON.parse(sessionStorage.getItem(eggKey) || '{}'); } catch (x) { return {}; } };
  const eggSet = v => { try { sessionStorage.setItem(eggKey, JSON.stringify(v)); } catch (x) {} };
  document.addEventListener('click', e => {
    const b = e.target.closest('.sitenav .brand') || e.target.closest('body[data-mixtape="5"] .opener.cover .cassette');
    if (!b) return;
    const now = Date.now(), kind = b.classList.contains('cassette') ? 'cassette' : 'logo';
    const st = eggGet(); let egg = st.kind === kind ? (st.t || []) : [];
    egg = egg.filter(t => now - t < 3000); egg.push(now);
    if (egg.length < 5) { eggSet({ kind, t: egg }); return; }
    eggSet({}); e.preventDefault(); e.stopImmediatePropagation();
    const img = b.tagName === 'IMG' ? b : b.querySelector('img'); if (img && img.animate) img.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { duration: 600, easing: 'ease-in-out' });
    const root = (document.querySelector('meta[name="sor-root"]') || {}).content || '.';
    const hidden = /\/(film|jazz)\//.test(location.pathname);
    let target;
    if (b.classList.contains('cassette')) target = new URL(root + '/jazz/index.html', location.href);
    else if (hidden) target = new URL(location.pathname.replace(/\/(film|jazz)\/.*$/, '/index.html'), location.href);
    else target = new URL(root + '/film/index.html', location.href);
    setTimeout(() => go(target.href, true), 500);
  }, true);

  // Kaarten op volledig scherm: knop boven de zoomknoppen. Verbergt het sitemenu, de familieknoppen en de tijdbalk,
  // en vraagt de browser om echt volledig scherm (waar dat kan; op de iPhone blijft het bij het verbergen van de menu's).
  const fullCss = document.createElement('style');
  fullCss.setAttribute('data-persist', '');
  fullCss.textContent = 'html.k-full .sitenav{display:none}html.k-full .k-app{inset:0;grid-template-rows:auto minmax(0,1fr)}html.k-full .k-main{grid-row:2}html.k-full .k-fams,html.k-full .k-time,html.k-full .k-title p{display:none}' +
    'html.k-full .k-list{inset:0}.k-zoom .k-full-btn{font-size:16px}';
  document.head.appendChild(fullCss);
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  function setFull(on) {
    document.documentElement.classList.toggle('k-full', on);
    const b = document.querySelector('.k-full-btn');
    if (b) { b.textContent = on ? '✕' : '⛶'; b.setAttribute('aria-label', on ? 'Volledig scherm sluiten' : 'Volledig scherm'); b.title = b.getAttribute('aria-label'); }
    try {
      if (on && !fsEl()) { const r = document.documentElement; (r.requestFullscreen || r.webkitRequestFullscreen || function () {}).call(r); }
      if (!on && fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } catch (x) {}
    setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
  }
  function kaartFull() {
    const z = document.querySelector('.k-zoom');
    if (!z) { if (document.documentElement.classList.contains('k-full')) setFull(false); return; }
    if (z.querySelector('.k-full-btn')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'k-full-btn';
    b.addEventListener('click', () => setFull(!document.documentElement.classList.contains('k-full')));
    z.insertBefore(b, z.firstChild);
    setFull(document.documentElement.classList.contains('k-full'));
  }
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(t => document.addEventListener(t, () => { if (!fsEl() && document.documentElement.classList.contains('k-full')) setFull(false); }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.documentElement.classList.contains('k-full') && !fsEl()) setFull(false); });
  document.addEventListener('sor:ready', kaartFull);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kaartFull); else kaartFull();

  // Zoeken op de kaarten: een datalist met honderden namen laat het typen haperen. Daarom een eigen lijst met hooguit
  // tien treffers. De namen komen uit de bestaande datalist (die de kaart zelf vult); kiezen zet de naam in het veld
  // en stuurt 'change', zodat de zoeklogica van de kaart zelf blijft werken.
  const zCss = document.createElement('style');
  zCss.setAttribute('data-persist', '');
  zCss.textContent = '.k-sugg{position:absolute;top:100%;right:0;z-index:60;min-width:260px;max-width:380px;margin:4px 0 0;padding:4px 0;list-style:none;background:#232120;border:1px solid #3A3833;border-radius:4px;box-shadow:0 8px 24px rgba(0,0,0,.4);font:14px/1.3 Inter,sans-serif;text-transform:none;letter-spacing:0}' +
    '.k-sugg li{padding:7px 12px;color:#EDE9E1;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.k-sugg li small{color:#9C978D;margin-right:6px}.k-sugg li.on,.k-sugg li:hover{background:#3A3833}';
  document.head.appendChild(zCss);
  const zSlug = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' en ').replace(/[^a-z0-9]+/g, ' ').trim();
  function kaartZoek() {
    const inp = document.querySelector('.k-app input[list]');
    if (!inp || inp.dataset.zoek) return;
    const dl = document.getElementById(inp.getAttribute('list'));
    if (!dl) return;
    inp.dataset.zoek = '1'; inp.removeAttribute('list');
    const box = document.createElement('ul'); box.className = 'k-sugg'; box.hidden = true; box.setAttribute('role', 'listbox');
    inp.parentElement.style.position = 'relative'; inp.parentElement.appendChild(box);
    let hits = [], on = -1, t = 0;
    const split = v => { const m = v.match(/^(Film|Band|Album):\s*(.*)$/); return m ? [m[1].toLowerCase(), m[2]] : ['', v]; };
    function show() {
      const q = zSlug(inp.value); if (!q) { box.hidden = true; hits = []; return; }
      const qw = q.split(' ');
      const scored = [];
      for (const o of dl.options) {
        const [kind, name] = split(o.value), s = zSlug(name);
        let r = s.startsWith(q) ? 0 : (' ' + s).includes(' ' + q) ? 1 : qw.every(w => (' ' + s).includes(' ' + w)) ? 2 : 9;
        if (r < 9) scored.push([r + (kind ? 0.5 : 0), name.length, o.value, kind, name]);
      }
      hits = scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, 10); on = -1;
      box.innerHTML = hits.map((h, i) => `<li role="option" data-i="${i}">${h[3] ? `<small>${h[3]}</small>` : ''}${h[4].replace(/</g, '&lt;')}</li>`).join('');
      box.hidden = !hits.length;
    }
    function pick(h) { inp.value = h[2]; box.hidden = true; hits = []; inp.dispatchEvent(new Event('change', { bubbles: true })); inp.blur(); }
    inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(show, 90); });
    inp.addEventListener('keydown', e => {
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && hits.length) {
        e.preventDefault(); on = (on + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
        box.querySelectorAll('li').forEach((li, i) => li.classList.toggle('on', i === on));
      } else if (e.key === 'Enter' && on >= 0 && hits[on]) { e.preventDefault(); pick(hits[on]); }
      else if (e.key === 'Enter' || e.key === 'Escape') box.hidden = true;
    });
    box.addEventListener('mousedown', e => { const li = e.target.closest('li'); if (li) { e.preventDefault(); pick(hits[+li.dataset.i]); } });
    inp.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
  }
  document.addEventListener('sor:ready', kaartZoek);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kaartZoek); else kaartZoek();

  // Vanaf hier hoort elke luisteraar op window/document bij de pagina (de eigen luisteraars hierboven en die van de speler niet).
  tracking = true;

  const css = document.createElement('style');
  css.setAttribute('data-persist', '');
  css.textContent = 'html.sor-loading{cursor:progress}html.sor-loading body>*:not([data-persist]){opacity:.6;transition:opacity .2s .15s}';
  document.head.appendChild(css);
})();
