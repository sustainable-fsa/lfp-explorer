/* ============================================================================
   LFP Explorer · js/scale-bar.js
   A distance scale for a map whose coordinates are not distances, over a
   composite whose four parts are not drawn at the same size.

   ES module, no build step, no dependencies beyond the projection's own scale
   constant. `addScaleBar(map)` is the whole surface.

   ── Why MapLibre's own ScaleControl is not used here ───────────────────────
   `maplibregl.ScaleControl` measures the map the only way a general-purpose
   control can: it unprojects two screen points and asks how far apart those
   LNG/LAT COORDINATES are on the WGS84 ellipsoid. That is right on every map
   whose coordinates are real degrees, and this one's are not. Geometry arrives
   pre-projected into EPSG:5070 and rescaled into a fixed 10 × 6.07 box of dummy
   degrees around (0, 0) (js/projection.js § The dummy space), so one dummy
   degree is 536,994.6727 metres of Albers, while the built-in — reading dummy
   latitudes that never leave ±3.04 — would call it about 111,320.

   The failure is not a rounding error and it is not visible. The bar would
   draw, the number would look plausible, and every distance a reader took off
   this map would be SHORT BY A FACTOR OF 4.8. That is the whole reason this
   file exists, and tools/verify.mjs § The scale bar tells the truth asserts the
   difference directly — the bar's implied distance against what the naive
   geographic reading would have claimed — so a future "simplification" back to
   the built-in fails loudly instead of shipping a map that lies quietly.

   ── Why this bar is EXACT, and not just close ──────────────────────────────
   The usual apology for a Mercator scale bar is that it is only true at the
   latitude it was measured at; MapLibre's own control re-measures at the centre
   of the viewport for exactly that reason, and is still wrong at the edges.

   Here there is nothing to apologise for. projectPoint() emits the GUDERMANNIAN
   of the linear Albers northing precisely so that MapLibre's Mercator undoes it
   (js/projection.js § MERCATOR SHEAR): screen x ends up linear in Albers
   easting and screen y linear in Albers northing, with the SAME constant. So
   metres per CSS pixel is ONE NUMBER for the whole plane at a given zoom,
   identical along both axes, and this bar is exact at the top of the map, at
   the bottom of it, and in Maine. It is what the dummy space gives back for
   free, and the reason the reading below can be taken anywhere.

   Two smaller consequences, both relied on: the house map is built by the kit's
   createCompositeMap(), which disables rotation and pitch, so two screen points
   on the same row differ in dummy longitude only; and the scale is isotropic,
   so measuring horizontally measures every direction.

   ── THE COMPOSITE IS NOT ONE MAP, AND THAT IS WHY THE BAR COMES AND GOES ───
   EPSG:5070 here is the shifted AlbersUSA composite. Alaska, Hawaii and Puerto
   Rico were reprojected into their own local systems and then SCALED before
   being placed below the country, so each is drawn at its own linear scale:

     region        drawn at    a pixel there is worth   verified in
     CONUS         1.0×        the bar as computed      (unshifted)
     Alaska        0.5×        TWICE the bar            data-tiles R/dummy-space.R
     Hawaii        1.5×        two thirds of the bar    § AUSA — ak/hi/pr `scale`
     Puerto Rico   2.5×        two fifths of the bar    (0.5 / 1.5 / 2.5)

   Those three factors are a frozen replication of tigris::shift_geometry(
   preserve_area = FALSE), and they are cross-checked by the AREA gate the same
   producer runs on the weekly USDM (data-tiles usdm.R § AREA_RATIO: AK 0.25,
   HI 2.25, PR 6.25 — the linear factors squared). The direction is the one
   place it is easy to be backwards: place_inset() multiplies the region's true
   geometry BY `scale`, so real metres = drawn metres ÷ factor, and Alaska —
   drawn at half size — is the region where the bar has to say MORE.

   So one bar cannot describe a view that holds two regions, and this one does
   not try. THE BAR RENDERS ONLY WHEN THE VIEWPORT INTERSECTS THE TERRITORY OF
   EXACTLY ONE REGION: it appears exactly when a single scale is true for
   everything on screen, and is hidden otherwise — at the national fit (four
   regions), straddling the gap between two (two), and out over empty composite
   ocean below the country (none). There is no zoom threshold anywhere in this
   file; "one region in view" is the whole rule, and it is the honest one.

   ── § THE REGION RECTANGLES ────────────────────────────────────────────────
   Measured 2026-08-26 from the county-index sidecars of ALL 21 published
   tilesets (dd17, dd22, fsa-lfp and the eighteen annual Census vintages),
   67,405 county bounding boxes in total, classified by state FIPS — 02 Alaska,
   15 Hawaii, 72 Puerto Rico, everything else CONUS. The union extent of each:

     CONUS  x −3.593152 … 5.000004   y −2.373326 … 3.036558
     AK     x −5.000619 … −1.591083  y −3.041374 … −1.209409
     HI     x −1.723545 … −0.132361  y −2.782234 … −1.758291
     PR     x  1.255711 … 2.600818   y −2.543432 … −2.217071

   THOSE FOUR BOXES ARE NOT DISJOINT, and a design that assumed they were would
   be broken in two named places. AlbersUSA tucks the insets INTO the empty
   ocean corners of the CONUS bounding rectangle, so all three sit inside it;
   and Alaska's panhandle reaches east past Kauai's west edge while Hawaii's
   chain runs south past the panhandle, so AK's box and HI's box interleave too.
   Taken literally, four boxes would hide the bar over Alaska's north slope
   (inside CONUS's box) and over both Kauai and Ketchikan (inside each other's).

   What IS true — measured, and the reason this works at all — is that the
   territories are separated by clear gaps, each of which is cut here at its
   midpoint:

     between                          gap (dummy°)   on the ground   cut at
     AK top    ↔ CONUS above it        0.205521        110.4 km      y −1.10665
     HI top    ↔ CONUS above it        0.157405         84.5 km      y −1.67959
     PR top    ↔ CONUS above it        0.597960        321.1 km      y −1.91809
     AK panhandle ↔ Kauai above it     0.111429         59.8 km      y −1.95080
     AK east of x −1.80 ↔ Kauai west   0.076455         41.1 km      x −1.80
     Kauai east ↔ O‘ahu west           0.293116        157.4 km      (x −1.40/−1.20)

   The x −1.80 cut is a measured SHELF rather than a gap midpoint: no Alaska
   county reaching east of x = −1.80 rises above y = −2.006513 (the value is
   identical for every threshold from −1.80 through −1.65), which is what lets
   the panhandle be a short rectangle under Hawaii while the mainland stays a
   tall one beside it.

   So each inset is one or two rectangles, pairwise disjoint and each holding
   all of its own region and none of anyone else's. CONUS is its plain box,
   used differently — see conusInView() below. tools/verify.mjs recomputes every
   county rectangle of the live census-2020 sidecar against these constants.

   ── What is NOT here ───────────────────────────────────────────────────────
   The PNG poster does not carry the bar: js/export.js renders the map canvas,
   and a DOM control is not on it. Painting one into the poster is a separate
   job in that file's own idiom (it already draws a title, a legend and the
   attribution) and is deliberately left for later rather than half-done here.
   ========================================================================== */

