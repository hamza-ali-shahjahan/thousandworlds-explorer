import { useEffect, useMemo, useRef, useState } from 'react';
import type { World } from '../types';
import { tempColor } from '../lib/util';

// Compact, width-stable formatting so extreme values never clip in narrow columns.
const compact = (v: number | null): string => {
  if (v == null) return '—';
  const a = Math.abs(v);
  if (a >= 1000) return Math.round(v).toLocaleString();
  if (a >= 100) return `${Math.round(v)}`;
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
};

export type Key = 'name' | 'host' | 'dist_ly' | 'radius' | 'mass' | 'teq' | 'period' | 'year' | 'method' | 'esi';
interface Col { key: Key; label: string; num: boolean; w: number; }
const COLS: Col[] = [
  { key: 'name', label: 'World', num: false, w: 1.5 },
  { key: 'host', label: 'Host star', num: false, w: 1.0 },
  { key: 'dist_ly', label: 'Distance (ly)', num: true, w: 0.95 },
  { key: 'radius', label: 'Size (R⊕)', num: true, w: 0.8 },
  { key: 'mass', label: 'Mass (M⊕)', num: true, w: 0.8 },
  { key: 'teq', label: 'Temp (K)', num: true, w: 0.8 },
  { key: 'period', label: 'Year (days)', num: true, w: 0.95 },
  { key: 'year', label: 'Found', num: true, w: 0.78 },
  { key: 'method', label: 'Method', num: false, w: 1.2 },
  { key: 'esi', label: 'Earth-like', num: true, w: 0.85 },
];
const TEMPLATE = COLS.map((c) => `${c.w}fr`).join(' ');
const ROW_H = 33;

interface Props {
  worlds: World[]; selected: World | null; onSelect: (w: World) => void;
  sortKey: Key; dir: 1 | -1; onSort: (k: Key) => void;
}

export default function DataTable({ worlds, selected, onSelect, sortKey, dir, onSort }: Props) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(400);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el); setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const sorted = useMemo(() => {
    const arr = worlds.slice();
    arr.sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;           // nulls always last
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

  const cell = (w: World, k: Key) => {
    if (k === 'name') return (
      <span className="tname"><span className="cdot" style={{ background: tempColor(w.teq) }} />{w.name}</span>
    );
    if (k === 'host') return w.host ?? '—';
    if (k === 'method') return w.method ?? '—';
    if (k === 'year') return w.year ?? '—';
    if (k === 'esi') return w.esi != null ? `${Math.round(w.esi * 100)}%` : '—';
    return compact(w[k] as number | null);
  };

  return (
    <div className="tablewrap">
      <div className="txscroll">
        <div className="tinner">
          <div className="thead" style={{ gridTemplateColumns: TEMPLATE }}>
            {COLS.map((c) => (
              <button key={c.key} className={`th${c.num ? ' num' : ''}`} onClick={() => onSort(c.key)}>
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
                    key={w.name}
                    className={`trow${selected?.name === w.name ? ' sel' : ''}`}
                    style={{ top: idx * ROW_H, gridTemplateColumns: TEMPLATE }}
                    onClick={() => onSelect(w)}
                  >
                    {COLS.map((c) => (
                      <span key={c.key} className={`td${c.num ? ' num' : ''}`}>{cell(w, c.key)}</span>
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
