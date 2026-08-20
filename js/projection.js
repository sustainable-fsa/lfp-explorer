/* ============================================================================
   LFP Explorer · js/projection.js
   Client-side pre-projection of the county composite into EPSG:5070 (NAD83 /
   CONUS Albers Equal Area), rendered through a dummy lng/lat space.

   ES module, no build step, no dependencies — not even the kit. Forward only:
   nothing in this app ever needs to go back from the map to a real coordinate.

   ── Why this file exists ───────────────────────────────────────────────────
   MapLibre GL 5.18 renders `mercator`, `globe` and `vertical-perspective` and
   nothing else; there is no conic projection to ask for. So the app used to
   draw the archives' raw lng/lat through Web Mercator, which over a 30° tall
   country is the familiar north-stretched, plate-carrée-looking picture — and
   it did not match a single other figure the project publishes, all of which
   are Albers.

   The standard route out is to stop feeding MapLibre coordinates it will
   project and start feeding it coordinates that are ALREADY projected. That
   works here precisely because THIS MAP HAS NO BASEMAP (HOUSE-STYLE §7): the
   county composite is the only thing on the canvas, there are no tiles to
   register against, and MapLibre is reduced to a pan/zoom/pick engine over a
   flat plane. Every coordinate that reaches it is run through Albers first and
   then linearly rescaled into a small box of fake "degrees" around (0, 0)
   (§ The dummy space), which the renderer treats as any other geometry.

   ── Why the inverse is lossless here ───────────────────────────────────────
   The archives are a COMPOSITE, not a plain geographic dataset: Alaska, Hawaii
   and Puerto Rico were repositioned by tigris::shift_geometry(), which does its
   scaling and translation IN ALBERS SPACE (ESRI:102003 — identical to EPSG:5070
   but for lat_0 37.5 against 23, i.e. a constant northing offset applied to the
   same shapes), and the result was then unprojected to lng/lat for publication.
   Running the published lng/lat forward through the same ellipsoidal Albers is
   therefore the INVERSE of that last step, and it reconstructs the exact
   composite plane the archive was laid out on — the insets land where
   shift_geometry() put them, and no shape is bent. The only error is the
   archives' own coordinate quantization (~6.5 m; see the topology transform:
   5.83e-5° of longitude, 3.08e-5° of latitude).

   ── Correctness ────────────────────────────────────────────────────────────
   The forward below was checked against PROJ (via R sf) at twelve well-spread
   points. The reference was generated with:

     Rscript -e 'sf::sf_project("EPSG:4269", "EPSG:5070",
       matrix(c(-96,23, -96,29.5, -100,40, -80,30, -110,45.5, -155,60,
                -68,42, -113.9967,46.8721, -125.2581512,49.3843626,
                -125.2581512,18.5921373, -66.9498943,49.3843626,
                -66.9498943,18.5921373),
              ncol = 2, byrow = TRUE))'

   EPSG:4269 (NAD83 geographic), NOT EPSG:4326: from 4326 PROJ inserts a
   WGS84→NAD83 datum shift and (−96, 29.5) comes back at x = 0.43 m instead of
   x = 0. This file implements the PROJECTION only, on GRS80, which is what
   EPSG:5070 and ESRI:102003 both mean by it.

     lng            lat          PROJ x (m)        PROJ y (m)
     −96             23              0.000000         0.000000  ← the origin
     −96             29.5            0.000000    713920.580872  ← on lon_0
     −100            40        −338390.587551   1894100.140043
     −80             30        1534849.038775    898886.088378
     −110            45.5    −1090259.365230   2581778.482253
     −155            60      −3417692.025520   5150093.309468  (Alaska, unshifted)
     −68             42       2270272.427254   2447802.594778
     −113.9967       46.8721 −1369542.958580   2783600.466182  (Missoula, MT)
     −125.2581512    49.3843626 −2120781.424840  3259472.988458  ┐ the archives'
     −125.2581512    18.5921373 −3152675.636582    14357.186941 │ shared bbox
     −66.9498943     49.3843626  2106175.646848  3254846.185680 │ corners
     −66.9498943     18.5921373  3130963.224407     7479.152165 ┘

   Worst absolute disagreement across all twelve: 4.9e-7 m. (−96, 23) maps to
   exactly (0, 0) before the rescale, as it must, and every point on lon_0 to
   x = 0 exactly.

   ── The dummy space ────────────────────────────────────────────────────────
   Albers metres are then mapped into fake degrees by ONE fixed affine
   transform: subtract the composite's projected centre, multiply by one scale
   factor shared by x and y (so the aspect ratio is preserved exactly), giving
   x ∈ [−5, +5] and y ∈ [−3.0377, +3.0377].

   The constants are HARDCODED, from the measured extent of the composite —
   never derived from whatever geometry happens to be loaded. Two reasons, and
   both are user-visible: the ?lng&lat&zoom camera in the URL is expressed in
   this space, so it has to mean the same thing in every session; and the two
   boundary vintages have to land in the SAME space, or crossing 2015 would
   shift the whole map sideways under a camera that never moved. (They do in
   fact measure identically to the millimetre — see below — but the app must not
   depend on that continuing to hold.)

   MERCATOR SHEAR: MapLibre still runs Web Mercator over these fake degrees, so
   the y axis is stretched by 1/cos(lat) away from the equator. Centring the box
   on (0, 0) keeps |lat| ≤ 3.0377°, where that factor is 1.00141 — a 0.14%
   vertical stretch at the very top and bottom edges of the composite, against
   the ~40% Mercator was applying to northern Montana before. Below the
   archives' own 6.5 m quantization at this map's scales, and invisible.
   ========================================================================== */

