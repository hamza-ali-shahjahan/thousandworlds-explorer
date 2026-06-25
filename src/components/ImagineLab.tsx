import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import Term from './Term';
import type { World } from '../types';
import type { TwWorld } from './ThousandWorlds';
import { n, dotRadius } from '../lib/util';

// ---- shared climate color/regime (matches the Simulated tab) ----
function tColor(t: number): string {
  if (t < 240) return '#6fa8ff';
  if (t < 273) return '#7fcfe6';
  if (t < 320) return '#46d49a';
  if (t < 373) return '#f0b24a';
  return '#e24b4a';
}
function regime(t: number): string {
  if (t < 240) return 'Snowball';
  if (t < 273) return 'Cold';
  if (t < 320) return 'Temperate';
  if (t < 373) return 'Hot';
  return 'Runaway';
}
const kToC = (k: number) => `${Math.round(k - 273.15)} °C`;
const EARTH_FLUX = 1361;

interface TwMeta { count: number; gcms: [string, number][]; ranges: Record<string, [number, number]>; license: string; paper: string; code: string; }

// ---------- a tiny safe expression compiler (no eval) ----------
// Supports + - * / % ^, parentheses, unary minus, functions (abs sqrt cbrt exp
// log log10 min max pow) and named variables resolved from a context object.
type Fn = (ctx: Record<string, number>) => number;
const FUNCS: Record<string, (...a: number[]) => number> = {
  abs: Math.abs, sqrt: Math.sqrt, cbrt: Math.cbrt, exp: Math.exp,
  log: Math.log, log10: Math.log10, min: Math.min, max: Math.max, pow: Math.pow,
};
function compile(src: string): Fn {
  let i = 0; const s = src;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const expr = (): Fn => {
    let a = term(); ws();
    while (s[i] === '+' || s[i] === '-') { const op = s[i++]; const b = term(); const l = a; a = op === '+' ? (c) => l(c) + b(c) : (c) => l(c) - b(c); ws(); }
    return a;
  };
  const term = (): Fn => {
    let a = pow(); ws();
    while (s[i] === '*' || s[i] === '/' || s[i] === '%') { const op = s[i++]; const b = pow(); const l = a; a = op === '*' ? (c) => l(c) * b(c) : op === '/' ? (c) => l(c) / b(c) : (c) => l(c) % b(c); ws(); }
    return a;
  };
  const pow = (): Fn => { const a = unary(); ws(); if (s[i] === '^') { i++; const b = pow(); return (c) => Math.pow(a(c), b(c)); } return a; };
  const unary = (): Fn => { ws(); if (s[i] === '-') { i++; const a = unary(); return (c) => -a(c); } if (s[i] === '+') { i++; return unary(); } return primary(); };
  const primary = (): Fn => {
    ws();
    if (s[i] === '(') { i++; const a = expr(); ws(); if (s[i] !== ')') throw new Error('expected )'); i++; return a; }
    if (/[0-9.]/.test(s[i])) { let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++; const v = Number(s.slice(i, j)); if (!isFinite(v)) throw new Error('bad number'); i = j; return () => v; }
    if (/[a-zA-Z_]/.test(s[i])) {
      let j = i; while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j++; const name = s.slice(i, j); i = j; ws();
      if (s[i] === '(') {
        i++; const args: Fn[] = []; ws();
        if (s[i] !== ')') { args.push(expr()); ws(); while (s[i] === ',') { i++; args.push(expr()); ws(); } }
        if (s[i] !== ')') throw new Error('expected )'); i++;
        const fn = FUNCS[name]; if (!fn) throw new Error(`unknown function ${name}`);
        return (c) => fn(...args.map((a) => a(c)));
      }
      if (name === 'pi') return () => Math.PI;
      return (c) => c[name];
    }
    throw new Error('unexpected character');
  };
  const root = expr(); ws();
  if (i < s.length) throw new Error('unexpected trailing input');
  return root;
}
// Variables a real planet exposes to the equation builder.
function planetCtx(w: World): Record<string, number> {
  return {
    R: w.radius ?? NaN, mass: w.mass ?? NaN, density: w.density ?? NaN,
    insol: w.insol ?? NaN, flux: w.insol != null ? w.insol * EARTH_FLUX : NaN,
    teq: w.teq ?? NaN, stT: w.st_teff ?? NaN, period: w.period ?? NaN,
    dist: w.dist_ly ?? NaN, esi: w.esi ?? NaN, ecc: w.ecc ?? NaN, smax: w.smax ?? NaN,
  };
}
const EQ_VARS = 'R · mass · density · insol · flux · teq · stT · period · dist · esi · ecc · smax';
const EQ_EXAMPLES: [string, string][] = [
  ['esi', 'NASA’s Earth-likeness'],
  ['1 / (abs(teq - 288) + 1)', 'closest to Earth’s temperature'],
  ['esi / sqrt(dist)', 'Earth-like AND nearby'],
];

