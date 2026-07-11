// ---------------------------------------------------------------------------
// emulator.ts — the benchmark's REAL PCA-GBT surface-temperature emulator,
// running CLIENT-SIDE in the browser (no backend), behind the same interface as
// BuildAWorld's kNN stand-in.
//
// Pipeline (mirrors thousandworlds.models.pca_gbt + decode_spectral_predictions,
// collapsed for surface temperature only — verified to ~5e-4 K against the
// benchmark's own predict() path):
//
//   1. raw 8 planet params -> per-input transform (Z / log_Z / arcsinh_Z /
//      smoothed_logit_Z) then (x-mean)/std        -> X_std  (8,)
//   2. concat GCM one-hot (single-complete: 1 dim) -> Xin    (9,)
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

import type { BuildParams } from '../components/BuildAWorld';
import type { FieldMeta } from '../components/SurfaceMap';

// Same shape BuildAWorld.predictField returns, so callers are interchangeable.
export interface Prediction {
  field: Uint8Array;            // 32*64 uint8 (0 = missing, 1..255 over kRange)
  mean: number; lo: number; hi: number;
  reg: string; inEnv: boolean; outOf: string[];
  n: number; d12: number;
  source: 'pca-gbt' | 'knn';    // which engine produced it (for an honest badge)
}

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
// Map the explorer's BuildParams (UI units) onto the EXACT dataset units the model was
// trained on (calibrated against input_transform_surface_temperature.json + the raw
// multi-complete inputs). Getting these wrong pushes inputs out of the simulated grid,
// where the trees extrapolate sharply — plausible-but-wrong with no error signal.
const R_EARTH_M = 6_371_000;        // dataset radius is in METRES (median raw 6.371e6 = 1 R⊕)
const DEFAULT_P_ROT_DAYS = 12;      // dataset-median rotation; the UI has no rotation slider
function rawInputVector(p: BuildParams, names: string[]): number[] {
  const byName: Record<string, number> = {
    T_star: p.st_teff,                       // K (direct)
    F_star: p.flux,                          // W/m² (direct)
    radius: (p.radius ?? 1) * R_EARTH_M,     // Earth radii → metres
    gravity: p.gravity,                      // m/s² (direct)
    P_rot: DEFAULT_P_ROT_DAYS,               // days; no UI slider → in-distribution default
    P0: (p.pressure ?? 1) * 1e5,             // bar → Pa (1 bar = 1e5 Pa; dataset P0 in Pa)
    CO2: (p.co2 ?? 0) / 100,                 // UI percent → mole fraction (dataset CO2 is mol/mol, 0..1)
    CH4: 0,                                   // mol/mol; no UI slider → 0 (dataset median is 0)
  };
  return names.map((nm) => byName[nm] ?? 0);
}

let _ort: typeof import('onnxruntime-web') | null = null;

export class PcaGbtEmulator {
  private session!: import('onnxruntime-web').InferenceSession;
  private meta!: EmulatorMeta;
  private inputs!: InputSpec[];
  private Glat!: Float32Array;  // (2048*q)
  private Gtrend!: Float32Array; // (2048*P)
  private gbias!: Float32Array;  // (2048)
  private q!: number;
  private P!: number;

  /** Load ONNX + matrices. Returns null on any failure (caller falls back to kNN). */
  static async load(): Promise<PcaGbtEmulator | null> {
    try {
      _ort ??= await import('onnxruntime-web/wasm');   // CPU-only build → needs only ort-wasm-simd-threaded.{mjs,wasm} (no 27 MB WebGPU jsep bundle)
      _ort.env.wasm.numThreads = 1;                                      // single-threaded: no SharedArrayBuffer / COOP+COEP headers needed
      _ort.env.wasm.wasmPaths = `${import.meta.env.BASE_URL ?? '/'}ort/`; // self-hosted runtime (see vite.config.ts)
      const grab = (f: string) => fetch(BASE + f).then((r) => { if (!r.ok) throw new Error(f); return r; });
      const [metaR, inputR, onnxR, glatR, gtrendR, gbiasR] = await Promise.all([
        grab('emulator_meta.json'),
        grab('input_transform_surface_temperature.json'),
        grab('pca_gbt_surface_temperature.onnx.gz'),
        grab('collapsed_G_lat.npy'),
        grab('collapsed_G_trend.npy'),
        grab('collapsed_g_bias.npy'),
      ]);
      const e = new PcaGbtEmulator();
      e.meta = await metaR.json();
      e.inputs = (await inputR.json()).inputs as InputSpec[];
      e.session = await _ort.InferenceSession.create(await gunzipMaybe(await onnxR.arrayBuffer()), { executionProviders: ['wasm'] });
      const glat = parseNpyF32(await glatR.arrayBuffer());
      const gtrend = parseNpyF32(await gtrendR.arrayBuffer());
      const gbias = parseNpyF32(await gbiasR.arrayBuffer());
      e.Glat = glat.data; e.Gtrend = gtrend.data; e.gbias = gbias.data;
      e.q = glat.shape[1]; e.P = gtrend.shape[1];
      return e;
    } catch (err) {
      console.warn('[emulator] PCA-GBT load failed, falling back to kNN:', err);
      return null;
    }
  }

