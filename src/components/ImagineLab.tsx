import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import BuildAWorld, { type BuiltWorld } from './BuildAWorld';
import FindingForge from './FindingForge';
import type { FieldMeta } from './SurfaceMap';
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
  return 'Scorching';
}
// A friendly one-line "fate" badge for the result card.
function verdict(t: number): { label: string; color: string } {
  if (t < 240) return { label: 'Frozen solid', color: '#6fa8ff' };
  if (t < 273) return { label: 'Cold', color: '#7fcfe6' };
  if (t < 320) return { label: 'Temperate · liquid water possible', color: '#46d49a' };
  if (t < 373) return { label: 'Hot', color: '#f0b24a' };
  return { label: 'Scorching', color: '#e24b4a' };
}
const kToC = (k: number) => `${Math.round(k - 273.15)} °C`;
const EARTH_FLUX = 1361;

interface TwMeta { count: number; gcms: [string, number][]; ranges: Record<string, [number, number]>; license: string; paper: string; code: string; field?: FieldMeta; }

// ---------- a tiny safe expression compiler (no eval) — powers "build your own" ----------
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
function planetCtx(w: World): Record<string, number> {
  return {
    R: w.radius ?? NaN, mass: w.mass ?? NaN, density: w.density ?? NaN,
    insol: w.insol ?? NaN, flux: w.insol != null ? w.insol * EARTH_FLUX : NaN,
    teq: w.teq ?? NaN, stT: w.st_teff ?? NaN, period: w.period ?? NaN,
    dist: w.dist_ly ?? NaN, esi: w.esi ?? NaN, ecc: w.ecc ?? NaN, smax: w.smax ?? NaN,
  };
}
const EQ_VARS = 'R · mass · insol · flux · teq · stT · period · dist · esi';
const EQ_EXAMPLES: [string, string][] = [
  ['esi', 'Earth-likeness'],
  ['1 / (abs(teq - 288) + 1)', 'closest to Earth’s temperature'],
  ['esi / sqrt(dist)', 'Earth-like AND nearby'],
];
// "Wishes" — plain-language lenses; each is secretly a ranking formula. (The newbie taps, never types.)
const WISHES: { label: string; expr: string }[] = [
  { label: 'Most Earth-like', expr: 'esi' },
  { label: 'Earth-like & nearby', expr: 'esi / sqrt(dist)' },
  { label: 'Closest to Earth’s temperature', expr: '1 / (abs(teq - 288) + 1)' },
  { label: 'Super-Earths', expr: '1 / (abs(R - 1.5) + 0.3)' },
];
const CURATED = ['TRAPPIST-1 e', 'Proxima Cen b', 'Kepler-442 b', 'Kepler-186 f', 'TOI-700 d', 'Kepler-452 b', 'Kepler-22 b', 'LHS 1140 b', 'Kepler-1649 c', 'Teegarden b'];
function planetSummary(w: World): string {
  const parts: string[] = [];
  if (w.radius != null) parts.push(`${n(w.radius)}× Earth-size`);
  if (w.insol != null) parts.push(`${n(w.insol)}× our sunlight`);
  if (w.dist_ly != null) parts.push(`${n(w.dist_ly)} ly away`);
  return parts.join(' · ');
}

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

// ---------- the climate map (flux x · pressure y) — the hero ----------
const FX = { min: 400, max: 3100 };
const PY = { min: 0.1, max: 12 };
const M = { l: 56, r: 16, t: 30, b: 38 };
const FONT = '11px ui-sans-serif, system-ui, -apple-system, sans-serif';
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const L10 = Math.log10;
interface Pin { w: World; est: Estimate; }

