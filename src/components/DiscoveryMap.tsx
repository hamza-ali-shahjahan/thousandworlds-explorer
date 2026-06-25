import { useEffect, useRef, useState } from 'react';
import type { World } from '../types';
import { tempColor, dotRadius, n, kToC } from '../lib/util';

const PMIN = 0.1, PMAX = 100000;   // orbital period domain (days)
const RMIN = 0.3, RMAX = 30;       // planet radius domain (Earth radii)
const L10 = Math.log10;
const M = { l: 56, r: 18, t: 16, b: 40 };
const FONT = '11px ui-sans-serif, system-ui, -apple-system, sans-serif';

const PERIOD_TICKS: [number, string][] = [
  [0.1, '0.1d'], [1, '1d'], [10, '10d'], [100, '100d'], [1000, '1,000d'], [10000, '10,000d'],
];
const RADIUS_TICKS: [number, string][] = [
  [0.5, '0.5'], [1, '1  Earth'], [2, '2'], [4, '4  Neptune'], [11, '11  Jupiter'], [30, '30'],
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface Pt { x: number; y: number; w: World; }
interface Props { all: World[]; filtered: World[]; selected: World | null; onSelect: (w: World) => void; }

export default function DiscoveryMap({ all, filtered, selected, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const ptsRef = useRef<Pt[]>([]);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });

  const allRef = useRef(all); allRef.current = all;
  const filteredRef = useRef(filtered); filteredRef.current = filtered;
  const selectedRef = useRef(selected); selectedRef.current = selected;

  const [hover, setHover] = useState<{ pt: Pt; mx: number; my: number } | null>(null);
  const hoverRef = useRef(hover); hoverRef.current = hover;

  const xPix = (p: number) => {
    const { w } = sizeRef.current;
    return M.l + (L10(clamp(p, PMIN, PMAX)) - L10(PMIN)) / (L10(PMAX) - L10(PMIN)) * (w - M.l - M.r);
  };
  const yPix = (r: number) => {
    const { h } = sizeRef.current;
    return M.t + (1 - (L10(clamp(r, RMIN, RMAX)) - L10(RMIN)) / (L10(RMAX) - L10(RMIN))) * (h - M.t - M.b);
  };

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
    let seed = 9871;
    for (let i = 0; i < 90; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const sx = (seed % 1000) / 1000 * w;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const sy = (seed % 1000) / 1000 * h;
      c.globalAlpha = (i % 6 === 0) ? 0.18 : 0.07;
      c.fillRect(sx, sy, i % 9 === 0 ? 1.4 : 0.9, i % 9 === 0 ? 1.4 : 0.9);
    }
    c.globalAlpha = 1;

    // grid + axis labels
    c.font = FONT;
    c.strokeStyle = '#19203a'; c.lineWidth = 1;
    c.fillStyle = '#69728f'; c.textAlign = 'center'; c.textBaseline = 'top';
    for (const [p, lab] of PERIOD_TICKS) {
      const x = xPix(p);
      c.beginPath(); c.moveTo(x, M.t); c.lineTo(x, h - M.b); c.stroke();
      c.fillText(lab, x, h - M.b + 7);
    }
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (const [r, lab] of RADIUS_TICKS) {
      const y = yPix(r);
      c.beginPath(); c.moveTo(M.l, y); c.lineTo(w - M.r, y); c.stroke();
      c.fillText(lab, M.l - 7, y);
    }
    // axis captions
    c.fillStyle = '#828bab'; c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillText('orbital period  ·  how long its year is  →', (M.l + w - M.r) / 2, h - 2);

    // non-matching worlds, faint
    const matchSet = new Set(filteredRef.current);
    c.globalAlpha = 0.07; c.fillStyle = '#aab3d4';
    for (const wd of allRef.current) {
      if (wd.period == null || wd.radius == null || matchSet.has(wd)) continue;
      c.beginPath(); c.arc(xPix(wd.period), yPix(wd.radius), 1.6, 0, 6.2832); c.fill();
    }
    c.globalAlpha = 1;

    // matching worlds, colored + record hit-test points
    const pts: Pt[] = [];
    for (const wd of filteredRef.current) {
      if (wd.period == null || wd.radius == null) continue;
      const x = xPix(wd.period), y = yPix(wd.radius);
      c.fillStyle = tempColor(wd.teq); c.globalAlpha = 0.82;
      c.beginPath(); c.arc(x, y, dotRadius(wd.radius), 0, 6.2832); c.fill();
      pts.push({ x, y, w: wd });
    }
    c.globalAlpha = 1;
    ptsRef.current = pts;
  }

  function paint() {
    const cv = canvasRef.current, base = baseRef.current;
    const { w, h, dpr } = sizeRef.current;
    if (!cv || !base || w === 0) return;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(base, 0, 0, w, h);

    // Earth reference marker
    const ex = xPix(365.25), ey = yPix(1);
    ctx.fillStyle = '#cfd8ff';
    ctx.beginPath(); ctx.arc(ex, ey, 4.5, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(ex, ey, 4.5, 0, 6.2832); ctx.stroke();
    ctx.font = FONT; ctx.fillStyle = '#cfd8ff'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('Earth', ex, ey - 7);

    const ring = (p: Pt, color: string, r: number, lw: number) => {
      ctx.strokeStyle = color; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.2832); ctx.stroke();
    };
    const sel = selectedRef.current;
    if (sel && sel.period != null && sel.radius != null) {
      ring({ x: xPix(sel.period), y: yPix(sel.radius), w: sel }, '#ffffff', dotRadius(sel.radius) + 4, 2);
    }
    const hv = hoverRef.current;
    if (hv) ring(hv.pt, '#ffffff', dotRadius(hv.pt.w.radius) + 3, 1.5);
  }

  // size / resize
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

  useEffect(() => { drawBase(); paint(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [all, filtered]);
  useEffect(() => { paint(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [selected, hover]);

  function onMove(e: React.MouseEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let best: Pt | null = null, bd = 100;
    for (const p of ptsRef.current) {
      const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    setHover(best ? { pt: best, mx, my } : null);
  }

  const tip = hover ? (() => {
    const { w } = sizeRef.current;
    const left = hover.mx > w - 240 ? hover.mx - 224 : hover.mx + 14;
    return (
      <div className="tooltip" style={{ left, top: Math.max(6, hover.my - 10) }}>
        <div className="tn">{hover.pt.w.name}</div>
        <div className="td">
          {n(hover.pt.w.radius)}× Earth · {kToC(hover.pt.w.teq)}<br />
          {hover.pt.w.dist_ly != null ? `${n(hover.pt.w.dist_ly)} ly away` : 'distance unknown'} · click to open
        </div>
      </div>
    );
  })() : null;

  return (
    <div className="mapwrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ cursor: hover ? 'pointer' : 'crosshair' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onClick={() => { if (hover) onSelect(hover.pt.w); }}
      />
      {tip}
      <div className="legend">
        <span><span className="sw" style={{ background: '#6fa8ff' }} />Frozen</span>
        <span><span className="sw" style={{ background: '#46d49a' }} />Temperate</span>
        <span><span className="sw" style={{ background: '#f0b24a' }} />Warm</span>
        <span><span className="sw" style={{ background: '#f0805a' }} />Hot</span>
        <span><span className="sw" style={{ background: '#e24b4a' }} />Scorching</span>
        <span><span className="sw ring" />Earth</span>
        <span style={{ color: '#69728f' }}>· dot size = planet size · vertical = size · horizontal = orbit</span>
      </div>
    </div>
  );
}
