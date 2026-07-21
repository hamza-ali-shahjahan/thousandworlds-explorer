import { useState } from 'react';
import type { World } from '../types';
import { n } from '../lib/util';
import { track } from '../lib/track';

export type View = 'map' | 'table' | 'charts' | 'shoreline';

interface Props {
  total: number;
  matchCount: number;
  plottable: number;
  nearest: World | null;
  earthlike: World | null;
  onSelect: (w: World) => void;
  view: View;
  onView: (v: View) => void;
  onExport: () => void;
}

export default function StatBar({ total, matchCount, plottable, nearest, earthlike, onSelect, view, onView, onExport }: Props) {
  const [copied, setCopied] = useState(false);
  const share = () => {
    track('share', { ds: 'nasa' });
    navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }).catch(() => {});
  };
  return (
    <div className="statbar">
      <div className="stat big">
        <div className="v">{matchCount.toLocaleString()}<span className="u">of {total.toLocaleString()}</span></div>
        <div className="k">worlds shown</div>
      </div>
      <div className="stat">
        <div className="v">{view === 'map' ? plottable.toLocaleString() : matchCount.toLocaleString()}</div>
        <div className="k">{view === 'map' ? 'plotted on map' : view === 'table' ? 'rows in table' : view === 'charts' ? 'worlds charted' : 'match filters'}</div>
      </div>
      {nearest && (
        <div className="stat" style={{ cursor: 'pointer' }} onClick={() => onSelect(nearest)}>
          <div className="v">{n(nearest.dist_ly)}<span className="u">ly · {nearest.name}</span></div>
          <div className="k">nearest in view</div>
        </div>
      )}
      {earthlike && (
        <div className="stat" style={{ cursor: 'pointer' }} onClick={() => onSelect(earthlike)}>
          <div className="v">{Math.round((earthlike.esi ?? 0) * 100)}<span className="u">% · {earthlike.name}</span></div>
          <div className="k">most Earth-like in view</div>
        </div>
      )}
      <span className="spacer" />
      <button className="btn" onClick={share} title="Copy a link to this exact view (filters, sort, selected world)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {copied
            ? <path d="M20 6L9 17l-5-5" />
            : <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></>}
        </svg>
        {copied ? 'Copied!' : 'Share'}
      </button>
      <button className="btn" onClick={onExport} title="Download the worlds currently shown as a CSV file">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
        </svg>
        CSV
      </button>
      <div className="viewtoggle" role="tablist" aria-label="View">
        {(['map', 'table', 'charts', 'shoreline'] as View[]).map((v) => (
          <button key={v} className={view === v ? 'on' : ''} role="tab" aria-selected={view === v} onClick={() => onView(v)}>
            {v[0].toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}
