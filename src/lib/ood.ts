// ---------------------------------------------------------------------------
// ood.ts — out-of-distribution assessment in the EMULATOR'S OWN input space.
// A candidate world is standardized with the exact per-input transforms the
// model trained with (input_transform_surface_temperature.json: identity/log/
// arcsinh, then (x−mean)/std), so "distance" is measured in the space where
// the GBT actually lives. distance(p) = mean euclidean distance to the 3
// nearest of the 1,659 simulated worlds in that 8-dim standardized space.
//
// Thresholds are DATA-DRIVEN, computed once per catalog and cached: the
// leave-one-out distribution of the same statistic over the sims themselves
// (each sim's mean-of-3-NN distance to the OTHERS). Below its p90 the
// candidate is no farther from a simulation than 90% of the training worlds
// are from each other → 'in'; p90..p99 → 'edge'; beyond p99 the candidate is
// farther from every simulation than virtually any training world ever was →
// 'out' (the emulator is extrapolating). p90/p99 keep 'edge' honest (~9% of
// the training set itself would sit there) without crying wolf inside the
// densely simulated region.
// (Synced from the private emulator repo's ood.ts; adapted to the Explorer's
// lib types — BuildParams here has optional rotation/ch4, defaulted below.)
// ---------------------------------------------------------------------------

import type { BuildParams } from './emuConstants';
import { DEFAULT_P_ROT_DAYS, DEFAULT_CH4_PCT } from './emuConstants';
import type { SimWorld } from './simcatalog';
import { simInputs } from './simcatalog';

export type OodState = 'in' | 'edge' | 'out';
export interface OodNearest { sim: SimWorld; index: number; d: number }
export interface OodAssessment {
  state: OodState;
  distance: number;        // mean euclidean distance to the 3 NN (standardized space)
  nearest: OodNearest[];   // the 3 nearest simulated worlds, closest first
  thresholds: { edge: number; out: number };  // LOO p90 / p99 — for the UI tooltip
}

const K_NN = 3;
const D = 8;
const LOG_EPS = 1e-16;           // guard log(≤0), mirrors emulator.ts
const R_EARTH_M = 6_371_000;     // dataset radius is in metres

// Per-input transform specs, copied verbatim from public/emulator/
// input_transform_surface_temperature.json — frozen with the ONNX artifact
// (they only change if the model is re-exported; order = T_star, F_star,
// radius, gravity, P_rot, P0, CO2, CH4). raw() maps BuildParams (UI units)
// to the dataset units the transform expects, mirroring emulator.ts
// rawInputVector() — including the rotation/ch4 defaults for the two inputs
// the Explorer UI doesn't drive; t() is the strategy transform, then standardize.
type Xform = { raw: (p: BuildParams) => number; t: (x: number) => number; mean: number; std: number };
const idn = (x: number) => x;
const lg = (x: number) => Math.log(Math.max(x, LOG_EPS));
const XFORMS: Xform[] = [
  { raw: (p) => p.st_teff, t: idn, mean: 3949.495361328125, std: 1302.329833984375 },   // T_star   K, Z
  { raw: (p) => p.flux, t: idn, mean: 1323.3492431640625, std: 599.5604248046875 },     // F_star   W/m², Z
  { raw: (p) => p.radius * R_EARTH_M, t: idn, mean: 6319328.5, std: 817592.375 },       // radius   m, Z
  { raw: (p) => p.gravity, t: idn, mean: 9.646529197692871, std: 1.300498604774475 },   // gravity  m/s², Z
  { raw: (p) => p.rotation ?? DEFAULT_P_ROT_DAYS, t: lg, mean: 2.6673521995544434, std: 0.8358513712882996 }, // P_rot days, log-Z
  { raw: (p) => p.pressure * 1e5, t: lg, mean: 11.883866310119629, std: 1.160101294517517 },              // P0  Pa, log-Z
  { raw: (p) => Math.asinh(p.co2 / 100 / 1e-6), t: idn, mean: 5.569713115692139, std: 3.34804630279541 }, // CO2 mol/mol, arcsinh-Z (s=1e-6)
  { raw: (p) => Math.asinh((p.ch4 ?? DEFAULT_CH4_PCT) / 100 / 1e-8), t: idn, mean: 0.9265427589416504, std: 3.1482772827148438 }, // CH4 mol/mol, arcsinh-Z (s=1e-8)
];