import { M_TO_DEG } from './projection.js';

/** Metres of Albers per dummy degree — 536,994.6727.
    M_TO_DEG is the forward scale (dummy degrees per metre), which is the form
    js/projection.js builds the whole transform from, so the reciprocal is taken
    HERE rather than restated as a second constant that could drift from it. */
const M_PER_DUMMY_DEG = 1 / M_TO_DEG;

/** How wide a bar may get, in CSS pixels. The bar shows the largest nice number
    that FITS this, so it is a ceiling and never a target. */
const MAX_BAR_PX = 100;

/** The screen baseline the metres-per-pixel reading is taken over. Long enough
    that MapLibre's own float noise is nothing beside it, short enough to sit
    inside the 375 px phone canvas. */
const PROBE_PX = 100;

/** Definitional, not measured: the international foot and the statute mile are
    both exact numbers of metres by treaty. */
const M_PER_FT = 0.3048;
const M_PER_MI = 1609.344;

/**
 * THE FOUR REGIONS OF THE COMPOSITE, with the linear factor each is drawn at
 * and the rectangles its territory occupies. See § THE REGION RECTANGLES above
 * for every number's derivation; `rects` are [x0, y0, x1, y1] in dummy degrees.
 *
 * `label` is null for CONUS on purpose: the conterminous states are the map, so
 * naming them would be noise. The three insets are named because a reader who
 * has zoomed into one needs to be told which scale the bar is now speaking.
 *
 * ORDER MATTERS ONLY FOR THE LABEL of a straddling view, and a straddling view
 * has no label — the bar is hidden. It is listed insets-first to match
 * data-tiles' own classify_regions() precedence.
 */
