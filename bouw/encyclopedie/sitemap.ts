// Zet de HitStory-adressen in sitemap.xml, met hreflang-alternatieven en een lastmod die alleen verandert als de pagina echt veranderd is.
// Vergelijkt de paginahash met hash.json van de vorige publicatie (live op sorock.nl); zonder eerdere hash geldt vandaag.
const nu = new Date().toISOString().slice(0, 10);
const S = "https://sorock.nl/";
type M = Record<string, [string, string]>;
async function merge(pad: string, hier: string): Promise<M> {
  const nieuw: Record<string, string> = JSON.parse(Deno.readTextFileSync(hier));
  let oud: any = {};
  try { const r = await fetch(S + pad + "hash.json"); if (r.ok) oud = await r.json(); } catch { /* eerste keer */ }
  const m: M = {};
  for (const [k, h] of Object.entries(nieuw)) m[k] = Array.isArray(oud[k]) && oud[k][0] === h ? oud[k] : [h, nu];
  return m;
}
const nl = await merge("encyclopedie/", "bouw/site/encyclopedie/hash.json");
const en = await merge("en/encyclopedie/", "bouw/site/en/encyclopedie/hash.json");
const pn: string[] = JSON.parse(Deno.readTextFileSync("bouw/encyclopedie/data/sitemap.json"));
const pe: string[] = JSON.parse(Deno.readTextFileSync("bouw/encyclopedie/data/sitemap-en.json"));
const inEn = new Set(pe), inNl = new Set(pn);
const alt = (q: string) => `<xhtml:link rel="alternate" hreflang="nl" href="${S}encyclopedie/${q}"/><xhtml:link rel="alternate" hreflang="en" href="${S}en/encyclopedie/${q}"/><xhtml:link rel="alternate" hreflang="x-default" href="${S}encyclopedie/${q}"/>`;
const rij = (pre: string, q: string, m: M, tweetalig: boolean) => `<url><loc>${S}${pre}${q}</loc><lastmod>${m[q]?.[1] ?? nu}</lastmod>${tweetalig ? alt(q) : ""}</url>`;
const x = Deno.readTextFileSync("sitemap.xml").split("\n").filter((r) => !r.includes("/encyclopedie/"));
const i = x.findIndex((r) => r.includes("</urlset>"));
x.splice(i, 0, ...pn.map((q) => rij("encyclopedie/", q, nl, inEn.has(q))), ...pe.map((q) => rij("en/encyclopedie/", q, en, inNl.has(q))));
const k = x.findIndex((r) => r.startsWith("<urlset"));
if (!x[k].includes("xmlns:xhtml")) x[k] = x[k].replace("<urlset", '<urlset xmlns:xhtml="http://www.w3.org/1999/xhtml"');
Deno.writeTextFileSync("sitemap.xml", x.join("\n"));
// bewaar de datums voor de volgende bouw
Deno.writeTextFileSync("bouw/site/encyclopedie/hash.json", JSON.stringify(nl));
Deno.writeTextFileSync("bouw/site/en/encyclopedie/hash.json", JSON.stringify(en));
console.log("sitemap: nl", pn.length, "en", pe.length);