/** The 8 standardized coordinates of a world (the GBT's input space, no GCM one-hot). */
function stdVector(p: BuildParams): Float64Array {
  const v = new Float64Array(D);
  for (let i = 0; i < D; i++) { const s = XFORMS[i]; v[i] = (s.t(s.raw(p)) - s.mean) / s.std; }
  return v;
}

/** Insert d into the ascending k-smallest buffers (distances + matching indices). */
function insertNN(bd: Float64Array, bi: Int32Array, d: number, j: number): void {
  if (d >= bd[bd.length - 1]) return;
  let i = bd.length - 1;
  while (i > 0 && bd[i - 1] > d) { bd[i] = bd[i - 1]; bi[i] = bi[i - 1]; i--; }
  bd[i] = d; bi[i] = j;
}

// Per-catalog cache (keyed by the sims array identity): the standardized
// n×8 matrix + the LOO thresholds. Computed once — the LOO pass is O(n²·8)
// ≈ 22M mults for 1,659 sims, a few ms.
type Space = { X: Float64Array; edge: number; out: number };
const _spaces = new WeakMap<SimWorld[], Space>();

function spaceOf(sims: SimWorld[]): Space {
  const hit = _spaces.get(sims);
  if (hit) return hit;
  const n = sims.length;
  const X = new Float64Array(n * D);
  for (let i = 0; i < n; i++) X.set(stdVector(simInputs(sims[i])), i * D);
  const k = Math.min(K_NN, Math.max(1, n - 1));
  const loo = new Float64Array(n);
  const bd = new Float64Array(k), bi = new Int32Array(k);
  for (let i = 0; i < n; i++) {
    bd.fill(Infinity);
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      let d2 = 0;
      for (let c = 0; c < D; c++) { const dd = X[i * D + c] - X[j * D + c]; d2 += dd * dd; }
      insertNN(bd, bi, Math.sqrt(d2), j);
    }
    let s = 0; for (let c = 0; c < k; c++) s += bd[c];
    loo[i] = s / k;
  }
  const sorted = Array.from(loo).sort((a, b) => a - b);
  const pct = (q: number) => sorted[Math.min(n - 1, Math.round(q * (n - 1)))];
  const sp: Space = { X, edge: pct(0.90), out: pct(0.99) };
  _spaces.set(sims, sp);
  return sp;
}

/** How far the candidate world sits from the simulated worlds, and which are closest. */
export function oodAssess(p: BuildParams, sims: SimWorld[]): OodAssessment {
  const sp = spaceOf(sims);
  const v = stdVector(p);
  const n = sims.length;
  const k = Math.min(K_NN, n);
  const bd = new Float64Array(k).fill(Infinity), bi = new Int32Array(k).fill(-1);
  for (let j = 0; j < n; j++) {
    let d2 = 0;
    for (let c = 0; c < D; c++) { const dd = v[c] - sp.X[j * D + c]; d2 += dd * dd; }
    insertNN(bd, bi, Math.sqrt(d2), j);
  }
  let s = 0; for (let c = 0; c < k; c++) s += bd[c];
  const distance = s / k;
  const state: OodState = distance <= sp.edge ? 'in' : distance <= sp.out ? 'edge' : 'out';
  const nearest: OodNearest[] = [];
  for (let c = 0; c < k; c++) if (bi[c] >= 0) nearest.push({ sim: sims[bi[c]], index: bi[c], d: bd[c] });
  return { state, distance, nearest, thresholds: { edge: sp.edge, out: sp.out } };
}