function LabField({ sims, pins, built, selName, atm }: { sims: TwWorld[]; pins: Pin[]; built: BuiltWorld[]; selName: string | null; atm: Atmosphere }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const ptsRef = useRef<{ x: number; y: number; w: TwWorld }[]>([]);
  const [hover, setHover] = useState<{ w: TwWorld; mx: number; my: number } | null>(null);

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
    // regime labels — shortened + collision-aware so they never overlap on narrow charts
    c.fillStyle = 'rgba(122,162,247,0.7)'; c.textAlign = 'left'; c.fillText('Frozen', px0 + 2, 9);
    c.fillStyle = 'rgba(226,75,74,0.7)'; c.textAlign = 'right'; c.fillText('Scorching', px1 - 2, 9);
    const tcx = xp(1250), tw = c.measureText('Temperate').width;
    if (tcx - tw / 2 > px0 + 2 + c.measureText('Frozen').width + 8 && tcx + tw / 2 < px1 - 2 - c.measureText('Scorching').width - 8) {
      c.fillStyle = 'rgba(70,212,154,0.75)'; c.textAlign = 'center'; c.fillText('Temperate', tcx, 9);
    }

    c.strokeStyle = '#121830'; c.lineWidth = 1; c.fillStyle = '#69728f'; c.textAlign = 'center'; c.textBaseline = 'top';
    for (const fx of [500, 1000, 1500, 2000, 2500, 3000]) { const x = xp(fx); c.beginPath(); c.moveTo(x, pTop); c.lineTo(x, pBot); c.stroke(); c.fillText(`${fx}`, x, pBot + 7); }
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (const p of [0.1, 0.3, 1, 3, 10]) { const y = yp(p); c.beginPath(); c.moveTo(M.l, y); c.lineTo(px1, y); c.stroke(); c.fillText(`${p}`, M.l - 7, y); }
    c.fillStyle = '#828bab'; c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillText('stellar flux reaching the planet  (W/m²)  →', (M.l + px1) / 2, h - 2);
    c.save(); c.translate(13, (pTop + pBot) / 2); c.rotate(-Math.PI / 2); c.textBaseline = 'top'; c.fillText('surface pressure (bar)  ·  your assumed atmosphere', 0, 0); c.restore();

    const selPin = pins.find((p) => p.w.name === selName) ?? null;
    const analog = selPin?.est.analog;
    const pts: { x: number; y: number; w: TwWorld }[] = [];
    for (const s of sims) {
      if (s.pressure == null) continue;
      const x = xp(s.flux), y = yp(s.pressure), r = dotRadius(s.radius);
      const isA = analog?.has(s.sid);
      c.fillStyle = tColor(s.tsurf);
      c.globalAlpha = analog && analog.size ? (isA ? 0.95 : 0.1) : 0.8;
      c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill();
      if (isA) { c.globalAlpha = 0.9; c.strokeStyle = '#cdd6f4'; c.lineWidth = 1; c.beginPath(); c.arc(x, y, r + 2, 0, 6.2832); c.stroke(); }
      pts.push({ x, y, w: s });
    }
    c.globalAlpha = 1; ptsRef.current = pts;

    const ex = xp(EARTH_FLUX), ey = yp(1);
    c.fillStyle = '#cfd8ff'; c.beginPath(); c.arc(ex, ey, 4.5, 0, 6.2832); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.arc(ex, ey, 4.5, 0, 6.2832); c.stroke();
    c.fillStyle = '#cfd8ff'; c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText('Earth', ex, ey - 7);

    for (const p of pins) {
      const x = xp(p.est.flux), y = yp(atm.pressure), isSel = p.w.name === selName;
      c.fillStyle = tColor(p.est.median); c.globalAlpha = 0.97;
      c.beginPath(); c.arc(x, y, isSel ? 7.5 : 5.5, 0, 6.2832); c.fill(); c.globalAlpha = 1;
      c.strokeStyle = '#fff'; c.lineWidth = isSel ? 2.5 : 1.5; c.beginPath(); c.arc(x, y, isSel ? 10.5 : 8, 0, 6.2832); c.stroke();
      c.fillStyle = '#fff'; c.font = `${isSel ? 12 : 11}px ui-sans-serif, system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'bottom';
      c.fillText(p.w.name, x, y - (isSel ? 13 : 11));
    }

    // YOUR built worlds — drawn as labelled diamonds so they stand apart from the round real/simulated dots
    for (const b of built) {
      const x = xp(b.flux), y = yp(b.pressure);
      c.fillStyle = tColor(b.mean); c.globalAlpha = 0.97;
      c.beginPath(); c.moveTo(x, y - 7.5); c.lineTo(x + 7.5, y); c.lineTo(x, y + 7.5); c.lineTo(x - 7.5, y); c.closePath(); c.fill();
      c.globalAlpha = 1; c.strokeStyle = '#fff'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(x, y - 11); c.lineTo(x + 11, y); c.lineTo(x, y + 11); c.lineTo(x - 11, y); c.closePath(); c.stroke();
      c.fillStyle = '#fff'; c.font = '12px ui-sans-serif, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'bottom';
      c.fillText(`◆ ${b.name}`, x, y - 13);
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
  useEffect(() => { draw(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sims, pins, built, selName, atm]);

  function onMove(e: React.MouseEvent) {
    const rect = cvRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let best: TwWorld | null = null, bd = 200;
    for (const p of ptsRef.current) { const d = (p.x - mx) ** 2 + (p.y - my) ** 2; if (d < bd) { bd = d; best = p.w; } }
    setHover(best ? { w: best, mx, my } : null);
  }

  return (
    <div className="mapwrap" ref={wrapRef}>
      <canvas ref={cvRef} style={{ cursor: hover ? 'crosshair' : 'default' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      {hover && (
        <div className="tooltip" style={{ left: hover.mx > sizeRef.current.w - 220 ? hover.mx - 210 : hover.mx + 14, top: Math.max(6, hover.my - 10) }}>
          <div className="tn">Simulated world · {hover.w.gcm}</div>
          <div className="td">surface {Math.round(hover.w.tsurf)} K ({kToC(hover.w.tsurf)}) · {regime(hover.w.tsurf)}<br />{hover.w.flux} W/m² · {hover.w.pressure} bar</div>
        </div>
      )}
    </div>
  );
}

// ---------- the "Find a world" finder modal ----------
const FILTERS: [string, string][] = [['all', 'All'], ['near', 'Nearby'], ['earth', 'Earth-size'], ['temp', 'Temperate-ish']];
function FinderModal({ planets, pinned, onPick, onTogglePin, onClose, initialExpr }: {
  planets: World[]; pinned: Set<string>; onPick: (w: World) => void; onTogglePin: (w: World) => void; onClose: () => void; initialExpr: string;
}) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [sortExpr, setSortExpr] = useState(initialExpr || 'esi');
  const [advOpen, setAdvOpen] = useState(false);
  const [eqSrc, setEqSrc] = useState('');
  const [eqErr, setEqErr] = useState('');

  const sortFn = useMemo(() => { try { return compile(sortExpr); } catch { return compile('esi'); } }, [sortExpr]);
  const curatedSet = useMemo(() => {
    const byName = new Map(planets.map((w) => [w.name, w]));
    const cs = CURATED.map((nm) => byName.get(nm)).filter((w): w is World => !!w);
    // rank the famous starters by the active wish too, so picking a wish visibly reorders them
    return cs.map((w) => ({ w, v: (() => { try { const val = sortFn(planetCtx(w)); return isFinite(val) ? val : -Infinity; } catch { return -Infinity; } })() }))
      .sort((a, b) => b.v - a.v).map((x) => x.w);
  }, [planets, sortFn]);
  const browsing = !q.trim() && filter === 'all';
  // how many real planets each filter surfaces — shown on the chips so a newbie sees what's available
  const filterCount = useMemo(() => ({
    all: planets.length,
    near: planets.filter((w) => w.dist_ly != null && w.dist_ly < 50).length,
    earth: planets.filter((w) => w.radius != null && w.radius <= 1.6).length,
    temp: planets.filter((w) => w.teq != null && w.teq >= 250 && w.teq <= 330).length,
  } as Record<string, number>), [planets]);
  const { rows, total } = useMemo(() => {
    let list = planets;
    const term = q.trim().toLowerCase();
    if (term) list = list.filter((w) => `${w.name} ${w.host ?? ''}`.toLowerCase().includes(term));
    if (filter === 'near') list = list.filter((w) => w.dist_ly != null && w.dist_ly < 50);
    else if (filter === 'earth') list = list.filter((w) => w.radius != null && w.radius <= 1.6);
    else if (filter === 'temp') list = list.filter((w) => w.teq != null && w.teq >= 250 && w.teq <= 330);
    const sorted = list.map((w) => ({ w, v: (() => { try { const val = sortFn(planetCtx(w)); return isFinite(val) ? val : -Infinity; } catch { return -Infinity; } })() }))
      .sort((a, b) => b.v - a.v).map((x) => x.w);
    return { rows: sorted.slice(0, 60), total: sorted.length };
  }, [planets, q, filter, sortFn]);

  const applyAdv = () => { const src = eqSrc.trim(); if (!src) return; try { const f = compile(src); f(planetCtx(planets[0])); setSortExpr(src); setEqErr(''); } catch (e) { setEqErr(e instanceof Error ? e.message : 'could not read that'); } };
  const wishLabel = WISHES.find((wi) => wi.expr === sortExpr)?.label;

  const Row = ({ w }: { w: World }) => {
    const on = pinned.has(w.name);
    return (
      <div className="finderrow">
        <button className="finderpick" onClick={() => onPick(w)}>
          <span className="fr-name">{w.name}</span>
          <span className="fr-sum">{planetSummary(w)}</span>
        </button>
        <button className={`finderpin${on ? ' on' : ''}`} onClick={() => onTogglePin(w)} aria-label={on ? 'Remove from map' : 'Add to map'} title={on ? 'On the map — click to remove' : 'Add to the map (compare several)'}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{on ? <path d="M5 12l5 5L20 7" /> : <path d="M12 5v14M5 12h14" />}</svg>
        </button>
      </div>
    );
  };

  return (
    <Modal title="Find a world to explore" onClose={onClose} wide labelledBy="lab-finder-title">
      <div className="finder">
        <style>{`
          .finder .buildyourown { border-color: #f0b24a; color: #f0b24a; position: relative; overflow: hidden; }
          .finder .buildyourown.on { background: rgba(240,178,74,0.12); color: #f0b24a; }
          .finder .buildyourown::before { content: ''; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(115deg, transparent 35%, rgba(240,178,74,0.32) 50%, transparent 65%); transform: translateX(-130%); animation: labsheen 3.4s ease-in-out infinite; }
          @keyframes labsheen { 0%, 58% { transform: translateX(-130%); } 100% { transform: translateX(230%); } }
          @media (prefers-reduced-motion: reduce) { .finder .buildyourown::before { animation: none; } }
          .finder .fcount { color: var(--text-faint); font-variant-numeric: tabular-nums; margin-left: 4px; }
          .finder .chip.active .fcount { color: var(--accent); }
          .finder .finderqual { font-size: 12px; color: var(--text-faint); align-self: center; margin-right: 2px; }
          .finder .finderresult { font-size: 12px; color: var(--text-faint); margin: 2px 0 -2px; }
          .finder .finderresult b { color: var(--text-dim); font-weight: 500; }
        `}</style>
        <input className="search" placeholder="Search by name…  (e.g. TRAPPIST, Kepler, Proxima)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div className="finderfilters">
          <span className="finderqual">Narrow to:</span>
          {FILTERS.map(([k, label]) => <button key={k} className={`chip${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)}>{label} <span className="fcount">{filterCount[k].toLocaleString()}</span></button>)}
          <span className="finderspacer" />
          <span className="finderhint">click a world to explore it · <b>+</b> pins it to compare</span>
        </div>

        <div className="findersort">
          <span className="finderqual">Rank by:</span>
          {WISHES.map((wi) => <button key={wi.expr} className={`chip sm${sortExpr === wi.expr ? ' active' : ''}`} onClick={() => setSortExpr(wi.expr)}>{wi.label}</button>)}
          <button className={`chip sm buildyourown${advOpen ? ' on' : ''}`} onClick={() => setAdvOpen(!advOpen)}>Build your own…</button>
        </div>
        {advOpen && (
          <div className="finderadv">
            <p>Rank worlds by your own formula. Variables (per planet): <span className="mono">{EQ_VARS}</span> — a bigger result sorts first.</p>
            <div className="eqrow">
              <input className="search mono" placeholder="e.g. esi / sqrt(dist)" value={eqSrc} onChange={(e) => setEqSrc(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyAdv(); }} />
              <button className="btn primary" onClick={applyAdv}>Use it</button>
            </div>
            {eqErr && <div className="eqerror">⚠ {eqErr}</div>}
            <div className="eqexamples">{EQ_EXAMPLES.map(([ex, why]) => <button key={ex} className="chip sm" onClick={() => { setEqSrc(ex); setSortExpr(ex); }} title={why}>{ex}</button>)}</div>
          </div>
        )}

        <div className="finderresult">Showing the top <b>{Math.min(60, total).toLocaleString()}</b> of {total.toLocaleString()} · ranked by “{wishLabel ?? 'your formula'}”</div>
        <div className="finderlist">
          {browsing && curatedSet.length > 0 && (
            <>
              <div className="finderlabel">Famous worlds to start with</div>
              {curatedSet.map((w) => <Row key={`c-${w.name}`} w={w} />)}
              <div className="finderlabel">More — ranked by “{wishLabel ?? 'your formula'}”</div>
            </>
          )}
          {rows.filter((w) => !(browsing && curatedSet.some((c) => c.name === w.name))).map((w) => <Row key={w.name} w={w} />)}
          {rows.length === 0 && <div className="finderempty">No worlds match — try a different search or filter.</div>}
        </div>

        {pinned.size > 0 && <div className="finderfoot"><span>{pinned.size} world{pinned.size > 1 ? 's' : ''} on the map</span><button className="btn primary" onClick={onClose}>Done</button></div>}
      </div>
    </Modal>
  );
}

