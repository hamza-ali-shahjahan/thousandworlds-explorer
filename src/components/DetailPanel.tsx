import { useEffect, useState } from 'react';
import type { World } from '../types';
import { tempColor, band, sizeClass, describe, n, kToC, yearLength } from '../lib/util';
import Term from './Term';
import SurfaceMap, { type FieldMeta } from './SurfaceMap';
import { PcaGbtEmulator } from '../lib/emulator';
import { downloadPostcard } from '../lib/postcard';
import { track } from '../lib/track';
import { useAuth } from '../lib/auth';
import { oodAssess, type OodAssessment } from '../lib/ood';
import { loadSims, type SimCatalog } from '../lib/simcatalog';
import type { BuildParams } from '../lib/emuConstants';
import { GCM_LABELS } from '../lib/emuConstants';
import './DetailPanel.css';

// ---------------------------------------------------------------------------
// The "physically modeled portrait": when a real NASA planet's OBSERVED params
// land inside the benchmark's simulated envelope, run it through the PCA-GBT
// emulator under an ASSUMED 1-bar present-Earth-like atmosphere and show the
// predicted surface-temperature map — a GCM-emulated what-if, never a claim
// about the planet's actual (unknown) atmosphere. Out-of-envelope worlds get
// one quiet honest line instead; no portrait is ever faked. Below it, a
// "plausible climates" sweep: 16 assumed atmospheres (P0 × CO₂) classified
// into temperature regimes, OOD points dropped and counted.
// ---------------------------------------------------------------------------

const EARTH_FLUX = 1361;               // W/m² — insol is Earth-relative (matches BuildAWorld)
const G_EARTH = 9.81;                  // m/s² — g = G_EARTH · mass / radius² in Earth units
const PORTRAIT_P0_BAR = 1;             // the assumed atmosphere: 1 bar…
const PORTRAIT_CO2_PCT = 0.04;         // …at 400 ppm CO₂ (modern Earth)
const SWEEP_P0 = [0.3, 1, 3, 10];      // bar   — the plausible-climates grid
const SWEEP_CO2 = [0.01, 0.1, 1, 5];   // percent

// Regime bands for the sweep strip — same band edges as regime() and the scatter
// dots; these five hues are the ANCHORS of the continuous climate ramp
// (lib/climate.ts) that SurfaceMap/BuildAWorld draw maps with.
const REGIMES = [
  { label: 'frozen', color: '#6fa8ff' },     // < 240 K
  { label: 'cold', color: '#7fcfe6' },       // 240–273
  { label: 'temperate', color: '#46d49a' },  // 273–320
  { label: 'hot', color: '#f0b24a' },        // 320–373
  { label: 'scorching', color: '#e24b4a' },  // > 373
] as const;
const regimeIdx = (t: number) => (t < 240 ? 0 : t < 273 ? 1 : t < 320 ? 2 : t < 373 ? 3 : 4);

// --- shared lazy assets (module cache: loaded once, first time any panel needs them) ---
type Core = { cat: SimCatalog; ranges: Record<string, [number, number]>; field: FieldMeta };
let _core: Promise<Core> | null = null;
function loadCore(): Promise<Core> {
  return (_core ??= (async () => {
    const base = `${import.meta.env.BASE_URL ?? '/'}`;
    const [cat, meta] = await Promise.all([
      loadSims(),
      fetch(`${base}thousandworlds-meta.json`).then((r) => { if (!r.ok) throw new Error('meta'); return r.json(); }),
    ]);
    return { cat, ranges: meta.ranges as Record<string, [number, number]>, field: meta.field as FieldMeta };
  })().catch((e) => { _core = null; throw e; }));
}
let _emu: Promise<PcaGbtEmulator | null> | null = null;
const loadEmu = () => (_emu ??= PcaGbtEmulator.load());

// requestIdleCallback with a setTimeout fallback — the portrait/sweep never
// block the panel's first paint.
function idle(fn: () => void, timeout = 600): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(fn, { timeout });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 0);
  return () => clearTimeout(id);
}

// Observed params → emulator inputs under the assumed Earth-like atmosphere.
// Rotation: tidally-locked guess = orbital period (typical for the benchmark's
// close-in M-dwarf domain); when the period is unpublished the emulator's
// in-distribution default (12 d, dataset median) applies — labeled either way.
function portraitParams(w: World): { p: BuildParams | null; missing: string[] } {
  const missing: string[] = [];
  if (w.st_teff == null) missing.push('star temperature');
  if (w.insol == null) missing.push('starlight');
  if (w.radius == null || w.radius <= 0) missing.push('size');
  if (w.mass == null || w.mass <= 0) missing.push('mass');
  if (missing.length) return { p: null, missing };
  return {
    p: {
      st_teff: w.st_teff!,
      flux: w.insol! * EARTH_FLUX,
      radius: w.radius!,
      gravity: G_EARTH * (w.mass! / (w.radius! * w.radius!)),
      pressure: PORTRAIT_P0_BAR,
      co2: PORTRAIT_CO2_PCT,
      ch4: 0,
      rotation: w.period != null && w.period > 0 ? w.period : undefined,
    },
    missing,
  };
}

