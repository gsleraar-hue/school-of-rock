/* Online hoofdstuk: ankers per track, afspeelknoppen bij luistertips, genres op de kaart. */
(function () {
  const SOR = window.SOR;
  const RAW = document.body.dataset.mixtape || '';
  const SET = RAW.startsWith('film-') ? 'film' : 'pop';
  const N = +RAW.replace('film-', '');

  // Ankers per track, zodat de kaart naar een track kan linken.
  document.querySelectorAll('.flow .head h3').forEach(h => {
    const head = h.closest('.head');
    if (!head.id) head.id = SOR.slug(h.textContent);
  });

  // Luisterboek: dit hoofdstuk beluisteren (de speler loopt door als je verder klikt op de site).
  (function () {
    const deck = document.querySelector('.deck'); if (!deck || !SOR.playBook) return;
    const row = document.createElement('div'); row.className = 'deck-row sor-book-row';
    row.innerHTML = '<span class="lbl">Luisterboek</span><button type="button" class="btn solid sor-book-go">' + SOR.playIcon + '<span>Luister dit hoofdstuk</span></button><button type="button" class="btn ghost sor-book-start" hidden>Vanaf het begin</button><span class="sor-book-info mono"></span>';
    const after = deck.querySelector('.deck-embed[data-name="sp"]') || deck.firstElementChild;
    after.after(row);
    const go = row.querySelector('.sor-book-go'), fromStart = row.querySelector('.sor-book-start'), info = row.querySelector('.sor-book-info');
    let dur = 0;
    function label() {
      const pos = SOR.bookPosition(SET); const here = pos && pos.n === N && pos.t > 20 ? pos.t : 0;
      const on = SOR.bookPlaying(N, SET);
      go.innerHTML = (on ? SOR.pauseIcon : SOR.playIcon) + '<span>' + (on ? 'Pauzeer' : here ? 'Verder luisteren' : 'Luister dit hoofdstuk') + '</span>';
      fromStart.hidden = !here || on;
      info.textContent = here && !on ? 'bij ' + SOR.fmt(here) + ' van ' + SOR.fmt(dur) : dur ? Math.round(dur / 60) + ' minuten' : '';
    }
    SOR.bookChapters(SET).then(list => { const c = list.find(x => x.n === N); if (!c) { row.remove(); return; } dur = c.duration; label(); });
    go.addEventListener('click', () => SOR.playBook(N, undefined, SET));
    fromStart.addEventListener('click', () => SOR.playBook(N, 0, SET));
    SOR.onChange(label);
    const css = document.createElement('style');
    css.textContent = '.sor-book-row .btn svg{width:14px;height:14px;fill:currentColor;margin-right:8px;vertical-align:-2px}.sor-book-row .sor-book-info{font-size:11px;letter-spacing:.04em;color:#9C978D;align-self:center}';
    document.head.appendChild(css);
  })();

  // Afspeelknoppen bij de luistertips.
  // tracks.json: fragmenten uit de les; tips-audio.json: aanvulling voor tips zonder fragment in de les
  Promise.all([SOR.load('data/tracks.json'), SOR.load('data/tips-audio.json').catch(() => [])]).then(([tracks, extra]) => {
    const mine = SET === 'pop' ? tracks.filter(t => t.mixtape === N) : [];
    const byTip = new Map(extra.filter(t => SET === 'pop' && t.mixtape === N).map(t => [SOR.norm(t.artist) + '|' + SOR.norm(t.title), t]));
    const key = (a, t) => SOR.norm(a) + '|' + SOR.norm((t || '').replace(/\(.*?\)/g, '')).slice(0, 14);
    const byKey = new Map(mine.map(t => [key(t.artist, t.title), t]));
    const byArtist = new Map(); mine.forEach(t => { const k = SOR.norm(t.artist); if (!byArtist.has(k)) byArtist.set(k, []); byArtist.get(k).push(t); });
    const buttons = [];
    document.querySelectorAll('.side-note').forEach(note => {
      const who = note.querySelector('.who');
      if (!who) return;
      const rec = note.querySelector('.rec');
      const lines = rec ? rec.innerText.split('\n').map(s => s.trim()).filter(Boolean) : [];
      const artist = who.textContent.trim();
      const title = (lines.find(l => l !== artist) || '').replace(/\s*\(\d{4}\)\s*$/, '');
      // filmhoofdstukken: het fragment staat direct op de tip (data-audio)
      const img0 = rec && rec.querySelector('img');
      let t = note.dataset.audio ? { audio: note.dataset.audio, artist, title, cover: img0 ? img0.src : '' } : byKey.get(key(artist, title));
      if (!t) { const cands = byArtist.get(SOR.norm(artist)) || []; t = cands.find(c => SOR.norm(c.title).startsWith(SOR.norm(title).slice(0, 6))) || (cands.length === 1 ? cands[0] : null); }
      if (!t) t = byTip.get(SOR.norm(artist) + '|' + SOR.norm(title));
      if (!t) return;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'sor-play'; b.setAttribute('aria-label', 'Speel ' + artist + ' – ' + title);
      b.innerHTML = SOR.playIcon;
      b.addEventListener('click', () => SOR.play({ ...t, year: (title.match(/\d{4}/) || [])[0] }));
      // afspeelknop op de hoes (of op de plek van de hoes als die er niet is)
      const cov = document.createElement('span'); cov.className = 'note-play rec-cover';
      const img = rec && rec.querySelector('img');
      if (img) { img.replaceWith(cov); cov.append(img, b); }
      else if (rec) { cov.classList.add('no-img'); cov.append(b); rec.style.removeProperty('grid-template-columns'); rec.prepend(cov); }
      else { const tag = note.querySelector('.tag'); cov.append(b); (tag || note.firstChild).after(cov); }
      buttons.push([b, t]);
    });
    SOR.onChange(() => buttons.forEach(([b, t]) => { const on = SOR.isPlaying(t); b.classList.toggle('on', on); b.innerHTML = on ? SOR.pauseIcon : SOR.playIcon; }));
  });

  // Genres uit dit hoofdstuk op de kaart.
  SOR.load('data/genres.json').then(data => {
    const box = document.querySelector('.deck-genres');
    if (!box) return;
    const fam = new Map(data.families.map(f => [f.id, f]));
    const list = data.genres.filter(g => (g.mixtapes || []).some(m => m.n === N)).sort((a, b) => a.year - b.year);
    if (!list.length) { box.closest('.deck-row').hidden = true; return; }
    box.innerHTML = list.map(g => `<a class="gchip" href="${SOR.root}/kaart.html#${g.id}" style="--c:${(fam.get(g.family) || {}).color || '#999'}"><i></i>${g.name}<span>${g.year}</span></a>`).join('');
  }).catch(() => { const r = document.querySelector('.deck-genres'); if (r) r.closest('.deck-row').hidden = true; });

  // Spotify-speler en LessonUp-les in de pagina openen.
  const kinds = { sp: { title: 'Spotify-playlist', h: 380, allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture' }, lu: { title: 'LessonUp-les', allow: 'autoplay; clipboard-write', nofull: true } };
  function frameHtml(kind, src) {
    const k = kinds[kind];
    return `<iframe title="${k.title}" src="${src}" width="100%"${k.h ? ` height="${k.h}"` : ''} frameborder="0" allow="${k.allow}"${k.nofull ? '' : ' allowfullscreen'}></iframe>`;
  }
  // LessonUp-les in een venster boven de pagina, met een eigen sluitknop (zoals het Van Gogh Museum het doet).
  let modal = null, lastFocus = null;
  function openLesson(btn) {
    lastFocus = btn;
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'lu-modal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.hidden = true;
      modal.innerHTML = '<div class="lu-box"><div class="lu-bar"><b></b><button type="button" class="lu-restart">Opnieuw</button><button type="button" class="lu-full">Volledig scherm</button><button type="button" class="lu-close">Sluit de les ✕</button></div><div class="lu-frame"></div></div>';
      document.body.appendChild(modal);
      modal.addEventListener('click', e => { if (e.target === modal) closeLesson(); });
      modal.querySelector('.lu-close').addEventListener('click', closeLesson);
      modal.querySelector('.lu-restart').addEventListener('click', () => loadPlayer(modal.dataset.src));
      modal.querySelector('.lu-full').addEventListener('click', () => { const f = modal.querySelector('.lu-frame'); if (f.requestFullscreen) f.requestFullscreen(); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden && !document.fullscreenElement) closeLesson(); });
    }
    modal.dataset.src = btn.dataset.embed;
    modal.querySelector('b').textContent = btn.dataset.title || 'LessonUp-les';
    modal.setAttribute('aria-label', btn.dataset.title || 'LessonUp-les');
    loadPlayer(btn.dataset.embed);
    modal.hidden = false; document.documentElement.style.overflow = 'hidden';
    modal.querySelector('.lu-close').focus();
  }
  function loadPlayer(src) {
    const f = modal.querySelector('.lu-frame');
    f.innerHTML = frameHtml('lu', src) + '<button type="button" class="lu-cover" aria-label="Sluit de les">Sluit les ✕</button>';
    f.querySelector('.lu-cover').addEventListener('click', closeLesson);
  }
  function closeLesson() {
    if (!modal) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    modal.querySelector('.lu-frame').innerHTML = ''; // speler weghalen, zodat de les de volgende keer vers start
    modal.hidden = true; document.documentElement.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  }
  document.querySelectorAll('.deck-toggle').forEach(btn => {
    btn.addEventListener('click', e => {
      const kind = btn.dataset.target;
      e.preventDefault();
      if (kind === 'lu') { openLesson(btn); return; }
      const frame = document.querySelector(`.deck-embed[data-name="${kind}"]`);
      if (!frame) return;
      if (!frame.innerHTML) frame.innerHTML = frameHtml(kind, btn.dataset.embed);
      frame.hidden = !frame.hidden;
      btn.setAttribute('aria-expanded', String(!frame.hidden));
    });
  });
  // #les in de adresbalk opent meteen de les
  if (location.hash === '#les') { const b = document.querySelector('.deck-toggle[data-target="lu"]'); if (b) openLesson(b); }
  // Met de pijltjestoetsen naar de vorige of volgende mixtape (niet tijdens typen of in de les).
  document.addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('.lu-modal:not([hidden])') || document.fullscreenElement) return;
    const sel = e.key === 'ArrowLeft' ? '.mt-step.prev' : e.key === 'ArrowRight' ? '.mt-step.next' : '';
    const a = sel && document.querySelector(sel);
    if (a) a.click(); // via de link, zodat de speler doorspeelt
  });
})();