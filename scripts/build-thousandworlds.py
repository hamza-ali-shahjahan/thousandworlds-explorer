#!/usr/bin/env python3
"""ThousandWorlds (climate benchmark) -> browser slice.

Reduces the 1.6 GB ThousandWorlds dataset to a small per-simulation JSON the
explorer can load client-side: the 8 input planet parameters plus a handful of
area-weighted global-mean climate outcomes (surface temperature, absorbed
shortwave / outgoing longwave radiation, cloud fraction).

Data: ThousandWorlds (Stevenson, Mak, Wolf, Sergeev, Hammond, Mayne, Cranmer,
2026), CC-BY-4.0 — https://github.com/astroautomata/ThousandWorlds
You need the dataset locally (≈1.6 GB). Either point --dataset at an existing
copy, or in a Python env with the package:  `pip install thousandworlds &&
python -c "import thousandworlds as tw; tw.download_dataset(data_dir='dataset')"`.

Usage:
  python scripts/build-thousandworlds.py --dataset /path/to/dataset --out public
"""
import argparse, csv, json, os
from collections import Counter
from datetime import datetime, timezone
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('--dataset', default=os.environ.get('TW_DATASET', ''))
ap.add_argument('--out', default='public')
args = ap.parse_args()
if not args.dataset:
    raise SystemExit("Pass --dataset /path/to/ThousandWorlds/dataset (or set TW_DATASET).")

# --- inputs: one row per simulation (SI units) ---
inputs = {}
with open(os.path.join(args.dataset, 'inputs.csv')) as f:
    for row in csv.DictReader(f):
        inputs[int(row['simulation_id'])] = row

# --- gridded fields (complete-observation subset) ---
z = np.load(os.path.join(args.dataset, 'fields', 'complete-obs-only.npz'), allow_pickle=True)
names = [str(x) for x in z['field_names']]
sids = [int(s) for s in z['simulation_id']]
fields = z['fields']  # (N, 48, 32, 64) = sim x field x lat x lon

# Gaussian-grid (T21 -> 32 lat) quadrature weights ARE the latitude area weights.
_, w = np.polynomial.legendre.leggauss(32)
W = (w / w.sum())[None, :]  # (1, 32)

def gmean(idx):
    arr = fields[:, idx, :, :]              # (N, 32, 64)
    lon = np.nanmean(arr, axis=2)           # (N, 32) mean over longitude
    return np.nansum(lon * W, axis=1)       # (N,) area-weighted global mean

i_ts = names.index('surface_temperature')
i_asr = names.index('asr_cloudy')
i_olr = names.index('olr_cloudy')
cloud_idx = [i for i, n in enumerate(names) if n.startswith('cloud_fraction_')]

ts = gmean(i_ts)
asr = gmean(i_asr)
olr = gmean(i_olr)
cloud_col = np.nanmean(fields[:, cloud_idx, :, :], axis=1)          # (N,32,64) column-mean
cloud = np.nansum(np.nanmean(cloud_col, axis=2) * W, axis=1)        # (N,) global-mean cloudiness

def f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None