// ---------- intro wizard ----------
function LabWizard({ onClose, onFind }: { onClose: () => void; onFind: () => void }) {
  return (
    <Modal onClose={onClose} labelledBy="lab-wiz-title">
      <div className="wizard">
        <div className="wiztop"><span className="wizstep" id="lab-wiz-title">Welcome to the Imagine Lab</span></div>
        <div className="wizbody">
          <h3>Discover a world in 4 steps</h3>
          <ul className="helplist tight">
            <li><b>1 · Find a world</b> — pick a real discovered planet (browse the famous ones, or tap a wish like “Most Earth-like”).</li>
            <li><b>2 · See its fate</b> — the climate models predict the surface temperature it would really have — a smarter guess than the textbook one.</li>
            <li><b>3 · Tweak &amp; be surprised</b> — slide the atmosphere thicker or thinner and watch the climate flip. Its real air is unknown, so <i>you</i> explore the possibilities.</li>
            <li className="claim-spark"><b>4 · Claim it</b> — found something? Turn it into a clear, testable hypothesis you can share.</li>
          </ul>
          <p className="wiznote">Honest by design: these are <b>simulated analogies</b>, not observations or habitability claims — the Lab points at <i>places worth a closer look</i>.</p>
        </div>
        <div className="wizctrl"><span /><button className="btn primary" onClick={() => { onClose(); onFind(); }}>Find my first world →</button></div>
      </div>
    </Modal>
  );
}

