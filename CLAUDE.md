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
in index.html (https://sustainable-fsa.com/style/v0.4.1/…). Design tokens,
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
- **Never write a kit layer id as a literal, and never hold one.** From kit
  v0.4.0 the tiled path keeps more than one archive's geometry on the map — that
  is what makes a change of authority arrive without a blank — so its layer ids
  carry a stack slot suffix (`sfsa-county-fill#0`) and they MOVE when the front
  does. Ask `handle.layers` at the moment of use. A retired stack is transparent
  rather than hidden, which is what keeps it warm for the trip back, so it still
  answers `queryRenderedFeatures`: a stale literal does not fail loudly, it
  quietly measures the archive the reader stopped looking at. `tools/verify.mjs`
  holds no source id and no layer ids for this reason.
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
- **Nothing is projected client-side any more, and `projectCounties()` is
  gone.** That bullet used to say the opposite: every `loadCounties()` result
  had to pass through it. Geometry now ARRIVES in the dummy EPSG:5070 space —
  `data-tiles` builds both the tiles and the sidecars' bounding boxes through
  the same transform, gated against the twelve reference points in
  `js/projection.js`'s header to 1e-9 dummy degrees — so a call to a projection
  would be a double application that flings the composite into the next
  hemisphere.

  What replaces it is the other half of the same discipline, and it **cannot be
  forgotten** because it does not live at a call site: `assertProjectedSpace()`
  runs inside `loadBoundary()`, the only loader. It throws rather than warns. A
  misregistered authority lines up at the centre of the map and drifts at the
  edges, with nothing on screen to say so, and the error is largest exactly
  where a reader zooms in to compare two county sets. It compares with a
  TOLERANCE, not `===`: R prints 15 significant digits where JS round-trips at
  17, so the published bounds differ from `PROJECTED_BOUNDS` by 1.8e-15.

  Bounds are still `PROJECTED_BOUNDS`, never the kit's `COMPOSITE_BOUNDS`;
  `?lng`/`?lat`/`?zoom` are still dummy-space positions. `projectPoint()` and
  the reference table stay, because they are the cross-repo SPECIFICATION the
  producer is checked against.

- **Geometry is per-dataset, and the authority is declared, never inferred.**
  `js/boundaries.js` owns the catalogue and the **two independent vintage
  resolvers** — FSA's program-year split, and the Census annual TIGER vintage,
  eighteen of them. They must never meet in one function. Every dataset
  descriptor names its authority in one field (`boundary: 'fsa' | 'fsa-lfp' |
  'census'`), and `ensureBoundary()` is the only thing that changes what is on
  the map.

  `sel.vintage` means the **FSA** axis and nothing else — it is what indexes the
  crosswalk. `sel.boundary` is what is drawn. On the drought monitor they are
  unrelated: a map on the 2011 Census counties has an FSA vintage of `dd17`,
  and a leaf that reached for the drawn authority's vintage there would index
  the crosswalk with `'2011'` and match nothing.

  A crosswalk is needed **exactly** when `dataset.keySpace !== authority
  .keySpace` (`needsCrosswalk()`), which is why no dataset declares a join.
  Two datasets still cross: the nClimGrid grazing periods and the disaster
  designations.

- **A tripwire has to be `console.error`, not `console.warn`.** Both harnesses
  collect `m.type() === 'error'` only (`tools/verify.mjs`,
  `tools/a11y-audit.mjs`), so a `warn` gates nothing. Both known tripwires now
  comply: the Census vintage tripwire in `js/boundaries.js` and the
  year-domain `years.max` tripwire in `applyYearDomain` (`js/app.js`), fixed
  2026-08-26 after two releases of gating nothing.

## Where we left off (2026-08-26)

**The Drought monitor now draws the drought itself.** The *USDM polygons*
toggle lays the selected week's actual Drought Monitor map over the county
choropleth — translucent (`fill-opacity` 0.45 by default, the same NDMC class
hexes, `CLASS_HEX` in js/interfaces/usdm.js), between the front county fill
and the county lines, so every thin line, the state mesh and the selection
ring stay on top. OFF by default; `?polygons=on`, elided at off; LS
`sfsa-ngp-polygons-usdm`. An owner-requested **opacity slider** (same day)
sits under the toggle while it is On: 0–100 step 5, default 45, `?opacity=NN`
elided at the default, LS `sfsa-ngp-opacity-usdm`, honored by the poster —
NOT a `choices` value (it is a number, not an enumeration), so it carries its
own validating accessor, and `fill-opacity` is safe to retune live because it
is a constant on a transition-free layer (neither half of the v0.4.1
failure). It is the FIRST USER of the dormant
`descriptor.choices` mechanism, which supplied the URL param, the LS key, the
boot re-validation and the aria-pressed sync with zero new plumbing. The
owner's call, twice: translucent over the live choropleth (not a paint swap),
and NO masking — the polygons are published unclipped at ~1:2M and are drawn
exactly as published, coastline overspill and all, with the control note and
help.md saying so.

**`js/usdm-overlay.js` owns everything about it** — the sidecar, the per-week
TopoJSON fetch/decode LRU (cap 8; raw weeks trend hard upward, 0.45 MB in 2000
to 2.25 MB in 2026), one GeoJSON source + one fill layer, and the settle
marker `data-ngp-overlay` (absent | `loading` | `YYYY-MM-DD` | `missing` |
`error`; the ISO stamps only after `isSourceLoaded` + double rAF). app.js
calls exactly one reconciler, `syncUsdmOverlay()`, from the tail of
`recolor()` and `syncSections()`, and re-anchors in `swapBoundary()` after the
flip (`swapVintage` inserts the arriving stack BELOW the lowest resident
layer, so a mid-stack app layer is stranded above the new stack on every swap
— `handle.layers.line`, read at the moment of use, is the anchor both there
and at creation). A week scrub refetches WITHOUT bumping `data-ngp-view-seq`;
the marker, not the pill, is the overlay's settle signal.

**The week cutover is FUSED (2026-08-27, owner-reported).** With the overlay
on, a scrub used to repaint the counties instantly and the polygons a fetch
later — two cutovers, and the old polygons were CLEARED at scrub start. Now
`recolor()` packages its whole apply-tail (`handle.recolor`, the live
region, the card) into `sync({onSettle})`, and the module releases it in the
SAME TASK as the incoming week's drawable `sourcedata` — the old coherent
picture (old counties + old polygons) holds through the fetch, then one
flip. Clear-before-fetch is REVERSED: it existed because the counties moved
first; under the hold, old-over-old is the truth. Not fusing (toggle-on from
nothing, same-week recolors, the other families) is byte-for-byte the old
synchronous path; failures and `missing` still release the tail (the county
repaint is never lost to the overlay); a 6 s `HOLD_CEILING_MS` releases it
if a fetch never answers, because `applyDataset` now AWAITS `recolor()`
before `bumpViewSeq` — the seq marker means "recolored and flushed" and must
not lie over a held tail. Measured: counties never lead the polygons (0
ticks, structurally — the tail releases only after `isSourceLoaded`); the
residual is ONE ~16 ms rendered frame of new polygons over old counties,
because the kit's `recolor()` coalesces feature state to its own rAF while
MapLibre queues a render before firing `sourcedata`. Closing that last
frame needs a synchronous feature-state flush in the kit — a v0.4.2
candidate (§ Open threads). Pre-fix the mismatch was the whole fetch,
270–480 ms.

Three facts measured on the way in, worth not rediscovering:

- **MapLibre 5.18 fires `sourcedata` with `sourceDataType: 'metadata'` and
  `isSourceLoaded: true` computed from the PREVIOUS data** immediately on
  `setData()`, before the tile manager reloads — a stamp listener that
  ignores that filter announces the new week over the old picture. The module
  filters it; the fake-map test reproduces it.
- **An aborted in-flight week must be evicted from the LRU synchronously at
  abort time**, not at rejection time — scrub away and straight back
  otherwise hangs the marker on `loading` forever, waiting on a promise whose
  fetch was already cancelled.
- **`queryRenderedFeatures` on a layer the style does not hold does not
  throw** — it reports through the map's error event, straight into the
  console the harnesses collect. Same lesson as the missing-`sourceLayer` one
  from the tiled cutover; the harness probe gates the query on `getLayer()`.
- **`queryRenderedFeatures` does not read the frame** (2026-08-27): it
  answers from the source cache as soon as the worker's tiles land, BEFORE
  the frame that draws them — and `getFeatureState` flips at the kit's
  coalesced rAF flush, one frame AFTER the app applies. A frame probe built
  on "rendered means painted" fails a correct app; the fused-cutover gate's
  witnesses read the SAME PIXEL (a point query at the fixture county's
  centroid) and the hard-zero direction is "counties never lead", which is
  structural. Ground truth on actual pixels needs `map.on('render')` +
  scanline reads.

Gates after: verify prints 580 (was 535 — new `8e` in `usdmExtraChecks`,
including the slider's eight, plus the fused cutover's own section running
the frame probe COLD then WARM, plus
`data-ngp-overlay` in the MARKERS table and the `overlay` fixture block in
tools/config.mjs, all driven at the frozen 2012-07-24 week, never the moving
newest); the a11y `usdm-view` state now audits with the overlay ON;
check-boundaries grew a § 9 that walks the live sidecar and the newest week
(26 checks). Same day, PR #12 connected the `years.max` tripwire
(`console.error`, finally collected) after measuring every shipped payload
inside the 2000–2026 whitelist.

## The buffered authority swap (shipped 2026-08-23)

**A change of county authority no longer shows the reader a hole**, and the
reader who reported it was right twice over: it flashed twice for an archive
that had not been fetched yet and once for one that had.

### What was actually happening

Three wrong maps in about 600 ms, measured per rendered frame on a switch from
the 2025 Census counties to the FSA LFP determination boundaries (local server,
warm CDN). The witnesses were the id rendered at a point in Connecticut — eight
traditional counties on one authority, nine planning regions on the other — and
the feature-state colour on a county both sets have:

| t | `ngpBoundary` | id at a CT point | 48001 | what a reader saw |
| --- | --- | --- | --- | --- |
| 32 ms | census-counties-2025 | `09190` | `#fcd37f` | the census map |
| 359 ms | fsa-lfp-counties | `09190` | *(none)* | **grey** — the wipe, repainted a frame late |
| 460 ms | fsa-lfp-counties | `09190` | `#ffff00` | **the new numbers on the OLD polygons** |
| 563 ms | fsa-lfp-counties | *none* | `#ffff00` | **blank** — `clearTiles()` |
| 963 ms | fsa-lfp-counties | `09005` | `#ffff00` | the LFP map |

The middle row is the one that mattered most here: for ~100 ms the app painted
one dataset's numbers on another authority's boundaries — the exact
misregistration `js/boundaries.js` exists to prevent — and it did so THROUGH the
machinery meant to prevent it. `applyDataset()` awaited the swap before
painting, deliberately and with a comment saying why, but **`setUrl()` does not
clear its tiles when it is called; it clears them when the new TileJSON
resolves**, which is a pmtiles header plus two directory range reads later.

### What replaced it

Kit **v0.4.0**: `swapVintage()` is double-buffered and awaited. The incoming
archive gets its own source and its own six layers at zero opacity, is handed
the colours and the selection while nobody can see it, and is flipped to — one
`setPaintProperty` per layer, zero-duration transitions — only once it is really
drawable. The outgoing stack keeps drawing the last true picture until that
instant. Retired stacks stay resident (cap two, counting the front) and
transparent rather than hidden, because **a hidden layer's source is never
updated by MapLibre**, so a hidden buffer would not be warm to come back to.

App side, three things:

- `swapBoundary()` computes the arriving geometry's colours FIRST (`colorsNow()`)
  and hands them to the swap, so the wipe and the repaint are one task; and
  everything downstream of the flip — `boundary`, `counties`,
  `data-ngp-boundary`, the card, the search index, the live region — now happens
  after it, so the marker means "this authority is on screen" rather than "has
  been asked for".
- **Warm on intent.** `pointerenter`/`focus` on a dataset or view button warms
  the archive that click would need (`handle.warmGeometry`); the year slider
  warms the OTHER FSA vintage, and deliberately nothing on the Census axis,
  where eighteen annual archives and a slider that has not moved yet give no
  honest direction to guess.
- **The payload and the geometry now fetch in parallel.** They were serial —
  payload awaited, then the archive looked for — and overlapping them took a
  cold dataset switch from ~1,180 ms to ~790 ms. The rest is the 4.4 MB payload,
  which is why there is still a pill.

Measured after: one transition, two states, nothing in between. A cold switch is
~790 ms, a warmed one ~330 ms, and the trip BACK is ~250 ms with no refetch at
all — which is what makes *Census counties* ⇄ *FSA LFP boundaries* at z14–15,
the app's sharpest demonstration, finally feel like a comparison.

**A year step on the Census authority still costs a full warm-up** (~1.4 s,
250 ms of it the scrub debounce), and during it the map holds the PREVIOUS
year's colours behind the pill. That is pre-existing behaviour — the old code
skipped the recolour across a pending swap too — and it is the honest one while
each year is a separate archive.

## The per-dataset geometry cutover (shipped 2026-08-23)

**Every dataset now draws the polygons its own numbers were computed against.**
That was the whole job, it is shipped, and the geometry is PMTiles vector tiles
instead of one simplified TopoJSON.

### What changed, and what it bought

The app drew ONE county composite — FSA's administrative boundaries — under all
four interfaces, and bent every FIPS-keyed payload onto it through the
crosswalk. Measured, on the drought monitor, the counties whose data reached no
polygon at all:

| dataset | crosswalked onto dd22 | on its own polygons |
| --- | --- | --- |
| `usdm-counties-fsa-lfp` | 131 | **0** — an exact identity, 3,221 = 3,221 |
| `usdm-counties-reported` | 140 | **9** — Connecticut's planning regions |
| `usdm-counties` | 159 | **13** — the dropped territories, and only from 2012, because that is when they start reporting |

The 9 and the 13 are real and still counted out loud. The 131 was an artifact.

### The three authorities and the two axes

`js/boundaries.js` is the only module that knows which polygons a selection may
be drawn on. Three authorities — `fsa` (FSA county codes, dd17/dd22 by program
year), `fsa-lfp` (Census FIPS, one FOIA snapshot for the whole record), `census`
(Census FIPS, eighteen annual TIGER vintages) — and each dataset names one in a
single `boundary:` field. No functions: the eligibility view's aggregation
picker chooses which drought convention recomputed the ladder, not which
polygons it lands on, so all three of its datasets declare `fsa`.

**The two vintage axes are independent and must never share a resolver.** See
the House style bullet above; the short version is that `sel.vintage` is the FSA
axis (it indexes the crosswalk) and `sel.boundary` is what is drawn, and on a
drought map they are unrelated.

`censusVintageFor(Y) = clamp(max{v ≤ Y−1}, 2000, newest)`, verified against the
published data rather than the R source: `usdm-counties.json`'s `'.'` sentinels
make each year's county set observable, and it equals the resolved vintage's
sidecar set exactly for **all 27 years**. `tools/check-boundaries.mjs` re-runs
that in CI, and an injected off-by-one fails five of its assertions.

### Facts worth not rediscovering

- **`census-counties-2022` and later carry Connecticut's NINE PLANNING REGIONS**
  (`09110`–`09190`), not its eight traditional counties. So on the Census
  authority Connecticut changes shape at program year 2023. Asserted.
- **`fsa-lfp-counties` and `census-counties-2020` are the same id set with
  different geometry** — 3,221 each, zero symmetric difference. The LFP set is
  unclipped and not edge-matched. Flipping between those two at z14–15 is the
  app's sharpest demonstration of why any of this mattered.
- **MapLibre does not throw when `sourceLayer` is missing.** It fires an error
  event and returns; `getFeatureState` answers `undefined`. The first symptom
  was twenty "the choropleth repainted" failures in `verify.mjs` against an app
  that was painting perfectly — the HARNESS was reading feature state without
  it. Everything goes through `handle.featureRef()` now, app and harness alike.
- **The tiles are `max-age=3600`, deliberately NOT `immutable`**, because the
  filenames are stable across rebuilds. `tiles.url` is resolved relative to the
  sidecar so the producer can rename or content-hash without a consumer change;
  never compose an archive filename from a key.
- **`maxZoom` is 19, and it is arithmetic**: z15 at extent 8192 quantizes to
  0.720 m, and one CSS pixel at display zoom 19 is 0.720 m. Past that the reader
  is zooming into the quantization.

### Cross-repo state

- **kit v0.4.1** is released, live and tagged, and is what this app pins — the
  DOUBLE-BUFFERED `swapVintage()`, `warmGeometry()`, `handle.geometry()`,
  `addCountyLayers({buffers, swapTimeoutMs})`, and the slot-suffixed tiled layer
  ids. Its gate is `tools/check-tiled.mjs`, now 81 assertions, and several have
  teeth: a pixel-level one that colours dd22's eight Connecticut counties blue
  and census-2022's nine planning regions green and reads the centre pixel on
  every rendered frame of a swap (every frame is one authority or the other,
  never grey, never background); two eviction ones that caught a warm-up
  disposing the archive it had just fetched; and two that hold the invariant
  v0.4.1 exists for.
- **NEVER FLIP A DATA-DRIVEN PAINT PROPERTY, AND NEVER TRANSITION ONE.** v0.4.0
  hid a retired stack by zeroing every layer's opacity, and the hover layer's
  `line-opacity` is the feature-state `['case', …]` that decides which county
  wears the halo. Flipping that property while the zero-duration transition is
  declared on it leaves MapLibre's paint binder holding a value whose
  `expression` has no `evaluate`, and the NEXT feature-state change — the next
  mouse move — throws `TypeError: this.expression.evaluate is not a function`
  inside a render, which is an uncaught page error rather than a rejected
  promise, so the transition it belonged to stops half-done. **THIS SUITE COULD
  NOT REPRODUCE IT LOCALLY**; CI could, because a runner hovers and swaps closer
  together. Hence `VERIFY_THROTTLE` / `VERIFY_STACKS` in `tools/verify.mjs`
  (§ open) — CPU throttling and full stack traces, inert unless set. The forty-
  line reduction is what isolated it: flipping `line-opacity` throws only WITH
  the transition, and flipping `line-width` never throws. v0.4.1 hides the hover
  layer by width.
- **kit v0.3.0** brought the tiled path in `county/county.js` —
  `loadCountyIndex`, `handle.featureRef`, `MAX_BOUNDS_PAD_DEG`,
  `captureCompositeMap({idleTimeoutMs})` + `timedOut`. `BOUNDARY_URLS` and
  `loadCounties()` are byte-identical through v0.4.0, so TopoJSON consumers on
  v0.2.1 are untouched — and the canonical six layer ids are still theirs,
  unsuffixed.
- **`data-tiles`** publishes 21 tilesets (dd17, dd22, fsa-lfp, census
  2000 + 2009–2025), each with a `-index.json` sidecar and an
  `-outline-dummy.geojson`. `census-counties` unblocked and published
  2026-08-22, so the whole upstream chain is live.
- **`data-tiles` also publishes the USDM weekly polygons** (2026-08-22, weekly
  Thursday cron), and they are NOT tiles: one TopoJSON per week
  (`usdm/USDM_{date}.topojson`, object `usdm`, quantization 1e6), because a
  week is 3–5 non-overlapping MultiPolygons of ~1:2M data with nothing to
  simplify. The sidecar `usdm/usdm-index.json` (`sfsa-usdm-index/1`) names
  every week in the archive and the URL template; the geometry arrives in the
  same dummy space through the same `to_dummy` transform as the county tiles.
  Published UNCLIPPED — the app draws it as published (§ Where we left off).

## The four-interface expansion (shipped 2026-08-20)

The **four-interface expansion is done**: the administration story in four
acts — displayed as 1 · Drought monitor (USDM weekly), 2 · Grazing periods
(the default view), 3 · LFP eligibility, 4 · Disaster designations, per the
owner's 2026-08-21 reordering — landed as four serial PRs plus a
refinements PR, with
shared year/county/camera/theme surviving every switch and per-interface
memory for everything else. Gates at completion: verify.mjs prints its own
count — 494 at that release, 518 after the boundary work, 535 after the
buffered swap; axe clean
2 themes × 2 viewports × 11 states;
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

## Open threads

The USDM weekly-polygon overlay shipped 2026-08-26 (§ Where we left off), which
closes the producer thread that used to lead this list. App-side, in rough
priority order:

1. **Manual AUDIT-CHECKLIST walk** — the three passes automation cannot do
   (keyboard-only, 375 px on a real phone, the figures pass). The overlay adds
   one: toggle *USDM polygons* on at a coastal county and confirm the
   drought's own edge visibly overruns the coastline (that is the published
   map) while the county lines stay crisp above it — and that the toggle is
   keyboard-reachable and warms on focus. Still standing are the two items
   the tiled path added: at maximum zoom on one county the boundary must be
   smooth, and flipping *Census counties* ⇄ *FSA LFP boundaries* at z14–15 on
   one coastal county must visibly move the boundary without moving the camera.
   That flip is now instant in both directions (both archives stay resident), so
   the pass is a real A/B comparison rather than a wait — and the keyboard-only
   walk should confirm that focusing a dataset button warms it, since `focus` is
   the keyboard's half of warm-on-intent and touch has no hover at all.
