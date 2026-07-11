// Sanity gate for the weekly NASA data refresh (.github/workflows/data-refresh.yml).
// Compares the freshly built public/worlds.json + public/meta.json against the
// last committed meta.json and fails LOUDLY on anything that smells like a bad
// pull (schema change, truncated CSV, archive outage) so a broken dataset can
// never auto-merge. Run from the repo root after `npm run data`:
//   node scripts/validate-data.mjs
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const fail = (msg) => { console.error(`✖ data validation failed: ${msg}`); process.exit(1); };

if (!existsSync('public/worlds.json') || !existsSync('public/meta.json')) {
  fail('public/worlds.json or public/meta.json missing — did `npm run data` run?');
}

const worlds = JSON.parse(readFileSync('public/worlds.json', 'utf8'));
const meta = JSON.parse(readFileSync('public/meta.json', 'utf8'));

// 1) Internal consistency.
if (!Array.isArray(worlds) || worlds.length === 0) fail('worlds.json is empty or not an array');
if (meta.total !== worlds.length) fail(`meta.total (${meta.total}) != worlds.length (${worlds.length})`);

// 2) Schema: every field the app filters/plots on must exist on the first rows.
const REQUIRED = ['name', 'host', 'dist_ly', 'radius', 'mass', 'teq', 'insol', 'period',
  'year', 'method', 'st_teff', 'esi', 'hz'];
for (const key of REQUIRED) {
  if (!(key in worlds[0])) fail(`worlds[0] is missing required field "${key}" — did the TAP column set change?`);
}
if (worlds.some((w) => !w.name)) fail('found worlds with no name');

// 3) Coverage floors: a truncated pull produces rows but empty columns.
const withRadius = worlds.filter((w) => w.radius != null).length;
if (withRadius / worlds.length < 0.5) fail(`radius coverage collapsed: ${withRadius}/${worlds.length}`);

// 4) Row count vs the last committed dataset: growth is normal, small trims of
//    retracted planets happen, a big drop means a bad pull.
let prevTotal = null;
try {
  prevTotal = JSON.parse(execSync('git show HEAD:public/meta.json', { encoding: 'utf8' })).total;
} catch { /* first run or meta not yet committed — skip the comparison */ }
if (prevTotal != null && worlds.length < prevTotal * 0.98) {
  fail(`row count dropped ${prevTotal} → ${worlds.length} (>2%) — refusing to auto-merge`);
}

console.log(`✓ data validated: ${worlds.length} worlds` +
  (prevTotal != null ? ` (was ${prevTotal})` : '') +
  `, radius coverage ${withRadius}, generated ${meta.generated}`);
