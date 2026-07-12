import { useEffect, useMemo, useRef, useState } from 'react';
import type { World } from '../types';
import { n, UNKNOWN_COLOR } from '../lib/util';
import verdictData from '../data/jwstVerdicts.json';
import './Shoreline.css';

// ── the Cosmic Shoreline: cumulative XUV vs escape velocity ─────────────────
// x: v_esc = 11.186·√(M/R) km/s (Earth units) — uses best-available mass,
//    heavily model-dependent for many small planets.
// y: I_XUV = S × (L/L☉)^−0.6 in Earth units (Zahnle & Catling 2017 scaling).
//    worlds.json carries no st_lum column, so L/L☉ falls back to
//    Stefan–Boltzmann: st_rad² · (st_teff/5772)⁴.

const VMIN = 1.5, VMAX = 1000;     // escape velocity domain, km/s (log)
const IMIN = 1e-4, IMAX = 1e5;     // cumulative XUV domain, Earth = 1 (log)
const L10 = Math.log10;
const M = { l: 64, r: 18, t: 16, b: 40 };
const FONT = '11px ui-sans-serif, system-ui, -apple-system, sans-serif';

const MDWARF_TEFF = 3400;  // late-M regime where measured fluences run high
const MDWARF_MULT = 2.5;   // Pass+ 2025 (arXiv:2504.01182): 2.1–3.1× — use ×2.5

const V_TICKS: [number, string][] = [
  [3, '3'], [10, '10'], [30, '30'], [100, '100'], [300, '300'], [1000, '1,000'],
];
const I_TICKS: [number, string][] = [
  [1e-4, '10⁻⁴'], [1e-2, '0.01'], [1, '1'], [100, '100'], [1e4, '10⁴'],
];

// log10(I_XUV) = slope·log10(v_esc) + icept — mirrors shorelines[] in jwstVerdicts.json.
const LINES = [
  { id: 'zc17_xuv', slope: 4, icept: -3.17, color: '#6fa8ff', short: 'Zahnle & Catling 2017 · I ∝ v⁴' },
  { id: 'eecs_2026', slope: 5.77, icept: -4.35, color: '#b48cf2', short: 'Empirical 2026 · I ∝ v⁵·⁷⁷' },
] as const;
type LineId = (typeof LINES)[number]['id'];

const VERDICT_META: Record<string, { color: string; label: string }> = {
  'bare-rock': { color: '#e2685a', label: 'Bare rock' },
  'no-thick-atmosphere': { color: '#f0b24a', label: 'No thick atmosphere' },
  'ambiguous': { color: '#8fa0c9', label: 'Ambiguous' },
  'atmosphere-candidate': { color: '#46d49a', label: 'Atmosphere candidate' },
};
const verdictMeta = (v: string) => VERDICT_META[v] ?? { color: UNKNOWN_COLOR, label: v };

// Solar System anchors — v_esc in km/s; I_XUV equals bolometric S (Earth = 1)
// exactly, because for the Sun L = L☉ so the (L/L☉)^−0.6 factor is 1.
// (Moon shares Earth's orbit, hence S = 1 at a tenth of the escape velocity.)
const ANCHORS = [
  { name: 'Mercury', ve: 4.25, ix: 6.67, dy: -8 },
  { name: 'Venus', ve: 10.36, ix: 1.91, dy: -8 },
  { name: 'Earth', ve: 11.19, ix: 1, dy: 14 },
  { name: 'Mars', ve: 5.03, ix: 0.43, dy: 14 },
  { name: 'Moon', ve: 2.38, ix: 1, dy: -8 },
  { name: 'Titan', ve: 2.64, ix: 0.011, dy: 14 },
] as const;
type Anchor = (typeof ANCHORS)[number];

type VerdictEntry = (typeof verdictData.planets)[number];
interface DPt { ve: number; ix: number; w: World; m: boolean; v: VerdictEntry | null }
interface SPt { x: number; y: number; w?: World; v?: VerdictEntry; a?: Anchor }
interface Props { worlds: World[]; onSelect: (w: World) => void; selected: World | null }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const fmtI = (x: number) =>
  x >= 1000 ? Math.round(x).toLocaleString() : x >= 10 ? `${Math.round(x)}` : x >= 0.1 ? x.toFixed(1) : x.toPrecision(2);

