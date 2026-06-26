import { useMemo } from 'react';
import type { TwWorld } from './ThousandWorlds';

const ACCENT = '#6fa8ff';
function tColor(t: number): string {
  if (t < 240) return '#6fa8ff';
  if (t < 273) return '#7fcfe6';
  if (t < 320) return '#46d49a';
  if (t < 373) return '#f0b24a';
  return '#e24b4a';
}
const GCM_SHORT: Record<string, string> = { exoplasim: 'ExoPlaSim', um: 'Met Office UM', exocam: 'ExoCAM', 'exocam-pre2022': 'ExoCAM ’21', lfric: 'LFRic' };

interface Tick { at: number; label: string; }

function VBars({ values, colorAt, ticks }: { values: number[]; colorAt?: (i: number) => string; ticks: Tick[] }) {
  const W = 400, H = 150, pL = 36, pB = 20, pT = 10, pR = 6;
  const plotW = W - pL - pR, plotH = H - pT - pB;
  const m = Math.max(1, ...values);
  const bw = plotW / values.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} role="img">
      <line x1={pL} y1={pT + plotH} x2={W - pR} y2={pT + plotH} stroke="#232b45" strokeWidth="1" />
      <text x={pL - 5} y={pT + 4} fill="#69728f" fontSize="10" textAnchor="end">{m.toLocaleString()}</text>
      <text x={pL - 5} y={pT + plotH} fill="#69728f" fontSize="10" textAnchor="end">0</text>
      {values.map((v, i) => {
        const h = (v / m) * plotH;
        return <rect key={i} x={pL + i * bw + bw * 0.08} y={pT + plotH - h} width={bw * 0.84} height={h} fill={colorAt ? colorAt(i) : ACCENT} rx="0.5" />;
      })}
      {ticks.map((t, i) => (
        <text key={i} x={pL + (t.at + 0.5) * bw} y={H - 6} fill="#828bab" fontSize="10" textAnchor="middle">{t.label}</text>
      ))}
    </svg>
  );
}

function HBars({ rows }: { rows: [string, number][] }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="hbars">
      {rows.map(([label, count]) => (
        <div className="hbar" key={label}>
          <span className="hl">{label}</span>
          <span className="ht"><i style={{ width: `${(count / max) * 100}%` }} /></span>
          <span className="hc">{count.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export default function TwCharts({ worlds }: { worlds: TwWorld[] }) {
  const d = useMemo(() => {
    const tMin = 150, tMax = 420, tBins = 18;
    const temp = new Array(tBins).fill(0);
    const fMin = 400, fMax = 3150, fBins = 18;
    const flux = new Array(fBins).fill(0);
    const pMin = Math.log10(0.1), pMax = Math.log10(12), pBins = 16;
    const pres = new Array(pBins).fill(0);
    const gcm: Record<string, number> = {};
    const bin = (v: number, lo: number, hi: number, n: number) => Math.max(0, Math.min(n - 1, Math.floor(((v - lo) / (hi - lo)) * n)));
    for (const w of worlds) {
      temp[bin(w.tsurf, tMin, tMax, tBins)]++;
      flux[bin(w.flux, fMin, fMax, fBins)]++;
      if (w.pressure != null) pres[bin(Math.log10(Math.max(0.1, Math.min(12, w.pressure))), pMin, pMax, pBins)]++;
      gcm[w.gcm] = (gcm[w.gcm] || 0) + 1;
    }
    return { tMin, tMax, tBins, temp, fMin, fMax, fBins, flux, pMin, pMax, pBins, pres, gcmArr: Object.entries(gcm).sort((a, b) => b[1] - a[1]).map(([k, v]) => [GCM_SHORT[k] ?? k, v] as [string, number]) };
  }, [worlds]);

  const tAt = (k: number) => Math.round(((k - d.tMin) / (d.tMax - d.tMin)) * d.tBins);
  const tempTicks: Tick[] = [[150, '150'], [240, 'frozen'], [320, 'temp.'], [373, 'hot'], [420, '420+']].map(([k, l]) => ({ at: tAt(k as number), label: l as string }));
  const fAt = (k: number) => Math.round(((k - d.fMin) / (d.fMax - d.fMin)) * d.fBins);
  const fluxTicks: Tick[] = [[400, '400'], [1361, 'Earth'], [2000, '2,000'], [3000, '3,000']].map(([k, l]) => ({ at: fAt(k as number), label: l as string }));
  const pAt = (k: number) => Math.round(((Math.log10(k) - d.pMin) / (d.pMax - d.pMin)) * d.pBins);
  const presTicks: Tick[] = [[0.1, '0.1'], [1, '1'], [3, '3'], [12, '12']].map(([k, l]) => ({ at: pAt(k as number), label: l as string }));

  return (
    <div className="charts">
      <div className="chartcard">
        <h3>Surface temperature</h3>
        <VBars values={d.temp} ticks={tempTicks} colorAt={(i) => tColor(d.tMin + ((i + 0.5) / d.tBins) * (d.tMax - d.tMin))} />
        <p>The global-mean surface temperature the models produced (kelvin), frozen → temperate → scorching. This is what the benchmark is trying to predict.</p>
      </div>

      <div className="chartcard">
        <h3>Starlight (stellar flux)</h3>
        <VBars values={d.flux} ticks={fluxTicks} />
        <p>How much starlight each simulated planet receives (W/m²). Earth gets ≈1,361 — many of these worlds get more.</p>
      </div>

      <div className="chartcard">
        <h3>Surface pressure</h3>
        <VBars values={d.pres} ticks={presTicks} />
        <p>The assumed atmosphere thickness (bar, log scale). Thicker air traps more heat — one of the inputs the models sweep over.</p>
      </div>

      <div className="chartcard">
        <h3>Which climate model</h3>
        <HBars rows={d.gcmArr} />
        <p>How many simulations each global climate model (GCM) contributed. ExoPlaSim is fast, so it ran the most; the others are higher-fidelity.</p>
      </div>
    </div>
  );
}