  /** Same role as BuildAWorld.predictField, but the real PCA-GBT emulator. */
  async predict(p: BuildParams, field: FieldMeta, ranges: Record<string, [number, number]>): Promise<Prediction> {
    const names = this.meta.onnx_feature_order.slice(0, this.meta.d_in - this.meta.n_sim_types);  // the raw inputs, before the gcm one-hot
    // 1) raw -> standardized X_std
    const raw = rawInputVector(p, names);
    const xStd = raw.map((x, i) => (preprocessInput(x, this.inputs[i]) - this.inputs[i].mean) / this.inputs[i].std);
    // 2) Xin = X_std ++ GCM one-hot (multi-complete: 5 GCMs; default = the model's chosen one)
    const oneHot = new Array(this.meta.n_sim_types).fill(0); oneHot[this.meta.default_gcm_index] = 1;
    const xin = Float32Array.from([...xStd, ...oneHot]);

    // 3) ONNX -> latents z (q,)
    const ortTensor = new _ort!.Tensor('float32', xin, [1, this.meta.d_in]);
    const out = await this.session.run({ [this.session.inputNames[0]]: ortTensor });   // feed by the model's actual input name
    const z = (out[this.session.outputNames[0]] as import('onnxruntime-web').Tensor).data as Float32Array;

    // 4) linear decode: grid[c] = z·Glat[c] + h·Gtrend[c] + gbias[c]
    // shared-linear-trend design row h: [intercept(1), X_std(8)] for design_cfg
    // {intercept:true, inputs:true, sim_onehot:false} -> P = 1 + 8 = 9.
    const h = Float32Array.from([1, ...xStd]);
    const [rows, cols] = field.grid; const cells = rows * cols;
    const [lo, hi] = field.kRange;
    const out8 = new Uint8Array(cells);
    const temps: number[] = [];
    let sum = 0;
    for (let c = 0; c < cells; c++) {
      let v = this.gbias[c];
      for (let j = 0; j < this.q; j++) v += z[j] * this.Glat[c * this.q + j];
      for (let j = 0; j < this.P; j++) v += h[j] * this.Gtrend[c * this.P + j];
      temps.push(v); sum += v;
      const clamped = Math.min(hi, Math.max(lo, v));
      out8[c] = 1 + Math.round(((clamped - lo) / (hi - lo)) * 254);
    }
    const mean = sum / cells;

    // out-of-envelope flags reuse the explorer's range gates (parity with kNN UI)
    const outOf: string[] = [];
    const chk = (label: string, val: number, r?: [number, number]) => { if (r && (val < r[0] || val > r[1])) outOf.push(label); };
    chk('starlight', p.flux, ranges.flux); chk('pressure', p.pressure, ranges.pressure); chk('CO₂', p.co2, ranges.co2);
    chk('star temperature', p.st_teff, ranges.st_teff); chk('planet size', p.radius, ranges.radius); chk('gravity', p.gravity, ranges.gravity);

    const sorted = temps.slice().sort((a, b) => a - b);
    const pct = (pp: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(pp * (sorted.length - 1))))];
    return {
      field: out8, mean, lo: pct(0.1), hi: pct(0.9),
      reg: regime(mean), inEnv: outOf.length === 0, outOf,
      n: cells, d12: 0, source: 'pca-gbt',
    };
  }
}

function regime(t: number): string {
  if (t < 240) return 'Snowball';
  if (t < 273) return 'Cold';
  if (t < 320) return 'Temperate';
  if (t < 373) return 'Hot';
  return 'Scorching';
}

// NOTE: this is the Explorer's copy of the emulator; the private emulator repo
// carries a newer generation (per-GCM lens, per-asset lazy loading). Any weights
// or calibration update must be applied to BOTH repos — see the roadmap notes.
// ---------------------------------------------------------------------------
