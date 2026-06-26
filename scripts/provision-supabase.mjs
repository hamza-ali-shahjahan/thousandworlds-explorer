#!/usr/bin/env node
// Auto-provision a Supabase backend for this project — the "Lovable-style" path.
//
// One-time, machine-wide: create a Supabase Personal Access Token and export it
//   export SUPABASE_ACCESS_TOKEN=sbp_xxx        (Account → Access Tokens)
//   export SUPABASE_ORG_ID=your_org_id          (optional; first org used if unset)
// Then, per project:
//   npm run provision:supabase -- [project-name] [region]
//
// It creates the project, waits for it to come up, applies supabase/schema.sql
// (+ supabase/admins.local.sql if present), sets the auth URLs, and writes
// .env.local with the URL + anon key. Re-run safe-ish: it errors if a same-named
// project already exists (Supabase allows duplicates, so we guard on name).
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const API = 'https://api.supabase.com/v1';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const NAME = process.argv[2] || 'thousandworlds';
const REGION = process.argv[3] || process.env.SUPABASE_REGION || 'eu-west-2';
const SITE_URL = process.env.SITE_URL || 'https://thousandworldsexplorer.com';

if (!TOKEN) {
  console.error('✖ Set SUPABASE_ACCESS_TOKEN first (Supabase → Account → Access Tokens).');
  process.exit(1);
}

const h = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, init = {}) {
  const res = await fetch(API + path, { ...init, headers: { ...h, ...(init.headers || {}) } });
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  return body;
}

async function runSql(ref, sql) {
  return api(`/projects/${ref}/database/query`, { method: 'POST', body: JSON.stringify({ query: sql }) });
}

(async () => {
  // 1) organization
  let orgId = process.env.SUPABASE_ORG_ID;
  if (!orgId) {
    const orgs = await api('/organizations');
    if (!orgs?.length) throw new Error('No organizations on this account.');
    orgId = orgs[0].id;
    console.log(`• Org: ${orgs[0].name} (${orgId})`);
  }

  // 2) guard against a duplicate name
  const existing = (await api('/projects')).find((p) => p.name === NAME);
  if (existing) {
    console.error(`✖ A project named "${NAME}" already exists (${existing.id}). Pick another name or delete it first.`);
    process.exit(1);
  }

  // 3) create
  const dbPass = randomBytes(18).toString('base64url');
  console.log(`• Creating project "${NAME}" in ${REGION}…`);
  const proj = await api('/projects', {
    method: 'POST',
    body: JSON.stringify({ organization_id: orgId, name: NAME, region: REGION, db_pass: dbPass }),
  });
  const ref = proj.id;
  console.log(`  ref: ${ref}`);

  // 4) wait until healthy (up to ~6 min)
  process.stdout.write('• Waiting for it to come up');
  for (let i = 0; i < 72; i++) {
    const p = await api(`/projects/${ref}`).catch(() => null);
    if (p?.status === 'ACTIVE_HEALTHY') { console.log(' ✓'); break; }
    process.stdout.write('.');
    await sleep(5000);
    if (i === 71) { console.log('\n✖ Timed out waiting for the project. Check the Supabase dashboard.'); process.exit(1); }
  }

  // 5) keys
  const keys = await api(`/projects/${ref}/api-keys`);
  const anon = keys.find((k) => k.name === 'anon')?.api_key;
  const url = `https://${ref}.supabase.co`;
  if (!anon) throw new Error('Could not read the anon key.');

  // 6) schema + admin seed
  console.log('• Applying supabase/schema.sql…');
  await runSql(ref, readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  const adminSeed = new URL('../supabase/admins.local.sql', import.meta.url);
  if (existsSync(adminSeed)) {
    console.log('• Applying supabase/admins.local.sql (admin allowlist)…');
    await runSql(ref, readFileSync(adminSeed, 'utf8'));
  } else {
    console.log('• (no supabase/admins.local.sql found — add admins later)');
  }

  // 7) auth URLs (so magic-link redirects work locally + in prod)
  console.log('• Setting auth URLs…');
  await api(`/projects/${ref}/config/auth`, {
    method: 'PATCH',
    body: JSON.stringify({ site_url: SITE_URL, uri_allow_list: `${SITE_URL},http://localhost:5173` }),
  }).catch((e) => console.log('  (skipped auth URL config: ' + e.message + ')'));

  // 8) write .env.local
  writeFileSync(new URL('../.env.local', import.meta.url),
    `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_ANON_KEY=${anon}\n`);
  console.log(`\n✅ Done. Wrote .env.local\n   URL : ${url}\n   Run : npm run dev  → Sign in (magic link) → you're an admin.`);
})().catch((e) => { console.error('\n✖ ' + e.message); process.exit(1); });
