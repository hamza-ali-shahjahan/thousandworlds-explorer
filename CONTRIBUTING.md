# Contributing to ThousandWorlds

Thanks for your interest! This is a small, friendly project — beginners welcome.

## Run it locally

```bash
git clone https://github.com/hamza-ali-shahjahan/thousandworlds-explorer.git
cd thousandworlds-explorer
npm install
npm run dev
```

Then open the printed `http://localhost:5173`.

## Refresh the dataset

The catalog ships pre-built in `public/worlds.json`. To pull the latest from NASA:

```bash
curl -sG "https://exoplanetarchive.ipac.caltech.edu/TAP/sync" --data-urlencode "query=select pl_name,hostname,sy_dist,pl_rade,pl_bmasse,pl_dens,pl_eqt,pl_insol,pl_orbper,pl_orbsmax,pl_orbeccen,disc_year,discoverymethod,disc_facility,st_teff,st_rad,st_mass,st_spectype,sy_snum,sy_pnum,ra,dec from pscomppars" --data-urlencode "format=csv" -o data/raw/pscomppars.csv
npm run data
```

## Before opening a pull request

- `npm run build` must pass (it runs the TypeScript typecheck and the production build).
- Keep changes focused and match the existing code style.
- Describe what changed and why; screenshots help for UI changes.

## Reporting issues

Open a GitHub issue with steps to reproduce, what you expected, and what happened.
