import { useEffect, useMemo, useRef, useState } from 'react';
import type { World, Meta } from './types';
import { TEMP_BANDS, band, worldsToCsv, downloadText, type BandLabel } from './lib/util';
import DiscoveryMap from './components/DiscoveryMap';
import DataTable, { type Key } from './components/DataTable';
import Charts from './components/Charts';
import Shoreline from './components/Shoreline';
import ThousandWorlds from './components/ThousandWorlds';
import ImagineLab from './components/ImagineLab';
import Sidebar, { ANY_DIST, type Filters, type PresetKey } from './components/Sidebar';
import DetailPanel from './components/DetailPanel';
import StatBar, { type View } from './components/StatBar';
import Tour from './components/Tour';
import AuthMenu from './components/AuthMenu';
import { useAuth } from './lib/auth';
import AdminDashboard from './components/AdminDashboard';
import CreationsViews from './components/CreationsViews';
import MobileNotice from './components/MobileNotice';
import { resolveStop, randomWorld, TOUR } from './lib/tour';
import { logEvent } from './lib/supabase';

const allBands = (): Set<BandLabel> => new Set(TEMP_BANDS.map((b) => b.label));
const defaultFilters = (meta: Meta): Filters => ({
  search: '', bands: allBands(), methods: new Set<string>(), distMax: ANY_DIST, hzOnly: false, yearFrom: meta.first_year,
  radius: [null, null], mass: [null, null], period: [null, null], esi: [null, null],
});

const inRange = (v: number | null, [lo, hi]: [number | null, number | null]): boolean => {
  if (lo == null && hi == null) return true;
  if (v == null) return false;
  if (lo != null && v < lo) return false;
  if (hi != null && v > hi) return false;
  return true;
};

interface UrlState { filters: Filters; view: View; preset: PresetKey | null; sortKey: Key; dir: 1 | -1; selectedName: string | null; }

function encodeState(s: UrlState, meta: Meta, allMethods: number): string {
  const p = new URLSearchParams();
  const f = s.filters;
  if (s.view !== 'map') p.set('view', s.view);
  if (s.preset && s.preset !== 'all') p.set('preset', s.preset);
  if (f.search.trim()) p.set('q', f.search.trim());
  if (f.distMax < ANY_DIST) p.set('dist', String(f.distMax));
  if (f.yearFrom > meta.first_year) p.set('year', String(f.yearFrom));
  if (f.hzOnly) p.set('hz', '1');
  if (f.bands.size < TEMP_BANDS.length) p.set('bands', [...f.bands].join(','));
  if (f.methods.size > 0 && f.methods.size < allMethods) p.set('methods', [...f.methods].join(','));
  if (hasBound(f.radius)) p.set('r', encodeBound(f.radius));
  if (hasBound(f.mass)) p.set('m', encodeBound(f.mass));
  if (hasBound(f.period)) p.set('per', encodeBound(f.period));
  if (hasBound(f.esi)) p.set('esi', encodeBound(f.esi));
  if (s.sortKey !== 'dist_ly') p.set('sort', s.sortKey);
  if (s.dir !== 1) p.set('dir', '-1');
  if (s.selectedName) p.set('sel', s.selectedName);
  const str = p.toString();
  return str ? `?${str}` : window.location.pathname;
}

function decodeState(search: string, meta: Meta): Omit<UrlState, 'filters'> & { filters: Filters } {
  const p = new URLSearchParams(search);
  const filters: Filters = {
    search: p.get('q') ?? '',
    bands: p.get('bands') ? new Set(p.get('bands')!.split(',') as BandLabel[]) : new Set(TEMP_BANDS.map((b) => b.label)),
    methods: p.get('methods') ? new Set(p.get('methods')!.split(',')) : new Set<string>(),
    distMax: p.get('dist') ? Number(p.get('dist')) : ANY_DIST,
    hzOnly: p.get('hz') === '1',
    yearFrom: p.get('year') ? Number(p.get('year')) : meta.first_year,
    radius: decodeBound(p.get('r')),
    mass: decodeBound(p.get('m')),
    period: decodeBound(p.get('per')),
    esi: decodeBound(p.get('esi')),
  };
  return {
    filters,
    view: (['map', 'table', 'charts', 'shoreline'].includes(p.get('view') ?? '') ? p.get('view') : 'map') as View,
    preset: (p.get('preset') as PresetKey) ?? 'all',
    sortKey: (p.get('sort') as Key) ?? 'dist_ly',
    dir: p.get('dir') === '-1' ? -1 : 1,
    selectedName: p.get('sel'),
  };
}

function applyFilters(worlds: World[], f: Filters, firstYear: number): World[] {
  const term = f.search.trim().toLowerCase();
  return worlds.filter((w) => {
    if (term && !(`${w.name} ${w.host ?? ''}`.toLowerCase().includes(term))) return false;
    if (f.hzOnly && !w.hz) return false;
    if (f.distMax < ANY_DIST && (w.dist_ly == null || w.dist_ly > f.distMax)) return false;
    if (f.yearFrom > firstYear && (w.year == null || w.year < f.yearFrom)) return false;
    if (f.bands.size < TEMP_BANDS.length) {
      const b = band(w.teq);
      if (!b || !f.bands.has(b)) return false;
    }
    if (f.methods.size > 0 && (!w.method || !f.methods.has(w.method))) return false;
    if (!inRange(w.radius, f.radius)) return false;
    if (!inRange(w.mass, f.mass)) return false;
    if (!inRange(w.period, f.period)) return false;
    if (!inRange(w.esi, f.esi)) return false;
    return true;
  });
}