const REGIONS = Object.freeze([
  Object.freeze({
    id: 'ak',
    label: 'Alaska inset',
    factor: 0.5,
    /* Two: the mainland, tall and west of Kauai; and the panhandle, short and
       under it. Split at the x = −1.80 shelf. */
    rects: Object.freeze([
      Object.freeze([-5.10, -3.10, -1.80, -1.10665]),
      Object.freeze([-1.80, -3.10, -1.55, -1.95080]),
    ]),
  }),
  Object.freeze({
    id: 'hi',
    label: 'Hawaii inset',
    factor: 1.5,
    /* Two: Kaua‘i and Ni‘ihau, which sit alone above Alaska's panhandle; and
       O‘ahu through Hawai‘i, 0.29 dummy degrees further east. */
    rects: Object.freeze([
      Object.freeze([-1.74, -1.95080, -1.40, -1.67959]),
      Object.freeze([-1.20, -2.83, -0.09, -1.67959]),
    ]),
  }),
  Object.freeze({
    id: 'pr',
    label: 'Puerto Rico inset',
    factor: 2.5,
    rects: Object.freeze([Object.freeze([1.20, -2.60, 2.65, -1.91809])]),
  }),
  Object.freeze({
    id: 'conus',
    label: null,
    factor: 1,
    /* The measured extent, padded. Unlike the three above this box is NOT the
       region's territory — it is a rectangle with three inset-shaped holes in
       its southern edge, and conusInView() is what accounts for them. */
    rects: Object.freeze([Object.freeze([-3.65, -2.40, 5.05, 3.10])]),
  }),
]);

/** The three insets, in evaluation order — CONUS is the one that is different. */
const INSETS = Object.freeze(REGIONS.filter((r) => r.id !== 'conus'));
const CONUS = REGIONS.find((r) => r.id === 'conus');

/** The caveat that used to be the whole story, kept as the tooltip's second
    half: a reader hovering the bar on an inset should be told why it changed. */
const TITLE_BASE = 'Distance scale for what is on screen. Alaska, Hawaii and '
  + 'Puerto Rico are drawn at their own scales, so the bar appears only while '
  + 'the view sits within one of the four.';

/* ── Rectangle arithmetic ─────────────────────────────────────────────────── */

/** Do [x0,y0,x1,y1] boxes `a` and `b` share any area? Touching edges do not
    count, which is what lets two cut rectangles meet exactly on a cut line. */
