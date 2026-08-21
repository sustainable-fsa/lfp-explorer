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
in index.html (https://sustainable-fsa.com/style/v0.2.1/…). Design tokens,
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

## Where we left off (2026-08-20, the four-interface expansion is complete)

The **four-interface expansion is done**: the administration story in four
acts — displayed as 1 · Drought monitor (USDM weekly), 2 · Grazing periods
(the default view), 3 · LFP eligibility, 4 · Disaster designations, per the
owner's 2026-08-21 reordering — landed as four serial PRs plus a
refinements PR, with
shared year/county/camera/theme surviving every switch and per-interface
memory for everything else. Gates at completion: verify.mjs prints its own
count — currently 494; axe clean 2 themes × 2 viewports × 11 states;
html-validate clean; LHCI a11y 1.0:

- The **interface framework** (PR 1): "What to show" switcher (top of the
  drawer, absent-until-shipped), `?view=` / `?dataset=` params (elided at
  defaults — every pre-feature URL keeps its meaning), per-interface
  `viewState`, descriptor registry (`js/interfaces/`), decoder factories
  (`js/decoders/`), three legend bodies, readiness markers (`ngpReady` once
  at boot; `data-ngp-view`, monotonic `data-ngp-view-seq` — bumped only by
  fetch-involving transitions, never week scrubs — `data-ngp-view-error`).
- **2 · Grazing periods** (the DEFAULT view — display order ≠ default):
  "FSA Official (FOIA)" (boot) + "NAP-190 Derived (nClimGrid)" (lazy;
  Census-FIPS keys joined through `assets/fsa-fips-crosswalk.json`,
  record-level max-duration reduction, "Combined from" card rows,
  nominal-years slider disable). The county card's span chart draws a
  climatology reference band whenever the other payload is already cached.
- **1 · Drought monitor** (PR 2): `usdm-max-class/1` × three archives —
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
- **3 · LFP eligibility** (PR 3): `fsa-lfp-eligibility/1` × three archives —
  FSA official (FOIA, default; its record ends at 2025 and the shared year
  clamps onto it with a "has not published" announcement), FSA weekly web,
  and Derived-from-USDM (11 MB; a `source` picker for its four
  county-aggregation conventions, defaulting to FSA LFP boundaries like the
  Drought monitor). FSA-keyed — no crosswalk in the paint path; the parallel
  `fips` column is card provenance. Two variables: **Months** (the new
  frozen DF ramp `assets/colors-df.json` — slate index 0 = "months not
  stated", lazily loaded, `build_df_ramp()` reproduces it byte-for-byte) and
  **Qualifying date** (the romaO wheel; undated 2008–2011 rows paint the
  slate). `?variable=` now validates per interface. "All types (worst
  case)" sentinel; event-level table; derived exports carry a
  "not an official FSA determination" credit. Key data facts: months = `pf`
  never `df` on official/web (df is uncapped); `pf`/`mepm` are
  determination-level values repeated on every event; official ≡ web
  paint-identically for shared years (web's value is 2026 + the weekly
  snapshots); the payloads carry no county names (the geometry gazetteer
  names rows).
- **Satellites are descriptor-driven** (PR 2): card-content.js and
  table-view.js are generic lifecycle shells delegating to
  `iface.cardBody`/`iface.table.*`; export.js dispatches title/filename/
  legend painting per descriptor (+ `export.legendLines` since PR 3).
  `js/data.js` stays an NGP-shaped facade ONLY — app.js holds the active
  instance and mirrors into the facade just for NGP datasets (documented at
  the declaration).
- Earlier shipped state still holds: two-drawer layout (kit v0.2.0),
  reveal-push, EPSG:5070 client-side pre-projection, runtime payload fetch
  (manifest: `tools/payloads.txt`).

- **4 · Disaster designations** (PR 4, narrowed by the refinements PR):
  `fsa-disasters/1`, two-table normalized, FIPS-keyed → crosswalked. **The
  map is hardwired to Secretarial designations for drought** — the LFP
  corner of the archive; Presidential declarations and the other 21
  disaster types live in the archive downloads (`?decl=`/`?disaster=` and
  their LS keys are retired; the generic `descriptor.choices` mechanism
  remains in app.js, currently unused). Primary `#DC0005` beats Contiguous
  `#FD9A09` everywhere. Junk is policy: the year string `"2011, 2012"` (94
  rows) and 72 malformed county keys (249 rows) never match a clean year or
  the crosswalk — they render verbatim in the data table only and are
  counted out loud in the live region. The card is a declaration list (its
  own accessible twin; `tabindex="0"` because `.sfsa-card-body` scrolls at
  compact — see the kit-gap open thread). A county being Contiguous under
  later declarations while already Primary is the archive's real structure
  (each declaration names its own primary set; neighbors get contiguous
  status per declaration) — verified 2026-08-21, not a defect.
- **Refinements PR (2026-08-21, owner-requested)**: switcher display order
  ≠ default; NGP dataset labels "FSA Official (FOIA)" / "NAP-190 Derived
  (nClimGrid)"; USDM dataset display order Census counties · NDMC reported
  · FSA LFP boundaries (default decoupled from array position via a
  declared `default: true` + `defaultDatasetOf()`); the eligibility derived
  source picker offers three of the payload's four conventions ("Census
  Counties" = vintage-matched; Census 2020 UI-retired, slug falls back with
  a warn); disasters toggles removed as above.
- **Kit v0.2.1 (2026-08-21)**: the selection ring. The kit filtered its two
  `sfsa-county-selected*` layers on `['==', ['id'], id]`, and `promoteId`
  notwithstanding, the tile encoder behind the FILTER path coerces a
  numeric-looking id to a number — `'01001'` → `1001` — so the comparison
  was string-vs-number and the ring never drew for ANY selection this app
  made. Measured: `queryRenderedFeatures` returned 0 on both layers while
  the fill returned 3,232. Fixed in the kit (v0.2.1 compares `['get', 'id']`,
  the property, which is never coerced) and picked up here by the pin sweep;
  there was no app-side workaround to remove. `['to-string', ['id']]` is NOT
  a fix — it yields `'1001'`. verify.mjs now asserts the PAINT (not the
  filter, which was the bug) for the run's county AND for a leading-zero id,
  plus that the ring clears when the card closes.

Open threads, in rough priority order:

1. **Manual AUDIT-CHECKLIST walk** — the plan's PR-4 gate that automation
   cannot do: the three manual passes (keyboard-only, 375 px on a real
   phone, the figures pass) against the finished four-interface app, and
   updating the checklist's manual sections to name the new controls.
2. **Kit gap worth a CONSUMERS.md note**: `scrollable-region-focusable`
   fires on any `.sfsa-card-body` whose content has no focusable element at
   compact widths — the other views escape only because their card bodies
   contain a `<details><summary>`. The durable fix belongs in the kit's
   card component; this app carries a per-view `tabindex="0"` meanwhile.
3. **Fire events for eligibility** remain out of scope until the archive
   adds them to an events payload.
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
