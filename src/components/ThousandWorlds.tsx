import { useEffect, useMemo, useRef, useState } from 'react';
import RangeFilter, { type Bound } from './RangeFilter';
import Term from './Term';
import Tour from './Tour';
import Modal from './Modal';
import SurfaceMap, { type FieldMeta } from './SurfaceMap';
import { n, dotRadius } from '../lib/util';

// Plain-language decoder for the GCM (climate-model) codenames.
const GCM_DESC: Record<string, string> = {
  exoplasim: 'ExoPlaSim — a fast intermediate-complexity climate model',
  um: 'UK Met Office Unified Model (UM)',
  exocam: 'ExoCAM — exoplanet build of NCAR’s CAM model',
  'exocam-pre2022': 'ExoCAM (pre-2022 build)',
  lfric: 'LFRic — the Met Office’s next-generation model',
};

export interface TwWorld {
  sid: number; planet: number | null; gcm: string;
  radius: number | null; gravity: number; rotation: number; pressure: number | null;
  co2: number; ch4: number; flux: number; st_teff: number;
  tsurf: number; asr: number; olr: number; cloud: number;
}
interface TwMeta {
  count: number; full_count?: number; subset?: string; gcms: [string, number][]; ranges: Record<string, [number, number]>;
  source: string; license: string; paper: string; code: string; field?: FieldMeta;
}

// Surface-temperature climate colormap (K) — frozen → temperate → scorching.
function tColor(t: number): string {
  if (t < 240) return '#6fa8ff';   // snowball
  if (t < 273) return '#7fcfe6';   // cold
  if (t < 320) return '#46d49a';   // temperate (liquid-water band)
  if (t < 373) return '#f0b24a';   // hot
  return '#e24b4a';                // scorching / steam
}
function regime(t: number): string {
  if (t < 240) return 'Snowball';
  if (t < 273) return 'Cold';
  if (t < 320) return 'Temperate';
  if (t < 373) return 'Hot';
  return 'Scorching';
}
const kToC = (k: number) => `${Math.round(k - 273.15)} °C`;
const L10 = Math.log10;

// A short, memorable nickname for a world — so a clicked world reads as a "place"
// (e.g. "The Earth twin") instead of "Simulation #1510".
function nickname(w: TwWorld): string {
  const t = w.tsurf, p = w.pressure ?? 1;
  if (t >= 271 && t <= 315 && w.flux >= 900 && w.flux <= 1900 && p >= 0.5 && p <= 2.5) return 'The Earth twin';
  if (t < 235) return 'The snowball';
  if (t < 273) return 'The frozen world';
  if (t <= 320) return 'The temperate world';
  if (t < 373) return 'The sweltering world';
  return 'The boiling world';
}

// Input parameters (beyond the two mapped to axes) that can be range-filtered.
const RANGE_KEYS: { key: keyof TwWorld; label: string; unit: string; scale: 'log' | 'linear'; dp: number }[] = [
  { key: 'radius', label: 'Planet size', unit: 'R⊕', scale: 'linear', dp: 2 },
  { key: 'gravity', label: 'Gravity', unit: 'm/s²', scale: 'linear', dp: 1 },
  { key: 'rotation', label: 'Rotation', unit: 'days', scale: 'log', dp: 0 },
  { key: 'co2', label: 'CO₂', unit: '%', scale: 'linear', dp: 0 },
  { key: 'ch4', label: 'CH₄', unit: '%', scale: 'linear', dp: 1 },
  { key: 'st_teff', label: 'Star temp', unit: 'K', scale: 'linear', dp: 0 },
];
const inRange = (v: number | null, b?: Bound): boolean => {
  if (!b) return true;
  const [lo, hi] = b;
  if (lo == null && hi == null) return true;
  if (v == null) return false;
  if (lo != null && v < lo) return false;
  if (hi != null && v > hi) return false;
  return true;
};