// Area-weighted (cos-latitude) global mean of a packed uint8 field, in Kelvin —
// the honest "global mean" for an equirectangular grid (poles carry tiny area).
function areaMeanK(field: Uint8Array, grid: [number, number], kRange: [number, number]): number {
  const [rows, cols] = grid;
  const [lo, hi] = kRange;
  let s = 0, wsum = 0;
  for (let r = 0; r < rows; r++) {
    const wgt = Math.cos(((r + 0.5) / rows - 0.5) * Math.PI);
    for (let c = 0; c < cols; c++) {
      const u = field[r * cols + c];
      if (u === 0) continue;
      s += (lo + ((u - 1) / 254) * (hi - lo)) * wgt;
      wsum += wgt;
    }
  }
  return wsum ? s / wsum : NaN;
}

interface SweepResult {
  counts: number[];               // per-regime counts (REGIMES order)
  total: number;                  // in-envelope points classified
  dropped: number;                // OOD 'out' points excluded
  skipped: number;                // outside the meta ranges (never assessed)
  span: [number, number] | null;  // per-GCM spread of the 1-bar Earth-like case, K
}

type PortraitState =
  | { kind: 'loading' }
  | { kind: 'nodata'; missing: string[] }
  | { kind: 'unavailable' }
  | { kind: 'out'; ood: OodAssessment }
  | { kind: 'ready'; ood: OodAssessment; field: Uint8Array; meanK: number; grid: [number, number]; kRange: [number, number] };

// Per-planet cache (params key) — reopening a profile is instant, no recompute.
const _cache = new Map<string, { portrait: PortraitState; sweep: SweepResult | null }>();
const CACHE_MAX = 80;
function cachePut(key: string, v: { portrait: PortraitState; sweep: SweepResult | null }) {
  if (!_cache.has(key) && _cache.size >= CACHE_MAX) _cache.delete(_cache.keys().next().value as string);
  _cache.set(key, v);
}

async function computeSweep(base: BuildParams, core: Core, emu: PcaGbtEmulator): Promise<SweepResult> {
  const counts = REGIMES.map(() => 0);
  let total = 0, dropped = 0, skipped = 0;
  const inR = (v: number, r?: [number, number]) => !r || (v >= r[0] && v <= r[1]);
  for (const pressure of SWEEP_P0) {
    for (const co2 of SWEEP_CO2) {
      if (!inR(pressure, core.ranges.pressure) || !inR(co2, core.ranges.co2)) { skipped++; continue; }
      const p: BuildParams = { ...base, pressure, co2 };
      if (oodAssess(p, core.cat.sims).state === 'out') { dropped++; continue; }
      const pred = await emu.predict(p, core.field, core.ranges);
      counts[regimeIdx(areaMeanK(pred.field, core.field.grid, pred.kRange))]++;
      total++;
    }
  }
  // Per-GCM spread on the 1-bar Earth-like case: the same world through all 5
  // simulator lenses — how much the underlying GCMs disagree about this planet.
  let lo = Infinity, hi = -Infinity;
  for (let g = 0; g < GCM_LABELS.length; g++) {
    const pred = await emu.predict(base, core.field, core.ranges, g);
    const m = areaMeanK(pred.field, core.field.grid, pred.kRange);
    if (m < lo) lo = m;
    if (m > hi) hi = m;
  }
  return { counts, total, dropped, skipped, span: Number.isFinite(lo) ? [lo, hi] : null };
}

function OodChip({ assess }: { assess: OodAssessment }) {
  const LABEL: Record<OodAssessment['state'], string> = {
    in: 'in the simulated range',
    edge: 'near the edge — treat with care',
    out: 'outside every simulation',
  };
  const title = `distance ${assess.distance.toFixed(2)} = mean distance to the 3 nearest simulated worlds (standardized input space) · ` +
    `in < ${assess.thresholds.edge.toFixed(2)} ≤ edge ≤ ${assess.thresholds.out.toFixed(2)} < out`;
  return (
    <span className={`dp-ood dp-ood-${assess.state}`} title={title}>
      <span className="dp-ood-dot" aria-hidden="true">●</span>{LABEL[assess.state]}
    </span>
  );
}