2. **One rendered frame still mismatches on a fused week cutover** — ~16 ms
   of the new polygons over the old counties, measured on framebuffer
   scanlines (§ Where we left off). The app cannot close it: the kit's
   `recolor()` coalesces feature state to its own rAF, and MapLibre's
   `Map._onData` queues a render before it fires `sourcedata`. The fix is a
   kit **v0.4.2** candidate — a synchronous feature-state flush the app can
   call inside the drawable task — and `check-tiled.mjs` would want a frame
   gate like the app's. One frame, one property, but it is the same class of
   honesty the buffered swap bought, and the seam is known.
3. **A cancelled tile request used to be reported as an error.** MapLibre
   decides whether a rejection was a cancellation with exactly one test —
   `err.name === 'AbortError'` — and an aborted `fetch()` does not always reject
   with that name; at the network layer Chrome gives
   `TypeError: Failed to fetch` (`net::ERR_ABORTED`). Kit **v0.3.1** normalises
   the cases where the abort controller is demonstrably the cause, which
   silenced every swap-time instance. (The swap no longer calls `setUrl()` at
   all, so that particular cancellation is gone with it; camera moves and map
   teardown still abort tiles, and the normalisation is still what keeps them
   quiet.)

   The remaining one was on the export path, and it was diagnosed rather than
   tolerated: the app builds a **throwaway offscreen map** for the PNG, and
   MapLibre falls back to `console.error` only when NOTHING is listening. An app
   that creates a map and does not own its errors has left them to the console.
   `js/export.js` now attaches an `error` listener, and
   `console clean · export run` passes. The listener logs a WARN rather than
   swallowing: the poster's own validity is asserted separately (PNG magic
   bytes, >100 KB), which is the check with teeth if a tile failure ever
   actually matters.

   Two dead ends worth not re-walking. The shared-`pmtiles`-cache hypothesis —
   an abort by one map poisoning a cache entry for another — was **tested and
   disproved**: a second map is unaffected when the first is removed mid-flight.
   And eight isolated reproductions of `?export=light` came back clean, which is
   why this took two harness changes to place: the source LOCATION in the
   console capture (now permanent, and what put it in the bundle rather than in
   app code), then a `requestfailed` listener to name `net::ERR_ABORTED`.
