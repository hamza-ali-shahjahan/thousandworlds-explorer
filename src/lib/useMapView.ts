import { useEffect, useState } from 'react';

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
    return v === 'robinson' || v === 'globe' ? v : 'flat';
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
    try { localStorage.setItem(KEY, v); } catch { /* private mode */ }
    window.dispatchEvent(new CustomEvent(EVT, { detail: v }));
  };
  return [view, pick];
}
