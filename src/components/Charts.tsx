import { useMemo } from 'react';
import type { World } from '../types';
import { tempColor } from '../lib/util';

const ACCENT = '#6fa8ff';

interface Tick { at: number; label: string; }

// Vertical bar chart (counts). viewBox keeps text crisp; width scales to the card.
function VBars({ values, colorAt, ticks, max }: { values: number[]; colorAt?: (i: number) => string; ticks: Tick[]; max?: number }) {
  const W = 400, H = 150, pL = 36, pB = 20, pT = 10, pR = 6;
  const plotW = W - pL - pR, plotH = H - pT - pB;
  const m = Math.max(1, max ?? Math.max(...values));
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

// Horizontal bar chart (labeled categories).
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

export default function Charts({ worlds }: { worlds: World[] }) {
  const d = useMemo(() => {
    const minY = 1992, maxY = 2026;
    const years = new Array(maxY - minY + 1).fill(0);
    const rMin = Math.log10(0.3), rMax = Math.log10(30), rBins = 26;
    const radius = new Array(rBins).fill(0);
    const tStep = 150, tCount = 20;            // 0..3000 K, plus an overflow bucket
    const temp = new Array(tCount + 1).fill(0);
    const methods: Record<string, number> = {};
    for (const w of worlds) {
      if (w.year != null && w.year >= minY && w.year <= maxY) years[w.year - minY]++;
      if (w.radius != null) {
        const lr = Math.log10(Math.min(30, Math.max(0.3, w.radius)));
        let bi = Math.floor(((lr - rMin) / (rMax - rMin)) * rBins);
        bi = Math.max(0, Math.min(rBins - 1, bi));
        radius[bi]++;
      }
      if (w.teq != null) temp[Math.min(tCount, Math.floor(w.teq / tStep))]++;
      if (w.method) methods[w.method] = (methods[w.method] || 0) + 1;
    }
    return { minY, maxY, years, rMin, rMax, rBins, radius, tStep, tCount, temp, methodArr: Object.entries(methods).sort((a, b) => b[1] - a[1]) as [string, number][] };
  }, [worlds]);

  const yearTicks: Tick[] = [];
  for (let y = 1995; y <= d.maxY; y += 5) yearTicks.push({ at: y - d.minY, label: `${y}` });

  // radius axis ticks mapped to log-bin positions
  const rBinOf = (r: number) => Math.round(((Math.log10(r) - d.rMin) / (d.rMax - d.rMin)) * d.rBins);
  const radiusTicks: Tick[] = [[0.5, '0.5'], [1, '1'], [2, '2'], [4, '4'], [11, '11'], [30, '30']].map(([r, l]) => ({ at: rBinOf(r as number), label: l as string }));

  const tempTicks: Tick[] = [[0, '0'], [4, '600'], [8, '1,200'], [13, '2,000'], [20, '3,000+']].map(([at, label]) => ({ at: at as number, label: label as string }));

  return (
    <div className="charts">
      <div className="chartcard">
        <h3>Discoveries per year</h3>
        <VBars values={d.years} ticks={yearTicks} />
        <p>How many of the worlds shown were found each year. The big jumps come from NASA's Kepler (≈2014–16) and TESS missions, which spotted many at once.</p>
      </div>

      <div className="chartcard">
        <h3>How big the worlds are</h3>
        <VBars values={d.radius} ticks={radiusTicks} />
        <p>Planet size vs Earth (log scale), from rocky on the left to giant on the right. Astronomers see a curious dip near 1.5–2× Earth — the "radius valley".</p>
      </div>

      <div className="chartcard">
        <h3>How hot the worlds are</h3>
        <VBars values={d.temp} ticks={tempTicks} colorAt={(i) => tempColor(i >= d.tCount ? 3500 : i * d.tStep + d.tStep / 2)} />
        <p>Equilibrium temperature in kelvin, colored from frozen to scorching. Planets hugging their stars are easiest to detect, so hot worlds are over-represented.</p>
      </div>

      <div className="chartcard">
        <h3>How they were discovered</h3>
        <HBars rows={d.methodArr} />
        <p>The "transit" method — watching a star dim slightly as a planet crosses in front of it — has found the great majority of known worlds.</p>
      </div>
    </div>
  );
}
