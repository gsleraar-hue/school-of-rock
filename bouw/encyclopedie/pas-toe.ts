// Legt handmatig bewerkte teksten (bouw/encyclopedie/bewerkt/<type>/<slug>.json, gemaakt door de bewerkpagina) over data/lemmas.json heen.
const D = new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const L: any[] = JSON.parse(Deno.readTextFileSync(D + "data/lemmas.json"));
const by = new Map(L.map((l) => [l.id, l]));
let n = 0;
try {
  for (const t of Deno.readDirSync(D + "bewerkt")) if (t.isDirectory) for (const f of Deno.readDirSync(D + "bewerkt/" + t.name)) {
    if (!f.name.endsWith(".json")) continue;
    const id = t.name + "/" + f.name.replace(/\.json$/, "");
    const l = by.get(id);
    if (!l) { console.log("onbekend lemma, overgeslagen:", id); continue; }
    const o = JSON.parse(Deno.readTextFileSync(D + "bewerkt/" + t.name + "/" + f.name));
    for (const k of ["name", "text", "listen"]) if (typeof o[k] === "string" && o[k].trim()) l[k] = o[k];
    n++;
  }
} catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
Deno.writeTextFileSync(D + "data/lemmas.json", JSON.stringify(L));
console.log("bewerkte teksten toegepast:", n);