// ---------- the translator: nearest simulated analogs ----------
interface Atmosphere { pressure: number; co2: number; }
interface Estimate { n: number; median: number; lo: number; hi: number; reg: string; inEnv: boolean; outOf: string[]; analog: Set<number>; flux: number; }
const planetFlux = (w: World) => (w.insol != null ? w.insol * EARTH_FLUX : null);
const planetGravity = (w: World) => (w.mass != null && w.radius != null && w.radius > 0 ? 9.80665 * w.mass / (w.radius * w.radius) : null);
const pct = (xs: number[], p: number) => { const a = xs.slice().sort((x, y) => x - y); const idx = Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1)))); return a[idx]; };

function translate(w: World, atm: Atmosphere, sims: TwWorld[], R: Record<string, [number, number]>): Estimate | null {
  const flux = planetFlux(w);
  if (flux == null || w.radius == null || w.st_teff == null) return null;
  const grav = planetGravity(w);
  const dims: { v: number; get: (s: TwWorld) => number; lo: number; hi: number; w: number }[] = [
    { v: flux, get: (s) => s.flux, lo: R.flux[0], hi: R.flux[1], w: 1.4 },
    { v: atm.pressure, get: (s) => s.pressure ?? 1, lo: R.pressure[0], hi: R.pressure[1], w: 1.2 },
    { v: atm.co2, get: (s) => s.co2, lo: R.co2[0], hi: R.co2[1], w: 1.0 },
    { v: w.st_teff, get: (s) => s.st_teff, lo: R.st_teff[0], hi: R.st_teff[1], w: 1.0 },
    { v: w.radius, get: (s) => s.radius ?? 1, lo: R.radius[0], hi: R.radius[1], w: 0.7 },
    ...(grav != null ? [{ v: grav, get: (s: TwWorld) => s.gravity, lo: R.gravity[0], hi: R.gravity[1], w: 0.5 }] : []),
  ];
  const norm = (v: number, lo: number, hi: number) => (v - lo) / (hi - lo);
  const scored = sims.filter((s) => s.pressure != null).map((s) => {
    let d = 0; for (const dim of dims) { const dd = (norm(dim.v, dim.lo, dim.hi) - norm(dim.get(s), dim.lo, dim.hi)) * dim.w; d += dd * dd; }
    return { s, d };
  }).sort((a, b) => a.d - b.d);
  const k = Math.min(12, scored.length);
  const near = scored.slice(0, k);
  const temps = near.map((x) => x.s.tsurf);
  const median = pct(temps, 0.5);
  const outOf: string[] = [];
  const chk = (label: string, v: number, lo: number, hi: number) => { if (v < lo || v > hi) outOf.push(label); };
  chk('starlight', flux, R.flux[0], R.flux[1]);
  chk('planet size', w.radius, R.radius[0], R.radius[1]);
  chk('star temperature', w.st_teff, R.st_teff[0], R.st_teff[1]);
  return { n: k, median, lo: pct(temps, 0.1), hi: pct(temps, 0.9), reg: regime(median), inEnv: outOf.length === 0, outOf, analog: new Set(near.map((x) => x.s.sid)), flux };
}

