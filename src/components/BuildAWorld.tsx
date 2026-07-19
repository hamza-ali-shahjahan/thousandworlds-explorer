import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import SaveShareBar from './SaveShareBar';
import SurfaceMap, { type FieldMeta } from './SurfaceMap';
import ProjectedField from './ProjectedField';
import './BuildAWorld.css';
import type { TwWorld } from './ThousandWorlds';
import type { World } from '../types';
import { n } from '../lib/util';
import { climateCssRamp } from '../lib/climate';
import { useMapView } from '../lib/useMapView';
import { PcaGbtEmulator, type Prediction as EmuPrediction } from '../lib/emulator';

const EARTH_FLUX = 1361;
// d(surface temp)/d(star Teff), K per K — OLS over all 1,659 benchmark sims.
// Warmer star → cooler planet (the M-dwarf near-IR / ice-albedo effect the GCMs encode).
const TEFF_SLOPE = -0.01426;
// a little name generator so a built world feels owned the moment you open it
const NAME_A = ['Verda', 'Aurel', 'Nyx', 'Thala', 'Cinder', 'Pyra', 'Glaci', 'Vesper', 'Cael', 'Mira', 'Orin', 'Zephyr'];
const NAME_B = ['ia', 'on', 'is', 'os', 'una', 'ara', 'eth', 'or', 'yx', 'a'];
const randomName = () => NAME_A[Math.floor(Math.random() * NAME_A.length)] + NAME_B[Math.floor(Math.random() * NAME_B.length)];

// ---------------------------------------------------------------------------
// Phase 2 (interactive emulator demo) — STAND-IN engine.
// You build a hypothetical planet with sliders; we predict its full surface-
// temperature field with the trained PCA-GBT emulator (../lib/emulator.ts) —
// the ThousandWorlds baseline, exported to ONNX and run client-side in your
// browser. When the model can't load, predictField() below is the fallback: an
// honest nearest-neighbour surrogate that blends the closest real simulations'
// surface fields (inverse-distance weighted), tagged source:'knn' so the UI
// stays truthful about which engine produced the number.
// ---------------------------------------------------------------------------

function regime(t: number): string {
  if (t < 240) return 'Snowball';
  if (t < 273) return 'Cold';
  if (t < 320) return 'Temperate';
  if (t < 373) return 'Hot';
  return 'Scorching';
}
function regimeColor(t: number): string {
  if (t < 240) return '#6fa8ff';
  if (t < 273) return '#7fcfe6';
  if (t < 320) return '#46d49a';
  if (t < 373) return '#f0b24a';
  return '#e24b4a';
}
const kToC = (k: number) => `${Math.round(k - 273.15)} °C`;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const pct = (xs: number[], p: number) => { const a = xs.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))]; };

export interface BuildParams { flux: number; pressure: number; co2: number; st_teff: number; radius: number; gravity: number; }
// a built world the user can drop onto the Lab scatter beside the real planets (flux × pressure, coloured by predicted climate)
export interface BuiltWorld { name: string; flux: number; pressure: number; mean: number; reg: string; }
interface Prediction { field: Uint8Array; kRange: [number, number]; mean: number; lo: number; hi: number; reg: string; inEnv: boolean; outOf: string[]; n: number; d12: number; }

