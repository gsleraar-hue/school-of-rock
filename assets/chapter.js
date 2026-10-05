/* Online hoofdstuk: ankers per track, afspeelknoppen bij luistertips, genres op de kaart. */
(function () {
  const SOR = window.SOR;
  const N = +document.body.dataset.mixtape;

  // Ankers per track, zodat de kaart naar een track kan linken.
  document.querySelectorAll('.flow .head h3').forEach(h => {
    const head = h.closest('.head');
    if (!head.id) head.id = SOR.slug(h.textContent);
  });

  // Afspeelknoppen bij de luistertips.
  SOR.load('data/tracks.json').then(tracks => {
    const mine = tracks.filter(t => t.mixtape === N);
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
      let t = byKey.get(key(artist, title));
      if (!t) { const cands = byArtist.get(SOR.norm(artist)) || []; t = cands.find(c => SOR.norm(c.title).startsWith(SOR.norm(title).slice(0, 6))) || (cands.length === 1 ? cands[0] : null); }
      if (!t) return;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'sor-play'; b.setAttribute('aria-label', 'Speel ' + artist + ' – ' + title);
      b.innerHTML = SOR.playIcon;
      b.addEventListener('click', () => SOR.play({ ...t, year: (title.match(/\d{4}/) || [])[0] }));
      const tag = note.querySelector('.tag');
      const row = document.createElement('div'); row.className = 'note-play';
      row.append(b, Object.assign(document.createElement('span'), { textContent: 'Luister naar het fragment' }));
      (tag || note.firstChild).after(row);
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
  const kinds = { sp: { title: 'Spotify-playlist', h: 380, allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture' }, lu: { title: 'LessonUp-les', allow: 'autoplay; fullscreen; clipboard-write' } };
  document.querySelectorAll('.deck-toggle').forEach(btn => btn.addEventListener('click', e => {
    const frame = document.querySelector(`.deck-embed[data-name="${btn.dataset.target}"]`);
    if (!frame) return;
    e.preventDefault();
    const k = kinds[btn.dataset.target];
    if (!frame.innerHTML) frame.innerHTML = `<iframe title="${k.title}" src="${btn.dataset.embed}" width="100%"${k.h ? ` height="${k.h}"` : ''} frameborder="0" allow="${k.allow}" allowfullscreen></iframe>`;
    frame.hidden = !frame.hidden;
    btn.setAttribute('aria-expanded', String(!frame.hidden));
    if (btn.dataset.target === 'lu') {
      const full = document.querySelector('.deck-full');
      if (full) full.hidden = frame.hidden;
      if (!frame.hidden) frame.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }));
  const full = document.querySelector('.deck-full');
  if (full) full.addEventListener('click', () => { const f = document.querySelector('.deck-embed.lu'); if (f && f.requestFullscreen) f.requestFullscreen(); });
})();