// ---------- the climate phase-diagram (flux x · pressure y) ----------
const FX = { min: 400, max: 3100 };
const PY = { min: 0.1, max: 12 };
const M = { l: 56, r: 16, t: 30, b: 38 };
const FONT = '11px ui-sans-serif, system-ui, -apple-system, sans-serif';
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const L10 = Math.log10;

function LabField({ sims, planet, atm, est }: { sims: TwWorld[]; planet: World | null; atm: Atmosphere; est: Estimate | null }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });

  const xp = (flux: number) => { const { w } = sizeRef.current; return M.l + (clamp(flux, FX.min, FX.max) - FX.min) / (FX.max - FX.min) * (w - M.l - M.r); };
  const yp = (p: number) => { const { h } = sizeRef.current; return M.t + (1 - (L10(clamp(p, PY.min, PY.max)) - L10(PY.min)) / (L10(PY.max) - L10(PY.min))) * (h - M.t - M.b); };

  function draw() {
    const cv = cvRef.current; const { w, h, dpr } = sizeRef.current; if (!cv || w === 0) return;
    const c = cv.getContext('2d')!; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    c.fillStyle = '#080b16'; c.fillRect(0, 0, w, h);
    const px0 = M.l, px1 = w - M.r, pTop = M.t, pBot = h - M.b;

    const grad = c.createLinearGradient(px0, 0, px1, 0);
    grad.addColorStop(0.0, 'rgba(111,168,255,0.11)'); grad.addColorStop(0.27, 'rgba(70,212,154,0.085)');
    grad.addColorStop(0.42, 'rgba(70,212,154,0.05)'); grad.addColorStop(1.0, 'rgba(226,75,74,0.12)');
    c.fillStyle = grad; c.fillRect(px0, pTop, px1 - px0, pBot - pTop);
    c.font = FONT; c.textBaseline = 'top';
    c.fillStyle = 'rgba(122,162,247,0.7)'; c.textAlign = 'left'; c.fillText('mostly frozen', px0 + 2, 9);
    c.fillStyle = 'rgba(70,212,154,0.75)'; c.textAlign = 'center'; c.fillText('temperate band', xp(1250), 9);
    c.fillStyle = 'rgba(226,75,74,0.7)'; c.textAlign = 'right'; c.fillText('mostly scorching', px1 - 2, 9);

    c.strokeStyle = '#121830'; c.lineWidth = 1; c.fillStyle = '#69728f'; c.textAlign = 'center'; c.textBaseline = 'top';
    for (const fx of [500, 1000, 1500, 2000, 2500, 3000]) { const x = xp(fx); c.beginPath(); c.moveTo(x, pTop); c.lineTo(x, pBot); c.stroke(); c.fillText(`${fx}`, x, pBot + 7); }
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (const p of [0.1, 0.3, 1, 3, 10]) { const y = yp(p); c.beginPath(); c.moveTo(M.l, y); c.lineTo(px1, y); c.stroke(); c.fillText(`${p}`, M.l - 7, y); }
    c.fillStyle = '#828bab'; c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillText('stellar flux reaching the planet  (W/m²)  →', (M.l + px1) / 2, h - 2);
    c.save(); c.translate(13, (pTop + pBot) / 2); c.rotate(-Math.PI / 2); c.textBaseline = 'top'; c.fillText('surface pressure (bar)  ·  assumed for the real planet', 0, 0); c.restore();

    const analog = est?.analog;
    for (const s of sims) {
      if (s.pressure == null) continue;
      const isA = analog?.has(s.sid);
      c.fillStyle = tColor(s.tsurf);
      c.globalAlpha = analog && analog.size ? (isA ? 0.95 : 0.1) : 0.5;
      c.beginPath(); c.arc(xp(s.flux), yp(s.pressure), dotRadius(s.radius), 0, 6.2832); c.fill();
      if (isA) { c.globalAlpha = 0.9; c.strokeStyle = '#cdd6f4'; c.lineWidth = 1; c.beginPath(); c.arc(xp(s.flux), yp(s.pressure), dotRadius(s.radius) + 2, 0, 6.2832); c.stroke(); }
    }
    c.globalAlpha = 1;

    const ex = xp(EARTH_FLUX), ey = yp(1);
    c.fillStyle = '#cfd8ff'; c.beginPath(); c.arc(ex, ey, 4.5, 0, 6.2832); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.arc(ex, ey, 4.5, 0, 6.2832); c.stroke();
    c.fillStyle = '#cfd8ff'; c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText('Earth', ex, ey - 7);

    if (planet && est) {
      const x = xp(est.flux), y = yp(atm.pressure);
      c.fillStyle = tColor(est.median); c.globalAlpha = 0.95; c.beginPath(); c.arc(x, y, 7.5, 0, 6.2832); c.fill(); c.globalAlpha = 1;
      c.strokeStyle = '#fff'; c.lineWidth = 2.5; c.beginPath(); c.arc(x, y, 10.5, 0, 6.2832); c.stroke();
      c.fillStyle = '#fff'; c.font = '12px ui-sans-serif, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'bottom';
      c.fillText(planet.name, x, y - 13);
    }
  }

  useEffect(() => {
    const measure = () => {
      const el = wrapRef.current; if (!el) return;
      const w = el.clientWidth, h = el.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cv = cvRef.current!; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      sizeRef.current = { w, h, dpr }; draw();
    };
    measure(); const ro = new ResizeObserver(measure); if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { draw(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sims, planet, atm, est]);

  return (
    <>
      <div className="mapwrap" ref={wrapRef}>
        <canvas ref={cvRef} />
      </div>
      <div className="legend">
        <span><span className="sw" style={{ background: '#6fa8ff' }} />Snowball</span>
        <span><span className="sw" style={{ background: '#46d49a' }} />Temperate</span>
        <span><span className="sw" style={{ background: '#e24b4a' }} />Runaway</span>
        <span><span className="sw ring" />Earth</span>
        <span style={{ color: '#69728f' }}>· faint dots = simulated worlds · ringed = your planet’s closest analogs</span>
      </div>
    </>
  );
}

// ---------- the rigor gate ----------
interface Claim { claim: string; mechanism: string; confounder: string; test: string; novelty: string; }
const EMPTY_CLAIM: Claim = { claim: '', mechanism: '', confounder: '', test: '', novelty: '' };
const filled = (s: string) => s.trim().length >= 12;

function RigorModal({ planet, atm, est, onClose }: { planet: World; atm: Atmosphere; est: Estimate; onClose: () => void }) {
  const [c, setC] = useState<Claim>(EMPTY_CLAIM);
  const [copied, setCopied] = useState(false);
  const checks: { label: string; ok: boolean; gap: string }[] = [
    { label: 'Specific target', ok: true, gap: '' },
    { label: 'Stated assumptions', ok: true, gap: '' },
    { label: 'Inside simulated range', ok: est.inEnv, gap: `outside the simulated grid (${est.outOf.join(', ')}) — this is extrapolation, flag it` },
    { label: 'A clear claim', ok: filled(c.claim), gap: 'state the conjecture in one sentence' },
    { label: 'A physical mechanism', ok: filled(c.mechanism), gap: 'say *why* it would be true (the physics)' },
    { label: 'Confounders considered', ok: filled(c.confounder), gap: 'what bias / selection / small-sample effect could explain it away?' },
    { label: 'A falsifiable test', ok: filled(c.test), gap: 'what observation would confirm OR refute it?' },
    { label: 'Novelty addressed', ok: filled(c.novelty), gap: 'is this already known? what’s new here?' },
  ];
  const score = checks.filter((x) => x.ok).length;
  const gaps = checks.filter((x) => !x.ok);
  const card =
`HYPOTHESIS (draft · rigor ${score}/${checks.length})

Claim: ${c.claim.trim() || '(unstated)'}
Target: ${planet.name} — ${n(planet.radius)}× Earth radius, ${Math.round(est.flux)} W/m² starlight, ${planet.st_teff} K star
Assumed atmosphere: ${atm.pressure} bar surface pressure, ${atm.co2}% CO₂
Simulated-analog climate: median ${Math.round(est.median)} K (${kToC(est.median)}, ${est.reg.toLowerCase()}); ${est.n} nearest analogs span ${Math.round(est.lo)}–${Math.round(est.hi)} K${est.inEnv ? '' : ' — OUTSIDE the simulated grid (extrapolation)'}
Mechanism: ${c.mechanism.trim() || '(unstated)'}
Confounders considered: ${c.confounder.trim() || '(unstated)'}
Falsifiable test: ${c.test.trim() || '(unstated)'}
Novelty: ${c.novelty.trim() || '(unstated)'}

— Drafted in ThousandWorlds Explorer · Imagine Lab. A simulated analogy, not an observation or a habitability claim.`;
  const copy = () => { navigator.clipboard?.writeText(card).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }); };
  const field = (k: keyof Claim, label: string, ph: string) => (
    <label className="rigorfield"><span>{label}</span>
      <textarea value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} placeholder={ph} rows={2} /></label>
  );
  return (
    <Modal title="Forge a hypothesis" onClose={onClose} wide labelledBy="lab-rigor-title">
      <div className="rigor">
        <p className="rigorlede">Turn what you’re looking at into a claim a scientist could check. The gate fills in the data; you supply the reasoning. It won’t judge whether you’re <i>right</i> — it checks whether the claim is <b>well-formed and testable</b>.</p>
        <div className="rigorscore">
          <div className="rigormeter"><i style={{ width: `${(score / checks.length) * 100}%`, background: score >= checks.length - 1 ? '#46d49a' : score >= 4 ? '#f0b24a' : '#e24b4a' }} /></div>
          <span><b>{score}</b>/{checks.length} rigor checks met</span>
        </div>
        <div className="rigorgrid">
          {field('claim', 'Your claim (one sentence)', `e.g. ${planet.name} could sustain a temperate surface under a modest CO₂ atmosphere.`)}
          {field('mechanism', 'Mechanism — why would it be true?', 'the physics: starlight, greenhouse, clouds…')}
          {field('confounder', 'Confounders — what could explain it away?', 'detection bias, small analog sample, unknown atmosphere…')}
          {field('test', 'Falsifiable test — what observation settles it?', 'e.g. a JWST transmission spectrum showing/absent CO₂ + H₂O.')}
          {field('novelty', 'Novelty — is this already known?', 'what’s new vs. the literature?')}
        </div>
        {gaps.length > 0 && (
          <div className="rigorgaps">
            <div className="section-label" style={{ margin: '0 0 6px' }}>Gaps to close before this is find-worthy</div>
            <ul>{gaps.map((g) => <li key={g.label}><b>{g.label}:</b> {g.gap}</li>)}</ul>
          </div>
        )}
        <div className="rigorcard">
          <div className="rigorcardhead"><span className="section-label" style={{ margin: 0 }}>Your hypothesis card</span>
            <button className="btn primary" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button></div>
          <pre>{card}</pre>
        </div>
      </div>
    </Modal>
  );
}