// kNN over the sims (same normalised-distance dims/weights as the Lab's translate),
// then blend the nearest worlds' surface fields cell-by-cell.
function predictField(p: BuildParams, sims: TwWorld[], surf: Uint8Array, field: FieldMeta, R: Record<string, [number, number]>): Prediction | null {
  const [rows, cols] = field.grid;
  const cells = rows * cols;
  const [lo, hi] = field.kRange;
  const dims = [
    { v: p.flux, get: (s: TwWorld) => s.flux, r: R.flux, w: 1.4 },
    { v: p.pressure, get: (s: TwWorld) => s.pressure ?? 1, r: R.pressure, w: 1.2 },
    { v: p.co2, get: (s: TwWorld) => s.co2, r: R.co2, w: 1.0 },
    { v: p.st_teff, get: (s: TwWorld) => s.st_teff, r: R.st_teff, w: 1.0 },
    { v: p.radius, get: (s: TwWorld) => s.radius ?? 1, r: R.radius, w: 0.7 },
    { v: p.gravity, get: (s: TwWorld) => s.gravity, r: R.gravity, w: 0.5 },
  ];
  const norm = (v: number, [a, b]: [number, number]) => (v - a) / (b - a || 1);
  const scored = sims.map((s, i) => {
    let d = 0;
    for (const dim of dims) { const dd = (norm(dim.v, dim.r) - norm(dim.get(s), dim.r)) * dim.w; d += dd * dd; }
    return { i, s, d };
  }).sort((a, b) => a.d - b.d);
  const k = Math.min(12, scored.length);
  if (k === 0) return null;
  const near = scored.slice(0, k);
  const wts = near.map((x) => 1 / (Math.sqrt(x.d) + 0.02));

  // blend the neighbours' surface fields, cell by cell, in kelvin
  const acc = new Float64Array(cells), wsum = new Float64Array(cells);
  near.forEach((x, n) => {
    const off = x.i * cells, wt = wts[n];
    for (let c = 0; c < cells; c++) {
      const u = surf[off + c];
      if (u === 0) continue;                              // skip a neighbour's missing cell
      acc[c] += (lo + ((u - 1) / 254) * (hi - lo)) * wt;
      wsum[c] += wt;
    }
  });
  // keep the blended field in KELVIN until the very end — the star-temperature
  // nudge below shifts it, and we pack once over the field's own [min, max]
  // (returned as kRange) so the map keeps full contrast even inside one regime
  const kel = new Float64Array(cells);
  for (let c = 0; c < cells; c++) kel[c] = wsum[c] === 0 ? NaN : acc[c] / wsum[c];

  const temps = near.map((x) => x.s.tsurf);
  const wsumAll = wts.reduce((a, b) => a + b, 0);
  const mean = near.reduce((acc2, x, n) => acc2 + x.s.tsurf * wts[n], 0) / wsumAll;

  // --- honest star-temperature residual ---------------------------------------
  // The kNN can only average existing sims, so dragging star temperature through the
  // benchmark's Teff "desert" (~3500-5500 K) barely moves the prediction. The sims DO
  // encode a real slope (TEFF_SLOPE, above). We re-inject ONLY that one slope, on the gap
  // between the built Teff and the neighbours' mean Teff, damped to ~0 at rest and faded
  // out once we leave the densely-simulated region. We do NOT add flux/pressure/CO₂ trend
  // terms (the kNN already moves those) and do NOT touch the distance weights — keeping the
  // nudge small, signed by real physics, and honest rather than a faked smooth curve.
  const d12 = Math.sqrt(near[near.length - 1].d);                      // ~0.12-0.21 in core, 0.5+ deep OOD
  const nbrTeff = near.reduce((a, x, idx) => a + x.s.st_teff * wts[idx], 0) / wsumAll;
  const conf = clamp(1 - (d12 - 0.30) / 0.30, 0, 1);                   // 1 in-core -> 0 by d12~0.60
  const corr = clamp(TEFF_SLOPE * (p.st_teff - nbrTeff) * conf, -30, 30);
  if (corr !== 0) for (let c = 0; c < cells; c++) kel[c] += corr;      // shift the field by the same offset so map = headline
  // ---------------------------------------------------------------------------

  // pack over the field's own range (kRange), not the dataset's fixed 90–400 K
  let mn = Infinity, mx = -Infinity;
  for (let c = 0; c < cells; c++) { const t = kel[c]; if (!Number.isNaN(t)) { if (t < mn) mn = t; if (t > mx) mx = t; } }
  if (mn === Infinity) return null;                                    // every cell missing — nothing to show
  const span = (mx - mn) || 1;
  const out = new Uint8Array(cells);
  for (let c = 0; c < cells; c++) out[c] = Number.isNaN(kel[c]) ? 0 : 1 + Math.round(((kel[c] - mn) / span) * 254);
  const meanC = clamp(mean + corr, mn, mx);                            // headline stays inside the field it describes

  const outOf: string[] = [];
  const chk = (label: string, v: number, [a, b]: [number, number]) => { if (v < a || v > b) outOf.push(label); };
  chk('starlight', p.flux, R.flux); chk('pressure', p.pressure, R.pressure); chk('CO₂', p.co2, R.co2);
  chk('star temperature', p.st_teff, R.st_teff); chk('planet size', p.radius, R.radius); chk('gravity', p.gravity, R.gravity);
  return { field: out, kRange: [mn, mx], mean: meanC, lo: pct(temps, 0.1), hi: pct(temps, 0.9), reg: regime(meanC), inEnv: outOf.length === 0, outOf, n: k, d12 };
}