// --- climate phase diagram: x = stellar flux, y = surface pressure (log), color = surface temp ---
const FX = { min: 400, max: 3150 };          // W/m^2 (full data range)
const PY = { min: 0.1, max: 12 };            // bar (full data range)
const M = { l: 56, r: 16, t: 30, b: 38 };
const FONT = '11px ui-sans-serif, system-ui, -apple-system, sans-serif';
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function ClimateScatter({ worlds, selected, onSelect }: { worlds: TwWorld[]; selected: TwWorld | null; onSelect: (w: TwWorld) => void; }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const ptsRef = useRef<{ x: number; y: number; w: TwWorld }[]>([]);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const [hover, setHover] = useState<{ w: TwWorld; mx: number; my: number } | null>(null);

  const xp = (flux: number) => { const { w } = sizeRef.current; return M.l + (clamp(flux, FX.min, FX.max) - FX.min) / (FX.max - FX.min) * (w - M.l - M.r); };
  const yp = (p: number) => { const { h } = sizeRef.current; return M.t + (1 - (L10(clamp(p, PY.min, PY.max)) - L10(PY.min)) / (L10(PY.max) - L10(PY.min))) * (h - M.t - M.b); };

  function draw() {
    const cv = cvRef.current; const { w, h, dpr } = sizeRef.current; if (!cv || w === 0) return;
    const c = cv.getContext('2d')!; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    c.fillStyle = '#080b16'; c.fillRect(0, 0, w, h);
    const px0 = M.l, px1 = w - M.r, pTop = M.t, pBot = h - M.b;

    // faint deterministic starfield — a "space" backdrop so the field reads as points of
    // light, not a spreadsheet grid (purely decorative; dot positions are untouched).
    c.fillStyle = '#cdd6f4';
    let seed = 20226;
    for (let i = 0; i < 80; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff; const sx = (seed % 1000) / 1000 * w;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff; const sy = (seed % 1000) / 1000 * h;
      c.globalAlpha = (i % 5 === 0) ? 0.15 : 0.055;
      c.fillRect(sx, sy, i % 9 === 0 ? 1.4 : 0.9, i % 9 === 0 ? 1.4 : 0.9);
    }
    c.globalAlpha = 1;

    // Soft regime backdrop: starlight (energy in) rises left→right, so worlds trend
    // frozen → temperate → scorching. A faint, smooth tendency — not a hard boundary —
    // with the temperate tint peaking near Earth's insolation (~1361 W/m²).
    const grad = c.createLinearGradient(px0, 0, px1, 0);
    grad.addColorStop(0.00, 'rgba(111,168,255,0.11)');
    grad.addColorStop(0.27, 'rgba(70,212,154,0.085)');
    grad.addColorStop(0.42, 'rgba(70,212,154,0.05)');
    grad.addColorStop(1.00, 'rgba(226,75,74,0.12)');
    c.fillStyle = grad; c.fillRect(px0, pTop, px1 - px0, pBot - pTop);
    // regime labels live in the top margin strip, clear of the dots
    c.font = FONT; c.textBaseline = 'top';
    c.fillStyle = 'rgba(122,162,247,0.7)'; c.textAlign = 'left'; c.fillText('mostly frozen', px0 + 2, 9);
    c.fillStyle = 'rgba(70,212,154,0.75)'; c.textAlign = 'center'; c.fillText('temperate band', xp(1250), 9);
    c.fillStyle = 'rgba(226,75,74,0.7)'; c.textAlign = 'right'; c.fillText('mostly scorching', px1 - 2, 9);

    // gridlines (kept very faint so the dots and zones lead)
    c.strokeStyle = '#121830'; c.lineWidth = 1;
    c.fillStyle = '#69728f'; c.textAlign = 'center'; c.textBaseline = 'top';
    for (const fx of [500, 1000, 1500, 2000, 2500, 3000]) { const x = xp(fx); c.beginPath(); c.moveTo(x, pTop); c.lineTo(x, pBot); c.stroke(); c.fillText(`${fx}`, x, pBot + 7); }
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (const p of [0.1, 0.3, 1, 3, 10]) { const y = yp(p); c.beginPath(); c.moveTo(M.l, y); c.lineTo(px1, y); c.stroke(); c.fillText(`${p}`, M.l - 7, y); }
    c.fillStyle = '#828bab'; c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillText('stellar flux reaching the planet  (W/m²)  →', (M.l + px1) / 2, h - 2);
    c.save(); c.translate(13, (pTop + pBot) / 2); c.rotate(-Math.PI / 2); c.textBaseline = 'top'; c.fillText('surface pressure (bar)', 0, 0); c.restore();

    // Focus: a selected world (incl. each tour stop) OR a hovered dot pops while the rest
    // dim. Hover dims gently — a spotlight that follows the cursor, so the map feels alive
    // and is obviously clickable; a click/selection dims harder so the pick really stands out.
    const sel = selected && selected.pressure != null && worlds.includes(selected) ? selected : null;
    const hv = hover ? hover.w : null;
    const focusing = sel || hv;
    const dim = sel ? 0.14 : 0.32;
    const pts: { x: number; y: number; w: TwWorld }[] = [];
    for (const wd of worlds) {
      if (wd.pressure == null) continue;
      const x = xp(wd.flux), y = yp(wd.pressure), r = dotRadius(wd.radius);
      const isFocus = wd === sel || wd === hv;
      const a = focusing ? (isFocus ? 0.97 : dim) : 0.82;
      c.fillStyle = tColor(wd.tsurf);
      if (isFocus) {                                                 // soft glow ONLY on the spotlighted world (tour / hover / click) — keeps the resting field crisp, not blurry
        c.globalAlpha = a * 0.25;
        c.beginPath(); c.arc(x, y, r + 3, 0, 6.2832); c.fill();
      }
      c.globalAlpha = a;                                             // crisp core
      c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill();
      pts.push({ x, y, w: wd });
    }
    c.globalAlpha = 1; ptsRef.current = pts;

    // Earth analog marker (≈1361 W/m², 1 bar)
    const ex = xp(1361), ey = yp(1);
    c.fillStyle = '#cfd8ff'; c.beginPath(); c.arc(ex, ey, 4.5, 0, 6.2832); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.arc(ex, ey, 4.5, 0, 6.2832); c.stroke();
    c.fillStyle = '#cfd8ff'; c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText('Earth', ex, ey - 7);

    const ring = (p: { x: number; y: number }, col: string, r: number, lw: number) => { c.strokeStyle = col; c.lineWidth = lw; c.beginPath(); c.arc(p.x, p.y, r, 0, 6.2832); c.stroke(); };
    if (selected && selected.pressure != null) ring({ x: xp(selected.flux), y: yp(selected.pressure) }, '#fff', dotRadius(selected.radius) + 3, 2);
    if (hover) ring({ x: xp(hover.w.flux), y: yp(hover.w.pressure ?? 1) }, '#fff', dotRadius(hover.w.radius) + 3, 1.5);
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
  useEffect(() => { draw(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [worlds, selected, hover]);
  // Clear any pinned hover tooltip when the selection changes by other means (tour / surprise /
  // click), so a stale tooltip can't linger while the mouse hasn't moved off the canvas.
  useEffect(() => { setHover(null); }, [selected]);

  function onMove(e: React.MouseEvent) {
    const rect = cvRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let best: TwWorld | null = null, bd = 90;
    for (const p of ptsRef.current) { const d = (p.x - mx) ** 2 + (p.y - my) ** 2; if (d < bd) { bd = d; best = p.w; } }
    setHover(best ? { w: best, mx, my } : null);
  }

  return (
    <>
      <div className="mapwrap" ref={wrapRef}>
        <canvas ref={cvRef} style={{ cursor: hover ? 'pointer' : 'crosshair' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={() => hover && onSelect(hover.w)} />
        {hover && (
          <div className="tooltip" style={{ left: hover.mx > sizeRef.current.w - 220 ? hover.mx - 210 : hover.mx + 14, top: Math.max(6, hover.my - 10) }}>
            <div className="tn">{regime(hover.w.tsurf)} world · {hover.w.gcm}</div>
            <div className="td">surface {Math.round(hover.w.tsurf)} K ({kToC(hover.w.tsurf)})<br />{hover.w.flux} W/m² · {hover.w.pressure} bar · click to open</div>
          </div>
        )}
      </div>
      <div className="legend">
        <span><span className="sw" style={{ background: '#6fa8ff' }} />Snowball</span>
        <span><span className="sw" style={{ background: '#7fcfe6' }} />Cold</span>
        <span><span className="sw" style={{ background: '#46d49a' }} />Temperate</span>
        <span><span className="sw" style={{ background: '#f0b24a' }} />Hot</span>
        <span><span className="sw" style={{ background: '#e24b4a' }} />Scorching</span>
        <span><span className="sw ring" />Earth analog</span>
        <span style={{ color: '#69728f' }}>· color = surface temperature · dot size = planet size</span>
      </div>
    </>
  );
}

function DetailTw({ world, siblings, surf, field, row, onDive }: {
  world: TwWorld | null; siblings: TwWorld[];
  surf: Uint8Array | null; field: FieldMeta | null; row: number | null;
  onDive: (rect: DOMRect, row: number) => void;
}) {
  if (!world) return <section className="detail"><div className="empty">Click a simulated world to see the planet it started from and the climate the physics produced.</div></section>;
  const w = world;
  const dot = (t: number) => ({ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: tColor(t), marginRight: 7 } as const);
  return (
    <section className="detail">
      <div className="dhead"><span className="dot" style={{ background: tColor(w.tsurf) }} /><h2>{nickname(w)}</h2></div>
      <div className="dtype">Simulation #{w.sid} · {regime(w.tsurf)} climate · model: {w.gcm}</div>
      <p className="ddesc">A simulated world fed into a global climate model. Its inputs (below) produced a global-mean <Term name="surface_temp">surface temperature</Term> of <b>{Math.round(w.tsurf)} K ({kToC(w.tsurf)})</b> — a {regime(w.tsurf).toLowerCase()} climate.</p>
      <div className="grid2">
        <div className="metric"><div className="k">Surface temp</div><div className="v">{Math.round(w.tsurf)}<span className="u">K</span></div></div>
        <div className="metric"><div className="k">In Celsius</div><div className="v">{kToC(w.tsurf)}</div></div>
        <div className="metric"><div className="k">Energy in → out</div><div className="v">{Math.round(w.asr)} → {Math.round(w.olr)}<span className="u">W/m²</span></div></div>
        <div className="metric"><div className="k">Cloud cover</div><div className="v">{Math.round(w.cloud * 100)}<span className="u">%</span></div></div>
      </div>
      {field && surf && row != null && (
        <button className="surfacelure" onClick={(e) => onDive(e.currentTarget.getBoundingClientRect(), row)} aria-label="Open this world’s surface climate map">
          <div className="section-label" style={{ marginBottom: 6 }}>Surface climate <span className="lurecue">⤢ dive in</span></div>
          <SurfaceMap data={surf} row={row} grid={field.grid} kRange={field.kRange} size="thumb" />
          <span className="lurehint">The temperature across this world — hottest toward its star, coldest on the far side. Tap to enlarge.</span>
        </button>
      )}
      <div className="section-label" style={{ marginBottom: 6 }}>The planet it started from</div>
      <div className="rows">
        <div className="r"><span className="k">Stellar flux</span><span>{w.flux} W/m² {w.flux > 1361 ? '(more than Earth)' : w.flux < 1361 ? '(less than Earth)' : '(Earth-like)'}</span></div>
        <div className="r"><span className="k">Surface pressure</span><span>{w.pressure} bar</span></div>
        <div className="r"><span className="k">CO₂ / CH₄</span><span>{w.co2}% / {w.ch4}%</span></div>
        <div className="r"><span className="k">Size / gravity</span><span>{w.radius}× Earth · {w.gravity} m/s²</span></div>
        <div className="r"><span className="k">Rotation</span><span>{w.rotation} days</span></div>
        <div className="r"><span className="k">Star temperature</span><span>{w.st_teff} K</span></div>
      </div>
      {siblings.length > 1 && (
        <>
          <div className="section-label" style={{ marginBottom: 6 }}>Same planet, other climate models</div>
          <div className="rows">
            {siblings.map((s) => (
              <div className="r" key={`${s.sid}-${s.gcm}`} style={s.sid === w.sid ? { color: 'var(--text)' } : undefined}>
                <span className="k"><span style={dot(s.tsurf)} />{s.gcm}{s.sid === w.sid ? ' · shown' : ''}</span>
                <span>{Math.round(s.tsurf)} K · {regime(s.tsurf)}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.55, margin: '8px 0 0' }}>
            {siblings.length} models ran this exact planet; they span {Math.round(Math.min(...siblings.map((s) => s.tsurf)))}–{Math.round(Math.max(...siblings.map((s) => s.tsurf)))} K. That disagreement is the benchmark's "epistemic uncertainty" — how much the climate models differ on an identical world.
          </p>
        </>
      )}
    </section>
  );
}

// The "dive into the dot" hero: the surface map blooms FLIP-style from the thumbnail's rect
// to a centered card, then closes back to the scatter (selection intact). Reduced-motion safe.
function SurfaceHero({ surf, field, row, world, originRect, onClose }: {
  surf: Uint8Array | null; field: FieldMeta; row: number; world: TwWorld; originRect: DOMRect; onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('modal-open'); };
  }, [onClose]);
  useEffect(() => {
    const card = cardRef.current; if (!card) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const f = card.getBoundingClientRect();
    const sx = originRect.width / f.width, sy = originRect.height / f.height;
    const dx = (originRect.left + originRect.width / 2) - (f.left + f.width / 2);
    const dy = (originRect.top + originRect.height / 2) - (f.top + f.height / 2);
    card.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    card.style.opacity = '0.5';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      card.style.transition = 'transform 300ms cubic-bezier(.2,.7,.2,1), opacity 220ms ease';
      card.style.transform = 'none';
      card.style.opacity = '1';
    }));
  }, [originRect]);
  return (
    <div className="surfacehero-backdrop" onClick={onClose}>
      <div className="surfacehero" ref={cardRef} role="dialog" aria-modal="true" aria-label={`${nickname(world)} surface climate`} onClick={(e) => e.stopPropagation()}>
        <div className="surfacehero-head">
          <div>
            <h2>{nickname(world)} · surface climate</h2>
            <div className="surfacehero-sub">Simulation #{world.sid} · {regime(world.tsurf)} · global mean {Math.round(world.tsurf)} K ({kToC(world.tsurf)}) · model: {world.gcm}</div>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <SurfaceMap data={surf} row={row} grid={field.grid} kRange={field.kRange} size="hero" />
        <div className="surfacehero-foot">
          <span className="surfacehero-scale"><i>colder</i><span className="ramp" /><i>hotter</i></span>
          <span className="surfacehero-note">Simulated surface temperature across the globe — longitude →, latitude ↑ — on the same color scale as the dots.</span>
        </div>
      </div>
    </div>
  );
}

const GCM_LABEL: Record<string, string> = { exoplasim: 'ExoPlaSim', um: 'Met Office UM', exocam: 'ExoCAM', 'exocam-pre2022': 'ExoCAM ’21', lfric: 'LFRic' };
const CLIMATE_VIEWS: [string, string][] = [['all', 'All climates'], ['temperate', 'Temperate'], ['frozen', 'Frozen'], ['hot', 'Hot'], ['runaway', 'Scorching']];
const inClimate = (t: number, c: string) =>
  c === 'all' || (c === 'frozen' && t < 240) || (c === 'temperate' && t >= 273 && t <= 320) || (c === 'hot' && t >= 320 && t < 373) || (c === 'runaway' && t >= 373);

// A short narrated tour: hand-pick a representative snowball, Earth-twin, runaway, and a
// "models disagree" planet, with plain-language story text. Resolved from the data so it can't break.
interface TwStop { world: TwWorld; nick: string; title: string; text: string; }
function twTourStops(worlds: TwWorld[]): TwStop[] {
  const has = worlds.filter((w) => w.pressure != null && w.radius != null);
  const best = (pool: TwWorld[], score: (w: TwWorld) => number) => pool.slice().sort((a, b) => score(a) - score(b))[0];
  const k = (w: TwWorld) => `${Math.round(w.tsurf)} K (${kToC(w.tsurf)})`;
  const snowball = best(has.filter((w) => w.tsurf < 230), (w) => Math.abs(w.radius! - 1) + Math.abs((w.pressure ?? 1) - 1));
  const earth = best(has.filter((w) => w.tsurf >= 273 && w.tsurf <= 300), (w) => Math.abs(w.flux - 1361) / 300 + Math.abs((w.pressure ?? 1) - 1) + Math.abs(w.tsurf - 288) / 40);
  const runaway = best(has.filter((w) => w.tsurf >= 373), (w) => Math.abs(w.flux - 1361) / 300);
  const groups: Record<number, TwWorld[]> = {};
  for (const w of worlds) if (w.planet != null) (groups[w.planet] ||= []).push(w);
  let disagree: TwWorld | undefined, spread = -1;
  for (const g of Object.values(groups)) {
    if (g.length < 2) continue;
    const s = Math.max(...g.map((x) => x.tsurf)) - Math.min(...g.map((x) => x.tsurf));
    if (s > spread) { spread = s; disagree = g.slice().sort((a, b) => a.tsurf - b.tsurf)[0]; }
  }
  const raw: (TwStop | undefined)[] = [
    snowball && { world: snowball, nick: 'The snowball', title: 'A frozen snowball world', text: `About the size of Earth, but it gets too little starlight to stay warm — so its whole surface freezes over at ${k(snowball)}. Frozen worlds like this show up blue, mostly on the left.` },
    earth && { world: earth, nick: 'The Earth twin', title: 'An Earth twin', text: `The sweet spot: roughly Earth's starlight and a familiar atmosphere give a mild ${k(earth)} climate where liquid water could exist. These are the green dots near the white "Earth" marker.` },
    runaway && { world: runaway, nick: 'The boiling world', title: 'A scorching, Venus-like world', text: `Too much starlight or greenhouse gas tips this world into a scorching, Venus-like state at ${k(runaway)} — any oceans would boil away. These glow red.` },
    disagree && { world: disagree, nick: 'The disputed world', title: 'One planet, models disagree', text: `This exact planet was run through several climate models and they don't agree on how hot it gets — see "Same planet, other climate models" on the right. Closing that gap is what the ThousandWorlds benchmark is for.` },
  ];
  return raw.filter((s): s is TwStop => !!s);
}

// --- The 5 climate models, in plain words AND a scientist lens (feature B). Facts kept
// measured (see arXiv:2606.18338); run counts are pulled live from meta so they stay honest. ---
interface ModelInfo { name: string; tag: string; plain: string; sci: string; good: string; bad: string; }
const MODEL_INFO: Record<string, ModelInfo> = {
  exoplasim: {
    name: 'ExoPlaSim', tag: 'fast · intermediate-complexity',
    plain: 'A fast, simplified climate simulator. It’s cheap to run, so it can chew through thousands of planets — most of the dots here come from it.',
    sci: 'Intermediate-complexity GCM (PlaSim spectral core) with simplified radiation and convection; built for large parameter sweeps and first-pass exploration.',
    good: 'Fast & cheap; huge ensembles', bad: 'Coarser, simplified physics',
  },
  um: {
    name: 'Met Office UM', tag: 'full-complexity',
    plain: 'The UK Met Office’s full weather-and-climate model — the same lineage used to forecast Earth. Detailed and trusted, but slow, so fewer planets get run.',
    sci: 'Full-complexity Unified Model; high-fidelity dynamics and physics, used as a reference for carefully studied individual cases.',
    good: 'High-fidelity; trusted reference', bad: 'Slow & expensive; fewer runs',
  },
  exocam: {
    name: 'ExoCAM', tag: 'NCAR · current build',
    plain: 'A US (NCAR) climate model adapted for exoplanets, with careful treatment of clouds and starlight. A widely used choice for studying potentially habitable worlds.',
    sci: 'Community model (CAM/CESM heritage) adapted for exoplanets; strong cloud and radiative-transfer treatment; widely used for habitable-zone studies.',
    good: 'Strong clouds & radiation', bad: 'Heavier to run than ExoPlaSim',
  },
  'exocam-pre2022': {
    name: 'ExoCAM ’21', tag: 'earlier ExoCAM build',
    plain: 'An earlier (pre-2022) version of ExoCAM. Keeping it lets scientists check whether later code changes actually changed the answers.',
    sci: 'Pre-2022 ExoCAM build, included so model-version consistency can be tested; superseded by the current build.',
    good: 'Version-to-version consistency check', bad: 'Superseded by the newer build',
  },
  lfric: {
    name: 'LFRic', tag: 'next-generation',
    plain: 'The Met Office’s brand-new next-generation model. Cutting-edge and still being checked, so only a handful of planets are run so far.',
    sci: 'Met Office next-generation model with a new (GungHo) dynamical core; cutting-edge and under validation — the newest, with the fewest runs.',
    good: 'Next-gen dynamical core', bad: 'Newest; still being validated; few runs',
  },
};
const MODEL_ORDER = ['exoplasim', 'um', 'exocam', 'exocam-pre2022', 'lfric'];

function ModelsModal({ meta, onClose }: { meta: TwMeta; onClose: () => void }) {
  const [lens, setLens] = useState<'plain' | 'sci'>('plain');
  const count = (k: string) => meta.gcms.find(([g]) => g === k)?.[1] ?? 0;
  const max = Math.max(...meta.gcms.map(([, c]) => c));
  return (
    <Modal title="The five climate models" onClose={onClose} wide labelledBy="tw-models-title">
      <div className="modelsmodal">
        <div className="modelsintro">
          <p>Every dot comes from one of these five simulators. They model the same physics differently, so they don’t always agree on how hot a planet ends up — and comparing them is the whole point of the benchmark.</p>
          <div className="lenstoggle" role="tablist" aria-label="Detail level">
            <button role="tab" aria-selected={lens === 'plain'} className={lens === 'plain' ? 'on' : ''} onClick={() => setLens('plain')}>In plain words</button>
            <button role="tab" aria-selected={lens === 'sci'} className={lens === 'sci' ? 'on' : ''} onClick={() => setLens('sci')}>For scientists</button>
          </div>
        </div>
        <div className="modeltablewrap">
          <div className="modeltable">
            <div className="mtrow mthead">
              <div>Model</div>
              <div>{lens === 'plain' ? 'What it is' : 'The science'}</div>
              <div>Good at</div>
              <div>Watch out for</div>
              <div className="mtnum">Runs here</div>
            </div>
            {MODEL_ORDER.map((k) => {
              const m = MODEL_INFO[k]; const c = count(k);
              return (
                <div className="mtrow" key={k}>
                  <div className="mtmodel"><b>{m.name}</b><span className="mttag">{m.tag}</span></div>
                  <div>{lens === 'plain' ? m.plain : m.sci}</div>
                  <div className="mtgood">{m.good}</div>
                  <div className="mtbad">{m.bad}</div>
                  <div className="mtnum">
                    <b>{c.toLocaleString()}</b><span className="mtpct">{Math.round((c / meta.count) * 100)}%</span>
                    <div className="mtbar"><i style={{ width: `${(c / max) * 100}%` }} /></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <p className="modelsfoot">
          Counts are how many simulated planets each model contributed to this {meta.count.toLocaleString()}-run slice. {meta.license} ·
          <a href={meta.paper} target="_blank" rel="noreferrer"> paper</a> ·<a href={meta.code} target="_blank" rel="noreferrer"> code</a>
        </p>
      </div>
    </Modal>
  );
}

// A tiny annotated cartoon of the phase diagram for the wizard's "how to read the map" step.
function MiniMap() {
  return (
    <svg className="minimap" viewBox="0 0 380 200" role="img" aria-label="How to read the map: starlight left to right, atmosphere thickness bottom to top, color is temperature.">
      {/* faint regime bands */}
      <rect x="44" y="12" width="106" height="150" fill="rgba(111,168,255,0.09)" />
      <rect x="150" y="12" width="100" height="150" fill="rgba(70,212,154,0.10)" />
      <rect x="250" y="12" width="116" height="150" fill="rgba(226,75,74,0.09)" />
      <rect x="44" y="12" width="322" height="150" fill="none" stroke="#1a2138" />
      {/* sample dots */}
      <circle cx="72" cy="58" r="5" fill="#6fa8ff" /><circle cx="100" cy="118" r="4" fill="#6fa8ff" /><circle cx="125" cy="86" r="6.5" fill="#6fa8ff" />
      <circle cx="178" cy="74" r="5" fill="#46d49a" /><circle cx="208" cy="124" r="6" fill="#46d49a" /><circle cx="160" cy="138" r="4" fill="#46d49a" />
      <circle cx="300" cy="62" r="6.5" fill="#e24b4a" /><circle cx="332" cy="112" r="5" fill="#e24b4a" /><circle cx="282" cy="142" r="4.5" fill="#e24b4a" />
      {/* Earth marker */}
      <circle cx="206" cy="96" r="5" fill="#cfd8ff" stroke="#fff" strokeWidth="1.5" />
      <text x="206" y="84" fill="#cfd8ff" fontSize="10" textAnchor="middle">Earth</text>
      {/* x axis */}
      <line x1="44" y1="176" x2="366" y2="176" stroke="#69728f" strokeWidth="1" />
      <path d="M366 176 l-6 -3 v6 z" fill="#69728f" />
      <text x="205" y="193" fill="#828bab" fontSize="10.5" textAnchor="middle">less starlight  →  more starlight</text>
      {/* y axis */}
      <line x1="30" y1="162" x2="30" y2="14" stroke="#69728f" strokeWidth="1" />
      <path d="M30 14 l-3 6 h6 z" fill="#69728f" />
      <text x="0" y="0" fill="#828bab" fontSize="10.5" textAnchor="middle" transform="translate(14,90) rotate(-90)">thin air → thick air</text>
    </svg>
  );
}

// First-run teaching wizard (feature A): 4 steps, dimmed backdrop, funnels into the live tour.
function WizardModal({ meta, onClose, onTour }: { meta: TwMeta; onClose: () => void; onTour: () => void }) {
  const [step, setStep] = useState(0);
  const total = 4;
  const count = (k: string) => meta.gcms.find(([g]) => g === k)?.[1] ?? 0;
  return (
    <Modal onClose={onClose} labelledBy="tw-wiz-title">
      <div className="wizard">
        <div className="wiztop">
          <span className="wizstep" id="tw-wiz-title">New here? · Step {step + 1} of {total}</span>
          <div className="wizdots">{Array.from({ length: total }, (_, i) => <span key={i} className={i === step ? 'on' : i < step ? 'done' : ''} />)}</div>
        </div>

        <div className="wizbody">
          {step === 0 && (
            <>
              <h3>What am I looking at?</h3>
              <p>Every dot on this map is a <b>made-up planet</b> — not a real, discovered one. Scientists invent a world (its star, atmosphere, spin and size) and feed it to a <b>climate simulator</b> that works out how hot its surface gets and whether liquid water could survive.</p>
              <p>Doing this for <b>thousands</b> of imagined planets helps map which kinds of worlds could be friendly to life — long before any telescope visits one.</p>
            </>
          )}
          {step === 1 && (
            <>
              <h3>How to read the map</h3>
              <MiniMap />
              <ul className="helplist tight">
                <li><b>Left → right:</b> more <b>starlight</b> reaching the planet.</li>
                <li><b>Bottom → top:</b> a <b>thicker atmosphere</b>.</li>
                <li><b>Color</b> = surface temperature: <span className="hsw" style={{ background: '#6fa8ff' }} />frozen → <span className="hsw" style={{ background: '#46d49a' }} />temperate → <span className="hsw" style={{ background: '#e24b4a' }} />scorching.</li>
                <li><b>Bigger dot</b> = bigger planet. The white <span className="hsw ring" /> dot is <b>Earth</b>, for scale.</li>
              </ul>
            </>
          )}
          {step === 2 && (
            <>
              <h3>Meet the five models</h3>
              <p>The dots come from <b>five different climate simulators</b>, each built by a different team. They don’t always agree on how hot the same planet gets — and measuring that disagreement is the whole point.</p>
              <ul className="wizmodels">
                {MODEL_ORDER.map((k) => (
                  <li key={k}><b>{MODEL_INFO[k].name}</b><span className="wizmtag">{MODEL_INFO[k].tag.split(' · ')[0]}</span><span className="wizmruns">{count(k).toLocaleString()} runs</span></li>
                ))}
              </ul>
              <p className="wiznote">Tip: the <b>“Compare the 5 models”</b> button in the sidebar opens a full side-by-side — in plain words or for scientists.</p>
            </>
          )}
          {step === 3 && (
            <>
              <h3>Now explore</h3>
              <p>You’re ready. Two easy ways in:</p>
              <ul className="helplist tight">
                <li><b>Take the guided tour</b> — a 4-stop walk through a frozen world, an Earth twin, a scorching one, and a planet the models argue about.</li>
                <li><b>Explore the map yourself</b> — click any dot to see the planet it started from and the climate that came out, or use the filters on the left.</li>
              </ul>
            </>
          )}
        </div>

        <div className="wizctrl">
          {step > 0 ? <button className="btn" onClick={() => setStep(step - 1)}>Back</button> : <span />}
          {step < total - 1
            ? <button className="btn primary" onClick={() => setStep(step + 1)}>Next</button>
            : <span className="wizfinish">
                <button className="btn" onClick={onClose}>Explore myself</button>
                <button className="btn primary" onClick={() => { onClose(); onTour(); }}>Take the guided tour</button>
              </span>}
        </div>
        <div className="wizcredit">
          Simulated climates from the <b>ThousandWorlds</b> benchmark — Stevenson, Mak, Wolf, Sergeev, Hammond, Mayne &amp; Cranmer (2026), {meta.license}. A planet's parameters in, its climate out.
          <a href={meta.paper} target="_blank" rel="noreferrer"> paper</a> ·<a href={meta.code} target="_blank" rel="noreferrer"> code</a>
        </div>
      </div>
    </Modal>
  );
}

export default function ThousandWorlds() {
  const [worlds, setWorlds] = useState<TwWorld[] | null>(null);
  const [meta, setMeta] = useState<TwMeta | null>(null);
  const [gcms, setGcms] = useState<Set<string>>(new Set());
  const [climate, setClimate] = useState('all');
  const [ranges, setRanges] = useState<Record<string, Bound>>({});
  const [selected, setSelected] = useState<TwWorld | null>(null);
  const [tourStop, setTourStop] = useState<number | null>(null);
  const [modal, setModal] = useState<'models' | 'wizard' | null>(null);
  const [surf, setSurf] = useState<Uint8Array | null>(null);
  const [hero, setHero] = useState<{ rect: DOMRect; row: number } | null>(null);

  useEffect(() => {
    Promise.all([fetch('/thousandworlds.json').then((r) => r.json()), fetch('/thousandworlds-meta.json').then((r) => r.json())])
      .then(([w, m]: [TwWorld[], TwMeta]) => { setWorlds(w); setMeta(m); setGcms(new Set(m.gcms.map(([g]) => g))); });
  }, []);

  // Lazy-load the per-world surface-temperature field the first time a world is selected,
  // so the ~3.4 MB asset is only fetched once the user actually engages with a world.
  useEffect(() => {
    if (selected && !surf && meta?.field) {
      fetch(`/${meta.field.asset}`).then((r) => r.arrayBuffer()).then((b) => setSurf(new Uint8Array(b))).catch(() => {});
    }
  }, [selected, surf, meta]);

  // First-run: auto-open the teaching wizard once ever (reopenable via the CTAs afterwards).
  useEffect(() => {
    if (worlds && meta && !localStorage.getItem('tw_wizard_seen')) {
      setModal('wizard');
      localStorage.setItem('tw_wizard_seen', '1');
    }
  }, [worlds, meta]);

  const twStops = useMemo(() => (worlds ? twTourStops(worlds) : []), [worlds]);

  const filtered = useMemo(() => (worlds ?? []).filter((w) =>
    gcms.has(w.gcm)
    && inClimate(w.tsurf, climate)
    && RANGE_KEYS.every((rk) => inRange(w[rk.key] as number | null, ranges[rk.key]))), [worlds, gcms, climate, ranges]);
  const activeRanges = Object.values(ranges).filter((b) => b && (b[0] != null || b[1] != null)).length;
  const temperate = useMemo(() => (worlds ?? []).filter((w) => w.tsurf >= 273 && w.tsurf <= 320).length, [worlds]);
  // Other models that ran the SAME planet — the benchmark's cross-GCM comparison.
  const siblings = useMemo(
    () => (selected && selected.planet != null && worlds ? worlds.filter((w) => w.planet === selected.planet).sort((a, b) => a.tsurf - b.tsurf) : []),
    [worlds, selected],
  );
  // worlds[i] is aligned to row i of the surface-field asset, so a world's row is its index here.
  const rowOf = useMemo(() => new Map((worlds ?? []).map((w, i) => [w.sid, i] as const)), [worlds]);

  if (!worlds || !meta) return <div className="loading">Loading {`1,659`} simulated climates…</div>;

  const allGcms = () => new Set(meta.gcms.map(([g]) => g));
  const toggleGcm = (g: string) => { const s = new Set(gcms); s.has(g) ? s.delete(g) : s.add(g); setGcms(s); };
  const selectAllGcms = () => setGcms(allGcms());
  const selectNoGcms = () => setGcms(new Set());
  const surprise = () => { const pool = worlds.filter((w) => w.pressure != null); setSelected(pool[Math.floor(Math.random() * pool.length)]); };
  const gotoStop = (i: number) => { const s = twStops[i]; if (!s) return; setTourStop(i); setSelected(s.world); };
  const startTour = () => { setGcms(allGcms()); setClimate('all'); setRanges({}); gotoStop(0); };
  const nextStop = () => { if (tourStop == null) return; if (tourStop >= twStops.length - 1) setTourStop(null); else gotoStop(tourStop + 1); };

  return (
    <div className="main tw3">
      <aside className="sidebar">
        <div className="starthere">
          <button className="cta" onClick={() => setModal('wizard')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v.01M11 12h1v4h1" /></svg>
            New here? Start here
          </button>
          <button className="cta ghost" onClick={surprise}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7M21 16v5h-5M15 15l6 6M3 8V3h5M9 9L3 3" /></svg>
            Surprise me
          </button>
        </div>

        <div className="twwhat">
          <p className="twlede">Every dot is a <b>made-up planet</b> run through a climate simulator. The map sorts them by starlight and air thickness; color is the temperature it ends up at.</p>
        </div>

        <div className="section-label">Climates</div>
        <div className="chips">
          {CLIMATE_VIEWS.map(([k, label]) => (
            <button key={k} className={`chip${climate === k ? ' active' : ''}`} onClick={() => setClimate(k)}>{label}</button>
          ))}
        </div>

        <div className="section-label rowlabel">
          <span>Climate model <span className="lblcount">{gcms.size}/{meta.gcms.length}</span></span>
          <span className="seltools">
            <button className="linkbtn" onClick={selectAllGcms}>All</button>
            <span className="seldot">·</span>
            <button className="linkbtn" onClick={selectNoGcms}>None</button>
          </span>
        </div>
        <div className="chips">
          {meta.gcms.map(([g, ct]) => (
            <button key={g} className={`chip${gcms.has(g) ? ' active' : ''}`} onClick={() => toggleGcm(g)} title={`${GCM_DESC[g] ?? g} · ${ct} simulations`}>{GCM_LABEL[g] ?? g}</button>
          ))}
        </div>
        <button className="infobtn modelsbtn" onClick={() => setModal('models')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" /></svg>
          Compare the 5 models
        </button>

        <div className="section-label">Refine the planet</div>
        {RANGE_KEYS.map((rk) => (
          <RangeFilter
            key={rk.key} label={rk.label} unit={rk.unit}
            domain={meta.ranges[rk.key] as [number, number]} scale={rk.scale}
            value={ranges[rk.key] ?? [null, null]}
            onChange={(v) => setRanges((r) => ({ ...r, [rk.key]: v }))}
            fmt={(x) => n(x, rk.dp)}
          />
        ))}
        {activeRanges > 0 && <button className="linkbtn" onClick={() => setRanges({})}>reset parameters</button>}
      </aside>

      <div className="center">
        <div className="statbar">
          <div className="stat big"><div className="v">{filtered.length.toLocaleString()}<span className="u">of {meta.count.toLocaleString()}</span></div><div className="k">simulated worlds</div></div>
          <div className="stat"><div className="v">{temperate.toLocaleString()}</div><div className="k">temperate (0–47 °C)</div></div>
          <div className="stat"><div className="v">{meta.gcms.length}</div><div className="k">climate models</div></div>
          <span className="statinfo" tabIndex={0} role="button" aria-label="How to read this map">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></svg>
            How to read this
            <span className="statinfopop" role="tooltip">
              Too little <b style={{ color: '#6fa8ff' }}>starlight</b> (left) or a thin atmosphere freezes a world <b style={{ color: '#6fa8ff' }}>blue</b>; the right balance keeps liquid water <b style={{ color: '#46d49a' }}>green</b>; too much runs it away to a hot, Venus-like <b style={{ color: '#e24b4a' }}>red</b> state. The white dot is an <b>Earth twin</b> for scale. Hover a dot to spotlight it · click to open its world.
            </span>
          </span>
        </div>
        <div className="statnote" style={{ fontSize: 11, lineHeight: 1.5, color: '#69728f', margin: '-2px 2px 6px' }}>
          This is the <b style={{ color: '#8aa0c8' }}>multi-complete</b> subset — {(meta.count).toLocaleString()} simulations with no missing fields — out of the full{' '}
          <a href="https://github.com/astroautomata/ThousandWorlds/blob/main/dataset/README.md" target="_blank" rel="noopener noreferrer" style={{ color: '#8aa0c8' }}>
            {(meta.full_count ?? 1760).toLocaleString()}-simulation dataset
          </a>{' '}(multi-partial).
        </div>
        {tourStop != null && twStops[tourStop] && (
          <Tour
            index={tourStop} total={twStops.length}
            title={twStops[tourStop].title} text={twStops[tourStop].text} worldName={`${twStops[tourStop].nick} · Sim #${twStops[tourStop].world.sid}`}
            onPrev={() => { if (tourStop > 0) gotoStop(tourStop - 1); }} onNext={nextStop} onExit={() => setTourStop(null)}
          />
        )}
        <ClimateScatter worlds={filtered} selected={selected} onSelect={setSelected} />
      </div>

      <DetailTw
        world={selected} siblings={siblings}
        surf={surf} field={meta.field ?? null}
        row={selected ? rowOf.get(selected.sid) ?? null : null}
        onDive={(rect, row) => setHero({ rect, row })}
      />

      {modal === 'wizard' && <WizardModal meta={meta} onClose={() => setModal(null)} onTour={startTour} />}
      {modal === 'models' && <ModelsModal meta={meta} onClose={() => setModal(null)} />}
      {hero && meta.field && worlds[hero.row] && (
        <SurfaceHero
          surf={surf} field={meta.field} row={hero.row}
          world={worlds[hero.row]} originRect={hero.rect}
          onClose={() => setHero(null)}
        />
      )}
    </div>
  );
}
