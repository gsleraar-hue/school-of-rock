// Bewerkpagina van HitStory (alleen voor de eigenaar). Wordt door maak.ts in bewerk.html gezet; __MAP__ en __EN__ worden daar ingevuld.
// Bewaart naar bouw/encyclopedie/<MAP>/<type>/<slug>.json in de site-repo (daarna bouwt GitHub Actions) en uploadt afbeeldingen naar de beeld-repo.
(function () {
  var R = "gsleraar-hue/school-of-rock", RB = "gsleraar-hue/hitstory-beeld", MAP = "__MAP__", EN = __EN__;
  var BEELD = "https://beeld.sorock.nl/";
  var Q = new URLSearchParams(location.search), id = Q.get("id") || "", nieuwType = Q.get("nieuw") || "";
  var $ = function (i) { return document.getElementById(i); };
  var tok = function () { try { return localStorage.getItem("hs_token") || ""; } catch (e) { return ""; } };
  var NL = String.fromCharCode(10), CR = String.fromCharCode(13);
  var base = location.pathname.replace("bewerk.html", "");
  var root = (document.querySelector("meta[name=sor-root]") || {}).content || "..";
  var TYPES = { artiest: "Artiest", genre: "Genre", werk: "Album of nummer", begrip: "Begrip", techniek: "Techniek" };
  var REL = { artiest: ["genre", "werk", "invloed"], genre: ["artiest", "wortels", "daarna"], werk: ["artiest", "genre", "maker"], techniek: ["genre", "artiest"], begrip: ["genre"] };
  var RELNAAM = { genre: "Genres", werk: "Werken", invloed: "Beïnvloed door", artiest: "Artiesten", wortels: "Wortels", daarna: "Leidde tot", maker: "Schrijver/producer" };
  var zoek = null, byId = {}, d = {}, j = {}, orig = null, type = "", isNieuw = false, state = {};

  function st(t, fout) { $("bw-status").textContent = t; $("bw-status").style.color = fout ? "#c0392b" : ""; }
  function api(rep, p, o) { o = o || {}; o.headers = Object.assign({ Authorization: "Bearer " + tok(), Accept: "application/vnd.github+json" }, o.headers || {}); return fetch("https://api.github.com/repos/" + rep + p, o); }
  function b64(s) { return btoa(unescape(encodeURIComponent(s))); }
  function de64(s) { return decodeURIComponent(escape(atob(s.split(NL).join("")))); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function slug(s) { return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " en ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
  function ev(k) { return JSON.stringify(k == null ? null : k); }

  function toon() { var ok = !!tok(); $("bw-instel").hidden = ok; $("bw-form").hidden = true; if (ok && (id || nieuwType !== "" || Q.has("nieuw"))) start(); else if (ok) $("bw-kies").hidden = false; }

  async function laadZoek() {
    if (zoek) return;
    zoek = await (await fetch(base + "zoek.json")).json();
    zoek.forEach(function (x) { byId[x[0]] = x; });
  }
  function naamVan(i) { return byId[i] ? byId[i][1] : i; }

  async function start() {
    $("bw-kies").hidden = true;
    await laadZoek();
    if (!id) {
      isNieuw = true; type = nieuwType;
      if (!TYPES[type]) { $("bw-kies").hidden = false; return; }
      d = { name: "", links: {} };
    } else {
      type = id.split("/")[0];
      var t = base + id + ".html"; $("bw-terug").href = t;
      var h = await (await fetch(t, { cache: "no-store" })).text();
      var k = 'id="hs-bron">', i = h.indexOf(k);
      d = i >= 0 ? JSON.parse(h.slice(i + k.length, h.indexOf("<" + "/script>", i))) : { name: "", text: "", listen: "" };
      var r = await api(R, "/contents/bouw/encyclopedie/" + MAP + "/" + id + ".json?ref=main&t=" + Date.now(), { cache: "no-store" });
      if (r.ok) { j = JSON.parse(de64((await r.json()).content)); d = Object.assign({}, d, j); }
      orig = JSON.parse(JSON.stringify(d));
    }
    if (!d.links) d.links = {};
    bouw();
    $("bw-form").hidden = false;
    document.title = (isNieuw ? "Nieuw lemma" : "Bewerk: " + (d.name || id));
  }

  // ---------- formulier ----------
  function veld(lbl, inner, tp) { return '<p class="bwv" data-t="' + (tp || "") + '"><label>' + lbl + "<br>" + inner + "</label></p>"; }
  function inp(idn, val, extra) { return '<input id="' + idn + '" value="' + esc(val) + '" style="width:100%" ' + (extra || "") + ">"; }
  function bouw() {
    var h = "";
    if (isNieuw) h += '<p><b>Nieuw lemma</b>: ' + TYPES[type] + '. Adres: <code id="bw-adres"></code></p>';
    h += veld("Naam", inp("f-name", d.name));
    h += veld("Tekst (lege regel tussen alinea's; [[...]] hoeft niet, namen worden automatisch gelinkt)", '<textarea id="f-text" rows="16" style="width:100%">' + esc(d.text) + "</textarea>");
    h += veld("Luistertip", '<textarea id="f-listen" rows="3" style="width:100%">' + esc(d.listen) + "</textarea>");
    if (!EN) {
      if (type === "artiest") {
        h += veld("Soort", '<select id="f-soortArtiest"><option value="">(automatisch)</option><option value="groep">Groep</option><option value="persoon">Persoon</option></select>');
        h += '<div class="bwrij">' + veld("Geboren (jaar)", inp("f-born", d.born)) + veld("Overleden (jaar)", inp("f-died", d.died)) + veld("Opgericht (jaar, voor groepen)", inp("f-year", d.year)) + "</div>";
        h += veld("Plaats (geboorte- of herkomstplaats)", inp("f-place", d.place));
        h += veld("Ook gespeld als (komma's)", inp("f-ook", (d.ook || []).join(", ")));
      } else if (type === "genre" || type === "techniek") {
        h += '<div class="bwrij">' + veld("Jaar", inp("f-year", d.year)) + veld("Plaats", inp("f-place", d.place)) + veld("Familie / categorie", inp("f-sub", d.sub)) + (type === "techniek" ? veld("Bedenker", inp("f-who", d.who)) : "") + "</div>";
      } else if (type === "werk") {
        h += '<div class="bwrij">' + veld("Artiest (tekst)", inp("f-artist", d.artist)) + veld("Jaar", inp("f-year", d.year)) + veld("Soort", '<select id="f-soort"><option value="">-</option><option>album</option><option>nummer</option><option>musical</option><option>radioshow</option></select>') + veld("Nr. studioalbum", inp("f-nr", d.nr)) + "</div>";
        h += veld("Hoes (URL), of upload een bestand", inp("f-cover", d.cover || "") + ' <input type="file" id="f-cover-up" accept="image/*">');
      }
      if (type === "artiest" || type === "genre" || type === "werk" || type === "techniek" || type === "begrip") {
        var f = d.foto || {};
        h += '<fieldset><legend>Afbeelding</legend><img id="f-foto-prev" style="max-width:220px;max-height:220px;display:block;margin:.4em 0" alt="">' +
          veld("Bestand uploaden (wordt verkleind en naar de beeld-repo gezet)", '<input type="file" id="f-foto-up" accept="image/*">') +
          veld("Of adres (URL of pad zoals img/naam.jpg)", inp("f-foto-src", f.src)) +
          '<div class="bwrij">' + veld("Maker", inp("f-foto-maker", f.maker)) + veld("Licentie", inp("f-foto-licentie", f.licentie)) + veld("Bron (URL)", inp("f-foto-bron", f.bron)) + "</div>" +
          '<button type="button" id="f-foto-weg">Afbeelding verwijderen</button></fieldset>';
      }
      if (type === "artiest") h += '<fieldset><legend>Discografie (studioalbums)</legend><div id="f-disco"></div><button type="button" id="f-disco-plus">+ album</button></fieldset>';
      if (type === "artiest") h += veld("Werk (een per regel, zonder discografie)", '<textarea id="f-works" rows="4" style="width:100%">' + esc((d.works || []).join(NL)) + "</textarea>");
      if (type === "begrip" || type === "genre" || type === "techniek") h += '<fieldset><legend>Definities</legend><div id="f-defs"></div><button type="button" id="f-defs-plus">+ definitie</button></fieldset>';
      h += '<fieldset><legend>Uit de tijdlijnen</legend><div id="f-extra"></div><button type="button" id="f-extra-plus">+ onderdeel</button></fieldset>';
      h += '<fieldset><legend>Verwijzingen naar andere lemma\'s</legend><div id="f-links"></div></fieldset>';
    } else h += '<p style="opacity:.7">In de Engelse versie pas je alleen naam en teksten aan; feiten, afbeelding en discografie pas je op de Nederlandse pagina aan.</p>';
    $("bw-velden").innerHTML = h;
    if (!isNieuw) $("bw-weg").hidden = EN; else $("bw-weg").hidden = true;
    if ($("f-soortArtiest")) $("f-soortArtiest").value = d.soortArtiest || "";
    if ($("f-soort")) $("f-soort").value = d.soort || "";
    if (isNieuw) { $("f-name").oninput = function () { $("bw-adres").textContent = type + "/" + slug($("f-name").value); }; }
    if (EN) return;
    state.disco = (d.disco || []).map(function (x) { return Object.assign({}, x); });
    state.defs = (d.defs || []).map(function (x) { return Object.assign({}, x); });
    state.extra = (d.extra || []).map(function (x) { return Object.assign({}, x); });
    state.links = JSON.parse(JSON.stringify(d.links || {}));
    tekenLijsten();
    if ($("f-disco-plus")) $("f-disco-plus").onclick = function () { lees(); state.disco.push({ jaar: "", titel: "" }); tekenLijsten(); };
    if ($("f-defs-plus")) $("f-defs-plus").onclick = function () { lees(); state.defs.push({ text: "", src: "" }); tekenLijsten(); };
    $("f-extra-plus").onclick = function () { lees(); state.extra.push({ titel: "", jaar: "", text: "" }); tekenLijsten(); };
    if ($("f-foto-up")) {
      $("f-foto-up").onchange = function () { upload(this.files[0], "img", function (src, naam) { $("f-foto-src").value = src; if (!$("f-foto-maker").value) $("f-foto-maker").value = "Eigen foto"; fotoPrev(); }); };
      $("f-foto-src").oninput = fotoPrev; fotoPrev();
      $("f-foto-weg").onclick = function () { $("f-foto-src").value = ""; $("f-foto-maker").value = ""; $("f-foto-licentie").value = ""; $("f-foto-bron").value = ""; fotoPrev(); };
    }
    if ($("f-cover-up")) $("f-cover-up").onchange = function () { upload(this.files[0], "hoes", function (src) { $("f-cover").value = BEELD + src; }); };
  }
  function fotoPrev() { var s = $("f-foto-src").value.trim(); $("f-foto-prev").src = s ? (/^https?:/.test(s) ? s : BEELD + s) : ""; $("f-foto-prev").hidden = !s; }

  function rij(inner, naam, i) {
    return '<div class="bwrij" data-l="' + naam + '" data-i="' + i + '" style="align-items:end">' + inner + '<span><button type="button" data-a="up">↑</button><button type="button" data-a="down">↓</button><button type="button" data-a="del">✕</button></span></div>';
  }
  function cel(c, v, w, ph) { return '<input data-c="' + c + '" value="' + esc(v) + '" placeholder="' + (ph || c) + '" style="' + (w ? "width:" + w : "flex:1") + '">'; }
  function tekenLijsten() {
    if ($("f-disco")) $("f-disco").innerHTML = state.disco.map(function (x, i) {
      return rij(cel("jaar", x.jaar, "5em", "jaar") + cel("titel", x.titel, "", "titel") + cel("id", x.id || "", "14em", "lemma-id (werk/...)") + '<label><input type="checkbox" data-c="sound"' + (x.soort === "soundtrack" ? " checked" : "") + "> soundtrack</label>", "disco", i);
    }).join("");
    if ($("f-defs")) $("f-defs").innerHTML = state.defs.map(function (x, i) { return rij(cel("text", x.text, "") + cel("src", x.src || "", "10em", "bron"), "defs", i); }).join("");
    $("f-extra").innerHTML = state.extra.map(function (x, i) { return rij(cel("titel", x.titel, "10em") + cel("jaar", x.jaar, "5em") + cel("text", x.text, ""), "extra", i); }).join("");
    var rels = REL[type] || []; Object.keys(state.links).forEach(function (k) { if (rels.indexOf(k) < 0) rels = rels.concat(k); });
    $("f-links").innerHTML = rels.map(function (k) {
      var l = state.links[k] || [];
      return '<div data-rel="' + k + '"><b>' + (RELNAAM[k] || k) + "</b>: " + l.map(function (x, i) { return '<span class="chip" style="display:inline-block;border:1px solid #888;border-radius:12px;padding:1px 8px;margin:2px">' + esc(naamVan(x)) + ' <a href="#" data-x="' + i + '">✕</a></span>'; }).join("") +
        ' <input data-add="' + k + '" list="dl-' + k + '" placeholder="zoek en kies…" style="width:16em"><datalist id="dl-' + k + '"></datalist></div>';
    }).join("");
  }
  function lees() { // formulier -> state (voor de lijsten)
    var g = function (naam) { return [].map.call(document.querySelectorAll('[data-l="' + naam + '"]'), function (r) { var o = {}; [].forEach.call(r.querySelectorAll("[data-c]"), function (c) { o[c.dataset.c] = c.type === "checkbox" ? c.checked : c.value; }); return o; }); };
    if ($("f-disco")) state.disco = g("disco").map(function (o) { var x = { titel: o.titel.trim(), jaar: /^\d+$/.test(o.jaar.trim()) ? +o.jaar : o.jaar.trim() }; if (o.id.trim()) x.id = o.id.trim(); if (o.sound) x.soort = "soundtrack"; return x; });
    if ($("f-defs")) state.defs = g("defs").map(function (o) { var x = { text: o.text.trim() }; if (o.src.trim()) x.src = o.src.trim(); return x; });
    state.extra = g("extra").map(function (o) { return { titel: o.titel.trim(), jaar: /^\d+$/.test(o.jaar.trim()) ? +o.jaar : o.jaar.trim(), text: o.text.trim() }; });
  }
  document.addEventListener("click", function (e) {
    var b = e.target; if (!b.closest || !$("bw-velden") || !$("bw-velden").contains(b)) return;
    var x = b.dataset && b.dataset.x;
    if (x !== undefined && x !== "") { e.preventDefault(); var rel = b.closest("[data-rel]").dataset.rel; state.links[rel].splice(+x, 1); lees(); tekenLijsten(); return; }
    var a = b.dataset && b.dataset.a; if (!a) return;
    var r = b.closest("[data-l]"), n = r.dataset.l, i = +r.dataset.i; lees();
    var arr = state[n]; if (a === "del") arr.splice(i, 1); else { var t = a === "up" ? i - 1 : i + 1; if (t < 0 || t >= arr.length) return; var tmp = arr[i]; arr[i] = arr[t]; arr[t] = tmp; }
    tekenLijsten();
  });
  document.addEventListener("input", function (e) {
    var t = e.target; if (!t.dataset || !t.dataset.add) return;
    var v = t.value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""), dl = $("dl-" + t.dataset.add), o = "";
    var m = /\((\S+\/\S+)\)$/.exec(t.value);
    if (m) { var k = t.dataset.add; state.links[k] = (state.links[k] || []).concat(m[1]); lees(); tekenLijsten(); return; }
    if (v.length < 2) { dl.innerHTML = ""; return; }
    var n = 0; for (var i = 0; i < zoek.length && n < 25; i++) { var z = zoek[i]; if (z[1].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").indexOf(v) >= 0) { o += '<option value="' + esc(z[1] + " (" + z[0] + ")") + '">' + esc(z[2]) + "</option>"; n++; } }
    dl.innerHTML = o;
  });

  // ---------- afbeelding uploaden naar hitstory-beeld ----------
  function upload(file, map, klaar) {
    if (!file) return;
    st("Afbeelding verkleinen…");
    var fr = new FileReader();
    fr.onload = function () {
      var im = new Image();
      im.onload = async function () {
        try {
          var max = map === "hoes" ? 600 : 1000, s = Math.min(1, max / Math.max(im.width, im.height));
          var c = document.createElement("canvas"); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
          c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
          var data = c.toDataURL("image/jpeg", 0.86).split(",")[1];
          var naam = map + "/" + (slug(($("f-name") && $("f-name").value) || id.split("/")[1] || "afbeelding") || "afbeelding") + "-" + Date.now().toString(36) + ".jpg";
          st("Uploaden naar de beeld-repo…");
          var p = await api(RB, "/contents/" + naam, { method: "PUT", body: JSON.stringify({ message: "Afbeelding via HitStory: " + naam, content: data, branch: "main" }) });
          if (!p.ok) throw new Error("uploaden mislukt (" + p.status + "); geef de sleutel ook toegang (Contents: lezen en schrijven) tot " + RB);
          st("Afbeelding geüpload; het duurt ongeveer een minuut voor ze op " + BEELD.replace("https://", "") + " staat.");
          klaar(naam, naam);
        } catch (er) { st("Fout: " + er.message, true); }
      };
      im.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  // ---------- opslaan ----------
  function num(v) { v = String(v).trim(); return v === "" ? null : (isNaN(+v) ? v : +v); }
  function verzamel() {
    lees();
    var cur = { name: $("f-name").value.trim(), text: $("f-text").value.split(CR).join("").trim(), listen: $("f-listen").value.trim() };
    if (!EN) {
      var s = function (i) { return $(i) ? $(i).value.trim() : undefined; };
      ["soortArtiest", "place", "sub", "who", "artist", "soort"].forEach(function (k) { var v = s("f-" + k); if (v !== undefined) cur[k] = v; });
      ["born", "died", "year", "nr"].forEach(function (k) { if ($("f-" + k)) cur[k] = num($("f-" + k).value); });
      if ($("f-ook")) cur.ook = $("f-ook").value.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
      if ($("f-works")) cur.works = $("f-works").value.split(NL).map(function (x) { return x.trim(); }).filter(Boolean);
      if ($("f-cover") && $("f-cover").value.trim()) cur.cover = $("f-cover").value.trim();
      if ($("f-disco")) cur.disco = state.disco.filter(function (x) { return x.titel; });
      if ($("f-defs")) cur.defs = state.defs.filter(function (x) { return x.text; });
      cur.extra = state.extra.filter(function (x) { return x.text || x.titel; });
      if ($("f-foto-src")) { var src = $("f-foto-src").value.trim(); cur.foto = src ? Object.assign({}, (d.foto || {}), { src: src, maker: $("f-foto-maker").value.trim(), licentie: $("f-foto-licentie").value.trim(), bron: $("f-foto-bron").value.trim() }) : null; }
      cur.links = {}; Object.keys(state.links).forEach(function (k) { cur.links[k] = state.links[k]; });
    }
    return cur;
  }
  $("bw-opslaan").onclick = async function () {
    try {
      var cur = verzamel(), body = {}, pad, vid = id;
      if (!cur.name) throw new Error("vul een naam in");
      if (isNieuw) {
        var sl = slug(cur.name); if (!sl) throw new Error("naam bevat geen letters of cijfers");
        vid = type + "/" + sl;
        if (byId[vid]) throw new Error("dit lemma bestaat al: " + vid);
        body = Object.assign({ nieuw: true }, cur);
        Object.keys(body).forEach(function (k) { if (body[k] === "" || body[k] === null || (Array.isArray(body[k]) && !body[k].length) || (k === "links" && !Object.keys(body[k]).length)) delete body[k]; });
        body.name = cur.name;
      } else {
        body = Object.assign({}, j);
        Object.keys(cur).forEach(function (k) {
          var oud = orig ? orig[k] : undefined;
          var norm = function (x) { return ev(x === "" || x === undefined || (Array.isArray(x) && !x.length) ? null : x); };
          if (k === "links") { var jl = Object.assign({}, orig && orig.links || {}); if (norm(cur.links) !== norm(jl)) body.links = cur.links; return; }
          if (norm(cur[k]) !== norm(oud) || k in j) body[k] = cur[k] === undefined ? null : cur[k];
        });
      }
      st("Bezig met opslaan…");
      pad = "/contents/bouw/encyclopedie/" + MAP + "/" + vid + ".json";
      var p, n = 0;
      do {
        var g = await api(R, pad + "?ref=main&t=" + Date.now(), { cache: "no-store" }), sha = g.ok ? (await g.json()).sha : undefined;
        p = await api(R, pad, { method: "PUT", body: JSON.stringify({ message: (isNieuw ? "Nieuw lemma via HitStory: " : "Bewerkt via HitStory: ") + vid, content: b64(JSON.stringify(body, null, 1)), branch: "main", sha: sha }) });
        n++; if (p.status === 409) await new Promise(function (r) { setTimeout(r, 1500); });
      } while (p.status === 409 && n < 4);
      if (!p.ok) throw new Error("opslaan mislukt (" + p.status + ")");
      st("Opgeslagen. De bouw loopt; over ongeveer twee minuten staat het online.");
      if (isNieuw) { $("bw-terug").href = base + vid + ".html"; $("bw-terug").textContent = "→ naar de nieuwe pagina (over twee minuten)"; }
    } catch (er) { st("Fout: " + er.message, true); }
  };
  $("bw-weg").onclick = async function () {
    if (!confirm("Dit lemma van de site halen? (Het kan later hersteld worden door het bestand in bewerkt/ te verwijderen.)")) return;
    try {
      var pad = "/contents/bouw/encyclopedie/" + MAP + "/" + id + ".json";
      var g = await api(R, pad + "?ref=main&t=" + Date.now(), { cache: "no-store" }), sha = g.ok ? (await g.json()).sha : undefined;
      var p = await api(R, pad, { method: "PUT", body: JSON.stringify({ message: "Lemma verwijderd via HitStory: " + id, content: b64(JSON.stringify({ verwijderd: true })), branch: "main", sha: sha }) });
      if (!p.ok) throw new Error("mislukt (" + p.status + ")");
      st("Verwijderd; over ongeveer twee minuten is het weg van de site.");
    } catch (er) { st("Fout: " + er.message, true); }
  };
  $("bw-bewaar-token").onclick = function () { var v = $("bw-token").value.trim(); if (v) { localStorage.setItem("hs_token", v); toon(); } };
  $("bw-uit").onclick = function (e) { e.preventDefault(); localStorage.removeItem("hs_token"); toon(); };
  $("bw-kies").innerHTML = "<p>Wat wil je maken?</p><p>" + Object.keys(TYPES).map(function (t) { return '<a href="?nieuw=' + t + '" style="margin-right:1em">+ ' + TYPES[t] + "</a>"; }).join("") + "</p>";
  toon();
})();
