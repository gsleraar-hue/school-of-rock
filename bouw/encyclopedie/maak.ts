// HitStory (popencyclopedie): bouwt site/encyclopedie/ uit data/lemmas.json (zie verzamel.ts), in Wikipedia-opzet.
// index.html = hoofdpagina (uitgelicht, portalen, zoeken); alle.html = A-Z met filters;
// <type>/<id>.html = lemma met infobox, inhoudsopgave, interne links, discografie, bronnen en categorieën.
// zoek.json = naam/id/soort voor de zoekbalk en "willekeurig lemma".
// Gebruik: deno run -A encyclopedie/maak.ts   (vanuit SoR-werk)

const W = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const ED = new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"); // map van dit script (SoR-werk\encyclopedie of bouw/encyclopedie)
const r = (p: string) => JSON.parse(Deno.readTextFileSync(p).replace(/^\uFEFF/, ""));
const exists = (p: string) => { try { Deno.statSync(p); return true; } catch { return false; } };
const LNL: any[] = JSON.parse(Deno.readTextFileSync(ED + "data/lemmas.json"));

// ---------- Taal: nl (sorock.nl/encyclopedie) en en (sorock.nl/en/encyclopedie), net als Wikipedia: elk artikel heeft een taallink als de vertaling bestaat ----------
type Taal = "nl" | "en";
let LANG: Taal = "nl";
const nt = (nl: string, en: string) => LANG === "en" ? en : nl;
const SITE = "https://sorock.nl/";
const OUTDIR = (taal: Taal) => taal === "en" ? W + "site/en/encyclopedie/" : W + "site/encyclopedie/";
const baseVan = (taal: Taal) => taal === "en" ? "en/encyclopedie" : "encyclopedie";
// Engelse invoer: woordenlijst (namen, categorieen, plaatsen, definities) en vertaalde artikelen (en/vertaald/*.json: id -> {text, listen, extra})
const WL: any = exists(ED + "en/bron/woordenlijst-en.json") ? r(ED + "en/bron/woordenlijst-en.json") : { names: {}, subs: {}, places: {}, who: {}, defs: {}, labels: {} };
const TR: Record<string, any> = {};
if (exists(ED + "en/vertaald")) for (const f of Deno.readDirSync(ED + "en/vertaald")) if (f.name.endsWith(".json")) Object.assign(TR, r(ED + "en/vertaald/" + f.name));
// Handmatige correcties op de Engelse tekst (bewerkt-en/<type>/<slug>.json, gemaakt door /en/encyclopedie/bewerk.html): overschrijven vertaling en naam
let BEWERKT_EN = 0;
if (exists(ED + "bewerkt-en")) for (const t of Deno.readDirSync(ED + "bewerkt-en")) if (t.isDirectory) for (const f of Deno.readDirSync(ED + "bewerkt-en/" + t.name)) {
  if (!f.name.endsWith(".json")) continue;
  const id = t.name + "/" + f.name.replace(/\.json$/, ""), o = r(ED + "bewerkt-en/" + t.name + "/" + f.name);
  if (typeof o.name === "string" && o.name.trim()) WL.names[id] = o.name.trim();
  if (typeof o.text === "string" || typeof o.listen === "string") TR[id] = { ...(TR[id] || {}), ...(typeof o.text === "string" ? { text: o.text } : {}), ...(typeof o.listen === "string" ? { listen: o.listen } : {}) };
  BEWERKT_EN++;
}
const EN_STUBS = true; // beginnetjes (zonder tekst) krijgen ook een Engelse pagina (kan sinds de luisterboeken naar sor-audio zijn verhuisd)
const heeftEn = (l: any) => !!TR[l.id] || l.type === "begrip" && !!WL.defs[l.id] || (EN_STUBS && !l.text);

// De Nederlandse bron verwijst naar "de cursus" (= School of Rock zelf); in het Engels leest "the course" vreemd
const schoon = (t: string) => t
  .replace(/\b([Ii])n the course\b/g, "$1n School of Rock")
  .replace(/\bthe course (mentions|calls|names|notes|says|treats|discusses|describes)\b/g, "School of Rock $1")
  .replace(/\b([Ff])rom the course\b/g, "$1rom School of Rock");
// Engelse lemma-set: namen, categorieen en plaatsen uit de woordenlijst, tekst uit de vertalingen
function maakEn(): any[] {
  return LNL.map((l) => {
    const o: any = { ...l };
    if (WL.names[l.id]) o.name = WL.names[l.id];
    if (o.sub && (l.type === "genre" || l.type === "techniek")) o.sub = WL.subs[o.sub] || o.sub;
    if (o.place) o.place = WL.places[o.place] || o.place;
    if (WL.who[l.id]) o.who = WL.who[l.id];
    if (l.defs && WL.defs[l.id]) o.defs = l.defs.map((d: any, i: number) => ({ ...d, text: WL.defs[l.id][i] ?? d.text }));
    const tr = TR[l.id];
    o.text = schoon(tr?.text || ""); o.listen = schoon(tr?.listen || "");
    if (l.extra?.length) o.extra = tr?.extra?.length ? l.extra.map((e: any, i: number) => ({ ...e, titel: tr.extra[i]?.titel ?? e.titel, text: schoon(tr.extra[i]?.text ?? e.text) })) : [];
    o.refs = (l.refs || []).map((x: any) => ({ ...x, label: WL.labels[x.label] || x.label, zin: undefined }));
    o.stub = l.stub && !tr;
    return o;
  });
}
// "Genoemd in andere artikelen" in het Engels: de zin komt uit de Engelse tekst van het noemende artikel
function vermeldEn(L: any[], byId: Map<string, any>, gebouwd: Set<string>) {
  for (const l of L) {
    if (!l.vermeld?.length) continue;
    const naam = l.name.toLowerCase();
    l.vermeld = l.vermeld.map((v: any) => {
      const bron = byId.get(v.id);
      if (!bron || !gebouwd.has(v.id)) return null;
      const zin = String(bron.text || "").split(/\n\n+/).flatMap((p: string) => p.split(/(?<=[.!?])\s+/)).find((z: string) => z.toLowerCase().includes(naam));
      return zin ? { id: v.id, zin } : null;
    }).filter(Boolean);
  }
}

