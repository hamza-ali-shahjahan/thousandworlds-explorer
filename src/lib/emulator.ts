// ---------------------------------------------------------------------------
// emulator.ts — the benchmark's REAL PCA-GBT surface-temperature emulator,
// running CLIENT-SIDE in the browser (no backend). Synced from the private
// emulator repo's newer engine generation (per-GCM lens, per-asset memoised
// lazy loading, full 8-input calibration), narrowed to the assets the Explorer
// actually ships (surface temperature only — see public/emulator/).
//
// Pipeline (mirrors thousandworlds.models.pca_gbt + decode_spectral_predictions,
// collapsed for surface temperature only — verified to ~5e-4 K against the
// benchmark's own predict() path):
//   1. raw 8 planet params -> per-input transform (Z / log_Z / arcsinh_Z /
//      smoothed_logit_Z) then (x-mean)/std        -> X_std  (8,)
//   2. concat GCM one-hot (multi-complete: 5 GCMs) -> Xin    (13,)
//   3. ONNX HGBT ensemble (one tree-regressor per PPCA latent) -> z (q,)
//   4. grid(2048) = z @ G_lat^T + h @ G_trend^T + g_bias        (linear decode)
//      where h is the shared-linear-trend design row and G_lat/G_trend/g_bias
//      bake PPCA loadings * unnormalisation * symmetry-mask * inverse-SHT.
//   5. reshape 32x64, pack to uint8 over kRange — the SurfaceMap's exact format.
//
// Artifacts live in /public/emulator/ (produced by the export POC):
//   pca_gbt_surface_temperature.onnx.gz       (~1.0MB; gunzipped client-side —
//                                              the CDN won't compress octet-stream)
//   collapsed_G_lat.npy   (2048 x q  f32)
//   collapsed_G_trend.npy (2048 x P  f32)
//   collapsed_g_bias.npy  (2048      f32)
//   input_transform_surface_temperature.json  (per-input strategy + mean/std)
//   emulator_meta.json                        (latent_dim, d_in, grid, sigma...)
//
// Wired into BuildAWorld.tsx (which keeps its kNN predictField as the fallback
// when load() resolves null); the UI badge reads pred.source for honesty.
// ---------------------------------------------------------------------------

import type { BuildParams } from './emuConstants';
import { DEFAULT_P_ROT_DAYS, DEFAULT_CH4_PCT, DISAGREEMENT_GCMS } from './emuConstants';
import type { FieldMeta } from '../components/SurfaceMap';

// ASR/OLR are stored in the benchmark divided by the world's stellar flux
// (stats.asr_olr_normalize_by_f_star), so their decode yields a per-F_star ratio.
// Physical W·m⁻² = decoded × F_star, and F_star is exactly the `flux` input.
// (The Explorer doesn't ship ASR/OLR weights yet; predictField degrades to null.)
const FSTAR_FIELDS = new Set(['asr', 'olr']);

// Same shape BuildAWorld.predictField returns, so callers are interchangeable.
export interface Prediction {
  field: Uint8Array;            // 32*64 uint8 (0 = missing, 1..255 over kRange)
  mean: number; lo: number; hi: number;
  reg: string; inEnv: boolean; outOf: string[];
  n: number; d12: number;
  source: 'pca-gbt' | 'knn';    // which engine produced it (for an honest badge)
}
export interface FieldPrediction { field: Uint8Array; min: number; max: number; mean: number; }
export interface DisagreementPrediction { field: Uint8Array; min: number; max: number; mean: number; unit: string; }

type InputSpec = {
  name: string;
  strategy: 'Z-scaling' | 'log_Z-scaling' | 'arcsinh_Z-scaling' | 'smoothed_logit_Z-scaling';
  kwargs: { s?: number; epsilon?: number };
  mean: number; std: number;
};
type EmulatorMeta = {
  latent_dim: number; d_in: number; n_sim_types: number;
  grid: [number, number]; spectral_sigma: number;
  onnx_feature_order: string[];   // 13 = 8 raw inputs (T_star…CH4) then 5 gcm one-hot
  default_gcm_index: number;
};

