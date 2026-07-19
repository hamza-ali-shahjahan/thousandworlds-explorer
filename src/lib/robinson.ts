// Robinson-projection math (Snyder/USGS interpolation table) for the projected
// surface-map hero views. At every 5° of latitude:
// AA = meridian half-length factor (X), BB = parallel spacing factor (Y, fraction of
// the equator-to-pole distance). Forward projection (R = 1, normalized):
//   x = 0.8487 * AA(lat) * lon      (lon in radians, -π..π)
//   y = 1.3523 * BB(lat)            (BB negative in the south)
const AA = [
  1.0000, 0.9986, 0.9954, 0.9900, 0.9822, 0.9730, 0.9600, 0.9427, 0.9216,
  0.8962, 0.8679, 0.8350, 0.7986, 0.7597, 0.7186, 0.6732, 0.6213, 0.5722,
  0.5322,
];
const BB = [
  0.0000, 0.0620, 0.1240, 0.1860, 0.2480, 0.3100, 0.3720, 0.4340, 0.4958,
  0.5571, 0.6176, 0.6769, 0.7346, 0.7903, 0.8435, 0.8936, 0.9394, 0.9761,
  1.0000,
];

export const KX = 0.8487;
export const KY = 1.3523;

// Interpolate AA/BB at an arbitrary latitude (degrees, -90..90) via the table
// (linear between 5° knots, matching the standard implementation).
export function robinsonAB(latDeg: number): [number, number] {
  const a = Math.abs(latDeg) / 5; // table index in [0,18]
  const i = Math.min(17, Math.floor(a));
  const f = a - i;
  const aa = AA[i] + (AA[i + 1] - AA[i]) * f;
  const bb = BB[i] + (BB[i + 1] - BB[i]) * f;
  return [aa, latDeg < 0 ? -bb : bb];
}

// Invert Robinson's y → latitude. Y(lat) = sign·BB(|lat|) is monotonic in lat,
// so a short bisection on |lat| recovers it to sub-pixel precision.
export function invLatFromY(yNorm: number): number {
  const target = Math.abs(yNorm);
  if (target >= 1) return yNorm < 0 ? -90 : 90;
  let lo = 0;
  let hi = 90;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    const [, bb] = robinsonAB(mid); // bb >= 0 for mid >= 0
    if (bb < target) lo = mid;
    else hi = mid;
  }
  const lat = (lo + hi) / 2;
  return yNorm < 0 ? -lat : lat;
}

// Canvas-fit helper: scale/center the oval into a W×H box with per-side margins,
// returning a projector (latDeg, lonRad) → [px, py] plus the fit parameters.
export interface RobinsonFit {
  project: (latDeg: number, lonRad: number) => [number, number];
  sx: number; sy: number; cx: number; cy: number; xMax: number; yMax: number;
}
export function fitRobinson(W: number, H: number, m: { l: number; r: number; t: number; b: number }): RobinsonFit {
  const xMax = KX * Math.PI;
  const yMax = KY;
  const sx = (W - m.l - m.r) / (2 * xMax);
  const sy = (H - m.t - m.b) / (2 * yMax);
  const cx = m.l + (W - m.l - m.r) / 2;
  const cy = m.t + (H - m.t - m.b) / 2;
  const project = (latDeg: number, lonRad: number): [number, number] => {
    const [aa, bb] = robinsonAB(latDeg);
    return [cx + KX * aa * lonRad * sx, cy - bb * yMax * sy];
  };
  return { project, sx, sy, cx, cy, xMax, yMax };
}

// Graticule + axis tick labels. Lat labels sit just left of the oval at each
// parallel; lon labels sit under the bottom pole line, where each meridian meets
// the boundary (cartopy's convention).
export function drawGraticule(g: CanvasRenderingContext2D, fit: RobinsonFit, opts?: { labels?: boolean; lineAlpha?: number; font?: string }) {
  const { project } = fit;
  const labels = opts?.labels ?? true;
  const alpha = opts?.lineAlpha ?? 0.22;
  g.save();
  g.lineWidth = 1;
  g.strokeStyle = `rgba(255,255,255,${alpha})`;
  const drawLine = (pts: [number, number][]) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
    g.stroke();
  };
  const PARALLELS = [0, 30, -30, 60, -60];
  const MERIDIANS = [0, 60, -60, 120, -120, 180, -180];
  for (const lat of PARALLELS) {
    const pts: [number, number][] = [];
    for (let l = -180; l <= 180; l += 4) pts.push(project(lat, (l * Math.PI) / 180));
    drawLine(pts);
  }
  for (const lon of MERIDIANS) {
    const pts: [number, number][] = [];
    for (let la = -90; la <= 90; la += 3) pts.push(project(la, (lon * Math.PI) / 180));
    drawLine(pts);
  }
  // Oval boundary.
  g.strokeStyle = `rgba(255,255,255,${Math.min(1, alpha + 0.12)})`;
  const edge: [number, number][] = [];
  for (let la = -90; la <= 90; la += 1.5) edge.push(project(la, Math.PI));
  for (let la = 90; la >= -90; la -= 1.5) edge.push(project(la, -Math.PI));
  edge.push(project(-90, Math.PI));
  drawLine(edge);

  if (labels) {
    // Default suits a ~1024-wide backing store; callers on DPR-scaled canvases
    // pass a font sized to theirs.
    g.fillStyle = '#dde4f0';
    g.font = opts?.font ?? '22px system-ui, sans-serif';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (const lat of PARALLELS) {
      const [x, y] = project(lat, -Math.PI); // left boundary at this parallel
      g.fillText(lat === 0 ? '0°' : `${Math.abs(lat)}°${lat > 0 ? 'N' : 'S'}`, x - 7, y);
    }
    g.textAlign = 'center';
    g.textBaseline = 'top';
    for (const lon of MERIDIANS) {
      if (lon === -180) continue; // shares the ±180 seam label
      const [x, y] = project(-90, (lon * Math.PI) / 180); // meridian's bottom end
      g.fillText(lon === 0 ? '0°' : lon === 180 ? '±180°' : `${Math.abs(lon)}°${lon > 0 ? 'E' : 'W'}`, x, y + 6);
    }
  }
  g.restore();
}
