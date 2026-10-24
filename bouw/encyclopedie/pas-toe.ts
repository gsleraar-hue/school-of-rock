// Legt handmatig bewerkte lemma's (bouw/encyclopedie/bewerkt/<type>/<slug>.json, gemaakt door de bewerkpagina) over data/lemmas.json heen.
// Bestaat het lemma nog niet en staat er "nieuw": true in, dan wordt het aangemaakt. "verwijderd": true haalt het lemma weg.
const D = new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const L: any[] = JSON.parse(Deno.readTextFileSync(D + "data/lemmas.json"));
const by = new Map(L.map((l) => [l.id, l]));
const TEKST = ["name", "text", "listen", "place", "sub", "who", "artist", "soort", "soortArtiest"];
const GETAL = ["born", "died", "year", "nr"];
const LIJST = ["ook", "works", "disco", "defs", "extra"];
let n = 0, nieuw = 0, weg = 0;
try {
  for (const t of Deno.readDirSync(D + "bewerkt")) if (t.isDirectory) for (const f of Deno.readDirSync(D + "bewerkt/" + t.name)) {
    if (!f.name.endsWith(".json")) continue;
    const id = t.name + "/" + f.name.replace(/\.json$/, "");
    const o = JSON.parse(Deno.readTextFileSync(D + "bewerkt/" + t.name + "/" + f.name).replace(/^﻿/, ""));
    let l = by.get(id);
    if (!l) {
      if (!o.nieuw) { console.log("onbekend lemma, overgeslagen:", id); continue; }
      l = { id, type: t.name, name: o.name || id, links: {}, tracks: [], refs: [], bron: ["eigen"], stub: true };
      L.push(l); by.set(id, l); nieuw++;
    }
    if (o.verwijderd) { l.weg = true; weg++; continue; }
    for (const k of TEKST) if (typeof o[k] === "string") { if (o[k].trim()) l[k] = o[k].trim(); else if (k !== "name") delete l[k]; }
    for (const k of GETAL) if (k in o) { if (o[k] === null || o[k] === "") delete l[k]; else if (!isNaN(+o[k])) l[k] = +o[k]; }
    for (const k of LIJST) if (Array.isArray(o[k])) { if (o[k].length) l[k] = o[k]; else delete l[k]; }
    if ("foto" in o) { if (o.foto && o.foto.src) l.foto = o.foto; else delete l.foto; }
    if (typeof o.cover === "string" && o.cover) { if (l.tracklijst) l.tracklijst.cover = o.cover; else l.tracklijst = { cover: o.cover, tracks: [] }; }
    if (o.links && typeof o.links === "object") l.links = { ...(l.links || {}), ...o.links };
    if (String(l.text || "").trim() || (l.defs && l.defs.length)) l.stub = false;
    n++;
  }
} catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
Deno.writeTextFileSync(D + "data/lemmas.json", JSON.stringify(L.filter((l) => !l.weg)));
console.log("bewerkte lemma's toegepast:", n, "· nieuw:", nieuw, "· verwijderd:", weg);
