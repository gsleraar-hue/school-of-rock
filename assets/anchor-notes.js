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
    title = title.replace(/\([^)]*\)/g, '').split(/[:\u2013\u2014]| - /)[0].trim();
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
  function place(a, p, at) {
    var m = textMap(p), lc = norm(m.text), i = at;
    // terug naar het begin van de zin
    var s = Math.max(lc.lastIndexOf('. ', i), lc.lastIndexOf('? ', i), lc.lastIndexOf('! ', i), lc.lastIndexOf(': ', i));
    var start = s < 0 ? 0 : s + 2;
    if (start === 0) { p.insertBefore(a, p.firstChild); return; }
    var hit = m.nodes.filter(function (x) { return x.start <= start; }).pop();
    if (!hit) { p.insertBefore(a, p.firstChild); return; }
    var off = start - hit.start, node = hit.node;
    if (off > 0 && off < node.textContent.length) node = node.splitText(off);
    else if (off >= node.textContent.length) { node = node.nextSibling || node; }
    // een tip nooit binnen een cursief woord zetten
    while (node.parentNode !== p && node.parentNode) node = node.parentNode;
    p.insertBefore(a, node);
  }
  function anchor(flow) {
    var kids = Array.prototype.slice.call(flow.children);
    kids.forEach(function (a) {
      if (!a.matches('aside.side-note')) return;
      if (getComputedStyle(a).float === 'none') return;
      var k = noteKeys(a);
      if (!k) return;
      var idx = kids.indexOf(a), lo = idx, hi = idx;
      while (lo > 0 && !kids[lo - 1].matches('.head, .part')) lo--;
      while (hi < kids.length - 1 && !kids[hi + 1].matches('.head, .part')) hi++;
      var ps = kids.slice(lo, hi + 1).filter(function (x) { return x.tagName === 'P'; });
      var all = kids.filter(function (x) { return x.tagName === 'P' && ps.indexOf(x) < 0; })
        .sort(function (x, y) { return Math.abs(kids.indexOf(x) - idx) - Math.abs(kids.indexOf(y) - idx); });
      var keys = [k.title, k.artist].filter(function (x) { return x && x.length > 2; });
      // eerst in de eigen track, dan in de rest van het hoofdstukdeel
      var sets = [ps, all];
      for (var s = 0; s < sets.length; s++) {
        for (var j = 0; j < keys.length; j++) {
          var key = norm(keys[j]);
          for (var q = 0; q < sets[s].length; q++) {
            var at = norm(textMap(sets[s][q]).text).indexOf(key);
            if (at >= 0) { place(a, sets[s][q], at); return; }
          }
        }
      }
    });
  }
  function run() { document.querySelectorAll('.flow').forEach(anchor); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