// ---------- intro wizard ----------
function LabWizard({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} labelledBy="lab-wiz-title">
      <div className="wizard">
        <div className="wiztop"><span className="wizstep" id="lab-wiz-title">The Imagine Lab</span></div>
        <div className="wizbody">
          <h3>Play, then forge</h3>
          <p>This is a sandbox for your own theories. Two ways to use it:</p>
          <ul className="helplist tight">
            <li><b>Play</b> — pick a <b>real discovered planet</b>, assume an atmosphere, and watch the simulated climate models <b>re-estimate its surface climate</b> from its nearest simulated analogs — a better guess than the crude equilibrium temperature.</li>
            <li><b>Test your own equation</b> — write a formula over the real catalog and rank planets by <i>your</i> idea of what matters.</li>
            <li><b>Forge</b> — when a hunch feels real, open the <b>rigor gate</b>: it turns it into a clearly-stated, falsifiable hypothesis and shows you exactly what’s still missing.</li>
          </ul>
          <p className="wiznote">Honest by design: these are <b>simulated analogies</b>, not observations or habitability claims. The Lab points at <i>places worth a closer look</i> — it never says a planet must exist.</p>
        </div>
        <div className="wizctrl"><span /><button className="btn primary" onClick={onClose}>Start exploring</button></div>
      </div>
    </Modal>
  );
}