3. **Kit gap worth a CONSUMERS.md note**: `scrollable-region-focusable`
   fires on any `.sfsa-card-body` whose content has no focusable element at
   compact widths — the other views escape only because their card bodies
   contain a `<details><summary>`. The durable fix belongs in the kit's
   card component; this app carries a per-view `tabindex="0"` meanwhile.
4. **Fire events for eligibility** remain out of scope until the archive
   adds them to an events payload.
5. **Crosswalk lineage**: `assets/fsa-fips-crosswalk.json` is committed here
   for now; moving it behind an archive-published Pages URL is a one-line
   URL change in `js/decoders/crosswalk.js`. It now serves TWO datasets rather
   than five — the nClimGrid grazing periods and the disaster designations —
   because everything else draws its own polygons.
6. **Connecticut on the NDMC-reported set** stays uncoloured, and that is
   honest: the archive keys nine planning regions and the FSA LFP determination
   boundaries answer eight traditional counties. Drawing it would need a
   planning-region tileset, which nobody publishes. The *Census counties*
   dataset already shows Connecticut correctly from program year 2023.
7. **Compact reveal is best-effort only**: the bottom sheet gets a
   mesonet-style pan, which the bounds cage clamps at the fit floor. A
   vertical push (`#map { bottom: var(--sheet-h) }` + resize, mirroring the
   desktop push) is the symmetric fix if it ever matters on phones.
8. **The card's "Combined from" rows are gone from the drought view**, and that
   was a real loss to the reduction story, not an oversight — an identity
   authority has no constituents. It survives on the two views that still
   crosswalk.

(The pre-expansion thread "fsa-lfp-eligibility-web drawer adoption" as a
separate app is superseded — eligibility lands here as interface 3. The
"archive-side projected artifact" thread is superseded too: the projection now
lives in `data-tiles`, which is where that thread wanted it.)