/* ── EPSG:5070 ────────────────────────────────────────────────────────────────
   NAD83 / Conus Albers: Albers Equal Area on GRS80, lat_0 = 23, lon_0 = −96,
   standard parallels 29.5 and 45.5, no false easting or northing. Snyder, Map
   Projections — A Working Manual (USGS PP 1395), § Albers Equal-Area Conic,
   the ELLIPSOIDAL case (eqs. 14-11 … 14-15, 3-12): the spherical form is ~100 m
   wrong over CONUS, which is more than the archives' quantization and would
   show up as a hairline offset against every other figure the project makes. */

const A = 6378137;                       // GRS80 semi-major axis, metres
const F = 1 / 298.257222101;             // GRS80 flattening
const E2 = F * (2 - F);                  // first eccentricity squared
const E = Math.sqrt(E2);

const D2R = Math.PI / 180;
const LAT_0 = 23 * D2R;
const LON_0 = -96 * D2R;
const LAT_1 = 29.5 * D2R;
const LAT_2 = 45.5 * D2R;

/** Snyder 3-12: the authalic ("equal-area") latitude parameter q. */
function authalicQ(phi) {
  const sin = Math.sin(phi);
  const eSin = E * sin;
  return (1 - E2) * (sin / (1 - eSin * eSin)
    - (1 / (2 * E)) * Math.log((1 - eSin) / (1 + eSin)));
}

/** Snyder 14-15: the scale term m. */
function scaleM(phi) {
  const sin = Math.sin(phi);
  return Math.cos(phi) / Math.sqrt(1 - E2 * sin * sin);
}

// The cone constants, computed once at module load from the four defining
// parallels above — pure arithmetic on frozen numbers, so this is a constant
// in every sense that matters.
const M1 = scaleM(LAT_1);
const M2 = scaleM(LAT_2);
const N = (M1 * M1 - M2 * M2) / (authalicQ(LAT_2) - authalicQ(LAT_1));
const C = M1 * M1 + N * authalicQ(LAT_1);
const RHO_0 = A * Math.sqrt(C - N * authalicQ(LAT_0)) / N;

/**
 * Albers forward, in metres. Not exported: metres are an intermediate here, and
 * every consumer wants the dummy space.
 * @param {number} lng degrees east
 * @param {number} lat degrees north
 * @returns {[number, number]} easting, northing in EPSG:5070 metres
 */
function albers5070(lng, lat) {
  const rho = A * Math.sqrt(C - N * authalicQ(lat * D2R)) / N;
  const theta = N * (lng * D2R - LON_0);
  return [rho * Math.sin(theta), RHO_0 - rho * Math.cos(theta)];
}