export default function ImagineLab() {
  const [nasa, setNasa] = useState<World[] | null>(null);
  const [sims, setSims] = useState<TwWorld[] | null>(null);
  const [meta, setMeta] = useState<TwMeta | null>(null);
  const [selected, setSelected] = useState<World | null>(null);
  const [atm, setAtm] = useState<Atmosphere>({ pressure: 1, co2: 1 });
  const [query, setQuery] = useState('');
  const [eqSrc, setEqSrc] = useState('');
  const [eqApplied, setEqApplied] = useState<{ fn: Fn; src: string } | null>(null);
  const [eqError, setEqError] = useState('');
  const [modal, setModal] = useState<'wizard' | 'rigor' | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/worlds.json').then((r) => r.json()),
      fetch('/thousandworlds.json').then((r) => r.json()),
      fetch('/thousandworlds-meta.json').then((r) => r.json()),
    ]).then(([w, s, m]: [World[], TwWorld[], TwMeta]) => { setNasa(w); setSims(s); setMeta(m); });
  }, []);
  useEffect(() => { if (nasa && sims && !localStorage.getItem('lab_seen')) { setModal('wizard'); localStorage.setItem('lab_seen', '1'); } }, [nasa, sims]);

  // planets we can translate (have the inputs the models need)
  const translatable = useMemo(() => (nasa ?? []).filter((w) => w.insol != null && w.radius != null && w.st_teff != null), [nasa]);
  const featured = useMemo(() => translatable.filter((w) => w.insol! >= 0.25 && w.insol! <= 2.4 && w.radius! < 2.2)
    .slice().sort((a, b) => Math.abs((a.teq ?? 400) - 288) - Math.abs((b.teq ?? 400) - 288)).slice(0, 6), [translatable]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase(); if (!q) return [];
    return translatable.filter((w) => `${w.name} ${w.host ?? ''}`.toLowerCase().includes(q)).slice(0, 8);
  }, [translatable, query]);

  const est = useMemo(() => (selected && sims && meta ? translate(selected, atm, sims, meta.ranges) : null), [selected, sims, meta, atm]);

  const ranked = useMemo(() => {
    if (!eqApplied || !nasa) return [];
    return nasa.map((w) => ({ w, v: (() => { try { const v = eqApplied.fn(planetCtx(w)); return isFinite(v) ? v : null; } catch { return null; } })() }))
      .filter((x): x is { w: World; v: number } => x.v != null)
      .sort((a, b) => b.v - a.v).slice(0, 8);
  }, [eqApplied, nasa]);

  const applyEq = () => {
    const src = eqSrc.trim(); if (!src) { setEqApplied(null); setEqError(''); return; }
    try { const fn = compile(src); fn({ R: 1, mass: 1, density: 1, insol: 1, flux: 1361, teq: 288, stT: 5772, period: 365, dist: 4, esi: 1, ecc: 0, smax: 1 }); setEqApplied({ fn, src }); setEqError(''); }
    catch (e) { setEqError(e instanceof Error ? e.message : 'could not read that formula'); }
  };

  if (!nasa || !sims || !meta) return <div className="loading">Loading the Imagine Lab…</div>;
  const sel = selected;

  return (
    <div className="main tw3">
      <aside className="sidebar">
        <div className="starthere">
          <button className="cta" onClick={() => setModal('wizard')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v.01M11 12h1v4h1" /></svg>
            How the Lab works
          </button>
        </div>

        <div className="twwhat"><p className="twlede">Drop a <b>real discovered planet</b> onto the simulated climate physics, assume an atmosphere, and let the models re-estimate the climate it would actually have.</p></div>

        <div className="section-label">1 · Pick a real planet</div>
        <input className="search" placeholder="Search 6,300 real planets…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="chips" style={{ marginTop: 8 }}>
          {(results.length ? results : featured).map((w) => (
            <button key={w.name} className={`chip${sel?.name === w.name ? ' active' : ''}`} onClick={() => setSelected(w)} title={`${n(w.radius)}× Earth · ${w.insol}× Earth starlight`}>{w.name}</button>
          ))}
        </div>
        {!results.length && <div className="labhint">featured: real planets closest to Earth’s temperature</div>}

        <div className="section-label">2 · Assume its atmosphere</div>
        <div className="slider-row">
          <div className="lab"><span>Surface pressure</span><b>{atm.pressure.toFixed(1)} bar</b></div>
          <input type="range" min={0.1} max={12} step={0.1} value={atm.pressure} onChange={(e) => setAtm({ ...atm, pressure: Number(e.target.value) })} />
        </div>
        <div className="slider-row">
          <div className="lab"><span>CO₂</span><b>{atm.co2.toFixed(0)}%</b></div>
          <input type="range" min={0} max={100} step={1} value={atm.co2} onChange={(e) => setAtm({ ...atm, co2: Number(e.target.value) })} />
        </div>
        <div className="labhint">The real planet’s atmosphere is unknown — so you set it, and the estimate moves with your assumption. That honesty is the point.</div>

        <div className="section-label">3 · Test your own equation</div>
        <div className="eqbuilder">
          <input className="search mono" placeholder="score = …  e.g. esi / sqrt(dist)" value={eqSrc}
            onChange={(e) => setEqSrc(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyEq(); }} />
          <div className="eqrow">
            <button className="btn primary" onClick={applyEq}>Rank planets</button>
            {eqApplied && <button className="linkbtn" onClick={() => { setEqApplied(null); setEqSrc(''); }}>clear</button>}
          </div>
          {eqError && <div className="eqerror">⚠ {eqError}</div>}
          <div className="labhint">variables: {EQ_VARS}</div>
          <div className="eqexamples">
            {EQ_EXAMPLES.map(([ex, why]) => <button key={ex} className="chip sm" onClick={() => { setEqSrc(ex); }} title={why}>{ex}</button>)}
          </div>
          {ranked.length > 0 && (
            <>
              <div className="labhint" style={{ marginTop: 8 }}>top real planets by <span className="mono">{eqApplied?.src}</span> — click to translate:</div>
              <div className="chips" style={{ marginTop: 6 }}>
                {ranked.map((r) => <button key={r.w.name} className={`chip${sel?.name === r.w.name ? ' active' : ''}`} onClick={() => setSelected(r.w)} title={`score ${r.v.toPrecision(3)}`}>{r.w.name}</button>)}
              </div>
            </>
          )}
        </div>
      </aside>

      <div className="center">
        <div className="statbar">
          <div className="stat big"><div className="v">{translatable.length.toLocaleString()}</div><div className="k">real planets in simulated range</div></div>
          <div className="stat"><div className="v">{meta.count.toLocaleString()}</div><div className="k">simulated analogs</div></div>
          {est && <div className="stat"><div className="v" style={{ color: tColor(est.median) }}>{Math.round(est.median)}<span className="u">K · {est.reg}</span></div><div className="k">re-estimated surface</div></div>}
        </div>
        <div className="twintro">
          <b>How to read this:</b> the faint dots are <Term name="gcm">simulated</Term> worlds; pick a real planet and it drops onto the map at its <Term name="flux">starlight</Term> and your assumed air pressure. Its <b>nearest simulated analogs</b> light up, and their temperatures become a re-estimate of its real climate — coloured <span style={{ color: '#6fa8ff' }}>frozen</span> → <span style={{ color: '#46d49a' }}>temperate</span> → <span style={{ color: '#e24b4a' }}>scorching</span>.
        </div>
        <div className="twcredit">
          Real planets: <b>NASA Exoplanet Archive</b>. Climate physics: the <b>ThousandWorlds</b> benchmark (Stevenson, Cranmer et al.), {meta.license}. Re-estimates are <b>simulated analogies</b>, not observations or habitability claims.
          <a href={meta.paper} target="_blank" rel="noreferrer"> paper</a> ·<a href={meta.code} target="_blank" rel="noreferrer"> code</a>
        </div>
        <LabField sims={sims} planet={sel} atm={atm} est={est} />
      </div>

      <section className="detail">
        {!sel || !est ? (
          <div className="empty">Pick a real planet on the left — or write an equation and click one of your top-ranked worlds — to re-estimate the climate the physics would give it.</div>
        ) : (
          <>
            <div className="dhead"><span className="dot" style={{ background: tColor(est.median) }} /><h2>{sel.name}</h2></div>
            <div className="dtype">{est.reg} re-estimate · {sel.host ?? 'host star'} · {sel.method ?? 'discovered'}</div>
            <p className="ddesc">Pushed through the climate models with your assumed atmosphere, {sel.name}’s nearest simulated analogs give a surface around <b>{Math.round(est.median)} K ({kToC(est.median)})</b> — a {est.reg.toLowerCase()} climate. {est.inEnv ? 'It sits inside the simulated grid.' : <span style={{ color: '#f0b24a' }}>Heads up: it’s outside the simulated grid ({est.outOf.join(', ')}) — this is extrapolation.</span>}</p>
            <div className="grid2">
              <div className="metric"><div className="k">Re-estimated surface</div><div className="v">{Math.round(est.median)}<span className="u">K</span></div></div>
              <div className="metric"><div className="k">NASA equilibrium temp</div><div className="v">{sel.teq != null ? Math.round(sel.teq) : '—'}<span className="u">K</span></div></div>
              <div className="metric"><div className="k">Analog spread</div><div className="v">{Math.round(est.lo)}–{Math.round(est.hi)}<span className="u">K</span></div></div>
              <div className="metric"><div className="k">From</div><div className="v">{est.n}<span className="u">analogs</span></div></div>
            </div>
            <div className="section-label" style={{ marginBottom: 6 }}>The real planet</div>
            <div className="rows">
              <div className="r"><span className="k">Starlight</span><span>{Math.round(est.flux)} W/m² ({n(sel.insol)}× Earth)</span></div>
              <div className="r"><span className="k">Size / mass</span><span>{n(sel.radius)}× · {sel.mass != null ? `${n(sel.mass)}× Earth` : 'mass unknown'}</span></div>
              <div className="r"><span className="k">Star temperature</span><span>{sel.st_teff} K</span></div>
              <div className="r"><span className="k">Distance</span><span>{sel.dist_ly != null ? `${n(sel.dist_ly)} light-years` : 'unknown'}</span></div>
              <div className="r"><span className="k">Your assumption</span><span>{atm.pressure.toFixed(1)} bar · {atm.co2.toFixed(0)}% CO₂</span></div>
            </div>
            <button className="cta" style={{ marginTop: 16 }} onClick={() => setModal('rigor')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l8 4v5c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V7z" /></svg>
              Forge a hypothesis
            </button>
          </>
        )}
      </section>

      {modal === 'wizard' && <LabWizard onClose={() => setModal(null)} />}
      {modal === 'rigor' && sel && est && <RigorModal planet={sel} atm={atm} est={est} onClose={() => setModal(null)} />}
    </div>
  );
}
