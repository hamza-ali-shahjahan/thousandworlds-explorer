# ThousandWorlds Explorer

**🔭 Live demo → https://thousandworlds-explorer.vercel.app**

An explorable, beginner-friendly map of worlds beyond our Solar System. One app, two
datasets you switch between in the top bar:

- **Discovered · NASA** — every confirmed exoplanet humanity has *found* (~6,300), from the
  [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/). Plotted by orbital
  period and size, colored by temperature, with Earth marked for scale.
- **Simulated · ThousandWorlds** — 1,659 *simulated* planetary climates from the
  **ThousandWorlds** climate-emulation benchmark. A planet's parameters go in (starlight,
  air pressure, CO₂…), a global climate model computes its climate, and each dot is one such
  run — colored by the resulting surface temperature (snowball → temperate → runaway).

Three goals in one app: a **beginner-friendly** explorer to learn from, a **shareable**
showpiece, and a **serious analysis tool** over the full catalogs.

## Run locally

```bash
npm install
npm run dev        # → http://localhost:5173
```

## Refresh the data

Both datasets ship pre-built in `public/`. To regenerate:

**NASA** (pulled live from the Exoplanet Archive TAP API):
```bash
curl -sG "https://exoplanetarchive.ipac.caltech.edu/TAP/sync" \
  --data-urlencode "query=select pl_name,hostname,sy_dist,pl_rade,pl_bmasse,pl_dens,pl_eqt,pl_insol,pl_orbper,pl_orbsmax,pl_orbeccen,disc_year,discoverymethod,disc_facility,st_teff,st_rad,st_mass,st_spectype,sy_snum,sy_pnum,ra,dec from pscomppars" \
  --data-urlencode "format=csv" -o data/raw/pscomppars.csv
npm run data      # → public/worlds.json + public/meta.json
```

**ThousandWorlds** (needs the ~1.6 GB benchmark dataset locally; reduces it to area-weighted
global means):
```bash
python scripts/build-thousandworlds.py --dataset /path/to/ThousandWorlds/dataset --out public
# → public/thousandworlds.json + public/thousandworlds-meta.json
```

## Build & deploy

```bash
npm run build      # tsc + vite build → dist/
```

It's a fully static site (no backend) — host `dist/` anywhere. This repo is connected to
Vercel, so a push to `main` auto-deploys; or run `vercel --prod --yes`.

## How it's built

- **Vite + React + TypeScript**, no UI framework — a hand-rolled cosmic dark theme.
- Both maps are a single `<canvas>` rendering thousands of points smoothly (offscreen base
  layer + nearest-point hit-testing).
- All filtering/analysis runs client-side — the datasets are small (a couple of MB each).
- Shared shell + components across the two tabs (toggle in `src/App.tsx`):
  - NASA: `DiscoveryMap`, `DataTable`, `Charts`, `Sidebar`, `DetailPanel`, `StatBar`, `Tour`.
  - ThousandWorlds: `ThousandWorlds.tsx` (climate phase-diagram, parameter/GCM filters,
    per-simulation detail, cross-model comparison), reusing `RangeFilter`, `Term`, `Tour`.
  - Data pipelines: `scripts/build-data.mjs` (NASA), `scripts/build-thousandworlds.py` (TW).

## Datasets & credits

1. **NASA Exoplanet Archive** (`pscomppars`) — confirmed exoplanets.
2. **ThousandWorlds** — simulated exoplanet climates, used under **CC-BY-4.0** with thanks to
   its authors. This is an independent companion explorer, not an official ThousandWorlds project.

   > Stevenson, Mak, Wolf, Sergeev, Hammond, Mayne & Cranmer (2026),
   > *ThousandWorlds: A benchmark for climate emulation of potentially habitable exoplanets.*
   > Paper: https://arxiv.org/abs/2606.18338 · Code: https://github.com/astroautomata/ThousandWorlds
   > · DOI: https://doi.org/10.57967/hf/8695

## Data notes

- NASA `esi` is a *rough* Earth-likeness (0–1) from size and equilibrium temperature only — a
  transparent heuristic, **not** a habitability claim. `hz` flags a temperate, Earth-size band
  (a beginner shorthand, not a rigorous habitable-zone calculation).
- ThousandWorlds values shown are **area-weighted global means** of time-averaged climate-model
  output — simulations, not observations, and not habitability claims.
- Missing fields are stored as `null` and excluded from views that need them.
