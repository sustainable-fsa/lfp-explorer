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

   ── The same twelve, in dummy degrees ──────────────────────────────────────
   projectPoint() output — the affine AND the Gudermannian shear correction
   applied. This is the SPECIFICATION any other producer of this space has to
   reproduce: agreement to 1e-9 dummy degrees (about half a millimetre) is the
   registration contract, and a producer that skips the Gudermannian matches at
   the centre and drifts to 765 m at the edges, so test a high-|y| point.

     lng            lat          dummy x          dummy y
     −96             23        0.7947477083   −2.8690890227
     −96             29.5      0.7947477083   −1.5406289019
     −100            40        0.1645913869    0.6569201213
     −80             30        3.6529679418   −1.1962819573
     −110            45.5     −1.2355505808    1.9371708604
     −155            60       −5.5697326102    6.7049406421  (Alaska, unshifted)
     −68             42        5.0224850448    1.6878038573
     −113.9967       46.8721  −1.7556369197    2.3127478380  (Missoula, MT)
     −125.2581512    49.3843626 −3.1546051115   3.1978918714  ┐ the archives'
     −125.2581512    18.5921373 −5.0762148857  −2.8423860441  │ shared bbox
     −66.9498943     49.3843626  4.7169014166   3.1892891466  │ corners
     −66.9498943     18.5921373  6.6252771038  −2.8551786008  ┘

   Several land outside PROJECTED_BOUNDS, which is correct and worth saying: the
   bbox corners and unshifted Alaska are combinations of extremes from different
   features, not points on the composite. See the extent note below.

   ── The dummy space ────────────────────────────────────────────────────────
   Albers metres are then mapped into fake degrees by ONE fixed affine
   transform: subtract the composite's projected centre, multiply by one scale
   factor shared by x and y (so the aspect ratio is preserved exactly), giving
   x ∈ [−5, +5] and y ∈ [−3.0363, +3.0363] (the y half-height is the linear
   3.0377 with the Gudermannian shear correction applied — see below).

   The constants are HARDCODED, from the measured extent of the composite —
   never derived from whatever geometry happens to be loaded. Two reasons, and
   both are user-visible: the ?lng&lat&zoom camera in the URL is expressed in
   this space, so it has to mean the same thing in every session; and the two
   boundary vintages have to land in the SAME space, or crossing 2015 would
   shift the whole map sideways under a camera that never moved. (They do in
   fact measure identically to the millimetre — see below — but the app must not
   depend on that continuing to hold.)

   MERCATOR SHEAR, AND WHY THERE ISN'T ANY: MapLibre still runs Web Mercator
   over these fake degrees, and Mercator's y is the inverse Gudermannian of
   latitude. Emitting a y left LINEAR in Albers northing would therefore render
   the plane stretched by 1/cos(lat) — 1.001407 at |lat| = 3.0377°, a 0.14%
   vertical stretch accumulating to 765 m of displacement at the top and bottom
   edges, and a 0.141% area error in a projection chosen BECAUSE it is
   equal-area. So projectPoint() emits the GUDERMANNIAN of the linear value
   (see gudermannian() below) and Mercator undoes it exactly: the rendered
   plane is true Albers, and the y half-height is 3.0362967564, not 3.0377188926.

   That correction is also what lets any other layer register against this one.
   Under the linear scheme the mathematically natural recipe — project to
   Albers, rescale linearly — is subtly WRONG, so an independent producer doing
   the obvious thing lands up to 765 m out. Under the corrected scheme the
   natural recipe is the correct one, and independent implementations converge.
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
   app that lands within 1e-9 dummy units — half a millimetre on the ground — of
   PROJECTED_BOUNDS below, whose y extremes are the Gudermannian-corrected
   ±3.0362967564. The residual is the rounding of the four literals here to the
   millimetre, and nothing else. */
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

/**
 * THE SCALE OF THE DUMMY SPACE: dummy degrees per Albers metre, 1.8622158670e-6.
 *
 * EXPORTED because it is the only honest way to turn a distance ON THIS MAP back
 * into a distance on the ground, and one thing now needs to — js/scale-bar.js.
 * Its reciprocal is 536,994.6727 metres per dummy degree, against the ~111,320 a
 * consumer that mistook these for real degrees would assume, so a scale bar
 * built on the wrong one is not slightly off: it is short by a factor of 4.8.
 *
 * Read it, never restate it. It is derived from EXTENT_M above, which is the
 * measured composite, and the two must move together.
 */