R_EARTH = 6.371e6  # metres
# Per-world surface-temperature FIELD export (for the explorer's spatial climate maps).
# Each world's 32x64 grid is quantised to uint8: 0 = missing/NaN sentinel, 1..255 = linear
# over SURF_KRANGE (kelvin). The browser reconstructs T = lo + (u-1)/254 * (hi-lo) and colors
# it with the same frozen->temperate->scorching palette as the scatter dots.
SURF_KRANGE = (90, 400)
out = []
surf_u8 = []
for k, sid in enumerate(sids):
    r = inputs.get(sid)
    if not r:
        continue
    rad_m, pres_pa = f(r['radius']), f(r['surface_pressure'])
    out.append({
        'sid': sid,
        'planet': int(f(r['planet_id'])) if r.get('planet_id') not in (None, '') else None,
        'gcm': r['gcm_label'],
        'radius': round(rad_m / R_EARTH, 3) if rad_m else None,   # Earth radii
        'gravity': round(f(r['gravity']), 2),                      # m/s^2
        'rotation': round(f(r['rotation_period']), 3),             # days
        'pressure': round(pres_pa / 1e5, 3) if pres_pa else None,  # bar
        'co2': round(f(r['co2']) * 100, 2),                        # volume fraction -> %
        'ch4': round(f(r['ch4']) * 100, 2),                        # volume fraction -> %
        'flux': round(f(r['stellar_flux']), 0),                    # W/m^2
        'st_teff': round(f(r['stellar_temperature']), 0),          # K
        'tsurf': round(float(ts[k]), 1),                           # K, global mean
        'asr': round(float(asr[k]), 1),                            # W/m^2
        'olr': round(float(olr[k]), 1),                            # W/m^2
        'cloud': round(float(cloud[k]), 3),                        # fraction 0..1
    })
    fld = fields[k, i_ts, :, :]                                     # (32, 64) surface temp, K
    lo, hi = SURF_KRANGE
    q = 1.0 + np.clip((np.clip(fld, lo, hi) - lo) / (hi - lo) * 254.0, 0, 254)
    surf_u8.append(np.where(np.isfinite(fld), q, 0).astype(np.uint8))

os.makedirs(args.out, exist_ok=True)
with open(os.path.join(args.out, 'thousandworlds.json'), 'w') as fp:
    json.dump(out, fp)
surf_arr = np.stack(surf_u8).astype(np.uint8)                      # (N, 32, 64), row i <-> out[i]
surf_arr.tofile(os.path.join(args.out, 'tw-surface.u8'))

def rng(key):
    vals = [o[key] for o in out if o[key] is not None]
    return [round(min(vals), 2), round(max(vals), 2)]

meta = {
    'generated': datetime.now(timezone.utc).isoformat(),
    'source': 'ThousandWorlds: A benchmark for climate emulation of potentially habitable exoplanets (Stevenson, Mak, Wolf, Sergeev, Hammond, Mayne, Cranmer, 2026)',
    'license': 'CC-BY-4.0',
    'paper': 'https://arxiv.org/abs/2606.18338',
    'code': 'https://github.com/astroautomata/ThousandWorlds',
    'doi': 'https://doi.org/10.57967/hf/8695',
    'subset': 'multi-complete (simulations with no missing fields)',
    'note': 'Climate values are area-weighted global means of time-averaged GCM output, derived from the full gridded dataset.',
    'count': len(out),
    'full_count': 1760,  # multi-partial: the full ThousandWorlds dataset (missing fields as NaNs)
    'full_subset': 'multi-partial (full dataset; missing fields represented as NaNs)',
    'gcms': sorted(Counter(o['gcm'] for o in out).items(), key=lambda x: -x[1]),
    'ranges': {k: rng(k) for k in ['radius', 'gravity', 'rotation', 'pressure', 'co2', 'ch4', 'flux', 'st_teff', 'tsurf', 'asr', 'olr', 'cloud']},
    'field': {'name': 'surface_temperature', 'grid': [32, 64], 'kRange': list(SURF_KRANGE), 'sentinel': 0, 'asset': 'tw-surface.u8'},
}
with open(os.path.join(args.out, 'thousandworlds-meta.json'), 'w') as fp:
    json.dump(meta, fp, indent=2)

print(f"wrote {len(out)} simulations -> {args.out}/thousandworlds.json")
print(f"wrote surface field {surf_arr.shape} -> {args.out}/tw-surface.u8 "
      f"({surf_arr.nbytes/1e6:.2f} MB; missing/sentinel cells={int((surf_arr == 0).sum())})")
print("tsurf range:", meta['ranges']['tsurf'], " GCMs:", meta['gcms'])
print("sample:", json.dumps(out[0]))