/* ── The measured composite extent ───────────────────────────────────────────
   Every coordinate of both boundary archives, pushed through albers5070() above
   and reduced to a bounding box. Measured 2026-08-19 against the committed
   topologies (fsa-counties-dd17.topojson, 9,631 arcs / 76,109 points;
   fsa-counties-dd22.topojson, 9,637 arcs / 77,166 points), by decoding the
   delta-encoded arcs directly:

     dd17  x −3111748.649 … 2258198.078   y −89909.057 … 3172568.668
     dd22  x −3111748.649 … 2258198.078   y −89909.057 … 3172568.668

   The two vintages agree to the last digit printed, which is the same story
   their geographic bboxes tell — both archives carry the byte-identical
   bbox [−125.2581512, 18.5921373, −66.9498943, 49.3843626] and the same
   quantization transform, so the extreme coordinates are literally the same
   numbers in both files.

   NOTE that these are the extremes of the GEOMETRY, not the projected corners
   of that geographic bbox: the bbox corners are combinations of extremes from
   different features and land far outside the composite (the south-west corner
   alone projects to x = −3152675.6, 41 km west of anything drawn). Projecting
   the corners would over-pad the framing by ~17% in x.

     width  5369946.727 m     height 3262477.725 m     aspect 1.645972

   Cross-checked live, the other way round: projectCounties() recomputes
   `bounds` from the fetched geometry after transforming it, and on the running
   app that lands at [[−5.0000000009, −3.0377188935], [5.0000000001,
   3.0377188935]] — within 1e-9 dummy units, half a millimetre on the ground, of
   PROJECTED_BOUNDS below. The residual is the rounding of the four literals
   here to the millimetre, and nothing else. */
const EXTENT_M = Object.freeze({
  x0: -3111748.649, x1: 2258198.078,
  y0: -89909.057, y1: 3172568.668,
});

/* The affine part: centre on the composite, then one shared scale that puts the
   full width on [−5, +5]. 10 fake degrees across is a deliberate size — big
   enough that MapLibre's own float precision and the 4-decimal ?lng&lat
   convention still resolve ~10 m on the ground, small enough that the Mercator
   shear at the edges stays at 0.14% (see the header). */
const DUMMY_WIDTH_DEG = 10;
const CENTER_X_M = (EXTENT_M.x0 + EXTENT_M.x1) / 2;   // −426775.2855
const CENTER_Y_M = (EXTENT_M.y0 + EXTENT_M.y1) / 2;   //  1541329.8055
const M_TO_DEG = DUMMY_WIDTH_DEG / (EXTENT_M.x1 - EXTENT_M.x0);   // 1.8622158670e-6

/**
 * A lng/lat position from the boundary archives → the dummy space the map
 * actually renders. The one function every other transform here is built from.
 *
 * @param {[number, number]} position [lng, lat] in degrees
 * @returns {[number, number]} [x, y] in dummy degrees
 */
export function projectPoint(position) {
  const [x, y] = albers5070(position[0], position[1]);
  return [(x - CENTER_X_M) * M_TO_DEG, (y - CENTER_Y_M) * M_TO_DEG];
}

/**
 * The composite's own extent in dummy units, as MapLibre's [[w,s],[e,n]] array
 * form. This REPLACES the kit's COMPOSITE_BOUNDS throughout the app: the fit
 * control, the zoom floor, the initial camera, the clean-URL default check and
 * the PNG export all frame against it.
 *
 * Fixed by construction — [[−5, −3.0377188926], [+5, +3.0377188926]], the
 * measured extent above run through the same affine transform as every
 * coordinate. Frozen because it is handed to the kit, which reads it and must
 * never be able to write it.
 */
export const PROJECTED_BOUNDS = Object.freeze([
  Object.freeze([(EXTENT_M.x0 - CENTER_X_M) * M_TO_DEG, (EXTENT_M.y0 - CENTER_Y_M) * M_TO_DEG]),
  Object.freeze([(EXTENT_M.x1 - CENTER_X_M) * M_TO_DEG, (EXTENT_M.y1 - CENTER_Y_M) * M_TO_DEG]),
]);

/* ── Transforming a decoded vintage ──────────────────────────────────────── */

