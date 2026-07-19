// ---------------------------------------------------------------------------
// simcatalog.ts — the TRUTH side of the credibility story: the benchmark's
// 1,659 real simulations, loaded once (module-level promise cache) from the
// Explorer's own public assets:
//   thousandworlds.json       per-sim scalars (params + area-weighted climate means)
//   thousandworlds-meta.json  ranges, gcm census, and the packed-field spec
//   tw-surface.u8.gz          uint8 truth surface-T fields; row i ↔ sims[i]
// Fields are packed 0 = missing, 1..255 linear over the dataset's FIXED
// kRange (meta.field.kRange). NOTE: Prediction.field packs over its own
// per-prediction kRange, so truth and prediction bytes are NOT byte-comparable
// — compare in decoded Kelvin (truthField() already returns Kelvin). (Synced
// from the private emulator repo's simcatalog.ts, adapted to the Explorer's
// asset names.)
// ---------------------------------------------------------------------------

import type { BuildParams } from './emuConstants';
import { GCM_LABELS } from './emuConstants';
import { fetchBinary } from './util';

/** One benchmark simulation row (thousandworlds.json). Shape mirrors the
 *  ThousandWorlds tab's TwWorld exactly (so TwWorld[] is assignable). Param
 *  scalars are in the SAME units as BuildParams (see simInputs); tsurf/asr/
 *  olr/cloud are area-weighted global means of time-averaged GCM output. */
export interface SimWorld {
  sid: number; planet: number | null; gcm: string;   // gcm ∈ GCM_LABELS
  radius: number | null;   // Earth radii
  gravity: number;         // m/s²
  rotation: number;        // days
  pressure: number | null; // bar
  co2: number;             // percent (mol/mol × 100)
  ch4: number;             // percent (mol/mol × 100)
  flux: number;            // W/m²
  st_teff: number;         // K
  tsurf: number;           // K — area-weighted global-mean surface temperature
  asr: number; olr: number; cloud: number;
}

export interface SimCatalog {
  sims: SimWorld[];
  grid: [number, number];    // [rows, cols] = [32, 64], equirectangular
  kRange: [number, number];  // [90, 400] K — the uint8 packing range
  /** Decode sim i's truth surface-temperature field to Kelvin: Float32Array of
   *  rows×cols (NaN where the GCM had no value). null if i is out of range or
   *  the row is entirely missing. */
  truthField: (i: number) => Float32Array | null;
}

const BASE = `${import.meta.env.BASE_URL ?? '/'}`;
const grab = (f: string) => fetch(BASE + f).then((r) => { if (!r.ok) throw new Error(f); return r; });

async function loadCatalog(): Promise<SimCatalog> {
  const [sims, meta] = await Promise.all([
    grab('thousandworlds.json').then((r) => r.json()) as Promise<SimWorld[]>,
    grab('thousandworlds-meta.json').then((r) => r.json()),
  ]);
  const grid = meta.field.grid as [number, number];
  const kRange = meta.field.kRange as [number, number];
  const cells = grid[0] * grid[1];
  // fetchBinary sniffs the gzip magic bytes (some hosts transparently decode
  // Content-Encoding, others serve the .gz verbatim) — same asset ThousandWorlds
  // tab renders, so a warm HTTP cache makes this free.
  const packed = new Uint8Array(await fetchBinary(BASE + (meta.field.asset as string)));
  const [lo, hi] = kRange;
  const perQ = (hi - lo) / 254;  // K = lo + (q-1)·perQ, the pack's exact inverse
  const truthField = (i: number): Float32Array | null => {
    const off = i * cells;
    if (i < 0 || !Number.isInteger(i) || off + cells > packed.length) return null;
    const out = new Float32Array(cells);
    let any = false;
    for (let c = 0; c < cells; c++) {
      const q = packed[off + c];
      if (q === 0) out[c] = NaN;
      else { out[c] = lo + (q - 1) * perQ; any = true; }
    }
    return any ? out : null;
  };
  return { sims, grid, kRange, truthField };
}

let _cat: Promise<SimCatalog> | null = null;
/** Load the catalog once; concurrent callers share the same in-flight promise.
 *  A failed load clears the cache so a later call can retry. */
export async function loadSims(): Promise<SimCatalog> {
  return (_cat ??= loadCatalog().catch((e) => { _cat = null; throw e; }));
}

/** Map a dataset row onto the emulator's BuildParams. The dataset scalars are
 *  ALREADY in BuildParams units (thousandworlds-meta.json ranges: radius in
 *  Earth radii, pressure in bar, CO₂/CH₄ in percent, rotation in days, flux in
 *  W/m², st_teff in K) — emulator.ts rawInputVector() applies the model-unit
 *  conversions (radius→metres, bar→Pa, percent→mole fraction) itself, exactly
 *  as it does for slider input. So the mapping is a pick:
 *    st_teff→T_star · flux→F_star · radius · gravity · rotation→P_rot ·
 *    pressure→P0 · co2→CO2 · ch4→CH4
 *  Verified against the full catalog: with this mapping the emulator's
 *  area-weighted global mean lands median ≈5 K from sim.tsurf (the PCA-GBT's
 *  own fit error — it smooths, it doesn't interpolate); with unit conversions
 *  removed the median error is ~131 K, so the units are load-bearing.
 *  (radius/pressure are non-null across the multi-complete subset; ?? 1 only
 *  guards the nullable TwWorld-compatible type.) */
export function simInputs(sim: SimWorld): BuildParams {
  return {
    st_teff: sim.st_teff, flux: sim.flux, radius: sim.radius ?? 1, gravity: sim.gravity,
    rotation: sim.rotation, pressure: sim.pressure ?? 1, co2: sim.co2, ch4: sim.ch4,
  };
}

/** Index of a sim's gcm label in the model's one-hot block (−1 if unknown;
 *  emulator.ts falls back to its default GCM for out-of-range indices). */
export function gcmIndexOf(gcm: string): number {
  return GCM_LABELS.indexOf(gcm);
}
