import { useEffect, useMemo, useRef, useState } from 'react';
import RangeFilter, { type Bound } from './RangeFilter';
import Term from './Term';
import Tour from './Tour';
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
  count: number; gcms: [string, number][]; ranges: Record<string, [number, number]>;
  source: string; license: string; paper: string; code: string;
}

// Surface-temperature climate colormap (K) — frozen → temperate → runaway.
function tColor(t: number): string {
  if (t < 240) return '#6fa8ff';   // snowball
  if (t < 273) return '#7fcfe6';   // cold
  if (t < 320) return '#46d49a';   // temperate (liquid-water band)
  if (t < 373) return '#f0b24a';   // hot
  return '#e24b4a';                // runaway / steam
}
function regime(t: number): string {
  if (t < 240) return 'Snowball';
  if (t < 273) return 'Cold';
  if (t < 320) return 'Temperate';
  if (t < 373) return 'Hot';
  return 'Runaway';
}
const kToC = (k: number) => `${Math.round(k - 273.15)} °C`;
const L10 = Math.log10;

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
const M = { l: 56, r: 16, t: 14, b: 38 };
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
    c.font = FONT; c.strokeStyle = '#19203a'; c.lineWidth = 1;
    c.fillStyle = '#69728f'; c.textAlign = 'center'; c.textBaseline = 'top';
    for (const fx of [500, 1000, 1500, 2000, 2500, 3000]) { const x = xp(fx); c.beginPath(); c.moveTo(x, M.t); c.lineTo(x, h - M.b); c.stroke(); c.fillText(`${fx}`, x, h - M.b + 7); }
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (const p of [0.1, 0.3, 1, 3, 10]) { const y = yp(p); c.beginPath(); c.moveTo(M.l, y); c.lineTo(w - M.r, y); c.stroke(); c.fillText(`${p}`, M.l - 7, y); }
    c.fillStyle = '#828bab'; c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillText('stellar flux reaching the planet  (W/m²)  →', (M.l + w - M.r) / 2, h - 2);
    c.save(); c.translate(13, (M.t + h - M.b) / 2); c.rotate(-Math.PI / 2); c.textBaseline = 'top'; c.fillText('surface pressure (bar)', 0, 0); c.restore();

    const pts: { x: number; y: number; w: TwWorld }[] = [];
    for (const wd of worlds) {
      if (wd.pressure == null) continue;
      const x = xp(wd.flux), y = yp(wd.pressure);
      c.fillStyle = tColor(wd.tsurf); c.globalAlpha = 0.85;
      c.beginPath(); c.arc(x, y, dotRadius(wd.radius), 0, 6.2832); c.fill();
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

  function onMove(e: React.MouseEvent) {
    const rect = cvRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let best: TwWorld | null = null, bd = 90;
    for (const p of ptsRef.current) { const d = (p.x - mx) ** 2 + (p.y - my) ** 2; if (d < bd) { bd = d; best = p.w; } }
    setHover(best ? { w: best, mx, my } : null);
  }

  return (
    <div className="mapwrap" ref={wrapRef}>
      <canvas ref={cvRef} style={{ cursor: hover ? 'pointer' : 'crosshair' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={() => hover && onSelect(hover.w)} />
      {hover && (
        <div className="tooltip" style={{ left: hover.mx > sizeRef.current.w - 220 ? hover.mx - 210 : hover.mx + 14, top: Math.max(6, hover.my - 10) }}>
          <div className="tn">{regime(hover.w.tsurf)} world · {hover.w.gcm}</div>
          <div className="td">surface {Math.round(hover.w.tsurf)} K ({kToC(hover.w.tsurf)})<br />{hover.w.flux} W/m² · {hover.w.pressure} bar · click to open</div>
        </div>
      )}
      <div className="legend">
        <span><span className="sw" style={{ background: '#6fa8ff' }} />Snowball</span>
        <span><span className="sw" style={{ background: '#7fcfe6' }} />Cold</span>
        <span><span className="sw" style={{ background: '#46d49a' }} />Temperate</span>
        <span><span className="sw" style={{ background: '#f0b24a' }} />Hot</span>
        <span><span className="sw" style={{ background: '#e24b4a' }} />Runaway</span>
        <span><span className="sw ring" />Earth analog</span>
        <span style={{ color: '#69728f' }}>· color = surface temperature · dot size = planet size</span>
      </div>
    </div>
  );
}

function DetailTw({ world, siblings }: { world: TwWorld | null; siblings: TwWorld[] }) {
  if (!world) return <section className="detail"><div className="empty">Click a simulated world to see the planet it started from and the climate the physics produced.</div></section>;
  const w = world;
  const dot = (t: number) => ({ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: tColor(t), marginRight: 7 } as const);
  return (
    <section className="detail">
      <div className="dhead"><span className="dot" style={{ background: tColor(w.tsurf) }} /><h2>Simulation #{w.sid}</h2></div>
      <div className="dtype">{regime(w.tsurf)} climate · model: {w.gcm}</div>
      <p className="ddesc">A simulated world fed into a global climate model. Its inputs (below) produced a global-mean <Term name="surface_temp">surface temperature</Term> of <b>{Math.round(w.tsurf)} K ({kToC(w.tsurf)})</b> — a {regime(w.tsurf).toLowerCase()} climate.</p>
      <div className="grid2">
        <div className="metric"><div className="k">Surface temp</div><div className="v">{Math.round(w.tsurf)}<span className="u">K</span></div></div>
        <div className="metric"><div className="k">In Celsius</div><div className="v">{kToC(w.tsurf)}</div></div>
        <div className="metric"><div className="k">Energy in → out</div><div className="v">{Math.round(w.asr)} → {Math.round(w.olr)}<span className="u">W/m²</span></div></div>
        <div className="metric"><div className="k">Cloud cover</div><div className="v">{Math.round(w.cloud * 100)}<span className="u">%</span></div></div>
      </div>
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

const GCM_LABEL: Record<string, string> = { exoplasim: 'ExoPlaSim', um: 'Met Office UM', exocam: 'ExoCAM', 'exocam-pre2022': 'ExoCAM ’21', lfric: 'LFRic' };
const CLIMATE_VIEWS: [string, string][] = [['all', 'All climates'], ['temperate', 'Temperate'], ['frozen', 'Frozen'], ['hot', 'Hot'], ['runaway', 'Runaway']];
const inClimate = (t: number, c: string) =>
  c === 'all' || (c === 'frozen' && t < 240) || (c === 'temperate' && t >= 273 && t <= 320) || (c === 'hot' && t >= 320 && t < 373) || (c === 'runaway' && t >= 373);

// A short narrated tour: hand-pick a representative snowball, Earth-twin, runaway, and a
// "models disagree" planet, with plain-language story text. Resolved from the data so it can't break.
interface TwStop { world: TwWorld; title: string; text: string; }
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
    snowball && { world: snowball, title: 'A frozen snowball world', text: `About the size of Earth, but it gets too little starlight to stay warm — so its whole surface freezes over at ${k(snowball)}. Frozen worlds like this show up blue, mostly on the left.` },
    earth && { world: earth, title: 'An Earth twin', text: `The sweet spot: roughly Earth's starlight and a familiar atmosphere give a mild ${k(earth)} climate where liquid water could exist. These are the green dots near the white "Earth" marker.` },
    runaway && { world: runaway, title: 'A runaway, Venus-like world', text: `Too much starlight or greenhouse gas tips this world into a scorching runaway at ${k(runaway)} — any oceans would boil away. These glow red.` },
    disagree && { world: disagree, title: 'One planet, models disagree', text: `This exact planet was run through several climate models and they don't agree on how hot it gets — see "Same planet, other climate models" on the right. Closing that gap is what the ThousandWorlds benchmark is for.` },
  ];
  return raw.filter((s): s is TwStop => !!s);
}

export default function ThousandWorlds() {
  const [worlds, setWorlds] = useState<TwWorld[] | null>(null);
  const [meta, setMeta] = useState<TwMeta | null>(null);
  const [gcms, setGcms] = useState<Set<string>>(new Set());
  const [climate, setClimate] = useState('all');
  const [ranges, setRanges] = useState<Record<string, Bound>>({});
  const [selected, setSelected] = useState<TwWorld | null>(null);
  const [tourStop, setTourStop] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([fetch('/thousandworlds.json').then((r) => r.json()), fetch('/thousandworlds-meta.json').then((r) => r.json())])
      .then(([w, m]: [TwWorld[], TwMeta]) => { setWorlds(w); setMeta(m); });
  }, []);

  const twStops = useMemo(() => (worlds ? twTourStops(worlds) : []), [worlds]);

  const filtered = useMemo(() => (worlds ?? []).filter((w) =>
    (gcms.size === 0 || gcms.has(w.gcm))
    && inClimate(w.tsurf, climate)
    && RANGE_KEYS.every((rk) => inRange(w[rk.key] as number | null, ranges[rk.key]))), [worlds, gcms, climate, ranges]);
  const activeRanges = Object.values(ranges).filter((b) => b && (b[0] != null || b[1] != null)).length;
  const temperate = useMemo(() => (worlds ?? []).filter((w) => w.tsurf >= 273 && w.tsurf <= 320).length, [worlds]);
  // Other models that ran the SAME planet — the benchmark's cross-GCM comparison.
  const siblings = useMemo(
    () => (selected && selected.planet != null && worlds ? worlds.filter((w) => w.planet === selected.planet).sort((a, b) => a.tsurf - b.tsurf) : []),
    [worlds, selected],
  );

  if (!worlds || !meta) return <div className="loading">Loading {`1,659`} simulated climates…</div>;

  const toggleGcm = (g: string) => { const s = new Set(gcms); s.has(g) ? s.delete(g) : s.add(g); setGcms(s); };
  const surprise = () => { const pool = worlds.filter((w) => w.pressure != null); setSelected(pool[Math.floor(Math.random() * pool.length)]); };
  const gotoStop = (i: number) => { const s = twStops[i]; if (!s) return; setTourStop(i); setSelected(s.world); };
  const startTour = () => { setGcms(new Set()); setClimate('all'); setRanges({}); gotoStop(0); };
  const nextStop = () => { if (tourStop == null) return; if (tourStop >= twStops.length - 1) setTourStop(null); else gotoStop(tourStop + 1); };

  return (
    <div className="main tw3">
      <aside className="sidebar">
        <div className="starthere">
          <button className="cta" onClick={startTour}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M14.5 9.5l-1.5 4-4 1.5 1.5-4z" /></svg>
            New here? Take the tour
          </button>
          <button className="cta ghost" onClick={surprise}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7M21 16v5h-5M15 15l6 6M3 8V3h5M9 9L3 3" /></svg>
            Surprise me
          </button>
        </div>

        <div className="section-label">What am I looking at?</div>
        <p className="twexplain">
          Every dot is a <b>made-up planet</b> put through a climate simulator — a <Term name="gcm">global climate model</Term>. Give it a star, an atmosphere and a spin, and the simulator works out how hot its surface gets and whether water could stay liquid. The map sorts them by how much <Term name="flux">starlight</Term> they get (left→right) and how thick their air is (bottom→top); color shows the resulting temperature.
        </p>
        <p className="twexplain" style={{ marginTop: 8 }}>
          The <b>five models</b> below are different simulators built by different teams — ExoPlaSim, the Met Office’s UM, ExoCAM (two versions) and LFRic. Picking one, or comparing them on the same planet, shows where the science agrees and where it still disagrees.
        </p>

        <div className="section-label">Climates</div>
        <div className="chips">
          {CLIMATE_VIEWS.map(([k, label]) => (
            <button key={k} className={`chip${climate === k ? ' active' : ''}`} onClick={() => setClimate(k)}>{label}</button>
          ))}
        </div>

        <div className="section-label">Climate model</div>
        <div className="chips">
          {meta.gcms.map(([g, ct]) => (
            <button key={g} className={`chip${gcms.size === 0 || gcms.has(g) ? ' active' : ''}`} onClick={() => toggleGcm(g)} title={`${GCM_DESC[g] ?? g} · ${ct} simulations`}>{GCM_LABEL[g] ?? g}</button>
          ))}
        </div>
        <div className="twmodels">
          <div><b>ExoPlaSim</b> — a fast, simplified model</div>
          <div><b>Met Office UM</b> — the UK's main climate model</div>
          <div><b>ExoCAM</b> — NCAR's exoplanet model (two versions)</div>
          <div><b>LFRic</b> — the Met Office's next-generation model</div>
        </div>

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
        </div>
        {tourStop != null && twStops[tourStop] && (
          <Tour
            index={tourStop} total={twStops.length}
            title={twStops[tourStop].title} text={twStops[tourStop].text} worldName={`Simulation #${twStops[tourStop].world.sid}`}
            onPrev={() => { if (tourStop > 0) gotoStop(tourStop - 1); }} onNext={nextStop} onExit={() => setTourStop(null)}
          />
        )}
        <div className="twintro">
          <b>How to read this:</b> too little <Term name="flux">starlight</Term> (left) or a thin <Term name="pressure">atmosphere</Term> freezes a world <span style={{ color: '#6fa8ff' }}>blue</span>; the right balance keeps liquid water <span style={{ color: '#46d49a' }}>green</span>; too much runs it away to a hot, Venus-like state <span style={{ color: '#e24b4a' }}>red</span>. The white dot is an <b>Earth twin</b> for scale.
        </div>
        <div className="twcredit">
          Simulated climates from the <b>ThousandWorlds</b> benchmark — Stevenson, Mak, Wolf, Sergeev, Hammond, Mayne &amp; Cranmer (2026), {meta.license}. A planet's parameters in, its climate out.
          <a href={meta.paper} target="_blank" rel="noreferrer"> paper</a> ·<a href={meta.code} target="_blank" rel="noreferrer"> code</a>
        </div>
        <ClimateScatter worlds={filtered} selected={selected} onSelect={setSelected} />
      </div>

      <DetailTw world={selected} siblings={siblings} />
    </div>
  );
}