function overlaps(a, b) {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

/** Is box `inner` wholly inside box `outer`? */
function contains(outer, inner) {
  return outer[0] <= inner[0] && outer[1] <= inner[1]
    && outer[2] >= inner[2] && outer[3] >= inner[3];
}

/**
 * Does the viewport reach any CONUS ground?
 *
 * CONUS cannot be answered by its box alone: the box swallows all three insets,
 * so "intersects the CONUS box" is true over Anchorage. What is also true is
 * that a viewport wholly inside ONE inset rectangle is over that inset and
 * nothing else — the inset rectangles hold no CONUS county (every gap in
 * § THE REGION RECTANGLES is cut at its midpoint) and they are pairwise
 * disjoint, so a rectangle inside their union is inside one of them.
 *
 * The residue this leaves is small and harmless: a viewport out over open
 * composite ocean that is still inside the CONUS box — a few hundred kilometres
 * off the Pacific coast, say — is called CONUS rather than nothing. It is the
 * correct scale for the nearest land in every such place.
 *
 * @param {number[]} vb the viewport, [x0, y0, x1, y1] in dummy degrees
 * @returns {boolean}
 */
function conusInView(vb) {
  if (!overlaps(CONUS.rects[0], vb)) return false;
  for (const inset of INSETS) {
    for (const r of inset.rects) if (contains(r, vb)) return false;
  }
  return true;
}

/**
 * The one region the viewport is looking at, or null if it is looking at none
 * or at more than one.
 *
 * @param {number[]} vb the viewport, [x0, y0, x1, y1] in dummy degrees
 * @returns {object|null} a REGIONS entry
 */
function soleRegion(vb) {
  let found = null;
  for (const inset of INSETS) {
    if (!inset.rects.some((r) => overlaps(r, vb))) continue;
    if (found) return null;
    found = inset;
  }
  if (conusInView(vb)) {
    if (found) return null;
    found = CONUS;
  }
  return found;
}

/* ── Numbers on a bar ─────────────────────────────────────────────────────── */

/**
 * ONE ROUNDING CONVENTION, used by both bars: the largest 1, 2 or 5 × 10ⁿ that
 * fits — in the unit displayed, and the unit switches below one mile and below
 * one kilometre so the number on the bar is always a whole one.
 *
 * MapLibre's own control also admits 3 × 10ⁿ; this one does not, because a
 * three-mile bar is no nicer than a two-mile bar and the extra case buys
 * nothing but a wider spread of rounding slack. Rounding DOWN is what keeps the
 * drawn bar inside MAX_BAR_PX.
 *
 * @param {number} v an upper bound, in the display unit
 * @returns {number} the nice number at or below it (0 if there isn't one)
 */
function niceDown(v) {
  if (!Number.isFinite(v) || v <= 0) return 0;
  const pow10 = 10 ** Math.floor(Math.log10(v));
  const d = v / pow10;
  return pow10 * (d >= 5 ? 5 : d >= 2 ? 2 : 1);
}

/**
 * The metric bar for a given budget of real metres.
 * @param {number} maxMeters what MAX_BAR_PX is worth here
 * @returns {{value: number, unit: string, meters: number}}
 */
function metricBar(maxMeters) {
  if (maxMeters >= 1000) {
    const value = niceDown(maxMeters / 1000);
    return { value, unit: 'km', meters: value * 1000 };
  }
  const value = niceDown(maxMeters);
  return { value, unit: 'm', meters: value };
}

/**
 * The imperial bar for the same budget.
 * @param {number} maxMeters what MAX_BAR_PX is worth here
 * @returns {{value: number, unit: string, meters: number}}
 */
function imperialBar(maxMeters) {
  if (maxMeters >= M_PER_MI) {
    const value = niceDown(maxMeters / M_PER_MI);
    return { value, unit: 'mi', meters: value * M_PER_MI };
  }
  const value = niceDown(maxMeters / M_PER_FT);
  return { value, unit: 'ft', meters: value * M_PER_FT };
}

/**
 * Metres of DRAWN composite per CSS pixel, read off the live map rather than
 * computed from the zoom — the camera is the authority on its own scale, and an
 * arithmetic copy of MapLibre's zoom→scale relation is one more thing that can
 * drift out of step with the renderer.
 *
 * Two points PROBE_PX apart on the middle row of the canvas. Rotation and pitch
 * are off (see the header), so they differ in dummy longitude only, and dummy
 * longitude is linear in Albers easting by construction.
 *
 * The result is COMPOSITE metres. Divide by the region's factor for real ones.
 *
 * @param {import('maplibre-gl').Map} map
 * @returns {number} metres per CSS pixel, or 0 if the map cannot answer yet
 */
function metersPerPixel(map) {
  const canvas = map.getCanvas();
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!(w > 0) || !(h > 0)) return 0;
  // Clamped so the baseline still fits a canvas narrower than PROBE_PX.
  const span = Math.min(PROBE_PX, w);
  const x0 = (w - span) / 2;
  const y = h / 2;
  const a = map.unproject([x0, y]);
  const b = map.unproject([x0 + span, y]);
  const perPx = (Math.abs(b.lng - a.lng) * M_PER_DUMMY_DEG) / span;
  return Number.isFinite(perPx) && perPx > 0 ? perPx : 0;
}