// Recipes drawn from real ThousandWorlds simulations, so each lands in-distribution
// and predicts its named climate (the benchmark is dominated by cool-star worlds).
const PRESETS: { label: string; p: BuildParams }[] = [
  // a cool-star (M-dwarf) temperate world — the benchmark's dense region, where every slider
  // (CO₂ & pressure included) has real climate leverage, so the predicted twin tracks your drags
  { label: 'Temperate world', p: { flux: 1400, pressure: 3, co2: 8, st_teff: 3400, radius: 1, gravity: 9.81 } },
  { label: 'Snowball world', p: { flux: 740, pressure: 1, co2: 0, st_teff: 2600, radius: 1, gravity: 9.81 } },
  { label: 'Scorching world', p: { flux: 2400, pressure: 7, co2: 0.01, st_teff: 5777, radius: 1, gravity: 9.81 } },
];

export default function BuildAWorld({ sims, nasa, surf, field, ranges, onMeet, onAddToMap, onClose }: {
  sims: TwWorld[]; nasa: World[]; surf: Uint8Array; field: FieldMeta; ranges: Record<string, [number, number]>;
  onMeet: (w: World) => void; onAddToMap?: (b: BuiltWorld) => void; onClose: () => void;
}) {
  const [p, setP] = useState<BuildParams>(PRESETS[0].p);
  // Projection for the predicted map — the site-wide synced preference.
  const [mapView, pickMapView] = useMapView();
  const [name, setName] = useState<string>(randomName);
  const [copied, setCopied] = useState(false);
  const [shareCard, setShareCard] = useState<string | null>(null);
  // The real PCA-GBT emulator (client-side ONNX) loads once; until it's ready — or if it
  // fails to load — Build-a-World uses the instant kNN stand-in. Each result carries a
  // `source` so the UI stays honest about which engine produced the number.
  const [emu, setEmu] = useState<PcaGbtEmulator | null>(null);
  useEffect(() => { let live = true; PcaGbtEmulator.load().then((e) => { if (live) setEmu(e); }); return () => { live = false; }; }, []);
  const [pred, setPred] = useState<EmuPrediction | null>(null);
  useEffect(() => {
    let live = true;
    const knn = () => { const k = predictField(p, sims, surf, field, ranges); if (live) setPred(k ? { ...k, source: 'knn' as const } : null); };
    if (emu) emu.predict(p, field, ranges).then((r) => { if (live) setPred(r); }).catch(knn);
    else knn();
    return () => { live = false; };
  }, [emu, p, sims, surf, field, ranges]);

  // the payoff: the real discovered planet most like the world you built — matched on what you
  // can SEE (size, starlight, star colour) AND the CLIMATE you just built (predicted surface K
  // vs the planet's equilibrium temp). Folding the climate in is what lets the sliders you drag
  // most — pressure & CO₂, which move only the prediction — visibly change the twin; weights are
  // balanced so no single dimension dominates (the climate term gets the loudest voice).
  const cousin = useMemo(() => {
    const nf = (v: number, [a, b]: [number, number]) => (v - a) / ((b - a) || 1);
    const kR = ranges.tsurf ?? field.kRange;          // Kelvin range to normalise the climate term
    let best: World | null = null, bd = Infinity;
    for (const w of nasa) {
      if (w.insol == null || w.radius == null || w.st_teff == null) continue;
      if (pred && w.teq == null) continue;            // can't fairly place a world we can't climate-match — skip it (only a handful lack teq) rather than letting it dodge the penalty and win
      const dr = (nf(p.radius, ranges.radius) - nf(w.radius, ranges.radius)) * 1.0;
      const df = (nf(p.flux, ranges.flux) - nf(w.insol * EARTH_FLUX, ranges.flux)) * 0.9;
      const ds = (nf(p.st_teff, ranges.st_teff) - nf(w.st_teff, ranges.st_teff)) * 0.7;
      let d = dr * dr + df * df + ds * ds;
      if (pred) {                                     // the climate term — the strongest voice (carries pressure & CO₂, which feed only the prediction)
        const dc = (nf(pred.mean, kR) - nf(w.teq!, kR)) * 2.3;
        d += dc * dc;
      }
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  }, [p, pred, nasa, ranges, field]);
  const set = (k: keyof BuildParams) => (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [k]: Number(e.target.value) });

  const sliders: { k: keyof BuildParams; label: string; r: [number, number]; step: number; fmt: (v: number) => string; dense: [number, number] }[] = [
    { k: 'flux', label: 'Starlight (stellar flux)', r: ranges.flux, step: 10, fmt: (v) => `${Math.round(v)} W/m²`, dense: [500, 2400] },
    { k: 'st_teff', label: 'Star temperature', r: ranges.st_teff, step: 10, fmt: (v) => `${Math.round(v)} K`, dense: [2500, 3300] },
    { k: 'pressure', label: 'Surface pressure', r: ranges.pressure, step: 0.1, fmt: (v) => `${v.toFixed(1)} bar`, dense: [0.1, 8] },
    { k: 'co2', label: 'CO₂', r: ranges.co2, step: 0.5, fmt: (v) => `${v.toFixed(1)} %`, dense: [0, 1] },
    { k: 'radius', label: 'Planet size', r: ranges.radius, step: 0.01, fmt: (v) => `${v.toFixed(2)}× Earth`, dense: [0.8, 1.2] },
    { k: 'gravity', label: 'Gravity', r: ranges.gravity, step: 0.1, fmt: (v) => `${v.toFixed(1)} m/s²`, dense: [8, 12] },
  ];
  const col = pred ? regimeColor(pred.mean) : '#46d49a';

  const copyWorld = () => {
    if (!pred) return;
    const txt = `"${name}" — a world I built · ThousandWorlds Explorer (Imagine Lab)

The recipe:
  Starlight: ${Math.round(p.flux)} W/m²
  Star temperature: ${Math.round(p.st_teff)} K
  Surface pressure: ${p.pressure.toFixed(1)} bar
  CO₂: ${p.co2.toFixed(1)} %
  Planet size: ${p.radius.toFixed(2)}× Earth
  Gravity: ${p.gravity.toFixed(1)} m/s²

Predicted surface: ${Math.round(pred.mean)} K (${kToC(pred.mean)}) — ${pred.reg}${pred.inEnv ? '' : ' [OUTSIDE the simulated grid — extrapolation]'}
${pred.source === 'pca-gbt'
      ? `Most of the surface sits between ${Math.round(pred.lo)}–${Math.round(pred.hi)} K (10th–90th percentile)`
      : `Nearest simulations span ${Math.round(pred.lo)}–${Math.round(pred.hi)} K`}${pred.inEnv ? '' : ' — extrapolating beyond the simulated grid'}${cousin ? `.\nClosest real world: ${cousin.name} (${n(cousin.radius)}× Earth, ${n(cousin.dist_ly)} ly away)` : ''}.

${pred.source === 'pca-gbt'
      ? 'The PCA-GBT emulator (PCA + gradient-boosted trees) — the ThousandWorlds baseline (Stevenson et al. 2026, CC-BY-4.0) — running in your browser.'
      : 'A fast nearest-analog estimator over the ThousandWorlds benchmark (Stevenson et al. 2026, CC-BY-4.0), with a small physically-signed star-temperature nudge — not the trained emulator.'} A simulated analogy, not an observation or a habitability claim.`;
    setShareCard(txt);
    navigator.clipboard?.writeText(txt).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => {});
  };

  return (
    <Modal title="Build a world — predict its climate" onClose={onClose} wide labelledBy="build-title">
      <div className="bw">
        <p className="bw-lede">Invent a planet — set its star and atmosphere with the sliders, and watch the climate these models predict it would have. A <b>what-if</b>: nothing here is a real planet.</p>
        <div className="bw-name">
          <label htmlFor="bw-name-input">Your world</label>
          <input id="bw-name-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="Name it…" />
          <button className="bw-dice" onClick={() => setName(randomName())} title="Random name" aria-label="Random name">🎲</button>
        </div>
        <div className="bw-controls">
          <div className="bw-presets">
            <span className="bw-presetlabel">Start from</span>
            {PRESETS.map((pr) => <button key={pr.label} className="chip sm" onClick={() => setP(pr.p)}>{pr.label}</button>)}
          </div>
          {sliders.map((s) => {
            const v = clamp(p[s.k], s.r[0], s.r[1]);
            const sparse = v < s.dense[0] || v > s.dense[1];
            return (
              <label className="bw-slider" key={s.k}>
                <span className="bw-sl-label">{s.label}{sparse && <span className="bw-sl-sparse" title="The benchmark simulates few worlds here — the estimate is rougher and flattens."> · sparsely simulated</span>}</span>
                <input type="range" min={s.r[0]} max={s.r[1]} step={s.step} value={v} onChange={set(s.k)} />
                <b className="bw-sl-val">{s.fmt(p[s.k])}</b>
              </label>
            );
          })}
        </div>

        <div className="bw-result">
          {pred ? (
            <>
              <div className="lenstoggle bw-viewtoggle" role="tablist" aria-label="Projection">
                {(['flat', 'robinson', 'globe'] as const).map((v) => (
                  <button key={v} role="tab" aria-selected={mapView === v} className={mapView === v ? 'on' : ''} onClick={() => pickMapView(v)}>
                    {v === 'flat' ? 'Flat' : v === 'robinson' ? 'Robinson' : 'Globe'}
                  </button>
                ))}
              </div>
              {mapView !== 'flat' ? (
                <ProjectedField data={pred.field} row={0} grid={field.grid} kRange={pred.kRange} view={mapView} size="hero" />
              ) : (
                <SurfaceMap data={pred.field} row={0} grid={field.grid} kRange={pred.kRange} size="hero" />
              )}
              {mapView === 'globe' && (
                <div className="projfield-caption">drag to spin · ● substellar / ○ antistellar · dashed = terminator</div>
              )}
              <div className="bw-colorbar" title="The map's color scale — this world's coldest to hottest surface cell">
                <span>{Math.round(pred.kRange[0])} K</span>
                <span className="bw-ramp" style={{ background: climateCssRamp(pred.kRange[0], pred.kRange[1]) }} />
                <span>{Math.round(pred.kRange[1])} K</span>
              </div>
              <div className="bw-readout">
                <span className="bw-badge" style={{ color: col, borderColor: col }}>{pred.reg}</span>
                <span className="bw-temp">Predicted surface ≈ <b style={{ color: col }}>{Math.round(pred.mean)} K ({kToC(pred.mean)})</b></span>
                <span
                  className={`bw-source ${pred.source === 'pca-gbt' ? 'is-model' : 'is-knn'}`}
                  title={pred.source === 'pca-gbt'
                    ? 'The trained PCA-GBT emulator (PCA + gradient-boosted trees), running in your browser — the official ThousandWorlds baseline'
                    : 'A fast nearest-neighbour stand-in over the benchmark — the trained emulator is still loading or unavailable'}>
                  {pred.source === 'pca-gbt' ? '⚛ PCA-GBT emulator' : '≈ nearest-neighbour estimate'}
                </span>
                {(() => {
                  const span = `${Math.round(pred.lo)}–${Math.round(pred.hi)} K`;
                  let txt: string;
                  if (pred.source === 'pca-gbt')
                    txt = pred.inEnv
                      ? `Most of the surface sits between ${span}`
                      : `Most of the surface sits between ${span} — extrapolating beyond the simulated grid`;
                  else
                    txt = pred.d12 <= 0.30 && pred.inEnv
                      ? `Quick estimate · nearest simulations span ${span}`
                      : `Rough estimate · few comparable simulations here (${span}) — past the densely-simulated region, so the value flattens and is less certain`;
                  return (
                    <span className="bw-band" title="The middle 80% of the predicted map (10th–90th percentile); the colorbar above shows its full coldest→hottest range">{txt}</span>
                  );
                })()}
              </div>
              {!pred.inEnv && <div className="bw-warn">⚠ Outside the simulated grid ({pred.outOf.join(', ')}) — this is extrapolation, treat the prediction as a rough guess.</div>}
              {onAddToMap && (
                <button className="bw-addmap" onClick={() => onAddToMap({ name: name.trim() || 'Your world', flux: p.flux, pressure: p.pressure, mean: pred.mean, reg: pred.reg })} title="Drop this world onto the Lab map, beside the real discovered planets">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                  Pin {name.trim() || 'your world'} to the map <span className="bw-addmap-arrow" aria-hidden="true">→</span>
                </button>
              )}
              {cousin && (
                <div className="bw-cousin">
                  <span className="bw-cousin-eyebrow">🌍 The real world most like {name || 'your world'}</span>
                  <span className="bw-cousin-name">{cousin.name}</span>
                  <span className="bw-cousin-sum">{n(cousin.radius)}× Earth-size{cousin.dist_ly != null ? ` · ${n(cousin.dist_ly)} ly away` : ''}{cousin.insol != null ? ` · ${n(cousin.insol)}× our sunlight` : ''}</span>
                  <span className="bw-cousin-matched">matched by size, starlight &amp; predicted climate — a simulated analogy, not a habitability claim</span>
                  <button className="bw-cousin-cta" onClick={() => onMeet(cousin)} title={`Explore ${cousin.name} on the map`}>
                    Go meet {cousin.name} <span className="bw-cousin-arrow" aria-hidden="true">→</span>
                  </button>
                </div>
              )}
              <div className="bw-actions">
                <button className="btn bw-copy" onClick={copyWorld} title="Copy a shareable summary of this world">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{copied ? <path d="M20 6L9 17l-5-5" /> : <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>}</svg>
                  {copied ? 'Copied ✓' : shareCard ? 'Copy again' : 'Copy this world'}
                </button>
                <SaveShareBar
                  type="world"
                  title={name.trim() || 'Your world'}
                  buildPayload={() => ({
                    name: name.trim() || 'Your world',
                    params: p,
                    prediction: { mean: pred.mean, lo: pred.lo, hi: pred.hi, reg: pred.reg, inEnv: pred.inEnv, outOf: pred.outOf, n: pred.n },
                    cousin: cousin?.name ?? null,
                  })}
                />
              </div>
              {shareCard && (
                <div className="bw-sharecard">
                  <div className="bw-shareok">{copied ? '✓ Copied to your clipboard!' : 'Paste it (⌘V / Ctrl+V) anywhere — a note, a message — to share.'}</div>
                  <pre>{shareCard}</pre>
                </div>
              )}
            </>
          ) : <div className="bw-empty">Move a slider to predict a climate.</div>}
          {pred?.source === 'pca-gbt' ? (
            <p className="bw-honest">
              <b>How this works — the PCA-GBT emulator, running in your browser.</b> This is the trained ThousandWorlds baseline (PCA compression + per-mode gradient-boosted trees, fit on 1,659 GCM runs), exported to ONNX and run locally — the same model and weights benchmarked in the paper. It compresses your planet’s parameters into a compact set of latent climate patterns, predicts them with the boosted trees, and decodes back to a 32×64 surface-temperature map in under a millisecond. A warmer star tends to <i>cool</i> the planet here (the M-dwarf near-infrared / ice-albedo effect) — that emerges from the model itself, not a hand-tuned rule. A simulated analogy, not an observation, a prediction of a real planet, or a habitability claim. The benchmark is dominated by cool-star, low-CO₂, Earth-sized worlds, so the emulator is most reliable there; beyond the simulated grid it extrapolates, flagged above.
            </p>
          ) : (
            <p className="bw-honest">
              <b>How this works — a fast nearest-analog stand-in.</b> The trained PCA-GBT emulator isn’t loaded here, so we fall back to finding the real ThousandWorlds simulations closest to the planet you built and blending their surface-temperature fields. Because the benchmark simulates very few stars between M-dwarf and Sun-like, we add a small physically-signed nudge for star temperature (in these GCMs a warmer star tends to <i>cool</i> the planet — the M-dwarf near-infrared / ice-albedo effect), damped to nothing once you leave the simulated region. An honest interpolation over 1,659 GCM runs — a simulated analogy, not an observation, a prediction of a real planet, or a habitability claim. The benchmark is dominated by cool-star, low-CO₂, Earth-sized worlds, so estimates are firmest there and get rougher — and deliberately flatten — toward Sun-like stars, thick CO₂, or extreme size/gravity.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
