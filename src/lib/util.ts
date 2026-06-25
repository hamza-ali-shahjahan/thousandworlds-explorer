import type { World } from '../types';

// Temperature bands — these double as the color legend and as a filter.
export const TEMP_BANDS = [
  { label: 'Frozen', max: 200, color: '#6fa8ff' },
  { label: 'Temperate', max: 320, color: '#46d49a' },
  { label: 'Warm', max: 800, color: '#f0b24a' },
  { label: 'Hot', max: 1500, color: '#f0805a' },
  { label: 'Scorching', max: Infinity, color: '#e24b4a' },
] as const;

export type BandLabel = (typeof TEMP_BANDS)[number]['label'];
export const UNKNOWN_COLOR = '#5b6478';

export function band(teq: number | null): BandLabel | null {
  if (teq == null) return null;
  for (const b of TEMP_BANDS) if (teq < b.max) return b.label;
  return 'Scorching';
}

export function tempColor(teq: number | null): string {
  const b = band(teq);
  if (!b) return UNKNOWN_COLOR;
  return TEMP_BANDS.find((x) => x.label === b)!.color;
}

// Round-trip safe number formatting (never leak float artifacts to the UI).
export function n(v: number | null, digits = 2): string {
  if (v == null) return '—';
  if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString();
  return Number(v.toFixed(digits)).toString();
}

export function kToC(teq: number | null): string {
  if (teq == null) return '—';
  return `${Math.round(teq - 273.15).toLocaleString()} °C`;
}

export function yearLength(periodDays: number | null): string {
  if (periodDays == null) return '—';
  if (periodDays < 1) return `${Math.round(periodDays * 24)} hours`;
  if (periodDays < 750) return `${Math.round(periodDays)} days`;
  return `${(periodDays / 365.25).toFixed(1)} Earth years`;
}

export function sizeClass(radius: number | null): string {
  if (radius == null) return 'unknown size';
  if (radius < 0.8) return 'sub-Earth';
  if (radius < 1.25) return 'Earth-size';
  if (radius < 2) return 'super-Earth';
  if (radius < 6) return 'Neptune-like';
  return 'gas giant';
}

// A friendly one-line description assembled from a world's fields.
export function describe(w: World): string {
  const size = sizeClass(w.radius);
  const heat = band(w.teq);
  const heatWord = heat ? heat.toLowerCase() : 'mysterious';
  const dist = w.dist_ly != null ? `${n(w.dist_ly)} light-years away` : 'at an unknown distance';
  const star = w.spectype ? `a ${w.spectype.trim()} star` : 'its star';
  return `A ${heatWord} ${size}, ${dist}, orbiting ${star}.`;
}

// Dot radius on the discovery map, scaled by planet size.
export function dotRadius(radius: number | null): number {
  if (radius == null) return 2.2;
  return Math.max(2, Math.min(13, 2.4 + (Math.log(radius + 1) / Math.LN2) * 2.1));
}

// Export a set of worlds to CSV (every field, with explicit, unit-labeled headers).
const CSV_COLS: [keyof World, string][] = [
  ['name', 'name'], ['host', 'host_star'], ['dist_ly', 'distance_ly'], ['radius', 'radius_earth'],
  ['mass', 'mass_earth'], ['density', 'density_g_cm3'], ['teq', 'eq_temp_K'], ['insol', 'insolation_earth'],
  ['period', 'orbital_period_days'], ['smax', 'semimajor_axis_au'], ['ecc', 'eccentricity'],
  ['year', 'discovery_year'], ['method', 'discovery_method'], ['facility', 'discovery_facility'],
  ['st_teff', 'star_temp_K'], ['spectype', 'star_spectral_type'], ['snum', 'stars_in_system'],
  ['pnum', 'planets_in_system'], ['esi', 'earth_likeness_rough'], ['hz', 'temperate_earthsize_band'],
  ['ra', 'ra_deg'], ['dec', 'dec_deg'],
];

export function worldsToCsv(rows: World[]): string {
  const esc = (v: unknown) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = CSV_COLS.map((c) => c[1]).join(',');
  const body = rows.map((w) => CSV_COLS.map(([k]) => esc(w[k])).join(',')).join('\n');
  return `${head}\n${body}`;
}

export function downloadText(filename: string, text: string, mime = 'text/csv'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