const encodeBound = (b: [number | null, number | null]) => `${b[0] ?? ''}..${b[1] ?? ''}`;
const decodeBound = (s: string | null): [number | null, number | null] => {
  if (!s) return [null, null];
  const [lo, hi] = s.split('..');
  return [lo ? Number(lo) : null, hi ? Number(hi) : null];
};
const hasBound = (b: [number | null, number | null]) => b[0] != null || b[1] != null;

export default function App() {
  const [worlds, setWorlds] = useState<World[] | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [filters, setFilters] = useState<Filters | null>(null);
  const [activePreset, setActivePreset] = useState<PresetKey | null>('all');
  const [selected, setSelected] = useState<World | null>(null);
  const [view, setView] = useState<View>('map');
  const [sortKey, setSortKey] = useState<Key>('dist_ly');
  const [dir, setDir] = useState<1 | -1>(1);
  const [tourStop, setTourStop] = useState<number | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [dataset, setDataset] = useState<'nasa' | 'tw' | 'lab'>(() => {
    const ds = new URLSearchParams(window.location.search).get('ds');
    return ds === 'tw' || ds === 'lab' ? ds : 'nasa';
  });
  const [tourTaken, setTourTaken] = useState<boolean>(() => !!localStorage.getItem('nasa_tour_taken'));
  const { isAdmin } = useAuth(); // admin-only Emulator tab (you + Ed + Miles)

  // Anonymous usage signal: one pageview on arrival, then tab switches — enough
  // to know the site is alive and which tab people actually use (see privacy page).
  useEffect(() => {
    logEvent('pageview', {
      tab: dataset,
      ref: document.referrer ? new URL(document.referrer).hostname : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only pageview
  }, []);
  const tabLogged = useRef(false);
  useEffect(() => {
    if (!tabLogged.current) { tabLogged.current = true; return; } // arrival tab is in the pageview
    logEvent('tab', { tab: dataset });
  }, [dataset]);

  useEffect(() => {
    Promise.all([fetch('/worlds.json').then((r) => r.json()), fetch('/meta.json').then((r) => r.json())])
      .then(([w, m]: [World[], Meta]) => {
        const s = decodeState(window.location.search, m);
        setWorlds(w); setMeta(m); setFilters(s.filters); setView(s.view);
        setActivePreset(s.preset); setSortKey(s.sortKey); setDir(s.dir);
        if (s.selectedName) setSelected(w.find((x) => x.name === s.selectedName) ?? null);
      });
  }, []);

  const bandCounts = useMemo(() => {
    const c = Object.fromEntries(TEMP_BANDS.map((b) => [b.label, 0])) as Record<BandLabel, number>;
    for (const w of worlds ?? []) { const b = band(w.teq); if (b) c[b]++; }
    return c;
  }, [worlds]);

  const methodCounts = useMemo<[string, number][]>(() => {
    const m: Record<string, number> = {};
    for (const w of worlds ?? []) if (w.method) m[w.method] = (m[w.method] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [worlds]);

  const filtered = useMemo(
    () => (worlds && meta && filters ? applyFilters(worlds, filters, meta.first_year) : []),
    [worlds, meta, filters],
  );

  const stats = useMemo(() => {
    let nearest: World | null = null, earthlike: World | null = null, plottable = 0;
    for (const w of filtered) {
      if (w.period != null && w.radius != null) plottable++;
      if (w.dist_ly != null && (!nearest || w.dist_ly < nearest.dist_ly!)) nearest = w;
      if (w.esi != null && (!earthlike || w.esi > earthlike.esi!)) earthlike = w;
    }
    return { nearest, earthlike, plottable };
  }, [filtered]);

  useEffect(() => {
    if (!worlds || !meta || !filters) return;
    const q = encodeState({ filters, view, preset: activePreset, sortKey, dir, selectedName: selected?.name ?? null }, meta, methodCounts.length);
    window.history.replaceState(null, '', q);
  }, [worlds, meta, filters, view, activePreset, sortKey, dir, selected, methodCounts.length]);

  if (!worlds || !meta || !filters) {
    return <div className="loading">Charting {`6,298`} worlds…</div>;
  }

  const onSort = (k: Key) => { if (k === sortKey) setDir((dd) => (dd === 1 ? -1 : 1)); else { setSortKey(k); setDir(1); } };
  const gotoStop = (i: number) => { const r = resolveStop(i, worlds); if (!r) return; setTourStop(i); setSelected(r.world); setView('map'); };
  const startTour = () => { localStorage.setItem('nasa_tour_taken', '1'); setTourTaken(true); setFilters(defaultFilters(meta)); setActivePreset('all'); setNavOpen(false); gotoStop(0); };
  const nextStop = () => { if (tourStop == null) return; if (tourStop >= TOUR.length - 1) setTourStop(null); else gotoStop(tourStop + 1); };
  const surprise = () => { setTourStop(null); setSelected(randomWorld(worlds)); setView('map'); setNavOpen(false); };
  const update = (p: Partial<Filters>) => { setFilters((f) => ({ ...f!, ...p })); setActivePreset(null); };
  const reset = () => { setFilters(defaultFilters(meta)); setActivePreset('all'); setNavOpen(false); };
  const applyPreset = (k: PresetKey) => {
    const base = defaultFilters(meta);
    if (k === 'earth') base.hzOnly = true;
    else if (k === 'close') base.distMax = 50;
    else if (k === 'blazing') base.bands = new Set<BandLabel>(['Hot', 'Scorching']);
    else if (k === 'recent') base.yearFrom = meta.latest_year - 1;
    setFilters(base); setActivePreset(k); setNavOpen(false);
  };

  return (
    <div className="app">
      <MobileNotice />
      <AdminDashboard />
      <CreationsViews />
      <header className="topbar">
        <div className="tb-left">
          {dataset === 'nasa' && (
            <button className="navbtn" aria-label="Toggle filters" onClick={() => setNavOpen((o) => !o)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
          )}
          <span className="brand"><img className="brand-mark" src="/favicon.svg" alt="" aria-hidden="true" /><span className="brand-wm"><b>Thousand</b>Worlds<span className="brand-explorer"> Explorer</span></span></span>
        </div>
        <div className="dstoggle" role="tablist" aria-label="Dataset">
          <button className={dataset === 'nasa' ? 'on' : ''} role="tab" aria-selected={dataset === 'nasa'} onClick={() => setDataset('nasa')}>Discovered · NASA</button>
          <button className={dataset === 'tw' ? 'on' : ''} role="tab" aria-selected={dataset === 'tw'} onClick={() => setDataset('tw')}>Simulated · ThousandWorlds</button>
          <button className={dataset === 'lab' ? 'on' : ''} role="tab" aria-selected={dataset === 'lab'} onClick={() => setDataset('lab')}>Imagine · Lab</button>
        </div>
        <div className="tb-right">
          {isAdmin && (
            <a className="emulator-tab" href="/emulator" title="Climate emulator — private admin preview">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              Emulator
            </a>
          )}
          <span className="src">{dataset === 'nasa' ? `NASA Exoplanet Archive · ${meta.total.toLocaleString()} worlds` : dataset === 'lab' ? 'Imagine Lab · overlay real + simulated · honest hypotheses' : 'ThousandWorlds benchmark · 1,659 climates · CC-BY-4.0'}</span>
          <AuthMenu />
        </div>
      </header>
      {dataset === 'tw' ? <ThousandWorlds /> : dataset === 'lab' ? <ImagineLab /> : (
      <div className={`main${selected ? ' sel' : ''}${navOpen ? ' navopen' : ''}`}>
        {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
        <Sidebar
          filters={filters} update={update} meta={meta}
          bandCounts={bandCounts} methodCounts={methodCounts}
          activePreset={activePreset} onPreset={applyPreset} onReset={reset}
          onTour={startTour} onSurprise={surprise} open={navOpen} tourPulse={!tourTaken}
        />
        <div className="center">
          <StatBar
            total={meta.total} matchCount={filtered.length} plottable={stats.plottable}
            nearest={stats.nearest} earthlike={stats.earthlike} onSelect={setSelected}
            view={view} onView={setView}
            onExport={() => downloadText(`thousandworlds-${filtered.length}-worlds.csv`, worldsToCsv(filtered))}
          />
          {tourStop != null && (() => {
            const r = resolveStop(tourStop, worlds);
            return r ? <Tour index={tourStop} title={r.title} text={r.text} worldName={r.world.name} onPrev={() => { if (tourStop > 0) gotoStop(tourStop - 1); }} onNext={nextStop} onExit={() => setTourStop(null)} /> : null;
          })()}
          {view === 'map' && <DiscoveryMap all={worlds} filtered={filtered} selected={selected} onSelect={setSelected} />}
          {view === 'table' && <DataTable worlds={filtered} selected={selected} onSelect={setSelected} sortKey={sortKey} dir={dir} onSort={onSort} />}
          {view === 'charts' && <Charts worlds={filtered} />}
          {view === 'shoreline' && <Shoreline worlds={worlds} onSelect={setSelected} selected={selected} />}
        </div>
        <DetailPanel world={selected} onOpenLab={() => setDataset('lab')} />
      </div>
      )}
      <footer className="sitefoot">
        Built with <span className="foot-heart" aria-label="love">❤️</span> using{' '}
        <a href="https://github.com/hamza-ali-shahjahan/hamzaish" target="_blank" rel="noreferrer">/hamzaish</a>
        {meta?.generated && (
          <span className="foot-data"> · NASA archive data as of {new Date(meta.generated).toISOString().slice(0, 10)}</span>
        )}
      </footer>
    </div>
  );
}
