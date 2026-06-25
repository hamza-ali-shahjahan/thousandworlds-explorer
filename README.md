# ThousandWorlds

An explorable map of every world humanity has discovered — built on the
[NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/). Each dot is a
real confirmed exoplanet. Plotted by orbital period (how long its year is) and size,
colored by temperature, with Earth marked for scale.

Three goals in one app: a **beginner-friendly** explorer to learn from, a **shareable**
showpiece, and a **serious analysis tool** over the full ~6,300-world catalog.

## Run it

```bash
npm install
npm run dev        # → http://localhost:5173
```

## Refresh the data

The catalog is pulled live from NASA's TAP API and cleaned into `public/worlds.json`.

```bash
# 1. pull the raw catalog (one curl, ~1.3 MB)
curl -sG "https://exoplanetarchive.ipac.caltech.edu/TAP/sync" \
  --data-urlencode "query=select pl_name,hostname,sy_dist,pl_rade,pl_bmasse,pl_dens,pl_eqt,pl_insol,pl_orbper,pl_orbsmax,pl_orbeccen,disc_year,discoverymethod,disc_facility,st_teff,st_rad,st_mass,st_spectype,sy_snum,sy_pnum,ra,dec from pscomppars" \
  --data-urlencode "format=csv" -o data/raw/pscomppars.csv

# 2. clean + enrich → public/worlds.json + public/meta.json
npm run data
```

## How it's built

- **Vite + React + TypeScript**, no UI framework — a hand-rolled cosmic dark theme.
- The discovery map is a single `<canvas>` (`src/components/DiscoveryMap.tsx`) that renders
  all ~6,300 points via an offscreen base layer + nearest-point hit-testing, so filtering
  and hover stay smooth.
- All filtering/analysis runs client-side — the dataset is small enough (~2 MB JSON).
- `scripts/build-data.mjs` is the data pipeline: parse CSV → normalize units
  (parsecs → light-years) → compute a rough Earth-likeness score → write JSON.

## Data notes

- `esi` is a *rough* Earth-likeness (0–1) from planet size and equilibrium temperature
  only — a transparent heuristic, not an official habitability claim.
- `hz` flags the temperate, Earth-size band (0.5–1.8 R⊕, 180–320 K) — a beginner shorthand,
  not a rigorous habitable-zone calculation.
- Many worlds are missing some fields; those are stored as `null` and excluded from views
  that need them.
