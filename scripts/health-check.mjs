// Hourly production health check (.github/workflows/health-check.yml).
// Every function of thousandworldsexplorer.com that is reachable over HTTP:
// the gated home, the app bundle, data + freshness, World-of-the-Day, the
// public emulator (landing, weights, registry), legal pages, SEO surfaces.
// Exits non-zero on ANY failure so the workflow fails loudly (GitHub emails).
// Run locally: node scripts/health-check.mjs
const BASE = 'https://thousandworldsexplorer.com';
const failures = [];
let checks = 0;

async function check(name, fn) {
  checks++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    console.error(`  ✖ ${name}: ${e.message}`);
  }
}

const get = async (path, type = 'text') => {
  const r = await fetch(BASE + path, { redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return type === 'json' ? r.json() : type === 'buffer' ? new Uint8Array(await r.arrayBuffer()) : r.text();
};
const head = async (path) => {
  const r = await fetch(BASE + path, { method: 'GET', redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
};

// --- the gated home -------------------------------------------------------
let rootHtml = '';
await check('root serves the Explorer shell', async () => {
  rootHtml = await get('/');
  if (!rootHtml.includes('<title>ThousandWorlds Explorer')) throw new Error('title missing');
  if (!rootHtml.includes('og:image')) throw new Error('og tags missing');
});
await check('app bundle loads and carries the landing + app', async () => {
  const m = rootHtml.match(/assets\/index-[^"]+\.js/);
  if (!m) throw new Error('no bundle reference in HTML');
  const js = await get(`/${m[0]}`);
  for (const marker of ['Launch the explorer', 'Save to my Lab']) {
    if (!js.includes(marker)) throw new Error(`bundle missing "${marker}"`);
  }
});
await check('landing screenshots serve', async () => {
  await head('/shots/portrait.jpg');
  await head('/shots/emulator-globe.jpg');
});

// --- data + freshness -----------------------------------------------------
await check('worlds.json parses with a sane catalog', async () => {
  const worlds = await get('/worlds.json', 'json');
  if (!Array.isArray(worlds) || worlds.length < 6000) throw new Error(`only ${worlds?.length} worlds`);
});
await check('meta.json consistent and fresh (< 45 days)', async () => {
  const meta = await get('/meta.json', 'json');
  const age = (Date.now() - new Date(meta.generated).getTime()) / 86400000;
  if (!(meta.total >= 6000)) throw new Error(`total ${meta.total}`);
  if (age > 45) throw new Error(`data is ${age.toFixed(0)} days old — refresh Action broken?`);
});
await check('surface field ships gzipped', async () => {
  const b = await get('/tw-surface.u8.gz', 'buffer');
  if (b[0] !== 0x1f || b[1] !== 0x8b) throw new Error('gzip magic bytes missing');
});
await check("world of the day covers today", async () => {
  const wotd = await get('/wotd.json', 'json');
  const today = new Date().toISOString().slice(0, 10);
  if (!wotd.days?.[today]?.name) throw new Error(`no entry for ${today}`);
  const rss = await get('/wotd.xml');
  if (!rss.includes('<rss')) throw new Error('RSS malformed');
});

// --- the public emulator --------------------------------------------------
let emuHtml = '';
await check('emulator serves through the proxy', async () => {
  emuHtml = await get('/emulator/');
  if (!emuHtml.includes('assets/index-')) throw new Error('no bundle reference');
});
await check('emulator bundle carries the private-preview gate', async () => {
  const m = emuHtml.match(/assets\/index-[^"]+\.js/);
  const js = await get(`/emulator/${m[0]}`);
  if (!js.includes('private preview')) throw new Error('bundle missing the private-preview gate');
});
await check('emulator weights + registry serve', async () => {
  const models = await get('/emulator/models.json', 'json');
  if (!models?.[0]?.id) throw new Error('models.json malformed');
  const onnx = await get('/emulator/pca_gbt_surface_temperature.onnx.gz', 'buffer');
  if (onnx[0] !== 0x1f || onnx[1] !== 0x8b) throw new Error('onnx.gz magic bytes missing');
  await head('/emulator/sims-meta.json');
});

// --- SEO + legal surfaces -------------------------------------------------
await check('robots, sitemap, og image, cite surfaces', async () => {
  await head('/robots.txt'); await head('/sitemap.xml'); await head('/og.png');
});
await check('privacy + terms pages', async () => {
  await head('/privacy'); await head('/terms');
});

// --- optional: Supabase reachability (uses the keep-alive secrets if set) --
const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_ANON_KEY;
if (SB_URL && SB_KEY) {
  await check('Supabase REST reachable (auth/save/share backend)', async () => {
    const r = await fetch(`${SB_URL}/rest/v1/events?select=id&limit=1`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  });
} else {
  console.log('  – Supabase check skipped (secrets not configured)');
}

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.error(`\n✖ HEALTH CHECK FAILED:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('✓ all systems healthy');