function ModeledPortrait({ world, onOpenLab }: { world: World; onOpenLab?: () => void }) {
  const { user } = useAuth(); // downloads are the one signed-in feature here
  const w = world;
  const key = [w.name, w.st_teff, w.insol, w.radius, w.mass, w.period].join('|');
  const [portrait, setPortrait] = useState<PortraitState>({ kind: 'loading' });
  const [sweep, setSweep] = useState<SweepResult | null>(null);

  useEffect(() => {
    let live = true;
    const { p, missing } = portraitParams(w);
    if (!p) { setPortrait({ kind: 'nodata', missing }); setSweep(null); return; }
    const hit = _cache.get(key);
    if (hit) { setPortrait(hit.portrait); setSweep(hit.sweep); if (hit.sweep || hit.portrait.kind !== 'ready') return; }
    else { setPortrait({ kind: 'loading' }); setSweep(null); }

    // compute after first paint, off the interaction path; keep computing even
    // if the panel closes mid-flight so the cache fills (only setState is gated)
    const cancel = idle(async () => {
      try {
        const core = await loadCore();
        const ood = oodAssess(p, core.cat.sims);
        if (ood.state === 'out') {
          const st: PortraitState = { kind: 'out', ood };
          cachePut(key, { portrait: st, sweep: null });
          if (live) setPortrait(st);
          return;
        }
        const emu = await loadEmu();
        if (!emu) { if (live) setPortrait({ kind: 'unavailable' }); return; }
        const pred = await emu.predict(p, core.field, core.ranges);
        const st: PortraitState = {
          kind: 'ready', ood, field: pred.field,
          meanK: areaMeanK(pred.field, core.field.grid, pred.kRange),
          grid: core.field.grid, kRange: pred.kRange,   // the prediction's own packing range
        };
        cachePut(key, { portrait: st, sweep: null });
        if (live) setPortrait(st);
        const sw = await computeSweep(p, core, emu);
        cachePut(key, { portrait: st, sweep: sw });
        if (live) setSweep(sw);
      } catch {
        if (live) setPortrait({ kind: 'unavailable' });
      }
    });
    return () => { live = false; cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (portrait.kind === 'unavailable') return null;   // engine can't load — say nothing rather than fake something

  const rotNote = w.period != null && w.period > 0
    ? `Rotation is set to its ${n(w.period)}-day orbit — a tidal-locking guess, typical for close-in worlds.`
    : 'Rotation is set to 12 days (the dataset median — this world’s rotation is unknown).';

  return (
    <div className="dp-portrait">
      <div className="section-label" style={{ marginBottom: 6 }}>If it had an Earth-like atmosphere…</div>

      {portrait.kind === 'loading' && <div className="dp-quiet">modeling this world&rsquo;s surface…</div>}

      {portrait.kind === 'nodata' && (
        <div className="dp-quiet">needs measured {portrait.missing.join(', ')} to place this world in the simulator&rsquo;s input space — no honest portrait possible.</div>
      )}

      {portrait.kind === 'out' && (
        <div className="dp-quiet" title={`OOD distance ${portrait.ood.distance.toFixed(2)} > out-threshold ${portrait.ood.thresholds.out.toFixed(2)} (farther from every simulation than virtually any training world)`}>
          outside the simulated envelope — no honest portrait possible.
        </div>
      )}

      {portrait.kind === 'ready' && (() => {
        const ri = regimeIdx(portrait.meanK);
        return (
          <>
            <SurfaceMap data={portrait.field} row={0} grid={portrait.grid} kRange={portrait.kRange} size="thumb" />
            <div className="dp-readout">
              <span className="dp-mean" style={{ color: REGIMES[ri].color }}>
                global mean ≈ {Math.round(portrait.meanK)} K ({kToC(portrait.meanK)}) · {REGIMES[ri].label}
              </span>
              <OodChip assess={portrait.ood} />
              <button
                className="dp-postcard"
                title={user ? 'Download this modeled world as a travel-poster postcard (PNG)' : 'Sign in to download postcards — free'}
                onClick={() => {
                  // Exploring is free; taking the image home asks for the (free) account.
                  if (!user) { track('postcard_locked', { name: w.name }); window.dispatchEvent(new Event('open-signin')); return; }
                  track('postcard', { name: w.name });
                  void downloadPostcard({
                    name: w.name, field: portrait.field, grid: portrait.grid, kRange: portrait.kRange,
                    meanK: portrait.meanK, dist_ly: w.dist_ly, radius: w.radius,
                    blurbLine: `a ${REGIMES[ri].label} world — under an assumed Earth-like atmosphere`,
                  });
                }}
              >postcard <span aria-hidden="true">↓</span></button>
            </div>
            <p className="dp-honest">
              <b>Physically modeled from GCM emulation — not an artist&rsquo;s concept, not an observation.</b>{' '}
              Assumes a 1-bar, present-Earth-like atmosphere and synchronized rotation. {rotNote}
            </p>

            {sweep && (sweep.total > 0 || sweep.dropped > 0) && (
              <>
                <div className="section-label" style={{ margin: '14px 0 4px' }}>What climates are plausible?</div>
                {sweep.total > 0 ? (
                  <>
                    <div className="dp-propbar" role="img" aria-label={`${sweep.total} assumed atmospheres: ${REGIMES.map((r, i) => sweep.counts[i] ? `${sweep.counts[i]} ${r.label}` : null).filter(Boolean).join(', ')}`}>
                      {REGIMES.map((r, i) => sweep.counts[i] > 0 && (
                        <i key={r.label} style={{ flex: sweep.counts[i], background: r.color }} title={`${sweep.counts[i]} ${r.label}`} />
                      ))}
                    </div>
                    <div className="dp-sweeptxt">
                      across {sweep.total} assumed atmospheres: {REGIMES.map((r, i) => sweep.counts[i] ? `${sweep.counts[i]} ${r.label}` : null).filter(Boolean).join(' · ')}
                    </div>
                  </>
                ) : (
                  <div className="dp-quiet">every swept atmosphere falls outside the simulated envelope here.</div>
                )}
                {sweep.dropped > 0 && (
                  <div className="dp-sweepnote">{sweep.dropped} atmosphere{sweep.dropped === 1 ? '' : 's'} outside the simulated envelope excluded.</div>
                )}
                {sweep.span && (
                  <div className="dp-sweepnote">On the 1-bar case, the five climate models span {Math.round(sweep.span[0])}–{Math.round(sweep.span[1])} K.</div>
                )}
                <div className="dp-sweepnote">Sweeping 0.3–10 bar × 0.01–5% CO₂ — atmospheres this world may not have. What-ifs, not measurements.</div>
                {onOpenLab && <button className="dp-lablink" onClick={onOpenLab}>explore this in the Lab <span aria-hidden="true">→</span></button>}
              </>
            )}
          </>
        );
      })()}
    </div>
  );
}

export default function DetailPanel({ world, onOpenLab }: { world: World | null; onOpenLab?: () => void }) {
  if (!world) {
    return (
      <section className="detail">
        <div className="empty">
          Click any world on the map to open its profile here —<br />size, temperature, distance, orbit, and how it compares to Earth.
        </div>
      </section>
    );
  }
  const w = world;
  const esiPct = w.esi != null ? Math.round(w.esi * 100) : null;
  return (
    <section className="detail">
      <div className="dhead">
        <span className="dot" style={{ background: tempColor(w.teq) }} />
        <h2>{w.name}</h2>
      </div>
      <div className="dtype">{[band(w.teq), sizeClass(w.radius)].filter(Boolean).join(' · ')}</div>
      <p className="ddesc">{describe(w)}</p>

      <div className="grid2">
        <div className="metric"><div className="k"><Term name="distance">Distance from Earth</Term></div><div className="v">{n(w.dist_ly)}<span className="u">ly</span></div></div>
        <div className="metric"><div className="k"><Term name="size">Size vs Earth</Term></div><div className="v">{n(w.radius)}<span className="u">× radius</span></div></div>
        <div className="metric"><div className="k"><Term name="temperature">Temperature</Term></div><div className="v">{kToC(w.teq)}</div></div>
        <div className="metric"><div className="k"><Term name="year">Length of a year</Term></div><div className="v">{yearLength(w.period)}</div></div>
      </div>

      {esiPct != null && (
        <>
          <div className="section-label" style={{ marginBottom: 4 }}><Term name="esi">Earth-likeness (rough)</Term></div>
          <div className="bar"><i style={{ width: `${esiPct}%` }} /></div>
          <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 5 }}>{esiPct}% — based on size and temperature only</div>
        </>
      )}

      <ModeledPortrait world={w} onOpenLab={onOpenLab} />

      <div className="rows">
        <div className="r"><span className="k"><Term name="mass">Mass</Term></span><span>{n(w.mass)} × Earth</span></div>
        <div className="r"><span className="k"><Term name="orbit">Orbit radius</Term></span><span>{n(w.smax)} AU</span></div>
        <div className="r"><span className="k"><Term name="eccentricity">Orbit shape</Term></span><span>{w.ecc != null ? `${n(w.ecc)} ${w.ecc < 0.1 ? '(near-circular)' : w.ecc < 0.4 ? '(elliptical)' : '(very stretched)'}` : '—'}</span></div>
        <div className="r"><span className="k">Host star</span><span>{w.host ?? '—'}{w.spectype ? ` (${w.spectype.trim()})` : ''}</span></div>
        <div className="r"><span className="k">Planets in system</span><span>{w.pnum ?? '—'}</span></div>
        <div className="r"><span className="k">Discovered</span><span>{w.year ?? '—'} · {w.method ?? '—'}</span></div>
        <div className="r"><span className="k">Found by</span><span style={{ textAlign: 'right', maxWidth: 180 }}>{w.facility ?? '—'}</span></div>
      </div>
    </section>
  );
}
