// HitStory (popencyclopedie): bouwt site/encyclopedie/ uit data/lemmas.json (zie verzamel.ts), in Wikipedia-opzet.
// index.html = hoofdpagina (uitgelicht, portalen, zoeken); alle.html = A-Z met filters;
// <type>/<id>.html = lemma met infobox, inhoudsopgave, interne links, discografie, bronnen en categorieën.
// zoek.json = naam/id/soort voor de zoekbalk en "willekeurig lemma".
// Gebruik: deno run -A encyclopedie/maak.ts   (vanuit SoR-werk)

const W = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const OUT = W + "site/encyclopedie/";
const L: any[] = JSON.parse(Deno.readTextFileSync(W + "encyclopedie/data/lemmas.json"));
const byId = new Map(L.map((l) => [l.id, l]));
const r = (p: string) => JSON.parse(Deno.readTextFileSync(p).replace(/^\uFEFF/, ""));
const exists = (p: string) => { try { Deno.statSync(p); return true; } catch { return false; } };

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const TYPE: Record<string, [string, string]> = { // id -> [enkelvoud, meervoud]
  artiest: ["Artiest", "Artiesten"], genre: ["Genre", "Genres"], werk: ["Album of nummer", "Albums en nummers"],
  begrip: ["Begrip", "Begrippen"], techniek: ["Techniek", "Techniek"],
};
const SOORT: Record<string, string> = { album: "Album", nummer: "Nummer", musical: "Musical", radioshow: "Radioshow" };
const sortKey = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/^(the|de|het|'t)\s+/i, "").replace(/^[^a-z0-9]+/i, "").toLowerCase();
const letter = (s: string) => { const c = sortKey(s)[0] || "#"; return /[a-z]/.test(c) ? c.toUpperCase() : "#"; };
const label = (l: any) => l.type === "werk" ? SOORT[l.soort] || "Werk" : TYPE[l.type][0];
const jaren = (l: any) => l.born ? `${l.born}${l.died ? "–" + l.died : ""}` : l.year ? String(Math.floor(l.year)) : "";
const isGroep = (l: any) => l.soortArtiest === "groep" || (!l.born && /^(the|de|het)\s|\s(&|and|en)\s|band|orchestra|orkest|ensemble|brothers|sisters|boys|girls|quartet|trio|five|four/i.test(l.name));
const sub = (l: any) => l.type === "werk" ? [l.sub, jaren(l)].filter(Boolean).join(" · ")
  : l.type === "artiest" ? [jaren(l), l.links.genre?.map((g: string) => byId.get(g)?.name).slice(0, 2).join(", ")].filter(Boolean).join(" · ")
  : l.type === "begrip" ? (l.defs?.[0]?.text || "") : [l.sub, jaren(l)].filter(Boolean).join(" · ");
const href = (id: string, root = "../..") => `${root}/encyclopedie/${id}.html`;
const a = (id: string, root?: string) => { const x = byId.get(id); return x ? `<a href="${href(id, root)}">${esc(x.name)}</a>` : ""; };
const lijstNL = (xs: string[]) => xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " en " + xs[xs.length - 1];

// ---------- Bronnen uit de factcheck (per artiestnaam) ----------
const BRONNEN = new Map<string, string[]>();
const FC = W + "encyclopedie/factcheck/";
if (exists(FC)) for (const f of Deno.readDirSync(FC)) {
  let kop = "";
  for (const regel of Deno.readTextFileSync(FC + f.name).split(/\r?\n/)) {
    const k = regel.match(/^#\s+(.+)$/); if (k) { kop = k[1].trim().toLowerCase(); continue; }
    if (!kop || /^(twijfel|mogelijke fout)/i.test(kop)) continue;
    for (const u of regel.match(/https?:\/\/[^\s;,)]+/g) || []) { const l = BRONNEN.get(kop) || BRONNEN.set(kop, []).get(kop)!; if (!l.includes(u)) l.push(u); }
  }
}
const bronNaam = (u: string) => {
  try {
    const x = new URL(u); const host = x.hostname.replace(/^www\./, "").replace(/:443$/, "");
    const wiki = host.match(/^(\w+)\.wikipedia\.org$/);
    if (wiki) return `Wikipedia (${wiki[1]}): ${decodeURIComponent(x.pathname.split("/").pop() || "").replace(/_/g, " ")}`;
    return host;
  } catch { return u; }
};

// ---------- Interne links in lopende tekst ----------
// Artiesten en werken hoofdlettergevoelig; genres, begrippen en techniek ook in kleine letters (vanaf 5 tekens).
const DUBBEL = new Set((exists(W + "encyclopedie/dubbelzinnig.json") ? r(W + "encyclopedie/dubbelzinnig.json") : []).map((x: string) => x.toLowerCase()));
const exact = new Map<string, string>(), klein = new Map<string, string>();
// Bandnamen die ook gewone woorden zijn, maar met hoofdletter midden in een zin vrijwel altijd de band: die linken we met een voorzichtige regel (zie linkBasis)
const VEILIG_DUBBEL = new Set(["Queen", "Cream", "Chic", "Madness", "Muse", "Kiss"]);
for (const l of L) {
  const n = l.name.trim();
  if (l.type === "artiest" && VEILIG_DUBBEL.has(n) && !exact.has(n)) { exact.set(n, l.id); continue; }
  if (n.length < 4 || DUBBEL.has(n.toLowerCase()) || l.album) continue;
  if (l.type === "artiest" || l.type === "werk") { if (!exact.has(n)) exact.set(n, l.id); }
  else if (n.length >= 5 && !klein.has(n.toLowerCase())) klein.set(n.toLowerCase(), l.id);
}
const alle = [...new Set([...exact.keys(), ...klein.keys()])].sort((x, y) => y.length - x.length);
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const LINKRE = new RegExp("(?<![\\p{L}\\d])(" + alle.map(reEsc).join("|") + ")(?![\\p{L}\\d])", "giu");
// Albums alleen linken in de context van hun artiest: in het artikel over die artiest (of een ander album van hem),
// of in een alinea waarin de artiest zelf genoemd wordt. Zo wordt "Help!" of "Thriller" niet overal een link.
const albumsVan = new Map<string, Map<string, string>>(); // artiest-id -> titel -> album-id
for (const l of L) {
  const art = l.album && l.links?.artiest?.[0];
  const n = l.name.trim();
  if (!art || (n.length < 4 && !/s/.test(n)) || n === byId.get(art)?.name) continue;
  (albumsVan.get(art) || albumsVan.set(art, new Map()).get(art)!).set(n, l.id);
}
// Artiesten bij een pagina: de artiest zelf, of de artiest(en) van een werk. Hun eigen naam wordt in die context altijd gelinkt, ook als de naam dubbelzinnig is (zoals Queen).
const artiestenVan = (id: string): string[] => id.startsWith("artiest/") ? [id] : (byId.get(id)?.links?.artiest || []).slice(0, 3);
function linkify(tekst: string, zelf: string, gezien: Set<string>) {
  let uit = "", pos = 0;
  const ctx = new Set<string>();
  for (const a of artiestenVan(zelf)) ctx.add(a);
  for (const m of tekst.matchAll(LINKRE)) { const id = exact.get(m[0]); if (id && albumsVan.has(id)) ctx.add(id); }
  const alb = new Map<string, string>();
  for (const a of ctx) for (const [t, id] of albumsVan.get(a) || []) if (!alb.has(t)) alb.set(t, id);
  for (const a of ctx) { const n = byId.get(a)?.name?.trim(); if (n && n.length >= 3 && !alb.has(n)) alb.set(n, a); }
  if (alb.size) {
    // eerst de albums (hoofdlettergevoelig), daarna de gewone links in de stukken ertussen
    const re = new RegExp("(?<![\\p{L}\\d])(" + [...alb.keys()].sort((x, y) => y.length - x.length).map(reEsc).join("|") + ")(?![\\p{L}\\d])", "gu");
    for (const m of tekst.matchAll(re)) {
      const id = alb.get(m[0])!;
      if (id === zelf || gezien.has(id)) continue;
      gezien.add(id);
      uit += linkBasis(tekst.slice(pos, m.index), zelf, gezien) + `<a href="${href(id)}">${esc(m[0])}</a>`;
      pos = m.index! + m[0].length;
    }
  }
  return uit + linkBasis(tekst.slice(pos), zelf, gezien);
}
function linkBasis(tekst: string, zelf: string, gezien: Set<string>) {
  let uit = "", pos = 0;
  for (const m of tekst.matchAll(LINKRE)) {
    const id = exact.get(m[0]) || klein.get(m[0].toLowerCase());
    if (!id || id === zelf || gezien.has(id)) continue;
    if (VEILIG_DUBBEL.has(m[0])) {
      // niet aan het begin van een zin, en niet gevolgd door een woord met hoofdletter (Queen Elizabeth, Kiss Me)
      const voor = tekst.slice(0, m.index).trimEnd(), na = tekst.slice(m.index! + m[0].length);
      if (!/[a-zà-ÿ,(]$/.test(voor) || /^\s+[A-ZÀ-Ý]/.test(na)) continue;
    }
    gezien.add(id);
    uit += esc(tekst.slice(pos, m.index)) + `<a href="${href(id)}">${esc(m[0])}</a>`;
    pos = m.index! + m[0].length;
  }
  return uit + esc(tekst.slice(pos));
}
// Naam vet bij de eerste vermelding in de inleiding, zoals op Wikipedia
const vet = (html: string, naam: string) => { const i = html.indexOf(esc(naam)); return i < 0 ? `<b>${esc(naam)}</b> · ` + html : html.slice(0, i) + `<b>${esc(naam)}</b>` + html.slice(i + esc(naam).length); };

const CSS = Deno.readTextFileSync(W + "encyclopedie/stijl.css"); // SoR-huisstijl, Wikipedia-opbouw

const ZOEK_JS = (root: string) => `<script>(function(){const R=${JSON.stringify(root)};let data=null;const get=()=>data?Promise.resolve(data):fetch(R+'/encyclopedie/zoek.json').then(r=>r.json()).then(j=>data=j);const n=s=>s.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase();document.querySelectorAll('.zoek').forEach(z=>{const i=z.querySelector('input'),u=z.querySelector('ul');let k=-1;const go=async()=>{const v=n(i.value.trim());if(!v){u.hidden=true;return}const d=await get();const a=[],b=[];for(const x of d){const m=n(x[1]);if(m.startsWith(v))a.push(x);else if(m.includes(v))b.push(x);if(a.length>=10)break}const res=a.concat(b).slice(0,10);u.innerHTML=res.map(x=>'<li><a href="'+R+'/encyclopedie/'+x[0]+'.html">'+x[1].replace(/</g,'&lt;')+'<small>'+x[2]+'</small></a></li>').join('');u.hidden=!res.length;k=-1};i.addEventListener('input',go);i.addEventListener('keydown',e=>{const l=[...u.querySelectorAll('a')];if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();k=Math.max(0,Math.min(l.length-1,k+(e.key==='ArrowDown'?1:-1)));l.forEach((x,j)=>x.classList.toggle('act',j===k))}if(e.key==='Enter'&&l.length){location.href=(l[k]||l[0]).href}});document.addEventListener('click',e=>{if(!z.contains(e.target))u.hidden=true})});document.querySelectorAll('.rnd').forEach(a=>a.onclick=async e=>{e.preventDefault();const d=await get();location.href=R+'/encyclopedie/'+d[Math.floor(Math.random()*d.length)][0]+'.html'})})();</script>`;

const page = (root: string, title: string, desc: string, body: string, script = "", index = true) => `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="sor-root" content="${root}"><title>${esc(title)} – HitStory | School of Rock</title><meta name="description" content="${esc(desc)}">${index ? "" : '<meta name="robots" content="noindex, follow">'}<link rel="icon" href="${root}/assets/cassette.png"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:ital,wght@0,400;0,600;0,700;1,400&family=Space+Mono:wght@400;700&family=Caveat:wght@600&display=swap"><link rel="stylesheet" href="${root}/assets/site.css"><link rel="stylesheet" href="${root}/encyclopedie/enc.css"><script src="${root}/assets/player.js"></script><script src="${root}/assets/nav.js"></script></head><body><header class="sitenav"><a class="brand" href="${root}/index.html"><img src="${root}/assets/cassette.png" alt=""><span>School of Rock</span></a><nav aria-label="Hoofdmenu"><a href="${root}/index.html#mixtapes">Mixtapes</a><a href="${root}/kaart.html">Genrekaart</a><a href="${root}/magazine/index.html">Magazine</a><a href="${root}/encyclopedie/index.html" aria-current="page">Encyclopedie</a><a href="${root}/begrippen.html">Begrippen</a><a href="${root}/opdrachten.html">Opdrachten</a></nav></header>
<div class="wk"><div class="wkbar"><a class="logo" href="${root}/encyclopedie/index.html">HitStory<small>popencyclopedie van School of Rock</small></a><div class="zoek"><input type="search" placeholder="Zoeken in HitStory" aria-label="Zoeken" autocomplete="off"><ul hidden></ul></div><a class="rnd" href="#">Willekeurig artikel</a> <a href="${root}/encyclopedie/alle.html">Alle artikelen A–Z</a></div>
<main class="blad">${body}</main></div><footer class="sitefoot"><div class="wrap"><p>HitStory, de popencyclopedie van School of Rock · De geschiedenis van popmuziek in mixtapes · Jan-Wolter Smit · ArtEZ University of the Arts</p><p>Teksten gecontroleerd aan de hand van de genoemde bronnen. Discografieën: MusicBrainz (CC0). Foto's: Wikimedia Commons, met maker en licentie bij elke foto.</p></div></footer>${ZOEK_JS(root)}${script}</body></html>`;

const FRAG_JS = `<script>(function(){const T=JSON.parse(document.getElementById('frags-data').textContent);document.querySelectorAll('.frags button').forEach(b=>{const t=T[+b.dataset.t];const paint=()=>{b.innerHTML=SOR.isPlaying(t)?SOR.pauseIcon:SOR.playIcon};paint();b.onclick=()=>{SOR.isPlaying(t)?SOR.pause():SOR.play(t)};SOR.onChange(paint)})})();</script>`;

const TL_JS = `<script>(function(){const T=JSON.parse(document.getElementById('tl-data').textContent);document.querySelectorAll('.tl button').forEach(b=>{const t=T[+b.dataset.i];const paint=()=>{b.innerHTML=SOR.isPlaying(t)?SOR.pauseIcon:SOR.playIcon};paint();b.onclick=()=>{SOR.isPlaying(t)?SOR.pause():SOR.play(t)};SOR.onChange(paint)})})();</script>`;

// Hoezen zelf gehost (hoezen.ts): pad vanaf de siteroot, werkt ook in de speler op elke pagina
const HOEZEN: Record<string, string> = exists(W + "encyclopedie/data/hoezen.json") ? r(W + "encyclopedie/data/hoezen.json") : {};
// Afbeeldingen staan in een aparte repository (gsleraar-hue/hitstory-beeld, op beeld.sorock.nl), want sorock.nl zit bijna aan de 1 GB van GitHub Pages
const BEELD = "https://beeld.sorock.nl/";
const hoes = (u?: string) => !u ? "" : u.startsWith("https://sorock.nl/") ? u.slice(17) : HOEZEN[u] ? BEELD + "hoes/" + HOEZEN[u] : u;

// ---------- Infobox ----------
function infobox(l: any) {
  const rij = (k: string, v: string) => v ? `<tr><th>${k}</th><td>${v}</td></tr>` : "";
  const links = (rel: string, max = 6) => (l.links[rel] || []).slice(0, max).map((id: string) => a(id)).filter(Boolean).join(", ");
  const mixtapes = [...new Set((l.refs || []).filter((x: any) => x.kind !== "kaart").map((x: any) => {
    const m = x.label.match(/^Mixtape (\d+)/); return m ? `<a href="../../${esc(x.href.split("#")[0])}">Mixtape ${m[1]}</a>` : x.kind === "magazine" ? `<a href="../../${esc(x.href.split("#")[0])}">Magazine</a>` : "";
  }).filter(Boolean))].join(", ");
  let rows = "";
  if (l.type === "artiest") {
    const groep = isGroep(l);
    rows += groep ? rij("Opgericht", l.year ? String(Math.floor(l.year)) : "") + rij("Herkomst", esc(l.place || ""))
      : rij("Geboren", [l.born, l.place].filter(Boolean).map(esc).join(", ")) + rij("Overleden", l.died ? String(l.died) : "");
    rows += rij("Genre", links("genre"));
    if (l.disco?.length) { const js = l.disco.map((x: any) => x.jaar).filter(Boolean); rows += rij("Studioalbums", `${l.disco.length}${js.length ? ` (${Math.min(...js)}–${Math.max(...js)})` : ""}`); }
    rows += rij("Bekende werken", links("werk", 5)) + rij("Beïnvloed door", links("invloed", 4)) + rij("Ook gespeld als", (l.ook || []).map(esc).join(", "));
  } else if (l.type === "genre") {
    rows += rij("Ontstaan", [l.year ? String(Math.floor(l.year)) : "", l.place].filter(Boolean).map(esc).join(", ")) + rij("Familie", esc(l.sub || "")) + rij("Wortels", links("wortels")) + rij("Daarna", links("daarna")) + rij("Artiesten", links("artiest", 6));
  } else if (l.type === "werk") {
    const t = l.tracklijst;
    const duur = t ? Math.round(t.tracks.reduce((s: number, x: any) => s + (x.ms || 0), 0) / 60000) : 0;
    rows += rij("Soort", l.nr ? `${l.nr}e studioalbum` : SOORT[l.soort] || "Werk") + rij("Artiest", (l.links.artiest || []).map((id: string) => a(id)).join(", ") || esc(l.sub)) + rij("Jaar", l.year ? String(l.year) : "") + rij("Schrijver/producer", (l.links.maker || []).map((id: string) => a(id)).join(", "));
    if (t) rows += rij("Genre", esc(t.genre || "")) + rij("Nummers", `${t.tracks.length}${duur ? ` (${duur} min.)` : ""}`) + rij("Vorige", l.vorige ? a(l.vorige) : "") + rij("Volgende", l.volgende ? a(l.volgende) : "");
  } else if (l.type === "techniek") {
    rows += rij("Jaar", l.year ? String(Math.floor(l.year)) : "") + rij("Plaats", esc(l.place || "")) + rij("Bedenker", esc(l.who || "")) + rij("Categorie", esc(l.sub || "")) + rij("Genres", links("genre"));
  }
  rows += rij("In School of Rock", mixtapes);
  if (!rows && !l.foto) return "";
  const foto = !l.foto && l.tracklijst?.cover ? `<img src="${esc(hoes(l.tracklijst.cover))}" alt="Hoes van ${esc(l.name)}">` : l.foto ? `<img src="${BEELD}${esc(l.foto.src)}" alt="${esc(l.name)}"><div class="fcap">${esc(l.foto.maker).slice(0, 80)} · <a href="${esc(l.foto.bron)}" target="_blank" rel="noopener">${esc(l.foto.licentie)}</a></div>` : "";
  return `<aside class="info ${l.type}"><div class="kop">${esc(l.name)}</div>${foto}<table>${rows}</table></aside>`;
}

// Inleiding voor lemma's zonder eigen tekst: alleen wat vaststaat, geen verzinsels.
function stubLead(l: any) {
  const genres = (l.links.genre || []).slice(0, 3).map((id: string) => a(id));
  const hoofdst = [...new Set((l.refs || []).filter((x: any) => x.kind === "hoofdstuk").map((x: any) => x.label.replace(/:.*/, "")))] as string[];
  if (l.album) {
    const art = (l.links.artiest || []).map((id: string) => a(id)).join(", ") || esc(l.artist || "");
    return `<p><b>${esc(l.name)}</b> is ${l.nr ? `het ${l.nr}e studioalbum` : "een studioalbum"} van ${art}${l.year ? `, uitgebracht in ${l.year}` : ""}.${l.tracklijst ? ` Het album telt ${l.tracklijst.tracks.length} nummers.` : ""}</p>`;
  }
  const wat = l.type === "artiest" ? (isGroep(l) ? "een muziekgroep" : "een artiest") : label(l).toLowerCase();
  let s = `<b>${esc(l.name)}</b>${l.born ? ` (${jaren(l)})` : ""} is ${wat}`;
  if (genres.length) s += ` (${genres.length > 1 ? "genres" : "genre"}: ${lijstNL(genres)})`;
  s += hoofdst.length ? `. School of Rock noemt ${isGroep(l) ? "de groep" : l.type === "artiest" ? "deze artiest" : "dit artikel"} in ${lijstNL(hoofdst)}.` : ".";
  return `<p>${s}</p>`;
}

// ---------- Lemma-pagina ----------
function lemmaPage(l: any) {
  const gezien = new Set<string>();
  const secties: [string, string, string][] = []; // [id, kop, html]
  let lead = "";
  const alineas = String(l.text || "").split(/\n\n+/).filter(Boolean);
  if (l.type === "begrip") lead = (l.defs || []).map((d: any, i: number) => `<p>${i ? "" : `<b>${esc(l.name)}</b>: `}${linkify(d.text, l.id, gezien)}${d.src ? ` <span class="klein">(${esc(d.src)})</span>` : ""}</p>`).join("");
  if (alineas.length) {
    const html = alineas.map((p) => linkify(p, l.id, gezien));
    if (l.type === "artiest" && html.length === 3) {
      lead += `<p>${vet(html[0], l.name)}</p>`;
      secties.push(["muziek", "Muziek en doorbraak", `<p>${html[1]}</p>`], ["invloed", "Invloed", `<p>${html[2]}</p>`]);
    } else lead += html.map((p, i) => `<p>${i ? p : vet(p, l.name)}</p>`).join("");
  }
  if (!lead) { lead = stubLead(l); for (const id of (l.links.genre || []).slice(0, 3)) gezien.add(id); }
  if (l.extra?.length) secties.push(["geschiedenis", "Uit de tijdlijnen", l.extra.map((e: any) => `<h3>${esc(e.titel)} (${e.jaar})</h3><p>${linkify(e.text, l.id, gezien)}</p>`).join("")]);
  const tracks = (l.tracks || []).filter((t: any) => t.audio).slice(0, 12);
  if (l.listen || tracks.length) {
    let h = l.listen ? `<div class="tip"><b>Luistertip.</b> ${linkify(l.listen, l.id, gezien)}</div>` : "";
    if (tracks.length) h += `<ul class="frags">${tracks.map((t: any, i: number) => `<li><button data-t="${i}" aria-label="Speel ${esc(t.title)}"></button>${t.cover ? `<img src="${esc(hoes(t.cover))}" alt="" loading="lazy">` : "<span></span>"}<div class="w"><b>${esc(t.title)}</b> <span>· ${esc(t.artist)}${t.year ? ", " + t.year : ""}</span></div>${t.store ? `<a class="ap" href="${esc(t.store)}" target="_blank" rel="noopener">Apple Music ↗</a>` : "<span></span>"}</li>`).join("")}</ul><script type="application/json" id="frags-data">${JSON.stringify(tracks.map((t: any) => ({ audio: t.audio, artist: t.artist, title: t.title, cover: hoes(t.cover), year: t.year }))).replace(/</g, "\\u003c")}</script>`;
    secties.push(["luisteren", "Luisteren", h]);
  }
  if (l.tracklijst) {
    const t = l.tracklijst, discs = new Set(t.tracks.map((x: any) => x.disc)).size;
    const mmss = (ms: number) => ms ? `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, "0")}` : "";
    let h = "", disc = 0;
    t.tracks.forEach((x: any, i: number) => {
      if (discs > 1 && x.disc !== disc) { if (disc) h += "</ol>"; disc = x.disc; h += `<h3>Cd ${disc}</h3><ol class="tl">`; } else if (!i) h += `<ol class="tl">`;
      h += `<li><span class="n">${x.n}</span>${x.audio ? `<button data-i="${i}" aria-label="Speel ${esc(x.titel)}"></button>` : "<span></span>"}<span class="t">${esc(x.titel)}</span><span class="d">${mmss(x.ms)}</span>${x.store ? `<a class="ap" href="${esc(x.store)}" target="_blank" rel="noopener">Apple Music ↗</a>` : "<span></span>"}</li>`;
    });
    h += "</ol>";
    h += `<p class="klein">Fragmenten van 30 seconden via Apple Music.${t.store ? ` <a href="${esc(t.store)}" target="_blank" rel="noopener">Beluister het hele album op Apple Music ↗</a>` : ""}</p>`;
    h += `<script type="application/json" id="tl-data">${JSON.stringify(t.tracks.map((x: any) => ({ audio: x.audio, artist: l.artist || l.sub, title: x.titel, cover: hoes(t.cover), year: l.year }))).replace(/</g, "\u003c")}</script>`;
    secties.push(["tracklijst", "Tracklijst", h]);
  }
  if (l.disco?.length) secties.push(["discografie", "Discografie", `<h3>Studioalbums</h3><ul class="disco">${l.disco.map((x: any) => `<li><span class="j">${x.jaar || "?"}</span><i>${x.id && byId.has(x.id) ? a(x.id) : esc(x.titel)}</i>${x.soort === "soundtrack" ? " (soundtrack)" : ""}</li>`).join("")}</ul>`]);
  if (l.works?.length) secties.push(["werk", "Werk", `<ul class="disco">${l.works.map((w: string) => `<li>${esc(w)}</li>`).join("")}</ul>`]);
  const sor = (l.refs || []);
  if (sor.length) {
    const kind: Record<string, string> = { hoofdstuk: "Reader", magazine: "Magazine", kaart: "Kaart" };
    secties.push(["sor", "In School of Rock", `<ul class="vermeld">${sor.map((x: any) => `<li><a href="../../${esc(x.href)}">${esc(x.label)}</a> <span class="klein">${kind[x.kind] || x.kind}</span>${x.zin ? `<q>${linkify(x.zin, l.id, new Set(gezien))}</q>` : ""}</li>`).join("")}</ul>`]);
  }
  if (l.vermeld?.length) secties.push(["vermeld", "Genoemd in andere artikelen", `<ul class="vermeld">${l.vermeld.map((v: any) => `<li>${a(v.id)} <span class="klein">${esc(label(byId.get(v.id) || {}))}</span><q>${linkify(v.zin, l.id, new Set([...gezien, v.id]))}</q></li>`).join("")}</ul>`]);
  const zie = [...new Set(["artiest", "maker", "werk", "wortels", "daarna", "genre", "techniek", "invloed", "invloed-op"].flatMap((k) => l.links[k] || []))].filter((id: string) => !gezien.has(id) && byId.has(id) && !(l.type === "artiest" && byId.get(id).album)).slice(0, 30);
  if (zie.length) secties.push(["zieook", "Zie ook", `<ul class="ziezook">${zie.map((id) => `<li>${a(id)}</li>`).join("")}</ul>`]);
  const bronnen = BRONNEN.get(l.name.toLowerCase()) || [];
  if (bronnen.length) secties.push(["bronnen", "Bronnen", `<ol class="bron">${bronnen.map((u) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(bronNaam(u))}</a></li>`).join("")}</ol>`]);

  let b = `<h1>${esc(l.name)}</h1><p class="tag">Uit HitStory, de popencyclopedie van School of Rock · ${esc(label(l))}</p>`;
  b += infobox(l) + lead;
  const koppen = secties.filter(([id]) => id !== "zieook" && id !== "bronnen");
  if (koppen.length >= 3) b += `<nav class="toc"><b>Inhoud</b><ol>${secties.map(([id, kop]) => `<li><a href="#${id}">${kop}</a></li>`).join("")}</ol></nav>`;
  for (const [id, kop, h] of secties) b += `<h2 id="${id}">${kop}</h2>${h}`;
  if (l.stub) b += `<div class="stub"><span>beginnetje</span><div>Dit artikel is nog kort. Er komt nog een uitgebreidere tekst over ${esc(l.name)}.</div></div>`;
  const cats = [TYPE[l.type][1], ...(l.links.genre || []).map((id: string) => byId.get(id)?.name).filter(Boolean)];
  b += `<div class="cats">Categorieën: <a href="../alle.html#${l.type}">${esc(cats[0])}</a>${(l.links.genre || []).slice(0, 8).map((id: string) => a(id)).join("")}</div>`;
  const desc = (l.defs?.[0]?.text || alineas[0] || `${l.name} in HitStory, de popencyclopedie van School of Rock.`).slice(0, 155);
  return page("../..", l.name, desc, b, (tracks.length ? FRAG_JS : "") + (l.tracklijst ? TL_JS : ""), !l.stub);
}

// ---------- Hoofdpagina ----------
// Alleen volledige artikelen op de hoofdpagina, nooit beginnetjes (gebruiker 2026-10-20)
const VOL_MIN = 400;
const VOL = (l: any) => !l.stub && String(l.text || "").length >= VOL_MIN;
function hoofdpagina() {
  const tel: Record<string, number> = {};
  for (const l of L) tel[l.type] = (tel[l.type] || 0) + 1;
  const uitgelicht = L.filter((l) => l.type === "artiest" && l.bron.includes("eigen") && VOL(l)).map((l) => ({ id: l.id, n: l.name, f: l.foto ? BEELD + l.foto.src : "", t: String(l.text).split(/\n\n/)[0] }));
  const genres = L.filter((l) => l.type === "genre" && VOL(l) && l.links.artiest?.length).map((l) => ({ id: l.id, n: l.name, f: "", t: l.text }));
  const wist = L.filter((l) => (l.type === "techniek" || l.type === "werk") && VOL(l)).map((l) => ({ id: l.id, n: l.name, t: String(l.text).split(/(?<=\.)\s/)[0] }));
  let b = `<div class="welkom"><p class="kicker">${L.length.toLocaleString("nl-NL")} artikelen</p><h1>Van work songs tot hyperpop</h1><p class="lede">Artiesten, genres, albums, begrippen en uitvindingen uit de mixtapes, kaarten en het magazine van School of Rock.</p></div>`;
  b += `<div class="portalen">${Object.keys(TYPE).map((t) => `<a href="alle.html#${t}"><b>${(tel[t] || 0).toLocaleString("nl-NL")}</b>${TYPE[t][1]}</a>`).join("")}</div><br>`;
  b += `<div class="hp"><div><section class="vak geel"><h2>Uitgelicht artikel</h2><div class="in" id="dag"></div></section><section class="vak groen"><h2>Uitgelicht genre</h2><div class="in" id="genre"></div></section></div>`;
  b += `<div><section class="vak blauw"><h2>Wist je dat…</h2><div class="in"><ul class="wist" id="wist"></ul></div></section><section class="vak paars"><h2>Bladeren</h2><div class="in"><p><a href="alle.html#artiest">Alle artiesten</a> · <a href="alle.html#genre">Alle genres</a> · <a href="alle.html#werk">Albums en nummers</a> · <a href="alle.html#begrip">Begrippen</a> · <a href="alle.html#techniek">Techniek en uitvindingen</a></p><p>Elk artikel verwijst naar het hoofdstuk, de kaart of het magazineverhaal waarin het voorkomt, en laat de fragmenten horen.</p></div></section></div></div>`;
  const js = `<script>(function(){const U=${JSON.stringify(uitgelicht).replace(/</g, "\\u003c")},G=${JSON.stringify(genres).replace(/</g, "\\u003c")},W=${JSON.stringify(wist).replace(/</g, "\\u003c")};const d=Math.floor(Date.now()/864e5);const e=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');const kaart=(x,el)=>{document.getElementById(el).innerHTML=(x.f?'<img class="dag" src="'+x.f+'" alt="">':'')+'<p><b><a href="'+x.id+'.html">'+e(x.n)+'</a></b>. '+e(x.t.length>520?x.t.slice(0,x.t.lastIndexOf(' ',500))+'…':x.t)+' <a href="'+x.id+'.html">Lees verder</a></p>'};if(U.length)kaart(U[d%U.length],'dag');if(G.length)kaart(G[(d*7)%G.length],'genre');const w=[];for(let i=0;i<5&&W.length;i++){const x=W[(d*13+i*97)%W.length];w.push('<li>…<a href="'+x.id+'.html">'+e(x.n)+'</a>: '+e(x.t)+'</li>')}document.getElementById('wist').innerHTML=w.join('')})();</script>`;
  return page("..", "Hoofdpagina", "HitStory, de popencyclopedie van School of Rock: artiesten, genres, albums, begrippen en techniek uit de geschiedenis van de popmuziek, met fragmenten en bronnen.", b, js);
}

// ---------- Alle lemma's A-Z ----------

// Bewerkpagina: haalt de tekst uit de pagina zelf (hs-bron), bewaart naar GitHub (bouw/encyclopedie/bewerkt/) en start de bouw.
function bewerkPagina() {
  const b = `<h1>Pagina bewerken</h1>
<div id="bw-instel" hidden><p>Eenmalig: plak een GitHub-sleutel (fine-grained token voor gsleraar-hue/school-of-rock met Contents: lezen en schrijven). De sleutel blijft alleen in deze browser.</p><p><input id="bw-token" type="password" style="width:100%" placeholder="github_pat_..."><button id="bw-bewaar-token">Sleutel opslaan</button></p></div>
<div id="bw-form" hidden>
<p><a id="bw-terug" href="#">← terug naar de pagina</a> · <a href="#" id="bw-uit">sleutel verwijderen</a></p>
<p><label>Naam<br><input id="bw-naam" style="width:100%"></label></p>
<p><label>Tekst (lege regel tussen alinea's)<br><textarea id="bw-tekst" rows="18" style="width:100%"></textarea></label></p>
<p><label>Luistertip<br><textarea id="bw-luister" rows="3" style="width:100%"></textarea></label></p>
<p><button id="bw-opslaan">Opslaan en publiceren</button> <span id="bw-status"></span></p>
<p style="opacity:.7">Na opslaan duurt het ongeveer twee minuten voordat de wijziging online staat.</p>
</div>`;
  const js = `<script>(function(){
var R="gsleraar-hue/school-of-rock",$=function(i){return document.getElementById(i)},id=new URLSearchParams(location.search).get("id")||"";
var tok=function(){try{return localStorage.getItem("hs_token")||""}catch(e){return ""}};
function st(t){$("bw-status").textContent=t}
function api(p,o){o=o||{};o.headers=Object.assign({Authorization:"Bearer "+tok(),Accept:"application/vnd.github+json"},o.headers||{});return fetch("https://api.github.com/repos/"+R+p,o)}
function b64(s){return btoa(unescape(encodeURIComponent(s)))}
function toon(){var ok=!!tok();$("bw-instel").hidden=ok;$("bw-form").hidden=!ok||!id;if(ok&&id)laad()}
async function laad(){
  var t=location.pathname.replace("bewerk.html","")+id+".html";$("bw-terug").href=t;
  var h=await (await fetch(t,{cache:"no-store"})).text();var k='id="hs-bron">',i=h.indexOf(k),m=null;if(i>=0){var e=h.indexOf("<"+"/script>",i);m=h.slice(i+k.length,e)}
  var d=m?JSON.parse(m):{name:"",text:"",listen:""};
  var r=await api("/contents/bouw/encyclopedie/bewerkt/"+id+".json?ref=main");
  if(r.ok){var j=JSON.parse(decodeURIComponent(escape(atob((await r.json()).content.split(String.fromCharCode(10)).join("")))));d=Object.assign(d,j)}
  $("bw-naam").value=d.name||"";$("bw-tekst").value=d.text||"";$("bw-luister").value=d.listen||"";
  document.title="Bewerk: "+(d.name||id)
}
$("bw-bewaar-token").onclick=function(){var v=$("bw-token").value.trim();if(v){localStorage.setItem("hs_token",v);toon()}};
$("bw-uit").onclick=function(e){e.preventDefault();localStorage.removeItem("hs_token");toon()};
$("bw-opslaan").onclick=async function(){
  try{
    st("Bezig met opslaan…");var pad="/contents/bouw/encyclopedie/bewerkt/"+id+".json";
    var body={name:$("bw-naam").value.trim(),text:$("bw-tekst").value.split(String.fromCharCode(13)).join("").trim(),listen:$("bw-luister").value.trim()};
    var p,pogingen=0;
    do{
      var g=await api(pad+"?ref=main&t="+Date.now(),{cache:"no-store"}),sha=g.ok?(await g.json()).sha:undefined;
      var p=await api(pad,{method:"PUT",body:JSON.stringify({message:"Bewerkt via HitStory: "+id,content:b64(JSON.stringify(body,null,1)),branch:"main",sha:sha})});
      pogingen++;if(p.status===409)await new Promise(function(r){setTimeout(r,1500)})
    }while(p.status===409&&pogingen<4);
    if(!p.ok)throw new Error("opslaan mislukt ("+p.status+")");
    
    st("Opgeslagen. De bouw loopt; over ongeveer twee minuten staat het online.")
  }catch(e){st("Fout: "+e.message)}
};
toon()})()</script>`;
  return page("..", "Bewerken", "Bewerkpagina voor de eigenaar.", b, js, false);
}

function allePagina() {
  const rows = [...L].filter((l) => !l.album).sort((x, z) => sortKey(x.name).localeCompare(sortKey(z.name)) || x.type.localeCompare(z.type));
  const tel: Record<string, number> = {};
  for (const l of rows) tel[l.type] = (tel[l.type] || 0) + 1;
  const groepen = new Map<string, any[]>();
  for (const l of rows) { const k = letter(l.name); (groepen.get(k) || groepen.set(k, []).get(k)!).push(l); }
  const letters = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
  let b = `<h1>Alle artikelen</h1><p class="tag">${rows.length.toLocaleString("nl-NL")} artikelen · <span id="count"></span></p>`;
  b += `<div class="chips" id="chips"><button data-f="" aria-pressed="true">Alles (${rows.length})</button>${Object.keys(TYPE).map((t) => `<button data-f="${t}" aria-pressed="false">${TYPE[t][1]} (${tel[t] || 0})</button>`).join("")}</div>`;
  b += `<nav class="az">${letters.map((x) => `<a href="#l-${x === "#" ? "0" : x}"${groepen.has(x) ? "" : ' class="leeg"'}>${x}</a>`).join("")}</nav>`;
  for (const x of letters) {
    const g = groepen.get(x); if (!g) continue;
    b += `<section class="groep" id="l-${x === "#" ? "0" : x}"><h2>${x}</h2><ul class="lijst">${g.map((l) => `<li data-t="${l.type}"><a href="${l.id}.html">${esc(l.name)}</a><span class="t">${esc(label(l))}</span></li>`).join("")}</ul></section>`;
  }
  const js = `<script>(function(){const c=document.getElementById('count'),items=[...document.querySelectorAll('.lijst li')],groups=[...document.querySelectorAll('.groep')],chips=[...document.querySelectorAll('#chips button')];let f=(location.hash.match(/^#(artiest|genre|werk|begrip|techniek)$/)||[])[1]||'';function go(){let k=0;items.forEach(i=>{const hit=!f||i.dataset.t===f;i.hidden=!hit;if(hit)k++});groups.forEach(g=>g.hidden=!g.querySelector('li:not([hidden])'));chips.forEach(b=>b.setAttribute('aria-pressed',b.dataset.f===f));c.textContent=k+' getoond'}chips.forEach(b=>b.onclick=()=>{f=b.dataset.f;history.replaceState(null,'',f?'#'+f:location.pathname);go()});go()})();</script>`;
  return page("..", "Alle artikelen", "Alle artikelen van HitStory, de popencyclopedie van School of Rock, van A tot Z.", b, js);
}

// Oude pagina's weg, foto's (img/) blijven staan
for (const t of Object.keys(TYPE)) { try { Deno.removeSync(OUT + t, { recursive: true }); } catch { /* eerste keer */ } Deno.mkdirSync(OUT + t, { recursive: true }); }
Deno.writeTextFileSync(OUT + "enc.css", CSS);
Deno.writeTextFileSync(OUT + "index.html", hoofdpagina());
Deno.writeTextFileSync(OUT + "alle.html", allePagina());
Deno.writeTextFileSync(OUT + "zoek.json", JSON.stringify(L.map((l) => [l.id, l.name, label(l)])));
// Bewerkmodus (alleen voor de eigenaar): elke pagina draagt zijn eigen tekst als JSON; een knop verschijnt alleen als er een GitHub-sleutel in de browser staat
const bewerkKnop = (l: any) => '<script type="application/json" id="hs-bron">' + JSON.stringify({ id: l.id, name: l.name, text: l.text || "", listen: l.listen || "" }).replace(/</g, "\u003c") + '</script>' +
  '<script>try{if(localStorage.getItem("hs_token")){var m=document.querySelector("main.blad");if(m){var a=document.createElement("a");a.href=document.querySelector("meta[name=sor-root]").content+"/encyclopedie/bewerk.html?id="+encodeURIComponent("' + l.id + '");a.textContent="✎ Bewerk deze pagina";a.style.cssText="float:right;font:600 13px Inter,sans-serif;padding:4px 10px;border:1px solid currentColor;border-radius:6px;text-decoration:none";m.insertBefore(a,m.firstChild)}}}catch(e){}</script>';
for (const l of L) Deno.writeTextFileSync(OUT + l.id + ".html", lemmaPage(l).replace("</body>", bewerkKnop(l) + "</body>"));
Deno.writeTextFileSync(OUT + "bewerk.html", bewerkPagina());
// voor de sitemap (seo.ts): hoofdpagina, A-Z en alle lemma's die geen beginnetje zijn
Deno.writeTextFileSync(W + "encyclopedie/data/sitemap.json", JSON.stringify(["index.html", "alle.html", ...L.filter((l) => !l.stub).map((l) => l.id + ".html")]));
console.log("geschreven:", L.length, "lemma-pagina's + hoofdpagina + A-Z in", OUT);