export const M_TO_DEG = DUMMY_WIDTH_DEG / (EXTENT_M.x1 - EXTENT_M.x0);

/**
 * THE SHEAR CORRECTION. MapLibre runs Web Mercator over these fake degrees, and
 * Mercator's y IS the inverse Gudermannian of latitude. So a dummy latitude
 * left LINEAR in Albers northing renders stretched by 1/cos(lat) — 1.000152 at
 * dummy lat 1, 1.001407 at the box edge — which accumulates to 765 m of
 * displacement from a true Albers plane at the top and bottom. Albers was
 * chosen BECAUSE it is equal-area, and that stretch is a 0.141% area error.
 *
 * Emitting the Gudermannian of the linear value instead means Mercator undoes
 * it exactly, and the rendered plane is true Albers. Edge: linear 3.0377188926
 * → 3.0362967564, a difference of 0.0014221362° (764 m).
 *
 * @param {number} deg a dummy latitude linear in Albers northing
 * @returns {number} the latitude to emit so Mercator renders `deg`
 */
function gudermannian(deg) {
  return (360 / Math.PI) * Math.atan(Math.exp((Math.PI * deg) / 180)) - 90;
}

/**
 * Albers metres → dummy degrees: the affine, then the shear correction. The one
 * place both are applied — projectPoint() and PROJECTED_BOUNDS are built from
 * it so they cannot drift apart.
 *
 * @param {number} x Albers easting, metres
 * @param {number} y Albers northing, metres
 * @returns {[number, number]} [x, y] in dummy degrees
 */
function toDummy(x, y) {
  return [(x - CENTER_X_M) * M_TO_DEG, gudermannian((y - CENTER_Y_M) * M_TO_DEG)];
}

/**
 * A lng/lat position from the boundary archives → the dummy space the map
 * actually renders. The one function every other transform here is built from.
 *
 * @param {[number, number]} position [lng, lat] in degrees
 * @returns {[number, number]} [x, y] in dummy degrees
 */
export function projectPoint(position) {
  const [x, y] = albers5070(position[0], position[1]);
  return toDummy(x, y);
}

/**
 * The composite's own extent in dummy units, as MapLibre's [[w,s],[e,n]] array
 * form. This REPLACES the kit's COMPOSITE_BOUNDS throughout the app: the fit
 * control, the zoom floor, the initial camera, the clean-URL default check and
 * the PNG export all frame against it.
 *
 * Fixed by construction — [[−5, −3.0362967564], [+5, +3.0362967564]], the
 * measured extent above run through toDummy(), the same affine AND shear
 * correction as every coordinate. Frozen because it is handed to the kit, which
 * reads it and must never be able to write it.
 *
 * The y half-height is 3.0362967564 rather than the linear 3.0377188926
 * because of the Gudermannian above; the two must move together, which is why
 * both go through toDummy() rather than repeating the arithmetic.
 */
export const PROJECTED_BOUNDS = Object.freeze([
  Object.freeze(toDummy(EXTENT_M.x0, EXTENT_M.y0)),
  Object.freeze(toDummy(EXTENT_M.x1, EXTENT_M.y1)),
]);

/* ── The producer contract ───────────────────────────────────────────────────
   Geometry can now ARRIVE in this space instead of being transformed into it:
   `data-tiles` builds its tilesets and its index sidecars' bounding boxes
   through R/dummy-space.R, which is gated against the twelve reference points
   in this file's header to 1e-9 dummy degrees — the same tolerance, from the
   other side.

   That gate is the only thing standing between this app and a silent
   misregistration, and "silent" is the whole problem. Two layers built on
   slightly different constants line up at the centre of the map and drift apart
   toward the edges; nothing on screen says so, and the error is largest exactly
   where a reader zooms in to compare two county authorities. So every boundary
   index this app loads asserts, before anything reads a bbox off it, that it
   says it is in this space and that its extent is THIS file's extent.

   This is the counterpart of projectCounties() below, not a replacement for it:
   one transforms geometry that arrives geographic, the other checks geometry
   that arrives already projected. An app drawing both needs both. */

