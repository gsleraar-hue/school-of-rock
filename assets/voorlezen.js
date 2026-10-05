// Voorlezen: de browser leest het hoofdstuk voor, alinea voor alinea, met de stem van het apparaat.
(function () {
  const synth = window.speechSynthesis;
  const deck = document.querySelector('.deck');
  const book = document.querySelector('.book');
  if (!deck || !book) return;
  const store = { get(k, d) { try { const v = localStorage.getItem('sor-tts-' + k); return v === null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('sor-tts-' + k, v); } catch (e) {} } };

  // ---------- knop in het blok bovenaan ----------
  const row = document.createElement('div');
  row.className = 'deck-row';
  row.innerHTML = '<span class="lbl">Voorlezen</span><button type="button" class="btn solid tts-start"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 10v4h4l5 4V6L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>Lees dit hoofdstuk voor</button>';
  const lessonRow = deck.querySelector('.deck-toggle[data-target="lu"]')?.closest('.deck-row');
  deck.insertBefore(row, lessonRow ? lessonRow.nextSibling : deck.firstChild);
  const startBtn = row.querySelector('.tts-start');
  if (!synth) { startBtn.disabled = true; startBtn.title = 'Deze browser kan niet voorlezen.'; return; }

  // ---------- zwevende bediening ----------
  const bar = document.createElement('div');
  bar.className = 'tts-bar'; bar.hidden = true; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Voorlezen');
  bar.innerHTML = `
    <button type="button" class="tts-prev" aria-label="Vorige alinea"><svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zM9.5 12 18 18V6z"/></svg></button>
    <button type="button" class="tts-play" aria-label="Pauze"><svg viewBox="0 0 24 24"><path d="M7 5h3v14H7zM14 5h3v14h-3z"/></svg></button>
    <button type="button" class="tts-next" aria-label="Volgende alinea"><svg viewBox="0 0 24 24"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg></button>
    <label class="tts-f">Tempo <select class="tts-rate"><option value="0.8">0,8×</option><option value="1">1×</option><option value="1.15">1,15×</option><option value="1.3">1,3×</option><option value="1.5">1,5×</option></select></label>
    <label class="tts-f tts-vwrap">Stem <select class="tts-voice"></select></label>
    <label class="tts-f"><input type="checkbox" class="tts-notes"> Luistertips</label>
    <button type="button" class="tts-close" aria-label="Stoppen met voorlezen">✕</button>`;
  document.body.appendChild(bar);
  const $ = s => bar.querySelector(s);
  $('.tts-rate').value = store.get('rate', '1');
  $('.tts-notes').checked = store.get('notes', '0') === '1';

  // ---------- stemmen ----------
  let voices = [], nlVoice = null, enVoice = null;
  function rankNl(v) { const n = v.name; return (/Natural|Online/.test(n) ? 0 : /Google/.test(n) ? 1 : 2) + (/nl-NL/i.test(v.lang) ? 0 : 0.5); }
  function loadVoices() {
    voices = synth.getVoices();
    const nl = voices.filter(v => /^nl/i.test(v.lang)).sort((a, b) => rankNl(a) - rankNl(b));
    const en = voices.filter(v => /^en/i.test(v.lang)).sort((a, b) => rankNl(a) - rankNl(b));
    enVoice = en[0] || null;
    const sel = $('.tts-voice'); sel.innerHTML = '';
    nl.forEach(v => { const o = document.createElement('option'); o.value = v.name; o.textContent = v.name.replace(/^Microsoft |^Google /, '').replace(/ - Dutch.*| \(Natural\).*|Online /g, ''); sel.appendChild(o); });
    const saved = store.get('voice', '');
    nlVoice = nl.find(v => v.name === saved) || nl[0] || null;
    if (nlVoice) sel.value = nlVoice.name;
    $('.tts-vwrap').hidden = nl.length < 2;
  }
  loadVoices();
  if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = loadVoices;

  // ---------- tekst verzamelen ----------
  const EN = /\b(the|of|and|you|your|my|me|love|i|in|on|is|it|to|a|be|all|girl|baby|man|night|life|time|blues|rock|song|for|with|we|this|that|don't|can't|it's|what|like|stop|go|got|get|heart|dance|world|day|way|no|yes)\b/gi;
  const NL = /\b(de|het|een|van|en|ik|je|jij|mijn|niet|maar|voor|met|zijn|wat|die|dat|naar|ook|nog|uit|als|om|op|we|wij|ze|zij|over|bij|aan|al|is|er)\b/gi;
  function isEnglish(t) { const e = (t.match(EN) || []).length, n = (t.match(NL) || []).length; return e > n && e > 0; }
  function partsOf(el) {
    // Splits een alinea in stukken: cursieve Engelse titels krijgen een Engelse stem.
    const clone = el.cloneNode(true);
    clone.querySelectorAll('aside, figure, .label, .letter, .kicker, img, .qr').forEach(n => n.remove());
    const out = [];
    function push(text, en) { text = text.replace(/\s+/g, ' '); if (!text.trim()) return; const last = out[out.length - 1]; if (last && last.en === en) last.text += text; else out.push({ text, en }); }
    (function walk(n) {
      n.childNodes.forEach(c => {
        if (c.nodeType === 3) push(c.textContent, false);
        else if (c.nodeName === 'EM' || c.nodeName === 'I') push(c.textContent, !!enVoice && isEnglish(c.textContent));
        else walk(c);
      });
    })(clone);
    return out;
  }
  function noteText(a) {
    const who = a.querySelector('.who'); const box = who ? who.parentNode : null;
    let title = ''; if (box) { let seen = false; box.childNodes.forEach(n => { if (seen) title += n.textContent; if (n.nodeName === 'BR') seen = true; }); }
    const clone = a.cloneNode(true); clone.querySelectorAll('.tag, .rec, .qr').forEach(n => n.remove());
    const rest = clone.textContent.replace(/\s+/g, ' ').trim();
    return [{ text: 'Luistertip: ' + (who ? who.textContent + ', ' : ''), en: false }, { text: title.trim() + '. ', en: !!enVoice && isEnglish(title) }, { text: rest, en: false }];
  }
  function collect() {
    const items = [];
    const cover = book.querySelector('.opener.cover');
    if (cover) items.push({ el: cover, parts: partsOf(cover.querySelector('.cover-text') || cover) });
    book.querySelectorAll('.flow > *').forEach(el => {
      if (el.matches('.opener.part')) { const k = el.querySelector('.kicker'); items.push({ el, parts: [{ text: (k ? k.textContent.replace(/·.*$/, '').trim() + '. ' : ''), en: true }].concat(partsOf(el)) }); }
      else if (el.matches('.head')) items.push({ el, parts: partsOf(el.querySelector('h3')) });
      else if (el.matches('p')) {
        items.push({ el, parts: partsOf(el) });
        if ($('.tts-notes').checked) el.querySelectorAll('aside.side-note').forEach(a => { if (a.querySelector('.who')) items.push({ el: a, parts: noteText(a) }); });
      } else if (el.matches('aside.side-note') && $('.tts-notes').checked && el.querySelector('.who')) items.push({ el, parts: noteText(el) });
    });
    return items.filter(i => i.parts.some(p => p.text.trim()));
  }

  // ---------- afspelen ----------
  let items = [], idx = 0, playing = false, token = 0;
  function sentences(parts) {
    // Chrome breekt lange stukken af: knip op zinnen.
    const out = [];
    parts.forEach(p => { (p.text.match(/[^.!?;:]+[.!?;:]*\s*/g) || [p.text]).forEach(s => { if (s.trim()) out.push({ text: s, en: p.en }); }); });
    return out;
  }
  function mark(el) {
    book.querySelectorAll('.tts-now').forEach(n => n.classList.remove('tts-now'));
    if (!el) return;
    el.classList.add('tts-now');
    const r = el.getBoundingClientRect();
    if (r.top < 90 || r.bottom > innerHeight - 110) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function speakItem() {
    const my = ++token;
    if (idx >= items.length) { stop(); return; }
    const it = items[idx]; mark(it.el);
    const chunks = sentences(it.parts);
    let c = 0;
    const rate = parseFloat($('.tts-rate').value) || 1;
    (function next() {
      if (my !== token || !playing) return;
      if (c >= chunks.length) { idx++; speakItem(); return; }
      const ch = chunks[c++];
      const u = new SpeechSynthesisUtterance(ch.text);
      const v = ch.en && enVoice ? enVoice : nlVoice;
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = ch.en ? 'en-GB' : 'nl-NL';
      u.rate = rate;
      u.onend = next; u.onerror = () => { if (my === token) next(); };
      synth.speak(u);
    })();
  }
  function setPlayIcon() {
    $('.tts-play').innerHTML = playing ? '<svg viewBox="0 0 24 24"><path d="M7 5h3v14H7zM14 5h3v14h-3z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>';
    $('.tts-play').setAttribute('aria-label', playing ? 'Pauze' : 'Verder voorlezen');
  }
  function play(from) {
    synth.cancel(); token++;
    items = collect();
    if (typeof from === 'number') idx = Math.max(0, Math.min(items.length - 1, from));
    playing = true; bar.hidden = false; setPlayIcon(); speakItem();
  }
  function pause() { playing = false; token++; synth.cancel(); setPlayIcon(); }
  function stop() { playing = false; token++; synth.cancel(); mark(null); bar.hidden = true; setPlayIcon(); }
  function firstVisible() {
    const list = collect();
    const i = list.findIndex(it => it.el.getBoundingClientRect().bottom > 80);
    return i < 0 ? 0 : i;
  }

  startBtn.addEventListener('click', () => { if (window.SOR && SOR.pause) try { SOR.pause(); } catch (e) {} play(firstVisible()); });
  $('.tts-play').addEventListener('click', () => (playing ? pause() : play(idx)));
  $('.tts-prev').addEventListener('click', () => play(idx - 1));
  $('.tts-next').addEventListener('click', () => play(idx + 1));
  $('.tts-close').addEventListener('click', stop);
  $('.tts-rate').addEventListener('change', e => { store.set('rate', e.target.value); if (playing) play(idx); });
  $('.tts-voice').addEventListener('change', e => { store.set('voice', e.target.value); nlVoice = voices.find(v => v.name === e.target.value) || nlVoice; if (playing) play(idx); });
  $('.tts-notes').addEventListener('change', e => { store.set('notes', e.target.checked ? '1' : '0'); if (playing) { const cur = items[idx] && items[idx].el; const list = collect(); const i = list.findIndex(it => it.el === cur); play(i < 0 ? idx : i); } });
  // Klik op een alinea terwijl er wordt voorgelezen: daar verder lezen.
  book.addEventListener('dblclick', e => { if (bar.hidden) return; const p = e.target.closest('.flow > p, .flow > .head, aside.side-note'); if (!p) return; const list = collect(); const i = list.findIndex(it => it.el === p || it.el.contains(p)); if (i >= 0) play(i); });
  document.addEventListener('keydown', e => { if (bar.hidden || e.target.closest('input, select, textarea')) return; if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); playing ? pause() : play(idx); } });
  window.addEventListener('beforeunload', () => synth.cancel());
})();
