# LFP Explorer

A zero-build, single-page MapLibre GL app: `index.html` + ES modules under
`js/`, served by GitHub Pages from this repo's root. `js/app.js` is the
interface host (state, URL, map, controls drawer, switch mechanics, legend,
county card); `js/interfaces/` holds one descriptor per data family with the
registry in `js/interfaces/registry.js`; `js/decoders/` holds one payload
decoder factory per schema plus the FIPS↔FSA crosswalk; `js/data.js` is a
compatibility facade over the active grazing-period dataset instance (its
export surface is load-bearing — `tools/verify.mjs` imports it by URL);
`js/color.js` is the scales. `legend-wheel.js`, `card-content.js`,
`table-view.js` and `export.js` hang off the documented seam at the bottom of
`app.js`. Help-modal copy is the sidecar `help.md`. Quality gates live in
`tools/` (`verify.mjs`, `a11y-audit.mjs`, html-validate, LHCI; shared knobs in
`tools/config.mjs`, payload manifest in `tools/payloads.txt`) and run in CI on
every push.

## House style

This app consumes the Sustainable FSA style kit, pinned by full versioned URL
in index.html (https://sustainable-fsa.com/style/v0.2.0/…). Design tokens,
a11y mandates, and interaction conventions: see HOUSE-STYLE.md in
https://github.com/sustainable-fsa/style — tokens only (no raw hexes),
--accent is fill-only, aria-pressed drives toggle styling, canvas data needs a
live region plus the sr summary / on-demand table twin, and county joins use
5-character FSA string ids (never FIPS, never parseInt). To change shared
styling, change the kit and bump the pinned version here; never patch a local
copy.

Specifics that bite in this repo:

- **`css/app.css` is app layout only.** The kit owns every component. Any rule
  that touches a kit or vendor selector must be tagged `/* kit-override: <why>
  */` — the file header counts them, so keep that count truthful. If a second
  app wants the same override, it belongs in the kit instead.
- **localStorage is namespaced `sfsa-ngp-*`** (`year`, `type`, `variable`,
  `drawer`, `seen-intro`, `view`, `dataset-<view>`, `type-<dataset>`), all
  collected in `LS` in `js/app.js` and every one re-validated on read exactly
  like a URL param. The single exception is `sfsa-theme`, which is shared
  org-wide on this origin and written only by the kit's `initThemeToggle`.
- **The URL is the primary state**, read once at boot with precedence
  URL > localStorage > default. A view entirely at defaults must emit **no query
  string at all**; `?kbd=off` is the WCAG 2.1.4 opt-out for the `/` shortcut and
  is never persisted.
- **Kit URLs are pinned and consistent.** Mixing versions is forbidden: two
  `core.js` URLs are two module instances and therefore two `viewport`
  pub-subs. Sweeping them for local kit development is all-or-nothing across
  `index.html`, every file under `js/` (including `js/interfaces/` and
  `js/decoders/`), and `tools/verify.mjs` (one hoisted `KIT_COUNTY_URL`
  constant) — recipe and the prod-ward return trip are in README § Developing
  against an unreleased kit.
- **Do not edit the inline anti-flash `<script>` in `index.html`.** Its
  `sha256` is pinned in the page's CSP `<meta>`, the recompute recipe is
  commented above the block, and the failure mode is silent (the theme still
  renders; the flash just comes back).
- **`#county-card`'s interior is a contract.** `fillCard()` in `js/app.js` and
  the `MutationObserver` on `#card-rows` in `js/card-content.js` are written
  against those ids. The kit's `dock-right` / bottom-sheet geometries are
  CSS-only for exactly that reason.
- **Every `loadCounties()` result must pass through `projectCounties()`**
  (`js/projection.js`) before anything touches it — the map renders a dummy
  EPSG:5070 space, not lng/lat. Both existing call sites (boot and the 2015
  vintage swap) already do; a new one that forgets will draw a second, tiny
  geographic country near (0,0). Bounds are `PROJECTED_BOUNDS`, never the
  kit's `COMPOSITE_BOUNDS`; `?lng`/`?lat`/`?zoom` are dummy-space positions.
  The why, the reference table, and the rescale constants live in the
  `js/projection.js` header.

## Where we left off (2026-08-20, PR 2 of the four-interface expansion)

The app is mid-way through the **four-interface expansion** (approved plan:
the administration story in four acts — 1 · Grazing periods, 2 · Drought
monitor (USDM weekly), 3 · LFP eligibility, 4 · Disaster designations — one
PR per interface, shared year/county/camera/theme surviving every switch).
**PR 1 (framework + nClimGrid) is merged; PR 2 (`feat/usdm-interface`) is
complete and green** (verify.mjs prints its own count — currently 299/299;
axe clean 2 themes × 2 viewports × 8 states; html-validate clean):

- The **interface framework** (PR 1): "What to show" switcher (top of the
  drawer, absent-until-shipped), `?view=` / `?dataset=` params (elided at
  defaults — every pre-feature URL keeps its meaning), per-interface
  `viewState`, descriptor registry (`js/interfaces/`), decoder factories
  (`js/decoders/`), three legend bodies, readiness markers (`ngpReady` once
  at boot; `data-ngp-view`, monotonic `data-ngp-view-seq` — bumped only by
  fetch-involving transitions, never week scrubs — `data-ngp-view-error`).
- **1 · Grazing periods**: FSA official (boot) + nClimGrid climatology (lazy;
  Census-FIPS keys joined through `assets/fsa-fips-crosswalk.json`,
  record-level max-duration reduction, "Combined from" card rows,
  nominal-years slider disable). The county card's span chart draws a
  climatology reference band whenever the other payload is already cached.
- **2 · Drought monitor** (PR 2): `usdm-max-class/1` × three archives —
  default **FSA LFP boundaries** (CT-clean; NDMC-reported keys Connecticut
  only as planning regions the crosswalk cannot map, so CT is honestly
  uncolored there and counted in the live region). Week-within-year scrubber
  (`?week=` 1-based, elided at the year's latest week; a selection, never
  persisted), NDMC class colors + a warm `None` neutral (`#f0ead8`, distinct
  from `--no-data` — see js/interfaces/usdm.js), swatches legend, full-record
  heatmap card (week scrubs move a marker, never rebuild the SVG), NDMC
  attribution drawn into exported posters. Year domain re-authors per
  interface (USDM reaches 2000); an out-of-domain shared year clamps AND
  announces.
- **Satellites are descriptor-driven** (PR 2): card-content.js and
  table-view.js are generic lifecycle shells delegating to
  `iface.cardBody`/`iface.table.*`; export.js dispatches title/filename/
  legend painting per descriptor. `js/data.js` stays an NGP-shaped facade
  ONLY — app.js holds the active instance and mirrors into the facade just
  for NGP datasets (documented at the declaration).
- Earlier shipped state still holds: two-drawer layout (kit v0.2.0),
  reveal-push, EPSG:5070 client-side pre-projection, runtime payload fetch
  (manifest: `tools/payloads.txt`).

Open threads, in rough priority order:

1. **PR 3 — LFP eligibility interface** (fsa-lfp-eligibility/1 × 3 archives +
   the derived archive's 4 aggregation conventions; new CVD-safe
   drought-factor ramp asset; drought-only — Fire needs an archive-side
   payload addition first). Then **PR 4 — Disaster designations**. The verify
   section template (`verifyInterfaceSection`) and a11y state pattern are
   proven now.
2. **Annual maintenance tripwire**: both descriptors declare
   `years: {min, max}` (currently max 2026). When the USDM archive rolls into
   a new year, `applyYearDomain` console.warns and the console-clean gate
   fails until the descriptors' `years.max` are bumped — deliberate, so the
   slider ceiling never silently lags the data.
3. **Crosswalk lineage**: `assets/fsa-fips-crosswalk.json` is committed here
   for now; moving it behind an archive-published Pages URL is a one-line
   URL change in `js/decoders/crosswalk.js`. A CT planning-region extension
   (needs Census relationship files) would let NDMC-reported paint
   Connecticut.
4. **Compact reveal is best-effort only**: the bottom sheet gets a
   mesonet-style pan, which the bounds cage clamps at the fit floor. A
   vertical push (`#map { bottom: var(--sheet-h) }` + resize, mirroring the
   desktop push) is the symmetric fix if it ever matters on phones.
5. **Archive-side projected artifact (optional)**: fsa-counties-dd17/dd22
   already build the composite in Albers (`tigris::shift_geometry`,
   ESRI:102003) and unproject one line before publishing. Publishing a
   projected TopoJSON and pointing the kit's `BOUNDARY_URLS` at it (kit
   v0.2.1+) would move the projection from `js/projection.js` into the data.
   Client-side is a lossless inverse, so this is lineage hygiene, not a fix.
6. `tools/AUDIT-CHECKLIST.md`'s three manual passes have not been walked
   since the drawer restructure; the plan calls for the full walk at PR 4.

(The pre-expansion thread "fsa-lfp-eligibility-web drawer adoption" as a
separate app is superseded — eligibility lands here as interface 3.)