/**
 * Every position in a GeoJSON coordinate array, projected — as a NEW nested
 * array rather than in place.
 *
 * Not in place, deliberately. topojson-client decodes a QUANTIZED topology
 * through a transform function that allocates a fresh [x, y] per point, so the
 * archives as they stand today have no aliasing between features. An
 * unquantized topology decodes with the identity transform instead and hands
 * back the topology's OWN arc arrays, shared by every polygon that uses the
 * arc — and an in-place walk would then project those shared points once per
 * neighbouring county. Rebuilding is O(same) and cannot be wrong.
 *
 * @param {any} coords a position, or any depth of array of them
 * @returns {any} the same shape, projected
 */
function projectCoords(coords) {
  if (!coords || !coords.length) return coords;
  if (typeof coords[0] === 'number') return projectPoint(coords);
  const out = new Array(coords.length);
  for (let i = 0; i < coords.length; i++) out[i] = projectCoords(coords[i]);
  return out;
}

// The kit's own per-feature geometry caches (county/county.js § Geometry
// helpers). They are non-enumerable and configurable, and `_sfsaBBox` is
// ALREADY POPULATED when loadCounties() resolves — _decodeTopology() calls
// featureBBox() on every feature to build `bounds`. Leaving a geographic bbox
// behind would make countyCentroid() return a geographic centre for projected
// geometry, which is a fly-to and a card-reveal landing in the ocean. Deleting
// rather than rewriting: the kit recomputes lazily with its own descriptor, so
// this file only has to know the key names, not the caching contract.
const KIT_GEOMETRY_CACHE_KEYS = ['_sfsaBBox', '_sfsaCentroid'];

/**
 * Project a decoded boundary vintage into the dummy space, IN PLACE.
 *
 * Call this on the resolved value of the kit's loadCounties() and hand the
 * result on unchanged; from that point every coordinate in the object — the
 * county features, the state mesh, `bounds` — is in dummy units, and so is
 * everything the kit and the app derive from them (centroids, feature
 * geometry in MapLibre, map.project() input).
 *
 * MUST run before anything reads a centroid or hands `fc` to a GL source — so
 * the call belongs at each `await loadCounties(...)`, on the same line as it if
 * that reads better, and nowhere else.
 *
 * IDEMPOTENT, because it has to be: loadCounties() resolves a per-session
 * cached promise, so the SAME object comes back for every later request of a
 * vintage. Sliding 2016 → 2010 → 2016 hands the 2015-and-later object back a
 * second time, and Albers applied to Albers metres would fling the composite
 * into the next hemisphere. The `projected` marker is what makes the second
 * pass a no-op.
 *
 * @param {{vintage: string|null, fc: object, statesMesh: object,
 *          bounds: number[][], index: Map<string, object>,
 *          names: Map<string, object>}} loaded
 * @returns {object} the same object, mutated
 */
export function projectCounties(loaded) {
  if (!loaded || !loaded.fc || !Array.isArray(loaded.fc.features)) {
    throw new Error('[ngp/projection] projectCounties() expects a loadCounties() '
      + 'result with fc.features.');
  }
  if (loaded.projected) return loaded;   // already in dummy units — see above

  // Bounds are recomputed here rather than run through projectPoint: Albers is
  // not axis-aligned, so the projected corners of the geographic box are not
  // the box of the projected geometry (see § The measured composite extent).
  // Features only, matching the kit's own definition of `bounds`; the state
  // mesh is derived from the same arcs and adds nothing.
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;

  for (const feature of loaded.fc.features) {
    const geometry = feature && feature.geometry;
    if (geometry && geometry.coordinates) {
      geometry.coordinates = projectCoords(geometry.coordinates);
      (function walk(a) {
        if (!a || !a.length) return;
        if (typeof a[0] === 'number') {
          if (a[0] < w) w = a[0];
          if (a[1] < s) s = a[1];
          if (a[0] > e) e = a[0];
          if (a[1] > n) n = a[1];
          return;
        }
        for (let i = 0; i < a.length; i++) walk(a[i]);
      })(geometry.coordinates);
    }
    for (const key of KIT_GEOMETRY_CACHE_KEYS) delete feature[key];
  }

  if (loaded.statesMesh && loaded.statesMesh.coordinates) {
    loaded.statesMesh.coordinates = projectCoords(loaded.statesMesh.coordinates);
  }

  if (Number.isFinite(w)) loaded.bounds = [[w, s], [e, n]];
  loaded.projected = 'EPSG:5070';
  return loaded;
}
