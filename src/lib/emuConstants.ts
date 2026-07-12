// Shared emulator constants (synced from the private emulator repo's
// constants.ts, narrowed to what the Explorer needs): the lib-level 8-input
// BuildParams, defaults for the two inputs the Explorer UI doesn't drive yet,
// and the GCM-lens labels matching the model's one-hot block.

// The 8 emulator inputs. The Explorer's Build-a-World sliders drive 6 of them;
// rotation and CH4 are OPTIONAL here (defaulted to in-distribution values by
// emulator.ts / ood.ts when absent) so the UI's 6-param object stays assignable.
// simcatalog.simInputs() fills all 8 from a benchmark simulation row.
export interface BuildParams {
  st_teff: number;   // star temperature, K          (T_star)
  flux: number;      // stellar flux, W/m²           (F_star)
  radius: number;    // planet size, Earth radii     (radius)
  gravity: number;   // surface gravity, m/s²        (gravity)
  pressure: number;  // surface pressure, bar        (P0)
  co2: number;       // CO₂, percent (mol/mol ×100)  (CO2)
  rotation?: number; // rotation period, days        (P_rot) — no UI slider yet
  ch4?: number;      // CH₄, percent (mol/mol ×100)  (CH4)   — no UI slider yet
}

// In-distribution defaults for the sliderless inputs (dataset median rotation;
// zero methane — the dataset median). Shared by emulator.ts and ood.ts so both
// place a 6-param world at the SAME point in the model's 8-dim input space.
export const DEFAULT_P_ROT_DAYS = 12;
export const DEFAULT_CH4_PCT = 0;

// The 5 GCMs the emulator can emulate (the model carries a GCM one-hot). These are
// independent climate SIMULATORS that genuinely disagree on the same world — picking
// one shows that spread; this is simulation choice, NOT a real-vs-observed comparison.
// Order matches public/emulator/emulator_meta.json onnx_feature_order one-hot block.
export const GCM_LABELS: readonly string[] = ['exocam', 'exocam-pre2022', 'exoplasim', 'lfric', 'um'];
export const DEFAULT_GCM_INDEX = 4; // 'um' — matches emulator_meta.json default_gcm_index
// "GCM disagreement" = the spread between the two flagship GCMs, UM and ExoCAM —
// NOT all five lenses. The lens choice still spans all 5; this pair is only what
// the "disagreement"/"spread" measures.
export const DISAGREEMENT_GCMS: readonly number[] = [GCM_LABELS.indexOf('um'), GCM_LABELS.indexOf('exocam')];
export const DISAGREEMENT_LABEL = 'UM vs ExoCAM';