/** The viewport as [x0, y0, x1, y1] in dummy degrees. */
function viewportBox(map) {
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

/* ── The control ──────────────────────────────────────────────────────────── */

/**
 * A truthful dual scale bar, USGS-style: miles on top, kilometres underneath,
 * bottom-left, shown only while one region of the composite fills the view.
 *
 * The two bars carry MapLibre's own `maplibregl-ctrl-scale`, so the vendored
 * maplibre-gl.css draws them exactly like the built-in control — same border,
 * same translucent plate, same 10 px font — and css/app.css needs no rule at
 * all. `maplibregl-ctrl` goes on the CONTAINER rather than on each bar, which
 * is the one deviation from copying the built-in's markup: that class carries
 * `float: left; margin: 0 0 10px 10px`, so putting it on both bars would space
 * them 10 px apart instead of fusing them, and would leave the container itself
 * zero-height with two floats hanging out of it.
 *
 * Recomputed on `move` (which covers zoom) and on `resize`. Nothing caches the
 * camera: a redraw is two unprojects, four rectangle tests and two strings.
 *
 * @param {import('maplibre-gl').Map} map the live map
 * @returns {object} the IControl, already added — returned for symmetry with
 *          the kit's controls and for a caller that may need to remove it
 */
export function addScaleBar(map) {
  const wrap = document.createElement('div');
  wrap.className = 'maplibregl-ctrl ngp-scale';
  /* role="img" + aria-label, because the two numbers are one reading and a
     screen reader meeting them as loose text ("200 mi" "500 km") learns
     nothing. The label is rewritten with the bars; `title` mirrors it for the
     mouse, which is where the region name is most likely to be wanted. */
  wrap.setAttribute('role', 'img');
  wrap.hidden = true;

  /** @param {string} system 'imperial' | 'metric' — stable across unit swaps,
      which is what a harness selector needs (the UNIT changes with zoom). */
  const makeBar = (system) => {
    const el = document.createElement('div');
    el.className = 'maplibregl-ctrl-scale';
    el.dataset.ngpScale = system;
    wrap.append(el);
    return el;
  };
  const bars = [
    { el: makeBar('imperial'), compute: imperialBar },
    { el: makeBar('metric'), compute: metricBar },
  ];

  const update = () => {
    const perPx = metersPerPixel(map);
    const region = perPx ? soleRegion(viewportBox(map)) : null;
    if (!region) {
      wrap.hidden = true;
      delete wrap.dataset.ngpScaleRegion;
      return;
    }
    // Drawn metres → real metres. place_inset() multiplied the region's true
    // geometry BY its factor, so undoing it is a division: Alaska is drawn at
    // 0.5× and a pixel there is therefore worth twice what CONUS says.
    const realPerPx = perPx / region.factor;
    const words = [];
    for (const bar of bars) {
      const { value, unit, meters } = bar.compute(MAX_BAR_PX * realPerPx);
      if (!value) continue;
      bar.el.textContent = `${value} ${unit}`;
      bar.el.dataset.unit = unit;
      // box-sizing is border-box in maplibre-gl.css, so the 2 px end ticks are
      // INSIDE this width and the bar measures edge to edge — the same thing
      // getBoundingClientRect().width reports, which is what the gate reads.
      bar.el.style.width = `${meters / realPerPx}px`;
      words.push(bar.el.textContent);
    }
    const name = region.label ? `Scale — ${region.label}` : 'Scale';
    wrap.setAttribute('aria-label', `${name}: ${words.join(', ')}. ${TITLE_BASE}`);
    wrap.title = `${name}. ${TITLE_BASE}`;
    wrap.dataset.ngpScaleRegion = region.id;
    wrap.hidden = false;
  };

  const control = {
    onAdd() {
      map.on('move', update);
      map.on('resize', update);
      // The control is added before `load`, when the container may still be
      // sizing and metersPerPixel() answers 0. `move` would eventually cover it
      // — but only once the reader touched the map, and the FIRST paint should
      // already be right.
      map.once('load', update);
      update();
      return wrap;
    },
    onRemove() {
      map.off('move', update);
      map.off('resize', update);
      map.off('load', update);
      wrap.remove();
    },
  };

  map.addControl(control, 'bottom-left');
  return control;
}
