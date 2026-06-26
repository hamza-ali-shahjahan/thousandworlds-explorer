import { useEffect, useMemo, useRef, useState } from 'react';
import type { TwWorld } from './ThousandWorlds';

// shared surface-temp colormap (matches the Simulated tab / SurfaceMap)
function tColor(t: number): string {
  if (t < 240) return '#6fa8ff';
  if (t < 273) return '#7fcfe6';
  if (t < 320) return '#46d49a';
  if (t < 373) return '#f0b24a';
  return '#e24b4a';
}
const GCM_SHORT: Record<string, string> = { exoplasim: 'ExoPlaSim', um: 'Met Office UM', exocam: 'ExoCAM', 'exocam-pre2022': 'ExoCAM ’21', lfric: 'LFRic' };
const num = (v: number | null | undefined, d = 2): string => (v == null ? '—' : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(d));

type Key = keyof TwWorld;
interface Col { key: Key; label: string; numeric: boolean; w: number; fmt: (w: TwWorld) => string; }
const COLS: Col[] = [
  { key: 'sid', label: 'Sim #', numeric: true, w: 0.7, fmt: (w) => `${w.sid}` },
  { key: 'gcm', label: 'Model', numeric: false, w: 1.25, fmt: (w) => GCM_SHORT[w.gcm] ?? w.gcm },
  { key: 'radius', label: 'Size (R⊕)', numeric: true, w: 0.85, fmt: (w) => num(w.radius) },
  { key: 'gravity', label: 'Gravity', numeric: true, w: 0.8, fmt: (w) => num(w.gravity, 1) },
  { key: 'rotation', label: 'Rotation (d)', numeric: true, w: 0.95, fmt: (w) => num(w.rotation, 1) },
  { key: 'pressure', label: 'Pressure (bar)', numeric: true, w: 1.0, fmt: (w) => num(w.pressure) },
  { key: 'co2', label: 'CO₂ %', numeric: true, w: 0.75, fmt: (w) => num(w.co2, 1) },
  { key: 'ch4', label: 'CH₄ %', numeric: true, w: 0.75, fmt: (w) => num(w.ch4, 1) },
  { key: 'flux', label: 'Flux (W/m²)', numeric: true, w: 1.0, fmt: (w) => Math.round(w.flux).toLocaleString() },
  { key: 'st_teff', label: 'Star (K)', numeric: true, w: 0.85, fmt: (w) => Math.round(w.st_teff).toLocaleString() },
  { key: 'tsurf', label: 'Surface (K)', numeric: true, w: 1.0, fmt: (w) => `${Math.round(w.tsurf)}` },
  { key: 'asr', label: 'ASR', numeric: true, w: 0.75, fmt: (w) => num(w.asr, 0) },
  { key: 'olr', label: 'OLR', numeric: true, w: 0.75, fmt: (w) => num(w.olr, 0) },
  { key: 'cloud', label: 'Cloud %', numeric: true, w: 0.8, fmt: (w) => num(w.cloud * 100, 0) },
];
const TEMPLATE = COLS.map((c) => `${c.w}fr`).join(' ');
const ROW_H = 33;

export default function TwTable({ worlds, selected, onSelect }: { worlds: TwWorld[]; selected: TwWorld | null; onSelect: (w: TwWorld) => void }) {
  const [sortKey, setSortKey] = useState<Key>('tsurf');
  const [dir, setDir] = useState<1 | -1>(1);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(400);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el); setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const onSort = (k: Key) => { if (k === sortKey) setDir((d) => (d === 1 ? -1 : 1)); else { setSortKey(k); setDir(1); } };
  const sorted = useMemo(() => {
    const arr = worlds.slice();
    arr.sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    return arr;
  }, [worlds, sortKey, dir]);

  const total = sorted.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 8);
  const end = Math.min(total, Math.ceil((scrollTop + viewH) / ROW_H) + 8);
  const visible = sorted.slice(start, end);

  return (
    <div className="tablewrap">
      <div className="txscroll">
        <div className="tinner" style={{ minWidth: 1060 }}>
          <div className="thead" style={{ gridTemplateColumns: TEMPLATE }}>
            {COLS.map((c) => (
              <button key={c.key} className={`th${c.numeric ? ' num' : ''}`} onClick={() => onSort(c.key)}>
                {c.label}
                {sortKey === c.key && <i className={`caret ${dir === 1 ? 'up' : 'down'}`} />}
              </button>
            ))}
          </div>
          <div className="tbody" ref={bodyRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
            <div style={{ height: total * ROW_H, position: 'relative' }}>
              {visible.map((w, i) => {
                const idx = start + i;
                return (
                  <div
                    key={w.sid}
                    className={`trow${selected?.sid === w.sid ? ' sel' : ''}`}
                    style={{ top: idx * ROW_H, gridTemplateColumns: TEMPLATE }}
                    onClick={() => onSelect(w)}
                  >
                    {COLS.map((c) => (
                      <span key={c.key} className={`td${c.numeric ? ' num' : ''}`}>
                        {c.key === 'tsurf'
                          ? <span className="tname"><span className="cdot" style={{ background: tColor(w.tsurf) }} />{Math.round(w.tsurf)}</span>
                          : c.fmt(w)}
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
