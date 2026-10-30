/* Gedeelde speler: fragmenten en het luisterboek, met een balk onderin het scherm die blijft staan bij navigeren. */
(function () {
  if (window.SOR) return; // al geladen: de speler blijft staan bij navigeren binnen de site
  const SCRIPT_SRC = (document.currentScript && document.currentScript.src) || new URL('/assets/player.js', location.href).href;
  const root = () => document.querySelector('meta[name="sor-root"]')?.content || '.';
  const abs = p => new URL(root() + '/' + p, location.href).href;
  const slug = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' en ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const norm = s => slug(s).replace(/-/g, '');
  const store = { get(k) { try { return JSON.parse(localStorage.getItem('sor-' + k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem('sor-' + k, JSON.stringify(v)); } catch (e) {} } };
  const fmt = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = String(s % 60).padStart(2, '0'); return h ? h + ':' + String(m).padStart(2, '0') + ':' + x : m + ':' + x; };

  const audio = new Audio();
  audio.preload = 'none';
  let current = null;
  const listeners = new Set();
  const RATES = [1, 1.25, 1.5, 0.8];

  const icon = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const bar = document.createElement('div');
  bar.className = 'sor-player';
  bar.setAttribute('data-persist', '');
  bar.hidden = true;
  bar.innerHTML = `
    <button class="sp-toggle" type="button" aria-label="Afspelen of pauzeren"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="i-pause" d="M7 5h3v14H7zM14 5h3v14h-3z"/><path class="i-play" d="M8 5l11 7-11 7z"/></svg></button>
    <img class="sp-cover" alt="" hidden onerror="this.hidden=true">
    <div class="sp-meta"><span class="sp-artist"></span><span class="sp-title"></span><div class="sp-bar" role="slider" aria-label="Positie" tabindex="-1"><i></i></div><span class="sp-time mono"></span></div>
    <a class="sp-store" target="_blank" rel="noopener" hidden></a>
    <span class="sp-book">
      <button type="button" class="sp-back" aria-label="15 seconden terug" title="15 s terug">−15</button>
      <button type="button" class="sp-fwd" aria-label="30 seconden vooruit" title="30 s vooruit">+30</button>
      <button type="button" class="sp-rate" aria-label="Tempo" title="Tempo">1×</button>
      <button type="button" class="sp-next" aria-label="Volgend hoofdstuk" title="Volgend hoofdstuk">${icon('M6 18l8.5-6L6 6v12zM16 6h2v12h-2z')}</button>
    </span>
    <span class="sp-tag mono">fragment · 30 s</span>
    <button class="sp-close" type="button" aria-label="Sluit speler">×</button>`;
  const css = document.createElement('style');
  css.setAttribute('data-persist', '');
  css.textContent = `
    .sor-player{position:fixed;left:50%;bottom:calc(14px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:80;width:min(560px,calc(100% - 24px));display:flex;align-items:center;gap:12px;padding:8px 10px 8px 8px;background:#1C1B19;color:#fff;border-radius:6px;box-shadow:0 10px 30px rgba(0,0,0,.35);border-left:5px solid #F2D500;font-family:Inter,Segoe UI,Arial,sans-serif}
    .sor-player[hidden]{display:none}
    .sor-player .sp-store{flex:none;display:block;line-height:0}.sor-player .sp-store[hidden]{display:none}.sor-player .sp-store{color:#000}.sor-player .sp-store svg{width:20px;height:20px;fill:currentColor;display:block}
    .kp-track{position:relative}.kp-track:has(.kp-store){padding-right:32px}.kp-store{position:absolute;right:8px;bottom:8px;color:#1C1B19;line-height:0}.kp-store svg{width:18px;height:18px;fill:currentColor;display:block}.kp-store:hover{opacity:.7}
    .sor-player .sp-toggle{flex:none;width:40px;height:40px;border-radius:50%;border:0;background:#D63A31;color:#fff;display:grid;place-items:center;cursor:pointer}
    .sor-player .sp-toggle svg{width:18px;height:18px;fill:currentColor}
    .sor-player .sp-toggle .i-play{display:none}.sor-player.paused .i-play{display:block}.sor-player.paused .i-pause{display:none}
    .sor-player .sp-cover{width:40px;height:40px;border-radius:2px;object-fit:cover;background:#2A2825}
    .sor-player .sp-cover[hidden]{display:none}
    .sor-player .sp-meta{flex:1;min-width:0;display:grid;gap:2px;font-size:13px;line-height:1.25}
    .sor-player .sp-artist{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sor-player .sp-title{color:#CFCAC0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sor-player .sp-bar{height:3px;background:#3A3833;border-radius:2px;margin-top:4px;overflow:hidden}.sor-player .sp-bar i{display:block;height:100%;width:0;background:#F2D500}
    .sor-player .sp-time{display:none;font:10px/1 "Space Mono",monospace;color:#9C978D;letter-spacing:.04em}
    .sor-player .sp-tag{font:10px/1 "Space Mono",monospace;letter-spacing:.06em;text-transform:uppercase;color:#9C978D;white-space:nowrap}
    .sor-player .sp-close{flex:none;border:0;background:none;color:#9C978D;font-size:22px;cursor:pointer;padding:0 4px}
    .sor-player .sp-book{display:none;gap:4px;align-items:center}
    .sor-player .sp-book button{border:1px solid #3A3833;background:none;color:#E8E3D8;border-radius:3px;height:28px;min-width:34px;padding:0 6px;font:11px/1 "Space Mono",monospace;cursor:pointer;display:grid;place-items:center}
    .sor-player .sp-book button:hover{border-color:#F2D500;color:#F2D500}
    .sor-player .sp-book svg{width:14px;height:14px;fill:currentColor}
    .sor-player.book{width:min(720px,calc(100% - 24px))}
    .sor-player.book .sp-book{display:flex}.sor-player.book .sp-tag{display:none}.sor-player.book .sp-time{display:block}
    .sor-player.book .sp-bar{height:6px;cursor:pointer;margin-top:5px}
    @media (max-width:520px){.sor-player .sp-tag{display:none}.sor-player.book{flex-wrap:wrap}.sor-player.book .sp-book{order:5;width:100%;justify-content:center;padding-top:4px}}
    .sor-play{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:50%;border:0;background:#D63A31;color:#fff;cursor:pointer;flex:none;vertical-align:middle}
    .sor-play svg{width:12px;height:12px;fill:currentColor}
    .sor-play.on{background:#1C1B19;color:#F2D500}`;
  document.head.appendChild(css);
  if (document.body) document.body.appendChild(bar); else document.addEventListener('DOMContentLoaded', () => document.body.appendChild(bar));

  const $ = s => bar.querySelector(s);
  function paint() {
    bar.classList.toggle('paused', audio.paused);
    listeners.forEach(fn => fn(current, !audio.paused));
  }
  function progress() {
    $('.sp-bar i').style.width = (audio.duration ? (100 * audio.currentTime / audio.duration) : 0) + '%';
    if (current && current.book) $('.sp-time').textContent = fmt(audio.currentTime) + ' / ' + fmt(audio.duration || current.duration);
  }
  // reeksen: School of Rock (pop) en De Droomfabriek (film), elk met eigen hoofdstukken en eigen bewaarde positie
  const SETS = { pop: { data: 'data/luisterboek.json', key: 'boek', label: 'Luisterboek · Mixtape ', album: 'School of Rock · luisterboek', cover: 'assets/cassette.png' }, film: { data: 'film/data/luisterboek.json', key: 'boek-film', label: 'De Droomfabriek · Filmrol ', album: 'De Droomfabriek · luisterboek', cover: 'film/assets/icon.svg' }, jazz: { data: 'jazz/data/luisterboek.json', key: 'boek-jazz', label: 'After Hours · Sessie ', album: 'After Hours · luisterboek', cover: 'jazz/assets/icon.svg' } };
  const setOf = tr => SETS[(tr && tr.bookSet) || 'pop'];
  // luisterboek: positie bewaren, zodat je later verder kunt luisteren
  let lastSave = 0;
  function savePos(force) {
    if (!current || !current.book || !isFinite(audio.currentTime)) return;
    const now = Date.now(); if (!force && now - lastSave < 4000) return; lastSave = now;
    store.set(setOf(current).key, { n: current.book, t: Math.floor(audio.currentTime), at: now });
  }
  audio.addEventListener('play', paint);
  audio.addEventListener('pause', () => { savePos(true); paint(); });
  // Automix voor fragmenten (niet het luisterboek): 2,5 seconde zacht in, 4 seconde zacht uit,
  // en bij een wissel gaat het vorige fragment eerst in 0,25 seconde zacht weg (een harde overgang gaf een tikje).
  const FADE = 4, FADE_IN = 2.5, XFADE = 3;
  const ease = x => Math.sin(Math.max(0, Math.min(1, x)) * Math.PI / 2); // vloeiende curve (gelijke luidheid bij overlap)
  let uitfaden = false, volgende = null;
  function fade() {
    if (uitfaden) return;
    const frag = current && !current.book && isFinite(audio.duration) && audio.duration > FADE * 2;
    const rest = frag ? audio.duration - audio.currentTime : Infinity;
    const vin = current && !current.book ? ease(audio.currentTime / FADE_IN) : 1;
    const v = Math.min(vin, rest < FADE ? ease(rest / FADE) : 1);
    if (Math.abs(audio.volume - v) > .01) audio.volume = v;
  }
  let tail = null;
  // bij een wissel van fragment: het oude nummer in 0,25 s zacht weg, dan pas het nieuwe (zonder tik)
  function zachtUit(klaar) {
    if (tail) { tail.pause(); tail = null; }
    const v0 = audio.volume, t0 = performance.now(); uitfaden = true;
    const iv = setInterval(() => { const k = Math.min(1, (performance.now() - t0) / 250); audio.volume = Math.max(0, v0 * (1 - ease(k))); if (k >= 1) { clearInterval(iv); audio.pause(); uitfaden = false; klaar(); } }, 15);
  }
  function fadeLoop() { fade(); if (!audio.paused) requestAnimationFrame(fadeLoop); }
  audio.addEventListener('play', () => requestAnimationFrame(fadeLoop));
  audio.addEventListener('timeupdate', () => { fade(); progress(); savePos(false); });
  audio.addEventListener('loadedmetadata', progress);
  audio.addEventListener('ended', () => {
    if (current && current.book) { const n = current.book, set = current.bookSet || 'pop', max = current.bookMax || 13; if (n < max) { SOR.playBook(n + 1, 0, set); return; } store.set(setOf(current).key, { n: 1, t: 0, at: Date.now() }); }
    paint(); listeners.forEach(fn => fn(current, false, true));
  });
  function seekBy(s) { if (!audio.duration) return; audio.currentTime = Math.min(audio.duration - 1, Math.max(0, audio.currentTime + s)); progress(); savePos(true); }
  bar.addEventListener('click', e => {
    if (e.target.closest('.sp-toggle')) { if (audio.paused) audio.play(); else { audio.pause(); document.dispatchEvent(new Event('sor:userpause')); } }
    if (e.target.closest('.sp-close')) { document.dispatchEvent(new Event('sor:userpause')); volgende = null; audio.pause(); if (tail) { tail.pause(); tail = null; } bar.hidden = true; }
    if (e.target.closest('.sp-back')) seekBy(-15);
    if (e.target.closest('.sp-fwd')) seekBy(30);
    if (e.target.closest('.sp-next') && current && current.book && current.book < (current.bookMax || 13)) SOR.playBook(current.book + 1, 0, current.bookSet || 'pop');
    if (e.target.closest('.sp-rate')) { const r = RATES[(RATES.indexOf(audio.playbackRate) + 1) % RATES.length] || 1; audio.playbackRate = r; store.set('tempo', r); $('.sp-rate').textContent = String(r).replace('.', ',') + '×'; }
    const sb = e.target.closest('.sp-bar');
    if (sb && current && current.book && audio.duration) { const r = sb.getBoundingClientRect(); audio.currentTime = audio.duration * Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); progress(); savePos(true); }
  });
  window.addEventListener('pagehide', () => savePos(true));
  // Pagina's melden zich af bij het wisselen: hun luisteraars op de speler mogen weg.
  document.addEventListener('sor:leave', () => listeners.clear());

  // bediening op het vergrendelscherm van telefoons
  function mediaSession(track) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: track.title || '', artist: track.artist || '', album: track.book ? setOf(track).album : 'School of Rock', artwork: track.cover ? [{ src: track.cover, sizes: '512x512' }] : [] });
      const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) {} };
      h('play', () => audio.play()); h('pause', () => { audio.pause(); document.dispatchEvent(new Event('sor:userpause')); });
      h('seekbackward', track.book ? () => seekBy(-15) : null); h('seekforward', track.book ? () => seekBy(30) : null);
      h('nexttrack', track.book && track.book < (track.bookMax || 13) ? () => SOR.playBook(track.book + 1, 0, track.bookSet || 'pop') : null);
      h('previoustrack', track.book && track.book > 1 ? () => SOR.playBook(track.book - 1, 0, track.bookSet || 'pop') : null);
    } catch (e) {}
  }

  // Geintje op de kaarten en tijdlijnen: wie zelf op Never Gonna Give You Up klikt, wordt gerickrolld.
  // Niet bij het afspelen van de geschiedenis (geen klik van de bezoeker) en niet in de hoofdstukken.
  // play() onthoudt het aangeklikte nummer, _start() laat Rick pas zien als het echt begint (na het uitfaden van het vorige).
  let rick = null, rickTrack = null;
  function rickWeg() { if (rick) { rick.remove(); rick = null; } }
  function rickKlik(track) {
    const klik = !navigator.userActivation || navigator.userActivation.isActive;
    rickTrack = !track.book && klik && /never gonna give you up/i.test(track.title || '') && document.querySelector('.k-app') ? track : null;
  }
  function rickroll(track) {
    if (track !== rickTrack) { rickWeg(); return; }
    rickTrack = null;
    rickWeg();
    rick = document.createElement('div');
    rick.setAttribute('role', 'img'); rick.setAttribute('aria-label', 'Rick Astley danst: je bent gerickrolld');
    rick.style.cssText = 'position:fixed;inset:0;z-index:9999;display:grid;place-items:center;pointer-events:none';
    rick.innerHTML = '<img src="https://i.giphy.com/media/Vuw9m5wXviFIQ/giphy.gif" alt="" style="width:min(70vw,420px);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.6);pointer-events:auto;cursor:pointer" title="Klik om te sluiten">';
    rick.querySelector('img').addEventListener('click', rickWeg);
    rick.querySelector('img').onerror = rickWeg;
    document.body.appendChild(rick);
  }
  // een nieuw nummer laden geeft ook een pause-event (met tijd 0): alleen echt pauzeren haalt Rick weg
  audio.addEventListener('pause', () => { if (audio.currentTime > 0) rickWeg(); });
  audio.addEventListener('ended', rickWeg);
  document.addEventListener('sor:leave', rickWeg);

  const chapters = {};
  const book = (set = 'pop') => chapters[set] || (chapters[set] = fetch(abs(SETS[set].data)).then(r => r.json()).catch(() => { delete chapters[set]; return []; }));

  // Officieel Apple Music-icoon (Apple marketing toolbox, app-icon-music zwart/wit), inline zodat het meteen staat.
  // Apple vraagt bij de iTunes-fragmenten om een link naar de winkel: zwart in het paneel, wit in de spelerbalk.
  const APPLE_ICON = '<svg viewBox="0 0 361 361" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M359.98,99.71c-0.02-3.62-0.06-7.24-0.16-10.86c-0.21-7.89-0.68-15.84-2.08-23.64 c-1.42-7.92-3.75-15.29-7.41-22.49c-3.6-7.07-8.3-13.53-13.91-19.14c-5.61-5.61-12.08-10.31-19.15-13.91 c-7.19-3.66-14.56-5.98-22.47-7.41c-7.8-1.4-15.76-1.87-23.65-2.08c-3.62-0.1-7.24-0.14-10.86-0.16C255.99,0,251.69,0,247.39,0 H112.61c-4.3,0-8.6,0-12.9,0.02c-3.62,0.02-7.24,0.06-10.86,0.16C80.96,0.4,73,0.86,65.2,2.27c-7.92,1.42-15.28,3.75-22.47,7.41 c-7.07,3.6-13.54,8.3-19.15,13.91c-5.61,5.61-10.31,12.07-13.91,19.14c-3.66,7.2-5.99,14.57-7.41,22.49 c-1.4,7.8-1.87,15.76-2.08,23.64c-0.1,3.62-0.14,7.24-0.16,10.86C0,104.01,0,108.31,0,112.61v134.77c0,4.3,0,8.6,0.02,12.9 c0.02,3.62,0.06,7.24,0.16,10.86c0.21,7.89,0.68,15.84,2.08,23.64c1.42,7.92,3.75,15.29,7.41,22.49 c3.6,7.07,8.3,13.53,13.91,19.14c5.61,5.61,12.08,10.31,19.15,13.91c7.19,3.66,14.56,5.98,22.47,7.41 c7.8,1.4,15.76,1.87,23.65,2.08c3.62,0.1,7.24,0.14,10.86,0.16c4.3,0.03,8.6,0.02,12.9,0.02h134.77c4.3,0,8.6,0,12.9-0.02 c3.62-0.02,7.24-0.06,10.86-0.16c7.89-0.21,15.85-0.68,23.65-2.08c7.92-1.42,15.28-3.74,22.47-7.41 c7.07-3.6,13.54-8.3,19.15-13.91c5.61-5.61,10.31-12.07,13.91-19.14c3.66-7.2,5.99-14.57,7.41-22.49 c1.4-7.8,1.87-15.76,2.08-23.64c0.1-3.62,0.14-7.24,0.16-10.86c0.03-4.3,0.02-8.6,0.02-12.9V112.61 C360,108.31,360,104.01,359.98,99.71z M263.54,234.26c0,4.56-0.04,8.7-1,13.26c-0.93,4.43-2.63,8.6-5.24,12.35 c-2.61,3.74-5.95,6.81-9.85,9.11c-3.95,2.33-8.08,3.66-12.5,4.55c-8.3,1.67-13.97,2.05-19.31,0.98c-5.14-1.03-9.5-3.4-12.99-6.6 c-5.17-4.74-8.39-11.14-9.09-17.82c-0.82-7.84,1.79-16.21,7.67-22.38c2.97-3.11,6.7-5.57,11.68-7.51 c5.21-2.02,10.96-3.23,19.8-5.01c2.33-0.47,4.66-0.94,6.99-1.41c3.06-0.62,5.69-1.4,7.81-3.99c2.13-2.61,2.17-5.78,2.17-8.92 l0-79.29c0-6.07-2.72-7.72-8.52-6.61c-4.14,0.81-93.09,18.75-93.09,18.75c-5.02,1.21-6.78,2.85-6.78,9.08l0,116.15 c0,4.56-0.24,8.7-1.19,13.26c-0.93,4.43-2.63,8.6-5.24,12.35c-2.61,3.74-5.95,6.81-9.85,9.11c-3.95,2.33-8.08,3.72-12.5,4.61 c-8.3,1.67-13.97,2.05-19.31,0.98c-5.14-1.03-9.5-3.47-12.99-6.66c-5.17-4.74-8.17-11.14-8.88-17.82 c-0.82-7.84,1.57-16.21,7.46-22.38c2.97-3.11,6.7-5.57,11.68-7.51c5.21-2.02,10.96-3.23,19.8-5.01c2.33-0.47,4.66-0.94,6.99-1.41 c3.06-0.62,5.69-1.4,7.81-3.99c2.12-2.59,2.37-5.64,2.37-8.76c0-24.6,0-133.92,0-133.92c0-1.8,0.15-3.02,0.24-3.62 c0.43-2.82,1.56-5.24,3.6-6.95c1.7-1.42,3.88-2.41,6.67-3l0.04-0.01l107-21.59c0.93-0.19,8.66-1.56,9.53-1.64 c5.78-0.5,9.03,3.3,9.03,9.46V234.26z"/></svg>';

  // Apple Music-links van alle fragmenten op de site (data/apple.json, gemaakt door applelinks-site.ts):
  // sleutel = bestandsnaam van het fragment, waarde [trackId, albumId] of [trackId, albumId, nieuw fragmentadres] als Apple het verplaatste.
  let APPLE = null;
  const appleKlaar = fetch(new URL('../data/apple.json', SCRIPT_SRC).href).then(r => r.ok ? r.json() : {}).catch(() => ({})).then(m => { APPLE = m; return m; });
  const appleVan = t => t && t.audio && APPLE ? APPLE[t.audio.split('/').pop().replace(/\.[a-z0-9]+$/i, '')] : null;
  // Engelse pagina's (meta sor-lang = en) verwijzen naar de Britse Apple Music-winkel
  const landWinkel = u => (document.querySelector('meta[name="sor-lang"]') || {}).content === 'en' ? u.replace('music.apple.com/nl/', 'music.apple.com/gb/') : u;
  const storeOf = t => { if (!t || t.book) return ''; if (t.store) return landWinkel(t.store); const v = appleVan(t); return v ? landWinkel(`https://music.apple.com/nl/album/${v[1]}?i=${v[0]}`) : ''; };
  function toonStore(track) {
    const st = $('.sp-store'), url = storeOf(track);
    if (url) { st.href = url; st.hidden = false; if (!st.firstChild) st.innerHTML = APPLE_ICON.replace('<path', '<rect x="60" y="40" width="240" height="280" fill="#fff"/><path'); st.setAttribute('aria-label', 'Luister naar ' + (track.title || '') + ' op Apple Music'); }
    else { st.removeAttribute('href'); st.hidden = true; }
  }

  const SOR = window.SOR = {
    slug, norm, fmt, get root() { return root(); }, media: audio,
    storeOf, appleKlaar,
    // hoezen van Apple klein ophalen (200×200 in plaats van 600×600): in de panelen staan ze op ±50 pixels
    thumb: (u, n = 200) => (u || '').replace(/\/\d+x\d+bb\.(jpe?g|png|webp)$/, `/${n}x${n}bb.jpg`),
    play(track, startAt) {
      if (!track || !track.audio) return;
      rickKlik(track);
      if (current && current.audio === track.audio) { if (audio.paused || bar.hidden) { bar.hidden = false; audio.play().catch(() => paint()); rickroll(track); } else audio.pause(); return; }
      volgende = [track, startAt];
      if (uitfaden) return; // de lopende uitfade start straks het laatst gekozen nummer
      if (current && !current.book && !audio.paused) { zachtUit(() => { const v = volgende; volgende = null; if (v) SOR._start(v[0], v[1]); }); return; }
      SOR._start(track, startAt);
    },
    _start(track, startAt) {
      savePos(true);
      if (tail) { tail.pause(); tail = null; }
      current = track;
      audio.volume = track.book ? 1 : 0;
      { const v = appleVan(track); audio.src = (v && v[2]) || track.audio; } // door Apple verplaatst fragment: nieuw adres
      bar.classList.toggle('book', !!track.book);
      audio.playbackRate = track.book ? (store.get('tempo') || 1) : 1;
      $('.sp-rate').textContent = String(audio.playbackRate).replace('.', ',') + '×';
      $('.sp-artist').textContent = track.artist || '';
      $('.sp-title').textContent = [track.title, track.year].filter(Boolean).join(' · ');
      $('.sp-time').textContent = '';
      $('.sp-bar i').style.width = '0%';
      toonStore(track); if (!APPLE) appleKlaar.then(() => { if (current === track) toonStore(track); });
      { const im = $('.sp-cover'); if (track.cover) { im.src = SOR.thumb(track.cover); im.hidden = false; } else { im.removeAttribute('src'); im.hidden = true; } }
      bar.hidden = false;
      if (startAt > 0) { const go = () => { try { audio.currentTime = startAt; } catch (e) {} audio.removeEventListener('loadedmetadata', go); }; audio.addEventListener('loadedmetadata', go); }
      mediaSession(track);
      audio.play().catch(() => paint());
      rickroll(track);
      paint();
    },
    // Luisterboek: hoofdstuk n, vanaf seconde t (zonder t: waar je gebleven was in dit hoofdstuk)
    async playBook(n, t, set = 'pop') {
      const S = SETS[set]; const list = await book(set); const c = list.find(x => x.n === n); if (!c) return;
      const saved = store.get(S.key);
      const start = t !== undefined ? t : (saved && saved.n === n ? saved.t : 0);
      if (current && current.book === n && (current.bookSet || 'pop') === set) { if (t !== undefined) { audio.currentTime = t; } audio.paused ? audio.play() : (t === undefined && audio.pause()); return; }
      SOR.play({ audio: abs(c.file), book: n, bookSet: set, bookMax: list.length, duration: c.duration, artist: S.label + n, title: c.title, cover: abs(S.cover) }, start > 5 ? start - 3 : 0);
    },
    bookChapters: book,
    bookPosition(set = 'pop') { return store.get(SETS[set].key); },
    bookPlaying(n, set = 'pop') { return !!(current && current.book === n && (current.bookSet || 'pop') === set && !audio.paused); },
    stop() { volgende = null; audio.pause(); if (tail) { tail.pause(); tail = null; } },
    pause() { volgende = null; audio.pause(); if (tail) { tail.pause(); tail = null; } },
    isPlaying(track) { return !!(current && track && current.audio === track.audio && !audio.paused); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    storeBadge: APPLE_ICON,
    playIcon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>',
    pauseIcon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zM14 5h3v14h-3z"/></svg>',
    load(path) { return fetch(root() + '/' + path).then(r => r.json()); }
  };
})();
