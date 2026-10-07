// Zet elke luistertip in de marge naast de zin waarin het nummer voor het eerst genoemd wordt.
// Alleen in de opmaak met een margekolom (float: right); op smalle schermen blijven de tips tussen de alinea's staan.
(function () {
  function norm(s) {
    // zelfde lengte houden, zodat posities in de tekst blijven kloppen
    return s.toLowerCase().replace(/[‘’‛`´]/g, "'").replace(/[“”„]/g, '"').replace(/\s/g, ' ');
  }
  function noteKeys(a) {
    var who = a.querySelector('.who');
    if (!who) return null;
    var box = who.parentNode, title = '', seen = false;
    box.childNodes.forEach(function (n) { if (seen) title += n.textContent; if (n.nodeName === 'BR') seen = true; });
    // filmtips: "Film: Gone with the Wind (1939)" \u2013 het soort ervoor hoort niet bij de titel
    title = title.replace(/\([^)]*\)/g, '').replace(/^\s*(Film|Serie|Game|Album|Tv)\s*:\s*/i, '').split(/[:\u2013\u2014]| - /)[0].trim();
    var artist = who.textContent.split(/\s(?:&|feat\.?|met|and)\s|\s?\/\s?|\(/i)[0].trim();
    return { title: title, artist: artist };
  }
  function textMap(p) {
    var nodes = [], text = '', w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return n.parentNode.closest('aside, figure') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    });
    for (var n = w.nextNode(); n; n = w.nextNode()) { nodes.push({ node: n, start: text.length }); text += n.textContent; }
    return { nodes: nodes, text: text };
  }
  // aan het begin van een alinea, maar ná tips die daar al staan (zo blijft de volgorde van de bron)
  function atStart(p, a) { var n = p.firstChild; while (n && n.nodeType === 1 && n.matches("aside.side-note")) n = n.nextSibling; p.insertBefore(a, n); }
  function place(a, p, at) {
    var m = textMap(p), lc = norm(m.text), i = at;
    // terug naar het begin van de zin
    var s = Math.max(lc.lastIndexOf('. ', i), lc.lastIndexOf('? ', i), lc.lastIndexOf('! ', i), lc.lastIndexOf(': ', i));
    var start = s < 0 ? 0 : s + 2;
    // in de pdf doorgeschoven naar de volgende pagina: een alinea eerder zetten (SOR_UP, per build gemeten)
    // (en vóór foto's die daar direct aan voorafgaan: een zwevend element komt nooit hoger dan een eerder zwevend element)
    if (a.dataset.up) {
      var prev = p.previousElementSibling; while (prev && prev.tagName !== 'P' && !prev.matches('.head, .part')) prev = prev.previousElementSibling;
      if (prev && prev.tagName === 'P') {
        var t = prev; while (t.previousElementSibling && t.previousElementSibling.matches('figure, .side-fig, aside')) t = t.previousElementSibling;
        if (t === prev) atStart(prev, a); else t.parentNode.insertBefore(a, t);
        return;
      }
    }
    if (start === 0 || a.dataset.para) { atStart(p, a); return; }
    var hit = m.nodes.filter(function (x) { return x.start <= start; }).pop();
    if (!hit) { atStart(p, a); return; }
    var off = start - hit.start, node = hit.node;
    if (off > 0 && off < node.textContent.length) node = node.splitText(off);
    else if (off >= node.textContent.length) { node = node.nextSibling || node; }
    // een tip nooit binnen een cursief woord zetten
    while (node.parentNode !== p && node.parentNode) node = node.parentNode;
    p.insertBefore(a, node);
  }
  function anchor(flow) {
    var kids = Array.prototype.slice.call(flow.children);
    var last = null;
    kids.forEach(function (a) {
      if (!a.matches('aside.side-note')) return;
      if (!window.SOR_PRINT && getComputedStyle(a).float === 'none') return;
      var k = noteKeys(a);
      if (!k) return;
      var who = a.querySelector('.who').textContent;
      if ((window.SOR_PARA || []).some(function (x) { return who.indexOf(x) >= 0; })) a.dataset.para = '1';
      if ((window.SOR_UP || []).some(function (x) { return norm(k.title).indexOf(norm(x)) === 0; })) a.dataset.up = '1';
      var idx = kids.indexOf(a), lo = idx, hi = idx;
      while (lo > 0 && !kids[lo - 1].matches('.head, .part')) lo--;
      while (hi < kids.length - 1 && !kids[hi + 1].matches('.head, .part')) hi++;
      var ps = kids.slice(lo, hi + 1).filter(function (x) { return x.tagName === 'P'; });
      var all = kids.filter(function (x) { return x.tagName === 'P' && ps.indexOf(x) < 0; })
        .sort(function (x, y) { return Math.abs(kids.indexOf(x) - idx) - Math.abs(kids.indexOf(y) - idx); });
      // volgorde: titel in de eigen track, artiest in de eigen track, titel elders in het hoofdstuk.
      // De artiest nooit buiten de eigen track zoeken, en nooit een algemene naam als "Traditional":
      // dan belandt de tip bij een heel ander nummer. Niets gevonden: de tip blijft waar hij in de tekst staat.
      var generic = /^(traditional|traditioneel|anoniem|anonymous|various|diverse)/i;
      var title = k.title && k.title.length > 2 ? norm(k.title) : '';
      var artist = k.artist && k.artist.length > 2 && !generic.test(k.artist) ? norm(k.artist) : '';
      // vangnet: staat de titel nergens in de tekst, dan de alinea waarin de toelichting van de tip terugkomt
      var rec = a.querySelector('.rec'), note = '';
      if (rec) { var c = rec.nextSibling; while (c) { note += c.textContent; c = c.nextSibling; } }
      note = norm(note).replace(/\s+/g, ' ').trim();
      if (note.indexOf(': ') > 0) note = note.split(': ')[1];
      note = note.split(' ').slice(0, 4).join(' ');
      var tries = [[ps, title], [ps, artist], [all, title], [ps, note.length > 10 ? note : '']];
      // tips blijven in de volgorde van de tekst: nooit vóór een tip die eerder in de bron staat
      // (anders staat bv. de cover van The Animals vóór de eerste opname uit 1933)
      var lastP = null;
      if (last) { lastP = last.closest('p'); if (!lastP) { lastP = last.nextElementSibling; while (lastP && lastP.tagName !== 'P') lastP = lastP.nextElementSibling; } }
      var allowed = function (p) { return !lastP || p === lastP || (lastP.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING); };
      // een artiest die maar in een paar alinea's voorkomt (geen Beatles in hun eigen hoofdstuk) gaat voor:
      // de alinea met die artiest én het jaartal van de tip, ook als de titel eerder al viel (bv. The Animals, 1964)
      var year = ((rec ? rec.textContent : '').match(/\((\d{4})\)/) || [])[1];
      if (artist && year) {
        var allP = kids.filter(function (x) { return x.tagName === 'P'; });
        var count = allP.filter(function (x) { return norm(textMap(x).text).indexOf(artist) >= 0; }).length;
        if (count <= 3) {
          for (var q2 = 0; q2 < ps.length; q2++) {
            if (!allowed(ps[q2])) continue;
            var tx = norm(textMap(ps[q2]).text), at2 = tx.indexOf(artist);
            if (at2 >= 0 && tx.indexOf(year) >= 0) { if (ps[q2] === lastP && last.closest('p') === lastP) last.after(a); else place(a, ps[q2], at2); last = a; return; }
          }
        }
      }
      for (var s = 0; s < tries.length; s++) {
        var set = tries[s][0], key = tries[s][1];
        if (!key) continue;
        for (var q = 0; q < set.length; q++) {
          if (!allowed(set[q])) continue;
          var at = norm(textMap(set[q]).text).indexOf(key);
          if (at < 0) continue;
          // zelfde alinea als de vorige tip: direct ná die tip, zodat de volgorde klopt
          if (set[q] === lastP && last.closest('p') === lastP) last.after(a); else place(a, set[q], at);
          last = a; return;
        }
      }
      last = a;
    });
  }
  function run() { document.querySelectorAll('.flow').forEach(anchor); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
