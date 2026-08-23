# LFP Explorer

The seed of the **Sustainable FSA Explorer** — a single-page web application
visualizing the data assembled by the [Sustainable FSA
project](https://sustainable-fsa.com). It is growing into a multi-interface
explorer of the data used to administer the Livestock Forage Disaster
Program. Its four views: **1 · Drought monitor** — the weekly worst U.S.
Drought Monitor class per county, 2000 onward, under three
county-aggregation conventions; **2 · Grazing periods** (the default view) —
USDA Farm Service Agency **Normal Grazing Periods** (2008–2026, all FSA
counties and pasture types, previously the
[fsa-normal-grazing-period](https://github.com/sustainable-fsa/fsa-normal-grazing-period)
dashboard) alongside the
[NAP-190-derived nClimGrid counterfactual](https://github.com/sustainable-fsa/nclimgrid-normal-grazing-period);
**3 · LFP eligibility** — the qualifying drought events behind LFP payment
determinations, from FSA's FOIA'd records, its weekly web publications, and
a reanalysis derived from the Drought Monitor; and **4 · Disaster
designations** — USDA Secretarial disaster designations for drought, the
broader instrument around the program.

**Live app:** <https://sustainable-fsa.com/lfp-explorer/>

## Architecture

- A hand-written, zero-build MapLibre GL app (`index.html` + ES modules under
  `js/`), served by GitHub Pages from this repo's root (Jekyll disabled).
  `js/app.js` is the interface host (state, URL, drawer, switch mechanics);
  `js/interfaces/` holds one descriptor module per data family (the registry
  in `js/interfaces/registry.js`); `js/decoders/` holds one payload decoder
  factory per schema plus the FIPS↔FSA crosswalk loader; `js/data.js` is a
  compatibility facade over the active grazing-period dataset instance.
- Chrome, tokens, and map machinery come from the shared house-style kit
  [sustainable-fsa/style](https://github.com/sustainable-fsa/style), consumed
  same-origin by pinned version path
  (`https://sustainable-fsa.com/style/v0.2.1/…` for the versioned surface;
  `…/style/vendor/…` and `…/style/assets/…` are deliberately unversioned).
  The kit owns the two side surfaces this app is built around: the left
  controls drawer (`.sfsa-drawer` + `ui/drawer.js`) and the right-docked county
  card (`.sfsa-card.dock-right` + `ui/card.js`).
- County geometry is fetched at runtime as **PMTiles vector tiles** from
  `data.sustainable-fsa.com/data-tiles/`, and **every dataset draws the
  polygons its own numbers were computed against** — there are three
  authorities, not one. FSA's administrative composite (`fsa-counties-dd17`
  for program years ≤ 2014, `fsa-counties-dd22` for ≥ 2015); the FSA LFP
  determination boundaries; and vintage-matched Census counties, eighteen
  annual TIGER releases. `js/boundaries.js` owns that policy and nothing else
  knows it. Each tileset has a companion `-index.json` sidecar carrying the
  county gazetteer and per-county bounding boxes, because
  `queryRenderedFeatures` returns only what is rendered and tiles therefore
  cannot supply a county index or a centroid.
- The map is displayed in CONUS Albers Equal Area (EPSG:5070) with Alaska,
  Hawaii, and Puerto Rico repositioned as insets, matching every other figure
  the project publishes. MapLibre renders only Mercator, so the geometry is
  pre-projected into a fixed dummy lng/lat box — which is also what the
  `?lng`/`?lat`/`?zoom` camera params are expressed in. That transform now
  happens **upstream**, in the tile producer; `js/projection.js` keeps the
  reference implementation (its twelve-point PROJ table is what the producer's
  own gate is checked against) and adds `assertProjectedSpace()`, which every
  loaded boundary passes through. Geometry that arrives in the wrong space
  renders a map that lines up at the centre and drifts at the edges, with
  nothing on screen to say so, so the app refuses to draw it at all.
- Help-modal copy lives in the sidecar [`help.md`](help.md).

## Data

The app fetches its payloads at runtime by relative sibling path
(`../<archive>/<file>.json`), which in production resolves to each archive's
same-origin Pages copy, gzipped by Pages. (The `data.sustainable-fsa.com`
mirrors are cross-origin and uncompressed, so the app does not use them.)
**This repo ships no copy of the data payloads.** The manifest of everything
CI stages into those sibling slots is [`tools/payloads.txt`](tools/payloads.txt);
a payload line lands in the same commit as the code that fetches it.

- `fsa-normal-grazing-period.json` (schema `fsa-ngp-web/1`, CC0) — the
  official grazing-period archive, 244,890 records, ~5 MB raw / ~100 KB
  gzipped. Fetched at boot.
- `nclimgrid-normal-grazing-period.json` (same schema, CC0) — the 1991–2020
  climatology counterfactual, 4,846 records, Census-FIPS-keyed. Fetched
  lazily on first toggle, then joined to the FSA geometry through the
  crosswalk below.
- `usdm-counties-fsa-lfp.json` / `usdm-counties-reported.json` /
  `usdm-counties.json` (schema `usdm-max-class/1`, CC0) — the weekly worst
  U.S. Drought Monitor class per county, 2000-01-04 onward, as one
  fixed-width string per county; three county-aggregation archives
  (FSA's FOIA'd LFP boundaries — the map default; NDMC's own published
  stats; vintage-matched Census counties). All FIPS-keyed and crosswalked.
  Fetched lazily on the Drought monitor interface.
- `fsa-lfp-eligibility-events.json` / `fsa-lfp-eligibility-web-events.json` /
  `fsa-lfp-eligibility-derived.json` (schema `fsa-lfp-eligibility/1`, CC0) —
  one record per qualifying drought event: FSA's official FOIA'd
  determinations (2008–2025), its weekly web publications (2008–2026), and
  the reanalysis recomputed from the Drought Monitor (452k events, all four
  aggregation conventions in one file). FSA-keyed, with a parallel Census
  FIPS provenance column. Fetched lazily on the LFP eligibility interface.
- `fsa-disasters.json` (schema `fsa-disasters/1`, CC0) — USDA Secretarial
  disaster designations (2012–) and Presidential major-disaster declarations
  (2017–): 3,907 declarations and 184,815 county rows, values verbatim,
  irregularities included. FIPS-keyed and crosswalked. Fetched lazily on the
  Disaster designations interface.

The one **data-shaped file this repo does commit** is
`assets/fsa-fips-crosswalk.json` (schema `fsa-fips-crosswalk/1`) — the
FSA↔FIPS county join extracted from the boundary archives' geoparquets
(dd17: 3,247 pairs; dd22: 3,245). It is join metadata in the same spirit as
the frozen color ramps, not a data archive; moving it behind an
archive-published URL is an open thread.

[`R/web-assets.R`](R/web-assets.R) builds the frozen `assets/` contracts —
the color ramps (including the drought-factor ramp), and the crosswalk
(which reads the two sibling `fsa-counties-dd17`/`-dd22` checkouts):

```r
source("R/web-assets.R"); build_color_ramps(); build_df_ramp(); build_crosswalk()
```

## Development

```sh
# Serve the workspace root so paths mirror production:
python3 -m http.server 8000 -d /path/to/sustainable-fsa
# → http://localhost:8000/lfp-explorer/
```

Because the workspace root is what gets served, local dev (and
`tools/verify.mjs`, which serves the same root itself) needs the sibling
archive checkouts named in `tools/payloads.txt` with their committed JSON
present — `git pull` them if the app boots with no data. The same relative
paths reach them. (CI has no sibling checkouts;
`.github/workflows/audit.yaml` curls each published payload in the manifest
into its slot instead — the mirror recipe for a missing local sibling is in
`tools/payloads.txt` itself.)

### Developing against an unreleased kit

Released kit versions are immutable snapshots, so a change that needs new kit
surface has to be proven against the local `style` checkout **before** the kit
is released. Because the workspace root is what gets served, root-absolute
paths reach the sibling checkout — so the recipe is a two-way URL sweep on a
working branch:

```sh
# Dev-ward — point every kit reference at the local style/ checkout.
# NEVER push this state.
sed -i '' -e 's|https://sustainable-fsa\.com/style/v0\.4\.0/|/style/|g' \
          -e 's|https://sustainable-fsa\.com/style/vendor/|/style/vendor/|g' \
          -e 's|https://sustainable-fsa\.com/style/assets/|/style/assets/|g' \
          index.html js/*.js js/*/*.js tools/verify.mjs

# Prod-ward — re-pin after the kit release: versioned surface, then the
# deliberately unversioned vendor and brand-asset surfaces.
for d in theme core map county ui; do
  sed -i '' "s|/style/$d/|https://sustainable-fsa.com/style/v0.4.0/$d/|g" \
    index.html js/*.js js/*/*.js tools/verify.mjs
done
for d in vendor assets; do
  sed -i '' "s|/style/$d/|https://sustainable-fsa.com/style/$d/|g" \
    index.html js/*.js js/*/*.js tools/verify.mjs
done
grep -rn "'/style/\|\"/style/" index.html js/ tools/verify.mjs   # must come back empty
```

The `js/*.js js/*/*.js` glob is doing real work: every module that imports the
kit has to move together, and that now includes **`js/boundaries.js`** (it takes
`loadCountyIndex`, `TILE_BASE` and `vintageForYear` from `county/county.js`). Two
kit URLs at different versions are two module instances — two `viewport`
pub-subs, and two `pmtiles` protocol registrations — so a file left behind is
not a cosmetic miss. The final `grep` is the check that matters.

`tools/check-boundaries.mjs` is the one gate that runs in EITHER state — it
stubs the kit import rather than fetching it — and its rewrite regex accepts
both forms for that reason. It is worth running while the sweep is dev-ward,
because a kit-development branch is exactly when the two vintage resolvers are
being edited.

Two rules make this safe rather than clever:

- **The sweep is all-or-nothing** across `index.html`, every file under `js/`
  (including `js/interfaces/` and `js/decoders/`), and `tools/verify.mjs`
  (whose in-page probes import the kit by URL — hoisted to the single
  `KIT_COUNTY_URL` constant there). Two different `core.js` URLs are two
  module instances, and therefore two independent `viewport` pub-subs — the
  drawer would end up listening to a different viewport than the county card.
- **Root-absolute is `'self'`** under this page's CSP, so the sweep needs no
  CSP edit. It must not touch the inline anti-flash `<script>`, whose `sha256`
  is pinned in that CSP (it contains no kit URLs, so a URL sweep never does).

CI fetches the kit from production, so a kit change lands in this order: kit
released and served by Pages → prod-ward sweep here → push.

## Audits

`tools/` carries the quality gates (axe, behavioural verify, Lighthouse), run
locally and by `.github/workflows/audit.yaml` on every push and PR:

```sh
npm ci --prefix tools && npx --prefix tools playwright install chromium
npx --prefix tools html-validate index.html
node tools/a11y-audit.mjs
node tools/verify.mjs
npx --prefix tools lhci autorun
```

## License and provenance

Code is MIT (see [LICENSE](LICENSE)). The underlying grazing-period data are
US public domain (raw FOIA material) and CC0 (processed); see the
[archive repo](https://github.com/sustainable-fsa/fsa-normal-grazing-period)
and the in-app **About this map** for citation, FOIA request numbers, and the
standard disclaimer — for current program information, always consult your
local FSA office.

---

Part of *Enhancing Sustainable Disaster Relief in FSA Programs*, supported by
the USDA Office of the Chief Economist, Office of Energy and Environmental
Policy, and the USDA Climate Hubs. Built and maintained by the [Montana
Climate Office](https://climate.umt.edu), University of Montana.
