import { useMemo, useState } from 'react';
import Modal from './Modal';
import SurfaceMap, { type FieldMeta } from './SurfaceMap';
import './BuildAWorld.css';
import type { TwWorld } from './ThousandWorlds';
import type { World } from '../types';
import { n } from '../lib/util';

const EARTH_FLUX = 1361;
// a little name generator so a built world feels owned the moment you open it
const NAME_A = ['Verda', 'Aurel', 'Nyx', 'Thala', 'Cinder', 'Pyra', 'Glaci', 'Vesper', 'Cael', 'Mira', 'Orin', 'Zephyr'];
const NAME_B = ['ia', 'on', 'is', 'os', 'una', 'ara', 'eth', 'or', 'yx', 'a'];
const randomName = () => NAME_A[Math.floor(Math.random() * NAME_A.length)] + NAME_B[Math.floor(Math.random() * NAME_B.length)];

// ---------------------------------------------------------------------------
// Phase 2 (interactive emulator demo) — STAND-IN engine.
// You build a hypothetical planet with sliders; we predict its full surface-
// temperature field by finding the nearest real ThousandWorlds simulations and
// blending THEIR surface fields (inverse-distance weighted). It's an honest
// nearest-neighbour surrogate — not the GPLFR emulator yet — and it's wired so
// Ed's real emulator can drop in behind the same interface later.
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
interface Prediction { field: Uint8Array; mean: number; lo: number; hi: number; reg: string; inEnv: boolean; outOf: string[]; n: number; }

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
  const out = new Uint8Array(cells);
  for (let c = 0; c < cells; c++) {
    if (wsum[c] === 0) { out[c] = 0; continue; }
    const t = acc[c] / wsum[c];
    out[c] = 1 + Math.round(clamp((clamp(t, lo, hi) - lo) / (hi - lo) * 254, 0, 254));
  }

  const temps = near.map((x) => x.s.tsurf);
  const wsumAll = wts.reduce((a, b) => a + b, 0);
  const mean = near.reduce((acc2, x, n) => acc2 + x.s.tsurf * wts[n], 0) / wsumAll;
  const outOf: string[] = [];
  const chk = (label: string, v: number, [a, b]: [number, number]) => { if (v < a || v > b) outOf.push(label); };
  chk('starlight', p.flux, R.flux); chk('pressure', p.pressure, R.pressure); chk('CO₂', p.co2, R.co2);
  chk('star temperature', p.st_teff, R.st_teff); chk('planet size', p.radius, R.radius); chk('gravity', p.gravity, R.gravity);
  return { field: out, mean, lo: pct(temps, 0.1), hi: pct(temps, 0.9), reg: regime(mean), inEnv: outOf.length === 0, outOf, n: k };
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
  const [name, setName] = useState<string>(randomName);
  const [copied, setCopied] = useState(false);
  const [shareCard, setShareCard] = useState<string | null>(null);
  const pred = useMemo(() => predictField(p, sims, surf, field, ranges), [p, sims, surf, field, ranges]);

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

  const sliders: { k: keyof BuildParams; label: string; r: [number, number]; step: number; fmt: (v: number) => string }[] = [
    { k: 'flux', label: 'Starlight (stellar flux)', r: ranges.flux, step: 10, fmt: (v) => `${Math.round(v)} W/m²` },
    { k: 'st_teff', label: 'Star temperature', r: ranges.st_teff, step: 10, fmt: (v) => `${Math.round(v)} K` },
    { k: 'pressure', label: 'Surface pressure', r: ranges.pressure, step: 0.1, fmt: (v) => `${v.toFixed(1)} bar` },
    { k: 'co2', label: 'CO₂', r: ranges.co2, step: 0.5, fmt: (v) => `${v.toFixed(1)} %` },
    { k: 'radius', label: 'Planet size', r: ranges.radius, step: 0.01, fmt: (v) => `${v.toFixed(2)}× Earth` },
    { k: 'gravity', label: 'Gravity', r: ranges.gravity, step: 0.1, fmt: (v) => `${v.toFixed(1)} m/s²` },
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
${pred.n} nearest simulations span ${Math.round(pred.lo)}–${Math.round(pred.hi)} K${cousin ? `.\nClosest real world: ${cousin.name} (${n(cousin.radius)}× Earth, ${n(cousin.dist_ly)} ly away)` : ''}.

A nearest-neighbour stand-in over the ThousandWorlds benchmark (Stevenson et al., CC-BY-4.0) — a simulated analogy, not an observation or a habitability claim.`;
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
          {sliders.map((s) => (
            <label className="bw-slider" key={s.k}>
              <span className="bw-sl-label">{s.label}</span>
              <input type="range" min={s.r[0]} max={s.r[1]} step={s.step} value={clamp(p[s.k], s.r[0], s.r[1])} onChange={set(s.k)} />
              <b className="bw-sl-val">{s.fmt(p[s.k])}</b>
            </label>
          ))}
        </div>

        <div className="bw-result">
          {pred ? (
            <>
              <SurfaceMap data={pred.field} row={0} grid={field.grid} kRange={field.kRange} size="hero" />
              <div className="bw-readout">
                <span className="bw-badge" style={{ color: col, borderColor: col }}>{pred.reg}</span>
                <span className="bw-temp">Predicted surface ≈ <b style={{ color: col }}>{Math.round(pred.mean)} K ({kToC(pred.mean)})</b></span>
                <span className="bw-band">{pred.n} nearest simulations span {Math.round(pred.lo)}–{Math.round(pred.hi)} K</span>
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
              <button className="btn bw-copy" onClick={copyWorld} title="Copy a shareable summary of this world">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{copied ? <path d="M20 6L9 17l-5-5" /> : <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>}</svg>
                {copied ? 'Copied ✓' : shareCard ? 'Copy again' : 'Copy this world'}
              </button>
              {shareCard && (
                <div className="bw-sharecard">
                  <div className="bw-shareok">{copied ? '✓ Copied to your clipboard!' : 'Paste it (⌘V / Ctrl+V) anywhere — a note, a message — to share.'}</div>
                  <pre>{shareCard}</pre>
                </div>
              )}
            </>
          ) : <div className="bw-empty">Move a slider to predict a climate.</div>}
          <p className="bw-honest">
            A fast <b>stand-in</b>: this blends the surface fields of the nearest real ThousandWorlds simulations — <i>not</i> the GPLFR emulator (yet). It’s wired so the real emulator drops straight in. A simulated analogy, not an observation or a habitability claim.
          </p>
        </div>
      </div>
    </Modal>
  );
}