const BASE = `${import.meta.env.BASE_URL ?? '/'}emulator/`;
const LOG_EPS = 1e-16;

// Gunzip when the buffer carries the gzip magic bytes. The .onnx.gz ships
// pre-compressed (CDNs skip octet-stream), but some servers (vite preview)
// send it Content-Encoding: gzip so it arrives already decompressed — sniff,
// don't trust the extension. Kept local so this file stays self-contained.
async function gunzipMaybe(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const b = new Uint8Array(buf);
  if (b.length > 2 && b[0] === 0x1f && b[1] === 0x8b) {
    return new Response(new Response(buf).body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  return buf;
}

// --- tiny .npy (v1, little-endian, C-order float32) reader ------------------
function parseNpyF32(buf: ArrayBuffer): { data: Float32Array; shape: number[] } {
  const bytes = new Uint8Array(buf);
  // magic \x93NUMPY, version (2 bytes), header-len (uint16 LE)
  const headLen = bytes[8] | (bytes[9] << 8);
  const header = new TextDecoder().decode(bytes.subarray(10, 10 + headLen));
  const shapeMatch = header.match(/'shape':\s*\(([^)]*)\)/);
  const shape = (shapeMatch?.[1] ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  if (!/'<f4'/.test(header)) throw new Error('emulator npy: expected little-endian float32');
  const data = new Float32Array(buf, 10 + headLen);
  return { data, shape };
}

// Asset loaders (module scope so the critical-path load and any lazy per-field
// load reuse them). The surface-temperature triplet has no suffix; a field
// `key` would live at collapsed_*_<key>.npy (not shipped in the Explorer yet).
const grab = (f: string) => fetch(BASE + f).then((r) => { if (!r.ok) throw new Error(f); return r; });
const bufOf = (f: string) => grab(f).then((r) => r.arrayBuffer());
async function loadFieldNpy(suffix: string) {
  const [l, t, b] = await Promise.all([bufOf(`collapsed_G_lat${suffix}.npy`), bufOf(`collapsed_G_trend${suffix}.npy`), bufOf(`collapsed_g_bias${suffix}.npy`)]);
  return { lat: parseNpyF32(l), trend: parseNpyF32(t), bias: parseNpyF32(b) };
}

// --- per-input transform (matches preprocessing._preprocess_array) -----------
function preprocessInput(x: number, spec: InputSpec): number {
  switch (spec.strategy) {
    case 'Z-scaling': return x;
    case 'log_Z-scaling': return Math.log(Math.max(x, spec.kwargs.epsilon ?? LOG_EPS));
    case 'arcsinh_Z-scaling': return Math.asinh(x / (spec.kwargs.s as number));
    case 'smoothed_logit_Z-scaling': {
      const e = spec.kwargs.epsilon as number;
      const sm = (x + e) / (1 + 2 * e);
      return Math.log(sm / (1 - sm));
    }
  }
}

// The benchmark's canonical input order is T_star,F_star,radius,gravity,P_rot,P0,CO2,CH4.
// Map BuildParams (UI units) onto the EXACT dataset units the model was trained on
// (calibrated against input_transform_surface_temperature.json + the raw multi-complete
// inputs; verified in the private repo bit-exact against the benchmark input pipeline,
// incl. the P_rot log and CH4 arcsinh transforms). Getting these wrong pushes inputs out
// of the simulated grid, where the trees extrapolate sharply — plausible-but-wrong with
// no error signal. rotation/ch4 have no Explorer sliders yet → in-distribution defaults.
const R_EARTH_M = 6_371_000;        // dataset radius is in METRES (median raw 6.371e6 = 1 R⊕)
function rawInputVector(p: BuildParams, names: string[]): number[] {
  const byName: Record<string, number> = {
    T_star: p.st_teff,                        // K (direct)
    F_star: p.flux,                           // W/m² (direct)
    radius: (p.radius ?? 1) * R_EARTH_M,      // Earth radii → metres
    gravity: p.gravity,                       // m/s² (direct)
    P_rot: p.rotation ?? DEFAULT_P_ROT_DAYS,  // days
    P0: (p.pressure ?? 1) * 1e5,              // bar → Pa (1 bar = 1e5 Pa; dataset P0 in Pa)
    CO2: (p.co2 ?? 0) / 100,                  // UI percent → mole fraction (dataset CO2 is mol/mol, 0..1)
    CH4: (p.ch4 ?? DEFAULT_CH4_PCT) / 100,    // UI percent → mole fraction
  };
  return names.map((nm) => byName[nm] ?? 0);
}

let _ort: typeof import('onnxruntime-web') | null = null;

export class PcaGbtEmulator {
  private session!: import('onnxruntime-web').InferenceSession;
  private meta!: EmulatorMeta;
  private inputs!: InputSpec[];
  private q!: number;
  private P!: number;
  // Per-field collapsed decode matrices. The ONNX (latents z) is field-agnostic;
  // each field is a linear decode of (z, h). The Explorer ships surface_temperature
  // only; other keys lazy-load on demand and resolve null when absent.
  private fields: Record<string, { Glat: Float32Array; Gtrend: Float32Array; gbias: Float32Array }> = {};
  /** Which extra fields (beyond surface_temperature) loaded successfully. */
  readonly extraFields: string[] = [];
  /** Per-asset memoised loaders so each predict() path awaits ONLY its own asset.
   *  Each runs at most once; a missing asset resolves (dict stays empty) so the
   *  caller degrades to null rather than throwing. */
  private loaders: Record<string, Promise<void>> = {};
  private once(key: string, fn: () => Promise<void>): Promise<void> {
    return (this.loaders[key] ??= fn().catch((e) => { console.warn('[emulator] asset load failed:', key, e); }));
  }
  private loadFieldKey(key: string) { return this.once(`f:${key}`, async () => { const f = await loadFieldNpy(`_${key}`); this.fields[key] = { Glat: f.lat.data, Gtrend: f.trend.data, gbias: f.bias.data }; this.extraFields.push(key); }); }

  /** Load ONLY what the first paint needs (ONNX + surface temperature).
   *  Returns null on any failure (caller falls back to kNN). */
  static async load(): Promise<PcaGbtEmulator | null> {
    try {
      _ort ??= await import('onnxruntime-web/wasm');   // CPU-only build → needs only ort-wasm-simd-threaded.{mjs,wasm} (no 27 MB WebGPU jsep bundle)
      _ort.env.wasm.numThreads = 1;                                      // single-threaded: no SharedArrayBuffer / COOP+COEP headers needed
      _ort.env.wasm.wasmPaths = `${import.meta.env.BASE_URL ?? '/'}ort/`; // self-hosted runtime (see vite.config.ts)
      const [metaR, inputR, onnxR] = await Promise.all([
        grab('emulator_meta.json'),
        grab('input_transform_surface_temperature.json'),
        grab('pca_gbt_surface_temperature.onnx.gz'),
      ]);
      const e = new PcaGbtEmulator();
      e.meta = await metaR.json();
      e.inputs = (await inputR.json()).inputs as InputSpec[];
      e.session = await _ort.InferenceSession.create(await gunzipMaybe(await onnxR.arrayBuffer()), { executionProviders: ['wasm'] });
      const st = await loadFieldNpy('');  // surface temperature (the default field — the only one the first map needs)
      e.q = st.lat.shape[1]; e.P = st.trend.shape[1];
      e.fields.surface_temperature = { Glat: st.lat.data, Gtrend: st.trend.data, gbias: st.bias.data };
      return e;
    } catch (err) {
      console.warn('[emulator] PCA-GBT load failed, falling back to kNN:', err);
      return null;
    }
  }

  /** The 8 standardized model inputs (no GCM one-hot) — the model's input space. */
  private inputStd(p: BuildParams): number[] {
    const names = this.meta.onnx_feature_order.slice(0, this.meta.d_in - this.meta.n_sim_types);
    const raw = rawInputVector(p, names);
    return raw.map((x, i) => (preprocessInput(x, this.inputs[i]) - this.inputs[i].mean) / this.inputs[i].std);
  }

  /** Run the ONNX (field-agnostic latents z) + build the design row h.
   *  gcmIndex picks the GCM lens (one-hot); out-of-range → the model's default. */
  private async latents(p: BuildParams, gcmIndex?: number): Promise<{ z: Float32Array; h: Float32Array }> {
    const xStd = this.inputStd(p);
    const gi = gcmIndex ?? this.meta.default_gcm_index;
    const gcm = (gi >= 0 && gi < this.meta.n_sim_types) ? gi : this.meta.default_gcm_index;
    const oneHot = new Array(this.meta.n_sim_types).fill(0); oneHot[gcm] = 1;
    const xin = Float32Array.from([...xStd, ...oneHot]);
    const ortTensor = new _ort!.Tensor('float32', xin, [1, this.meta.d_in]);
    const out = await this.session.run({ [this.session.inputNames[0]]: ortTensor });   // feed by the model's actual input name
    const z = (out[this.session.outputNames[0]] as import('onnxruntime-web').Tensor).data as Float32Array;
    // shared-linear-trend design row h: [intercept(1), X_std(8)] for design_cfg
    // {intercept:true, inputs:true, sim_onehot:false} -> P = 1 + 8 = 9.
    return { z, h: Float32Array.from([1, ...xStd]) };
  }

  /** Linear decode of one field's grid: grid[c] = z·Glat[c] + h·Gtrend[c] + gbias[c]. */
  private decodeRaw(z: Float32Array, h: Float32Array, m: { Glat: Float32Array; Gtrend: Float32Array; gbias: Float32Array }, cells: number): Float64Array {
    const out = new Float64Array(cells);
    for (let c = 0; c < cells; c++) {
      let v = m.gbias[c];
      for (let j = 0; j < this.q; j++) v += z[j] * m.Glat[c * this.q + j];
      for (let j = 0; j < this.P; j++) v += h[j] * m.Gtrend[c * this.P + j];
      out[c] = v;
    }
    return out;
  }

  hasField(key: string): boolean { return key in this.fields; }

  /** Same role as BuildAWorld.predictField, but the real PCA-GBT emulator.
   *  gcmIndex (optional) picks which GCM the emulator mimics — the per-GCM lens. */
  async predict(p: BuildParams, field: FieldMeta, ranges: Record<string, [number, number]>, gcmIndex?: number): Promise<Prediction> {
    const { z, h } = await this.latents(p, gcmIndex);
    const [rows, cols] = field.grid; const cells = rows * cols;
    const [lo, hi] = field.kRange;
    const raw = this.decodeRaw(z, h, this.fields.surface_temperature, cells);
    const out8 = new Uint8Array(cells);
    let sum = 0;
    for (let c = 0; c < cells; c++) {
      const v = raw[c]; sum += v;
      const clamped = Math.min(hi, Math.max(lo, v));
      out8[c] = 1 + Math.round(((clamped - lo) / (hi - lo)) * 254);
    }
    const mean = sum / cells;

    // out-of-envelope flags reuse the explorer's range gates (parity with kNN UI);
    // rotation/ch4 gates apply only when the caller actually drives those inputs.
    const outOf: string[] = [];
    const chk = (label: string, val: number | undefined, r?: [number, number]) => { if (val != null && r && (val < r[0] || val > r[1])) outOf.push(label); };
    chk('starlight', p.flux, ranges.flux); chk('pressure', p.pressure, ranges.pressure); chk('CO₂', p.co2, ranges.co2);
    chk('CH₄', p.ch4, ranges.ch4); chk('rotation', p.rotation, ranges.rotation);
    chk('star temperature', p.st_teff, ranges.st_teff); chk('planet size', p.radius, ranges.radius); chk('gravity', p.gravity, ranges.gravity);

    const sorted = Array.from(raw).sort((a, b) => a - b);
    const pct = (pp: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(pp * (sorted.length - 1))))];
    return {
      field: out8, mean, lo: pct(0.1), hi: pct(0.9),
      reg: regime(mean), inEnv: outOf.length === 0, outOf,
      n: cells, d12: 0, source: 'pca-gbt',
    };
  }

  /** Predict an arbitrary field (e.g. 'asr','olr'), packed over its own [min,max]
   *  for full precision; returns that range for the colorbar. null if the field's
   *  weights aren't shipped (the Explorer carries surface_temperature only today). */
  async predictField(p: BuildParams, key: string, gcmIndex?: number): Promise<FieldPrediction | null> {
    if (key !== 'surface_temperature') await this.loadFieldKey(key);
    const m = this.fields[key];
    if (!m) return null;
    const { z, h } = await this.latents(p, gcmIndex);
    const cells = this.meta.grid[0] * this.meta.grid[1];
    const raw = this.decodeRaw(z, h, m, cells);
    // ASR/OLR decode in per-F_star units; restore physical W·m⁻² with × stellar flux.
    const scale = FSTAR_FIELDS.has(key) ? p.flux : 1;
    // The linear PCA decode can dip a few W/m² below zero on the night side — unphysical
    // for absorbed shortwave (a reviewer flag). Clamp ASR at 0; OLR is left untouched.
    const floor = key === 'asr' ? 0 : -Infinity;
    let min = Infinity, max = -Infinity, sum = 0;
    for (let c = 0; c < cells; c++) { const v = Math.max(floor, raw[c] * scale); raw[c] = v; sum += v; if (v < min) min = v; if (v > max) max = v; }
    const span = (max - min) || 1;
    const out8 = new Uint8Array(cells);
    for (let c = 0; c < cells; c++) out8[c] = 1 + Math.round(((raw[c] - min) / span) * 254);
    return { field: out8, min, max, mean: sum / cells };
  }

  /** Per-cell DISAGREEMENT between the two flagship GCMs (UM and ExoCAM): predict this
   *  world through each and return the per-cell standard deviation of the pair (= |ΔT|/2).
   *  This is MODEL-CHOICE uncertainty (how much those two simulators disagree here), NOT the
   *  emulator's own predictive σ. Packed over [min,max] σ. */
  async predictDisagreement(p: BuildParams, key: string): Promise<DisagreementPrediction | null> {
    if (key !== 'surface_temperature') await this.loadFieldKey(key);
    const m = this.fields[key];
    if (!m) return null;
    const cells = this.meta.grid[0] * this.meta.grid[1];
    const gcms = DISAGREEMENT_GCMS.filter((g) => g >= 0 && g < this.meta.n_sim_types);
    const n = gcms.length;
    const scale = FSTAR_FIELDS.has(key) ? p.flux : 1;
    // Welford per cell across the UM/ExoCAM predictions.
    const mean = new Float64Array(cells), M2 = new Float64Array(cells);
    for (let gi = 0; gi < n; gi++) {
      const g = gcms[gi];
      const { z, h } = await this.latents(p, g);
      const raw = this.decodeRaw(z, h, m, cells);
      for (let c = 0; c < cells; c++) {
        const x = raw[c] * scale;
        const d = x - mean[c];
        mean[c] += d / (gi + 1);
        M2[c] += d * (x - mean[c]);
      }
    }
    const sig = new Float64Array(cells);
    let min = Infinity, max = -Infinity, sum = 0;
    for (let c = 0; c < cells; c++) { const s = Math.sqrt(M2[c] / n); sig[c] = s; sum += s; if (s < min) min = s; if (s > max) max = s; }
    const span = (max - min) || 1;
    const out8 = new Uint8Array(cells);
    for (let c = 0; c < cells; c++) out8[c] = 1 + Math.round(((sig[c] - min) / span) * 254);
    return { field: out8, min, max, mean: sum / cells, unit: FSTAR_FIELDS.has(key) ? 'W/m²' : 'K' };
  }
}

function regime(t: number): string {
  if (t < 240) return 'Snowball';
  if (t < 273) return 'Cold';
  if (t < 320) return 'Temperate';
  if (t < 373) return 'Hot';
  return 'Scorching';
}

// NOTE: this is the Explorer's copy of the emulator engine, synced 2026-07-12 with
// the private emulator repo's generation (per-GCM lens, per-asset lazy loading).
// The private repo additionally ships ASR/OLR/wind/profile/uncertainty weights;
// any weights or calibration update must be applied to BOTH repos.
// ---------------------------------------------------------------------------