// Alles wat per taal verschilt, wordt in init() gezet
let L: any[] = [], byId = new Map<string, any>(), GEBOUWD = new Set<string>(), ROOT = "../..", ROOT0 = "..";
let TYPE: Record<string, [string, string]> = {}, SOORT: Record<string, string> = {};
let exact = new Map<string, string>(), klein = new Map<string, string>(), LINKRE = /(?!)/g, albumsVan = new Map<string, Map<string, string>>();

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const TYPE_TAAL: Record<Taal, Record<string, [string, string]>> = {
  nl: { artiest: ["Artiest", "Artiesten"], genre: ["Genre", "Genres"], werk: ["Album of nummer", "Albums en nummers"], begrip: ["Begrip", "Begrippen"], techniek: ["Techniek", "Techniek"] },
  en: { artiest: ["Artist", "Artists"], genre: ["Genre", "Genres"], werk: ["Album or song", "Albums and songs"], begrip: ["Term", "Terms"], techniek: ["Technology", "Technology"] },
};
const SOORT_TAAL: Record<Taal, Record<string, string>> = {
  nl: { album: "Album", nummer: "Nummer", musical: "Musical", radioshow: "Radioshow" },
  en: { album: "Album", nummer: "Song", musical: "Musical", radioshow: "Radio show" },
};
const GENRE_EN: Record<string, string> = {"Klassiek": "Classical", "Elektronisch": "Electronic", "Hiphop/Rap": "Hip-hop/Rap", "Wereldwijd": "Worldwide", "Hardrock": "Hard rock", "Klassieke crossover": "Classical crossover", "Feestdagen": "Holiday", "Duitse pop": "German pop", "Oorspronkelijke muziek": "Original score", "Franse pop": "French pop", "Vocaal": "Vocal", "Hedendaagse jazz": "Contemporary jazz", "Christelijk en Gospel": "Christian & Gospel", "Progrock/Artrock": "Prog rock/Art rock", "Vocale jazz": "Vocal jazz", "Afrikaans": "African", "Videogame": "Video game", "Instrumentaal": "Instrumental", "Kerst": "Christmas", "Alternative folkmuziek": "Alternative folk", "Pop in het Spaans": "Spanish-language pop", "Hiphop": "Hip-hop", "Braziliaans": "Brazilian", "Indierock": "Indie rock", "Elektronica": "Electronica", "Indiase pop": "Indian pop", "Rock & Roll": "Rock & roll", "Hedendaagse folk": "Contemporary folk", "Europa": "Europe", "Kerstmis: pop": "Christmas: Pop", "Kerstmis: klassiekers": "Christmas: Classics", "Arabisch": "Arabic", "Psychedelisch": "Psychedelic", "Traditionele jazz": "Traditional jazz", "Indiaas klassiek": "Indian classical", "Religieus en spiritueel": "Religious & spiritual", "Zuid-Amerika": "South America", "Moderne tijd": "Modern", "Traditionele country": "Traditional country", "Indiaas": "Indian", "Noord-Amerika": "North America", "Hedendaagse R&B": "Contemporary R&B", "Hedendaagse latin": "Contemporary Latin", "Kerstmis: jazz": "Christmas: Jazz", "Kerstmis: R&B": "Christmas: R&B", "Kerstmis: rock": "Christmas: Rock", "Kerstmis: religieus": "Christmas: Religious", "Hedendaags": "Contemporary", "Hedendaagse country": "Contemporary country", "Hedendaagse blues": "Contemporary blues", "Elektrische blues": "Electric blues", "Akoestische blues": "Acoustic blues", "Tienerpop": "Teen pop", "Traditionele pop": "Traditional pop", "Komedie": "Comedy", "Azië": "Asia", "Indiase volksmuziek": "Indian folk", "Carnatisch klassiek": "Carnatic classical", "Hindoestaans klassiek": "Hindustani classical", "Soefi en ghazals": "Sufi & ghazals", "Meditatie": "Meditation", "Orkest": "Orchestral", "Keltisch": "Celtic", "Traditioneel Keltisch": "Traditional Celtic", "Keltische volksmuziek": "Celtic folk", "Koormuziek": "Choral", "Ontspanning": "Relaxation", "Eerbetoon": "Tribute", "Caraïbisch gebied": "Caribbean", "Noord-Afrikaans": "North African", "Industrieel": "Industrial", "Gouwe ouwe": "Golden oldies", "Russisch": "Russian", "Cubaans": "Cuban", "Gazal": "Ghazal", "Regionaal Indiaas": "Regional Indian", "Romantiek": "Romantic", "Barok": "Baroque", "Kindermuziek": "Children's music", "TV-soundtrack": "TV soundtrack", "Vocale pop": "Vocal pop", "Poppunk": "Pop punk", "Baladas en Boleros": "Baladas y Boleros", "Alternativo en Rock Latino": "Alternative & Latin rock", "Musicals": "Musicals", "Kerstmis": "Christmas"};
// Exacte genrelabels uit MusicBrainz (albumgenre.json); alles wat hier niet staat krijgt een hoofdletter en blijft Engels (zoals in de popwereld gebruikelijk)
const SG_NL: Record<string, string> = {"art pop": "Artpop", "traditional pop": "Traditionele pop", "pop soul": "Popsoul", "pop rap": "Poprap", "free improvisation": "Vrije improvisatie", "folk pop": "Folkpop", "europop": "Europop", "arena rock": "Arenarock", "baroque": "Barok", "contemporary jazz": "Hedendaagse jazz", "post-bop": "Postbop", "dance-pop": "Dancepop", "indie rock": "Indierock", "experimental": "Experimentele muziek", "modern classical": "Moderne klassieke muziek", "avant-garde jazz": "Avant-gardejazz", "hard bop": "Hard bop", "bebop": "Bebop", "cool jazz": "Cool Jazz", "modal jazz": "Modale jazz", "free jazz": "Free jazz", "avant-garde jazz": "Avant-gardejazz", "spiritual jazz": "Spiritual jazz", "soul jazz": "Souljazz", "jazz fusion": "Jazzfusion", "smooth jazz": "Smooth jazz", "big band": "Bigband", "swing": "Swing", "vocal jazz": "Vocale jazz", "latin jazz": "Latin jazz", "third stream": "Third stream", "dixieland": "Dixieland", "afro-cuban jazz": "Afro-Cubaanse jazz", "gypsy jazz": "Gipsyjazz", "hard rock": "Hardrock", "heavy metal": "Heavy metal", "progressive rock": "Progressieve rock", "psychedelic rock": "Psychedelische rock", "folk rock": "Folkrock", "punk rock": "Punkrock", "art rock": "Artrock", "blues rock": "Bluesrock", "classic rock": "Classic rock", "soft rock": "Softrock", "glam rock": "Glamrock", "synth-pop": "Synthpop", "new wave": "New wave", "disco": "Disco", "electronic": "Elektronisch", "ambient": "Ambient", "house": "House", "techno": "Techno", "hip hop": "Hiphop", "rhythm and blues": "R&B", "contemporary r&b": "Hedendaagse R&B", "motown": "Motown", "baroque": "Barok", "romantic": "Romantiek", "opera": "Opera", "chamber music": "Kamermuziek", "film score": "Filmmuziek", "bossa nova": "Bossa nova", "reggae": "Reggae", "ska": "Ska", "dub": "Dub", "country rock": "Countryrock", "bluegrass": "Bluegrass", "chicago blues": "Chicagoblues", "delta blues": "Deltablues", "electric blues": "Elektrische blues", "doo-wop": "Doowop", "rock and roll": "Rock-'n-roll", "rockabilly": "Rockabilly", "krautrock": "Krautrock", "shoegaze": "Shoegaze", "grunge": "Grunge", "britpop": "Britpop", "indie rock": "Indierock", "indie pop": "Indiepop", "dream pop": "Dreampop", "post-punk": "Postpunk", "thrash metal": "Thrashmetal", "death metal": "Deathmetal", "black metal": "Blackmetal", "gospel": "Gospel", "funk": "Funk", "soul": "Soul", "neo soul": "Neosoul", "trip hop": "Triphop", "drum and bass": "Drum-'n-bass", "minimal music": "Minimal music", "contemporary classical": "Hedendaagse klassiek", "impressionism": "Impressionisme"};
const sgLabel = (g: string) => LANG === "en" ? g.charAt(0).toUpperCase() + g.slice(1) : SG_NL[g] || g.charAt(0).toUpperCase() + g.slice(1);
const genreEn = (g: string) => LANG === "en" ? GENRE_EN[g] || g : g; // genrelabels komen uit de Nederlandse iTunes-winkel
// Verwijzing naar een Nederlandstalige pagina van de rest van de site: in de Engelse versie gemarkeerd met "NL"
const nlTag = () => LANG === "en" ? '<sup class="nltag" title="Dutch-language page">NL</sup>' : "";
// Pagina's van de rest van de site die al een Engelse versie hebben (en/site-paginas.json, bijvoorbeeld ["mixtape/01.html"]); verwijzingen gaan daar dan heen, de rest blijft Nederlands met NL-markering
const EN_SITE = new Set<string>(exists(ED + "en/site-paginas.json") ? r(ED + "en/site-paginas.json") : []);
const nlA = (href: string, text: string) => {
  if (LANG !== "en") return `<a href="${href}">${text}</a>`;
  const pad = href.slice(ROOT.length + 1);
  if (EN_SITE.has(pad.split(/[#?]/)[0])) return `<a href="${ROOT}/en/${pad}">${text}</a>`;
  return `<a href="${href}" hreflang="nl" lang="nl" title="Dutch-language page">${text}</a>${nlTag()}`;
};
const ord = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
const winkel = (u?: string) => LANG === "en" && u ? u.replace("music.apple.com/nl/", "music.apple.com/gb/") : u; // Engelse pagina's verwijzen naar de Britse Apple Music-winkel
const sortKey = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/^(the|de|het|'t)\s+/i, "").replace(/^[^a-z0-9]+/i, "").toLowerCase();
const letter = (s: string) => { const c = sortKey(s)[0] || "#"; return /[a-z]/.test(c) ? c.toUpperCase() : "#"; };
const label = (l: any) => l.type === "werk" ? SOORT[l.soort] || nt("Werk", "Work") : TYPE[l.type][0];
const jaren = (l: any) => l.born ? `${l.born}${l.died ? "–" + l.died : ""}` : l.year ? String(Math.floor(l.year)) : "";
const isGroep = (l: any) => l.soortArtiest === "groep" || (!l.born && /^(the|de|het)\s|\s(&|and|en)\s|band|orchestra|orkest|ensemble|brothers|sisters|boys|girls|quartet|trio|five|four/i.test(l.name));
const sub = (l: any) => l.type === "werk" ? [l.sub, jaren(l)].filter(Boolean).join(" · ")
  : l.type === "artiest" ? [jaren(l), l.links.genre?.map((g: string) => byId.get(g)?.name).slice(0, 2).join(", ")].filter(Boolean).join(" · ")
  : l.type === "begrip" ? (l.defs?.[0]?.text || "") : [l.sub, jaren(l)].filter(Boolean).join(" · ");
// Links gaan naar de pagina in de eigen taal; bestaat die niet (beginnetjes in het Engels), dan naar de Nederlandse pagina
const href = (id: string, root = ROOT) => `${root}/${LANG === "en" && !GEBOUWD.has(id) ? baseVan("nl") : baseVan(LANG)}/${id}.html`;
// Werk-lijst: "Titel – Artiest (jaar)" -> jaar, titel (gelinkt aan album-lemma) en artiest (gelinkt aan artiest-lemma)
const wNorm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
let WERK_VAN: any = null, WERK_IDX = new Map<string, any[]>(), ART_IDX = new Map<string, string>();
const werkIdx = () => { if (WERK_VAN !== byId) { WERK_VAN = byId; WERK_IDX = new Map(); ART_IDX = new Map(); for (const x of byId.values()) { const n = wNorm(x.name || ""); if (!n) continue; if (x.type === "werk") { if (!WERK_IDX.has(n)) WERK_IDX.set(n, []); WERK_IDX.get(n)!.push(x); } else if (x.type === "artiest" && !ART_IDX.has(n)) ART_IDX.set(n, x.id); } } };
const werkRegel = (w: string, l: any) => {
  werkIdx();
  let rest = w.trim(), extra = "", jaar = "";
  const m = rest.match(/\s*\(([^()]*)\)\s*$/);
  if (m) { rest = rest.slice(0, m.index).trim(); const y = m[1].match(/\d{4}(?:[–-]\d{4})?/); if (y) jaar = y[0]; extra = m[1].replace(y ? y[0] : "", "").replace(/^[\s,]+|[\s,]+$/g, "").replace(/,\s*,/g, ","); }
  let titel = rest, wie = "";
  const d = rest.match(/^(.*?)\s+[–-]\s+(.*)$/);
  if (d) { titel = d[1].trim(); wie = d[2].trim(); }
  const metM = (wie || titel).match(/^(?:(.*?)\s+)?[–-]?\s*met\s+(.+)$/);
  let artHtml = esc(wie);
  if (metM) { if (d) { artHtml = nt("met ", "with ") + (ART_IDX.has(wNorm(metM[2])) ? a(ART_IDX.get(wNorm(metM[2]))!) : esc(metM[2])); wie = ""; } else { titel = (metM[1] || "").trim() || titel; artHtml = nt("met ", "with ") + (ART_IDX.has(wNorm(metM[2])) ? a(ART_IDX.get(wNorm(metM[2]))!) : esc(metM[2])); wie = ""; } }
  else if (wie && ART_IDX.has(wNorm(wie))) artHtml = a(ART_IDX.get(wNorm(wie))!);
  const kand = WERK_IDX.get(wNorm(titel)) || [];
  const eigen = l.type === "artiest" ? l.id : "";
  const wieId = wie ? ART_IDX.get(wNorm(wie)) : "";
  const hit = kand.find((x: any) => wieId && (x.links?.artiest || []).includes(wieId)) || kand.find((x: any) => !wie && eigen && (x.links?.artiest || []).includes(eigen));
  const titelHtml = hit ? a(hit.id) : esc(titel);
  return { jaar, key: wNorm(titel), eigenArt: !wie, html: `<li><span class="j">${jaar}</span><i>${titelHtml}</i>${artHtml ? " <span class=\"klein\">· " + artHtml + "</span>" : ""}${extra ? " <span class=\"klein\">(" + esc(extra) + ")</span>" : ""}</li>` };
};
const a = (id: string, root?: string) => { const x = byId.get(id); return x ? `<a href="${href(id, root)}">${esc(x.name)}</a>` : ""; };
// Albumgenre (MusicBrainz): linkt naar het genre-artikel als dat bestaat ("hard bop" = "Hard bop"), anders platte tekst
const sgNorm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "");
let GENRE_LEMMA = new Map<string, string>(), GENRE_VAN: any = null; // byId wordt per taal opnieuw gevuld
const SG_ALIAS: Record<string, string> = {"ska": "genre/ska-rocksteady-en-reggae", "new age": "genre/synthesizerorkest-ambient-en-new-age", "avant-garde": "genre/experimentele-muziek", "contemporary r&b": "genre/moderne-r-en-b", "hard rock": "genre/hardrock-en-heavy-metal", "heavy metal": "genre/hardrock-en-heavy-metal", "soft rock": "genre/softrock-en-aor", "swing": "genre/swing-en-big-band", "big band": "genre/swing-en-big-band", "jazz rock": "genre/fusion-en-jazzrock", "jazz fusion": "genre/fusion-en-jazzrock", "cool jazz": "genre/cool-jazz-en-modale-jazz", "rock and roll": "genre/rock-n-roll", "synth-pop": "genre/synthpop", "alternative rock": "genre/alternatieve-rock", "jazz-funk": "genre/jazzfunk", "spiritual jazz": "genre/spirituele-jazz", "gypsy jazz": "genre/gypsy-jazz-jazz-manouche"};
const sgHtml = (g: string) => { if (GENRE_VAN !== byId) { GENRE_VAN = byId; GENRE_LEMMA = new Map(); for (const x of byId.values()) if (x.type === "genre") GENRE_LEMMA.set(sgNorm(x.name), x.id); } const id = GENRE_LEMMA.get(sgNorm(g)) || GENRE_LEMMA.get(sgNorm(sgLabel(g))) || (byId.has(SG_ALIAS[g]) ? SG_ALIAS[g] : ""); return id ? (GENRE_LEMMA.get(sgNorm(g)) || GENRE_LEMMA.get(sgNorm(sgLabel(g))) ? a(id) : `<a href="${href(id)}">${esc(sgLabel(g))}</a>`) : esc(sgLabel(g)); };
const lijstNL = (xs: string[]) => xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + nt(" en ", " and ") + xs[xs.length - 1];

// ---------- Bronnen uit de factcheck (per artiestnaam) ----------
const BRONNEN = new Map<string, string[]>();
const FC = W + "encyclopedie/factcheck/";
if (exists(FC)) for (const f of Deno.readDirSync(FC)) {
  let kop = "";
  for (const regel of Deno.readTextFileSync(FC + f.name).split(/\r?\n/)) {
    const k = regel.match(/^#\s+(.+)$/); if (k) { kop = k[1].trim().toLowerCase(); continue; }
    if (!kop || /^(twijfel|mogelijke fout|niet gevonden)/i.test(kop)) continue;
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
// Bandnamen die ook gewone woorden zijn, maar met hoofdletter midden in een zin vrijwel altijd de band: die linken we met een voorzichtige regel (zie linkBasis)
const VEILIG_DUBBEL = new Set(["Queen", "Cream", "Chic", "Madness", "Muse", "Kiss"]);
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function initLinks() {
  exact = new Map(); klein = new Map();
  for (const l of L) {
    const n = l.name.trim();
    if (l.type === "artiest" && VEILIG_DUBBEL.has(n) && !exact.has(n)) { exact.set(n, l.id); continue; }
    if (n.length < 4 || DUBBEL.has(n.toLowerCase()) || l.album) continue;
    if (l.type === "artiest" || l.type === "werk") { if (!exact.has(n)) exact.set(n, l.id); }
    else if (n.length >= 5 && !klein.has(n.toLowerCase())) klein.set(n.toLowerCase(), l.id);
  }
  const alle = [...new Set([...exact.keys(), ...klein.keys()])].sort((x, y) => y.length - x.length);
  LINKRE = new RegExp("(?<![\\p{L}\\d])(" + alle.map(reEsc).join("|") + ")(?![\\p{L}\\d])", "giu");
  // Albums alleen linken in de context van hun artiest: in het artikel over die artiest (of een ander album van hem),
  // of in een alinea waarin de artiest zelf genoemd wordt. Zo wordt "Help!" of "Thriller" niet overal een link.
  albumsVan = new Map(); // artiest-id -> titel -> album-id
  for (const l of L) {
    const art = l.album && l.links?.artiest?.[0];
    const n = l.name.trim();
    if (!art || (n.length < 4 && !/s/.test(n)) || n === byId.get(art)?.name) continue;
    (albumsVan.get(art) || albumsVan.set(art, new Map()).get(art)!).set(n, l.id);
  }
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
// Titels waarin een los woord (bijv. Voodoo) geen link naar een ander lemma mag krijgen
const BESCHERMD = ["Miles Runs the Voodoo Down"];
const BESCHERMD_RE = new RegExp("(?<![\\p{L}\\d])(" + BESCHERMD.map(reEsc).join("|") + ")(?![\\p{L}\\d])", "gu");
function linkBasis(tekst: string, zelf: string, gezien: Set<string>) {
  let uit = "", pos = 0;
  const bescherm = [...tekst.matchAll(BESCHERMD_RE)].map((b) => [b.index!, b.index! + b[0].length]);
  for (const m of tekst.matchAll(LINKRE)) {
    if (bescherm.some(([a, b]) => m.index! >= a && m.index! < b)) continue;
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

const ZOEK_JS = (root: string) => `<script>(function(){const R=${JSON.stringify(root)},B=${JSON.stringify(baseVan(LANG))};let data=null;const get=()=>data?Promise.resolve(data):fetch(R+'/'+B+'/zoek.json').then(r=>r.json()).then(j=>data=j);const n=s=>s.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase();document.querySelectorAll('.zoek').forEach(z=>{const i=z.querySelector('input'),u=z.querySelector('ul');let k=-1;const go=async()=>{const v=n(i.value.trim());if(!v){u.hidden=true;return}const d=await get();const a=[],b=[];for(const x of d){const m=n(x[1]);if(m.startsWith(v))a.push(x);else if(m.includes(v))b.push(x);if(a.length>=10)break}const res=a.concat(b).slice(0,10);u.innerHTML=res.map(x=>'<li><a href="'+R+'/'+(x[3]?'encyclopedie':B)+'/'+x[0]+'.html">'+x[1].replace(/</g,'&lt;')+'<small>'+x[2]+'</small></a></li>').join('');u.hidden=!res.length;k=-1};i.addEventListener('input',go);i.addEventListener('keydown',e=>{const l=[...u.querySelectorAll('a')];if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();k=Math.max(0,Math.min(l.length-1,k+(e.key==='ArrowDown'?1:-1)));l.forEach((x,j)=>x.classList.toggle('act',j===k))}if(e.key==='Enter'&&l.length){location.href=(l[k]||l[0]).href}});document.addEventListener('click',e=>{if(!z.contains(e.target))u.hidden=true})});document.querySelectorAll('.rnd').forEach(a=>a.onclick=async e=>{e.preventDefault();const d=(await get()).filter(x=>!x[3]);location.href=R+'/'+B+'/'+d[Math.floor(Math.random()*d.length)][0]+'.html'})})();</script>`;

// rel = pad van de pagina binnen de encyclopedie (bijv. "artiest/x.html"); bepaalt taalwisselaar en hreflang. null = geen tegenhanger.
const ENIDS = new Set<string>(LNL.filter(heeftEn).map((l) => l.id));
const heeftAlt = (rel: string | null) => !!rel && (/^(index|alle)\.html$/.test(rel) || LANG === "en" || ENIDS.has(rel.replace(/\.html$/, "")));
const taalBlok = (root: string, rel: string | null) => {
  if (!heeftAlt(rel)) return { head: "", knop: "" };
  const urls: Record<Taal, string> = { nl: `${baseVan("nl")}/${rel}`, en: `${baseVan("en")}/${rel}` };
  const head = (["nl", "en"] as Taal[]).map((x) => `<link rel="alternate" hreflang="${x}" href="${SITE}${urls[x]}">`).join("") + `<link rel="alternate" hreflang="x-default" href="${SITE}${urls.nl}">`;
  const li = (x: Taal, naam: string) => `<li><a lang="${x}" hreflang="${x}" href="${root}/${urls[x]}"${x === LANG ? ' aria-current="true"' : ""}>${naam}</a></li>`;
  const knop = `<details class="talen"><summary aria-label="${nt("Taal wisselen", "Change language")}"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12.9 15.1 10.8 13c1.5-1.7 2.6-3.6 3.2-5.7H17V5.3h-7V3H8v2.3H1v2h11.2a14.700 14.700 0 0 1-2.200 4.300 14.600 14.600 0 0 1-1.700-2.500H6.300a17.700 17.700 0 0 0 2.400 3.700l-4.400 4.400L5.700 19l4.300-4.300 2.500 2.500zM18.500 10h-2L12 22h2l1.100-3h4.800l1.100 3h2zm-2.600 7 1.600-4.300 1.600 4.300z"/></svg> ${nt("2 talen", "2 languages")}</summary><ul>${li("nl", "Nederlands")}${li("en", "English")}</ul></details>`;
  return { head, knop };
};
const korteTekst = (t: string, max = 155) => { const s = String(t).replace(/<[^>]+>/g, "").replace(/&lt;\/?strong&gt;/g, "").replace(/\s+/g, " ").trim(); if (s.length <= max) return s; const k = s.slice(0, max - 1); return k.slice(0, k.lastIndexOf(" ") > 90 ? k.lastIndexOf(" ") : k.length).replace(/[\s,;:.–-]+$/, "") + "…"; };
const paginaTitel = (title: string, rel: string | null) => rel === "index.html" ? nt("HitStory – de popencyclopedie van School of Rock", "HitStory – the pop encyclopedia of School of Rock") : `${title} – HitStory | School of Rock`;
const OG_STANDAARD = SITE + "img/og/home.jpg";
const seoKop = (title: string, desc: string, rel: string | null, index: boolean, img: string, ld: unknown[], type: string) => {
  if (!rel || !index) return "";
  const url = SITE + baseVan(LANG) + "/" + rel, t = paginaTitel(title, rel), im = img.startsWith("http") ? img : OG_STANDAARD;
  const og = (k: string, v: string) => `<meta property="${k}" content="${esc(v)}">`;
  const graph = ld.length ? `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": ld }).replace(/</g, "\u003c")}</script>` : "";
  return `<link rel="canonical" href="${url}">${og("og:site_name", "HitStory · School of Rock")}${og("og:type", type)}${og("og:title", t)}${og("og:description", desc)}${og("og:url", url)}${og("og:image", im)}${og("og:locale", LANG === "en" ? "en_GB" : "nl_NL")}<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(t)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(im)}">${graph}`;
};
const page = (root: string, title: string, desc: string, body: string, script = "", index = true, rel: string | null = null, img = "", ld: unknown[] = [], ogType = "article") => {
  const talen = taalBlok(root, rel);
  const E = `${root}/${baseVan(LANG)}`;
  const NL = nlTag();
  return `<!doctype html><html lang="${LANG}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="sor-root" content="${root}"><title>${esc(paginaTitel(title, rel))}</title><meta name="description" content="${esc(desc)}">${index ? "" : '<meta name="robots" content="noindex, follow">'}${seoKop(title, desc, rel, index, img, ld, ogType)}${talen.head}<link rel="icon" href="${root}/assets/cassette.png"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:ital,wght@0,400;0,600;0,700;1,400&family=Space+Mono:wght@400;700&family=Caveat:wght@600&display=swap"><link rel="stylesheet" href="${root}/assets/site.css"><link rel="stylesheet" href="${root}/encyclopedie/enc.css"><script src="${root}/assets/player.js"></script><script src="${root}/assets/nav.js"></script></head><body><header class="sitenav"><a class="brand" href="${root}/index.html"><img src="${root}/assets/cassette.png" alt=""><span>School of Rock</span></a><nav aria-label="${nt("Hoofdmenu", "Main menu")}"><a href="${root}/index.html#mixtapes">Mixtapes${NL}</a><a href="${root}/kaart.html">${nt("Genrekaart", "Genre map")}${NL}</a><a href="${root}/magazine/index.html">Magazine${NL}</a><a href="${E}/index.html" aria-current="page">${nt("Encyclopedie", "Encyclopedia")}</a><a href="${root}/begrippen.html">${nt("Begrippen", "Glossary")}${NL}</a><a href="${root}/opdrachten.html">${nt("Opdrachten", "Assignments")}${NL}</a></nav></header>
<div class="wk"><div class="wkbar"><a class="logo" href="${E}/index.html">HitStory<small>${nt("popencyclopedie van School of Rock", "the pop encyclopedia of School of Rock")}</small></a><div class="zoek"><input type="search" placeholder="${nt("Zoeken in HitStory", "Search HitStory")}" aria-label="${nt("Zoeken", "Search")}" autocomplete="off"><ul hidden></ul></div><a class="rnd" href="#">${nt("Willekeurig artikel", "Random article")}</a> <a href="${E}/alle.html">${nt("Alle artikelen A–Z", "All articles A–Z")}</a></div>
<main class="blad">${talen.knop}${body}</main></div><footer class="sitefoot"><div class="wrap"><p>${nt("HitStory, de popencyclopedie van School of Rock · De geschiedenis van popmuziek in mixtapes · Jan-Wolter Smit · ArtEZ University of the Arts", "HitStory, the pop encyclopedia of School of Rock · The history of popular music in mixtapes · Jan-Wolter Smit · ArtEZ University of the Arts")}</p><p>${nt("Teksten gecontroleerd aan de hand van de genoemde bronnen. Discografieën: MusicBrainz (CC0). Foto's: Wikimedia Commons, met maker en licentie bij elke foto.", "Texts checked against the sources listed. Discographies: MusicBrainz (CC0). Photos: Wikimedia Commons, with photographer and licence given for each photo.")}</p></div></footer>${ZOEK_JS(root)}${script}</body></html>`;
};

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
    const m = x.label.match(/^Mixtape (\d+)/); return m ? nlA(ROOT + "/" + esc(x.href.split("#")[0]), "Mixtape " + m[1]) : x.kind === "magazine" ? nlA(ROOT + "/" + esc(x.href.split("#")[0]), "Magazine") : "";
  }).filter(Boolean))].join(", ");
  let rows = "";
  if (l.type === "artiest") {
    const groep = isGroep(l);
    rows += groep ? rij(nt("Opgericht", "Formed"), l.year ? String(Math.floor(l.year)) : "") + rij(nt("Herkomst", "Origin"), esc(l.place || ""))
      : rij(nt("Geboren", "Born"), [l.born, l.place].filter(Boolean).map(esc).join(", ")) + rij(nt("Overleden", "Died"), l.died ? String(l.died) : "");
    rows += rij("Genre", links("genre"));
    if (l.disco?.length) { const js = l.disco.map((x: any) => x.jaar).filter(Boolean); rows += rij(nt("Studioalbums", "Studio albums"), `${l.disco.length}${js.length ? ` (${Math.min(...js)}–${Math.max(...js)})` : ""}`); }
    rows += rij(nt("Bekende werken", "Notable works"), links("werk", 5)) + rij(nt("Beïnvloed door", "Influenced by"), links("invloed", 4)) + rij(nt("Ook gespeld als", "Also spelled"), (l.ook || []).map(esc).join(", "));
  } else if (l.type === "genre") {
    rows += rij(nt("Ontstaan", "Originated"), [l.year ? String(Math.floor(l.year)) : "", l.place].filter(Boolean).map(esc).join(", ")) + rij(nt("Familie", "Family"), esc(l.sub || "")) + rij(nt("Wortels", "Roots"), links("wortels")) + rij(nt("Daarna", "Led to"), links("daarna")) + rij(nt("Artiesten", "Artists"), links("artiest", 6));
  } else if (l.type === "werk") {
    const tr = l.tracklijst;
    const duur = tr ? Math.round(tr.tracks.reduce((s: number, x: any) => s + (x.ms || 0), 0) / 60000) : 0;
    rows += rij(nt("Soort", "Type"), l.nr ? nt("Studioalbum", "Studio album") : SOORT[l.soort] || nt("Werk", "Work")) + rij(nt("Artiest", "Artist"), (l.links.artiest || []).map((id: string) => a(id)).join(", ") || esc(l.sub)) + rij(nt("Jaar", "Year"), l.year ? String(l.year) : "") + rij(nt("Schrijver/producer", "Writer/producer"), (l.links.maker || []).map((id: string) => a(id)).join(", "));
    if (tr) rows += rij("Genre", l.subgenre?.length ? l.subgenre.map(sgHtml).join(", ") : esc(genreEn(tr.genre || ""))) + rij(nt("Nummers", "Tracks"), `${tr.tracks.length}${duur ? ` (${duur} min.)` : ""}`) + rij(nt("Vorige", "Previous"), l.vorige ? a(l.vorige) : "") + rij(nt("Volgende", "Next"), l.volgende ? a(l.volgende) : "");
  } else if (l.type === "techniek") {
    rows += rij(nt("Jaar", "Year"), l.year ? String(Math.floor(l.year)) : "") + rij(nt("Plaats", "Place"), esc(l.place || "")) + rij(nt("Bedenker", "Inventor"), esc(l.who || "")) + rij(nt("Categorie", "Category"), esc(l.sub || "")) + rij(nt("Genres", "Genres"), links("genre"));
  }
  rows += rij(nt("In School of Rock", "In School of Rock"), mixtapes);
  if (!rows && !l.foto) return "";
  const foto = !l.foto && l.tracklijst?.cover ? `<img src="${esc(hoes(l.tracklijst.cover))}" alt="${nt("Hoes van", "Cover of")} ${esc(l.name)}">` : l.foto ? `<img src="${BEELD}${esc(l.foto.src)}" alt="${esc(l.name)}"><div class="fcap">${esc(l.foto.maker).slice(0, 80)} · <a href="${esc(l.foto.bron)}" target="_blank" rel="noopener">${esc(l.foto.licentie)}</a></div>` : "";
  return `<aside class="info ${l.type}"><div class="kop">${esc(l.name)}</div>${foto}<table>${rows}</table></aside>`;
}

// Inleiding voor lemma's zonder eigen tekst: alleen wat vaststaat, geen verzinsels.
function stubLead(l: any) {
  const genres = (l.links.genre || []).slice(0, 3).map((id: string) => a(id));
  const hoofdst = [...new Set((l.refs || []).filter((x: any) => x.kind === "hoofdstuk").map((x: any) => x.label.replace(/:.*/, "")))] as string[];
  if (l.album) {
    const art = (l.links.artiest || []).map((id: string) => a(id)).join(", ") || esc(l.artist || "");
    return nt(`<p><b>${esc(l.name)}</b> is een studioalbum van ${art}${l.year ? `, uitgebracht in ${l.year}` : ""}.${l.tracklijst ? ` Het album telt ${l.tracklijst.tracks.length} nummers.` : ""}</p>`,
      `<p><b>${esc(l.name)}</b> is a studio album by ${art}${l.year ? `, released in ${l.year}` : ""}.${l.tracklijst ? ` The album has ${l.tracklijst.tracks.length} tracks.` : ""}</p>`);
  }
  const wat = l.type === "artiest" ? (isGroep(l) ? nt("een muziekgroep", "a band") : nt("een artiest", "an artist")) : (LANG === "en" ? "a " : "") + label(l).toLowerCase();
  let s = `<b>${esc(l.name)}</b>${l.born ? ` (${jaren(l)})` : ""} is ${wat}`;
  if (genres.length) s += ` (${genres.length > 1 ? "genres" : "genre"}: ${lijstNL(genres)})`;
  s += hoofdst.length ? nt(`. School of Rock noemt ${isGroep(l) ? "de groep" : l.type === "artiest" ? "deze artiest" : "dit artikel"} in ${lijstNL(hoofdst)}.`, `. School of Rock mentions ${isGroep(l) ? "the band" : l.type === "artiest" ? "this artist" : "this article"} in ${lijstNL(hoofdst)}.`) : ".";
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
      secties.push(["muziek", nt("Muziek en doorbraak", "Music and breakthrough"), `<p>${html[1]}</p>`], ["invloed", nt("Invloed", "Influence"), `<p>${html[2]}</p>`]);
    } else lead += html.map((p, i) => `<p>${i ? p : vet(p, l.name)}</p>`).join("");
  }
  if (!lead) { lead = stubLead(l); for (const id of (l.links.genre || []).slice(0, 3)) gezien.add(id); }
  if (l.extra?.length) secties.push(["geschiedenis", nt("Uit de tijdlijnen", "From the timelines"), l.extra.map((e: any) => `<h3>${esc(e.titel)} (${e.jaar})</h3><p>${linkify(e.text, l.id, gezien)}</p>`).join("")]);
  const tracks = (l.tracks || []).filter((t: any) => t.audio).slice(0, 12);
  if (l.listen || tracks.length) {
    let h = l.listen ? `<div class="tip"><b>${nt("Luistertip.", "Listening tip.")}</b> ${linkify(l.listen, l.id, gezien)}</div>` : "";
    if (tracks.length) h += `<ul class="frags">${tracks.map((t: any, i: number) => `<li><button data-t="${i}" aria-label="${nt("Speel", "Play")} ${esc(t.title)}"></button>${t.cover ? `<img src="${esc(hoes(t.cover))}" alt="" loading="lazy">` : "<span></span>"}<div class="w"><b>${esc(t.title)}</b> <span>· ${esc(t.artist)}${t.year ? ", " + t.year : ""}</span></div>${t.store ? `<a class="ap" href="${esc(winkel(t.store))}" target="_blank" rel="noopener">Apple Music ↗</a>` : "<span></span>"}</li>`).join("")}</ul><script type="application/json" id="frags-data">${JSON.stringify(tracks.map((t: any) => ({ audio: t.audio, artist: t.artist, title: t.title, cover: hoes(t.cover), year: t.year }))).replace(/</g, "\\u003c")}</script>`;
    secties.push(["luisteren", nt("Luisteren", "Listening"), h]);
  }
  if (l.tracklijst) {
    const t = l.tracklijst, discs = new Set(t.tracks.map((x: any) => x.disc)).size;
    const mmss = (ms: number) => ms ? `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, "0")}` : "";
    let h = "", disc = 0;
    t.tracks.forEach((x: any, i: number) => {
      if (discs > 1 && x.disc !== disc) { if (disc) h += "</ol>"; disc = x.disc; h += `<h3>${nt("Cd", "CD")} ${disc}</h3><ol class="tl">`; } else if (!i) h += `<ol class="tl">`;
      h += `<li><span class="n">${x.n}</span>${x.audio ? `<button data-i="${i}" aria-label="${nt("Speel", "Play")} ${esc(x.titel)}"></button>` : "<span></span>"}<span class="t">${esc(x.titel.replace(/ 'T\b/g, " 't").replace(/ 'S\b/g, " 's"))}</span><span class="d">${mmss(x.ms)}</span>${x.store ? `<a class="ap" href="${esc(winkel(x.store))}" target="_blank" rel="noopener">Apple Music ↗</a>` : "<span></span>"}</li>`;
    });
    h += "</ol>";
    h += `<p class="klein">${nt("Fragmenten van 30 seconden via Apple Music.", "30-second previews via Apple Music.")}${t.store ? ` <a href="${esc(winkel(t.store))}" target="_blank" rel="noopener">${nt("Beluister het hele album op Apple Music", "Listen to the whole album on Apple Music")} ↗</a>` : ""}</p>`;
    h += `<script type="application/json" id="tl-data">${JSON.stringify(t.tracks.map((x: any) => ({ audio: x.audio, artist: l.artist || l.sub, title: x.titel, cover: hoes(t.cover), year: l.year }))).replace(/</g, "\u003c")}</script>`;
    secties.push(["tracklijst", nt("Tracklijst", "Track list"), h]);
  }
  if (l.disco?.length) secties.push(["discografie", nt("Discografie", "Discography"), `<h3>${nt("Studioalbums", "Studio albums")}</h3><ul class="disco">${l.disco.map((x: any) => `<li><span class="j">${x.jaar || "?"}</span><i>${x.id && byId.has(x.id) ? a(x.id) : esc(x.titel)}</i>${x.soort === "soundtrack" ? " (soundtrack)" : ""}</li>`).join("")}</ul>`]);
  if (l.works?.length) {
    const have = new Set((l.disco || []).map((x: any) => wNorm(x.titel || "")));
    const regels = l.works.map((w: string) => werkRegel(w, l)).filter((x: any) => !(have.has(x.key) && x.eigenArt));
    if (regels.length) {
      const lijst = `<ul class="disco">${regels.map((x: any) => x.html).join("")}</ul>`;
      if (l.disco?.length) { const sec = secties.find((x) => x[0] === "discografie")!; sec[2] += `<h3>${nt("Ander werk", "Other work")}</h3>` + lijst; }
      else secties.push(["werk", nt("Werk", "Works"), lijst]);
    }
  }
  const sor = (l.refs || []);
  if (sor.length) {
    const kind: Record<string, string> = { hoofdstuk: "Reader", magazine: "Magazine", kaart: nt("Kaart", "Map") };
    secties.push(["sor", "In School of Rock", `${LANG === "en" ? '<p class="klein">The chapters, maps and magazine stories of School of Rock are currently available in Dutch only.</p>' : ""}<ul class="vermeld">${sor.map((x: any) => `<li>${nlA(ROOT + "/" + esc(x.href), esc(x.label))} <span class="klein">${kind[x.kind] || x.kind}</span>${x.zin ? `<q>${linkify(x.zin, l.id, new Set(gezien))}</q>` : ""}</li>`).join("")}</ul>`]);
  }
  if (l.vermeld?.length) secties.push(["vermeld", nt("Genoemd in andere artikelen", "Mentioned in other articles"), `<ul class="vermeld">${l.vermeld.map((v: any) => `<li>${a(v.id)} <span class="klein">${esc(label(byId.get(v.id) || {}))}</span><q>${linkify(v.zin, l.id, new Set([...gezien, v.id]))}</q></li>`).join("")}</ul>`]);
  const zie = [...new Set(["artiest", "maker", "werk", "wortels", "daarna", "genre", "techniek", "invloed", "invloed-op"].flatMap((k) => l.links[k] || []))].filter((id: string) => !gezien.has(id) && byId.has(id) && !(l.type === "artiest" && byId.get(id).album)).slice(0, 30);
  if (zie.length) secties.push(["zieook", nt("Zie ook", "See also"), `<ul class="ziezook">${zie.map((id) => `<li>${a(id)}</li>`).join("")}</ul>`]);
  const bronnen = BRONNEN.get(l.id.toLowerCase()) || BRONNEN.get(l.name.toLowerCase()) || [];
  if (bronnen.length) secties.push(["bronnen", nt("Bronnen", "Sources"), `<ol class="bron">${bronnen.map((u) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(bronNaam(u))}</a></li>`).join("")}</ol>`]);

  const strong = (h: string) => h.replace(/&lt;(\/?)strong&gt;/g, "<$1strong>");
  secties.forEach((x) => { x[2] = strong(x[2]); }); lead = strong(lead);
  let b = `<h1>${esc(l.name)}</h1><p class="tag">${nt("Uit HitStory, de popencyclopedie van School of Rock", "From HitStory, the pop encyclopedia of School of Rock")} · ${esc(label(l))}</p>`;
  b += infobox(l) + lead;
  const koppen = secties.filter(([id]) => id !== "zieook" && id !== "bronnen");
  if (koppen.length >= 3) b += `<nav class="toc"><b>${nt("Inhoud", "Contents")}</b><ol>${secties.map(([id, kop]) => `<li><a href="#${id}">${kop}</a></li>`).join("")}</ol></nav>`;
  for (const [id, kop, h] of secties) b += `<h2 id="${id}">${kop}</h2>${h}`;
  if (l.stub) b += `<div class="stub"><span>${nt("beginnetje", "stub")}</span><div>${nt(`Dit artikel is nog kort. Er komt nog een uitgebreidere tekst over ${esc(l.name)}.`, `This article is still short. A longer text about ${esc(l.name)} is coming.`)}</div></div>`;
  const cats = [TYPE[l.type][1], ...(l.links.genre || []).map((id: string) => byId.get(id)?.name).filter(Boolean)];
  b += `<div class="cats">${nt("Categorieën", "Categories")}: <a href="../alle.html#${l.type}">${esc(cats[0])}</a>${(l.links.genre || []).slice(0, 8).map((id: string) => a(id)).join("")}</div>`;
  const desc = korteTekst(l.defs?.[0]?.text || alineas[0] || nt(`${l.name} in HitStory, de popencyclopedie van School of Rock.`, `${l.name} in HitStory, the pop encyclopedia of School of Rock.`));
  const afb = l.foto ? BEELD + l.foto.src : l.tracklijst?.cover ? hoes(l.tracklijst.cover) : "";
  const url = SITE + baseVan(LANG) + "/" + l.id + ".html", E0 = SITE + baseVan(LANG) + "/";
  const jr = (x: any) => /^\d{4}(-\d\d(-\d\d)?)?$/.test(String(x ?? "")) ? String(x) : undefined;
  const genreNamen = (l.links.genre || []).map((id: string) => byId.get(id)?.name).filter(Boolean).slice(0, 5);
  const artiesten = (l.links.artiest || []).map((id: string) => byId.get(id)?.name).filter(Boolean);
  let ent: any = null;
  if (l.type === "artiest") ent = { "@type": isGroep(l) ? "MusicGroup" : "Person", name: l.name, description: desc, image: afb || undefined, genre: genreNamen.length ? genreNamen : undefined, ...(isGroep(l) ? { foundingDate: jr(Math.floor(l.year || 0) || undefined) } : { birthDate: jr(l.born), deathDate: jr(l.died), jobTitle: nt("muzikant", "musician") }), ...(l.ook?.length ? { alternateName: l.ook } : {}) };
  else if (l.type === "werk" && l.album) ent = { "@type": "MusicAlbum", name: l.name, byArtist: artiesten.map((n: string) => ({ "@type": "MusicGroup", name: n })), datePublished: jr(l.year), numTracks: l.tracklijst?.tracks.length, image: afb || undefined, genre: genreNamen.length ? genreNamen : undefined };
  else if (l.type === "werk") ent = { "@type": "MusicRecording", name: l.name, byArtist: artiesten.map((n: string) => ({ "@type": "MusicGroup", name: n })), datePublished: jr(l.year) };
  else if (l.type === "begrip") ent = { "@type": "DefinedTerm", name: l.name, description: desc, inDefinedTermSet: E0 + "alle.html#begrip" };
  else ent = { "@type": "Thing", name: l.name, description: desc };
  const ld = [
    { "@type": "Article", "@id": url + "#artikel", headline: l.name, description: desc, inLanguage: LANG, url, image: afb || OG_STANDAARD, mainEntityOfPage: url, about: ent, author: { "@type": "Person", name: "Jan-Wolter Smit" }, publisher: { "@type": "Organization", name: "School of Rock", url: SITE } },
    { "@type": "BreadcrumbList", itemListElement: [["School of Rock", SITE], ["HitStory", E0 + "index.html"], [TYPE[l.type][1], E0 + "alle.html"], [l.name, url]].map(([n, u], i) => ({ "@type": "ListItem", position: i + 1, name: n, item: u })) },
  ];
  return page(ROOT, l.name, desc, b, (tracks.length ? FRAG_JS : "") + (l.tracklijst ? TL_JS : ""), !l.stub, l.id + ".html", afb, ld);
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
  let b = `<div class="welkom"><p class="kicker">${L.length.toLocaleString(nt("nl-NL", "en-GB"))} ${nt("artikelen", "articles")}</p><h1>${nt("Van work songs tot hyperpop", "From work songs to hyperpop")}</h1><p class="lede">${nt("Artiesten, genres, albums, begrippen en uitvindingen uit de mixtapes, kaarten en het magazine van School of Rock.", "Artists, genres, albums, terms and inventions from the mixtapes, maps and magazine of School of Rock.")}</p></div>`;
  b += `<div class="portalen">${Object.keys(TYPE).map((t) => `<a href="alle.html#${t}"><b>${(tel[t] || 0).toLocaleString(nt("nl-NL", "en-GB"))}</b>${TYPE[t][1]}</a>`).join("")}</div><br>`;
  b += `<div class="hp"><div><section class="vak geel"><h2>${nt("Uitgelicht artikel", "Featured article")}</h2><div class="in" id="dag"></div></section><section class="vak groen"><h2>${nt("Uitgelicht genre", "Featured genre")}</h2><div class="in" id="genre"></div></section></div>`;
  b += `<div><section class="vak blauw"><h2>${nt("Wist je dat…", "Did you know…")}</h2><div class="in"><ul class="wist" id="wist"></ul></div></section><section class="vak paars"><h2>${nt("Bladeren", "Browse")}</h2><div class="in"><p><a href="alle.html#artiest">${nt("Alle artiesten", "All artists")}</a> · <a href="alle.html#genre">${nt("Alle genres", "All genres")}</a> · <a href="alle.html#werk">${nt("Albums en nummers", "Albums and songs")}</a> · <a href="alle.html#begrip">${nt("Begrippen", "Terms")}</a> · <a href="alle.html#techniek">${nt("Techniek en uitvindingen", "Technology and inventions")}</a></p><p>${nt("Elk artikel verwijst naar het hoofdstuk, de kaart of het magazineverhaal waarin het voorkomt, en laat de fragmenten horen.", "Each article links to the chapter, map or magazine story in which it appears, and lets you hear the excerpts.")}</p></div></section></div></div>`;
  const js = `<script>(function(){const READ=${JSON.stringify(nt("Lees verder", "Read more"))};const U=${JSON.stringify(uitgelicht).replace(/</g, "\\u003c")},G=${JSON.stringify(genres).replace(/</g, "\\u003c")},W=${JSON.stringify(wist).replace(/</g, "\\u003c")};const d=Math.floor(Date.now()/864e5);const e=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');const kaart=(x,el)=>{document.getElementById(el).innerHTML=(x.f?'<img class="dag" src="'+x.f+'" alt="">':'')+'<p><b><a href="'+x.id+'.html">'+e(x.n)+'</a></b>. '+e(x.t.length>520?x.t.slice(0,x.t.lastIndexOf(' ',500))+'…':x.t)+' <a href="'+x.id+'.html">'+READ+'</a></p>'};if(U.length)kaart(U[d%U.length],'dag');if(G.length)kaart(G[(d*7)%G.length],'genre');const w=[];for(let i=0;i<5&&W.length;i++){const x=W[(d*13+i*97)%W.length];w.push('<li>…<a href="'+x.id+'.html">'+e(x.n)+'</a>: '+e(x.t)+'</li>')}document.getElementById('wist').innerHTML=w.join('')})();</script>`;
  const E0 = SITE + baseVan(LANG) + "/";
  const hdesc = nt("HitStory is de popencyclopedie van School of Rock: duizenden artikelen over artiesten, genres, albums, begrippen en techniek uit de geschiedenis van de popmuziek, met luisterfragmenten.", "HitStory is the pop encyclopedia of School of Rock: thousands of articles on artists, genres, albums, terms and technology from the history of popular music, with listening excerpts.");
  const hld = [{ "@type": "WebSite", "@id": SITE + "#hitstory", name: "HitStory", alternateName: "HitStory – School of Rock", url: E0 + "index.html", inLanguage: LANG, description: hdesc, publisher: { "@type": "Organization", name: "School of Rock", url: SITE } }, { "@type": "CollectionPage", name: "HitStory", url: E0 + "index.html", description: hdesc, isPartOf: { "@id": SITE + "#hitstory" } }];
  return page(ROOT0, nt("De popencyclopedie van School of Rock", "The pop encyclopedia of School of Rock"), hdesc, b, js, true, "index.html", "", hld, "website");
}

// ---------- Alle lemma's A-Z ----------

// Bewerkpagina: haalt de tekst uit de pagina zelf (hs-bron), bewaart naar GitHub (bouw/encyclopedie/bewerkt/) en start de bouw.
function bewerkPagina() {
  const MAP = LANG === "en" ? "bewerkt-en" : "bewerkt";
  const b = `<h1>${LANG === "en" ? "Pagina bewerken (Engels)" : "Pagina bewerken"}</h1>
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
  var r=await api("/contents/bouw/encyclopedie/${MAP}/"+id+".json?ref=main");
  if(r.ok){var j=JSON.parse(decodeURIComponent(escape(atob((await r.json()).content.split(String.fromCharCode(10)).join("")))));d=Object.assign(d,j)}
  $("bw-naam").value=d.name||"";$("bw-tekst").value=d.text||"";$("bw-luister").value=d.listen||"";
  document.title="Bewerk: "+(d.name||id)
}
$("bw-bewaar-token").onclick=function(){var v=$("bw-token").value.trim();if(v){localStorage.setItem("hs_token",v);toon()}};
$("bw-uit").onclick=function(e){e.preventDefault();localStorage.removeItem("hs_token");toon()};
$("bw-opslaan").onclick=async function(){
  try{
    st("Bezig met opslaan…");var pad="/contents/bouw/encyclopedie/${MAP}/"+id+".json";
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
  return page(ROOT0, "Bewerken", "Bewerkpagina voor de eigenaar.", b, js, false);
}

function allePagina() {
  const rows = [...L].filter((l) => !l.album).sort((x, z) => sortKey(x.name).localeCompare(sortKey(z.name)) || x.type.localeCompare(z.type));
  const tel: Record<string, number> = {};
  for (const l of rows) tel[l.type] = (tel[l.type] || 0) + 1;
  const groepen = new Map<string, any[]>();
  for (const l of rows) { const k = letter(l.name); (groepen.get(k) || groepen.set(k, []).get(k)!).push(l); }
  const letters = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
  let b = `<h1>${nt("Alle artikelen", "All articles")}</h1><p class="tag">${rows.length.toLocaleString(nt("nl-NL", "en-GB"))} ${nt("artikelen", "articles")} · <span id="count"></span></p>`;
  b += `<div class="chips" id="chips"><button data-f="" aria-pressed="true">${nt("Alles", "All")} (${rows.length})</button>${Object.keys(TYPE).map((t) => `<button data-f="${t}" aria-pressed="false">${TYPE[t][1]} (${tel[t] || 0})</button>`).join("")}</div>`;
  b += `<nav class="az">${letters.map((x) => `<a href="#l-${x === "#" ? "0" : x}"${groepen.has(x) ? "" : ' class="leeg"'}>${x}</a>`).join("")}</nav>`;
  for (const x of letters) {
    const g = groepen.get(x); if (!g) continue;
    b += `<section class="groep" id="l-${x === "#" ? "0" : x}"><h2>${x}</h2><ul class="lijst">${g.map((l) => `<li data-t="${l.type}"><a href="${l.id}.html">${esc(l.name)}</a><span class="t">${esc(label(l))}</span></li>`).join("")}</ul></section>`;
  }
  const js = `<script>(function(){const SHOWN=${JSON.stringify(nt("getoond", "shown"))};const c=document.getElementById('count'),items=[...document.querySelectorAll('.lijst li')],groups=[...document.querySelectorAll('.groep')],chips=[...document.querySelectorAll('#chips button')];let f=(location.hash.match(/^#(artiest|genre|werk|begrip|techniek)$/)||[])[1]||'';function go(){let k=0;items.forEach(i=>{const hit=!f||i.dataset.t===f;i.hidden=!hit;if(hit)k++});groups.forEach(g=>g.hidden=!g.querySelector('li:not([hidden])'));chips.forEach(b=>b.setAttribute('aria-pressed',b.dataset.f===f));c.textContent=k+' '+SHOWN}chips.forEach(b=>b.onclick=()=>{f=b.dataset.f;history.replaceState(null,'',f?'#'+f:location.pathname);go()});go()})();</script>`;
  return page(ROOT0, nt("Alle artikelen", "All articles"), nt("Alle artikelen van HitStory, de popencyclopedie van School of Rock, van A tot Z.", "All articles of HitStory, the pop encyclopedia of School of Rock, from A to Z."), b, js, true, "alle.html");
}

// ---------- Bouwen: eerst Nederlands, dan Engels ----------
function init(taal: Taal) {
  LANG = taal; ROOT = taal === "en" ? "../../.." : "../.."; ROOT0 = taal === "en" ? "../.." : "..";
  TYPE = TYPE_TAAL[taal]; SOORT = SOORT_TAAL[taal];
  const alles = taal === "en" ? maakEn() : LNL;
  byId = new Map(alles.map((l) => [l.id, l]));
  GEBOUWD = new Set(taal === "en" ? alles.filter(heeftEn).map((l) => l.id) : alles.map((l) => l.id));
  if (taal === "en") vermeldEn(alles, byId, GEBOUWD);
  L = taal === "en" ? alles.filter((l) => GEBOUWD.has(l.id)) : alles;
  ALLES = alles;
  initLinks();
}
let ALLES: any[] = [];
// Bewerkmodus (alleen voor de eigenaar, nl en en met eigen bewerkmap): elke pagina draagt zijn eigen tekst als JSON; een knop verschijnt alleen als er een GitHub-sleutel in de browser staat
const bewerkKnop = (l: any) => '<script type="application/json" id="hs-bron">' + JSON.stringify({ id: l.id, name: l.name, text: l.text || "", listen: l.listen || "" }).replace(/</g, "\u003c") + '</script>' +
  '<script>try{if(localStorage.getItem("hs_token")){var m=document.querySelector("main.blad");if(m){var a=document.createElement("a");a.href=document.querySelector("meta[name=sor-root]").content+"/' + baseVan(LANG) + '/bewerk.html?id="+encodeURIComponent("' + l.id + '");a.textContent="✎ Bewerk deze pagina";a.style.cssText="float:right;font:600 13px Inter,sans-serif;padding:4px 10px;border:1px solid currentColor;border-radius:6px;text-decoration:none";m.insertBefore(a,m.firstChild)}}}catch(e){}</script>';

for (const taal of ["nl", "en"] as Taal[]) {
  init(taal);
  const OUT = OUTDIR(taal);
  // Oude pagina's weg, foto's (img/) blijven staan
  Deno.mkdirSync(OUT, { recursive: true });
  for (const ty of Object.keys(TYPE)) { try { Deno.removeSync(OUT + ty, { recursive: true }); } catch { /* eerste keer */ } Deno.mkdirSync(OUT + ty, { recursive: true }); }
  if (taal === "nl") Deno.writeTextFileSync(OUT + "enc.css", CSS);
  Deno.writeTextFileSync(OUT + "index.html", hoofdpagina());
  Deno.writeTextFileSync(OUT + "alle.html", allePagina());
  // zoeklijst: in het Engels ook de lemma's zonder Engelse pagina (vierde waarde 1 = link naar de Nederlandse pagina)
  Deno.writeTextFileSync(OUT + "zoek.json", JSON.stringify(ALLES.map((l) => taal === "en" && !GEBOUWD.has(l.id) ? [l.id, l.name, label(l), 1] : [l.id, l.name, label(l)])));
  const HASH: Record<string, string> = {};
  const hash = async (t: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(t)))].slice(0, 6).map((x) => x.toString(16).padStart(2, "0")).join("");
  for (const l of L) { const h = lemmaPage(l).replace("</body>", bewerkKnop(l) + "</body>"); Deno.writeTextFileSync(OUT + l.id + ".html", h); HASH[l.id + ".html"] = await hash(h); }
  for (const f of ["index.html", "alle.html"]) HASH[f] = await hash(Deno.readTextFileSync(OUT + f));
  Deno.writeTextFileSync(OUT + "hash.json", JSON.stringify(HASH));
  Deno.writeTextFileSync(OUT + "bewerk.html", bewerkPagina());
  // voor de sitemap: hoofdpagina, A-Z en alle lemma's die geen beginnetje zijn
  Deno.writeTextFileSync(ED + "data/sitemap" + (taal === "en" ? "-en" : "") + ".json", JSON.stringify(["index.html", "alle.html", ...L.filter((l) => !l.stub).map((l) => l.id + ".html")]));
  console.log(taal, "geschreven:", L.length, "lemma-pagina's + hoofdpagina + A-Z in", OUT);
}
