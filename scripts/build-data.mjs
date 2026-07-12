// ThousandWorlds — data pipeline
// Reads the raw NASA Exoplanet Archive CSV (data/raw/pscomppars.csv),
// cleans + enriches it, and writes app-ready JSON to src/data/.
// Run from the project root:  node scripts/build-data.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const RAW = 'data/raw/pscomppars.csv';
const OUT_DIR = 'public';

// --- tiny CSV parser (handles quoted fields, escaped quotes, CRLF) ---
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const num = (v) => { const t = (v ?? '').trim(); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
const str = (v) => { const t = (v ?? '').trim(); return t === '' ? null : t; };
const round = (n, d) => (n == null ? null : Number(n.toFixed(d)));

const PC_TO_LY = 3.261563777;

// Rough "Earth-likeness" (0..1): geometric mean of a radius term and an
// equilibrium-temperature term, after the Earth Similarity Index idea.
// Transparent + clearly approximate — not an official habitability claim.
function earthLikeness(radius, teq) {
  if (radius == null || teq == null) return null;
  const r = 1 - Math.abs((radius - 1) / (radius + 1));
  const t = 1 - Math.abs((teq - 255) / (teq + 255));
  return round(Math.sqrt(r * t), 3);
}

const text = readFileSync(RAW, 'utf8');
const rows = parseCSV(text);
const header = rows[0];
const idx = Object.fromEntries(header.map((h, i) => [h, i]));
const col = (r, name) => r[idx[name]];

const worlds = rows.slice(1).filter(r => r.length > 1).map(r => {
  const distPc = num(col(r, 'sy_dist'));
  const radius = num(col(r, 'pl_rade'));
  const teq = num(col(r, 'pl_eqt'));
  const w = {
    name: str(col(r, 'pl_name')),
    host: str(col(r, 'hostname')),
    dist_ly: distPc == null ? null : round(distPc * PC_TO_LY, 2),
    radius,
    mass: num(col(r, 'pl_bmasse')),
    density: round(num(col(r, 'pl_dens')), 3),
    teq,
    insol: round(num(col(r, 'pl_insol')), 2),
    period: round(num(col(r, 'pl_orbper')), 4),
    smax: round(num(col(r, 'pl_orbsmax')), 4),
    ecc: round(num(col(r, 'pl_orbeccen')), 3),
    year: num(col(r, 'disc_year')),
    method: str(col(r, 'discoverymethod')),
    facility: str(col(r, 'disc_facility')),
    st_teff: round(num(col(r, 'st_teff')), 0),
    st_rad: round(num(col(r, 'st_rad')), 3),
    st_mass: round(num(col(r, 'st_mass')), 3),
    spectype: str(col(r, 'st_spectype')),
    snum: num(col(r, 'sy_snum')),
    pnum: num(col(r, 'sy_pnum')),
    ra: round(num(col(r, 'ra')), 4),
    dec: round(num(col(r, 'dec')), 4),
  };
  w.esi = earthLikeness(radius, teq);
  // beginner-friendly "could be temperate + rocky-ish" band
  w.hz = radius != null && teq != null && radius >= 0.5 && radius <= 1.8 && teq >= 180 && teq <= 320;
  return w;
}).filter(w => w.name);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/worlds.json`, JSON.stringify(worlds));

// --- summary + first discoveries ---
const has = (k) => worlds.filter(w => w[k] != null);
const by = (k, dir = 1) => has(k).sort((a, b) => (a[k] - b[k]) * dir);
const counts = (k) => {
  const m = {};
  for (const w of worlds) { const v = w[k]; if (v != null) m[v] = (m[v] || 0) + 1; }
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
};

const meta = {
  generated: new Date().toISOString(),
  source: 'NASA Exoplanet Archive — Planetary Systems Composite Parameters (pscomppars)',
  total: worlds.length,
  with_radius: has('radius').length,
  with_teq: has('teq').length,
  with_distance: has('dist_ly').length,
  habitable_band: worlds.filter(w => w.hz).length,
  first_year: Math.min(...has('year').map(w => w.year)),
  latest_year: Math.max(...has('year').map(w => w.year)),
  methods: counts('method'),
};
writeFileSync(`${OUT_DIR}/meta.json`, JSON.stringify(meta, null, 2));

// --- World of the Day: 21-day deterministic schedule + RSS feed ---
// Pick rule (stable across runs of the same dataset + same day window):
//   eligible = worlds with name+radius+teq+dist_ly+year (rich enough for an honest blurb)
//   pool     = union of (top 200 by esi) ∪ (nearest 200) ∪ (200 hash-spread across all
//              eligible) — biased toward interesting worlds without losing variety —
//              deduped by name, then sorted by name so order never depends on input order
//   pick(d)  = pool[fnv1a(d) % pool.length] for each UTC date d, today + next 20 days
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

const byName = (a, b) => (a.name < b.name ? -1 : 1);
const eligible = worlds
  .filter((w) => w.radius != null && w.teq != null && w.dist_ly != null && w.year != null)
  .sort(byName);
const ranked = (k, dir) => [...eligible].sort((a, b) => ((a[k] - b[k]) * dir) || byName(a, b));
const poolMap = new Map();
for (const w of ranked('esi', -1).slice(0, 200)) poolMap.set(w.name, w);    // most Earth-like
for (const w of ranked('dist_ly', 1).slice(0, 200)) poolMap.set(w.name, w); // nearest
for (let i = 0; i < 200; i++) { const w = eligible[fnv1a(`spread:${i}`) % eligible.length]; poolMap.set(w.name, w); } // hash-spread across the whole catalog
const pool = [...poolMap.values()].sort(byName);

// One honest sentence from measured fields — structure varies by thermal regime,
// every clause is a dataset fact, no habitability claims.
const METHOD_PHRASE = {
  'Transit': 'by transit', 'Radial Velocity': 'by radial velocity', 'Microlensing': 'by microlensing',
  'Imaging': 'by direct imaging', 'Transit Timing Variations': 'by transit timing',
  'Eclipse Timing Variations': 'by eclipse timing', 'Pulsar Timing': 'by pulsar timing',
  'Pulsation Timing Variations': 'by pulsation timing', 'Astrometry': 'by astrometry',
  'Orbital Brightness Modulation': 'by brightness modulation', 'Disk Kinematics': 'by disk kinematics',
};
function blurb(w) {
  const size = `${w.radius < 10 ? w.radius.toFixed(1) : Math.round(w.radius)}× Earth-size`;
  const dist = w.dist_ly < 10 ? w.dist_ly.toFixed(1) : Math.round(w.dist_ly).toLocaleString('en-US');
  const how = METHOD_PHRASE[w.method] ?? (w.method ? `by ${w.method.toLowerCase()}` : '');
  const found = (verb) => `${verb} in ${w.year}${how ? ` ${how}` : ''}`;
  const t = Math.round(w.teq);
  if (w.hz) return `A ${size} world in the temperate band, ${dist} light-years away, ${found('found')}.`;
  if (w.teq >= 700) return `A scorching ${size} world near ${t} K, ${dist} light-years away, ${found('spotted')}.`;
  if (w.teq < 180) return `A frigid ${size} world near ${t} K, ${dist} light-years from Earth, ${found('detected')}.`;
  return `A ${size} world with an equilibrium temperature around ${t} K, ${dist} light-years away, ${found('found')}.`;
}

const DAY_MS = 86400000;
const dayZero = Math.floor(Date.now() / DAY_MS) * DAY_MS; // today 00:00 UTC
const days = {};
for (let i = 0; i < 21; i++) {
  const date = new Date(dayZero + i * DAY_MS).toISOString().slice(0, 10);
  const w = pool[fnv1a(date) % pool.length];
  days[date] = { name: w.name, blurb: blurb(w) };
}
writeFileSync(`${OUT_DIR}/wotd.json`, JSON.stringify({ generated: new Date().toISOString(), days }, null, 2));

// RSS 2.0 — future-dated items are intentional: the whole 21-day window ships in
// one feed, valid per the spec, and readers surface each item on/after its pubDate.
// lastBuildDate is pinned to the window start (not now()) so output stays
// byte-identical across same-day rebuilds of the same dataset.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const items = Object.entries(days).map(([date, d]) => `    <item>
      <title>${esc(`${d.name} — world of the day, ${date}`)}</title>
      <link>https://thousandworldsexplorer.com/?wotd=${date}</link>
      <guid isPermaLink="false">${esc(`${date} ${d.name}`)}</guid>
      <pubDate>${new Date(`${date}T00:00:00Z`).toUTCString()}</pubDate>
      <description>${esc(d.blurb)}</description>
    </item>`).join('\n');
writeFileSync(`${OUT_DIR}/wotd.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>ThousandWorlds — World of the Day</title>
    <link>https://thousandworldsexplorer.com/</link>
    <description>One real world a day from the NASA Exoplanet Archive, picked deterministically and described only by its measured facts.</description>
    <language>en</language>
    <lastBuildDate>${new Date(`${Object.keys(days)[0]}T00:00:00Z`).toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`);

const fmt = (w, k, u = '') => (w[k] == null ? '?' : w[k] + u);
console.log(`\n  ThousandWorlds — ${worlds.length} worlds written to ${OUT_DIR}/worlds.json\n`);
console.log(`  Coverage: radius ${meta.with_radius}, temp ${meta.with_teq}, distance ${meta.with_distance}`);
console.log(`  In the temperate Earth-size band: ${meta.habitable_band}`);
console.log(`  Discovered between ${meta.first_year} and ${meta.latest_year}\n`);
console.log('  Closest worlds to Earth:');
by('dist_ly').slice(0, 5).forEach(w => console.log(`    ${w.dist_ly} ly  ${w.name}  (${fmt(w, 'radius')}× Earth, ~${fmt(w, 'teq')}K)`));
console.log('\n  Most Earth-like (rough score):');
by('esi', -1).slice(0, 5).forEach(w => console.log(`    ${w.esi}  ${w.name}  (${fmt(w, 'radius')}× Earth, ~${fmt(w, 'teq')}K, ${fmt(w, 'dist_ly')} ly)`));
console.log('\n  Hottest worlds:');
by('teq', -1).slice(0, 3).forEach(w => console.log(`    ~${w.teq}K  ${w.name}`));
console.log('\n  How they were found:');
meta.methods.slice(0, 6).forEach(([m, n]) => console.log(`    ${String(n).padStart(5)}  ${m}`));
console.log(`\n  World of the Day: 21 days scheduled from a pool of ${pool.length} (wotd.json + wotd.xml)`);
console.log(`    ${Object.keys(days)[0]}  ${days[Object.keys(days)[0]].name}`);
console.log('');