export default function Shoreline({ worlds, onSelect, selected }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const catRef = useRef<SPt[]>([]);   // faint catalog dots (hit-test tier 2)
  const topRef = useRef<SPt[]>([]);   // verdict planets + anchors (tier 1)
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });

  const [lineOn, setLineOn] = useState<Record<LineId, boolean>>({ zc17_xuv: true, eecs_2026: true });
  const [mBoost, setMBoost] = useState(false);
  const [hover, setHover] = useState<{ pt: SPt; mx: number; my: number } | null>(null);

  const verdictOf = useMemo(() => {
    const m = new Map<string, VerdictEntry>();
    for (const p of verdictData.planets) m.set(p.name, p);
    return m;
  }, []);

  // Precompute data-space points once per catalog; the M-dwarf boost is
  // applied at draw time so the toggle only re-renders, never re-derives.
  const pts = useMemo(() => {
    const out: DPt[] = [];
    for (const w of worlds) {
      if (w.mass == null || w.radius == null || w.mass <= 0 || w.radius <= 0) continue;
      if (w.insol == null || w.insol <= 0 || w.st_teff == null || w.st_rad == null) continue;
      const L = w.st_rad * w.st_rad * (w.st_teff / 5772) ** 4;  // st_lum fallback
      if (!(L > 0)) continue;
      out.push({
        ve: 11.186 * Math.sqrt(w.mass / w.radius),
        ix: w.insol * L ** -0.6,
        w, m: w.st_teff < MDWARF_TEFF,
        v: verdictOf.get(w.name) ?? null,
      });
    }
    return out;
  }, [worlds, verdictOf]);

  const verdictPts = useMemo(() => pts.filter((p) => p.v), [pts]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of verdictPts) c[p.v!.verdict] = (c[p.v!.verdict] || 0) + 1;
    return c;
  }, [verdictPts]);

  // Refs mirror props/state so drawBase/paint stay stable across renders.
  const ptsRef = useRef(pts); ptsRef.current = pts;
  const lineOnRef = useRef(lineOn); lineOnRef.current = lineOn;
  const mBoostRef = useRef(mBoost); mBoostRef.current = mBoost;
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const hoverRef = useRef(hover); hoverRef.current = hover;

  const xPix = (v: number) => {
    const { w } = sizeRef.current;
    return M.l + (L10(clamp(v, VMIN, VMAX)) - L10(VMIN)) / (L10(VMAX) - L10(VMIN)) * (w - M.l - M.r);
  };
  const yPix = (ix: number) => {
    const { h } = sizeRef.current;
    return M.t + (1 - (L10(clamp(ix, IMIN, IMAX)) - L10(IMIN)) / (L10(IMAX) - L10(IMIN))) * (h - M.t - M.b);
  };
  const boosted = (p: DPt) => (mBoostRef.current && p.m ? p.ix * MDWARF_MULT : p.ix);

  function drawBase() {
    const { w, h, dpr } = sizeRef.current;
    if (w === 0 || h === 0) return;
    const base = baseRef.current ?? (baseRef.current = document.createElement('canvas'));
    base.width = Math.round(w * dpr); base.height = Math.round(h * dpr);
    const c = base.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);

    // faint starfield (deterministic)
    c.fillStyle = '#cdd6f4';
    let seed = 4243;
    for (let i = 0; i < 90; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const sx = (seed % 1000) / 1000 * w;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const sy = (seed % 1000) / 1000 * h;
      c.globalAlpha = (i % 6 === 0) ? 0.18 : 0.07;
      c.fillRect(sx, sy, i % 9 === 0 ? 1.4 : 0.9, i % 9 === 0 ? 1.4 : 0.9);
    }
    c.globalAlpha = 1;

    // grid + tick labels
    c.font = FONT;
    c.strokeStyle = '#19203a'; c.lineWidth = 1;
    c.fillStyle = '#69728f'; c.textAlign = 'center'; c.textBaseline = 'top';
    for (const [v, lab] of V_TICKS) {
      const x = xPix(v);
      c.beginPath(); c.moveTo(x, M.t); c.lineTo(x, h - M.b); c.stroke();
      c.fillText(lab, x, h - M.b + 7);
    }
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (const [ix, lab] of I_TICKS) {
      const y = yPix(ix);
      c.beginPath(); c.moveTo(M.l, y); c.lineTo(w - M.r, y); c.stroke();
      c.fillText(lab, M.l - 7, y);
    }

    // axis captions
    c.fillStyle = '#828bab'; c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillText('escape velocity (km/s)  ·  how tightly a world grips its air  →', (M.l + w - M.r) / 2, h - 2);
    c.save();
    c.translate(12, (M.t + h - M.b) / 2); c.rotate(-Math.PI / 2);
    c.fillText('lifetime XUV received (Earth = 1)  →', 0, 0);
    c.restore();

    // which side is which (per the shoreline hypothesis — not a claim)
    c.fillStyle = '#69728f';
    c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText('XUV wins → air stripped (model)', M.l + 10, M.t + 8);
    c.textAlign = 'right'; c.textBaseline = 'bottom';
    c.fillText('gravity wins → air kept (model)', w - M.r - 10, h - M.b - 10);

    // all catalog planets — one dim tone so the verdict overlay stays legible
    const cat: SPt[] = [];
    c.fillStyle = '#aab3d4'; c.globalAlpha = 0.1;
    for (const p of ptsRef.current) {
      if (p.v) continue;  // drawn (and hit-tested) as overlay below
      const x = xPix(p.ve), y = yPix(boosted(p));
      c.beginPath(); c.arc(x, y, 1.6, 0, 6.2832); c.fill();
      cat.push({ x, y, w: p.w });
    }
    c.globalAlpha = 1;
    catRef.current = cat;

    // shoreline lines (clipped to the plot area), labeled along their slope
    c.save();
    c.beginPath(); c.rect(M.l, M.t, w - M.l - M.r, h - M.t - M.b); c.clip();
    for (const ln of LINES) {
      if (!lineOnRef.current[ln.id]) continue;
      const yAt = (lv: number) => yPix(10 ** (ln.slope * lv + ln.icept));
      const lv1 = L10(VMIN), lv2 = L10(VMAX);
      const x1 = xPix(VMIN), x2 = xPix(VMAX);
      c.strokeStyle = ln.color; c.globalAlpha = 0.75; c.lineWidth = 1.4;
      c.setLineDash([6, 4]);
      c.beginPath(); c.moveTo(x1, yAt(lv1)); c.lineTo(x2, yAt(lv2)); c.stroke();
      c.setLineDash([]);
      // label at ~2/3 of the visible run, rotated to sit on the line
      const lvTop = (L10(IMAX) - ln.icept) / ln.slope;  // where it exits the top
      const la = lv1, lb = Math.min(lv2, lvTop);
      const lm = la + (lb - la) * 0.66;
      const px = xPix(10 ** lm), py = yAt(lm);
      const ang = Math.atan2(yAt(lm + 0.01) - py, xPix(10 ** (lm + 0.01)) - px);
      c.save();
      c.translate(px, py); c.rotate(ang);
      c.fillStyle = ln.color; c.globalAlpha = 0.95;
      c.textAlign = 'center'; c.textBaseline = 'bottom';
      c.fillText(ln.short, 0, -5);
      c.restore();
      c.globalAlpha = 1;
    }
    c.restore();

    const top: SPt[] = [];

    // Solar System anchors — hollow, labeled
    c.font = FONT; c.lineWidth = 1.5; c.strokeStyle = '#cfd8ff'; c.fillStyle = '#cfd8ff';
    for (const a of ANCHORS) {
      const x = xPix(a.ve), y = yPix(a.ix);
      c.beginPath(); c.arc(x, y, 4.5, 0, 6.2832); c.stroke();
      c.textAlign = 'center'; c.textBaseline = a.dy < 0 ? 'bottom' : 'top';
      c.fillText(a.name, x, y + a.dy + (a.dy < 0 ? 1 : -1));
      top.push({ x, y, a });
    }

    // JWST-verdict planets — larger, ringed, colored by verdict
    for (const p of ptsRef.current) {
      if (!p.v) continue;
      const x = xPix(p.ve), y = yPix(boosted(p));
      c.fillStyle = verdictMeta(p.v.verdict).color;
      c.beginPath(); c.arc(x, y, 5.5, 0, 6.2832); c.fill();
      c.strokeStyle = 'rgba(255, 255, 255, 0.85)'; c.lineWidth = 1.25;
      c.beginPath(); c.arc(x, y, 5.5, 0, 6.2832); c.stroke();
      top.push({ x, y, w: p.w, v: p.v });
    }
    topRef.current = top;
  }

  function paint() {
    const cv = canvasRef.current, base = baseRef.current;
    const { w, h, dpr } = sizeRef.current;
    if (!cv || !base || w === 0) return;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(base, 0, 0, w, h);

    const ring = (x: number, y: number, r: number, lw: number) => {
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.stroke();
    };
    const sel = selectedRef.current;
    if (sel) {
      const sp = topRef.current.find((p) => p.w?.name === sel.name)
        ?? catRef.current.find((p) => p.w?.name === sel.name);
      if (sp) ring(sp.x, sp.y, (sp.v ? 5.5 : 1.6) + 4, 2);
    }
    const hv = hoverRef.current;
    if (hv) ring(hv.pt.x, hv.pt.y, (hv.pt.v || hv.pt.a ? 5 : 1.6) + 3, 1.5);
  }

  // size / resize (DPR-aware; no animation, so reduced-motion is moot)
  useEffect(() => {
    const measure = () => {
      const el = wrapRef.current; if (!el) return;
      const w = el.clientWidth, h = el.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cv = canvasRef.current!;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      sizeRef.current = { w, h, dpr };
      drawBase(); paint();
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { drawBase(); paint(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [pts, lineOn, mBoost]);
  useEffect(() => { paint(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [selected, hover]);

  function onMove(e: React.MouseEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    // tier 1: verdict planets + anchors get a wider grab radius
    let best: SPt | null = null, bd = 196;
    for (const p of topRef.current) {
      const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) {
      bd = 100;
      for (const p of catRef.current) {
        const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
        if (d < bd) { bd = d; best = p; }
      }
    }
    setHover(best ? { pt: best, mx, my } : null);
  }

  const tip = hover ? (() => {
    const { w } = sizeRef.current;
    const wide = !!hover.pt.v;
    const tw = wide ? 320 : 230;
    const left = hover.mx > w - tw - 10 ? hover.mx - tw + 6 : hover.mx + 14;
    const p = hover.pt;
    return (
      <div className={`tooltip${wide ? ' shore-wide' : ''}`} style={{ left, top: Math.max(6, hover.my - 10) }}>
        {p.v ? (
          <>
            <div className="tn">{p.w!.name}</div>
            <div className="td">
              <b style={{ color: verdictMeta(p.v.verdict).color }}>{verdictMeta(p.v.verdict).label}</b> · {p.v.year}<br />
              {p.v.basis}<br />
              click to open
            </div>
          </>
        ) : p.a ? (
          <>
            <div className="tn">{p.a.name}</div>
            <div className="td">Solar System anchor · v<sub>esc</sub> {n(p.a.ve)} km/s · XUV ≈ {fmtI(p.a.ix)}× Earth</div>
          </>
        ) : (
          <>
            <div className="tn">{p.w!.name}</div>
            <div className="td">
              v<sub>esc</sub> ≈ {n(11.186 * Math.sqrt(p.w!.mass! / p.w!.radius!), 1)} km/s ·
              XUV ≈ {fmtI((() => { const d = ptsRef.current.find((q) => q.w === p.w); return d ? boosted(d) : 0; })())}× Earth<br />
              click to open
            </div>
          </>
        )}
      </div>
    );
  })() : null;

  return (
    <div className="shoreline">
      <div className="shore-controls">
        {LINES.map((ln) => (
          <label className="shore-check" key={ln.id}>
            <input
              type="checkbox"
              checked={lineOn[ln.id]}
              onChange={(e) => setLineOn({ ...lineOn, [ln.id]: e.target.checked })}
            />
            <i className="lsw" style={{ background: ln.color }} />{ln.short}
          </label>
        ))}
        <label className="shore-check">
          <input type="checkbox" checked={mBoost} onChange={(e) => setMBoost(e.target.checked)} />
          M-dwarf XUV ×{MDWARF_MULT} <span className="hint">(hosts &lt; {MDWARF_TEFF.toLocaleString()} K · Pass+ 2025)</span>
        </label>
        {/* keyboard-reachable path to the verdict planets */}
        <select
          className="shore-select"
          aria-label="Jump to a JWST-verdict planet"
          value={selected && verdictOf.has(selected.name) ? selected.name : ''}
          onChange={(e) => { const w = pts.find((p) => p.w.name === e.target.value)?.w; if (w) onSelect(w); }}
        >
          <option value="">JWST verdicts…</option>
          {verdictPts.map((p) => (
            <option key={p.w.name} value={p.w.name}>{p.w.name} — {verdictMeta(p.v!.verdict).label}</option>
          ))}
        </select>
      </div>

      <div className="mapwrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          style={{ cursor: hover?.pt.w ? 'pointer' : 'crosshair' }}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          onClick={() => { if (hover?.pt.w) onSelect(hover.pt.w); }}
        />
        {tip}
      </div>

      <div className="legend shore-legend">
        {Object.entries(VERDICT_META).map(([k, m]) => (
          <span key={k}><span className="sw vd" style={{ background: m.color }} />{m.label} ({counts[k] ?? 0})</span>
        ))}
        <span><span className="sw hollow" />Solar System</span>
        <span style={{ color: '#69728f' }}>· dim dots = {pts.length.toLocaleString()} catalog worlds</span>
      </div>

      <p className="shore-foot">
        Shorelines: {verdictData.shorelines.map((s) => s.citation).join(' · ')}. XUV scaling &amp; M-dwarf ×{MDWARF_MULT}: {verdictData.xuv_scaling.citation}.
        Verdicts curated from the primary literature — single-eclipse results are provisional.
        Escape velocity from best-available mass — heavily model-dependent for many small planets.
        L/L☉ estimated from star radius + temperature (the catalog lists no luminosity).
        The shoreline is a hypothesis under active test, not a habitability claim.
      </p>
    </div>
  );
}
