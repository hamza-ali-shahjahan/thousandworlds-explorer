import type { World } from '../types';
import { tempColor, band, sizeClass, describe, n, kToC, yearLength } from '../lib/util';
import Term from './Term';

export default function DetailPanel({ world }: { world: World | null }) {
  if (!world) {
    return (
      <section className="detail">
        <div className="empty">
          Click any world on the map to open its profile here —<br />size, temperature, distance, orbit, and how it compares to Earth.
        </div>
      </section>
    );
  }
  const w = world;
  const esiPct = w.esi != null ? Math.round(w.esi * 100) : null;
  return (
    <section className="detail">
      <div className="dhead">
        <span className="dot" style={{ background: tempColor(w.teq) }} />
        <h2>{w.name}</h2>
      </div>
      <div className="dtype">{[band(w.teq), sizeClass(w.radius)].filter(Boolean).join(' · ')}</div>
      <p className="ddesc">{describe(w)}</p>

      <div className="grid2">
        <div className="metric"><div className="k"><Term name="distance">Distance from Earth</Term></div><div className="v">{n(w.dist_ly)}<span className="u">ly</span></div></div>
        <div className="metric"><div className="k"><Term name="size">Size vs Earth</Term></div><div className="v">{n(w.radius)}<span className="u">× radius</span></div></div>
        <div className="metric"><div className="k"><Term name="temperature">Temperature</Term></div><div className="v">{kToC(w.teq)}</div></div>
        <div className="metric"><div className="k"><Term name="year">Length of a year</Term></div><div className="v">{yearLength(w.period)}</div></div>
      </div>

      {esiPct != null && (
        <>
          <div className="section-label" style={{ marginBottom: 4 }}><Term name="esi">Earth-likeness (rough)</Term></div>
          <div className="bar"><i style={{ width: `${esiPct}%` }} /></div>
          <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 5 }}>{esiPct}% — based on size and temperature only</div>
        </>
      )}

      <div className="rows">
        <div className="r"><span className="k"><Term name="mass">Mass</Term></span><span>{n(w.mass)} × Earth</span></div>
        <div className="r"><span className="k"><Term name="orbit">Orbit radius</Term></span><span>{n(w.smax)} AU</span></div>
        <div className="r"><span className="k"><Term name="eccentricity">Orbit shape</Term></span><span>{w.ecc != null ? `${n(w.ecc)} ${w.ecc < 0.1 ? '(near-circular)' : w.ecc < 0.4 ? '(elliptical)' : '(very stretched)'}` : '—'}</span></div>
        <div className="r"><span className="k">Host star</span><span>{w.host ?? '—'}{w.spectype ? ` (${w.spectype.trim()})` : ''}</span></div>
        <div className="r"><span className="k">Planets in system</span><span>{w.pnum ?? '—'}</span></div>
        <div className="r"><span className="k">Discovered</span><span>{w.year ?? '—'} · {w.method ?? '—'}</span></div>
        <div className="r"><span className="k">Found by</span><span style={{ textAlign: 'right', maxWidth: 180 }}>{w.facility ?? '—'}</span></div>
      </div>
    </section>
  );
}
