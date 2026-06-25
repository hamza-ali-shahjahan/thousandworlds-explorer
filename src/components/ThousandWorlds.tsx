import { useEffect, useMemo, useRef, useState } from 'react';
import RangeFilter, { type Bound } from './RangeFilter';
import Term from './Term';
import { n } from '../lib/util';

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
      c.beginPath(); c.arc(x, y, 4, 0, 6.2832); c.fill();
      pts.push({ x, y, w: wd });
    }
    c.globalAlpha = 1; ptsRef.current = pts;

    // Earth analog marker (≈1361 W/m², 1 bar)
    const ex = xp(1361), ey = yp(1);
    c.fillStyle = '#cfd8ff'; c.beginPath(); c.arc(ex, ey, 4.5, 0, 6.2832); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.arc(ex, ey, 4.5, 0, 6.2832); c.stroke();
    c.fillStyle = '#cfd8ff'; c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText('Earth', ex, ey - 7);

    const ring = (p: { x: number; y: number }, col: string, r: number, lw: number) => { c.strokeStyle = col; c.lineWidth = lw; c.beginPath(); c.arc(p.x, p.y, r, 0, 6.2832); c.stroke(); };
    if (selected && selected.pressure != null) ring({ x: xp(selected.flux), y: yp(selected.pressure) }, '#fff', 7, 2);
    if (hover) ring({ x: xp(hover.w.flux), y: yp(hover.w.pressure ?? 1) }, '#fff', 6, 1.5);
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
        <span style={{ color: '#69728f' }}>· color = simulated surface temperature</span>
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

export default function ThousandWorlds() {
  const [worlds, setWorlds] = useState<TwWorld[] | null>(null);
  const [meta, setMeta] = useState<TwMeta | null>(null);
  const [gcms, setGcms] = useState<Set<string>>(new Set());
  const [tempOnly, setTempOnly] = useState(false);
  const [ranges, setRanges] = useState<Record<string, Bound>>({});
  const [showParams, setShowParams] = useState(false);
  const [selected, setSelected] = useState<TwWorld | null>(null);

  useEffect(() => {
    Promise.all([fetch('/thousandworlds.json').then((r) => r.json()), fetch('/thousandworlds-meta.json').then((r) => r.json())])
      .then(([w, m]: [TwWorld[], TwMeta]) => { setWorlds(w); setMeta(m); });
  }, []);

  const filtered = useMemo(() => (worlds ?? []).filter((w) =>
    (gcms.size === 0 || gcms.has(w.gcm))
    && (!tempOnly || (w.tsurf >= 273 && w.tsurf <= 320))
    && RANGE_KEYS.every((rk) => inRange(w[rk.key] as number | null, ranges[rk.key]))), [worlds, gcms, tempOnly, ranges]);
  const activeRanges = Object.values(ranges).filter((b) => b && (b[0] != null || b[1] != null)).length;
  const temperate = useMemo(() => filtered.filter((w) => w.tsurf >= 273 && w.tsurf <= 320).length, [filtered]);
  // Other models that ran the SAME planet — the benchmark's cross-GCM comparison.
  const siblings = useMemo(
    () => (selected && selected.planet != null && worlds ? worlds.filter((w) => w.planet === selected.planet).sort((a, b) => a.tsurf - b.tsurf) : []),
    [worlds, selected],
  );

  if (!worlds || !meta) return <div className="loading">Loading {`1,659`} simulated climates…</div>;

  const toggleGcm = (g: string) => { const s = new Set(gcms); s.has(g) ? s.delete(g) : s.add(g); setGcms(s); };

  return (
    <div className="main tw">
      <div className="center">
        <div className="statbar">
          <div className="stat big"><div className="v">{filtered.length.toLocaleString()}<span className="u">of {meta.count.toLocaleString()}</span></div><div className="k">simulated worlds</div></div>
          <div className="stat"><div className="v">{temperate.toLocaleString()}</div><div className="k">temperate (0–47 °C)</div></div>
          <div className="stat"><div className="v">{meta.gcms.length}</div><div className="k">climate models</div></div>
          <span className="spacer" />
          <div className="chips">
            {meta.gcms.map(([g, ct]) => (
              <button key={g} className={`chip${gcms.size === 0 || gcms.has(g) ? ' active' : ''}`} onClick={() => toggleGcm(g)} title={`${GCM_DESC[g] ?? g} · ${ct} simulations`}>{g}</button>
            ))}
            <button className={`chip${tempOnly ? ' active' : ''}`} onClick={() => setTempOnly((v) => !v)}>temperate only</button>
            <button className={`chip${showParams || activeRanges ? ' active' : ''}`} onClick={() => setShowParams((v) => !v)}>
              refine parameters{activeRanges ? ` (${activeRanges})` : ''} {showParams ? '▴' : '▾'}
            </button>
          </div>
        </div>
        {showParams && (
          <div className="twparams">
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
          </div>
        )}
        <div className="twintro">
          <b>How to read this:</b> each dot is one simulated planet run through a <Term name="gcm">global climate model</Term>. Too little <Term name="flux">starlight</Term> (left) or a thin <Term name="pressure">atmosphere</Term> freezes it <span style={{ color: '#6fa8ff' }}>blue</span>; the right balance keeps liquid water <span style={{ color: '#46d49a' }}>green</span>; too much starlight or greenhouse gas runs it away to a hot, Venus-like state <span style={{ color: '#e24b4a' }}>red</span>.
        </div>
        <div className="twcredit">
          Simulated climates from the <b>ThousandWorlds</b> benchmark — Stevenson, Mak, Wolf, Sergeev, Hammond, Mayne &amp; Cranmer (2026), {meta.license}. Each dot is a real GCM run: a planet's parameters in, its climate out.
          <a href={meta.paper} target="_blank" rel="noreferrer"> paper</a> ·<a href={meta.code} target="_blank" rel="noreferrer"> code</a>
        </div>
        <ClimateScatter worlds={filtered} selected={selected} onSelect={setSelected} />
      </div>
      <DetailTw world={selected} siblings={siblings} />
    </div>
  );
}
