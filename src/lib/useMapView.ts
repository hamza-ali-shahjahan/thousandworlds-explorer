import { useEffect, useState } from 'react';
import { track } from './track';

// The site-wide map-projection preference (Flat | Robinson | Globe), remembered
// in localStorage and SYNCED across every mounted picker via a same-document
// event — so flipping the toggle in Build-a-world also flips the sim card
// docked behind it, instead of each card silently keeping the view it had
// at mount.
export type MapView = 'flat' | 'robinson' | 'globe';
const KEY = 'tw_hero_view';
const EVT = 'tw-view-pref';

export function useMapView(): [MapView, (v: MapView) => void] {
  const [view, setView] = useState<MapView>(() => {
    const v = localStorage.getItem(KEY);
    // Robinson is the site default — whole surface visible at a glance, and it's
    // the projection the benchmark's own figures use. Explicit choices stick.
    return v === 'flat' || v === 'robinson' || v === 'globe' ? v : 'robinson';
  });
  useEffect(() => {
    const on = (e: Event) => {
      const v = (e as CustomEvent).detail;
      if (v === 'flat' || v === 'robinson' || v === 'globe') setView(v);
    };
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);
  const pick = (v: MapView) => {
    setView(v);
    track('map_view_change', { view: v });
    try { localStorage.setItem(KEY, v); } catch { /* private mode */ }
    window.dispatchEvent(new CustomEvent(EVT, { detail: v }));
  };
  return [view, pick];
}
