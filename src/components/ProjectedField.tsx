import { useEffect, useMemo, useRef } from 'react';
import './ProjectedField.css';
import { climateRgb } from '../lib/climate';
import { KX, robinsonAB, invLatFromY, fitRobinson, drawGraticule } from '../lib/robinson';

// Projected views of the same 32x64 surface-temperature field SurfaceMap shows flat:
// 'robinson' — the pseudo-cylindrical oval with graticule + lat/lon ticks, and
// 'globe' — an orthographic sphere with drag-to-spin. Pure dataset visualization:
// per-pixel inverse projection + nearest-neighbour sampling (the honest pixel look,
// no smoothing), colored with the site-wide continuous climate ramp (lib/climate.ts),
// anchored on the scatter dots' regime hues. Substellar (lon 0) is the center
// column — the sims are tidally locked — so the terminator sits on the lon ±90°
// great circle.

const DEG = Math.PI / 180;
const SPIN_RATE = 9 * DEG;                    // auto-spin ~40 s/rev — ambient, not distracting
const SENTINEL_RGB = [16, 20, 34] as const;   // missing cells: SurfaceMap's near-background dark

export default function ProjectedField({ data, row, grid, kRange, view, size = 'hero' }: {
  data: Uint8Array;
  row: number;
  grid: [number, number];
  kRange: [number, number];
  view: 'robinson' | 'globe';
  size?: 'thumb' | 'hero';
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Decode the row's packed bytes once per row: u8 → kelvin (sentinel 0 = missing)
  // → ramp RGB per grid cell. Both projections then just index, so the per-pixel
  // loops stay cheap enough for the globe's 60fps redraw.
  const cellRgb = useMemo(() => {
    const [rows, cols] = grid;
    const [lo, hi] = kRange;
    const off = row * rows * cols;
    const rgb = new Uint8Array(rows * cols * 3);
    for (let i = 0; i < rows * cols; i++) {
      const u = data[off + i];
      rgb.set(u === 0 ? SENTINEL_RGB : climateRgb(lo + ((u - 1) / 254) * (hi - lo)), i * 3);
    }
    return rgb;
  }, [data, row, grid, kRange]);

  useEffect(() => {
    const wrap = wrapRef.current, cv = canvasRef.current;
    if (!wrap || !cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const g = ctx; // non-null binding for closures
    const [rows, cols] = grid;
    const rgb = cellRgb;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // clientWidth/Height, not getBoundingClientRect: the hero card may still be
    // mid-FLIP (scaled) when a saved preference mounts us with the modal.
    const boxW = wrap.clientWidth || 600, boxH = wrap.clientHeight || 300;

    if (view === 'robinson') {
      const W = Math.max(2, Math.round(boxW * dpr));
      const H = Math.max(2, Math.round(boxH * dpr));
      cv.width = W; cv.height = H;
      cv.style.width = '100%'; cv.style.height = '100%';
      g.imageSmoothingEnabled = false; // honest pixels (sampling is per-pixel anyway)
      // Margins leave room for the tick labels (lat left, lon under the pole line).
      const m = { l: Math.round(W * 0.055), r: Math.round(W * 0.013), t: Math.round(H * 0.02), b: Math.round(H * 0.05) };
      const fit = fitRobinson(W, H, m);
      const { sx, sy, cx, cy, yMax } = fit;
      // Inverse-project each output pixel to (lat, lon), nearest-neighbour sample
      // the grid. Outside the oval stays transparent.
      const img = g.createImageData(W, H);
      for (let py = 0; py < H; py++) {
        const yNorm = (cy - py) / sy / yMax;
        if (yNorm > 1 || yNorm < -1) continue;
        const latDeg = invLatFromY(yNorm);
        const [aa] = robinsonAB(latDeg);
        const gi = Math.min(rows - 1, Math.max(0, Math.floor((90 - latDeg) / 180 * rows)));
        for (let px = 0; px < W; px++) {
          const lonRad = ((px - cx) / sx) / (KX * aa); // invert x = KX·aa·lon
          if (lonRad < -Math.PI || lonRad > Math.PI) continue;
          const gj = Math.min(cols - 1, Math.max(0, Math.floor((lonRad + Math.PI) / (2 * Math.PI) * cols)));
          const c = (gi * cols + gj) * 3, p = (py * W + px) * 4;
          img.data[p] = rgb[c]; img.data[p + 1] = rgb[c + 1]; img.data[p + 2] = rgb[c + 2]; img.data[p + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      drawGraticule(g, fit, { font: `${Math.max(11, Math.round(H * 0.032))}px system-ui, sans-serif` });
      return; // static view — nothing to clean up
    }

    // --- Globe: orthographic sphere, drag-to-spin + inertia, gentle auto-rotate.
    const s = Math.max(2, Math.floor(Math.min(boxW, boxH)));
    const N = Math.max(2, Math.min(760, Math.round(s * dpr))); // cap backing for fill-rate headroom
    cv.width = N; cv.height = N;
    cv.style.width = `${s}px`; cv.style.height = `${s}px`;
    const R = N / 2, cx = R, cy = R;
    const img = g.createImageData(N, N);
    const buf = img.data;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const v3 = { lon0: 0, lat0: 0 };  // view orientation (radians); lon0 spins
    let spinning = !reduce.matches;   // reduced-motion: one static frame, drag still redraws
    let vel = 0;                      // inertial spin (rad/s) after release
    let dragVel = 0;                  // low-passed velocity while dragging
    let drag: { x: number; y: number; t: number } | null = null;

    function draw() {
      const { lon0, lat0 } = v3;
      const cosLat0 = Math.cos(lat0);
      const sinLat0 = Math.sin(lat0);

      for (let py = 0; py < N; py++) {
        const yy = (cy - py) / R; // orthographic screen y → unit-sphere y (north up)
        const rowBase = py * N * 4;
        for (let px = 0; px < N; px++) {
          const xx = (px - cx) / R;
          const r2 = xx * xx + yy * yy;
          const p = rowBase + px * 4;
          if (r2 > 1) { buf[p + 3] = 0; continue; } // outside the disc
          const zz = Math.sqrt(1 - r2); // toward viewer

          // Inverse orthographic about the view center: rotate the screen vector
          // by the view latitude, read spherical coords; lon0 is a pure spin offset.
          const lat = Math.asin(yy * cosLat0 + zz * sinLat0);
          const lon = lon0 + Math.atan2(xx, zz * cosLat0 - yy * sinLat0);

          // Nearest grid cell: rows top=+90..bottom=-90, cols -180..+180, substellar center.
          let gi = Math.floor((Math.PI / 2 - lat) / Math.PI * rows);
          if (gi < 0) gi = 0; else if (gi >= rows) gi = rows - 1;
          const ln = lon - 2 * Math.PI * Math.floor((lon + Math.PI) / (2 * Math.PI)); // wrap to (-π, π]
          let gj = Math.floor((ln + Math.PI) / (2 * Math.PI) * cols);
          if (gj < 0) gj = 0; else if (gj >= cols) gj = cols - 1;

          // Limb darkening toward the edge so the sphere reads round. Cosmetic only.
          const shade = 0.62 + 0.38 * zz;
          const c = (gi * cols + gj) * 3;
          buf[p] = rgb[c] * shade;
          buf[p + 1] = rgb[c + 1] * shade;
          buf[p + 2] = rgb[c + 2] * shade;
          buf[p + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);

      // Forward projection of (lat, lon) in the current view; z > 0 faces the viewer.
      const fwd = (lat: number, lon: number) => {
        const d = lon - lon0;
        const cl = Math.cos(lat);
        const a = cl * Math.sin(d), b = Math.sin(lat), c = cl * Math.cos(d);
        return { x: cx + a * R, y: cy - (b * cosLat0 - c * sinLat0) * R, z: c * cosLat0 + b * sinLat0 };
      };

      // Terminator: the great circle 90° from substellar — meridians at lon ±90°
      // joined through the poles. Dashed, visible side only.
      g.setLineDash([5 * dpr, 4 * dpr]);
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = 1.2 * dpr;
      g.beginPath();
      let pen = false;
      const termPoint = (latDeg: number, lonRad: number) => {
        const pt = fwd(latDeg * DEG, lonRad);
        if (pt.z > 0.01) { pen ? g.lineTo(pt.x, pt.y) : g.moveTo(pt.x, pt.y); pen = true; }
        else pen = false;
      };
      for (let la = -90; la <= 90; la += 3) termPoint(la, Math.PI / 2);
      for (let la = 90; la >= -90; la -= 3) termPoint(la, -Math.PI / 2);
      g.stroke();
      g.setLineDash([]);

      // Substellar (●) / antistellar (○) markers. Labels flip toward the disc
      // centre and only show when comfortably front-facing, so they never clip
      // at the limb mid-spin.
      const label = (x: number, y: number, text: string, color: string) => {
        const left = x > cx;
        g.font = `${Math.round(11 * dpr)}px system-ui, sans-serif`;
        g.textAlign = left ? 'right' : 'left';
        g.textBaseline = 'middle';
        const tx = left ? x - 12 * dpr : x + 12 * dpr;
        g.lineWidth = 3 * dpr;
        g.strokeStyle = 'rgba(10,14,24,0.75)';
        g.strokeText(text, tx, y);
        g.fillStyle = color;
        g.fillText(text, tx, y);
      };
      const sub = fwd(0, 0);
      if (sub.z > 0.03) {
        g.fillStyle = '#ffd27f';
        g.beginPath(); g.arc(sub.x, sub.y, 3.5 * dpr, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(255,210,127,0.55)'; g.lineWidth = 1.2 * dpr;
        g.beginPath(); g.arc(sub.x, sub.y, 8 * dpr, 0, Math.PI * 2); g.stroke();
        if (sub.z > 0.35) label(sub.x, sub.y, 'substellar', 'rgba(255,214,140,0.95)');
      }
      const anti = fwd(0, Math.PI);
      if (anti.z > 0.03) {
        g.fillStyle = 'rgba(12,17,29,0.75)';
        g.beginPath(); g.arc(anti.x, anti.y, 3.5 * dpr, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(159,178,208,0.9)'; g.lineWidth = 1.4 * dpr;
        g.beginPath(); g.arc(anti.x, anti.y, 3.5 * dpr, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = 'rgba(159,178,208,0.45)'; g.lineWidth = 1.2 * dpr;
        g.beginPath(); g.arc(anti.x, anti.y, 8 * dpr, 0, Math.PI * 2); g.stroke();
        if (anti.z > 0.35) label(anti.x, anti.y, 'antistellar', 'rgba(178,196,224,0.95)');
      }
    }

    // Demand-driven rAF: the loop only self-reschedules while there is motion
    // (auto-spin or inertia). Drags redraw event-by-event, so a rapid view
    // toggle can never leave a stale loop behind — cleanup cancels the one frame.
    let raf = 0;
    let last = performance.now();
    function frame(now: number) {
      raf = 0;
      const dt = Math.min(0.05, (now - last) / 1000); // clamp resume-after-idle jumps
      last = now;
      if (!drag) {
        if (spinning) v3.lon0 += SPIN_RATE * dt;
        if (vel !== 0) {
          v3.lon0 += vel * dt;
          vel *= Math.exp(-dt * 2.4); // ~exponential glide to rest
          if (Math.abs(vel) < 0.02) vel = 0;
        }
      }
      draw();
      if (!drag && (spinning || vel !== 0)) schedule();
    }
    const schedule = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
    schedule(); // first frame — also the only one under reduced motion

    // Drag to rotate: horizontal → longitude, vertical → latitude (clamped).
    const k = Math.PI / s; // ~half-turn per canvas-width drag
    function onDown(e: PointerEvent) {
      drag = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      vel = 0; dragVel = 0;
      cv!.setPointerCapture(e.pointerId);
    }
    function onMove(e: PointerEvent) {
      if (!drag) return;
      const dLon = -(e.clientX - drag.x) * k;
      v3.lon0 += dLon;
      v3.lat0 = Math.max(-1.4, Math.min(1.4, v3.lat0 + (e.clientY - drag.y) * k));
      const dt = Math.max(1, e.timeStamp - drag.t) / 1000;
      dragVel = 0.75 * dragVel + 0.25 * (dLon / dt); // low-pass: release uses recent speed
      drag = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      schedule();
    }
    function onUp(e: PointerEvent) {
      drag = null;
      // Inertia is motion — skip it under reduced-motion.
      if (!reduce.matches) vel = Math.max(-6, Math.min(6, dragVel));
      if (cv!.hasPointerCapture(e.pointerId)) cv!.releasePointerCapture(e.pointerId);
      schedule();
    }

    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);

    const onReduce = (e: MediaQueryListEvent) => { spinning = !e.matches; if (e.matches) vel = 0; schedule(); };
    reduce.addEventListener?.('change', onReduce);

    return () => {
      cancelAnimationFrame(raf);
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('pointercancel', onUp);
      reduce.removeEventListener?.('change', onReduce);
    };
  }, [cellRgb, grid, view]);

  return (
    <div className={`projfield ${size}`} ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className={view === 'globe' ? 'globe' : ''}
        role="img"
        aria-label={view === 'globe'
          ? 'Rotating globe of surface temperature; drag to spin'
          : 'Surface temperature map (Robinson projection)'}
      />
    </div>
  );
}