/** The space identifier every producer of this plane stamps on its artifacts. */
export const DUMMY_SPACE = 'sfsa-albers-usa/1';

/**
 * The registration tolerance, in dummy degrees — about half a millimetre on the
 * ground, and the same number data-tiles/tools/check-registration.R uses.
 *
 * NOT zero, and not `===`. R prints 15 significant digits where JS round-trips
 * at 17, so the published bounds are `-3.03629675646083` against this file's
 * `-3.0362967564608283`: equal to 1.8e-15, which is a rounding artifact of the
 * serialisation and not a disagreement about anything. A validator written with
 * `===` or `JSON.stringify` would reject every sidecar ever published.
 */
export const SPACE_EPSILON = 1e-9;

/**
 * Flatten either bounds convention to `[w, s, e, n]`.
 *
 * Both are in circulation and neither is wrong: a sidecar publishes the flat
 * four, and MapLibre — and therefore PROJECTED_BOUNDS — wants `[[w,s],[e,n]]`.
 * A check that knew only one of them would throw on every load.
 *
 * @param {number[]|number[][]} b
 * @returns {number[]|null} [w, s, e, n], or null if it is neither shape
 */
function flatBounds(b) {
  if (!Array.isArray(b)) return null;
  if (b.length === 4 && b.every((v) => typeof v === 'number')) return b.slice();
  if (b.length === 2 && Array.isArray(b[0]) && Array.isArray(b[1])) {
    return [b[0][0], b[0][1], b[1][0], b[1][1]];
  }
  return null;
}

/**
 * Assert that a loaded boundary really is in the space this map renders.
 *
 * THROWS rather than warns, and that is the point. A sidecar in another space —
 * or built from another extent — draws a map that is subtly, invisibly wrong,
 * and a warning would leave it on screen. Refusing to draw it is the only
 * failure mode a reader can act on, and the app's own error note is a better
 * outcome than a plausible lie.
 *
 * @param {{space?: string, bounds?: number[]|number[][]}} loaded a
 *        loadCountyIndex() result, or anything carrying the same two fields
 * @param {string} label the tileset key, for the message
 * @returns {object} the same object, unchanged
 */
export function assertProjectedSpace(loaded, label = 'a boundary index') {
  if (!loaded || loaded.space !== DUMMY_SPACE) {
    throw new Error('[ngp/projection] ' + label + ' declares space '
      + JSON.stringify(loaded && loaded.space) + ', not ' + JSON.stringify(DUMMY_SPACE)
      + '. This map renders a pre-projected dummy plane and cannot draw geometry '
      + 'from anywhere else — see the header of this file.');
  }
  const got = flatBounds(loaded.bounds);
  const want = flatBounds(PROJECTED_BOUNDS);
  if (!got) {
    throw new Error('[ngp/projection] ' + label + ' has bounds '
      + JSON.stringify(loaded.bounds) + ', which is neither [w,s,e,n] nor '
      + '[[w,s],[e,n]].');
  }
  for (let i = 0; i < 4; i++) {
    if (Math.abs(got[i] - want[i]) > SPACE_EPSILON) {
      throw new Error('[ngp/projection] ' + label + ' is in ' + DUMMY_SPACE
        + ' but its extent disagrees with this app\'s by more than '
        + SPACE_EPSILON + ' dummy degrees: got ' + JSON.stringify(got)
        + ', expected ' + JSON.stringify(want) + '. Component ' + i + ' differs '
        + 'by ' + Math.abs(got[i] - want[i]) + '. One of the two producers of '
        + 'this plane has drifted, and every layer drawn from both is now '
        + 'misregistered.');
    }
  }
  return loaded;
}

/* ── What is NOT here any more ───────────────────────────────────────────────
   `projectCounties()` and its helpers are gone, along with the kit-cache keys
   they had to invalidate. Nothing projects geometry client-side: `data-tiles`
   builds the tiles and the sidecars' bounding boxes through this same
   transform, and `assertProjectedSpace()` above is what checks that it did.

   A call to a projection on this path would be a DOUBLE APPLICATION — Albers
   over Albers metres — which flings the composite into the next hemisphere. If
   a consumer ever needs geometry projected in the browser again the forward
   transform is `projectPoint()`, and the walker that was deleted is twenty
   lines of `git log`; do not reconstruct it from memory. */
