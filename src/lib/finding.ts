// The "data test" engine behind the Imagine Lab's finding forge.
// A claim is: "worlds matching <conditions> tend to be <outcome regime>."
// We test it HONESTLY against the ThousandWorlds climate SIMULATIONS (not observations):
// filter the sims by the conditions, see what fraction land in the predicted regime, and
// report the spread + a verdict. We also count the real NASA planets that match the
// observable conditions — concrete targets a telescope could check.
import type { TwWorld } from '../components/ThousandWorlds';
import type { World } from '../types';

export const EARTH_FLUX = 1361;

export const REGIMES = ['Frozen', 'Cold', 'Temperate', 'Hot', 'Scorching'] as const;
export type Regime = (typeof REGIMES)[number];

export function regimeOf(t: number): Regime {
  if (t < 240) return 'Frozen';
  if (t < 273) return 'Cold';
  if (t < 320) return 'Temperate';
  if (t < 373) return 'Hot';
  return 'Scorching';
}

// each condition is an inclusive [lo, hi] range; absent = "any"
export interface Conditions {
  flux?: [number, number];
  radius?: [number, number];
  pressure?: [number, number];
  co2?: [number, number];
  st_teff?: [number, number];
}
const inR = (v: number | null | undefined, r?: [number, number]) => !r || (v != null && v >= r[0] && v <= r[1]);

export function matchSims(c: Conditions, sims: TwWorld[]): TwWorld[] {
  return sims.filter((s) =>
    inR(s.flux, c.flux) && inR(s.radius, c.radius) && inR(s.pressure, c.pressure) && inR(s.co2, c.co2) && inR(s.st_teff, c.st_teff));
}

// real discovered planets matching the OBSERVABLE conditions (starlight / size / star) —
// pressure & CO2 are unknown for real planets, so they don't constrain the target list.
export function matchReal(c: Conditions, nasa: World[]): World[] {
  return nasa.filter((w) =>
    w.insol != null && w.radius != null && w.st_teff != null &&
    inR(w.insol * EARTH_FLUX, c.flux) && inR(w.radius, c.radius) && inR(w.st_teff, c.st_teff));
}

const pct = (xs: number[], p: number): number => {
  if (!xs.length) return NaN;
  const a = xs.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
};

export const HIST_MIN = 150, HIST_MAX = 420, HIST_BINS = 18;
export type Verdict = 'supported' | 'mixed' | 'refuted' | 'untestable';

export interface TestResult {
  n: number;            // simulations matching the conditions
  hit: number;          // how many of those land in the predicted regime
  frac: number;         // hit / n  (0..1)
  median: number; lo: number; hi: number;  // surface-temp p50 / p10 / p90 of the matches
  hist: number[];       // surface-temp histogram of the matches (length HIST_BINS)
  verdict: Verdict;
  realTargets: World[]; // real planets matching the observable conditions
}

export function testClaim(c: Conditions, outcome: Regime, sims: TwWorld[], nasa: World[]): TestResult {
  const m = matchSims(c, sims);
  const temps = m.map((s) => s.tsurf);
  const n = m.length;
  const hit = m.reduce((k, s) => k + (regimeOf(s.tsurf) === outcome ? 1 : 0), 0);
  const frac = n ? hit / n : 0;

  const hist = new Array(HIST_BINS).fill(0);
  for (const t of temps) {
    let i = Math.floor(((t - HIST_MIN) / (HIST_MAX - HIST_MIN)) * HIST_BINS);
    i = Math.max(0, Math.min(HIST_BINS - 1, i));
    hist[i]++;
  }

  let verdict: Verdict;
  if (n < 8) verdict = 'untestable';        // too few analogous sims to mean anything
  else if (frac >= 0.6) verdict = 'supported';
  else if (frac >= 0.3) verdict = 'mixed';
  else verdict = 'refuted';

  return { n, hit, frac, median: pct(temps, 0.5), lo: pct(temps, 0.1), hi: pct(temps, 0.9), hist, verdict, realTargets: matchReal(c, nasa) };
}