export default function ImagineLab() {
  const [nasa, setNasa] = useState<World[] | null>(null);
  const [sims, setSims] = useState<TwWorld[] | null>(null);
  const [meta, setMeta] = useState<TwMeta | null>(null);
  const [pinned, setPinned] = useState<World[]>([]);
  const [built, setBuilt] = useState<BuiltWorld[]>([]);   // hypothetical worlds the user dropped on the scatter
  const [selected, setSelected] = useState<World | null>(null);
  const [atm, setAtm] = useState<Atmosphere>({ pressure: 1, co2: 1 });
  const [showCo2, setShowCo2] = useState(false);
  const [finder, setFinder] = useState<{ expr: string } | null>(null);
  const [modal, setModal] = useState<'wizard' | 'finding' | 'build' | null>(null);
  const [surf, setSurf] = useState<Uint8Array | null>(null);
  const [autoStarted, setAutoStarted] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/worlds.json').then((r) => r.json()),
      fetch('/thousandworlds.json').then((r) => r.json()),
      fetch('/thousandworlds-meta.json').then((r) => r.json()),
    ]).then(([w, s, m]: [World[], TwWorld[], TwMeta]) => { setNasa(w); setSims(s); setMeta(m); });
  }, []);
  useEffect(() => { if (nasa && sims && !localStorage.getItem('lab_seen')) { setModal('wizard'); localStorage.setItem('lab_seen', '1'); } }, [nasa, sims]);

  const translatable = useMemo(() => (nasa ?? []).filter((w) => w.insol != null && w.radius != null && w.st_teff != null), [nasa]);
  const pinnedEst = useMemo(() => {
    if (!sims || !meta) return [] as Pin[];
    return pinned.map((w) => ({ w, est: translate(w, atm, sims, meta.ranges) })).filter((p): p is Pin => p.est != null);
  }, [pinned, atm, sims, meta]);
  const est = useMemo(() => pinnedEst.find((p) => p.w.name === selected?.name)?.est ?? null, [pinnedEst, selected]);
  const pinnedNames = useMemo(() => new Set(pinned.map((w) => w.name)), [pinned]);

  // Open with a worked example so a new user never lands on the blank/faded graph: auto-pin a
  // curated starter that predicts a temperate (inviting) climate at the default atmosphere.
  useEffect(() => {
    if (autoStarted || !nasa || !sims || !meta || pinned.length > 0) return;
    const byName = new Map(translatable.map((w) => [w.name, w]));
    const curated = CURATED.map((nm) => byName.get(nm)).filter((w): w is World => !!w);
    const scored = curated.map((w) => ({ w, m: translate(w, atm, sims, meta.ranges)?.median ?? null }))
      .filter((x): x is { w: World; m: number } => x.m != null);
    // prefer a temperate world (greenest — closest to ~293 K); else the warmest below scorching
    const temperate = scored.filter((x) => x.m >= 273 && x.m <= 318).sort((a, b) => Math.abs(a.m - 293) - Math.abs(b.m - 293));
    const warmest = scored.filter((x) => x.m < 320).sort((a, b) => b.m - a.m);
    const starter = (temperate[0] ?? warmest[0])?.w ?? curated[0] ?? translatable[0];
    if (starter) { setPinned([starter]); setSelected(starter); }
    setAutoStarted(true);
  }, [autoStarted, nasa, sims, meta, pinned, translatable, atm]);

  if (!nasa || !sims || !meta) return <div className="loading">Loading the Imagine Lab…</div>;

  const pick = (w: World) => { setPinned((ps) => (ps.some((p) => p.name === w.name) ? ps : [...ps, w])); setSelected(w); setFinder(null); };
  const togglePin = (w: World) => setPinned((ps) => {
    if (ps.some((p) => p.name === w.name)) { const next = ps.filter((p) => p.name !== w.name); if (selected?.name === w.name) setSelected(next[next.length - 1] ?? null); return next; }
    return [...ps, w];
  });
  const surprise = () => { const w = translatable[Math.floor(Math.random() * translatable.length)]; if (w) pick(w); };
  // drop a built world onto the scatter (newest replaces a same-named one); close Build so the map is revealed
  const addBuilt = (b: BuiltWorld) => { setBuilt((bs) => [...bs.filter((x) => x.name !== b.name), b]); setModal(null); };
  const removeBuilt = (name: string) => setBuilt((bs) => bs.filter((x) => x.name !== name));
  // Build-a-world (the interactive emulator demo) — lazy-load the surface-field asset on first open.
  const openBuild = () => {
    if (!surf && meta.field) fetch(`/${meta.field.asset}`).then((r) => r.arrayBuffer()).then((b) => setSurf(new Uint8Array(b))).catch(() => {});
    setModal('build');
  };
  const sel = selected;
  const v = est ? verdict(est.median) : null;
  const dteq = sel && est && sel.teq != null ? Math.round(est.median - sel.teq) : null;
  const vsTeq = dteq == null ? '' : Math.abs(dteq) < 12 ? `about its textbook ${Math.round(sel!.teq!)} K estimate` : dteq > 0 ? `${dteq} K warmer than its textbook ${Math.round(sel!.teq!)} K estimate — the atmosphere traps heat` : `${-dteq} K cooler than its textbook ${Math.round(sel!.teq!)} K estimate`;

  return (
    <div className="main lab">
      <style>{`
        .lab .labpin.built { border-color: rgba(70, 212, 154, 0.5); background: rgba(70, 212, 154, 0.08); }
        .lab .labpin.built > button:first-child { color: var(--good); cursor: default; }
        .lab .legend .sw.diamond { background: transparent; border-radius: 1px; transform: rotate(45deg); box-shadow: 0 0 0 1.5px #cfd8ff inset; }
        .lab .lr-coldnote { font-size: 12px; line-height: 1.55; color: var(--text-faint); margin: -3px 0 2px; }
        .lab .lr-coldnote .linkbtn { color: var(--good); }
      `}</style>
      <div className="labbar">
        <div className="labactions">
          <button className="cta" onClick={() => setFinder({ expr: 'esi' })}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            Find a world
          </button>
          <button className="cta ghost sheen" onClick={openBuild}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="4" y1="6" x2="20" y2="6" /><circle cx="9" cy="6" r="2" fill="currentColor" /><line x1="4" y1="12" x2="20" y2="12" /><circle cx="15" cy="12" r="2" fill="currentColor" /><line x1="4" y1="18" x2="20" y2="18" /><circle cx="7" cy="18" r="2" fill="currentColor" /></svg>
            Build a world
          </button>
          <button className="cta ghost" onClick={surprise}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7M21 16v5h-5M15 15l6 6M3 8V3h5M9 9L3 3" /></svg>
            Surprise me
          </button>
          <button className="cta ghost" onClick={() => setModal('wizard')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></svg>
            How it works
          </button>
        </div>
        <div className="labwishes">
          <span className="labwishlabel">Show me…</span>
          {WISHES.map((wi) => <button key={wi.expr} className="chip" onClick={() => setFinder({ expr: wi.expr })}>{wi.label}</button>)}
        </div>
      </div>

      {(pinned.length > 0 || built.length > 0) && (
        <div className="labpins">
          <span className="labpinlabel">On the map:</span>
          {pinned.map((w) => (
            <span key={w.name} className={`labpin${selected?.name === w.name ? ' active' : ''}`}>
              <button onClick={() => setSelected(w)}>{w.name}</button>
              <button className="labpinx" onClick={() => togglePin(w)} aria-label={`Remove ${w.name}`}>×</button>
            </span>
          ))}
          {built.map((b) => (
            <span key={`b-${b.name}`} className="labpin built" title="A world you built — hypothetical, not a real discovery">
              <button>◆ {b.name}</button>
              <button className="labpinx" onClick={() => removeBuilt(b.name)} aria-label={`Remove ${b.name}`}>×</button>
            </span>
          ))}
        </div>
      )}

      <LabField sims={sims} pins={pinnedEst} built={built} selName={selected?.name ?? null} atm={atm} />

      {sel && est && v ? (
        <div className="labresult">
          <div className="lr-head">
            <span className="lr-name">{sel.name}</span>
            <span className="lr-badge" style={{ color: v.color, borderColor: v.color }}>{v.label}</span>
            {!est.inEnv && <span className="lr-warn">⚠ outside the simulated range — treat as a rough guess</span>}
          </div>
          <p className="lr-say">Under a <b>{atm.pressure.toFixed(1)}-bar atmosphere</b>, the models predict a surface near <b style={{ color: v.color }}>{Math.round(est.median)} K ({kToC(est.median)})</b> — {vsTeq}. <span className="lr-faint">({est.n} nearest simulated analogs span {Math.round(est.lo)}–{Math.round(est.hi)} K.)</span></p>
          {est.median < 273 && (
            <p className="lr-coldnote">Even our most famous worlds read cold under these models — that's the honest result, not a glitch. Slide the air thicker above, or <button className="linkbtn" onClick={openBuild}>build a world</button> that lands temperate.</p>
          )}
          <div className="lr-tweak">
            <span className="lr-tlabel">thinner air</span>
            <input type="range" min={0.1} max={12} step={0.1} value={atm.pressure} onChange={(e) => setAtm({ ...atm, pressure: Number(e.target.value) })} aria-label="assumed surface pressure" />
            <span className="lr-tlabel">thicker air</span>
            <b className="lr-tval">{atm.pressure.toFixed(1)} bar</b>
            <button className="linkbtn" onClick={() => setShowCo2((s) => !s)}>{showCo2 ? 'hide CO₂' : 'CO₂'}</button>
          </div>
          {showCo2 && (
            <div className="lr-tweak">
              <span className="lr-tlabel">no CO₂</span>
              <input type="range" min={0} max={100} step={1} value={atm.co2} onChange={(e) => setAtm({ ...atm, co2: Number(e.target.value) })} aria-label="assumed CO2 percent" />
              <span className="lr-tlabel">thick CO₂</span>
              <b className="lr-tval">{atm.co2.toFixed(0)}%</b>
            </div>
          )}
          <button className="cta lr-find" onClick={() => setModal('finding')}>Could this be a find? →</button>
        </div>
      ) : (
        <div className="labresult labempty">
          <b>Pick a real planet to begin.</b> Tap <b>Find a world</b> (or a “Show me…” wish) — it lands on the map and the physics predicts the climate it would really have.
        </div>
      )}

      <div className="legend">
        <span><span className="sw" style={{ background: '#6fa8ff' }} />Frozen</span>
        <span><span className="sw" style={{ background: '#46d49a' }} />Temperate</span>
        <span><span className="sw" style={{ background: '#e24b4a' }} />Scorching</span>
        <span><span className="sw ring" />Earth</span>
        {built.length > 0 && <span><span className="sw diamond" />your built world</span>}
        <span style={{ color: '#69728f' }}>· faint dots = simulated worlds · your planet glows + its closest analogs ring up · {meta.license} · <a href={meta.paper} target="_blank" rel="noreferrer">paper</a></span>
      </div>

      {finder && <FinderModal planets={translatable} pinned={pinnedNames} onPick={pick} onTogglePin={togglePin} onClose={() => setFinder(null)} initialExpr={finder.expr} />}
      {modal === 'wizard' && <LabWizard onClose={() => setModal(null)} onFind={() => setFinder({ expr: 'esi' })} />}
      {modal === 'finding' && <FindingForge sims={sims} nasa={translatable} onMeet={(w) => { pick(w); setModal(null); }} onClose={() => setModal(null)} />}
      {modal === 'build' && meta.field && (
        surf
          ? <BuildAWorld sims={sims} nasa={translatable} surf={surf} field={meta.field} ranges={meta.ranges} onMeet={(w) => { pick(w); setModal(null); }} onAddToMap={addBuilt} onClose={() => setModal(null)} />
          : <Modal title="Build a world — predict its climate" onClose={() => setModal(null)}><div className="loading" style={{ padding: 30 }}>Loading the climate field…</div></Modal>
      )}
    </div>
  );
}
