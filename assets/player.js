/* Gedeelde speler: fragmenten en het luisterboek, met een balk onderin het scherm die blijft staan bij navigeren. */
(function () {
  if (window.SOR) return; // al geladen: de speler blijft staan bij navigeren binnen de site
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
  const SETS = { pop: { data: 'data/luisterboek.json', key: 'boek', label: 'Luisterboek · Mixtape ', album: 'School of Rock · luisterboek', cover: 'assets/cassette.png' }, film: { data: 'film/data/luisterboek.json', key: 'boek-film', label: 'De Droomfabriek · Filmrol ', album: 'De Droomfabriek · luisterboek', cover: 'film/assets/icon.svg' }, jazz: { data: 'jazz/data/luisterboek.json', key: 'boek-jazz', label: 'Blue Hour · Sessie ', album: 'Blue Hour · luisterboek', cover: 'jazz/assets/icon.svg' } };
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
  // en bij een wissel loopt het vorige fragment nog even door terwijl het volgende opkomt (crossfade).
  const FADE = 4, FADE_IN = 2.5, XFADE = 3;
  const ease = x => Math.sin(Math.max(0, Math.min(1, x)) * Math.PI / 2); // vloeiende curve (gelijke luidheid bij overlap)
  function fade() {
    const frag = current && !current.book && isFinite(audio.duration) && audio.duration > FADE * 2;
    const rest = frag ? audio.duration - audio.currentTime : Infinity;
    const vin = current && !current.book ? ease(audio.currentTime / FADE_IN) : 1;
    const v = Math.min(vin, rest < FADE ? ease(rest / FADE) : 1);
    if (Math.abs(audio.volume - v) > .01) audio.volume = v;
  }
  let tail = null;
  function crossfadeOut() {
    if (!current || current.book || audio.paused || !audio.currentSrc) return;
    if (tail) { tail.pause(); tail = null; }
    const t = tail = new Audio(audio.currentSrc); t.preload = 'auto'; t.volume = audio.volume;
    const from = audio.currentTime, v0 = audio.volume || 1;
    t.addEventListener('loadedmetadata', () => { try { t.currentTime = from; } catch (e) {} }, { once: true });
    t.play().catch(() => {});
    const t0 = Date.now();
    const iv = setInterval(() => { const k = Math.min(1, (Date.now() - t0) / (XFADE * 1000)); if (tail !== t || k >= 1 || t.paused) { clearInterval(iv); t.pause(); if (tail === t) tail = null; return; } t.volume = Math.max(0, v0 * ease(1 - k)); }, 40);
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
    if (e.target.closest('.sp-toggle')) { audio.paused ? audio.play() : audio.pause(); }
    if (e.target.closest('.sp-close')) { audio.pause(); bar.hidden = true; }
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
      h('play', () => audio.play()); h('pause', () => audio.pause());
      h('seekbackward', track.book ? () => seekBy(-15) : null); h('seekforward', track.book ? () => seekBy(30) : null);
      h('nexttrack', track.book && track.book < (track.bookMax || 13) ? () => SOR.playBook(track.book + 1, 0, track.bookSet || 'pop') : null);
      h('previoustrack', track.book && track.book > 1 ? () => SOR.playBook(track.book - 1, 0, track.bookSet || 'pop') : null);
    } catch (e) {}
  }

  const chapters = {};
  const book = (set = 'pop') => chapters[set] || (chapters[set] = fetch(abs(SETS[set].data)).then(r => r.json()).catch(() => { delete chapters[set]; return []; }));

  const SOR = window.SOR = {
    slug, norm, fmt, get root() { return root(); }, media: audio,
    play(track, startAt) {
      if (!track || !track.audio) return;
      if (current && current.audio === track.audio) { audio.paused ? audio.play() : audio.pause(); return; }
      savePos(true);
      if (!track.book) crossfadeOut(); else if (tail) { tail.pause(); tail = null; }
      current = track;
      audio.volume = track.book ? 1 : 0;
      audio.src = track.audio;
      bar.classList.toggle('book', !!track.book);
      audio.playbackRate = track.book ? (store.get('tempo') || 1) : 1;
      $('.sp-rate').textContent = String(audio.playbackRate).replace('.', ',') + '×';
      $('.sp-artist').textContent = track.artist || '';
      $('.sp-title').textContent = [track.title, track.year].filter(Boolean).join(' · ');
      $('.sp-time').textContent = '';
      $('.sp-bar i').style.width = '0%';
      { const im = $('.sp-cover'); if (track.cover) { im.src = track.cover; im.hidden = false; } else { im.removeAttribute('src'); im.hidden = true; } }
      bar.hidden = false;
      if (startAt > 0) { const go = () => { try { audio.currentTime = startAt; } catch (e) {} audio.removeEventListener('loadedmetadata', go); }; audio.addEventListener('loadedmetadata', go); }
      mediaSession(track);
      audio.play().catch(() => paint());
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
    stop() { audio.pause(); if (tail) { tail.pause(); tail = null; } },
    pause() { audio.pause(); if (tail) { tail.pause(); tail = null; } },
    isPlaying(track) { return !!(current && track && current.audio === track.audio && !audio.paused); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    playIcon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>',
    pauseIcon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zM14 5h3v14h-3z"/></svg>',
    load(path) { return fetch(root() + '/' + path).then(r => r.json()); }
  };
})();
