import type { Meta } from '../types';
import { TEMP_BANDS, n, type BandLabel } from '../lib/util';
import RangeFilter, { type Bound } from './RangeFilter';

export interface Filters {
  search: string;
  bands: Set<BandLabel>;
  methods: Set<string>;
  distMax: number;     // light-years; >= ANY_DIST means "no limit"
  hzOnly: boolean;
  yearFrom: number;
  radius: Bound;       // R⊕
  mass: Bound;         // M⊕
  period: Bound;       // days
  esi: Bound;          // 0..1
}

export const ANY_DIST = 30000;
const DIST_LOG_MAX = Math.log10(ANY_DIST);
const sliderToDist = (s: number) => (s >= 100 ? ANY_DIST : Math.round(Math.pow(10, (s / 100) * DIST_LOG_MAX)));
const distToSlider = (d: number) => (d >= ANY_DIST ? 100 : Math.round((Math.log10(Math.max(1, d)) / DIST_LOG_MAX) * 100));

export const PRESETS = [
  { key: 'all', label: 'All worlds' },
  { key: 'earth', label: 'Earth-like' },
  { key: 'close', label: 'Closest to us' },
  { key: 'blazing', label: 'Blazing worlds' },
  { key: 'recent', label: 'Newest finds' },
] as const;
export type PresetKey = (typeof PRESETS)[number]['key'];

interface Props {
  filters: Filters;
  update: (p: Partial<Filters>) => void;
  meta: Meta;
  bandCounts: Record<BandLabel, number>;
  methodCounts: [string, number][];
  activePreset: PresetKey | null;
  onPreset: (k: PresetKey) => void;
  onReset: () => void;
  onTour: () => void;
  onSurprise: () => void;
  open: boolean;
  tourPulse?: boolean;
}

export default function Sidebar({ filters, update, meta, bandCounts, methodCounts, activePreset, onPreset, onReset, onTour, onSurprise, open, tourPulse }: Props) {
  const toggle = <T,>(set: Set<T>, v: T): Set<T> => {
    const s = new Set(set); s.has(v) ? s.delete(v) : s.add(v); return s;
  };
  return (
    <aside className={`sidebar${open ? ' open' : ''}`}>
      <div className="starthere">
        <button className={`cta${tourPulse ? ' pulse' : ''}`} onClick={onTour}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M14.5 9.5l-1.5 4-4 1.5 1.5-4z" />
          </svg>
          New here? Take the tour
        </button>
        <button className="cta ghost" onClick={onSurprise}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7M21 16v5h-5M15 15l6 6M3 8V3h5M9 9L3 3" />
          </svg>
          Surprise me
        </button>
      </div>

      <div className="section-label">Quick views</div>
      <div className="chips">
        {PRESETS.map((p) => (
          <button key={p.key} className={`chip${activePreset === p.key ? ' active' : ''}`} onClick={() => onPreset(p.key)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="section-label">Search</div>
      <input
        className="search"
        placeholder="Planet or star name…"
        value={filters.search}
        onChange={(e) => update({ search: e.target.value })}
      />

      <div className="section-label">Refine</div>
      <label className="toggle">
        <input type="checkbox" checked={filters.hzOnly} onChange={(e) => update({ hzOnly: e.target.checked })} />
        Temperate, Earth-size only
      </label>

      <div className="slider-row">
        <div className="lab"><span>Distance</span><b>{filters.distMax >= ANY_DIST ? 'Any' : `within ${filters.distMax.toLocaleString()} ly`}</b></div>
        <input type="range" min={0} max={100} step={1} value={distToSlider(filters.distMax)} onChange={(e) => update({ distMax: sliderToDist(Number(e.target.value)) })} />
      </div>

      <div className="slider-row">
        <div className="lab"><span>Discovered since</span><b>{filters.yearFrom}</b></div>
        <input type="range" min={meta.first_year} max={meta.latest_year} step={1} value={filters.yearFrom} onChange={(e) => update({ yearFrom: Number(e.target.value) })} />
      </div>

      <div className="section-label">Size, mass &amp; orbit</div>
      <RangeFilter label="Planet size" unit="R⊕" domain={[0.3, 30]} scale="log" value={filters.radius} onChange={(v) => update({ radius: v })} fmt={(x) => n(x, 1)} />
      <RangeFilter label="Mass" unit="M⊕" domain={[0.1, 10000]} scale="log" value={filters.mass} onChange={(v) => update({ mass: v })} fmt={(x) => n(x, 1)} />
      <RangeFilter label="Year length" unit="days" domain={[0.1, 100000]} scale="log" value={filters.period} onChange={(v) => update({ period: v })} fmt={(x) => n(x, 1)} />
      <RangeFilter label="Earth-likeness" unit="" domain={[0, 1]} scale="linear" value={filters.esi} onChange={(v) => update({ esi: v })} fmt={(x) => `${Math.round(x * 100)}%`} />

      <div className="section-label">Temperature</div>
      {TEMP_BANDS.map((b) => (
        <label key={b.label} className="check">
          <input type="checkbox" checked={filters.bands.has(b.label)} onChange={() => update({ bands: toggle(filters.bands, b.label) })} />
          <span className="sw" style={{ background: b.color }} />
          {b.label}
          <span className="ct">{(bandCounts[b.label] ?? 0).toLocaleString()}</span>
        </label>
      ))}

      <div className="section-label">How they were found</div>
      {methodCounts.map(([m, ct]) => (
        <label key={m} className="check">
          <input type="checkbox" checked={filters.methods.size === 0 || filters.methods.has(m)} onChange={() => {
            const base = filters.methods.size === 0 ? new Set(methodCounts.map((x) => x[0])) : filters.methods;
            update({ methods: toggle(base, m) });
          }} />
          {m}
          <span className="ct">{ct.toLocaleString()}</span>
        </label>
      ))}

      <button className="linkbtn" onClick={onReset}>Reset all filters</button>
    </aside>
  );
}
