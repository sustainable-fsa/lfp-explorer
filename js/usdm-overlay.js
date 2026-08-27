/* ============================================================================
   LFP Explorer · js/usdm-overlay.js
   The U.S. Drought Monitor's OWN weekly map, drawn translucent over the county
   choropleth — and the one module that knows how to get it onto the map.

   ES module, no build step. Kit dependency: TILE_BASE, taken through
   js/boundaries.js so this app holds ONE string for the tile origin. App
   dependency: CLASS_HEX from js/interfaces/usdm.js, so the polygons and the
   counties under them cannot disagree about what D2 looks like. Decoding goes
   through the vendored global `window.topojson` (index.html loads it as a
   classic script, alongside MapLibre).

   ── Why a second layer, when the choropleth is already the drought ─────────
   The choropleth answers the question the PROGRAM asks: what is the worst
   drought class touching any part of this county this week (7 U.S.C.
   § 1531(d)(3), and js/interfaces/usdm.js § Why this map exists). That is the
   right picture for LFP and a lossy one for the drought itself — a county the
   size of San Bernardino wears D4 for a blob covering four per cent of it, and
   nothing on screen says which four per cent.

   This overlay puts the blob back. Same five NDMC hexes, translucent, drawn
   over the counties, so a reader can see the shape the county colour was
   reduced FROM. It is off by default, because the reduction is the subject of
   the view and the raw polygons are the evidence for it.

   NOTHING IS CLIPPED OR MASKED. The USDM is drawn at roughly 1:2,000,000 and
   published unclipped, so its edges overrun the coastline and spill past the
   county composite in places. That is the map the NDMC issued. Trimming it to
   the counties would make this layer agree with the layer it exists to be
   checked against, which is the one thing it must not do; help.md says so in
   the reader's own words.

   ── The archive, and why TopoJSON rather than tiles ────────────────────────
   `data-tiles` publishes one TopoJSON per week beside the county tilesets:
   1,390 files, 2000-01-04 through the newest Tuesday, in a sidecar that lists
   every date it has. MEASURED (2026-08-26): a week holds THREE TO FIVE
   MultiPolygon features — one per drought class present, D0 through D4, never
   overlapping — so the whole national map for a week is five rows. 2012-07-24
   decodes to 5 features / 83,096 coordinate pairs / 756 KB of JSON, 246 KB
   brotli over the wire; the wettest week in the record (2000-01-04) is 3
   features and 145 KB; the heaviest sampled (2026-08-18) is 261,039 pairs and
   702 KB.

   FIVE FEATURES DO NOT WANT TILES. A tileset would cut each class into
   hundreds of tiles to be reassembled, and the pmtiles header plus two
   directory range reads cost more round trips than the file does. The counties
   are tiled because there are 3,200 of them and the reader zooms to z19; this
   layer is one national picture that is either on screen or not. So it is a
   plain GeoJSON source and one `setData()` per week.

   ── NOTHING IS PROJECTED HERE. EVER. ───────────────────────────────────────
   The geometry ARRIVES in the app's dummy EPSG:5070 space — `data-tiles` runs
   the same `to_dummy` transform over the USDM polygons that it runs over the
   county tiles, gated to 1e-9 dummy degrees against the reference points in
   js/projection.js's header. `topojson.feature()`'s output goes to the source
   VERBATIM: there is no coordinate arithmetic anywhere in this file, and a
   projection call here would be a double application that flings the week's
   polygons into the next hemisphere.

   The registration check that replaces one is the sidecar's `space` field,
   asserted on decode — the same discipline as `assertProjectedSpace()` inside
   `loadBoundary()`, and for the same reason: a misregistered overlay lines up
   at the centre of the map and drifts at the edges, which is invisible until a
   reader zooms in to compare it against a county line.

   ── THE MARKER GRAMMAR ─────────────────────────────────────────────────────
   `document.documentElement.dataset.ngpOverlay` is this layer's settle signal,
   and the ONLY one. It is not the loading pill and it is emphatically not
   `data-ngp-view-seq`: no path in this file touches the view counter, because
   toggling an overlay is not a change of view and a harness that waited on the
   counter would wait forever.

     (absent)      not drawn — the toggle is off, or the view is not the
                   drought monitor
     loading       on; the target week is being fetched or decoded. What is on
                   screen underneath is the PREVIOUS week, whole — see § THE
                   FUSED CUTOVER — or nothing at all when there was no previous
                   week to hold
     YYYY-MM-DD    on; THAT week is attached and has been flushed to GL
     missing       on; the selected week is not one the USDM published
     error         on; the week's fetch or decode failed, or the sidecar is
                   unreadable

   The ISO stamps only after MapLibre says the source is loaded and two frames
   have passed — see `stampWhenDrawn()`, which has the whole argument.

   ── THE FUSED CUTOVER, AND WHY NOTHING IS CLEARED ANY MORE ────────────────
   This module used to empty the source before it went to the network, and the
   argument for it was good: leaving July's D4 blob up over August's choropleth
   is not a slow map but a wrong one, and it is wrong in the direction a reader
   cannot detect.

   The premise under that argument was that the COUNTIES changed instantly. They
   did — a week scrub was one synchronous pass of feature state — so the two
   halves of the picture cut over at different times whatever this module did,
   and the only choice was which lie to tell in the gap.

   They do not change instantly any more. `sync()` takes the caller's apply-tail
   as `onSettle`, and whenever a change of week would otherwise split the map in
   two it HOLDS that tail — the choropleth, the county card and the live
   sentence all wait — and runs it in the same task as the moment the incoming
   week's source first reports drawable, one tick before the frame that draws
   it. Both halves move together. That is the buffered-authority-swap principle
   (js/boundaries.js § swapBoundary, kit v0.4.0 § swapVintage) applied to the
   week axis: the outgoing picture keeps drawing, whole and coherent, until the
   incoming picture is really drawable, and then there is one flip.

   So the clear is gone. What a reader looks at during the fetch is last week's
   counties under last week's polygons — a true map of a week they were looking
   at a moment ago — rather than this week's counties under nothing. A retired
   picture that is internally consistent is worth more than a fresh one that is
   half missing, which is the same argument the kit makes for keeping a retired
   county stack resident rather than blank.

   THE FUSE IS DECIDED PER CALL AND IT IS NARROW: the overlay is on, something
   is already drawn, and the target is a DIFFERENT week. Everything else — the
   toggle coming on from nothing, a same-week recolour, a theme flip, the three
   families that have no overlay at all, the off state — runs the tail
   synchronously inside sync(), exactly as it ran before any of this existed.

   AND EVERY EXIT RUNS IT. A failed fetch, a week the USDM never published, a
   county stack that is not on the map yet: the county repaint is true whether
   or not the polygons arrive, and it is never the overlay's to lose. That is
   also why the hold has a ceiling (§ HOLD_CEILING_MS) — a fetch that never
   answers must cost the reader an unfused cutover, not a frozen map.

   ── THE KIT ANCHOR ────────────────────────────────────────────────────────
   The overlay sits directly beneath the county LINE layer, so the boundaries,
   the hover halo, the state mesh and the selection ring all stay above it
   (HOUSE-STYLE §7) — a reader has to be able to see which county a blob is
   sitting on.

   That anchor is `handle.layers.line`, READ AT THE MOMENT OF USE and never
   held. From kit v0.4.0 the tiled path keeps more than one archive's geometry
   resident and the layer ids carry a stack slot suffix (`sfsa-county-line#0`)
   that MOVES when the front does. And a retired stack is transparent rather
   than hidden, so a stale literal does not fail loudly — it names a real layer
   belonging to the archive the reader stopped looking at. Hence `anchorOf()`,
   and hence `reanchor()`, which app.js calls after every boundary swap: the
   kit inserts an incoming stack BENEATH the whole county block, which would
   otherwise leave this layer stranded above the new counties.

   ── What this module does NOT do ───────────────────────────────────────────
   It has no opinion about whether the overlay should be on, or about how
   strongly it should be drawn. Both are the reader's — the `polygons` choice
   and the opacity slider beneath it — and this module is told both answers on
   every reconcile. It holds no week of its own either: the week is the app's
   selection, and `sync()` is a reconciler, not a controller.

   It also assumes ONE live map, because this app has one. The poster's
   throwaway offscreen map goes through `addOverlayLayers()`, which touches no
   module state at all.
   ========================================================================== */

import { TILE_BASE } from './boundaries.js';
import { CLASS_HEX } from './interfaces/usdm.js';

/* ── Identity ────────────────────────────────────────────────────────────────
   APP-OWNED ids, unlike every county layer id in this app. The kit's are the
   kit's to move; these two are ours, they have the same standing as a DOM id,
   and the harness may pin them. */

/** The GeoJSON source holding one week of USDM polygons. */
export const OVERLAY_SOURCE_ID = 'ngp-usdm-overlay';

/** The one layer drawn from it. There is no line layer — see § Paint. */
export const OVERLAY_FILL_ID = 'ngp-usdm-overlay-fill';

/* ── The archive ─────────────────────────────────────────────────────────────
   ONE-STRING DISCIPLINE. `TILE_BASE` is the kit's, re-exported by
   js/boundaries.js; the weekly files live beside the tiles rather than in them,
   and every URL below is derived from it. The weekly template is resolved
   RELATIVE TO THE SIDECAR'S OWN DIRECTORY and never composed from a filename
   pattern held here, so the producer can rename or content-hash the files
   without a consumer change — the same rule the county sidecars' `tiles.url`
   already follows. */

const USDM_BASE = new URL('../usdm/', TILE_BASE).href;
const USDM_INDEX_URL = new URL('usdm-index.json', USDM_BASE).href;

/** What the sidecar must say it is. A mismatch is a hard failure, not a
    fallback: the alternative to refusing is drawing polygons of unknown
    provenance in unknown coordinates. */
const INDEX_SCHEMA = 'sfsa-usdm-index/1';

/** The coordinate space the geometry is published in — the registration check
    that stands in for a projection call (see the header). */
const INDEX_SPACE = 'sfsa-albers-usa/1';

/** The TopoJSON object key the producer pins. */
const INDEX_OBJECT = 'usdm';

/**
 * How many decoded weeks to keep.
 *
 * Eight is sized for the reader who scrubs back and forth across a summer: at
 * ~80k–260k coordinate pairs a week, eight is tens of megabytes at the top of
 * the record and a few at the bottom, and dropping to four would make the
 * common A/B — this week against the same week last year — a refetch every
 * time. The trip back through a scrub is what this cache is for.
 */
const WEEK_CACHE_MAX = 8;

/** The source's resting state, and what "no overlay" looks like on the map. */
const EMPTY_FC = Object.freeze({ type: 'FeatureCollection', features: [] });

/**
 * How long a fused cutover may hold the caller's apply-tail before it gives up
 * and lets the county repaint go through unfused.
 *
 * THE HOLD IS A COURTESY; THE REPAINT IS NOT. Everything the tail carries — the
 * choropleth, the county card, the sentence in the live region — is true about
 * the week the reader selected whether or not the polygons for it ever arrive,
 * so a hold that could last forever would be this module taking the rest of the
 * app hostage over its own network. Six seconds is far longer than the ~250 KB
 * a week costs over the wire (measured: 0.24–0.26 MB brotli for the 2012 weeks)
 * and far shorter than a reader's patience with a map that has stopped
 * answering. Tripping it costs exactly what the old behaviour cost on every
 * scrub: the counties cut over first and the polygons follow.
 */
const HOLD_CEILING_MS = 6000;

/**
 * How strongly the polygons are painted when nobody has said otherwise, as a
 * GL opacity rather than the app's percentage.
 *
 * 0.45 is the shipped look and the whole of the original design: opaque enough
 * that a D4 blob reads as a shape, sheer enough that the county colour and the
 * county lines survive under it. It is now a DEFAULT rather than a constant —
 * the reader has a slider — but it is still what an overlay comes up at, what
 * a poster is printed at when nothing else is asked for, and what any value
 * this module cannot use falls back to.
 */
const DEFAULT_OPACITY = 0.45;

/**
 * A caller's opacity, or the default — validated here rather than trusted,
 * because a paint property is the one place a `NaN` or a string would not
 * announce itself: MapLibre would take it, and the layer would simply stop
 * being visible with nothing in the console to say why.
 *
 * @param {number} raw a GL opacity, 0–1
 * @returns {number}
 */
function normalizeOpacity(raw) {
  return (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1)
    ? raw : DEFAULT_OPACITY;
}

/**
 * What the live region says when a week the index promised could not be
 * fetched. VERBATIM — the a11y gate matches this sentence.
 */
const SENTENCE_FETCH_FAIL = 'The USDM drought polygons for this week could not '
  + 'be loaded.';

/* ── Paint ───────────────────────────────────────────────────────────────────
   The five class hexes are the NDMC's own, imported rather than restated so
   the overlay and the choropleth beneath it are one palette (js/interfaces/
   usdm.js § The palette says why they are frozen national convention and not a
   design choice). They are DATA-ENCODING colours, not theme tokens
   (HOUSE-STYLE §6), so a theme flip needs nothing from this file.

   `None` never appears: the weekly files carry one feature per class PRESENT,
   D0 through D4, and drought-free is the absence of a polygon rather than a
   polygon of its own. The `match` fallback is fully transparent for the same
   reason — a class this app does not know must draw as nothing, never as a
   default colour that would read as a real drought class.

   0.45 is where it starts, and for a long time it was the whole of the design:
   opaque enough that a D4 blob reads as a shape, sheer enough that the county
   colour and the county lines survive under it. It is a default now, because
   the two things a reader wants from this layer pull in opposite directions —
   read the drought's shape, or read the county underneath it — and no single
   number serves both. The slider is the app's (§ The USDM polygon overlay in
   js/app.js); what this module owns is that the number reaching GL is one it
   validated.

   There is no line layer — an outline on five nested national polygons is a
   cage of hairlines at any zoom a reader actually uses, and the county
   boundaries above it are the linework this map needs.

   NEVER FLIP OR TRANSITION A DATA-DRIVEN PAINT PROPERTY (CLAUDE.md, kit
   v0.4.1). `fill-color` here IS data-driven, so it is written once at layer
   creation and never touched again; the overlay is hidden with `visibility`, a
   LAYOUT property, which is exactly why the retired-stack trick that broke the
   kit's hover layer cannot happen here — and it is why `fill-opacity` is the
   property the slider drives (§ applyOpacity). */
function fillLayerDef(opacity) {
  return {
    id: OVERLAY_FILL_ID,
    type: 'fill',
    source: OVERLAY_SOURCE_ID,
    paint: {
      'fill-color': ['match', ['get', 'usdm_class'],
        'D0', CLASS_HEX.D0, 'D1', CLASS_HEX.D1, 'D2', CLASS_HEX.D2,
        'D3', CLASS_HEX.D3, 'D4', CLASS_HEX.D4,
        'rgba(0,0,0,0)'],
      'fill-opacity': normalizeOpacity(opacity),
    },
  };
}

/* ── Module state ────────────────────────────────────────────────────────────
   One live map, one reconciler. `targetKey` is what the module is currently
   reconciling TOWARD and is what makes sync() idempotent; `seq` is what makes
   it re-entrant, and every await in this file re-reads it. */

/** The last target sync() was given, as a comparable string. */
let targetKey = 'off';

/** Monotonic. A run whose number is no longer `seq` has been superseded and
    abandons SILENTLY — it is not an error to stop caring about a week the
    reader has scrubbed past. */
let seq = 0;

/** `{iso, controller}` for a fetch this module started and may abort. Null when
    nothing is in flight, or when the in-flight promise came from warm() and is
    therefore not ours to cancel. */
let inflight = null;

/** Cancels the pending settle listener, if there is one. Called before every
    new wait, so repeated syncs cannot leave listeners on the map. */
let stampOff = null;

/** `{dateIso, fc}` — the week the source really holds, or null.
    Deliberately NOT set at setData() time: it is written in the settle handler,
    at the instant MapLibre says the incoming week is drawable, because that is
    the instant the fused cutover happens and this is the value the fuse
    condition asks about (§ THE FUSED CUTOVER). "Attached" means on screen, not
    requested. The MARKER waits two more frames on top of that — a settle signal
    for a harness has to mean a frame was painted, which is a stricter claim than
    this module needs for its own bookkeeping. */
let attached = null;

/** The apply-tails of every sync currently held for the fused cutover, each
    with the resolver of the promise that sync() handed its caller.

    An ARRAY rather than one slot because more than one caller can be waiting on
    the same cutover: a scrub starts the hold, and a theme flip or a county click
    landing inside it recolours against the same target week and joins it. They
    are drained together, exactly once, and dropped together when a newer sync
    supersedes them — the seq guard decides, and a superseded tail says nothing,
    because being scrubbed past is not a failure. */
let held = [];

/** The ceiling timer for the hold above, or 0. */
let holdTimer = 0;

/** The sidecar, once. Cleared on failure so a later sync retries it. */
let indexPromise = null;

/** The strength the app last asked for, 0–1. Held rather than read at layer
    creation, because the reader can move the slider while the layer does not
    exist yet — before the overlay has ever been turned on, and while it is
    off — and the value they left it at is what it must come up at. */
let wantOpacity = DEFAULT_OPACITY;

/** The strength actually written to the layer, or null while there is no layer.
    The difference between this and `wantOpacity` is the whole of the "only when
    it changed" test in applyOpacity(). */
let paintedOpacity = null;

/**
 * iso → `{promise, value}`, insertion-ordered, capped at WEEK_CACHE_MAX.
 *
 * PROMISES, not values, so two callers wanting the same week — a warm-on-intent
 * prefetch and the sync that follows it a beat later — share one fetch. `value`
 * is filled in on resolve and is what makes a cache hit INSTANT: a resolved
 * entry can be handed to setData() in the same task, with no `loading` marker
 * and no network at all, so the cutover waits only for MapLibre to re-tile five
 * MultiPolygons — which is what makes a scrub back to last week feel like a
 * scrub rather than a load.
 *
 * A rejected entry evicts itself, so a CDN hiccup is retried rather than
 * cached as a failure.
 */
const weeks = new Map();

/* ── The held apply-tail ─────────────────────────────────────────────────────
   Three functions and one rule: a tail runs EXACTLY ONCE or not at all, and the
   seq guard is what decides which. Everything here is synchronous — a tail that
   waited for a microtask would land in a different task from the sourcedata
   event that released it, which is the one thing the fused cutover cannot
   survive (see § THE FUSED CUTOVER). */

/**
 * Park a tail on the cutover now in flight, and hand back the promise sync()
 * returns for it.
 *
 * @param {() => void} fn the caller's apply-tail
 * @returns {Promise<boolean>} true when it ran, false when it was superseded
 */
function holdTail(fn) {
  return new Promise((resolve) => {
    held.push({ fn, resolve });
    if (!holdTimer && typeof setTimeout === 'function') {
      // Captured now: releaseTails() checks it, so a ceiling that fires after a
      // newer sync has taken over must not release the newer sync's tails.
      const mine = seq;
      holdTimer = setTimeout(() => {
        holdTimer = 0;
        if (mine !== seq || !held.length) return;
        console.warn('[usdm-overlay] the polygons for this week have not '
          + 'arrived in ' + HOLD_CEILING_MS + ' ms, so the counties are being '
          + 'repainted without waiting for them; the overlay will catch up on '
          + 'its own.');
        releaseTails(mine);
      }, HOLD_CEILING_MS);
    }
  });
}

/**
 * Run every parked tail, in the order they were parked, and resolve their
 * promises true.
 *
 * The array is swapped out BEFORE the first call, so a tail that re-entered
 * sync() — a recolour inside a recolour — cannot see itself still parked and
 * cannot be run twice. A tail that throws is reported and the rest still run:
 * one descriptor leaf failing is not a reason to leave the card and the live
 * region describing a week that is no longer on screen.
 *
 * @param {number} mine the seq the caller was issued
 */
function releaseTails(mine) {
  if (mine !== seq) return;              // superseded — dropTails() has them
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
  if (!held.length) return;
  const pending = held;
  held = [];
  for (const entry of pending) {
    try { entry.fn(); } catch (err) {
      console.error('[usdm-overlay] the caller\'s apply-tail threw while the '
        + 'overlay was handing the map back to it.', err);
    }
    entry.resolve(true);
  }
}

/** Abandon every parked tail — a newer sync has taken over, and the newest
    caller's tail carries the newest colours. Silent: the reader scrubbing past
    a week is not a failure. */
function dropTails() {
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
  if (!held.length) return;
  const pending = held;
  held = [];
  for (const entry of pending) entry.resolve(false);
}

/* ── The marker ──────────────────────────────────────────────────────────── */

/**
 * Write (or clear) `data-ngp-overlay`. The grammar is in the header; this is
 * the only function that touches the attribute, and nothing in this file ever
 * touches `data-ngp-view-seq`.
 *
 * @param {string|null} value an ISO date, 'loading', 'missing', 'error', or
 *        null to remove the attribute entirely
 */
function marker(value) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (value == null) delete root.dataset.ngpOverlay;
  else root.dataset.ngpOverlay = value;
}

/**
 * Report a failure the reader can be told about: the console (an ERROR, never
 * a warn — both harnesses collect `m.type() === 'error'` only, so a warn here
 * would be a tripwire that never trips), the marker, and the live region.
 *
 * It also drops `targetKey`, which is the retry: the next sync — the next
 * recolor, the next week — cannot match a null key, so it re-runs this same
 * target instead of no-opping on it.
 */
function fail(what, err, announce) {
  console.error('[usdm-overlay] ' + what + '. No polygons are drawn; the next '
    + 'reconcile will try again.', err);
  marker('error');
  if (typeof announce === 'function') announce(SENTENCE_FETCH_FAIL);
  targetKey = null;
}

/* ── The sidecar ─────────────────────────────────────────────────────────── */

/**
 * Fetch, decode and VALIDATE the weekly index, once per session.
 *
 * MEASURED (2026-08-26): 18,267 bytes, `public, max-age=3600`, CORS `*`,
 * 1,390 dates from 2000-01-04 to 2026-08-18, strictly ascending ISO Tuesdays
 * with no gaps. The producer refreshes weekly, so the newest date MOVES — which
 * is why nothing in this app, or in its gates, may reach for "the latest week"
 * as a fixture.
 *
 * @returns {Promise<Readonly<{url: string, object: string, dates: string[],
 *          dateSet: Set<string>}>>}
 */
function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetch(USDM_INDEX_URL)
      .then((res) => {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + USDM_INDEX_URL);
        return res.json();
      })
      .then(validateIndex)
      .catch((err) => {
        // Evict, so a hiccup at boot is not a session-long absence of overlay.
        indexPromise = null;
        throw err;
      });
  }
  return indexPromise;
}

/**
 * Every field this module relies on, checked at once and reported at once.
 *
 * `space` is the load-bearing one and the reason this is an assertion rather
 * than a shrug: it is the only thing standing between the app and geometry in
 * some other coordinate system, because nothing downstream of here looks at a
 * coordinate (§ NOTHING IS PROJECTED HERE).
 */
function validateIndex(raw) {
  const bad = [];
  if (!raw || typeof raw !== 'object') {
    bad.push('the body is not a JSON object');
  } else {
    if (raw.schema !== INDEX_SCHEMA) {
      bad.push('schema is ' + JSON.stringify(raw.schema) + ', expected '
        + JSON.stringify(INDEX_SCHEMA));
    }
    if (raw.space !== INDEX_SPACE) {
      bad.push('space is ' + JSON.stringify(raw.space) + ', expected '
        + JSON.stringify(INDEX_SPACE) + ' — these polygons would be drawn in '
        + 'the wrong coordinates');
    }
    if (raw.object !== INDEX_OBJECT) {
      bad.push('object is ' + JSON.stringify(raw.object) + ', expected '
        + JSON.stringify(INDEX_OBJECT));
    }
    if (typeof raw.url !== 'string' || !raw.url.includes('{date}')) {
      bad.push('url is ' + JSON.stringify(raw.url) + ', which is not a '
        + '{date} template');
    }
    if (!Array.isArray(raw.dates) || raw.dates.length === 0) {
      bad.push('dates is not a non-empty array');
    }
  }
  if (bad.length) {
    throw new Error('the weekly index at ' + USDM_INDEX_URL + ' is not usable ('
      + bad.join('; ') + ')');
  }
  return Object.freeze({
    url: raw.url,
    object: raw.object,
    dates: Object.freeze(raw.dates.slice()),
    // The membership test the reconciler asks on every week change, so a scrub
    // across a year is 52 Set lookups rather than 52 scans of 1,390 strings.
    dateSet: new Set(raw.dates),
  });
}

/* ── One week ────────────────────────────────────────────────────────────── */

/**
 * Fetch and decode one weekly TopoJSON.
 *
 * `topojson.feature()`'s FeatureCollection is returned VERBATIM. Every feature
 * is a MultiPolygon carrying exactly `{date, usdm_class}` and no id — three to
 * five of them, one per class present — and the app never indexes them by
 * position, because a dry week simply has fewer.
 *
 * @param {string} iso a date the index listed
 * @param {object} index a validateIndex() result
 * @param {AbortSignal} [signal]
 * @returns {Promise<object>} a GeoJSON FeatureCollection in dummy EPSG:5070
 */
async function fetchWeek(iso, index, signal) {
  const url = new URL(index.url.replace('{date}', iso), USDM_BASE).href;
  const res = await fetch(url, signal ? { signal } : undefined);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  const topo = await res.json();

  const topo2geo = (typeof window !== 'undefined') ? window.topojson : null;
  if (!topo2geo || typeof topo2geo.feature !== 'function') {
    throw new Error('window.topojson is not loaded, so ' + url + ' cannot be '
      + 'decoded (index.html loads topojson-client as a classic script)');
  }
  if (!topo || topo.type !== 'Topology' || !topo.objects
      || !topo.objects[index.object]) {
    throw new Error(url + ' is not a TopoJSON topology with an object named '
      + JSON.stringify(index.object));
  }

  const fc = topo2geo.feature(topo, topo.objects[index.object]);
  if (!fc || !Array.isArray(fc.features)) {
    throw new Error(url + ' decoded to something that is not a '
      + 'FeatureCollection');
  }
  return fc;
}

/**
 * The cache entry for a week, creating and starting one if there is none.
 *
 * A hit is moved to the end of the Map — insertion order IS the LRU order, and
 * refreshing on hit is what keeps the week a reader keeps coming back to from
 * ageing out behind seven they scrubbed through once.
 */
function weekEntry(iso, index, signal) {
  const hit = weeks.get(iso);
  if (hit) {
    weeks.delete(iso);
    weeks.set(iso, hit);
    return hit;
  }

  const entry = { promise: null, value: null };
  entry.promise = fetchWeek(iso, index, signal).then((fc) => {
    entry.value = fc;
    return fc;
  }, (err) => {
    // Evict on rejection — an aborted or failed week must not be cached as a
    // failure, or the retry the error path promises would never happen.
    if (weeks.get(iso) === entry) weeks.delete(iso);
    throw err;
  });
  weeks.set(iso, entry);

  while (weeks.size > WEEK_CACHE_MAX) {
    const oldest = weeks.keys().next().value;
    weeks.delete(oldest);
  }
  return entry;
}

/**
 * Abandon the fetch this module started, if any.
 *
 * The eviction is SYNCHRONOUS and that is the whole point. The rejection
 * handler in weekEntry() evicts too, but it runs a microtask later — and a
 * sync that aborts week A and immediately looks up week A again (scrub away,
 * scrub straight back) would find the doomed entry still in the Map, await it,
 * and receive the AbortError meant for somebody else. It would then return
 * silently, leaving the overlay empty and the marker stuck on `loading`.
 */
function abortInFlight() {
  if (!inflight) return;
  const { iso, controller } = inflight;
  inflight = null;
  const entry = weeks.get(iso);
  if (entry && !entry.value) weeks.delete(iso);
  controller.abort();
}

/* ── The layer ───────────────────────────────────────────────────────────── */

/**
 * The kit layer this overlay is inserted before — read from `handle.layers` AT
 * THE MOMENT OF USE, never stored (see § THE KIT ANCHOR).
 *
 * Returns null rather than a guess when the county stack is not up: MapLibre
 * throws if `addLayer`'s beforeId names no layer, and an overlay added without
 * one would land on TOP of the county lines, the hover halo and the selection
 * ring, which is a different map from the one this feature is.
 */
function anchorOf(map, handle) {
  const layers = handle && handle.layers;
  const line = layers && layers.line;
  return (line && map.getLayer(line)) ? line : null;
}

/**
 * Source and layer, created once and then resident for the session.
 *
 * @returns {boolean} false when there is nothing to anchor to, in which case
 *          nothing was created and the caller must not claim an overlay
 */
function ensureLayer(map, handle) {
  if (map.getLayer(OVERLAY_FILL_ID)) return true;

  const beforeId = anchorOf(map, handle);
  if (!beforeId) {
    console.warn('[usdm-overlay] the county layers are not on the map yet, so '
      + 'there is nothing to anchor the overlay beneath; it will be added on '
      + 'the next reconcile.');
    return false;
  }
  if (!map.getSource(OVERLAY_SOURCE_ID)) {
    map.addSource(OVERLAY_SOURCE_ID, { type: 'geojson', data: EMPTY_FC });
  }
  map.addLayer(fillLayerDef(wantOpacity), beforeId);
  paintedOpacity = normalizeOpacity(wantOpacity);
  return true;
}

/**
 * Set the overlay's strength, and only when it has really changed.
 *
 * SAFE, and it is worth saying why in the file that says the opposite two
 * screens up. The rule from kit v0.4.1 is about a DATA-DRIVEN paint property
 * with a transition declared on it: flipping one leaves MapLibre's paint binder
 * holding a value whose expression has no `evaluate`, and the next
 * feature-state change throws inside a render. `fill-opacity` here is neither
 * half of that — it is a plain constant, no `['case', …]` and no `['get', …]`
 * anywhere in it, and this layer declares no transitions at all — so
 * `setPaintProperty` on it is an ordinary paint update.
 *
 * The "only when changed" guard is not about safety, it is about noise:
 * sync() runs from recolor(), which runs on every week scrub, every theme flip
 * and every county click, and a repeated setPaintProperty would re-upload the
 * paint on all of them.
 */
function applyOpacity(map, raw) {
  const next = normalizeOpacity(raw);
  wantOpacity = next;
  if (!map.getLayer(OVERLAY_FILL_ID)) return;   // ensureLayer() will use it
  if (paintedOpacity === next) return;
  map.setPaintProperty(OVERLAY_FILL_ID, 'fill-opacity', next);
  paintedOpacity = next;
}

/** Hand the source a FeatureCollection. A no-op before the source exists,
    which is what makes the clears in sync() and run() safe to call at any point
    in the layer's life.

    Every WEEK is attached with the layer already visible, and that ordering is
    deliberate: MapLibre leaves a hidden layer's source out of
    `Style._updateSources`, so a hidden overlay is not a reliable place to
    settle — the event the ISO stamp waits on might never arrive. The one call
    that can land on a hidden layer is the clear on the way back from `off`,
    which nothing waits for and which `show()` follows in the same task. */
function setData(map, data) {
  const src = map.getSource(OVERLAY_SOURCE_ID);
  if (src && typeof src.setData === 'function') src.setData(data);
}

function show(map) {
  if (!map.getLayer(OVERLAY_FILL_ID)) return;
  if (map.getLayoutProperty(OVERLAY_FILL_ID, 'visibility') === 'none') {
    map.setLayoutProperty(OVERLAY_FILL_ID, 'visibility', 'visible');
  }
}

/* ── The settle ──────────────────────────────────────────────────────────── */

function afterTwoFrames(fn) {
  if (typeof requestAnimationFrame !== 'function') { fn(); return; }
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

/** Drop the pending settle listener. Every new wait calls this first, so a
    reader thrashing the week scrubber leaves exactly one listener on the map,
    not one per input event. */
function clearStamp(map) {
  if (stampOff) { stampOff(map); stampOff = null; }
}

/**
 * Take the cutover the moment the week is REALLY drawable, and stamp its ISO
 * once a frame has been painted from it.
 *
 * Two conditions, and the second one is the trap.
 *
 * `sourcedata` with `isSourceLoaded === true` for our source is the necessary
 * one. But MapLibre fires that event three ways after a `setData()`, and they
 * do not all mean the same thing (measured against the vendored maplibre-gl
 * 5.18.0, and true of the whole 5.x line):
 *
 *   metadata   fired the moment the worker returns the parsed data, BEFORE the
 *              tile manager has reloaded anything. `isSourceLoaded` is
 *              computed from the tiles still on screen — the PREVIOUS week's,
 *              all of them loaded — so it answers TRUE for a source that has
 *              not drawn one polygon of the new data. Stamping here would tell
 *              a harness "2012-07-24 is up" over last week's picture.
 *   content    fired immediately after, and the tile manager's own handler
 *              (which runs first, being the source's evented parent) has
 *              already called reload(); every in-view tile is 'reloading', so
 *              `isSourceLoaded` is false and this event filters itself out.
 *   content    once per tile as the re-tiled data lands. The last of them has
 *              every tile loaded and is the one we want.
 *
 * THE `metadata` FILTER CARRIES MORE WEIGHT SINCE THE CLEAR WENT AWAY. It was
 * always wrong to stamp there; now the tiles it answers TRUE about are last
 * week's REAL polygons rather than an emptied source, so releasing the fused
 * cutover on it would repaint the counties for a week whose polygons had not
 * been tiled yet — the exact mismatch this whole arrangement exists to close,
 * reintroduced at the one point where nothing downstream could see it.
 *
 * Everything between the `setData()` call and the worker's return is covered
 * for free — GeoJSONSource.loaded() is false while a worker update is pending,
 * and the tile manager's loaded() defers to it, so a straggler tile from the
 * week the reader just scrubbed away from cannot qualify either.
 *
 * THEN THE ORDER OF THE LAST THREE LINES IS THE WHOLE FEATURE:
 *
 *   1. `attached`, because from this instant the source holds this week and the
 *      next sync's fuse condition has to be asked about the new picture;
 *   2. `releaseTails()`, SYNCHRONOUSLY, in this task — the caller's feature-state
 *      writes and the freshly tiled polygons then reach GL together, because
 *      MapLibre coalesces pending feature state inside the same `_render()` that
 *      draws the new tiles;
 *   3. the ISO marker, after a DOUBLE requestAnimationFrame, for the same reason
 *      bumpViewSeq() does it (js/app.js): the event says the data is in, not
 *      that a frame has been painted from it, and a settle signal has to mean
 *      the stricter thing.
 */
function stampWhenDrawn(map, iso, fc, mine) {
  clearStamp(map);

  let done = false;
  const onData = (e) => {
    if (done || !e || e.sourceId !== OVERLAY_SOURCE_ID) return;
    if (e.sourceDataType === 'metadata') return;
    if (e.isSourceLoaded !== true) return;
    done = true;
    map.off('sourcedata', onData);
    if (stampOff === off) stampOff = null;
    // Superseded between the setData() and the tiles landing: the reader has
    // scrubbed on, a newer sync has already dropped this run's tails, and
    // nothing here is true any more. Say nothing.
    if (mine !== seq) return;
    attached = Object.freeze({ dateIso: iso, fc });
    releaseTails(mine);
    afterTwoFrames(() => {
      // The reader may have scrubbed on in those two frames. Say nothing.
      if (mine !== seq) return;
      marker(iso);
    });
  };
  const off = (m) => {
    if (done) return;
    done = true;
    if (m && typeof m.off === 'function') m.off('sourcedata', onData);
    else map.off('sourcedata', onData);
  };

  stampOff = off;
  map.on('sourcedata', onData);
}

/* ── The reconciler ──────────────────────────────────────────────────────── */

/**
 * Bring the overlay into line with a selection. Fire-and-forget, idempotent,
 * and re-entrant.
 *
 * IDEMPOTENT: the same target twice is a no-op, and it must be, because the
 * app calls this from recolor() — which runs on every week scrub, every theme
 * flip and every county click. Re-running would restart a fetch the previous
 * call is halfway through.
 *
 * RE-ENTRANT: a target that really is new bumps `seq`, and every continuation
 * after every await re-reads it. A run whose number has moved on abandons
 * without a word — the reader scrubbing past a week is not a failure, and
 * saying so in the console would put a warning on every drag of the scrubber.
 *
 * AND IT MAY NOW HOLD THE CALLER'S OWN WORK. `onSettle` is the apply-tail of
 * whatever asked for this reconcile — in this app, the choropleth repaint, the
 * county card and the live sentence (js/app.js § recolor). It runs
 * SYNCHRONOUSLY, before this function returns, in every case except the one
 * that would otherwise split the map in two; there it is held until the
 * incoming week is drawable and then run in that same task, so the two halves
 * of the picture cut over together (§ THE FUSED CUTOVER).
 *
 * @param {object} args
 * @param {object} args.map the live MapLibre map
 * @param {object} args.handle the kit's addCountyLayers() handle, for its
 *        `layers` getter ONLY, and only at the moment of use
 * @param {boolean} args.on the reader's choice, or false whenever the drought
 *        monitor is not the view on screen
 * @param {string|null} args.dateIso the selected week's Tuesday, ISO. Null
 *        while `on` is a week the app cannot name yet, and is treated exactly
 *        like a week the USDM never published.
 * @param {number} [args.opacity] how strongly to paint the polygons, 0–1.
 *        Anything else is the default (§ DEFAULT_OPACITY).
 * @param {(text: string) => void} [args.announce] the live region writer
 * @param {() => void} [args.onSettle] the caller's apply-tail. Run exactly once
 *        for the call that wins and never for one that is superseded.
 * @returns {Promise<boolean>} resolved once `onSettle` has run (true) or been
 *        superseded (false). NEVER REJECTS, and callers are free to ignore it:
 *        the reconciler is still fire-and-forget, and the only caller in this
 *        app that awaits it is the one whose marker would otherwise claim a
 *        paint that had not happened (js/app.js § applyDataset).
 */
export function sync({ map, handle, on, dateIso, announce, opacity,
  onSettle } = {}) {
  const settle = (typeof onSettle === 'function') ? onSettle : null;

  /* No map at all — boot, or a teardown. The overlay has nothing to reconcile,
     but the caller's repaint is not the overlay's to withhold. */
  if (!map || typeof map.getLayer !== 'function') {
    if (settle) settle();
    return Promise.resolve(true);
  }

  /* BEFORE the idempotence guard below, and that ordering is the whole of it:
     a change of strength is not a change of TARGET — the same week stays
     attached to the same source — so an opacity-only reconcile has the same key
     as the one before it and would return at the next line without ever
     reaching the paint.

     Only while the overlay is ON, though. `off` is also what the app says while
     ANOTHER family is on screen, and another family has no overlay and
     therefore no opinion about how strongly to draw one — it would be saying
     the default, which would quietly retune a hidden layer the reader is coming
     back to. A retired overlay keeps its strength for the same reason it keeps
     its week. */
  if (on) applyOpacity(map, opacity);

  const iso = on ? (dateIso || null) : null;

  /* THE FUSE CONDITION, and it is deliberately narrow (§ THE FUSED CUTOVER).
     Three things have to be true at once: the overlay is on, a week is really
     drawn right now, and the target is a DIFFERENT one. That is exactly the
     case where a synchronous county repaint would pair this week's colours with
     last week's polygons. Anything else has no coherent picture to hold — a
     toggle coming on from nothing, a same-week recolour, the off state, and the
     three families that have no overlay at all — and runs the tail on the spot,
     which is what those callers did before this parameter existed.

     Asked of `attached`, never of `targetKey`: what may be held back is a
     PICTURE, and the only honest witness to what is on the map is the value
     written when MapLibre said the source was drawable. */
  const showing = attached;
  const fuse = !!on && !!showing && iso !== showing.dateIso;

  const key = on ? 'on:' + (iso || '') : 'off';
  if (key === targetKey) {
    /* The same target as the run already under way. If that run is a cutover
       still waiting to happen, this caller's tail belongs to it: a theme flip or
       a county click landing mid-hold has recomputed the colours for the week
       being held FOR, and running them now would put them on the polygons being
       held FROM. Otherwise there is nothing to wait for. */
    if (fuse && settle) return holdTail(settle);
    if (settle) settle();
    return Promise.resolve(true);
  }
  targetKey = key;

  const mine = (seq += 1);
  clearStamp(map);
  abortInFlight();
  // A newer target: every tail parked on the old one is history, and the newest
  // caller's tail carries the newest colours.
  dropTails();

  /* NOTHING IS CLEARED WHEN THE CUTOVER CAN BE FUSED — the reversal, and the
     header has the argument. The old week keeps drawing under the old counties,
     which is a true map of a week the reader was looking at a moment ago, until
     the new week is drawable and both change together.

     When it CANNOT be fused there is no coherent picture to hold: `attached` is
     null because nothing is drawn, the source is already empty or about to be
     wrong, and the clear is what makes `loading` mean what it says. A week
     already decoded skips it either way — there is nothing to wait for. */
  if (on) {
    const hit = iso ? weeks.get(iso) : null;
    const cached = !!(hit && hit.value);
    if (!fuse) attached = null;
    if (!cached) {
      if (!fuse) setData(map, EMPTY_FC);
      // `loading` would be a claim that something is on its way, and a null week
      // is not on its way anywhere; run() answers it with `missing`.
      if (iso) marker('loading');
    }
  }

  const done = (fuse && settle) ? holdTail(settle) : null;

  run(map, handle, mine, !!on, iso, announce)
    .catch((err) => {
      // run() owns its own failures, so anything arriving here is a defect in
      // this module rather than a fact about the network. The tail is still the
      // caller's: a bug here must not cost the reader their choropleth.
      targetKey = null;
      console.error('[usdm-overlay] the overlay reconciler threw, which is a '
        + 'bug in js/usdm-overlay.js rather than a data problem.', err);
      releaseTails(mine);
    });

  /* LAST, and after run() has been started rather than before it. An unfused
     tail is the caller's own code and it is allowed to throw; letting it throw
     out of here before the reconcile had even begun would leave `targetKey`
     claiming a target nothing is working towards, and the next sync would
     no-op on it. Started first, a throwing tail costs exactly what it cost
     before this parameter existed: the exception reaches the caller, and the
     overlay is reconciled anyway. */
  if (!done && settle) settle();

  return done || Promise.resolve(true);
}

/**
 * The asynchronous half of one reconcile.
 *
 * EVERY EXIT EITHER RELEASES THE HELD TAIL OR HAS ALREADY BEEN SUPERSEDED, and
 * there is no third case. A tail is the caller's choropleth, card and live
 * sentence, all of them true about the week the reader selected regardless of
 * what the overlay managed to fetch — so a week the USDM never published, a CDN
 * hiccup and a county stack that has not landed yet all hand it straight back.
 * The only exits that DO NOT release are the ones guarded by `mine !== seq`,
 * where a newer sync has already dropped these tails and is carrying its own.
 */
async function run(map, handle, mine, on, iso, announce) {
  if (!on) {
    /* THE LAYER STAYS. Hidden, not removed — the kit's own retired-stack
       precedent, and for a plainer reason here: a reader toggling this off and
       on again is comparing two pictures, and rebuilding the source each time
       would put a fetch between them. */
    attached = null;
    if (map.getLayer(OVERLAY_FILL_ID)) {
      map.setLayoutProperty(OVERLAY_FILL_ID, 'visibility', 'none');
    }
    marker(null);
    // Nothing was held for an `off` — the fuse condition requires `on` — so
    // this is a no-op, and it is here so that "every exit releases" is a rule
    // rather than a list of the exits somebody remembered.
    releaseTails(mine);
    return;
  }

  let index;
  try {
    index = await loadIndex();
  } catch (err) {
    if (mine !== seq) return;
    fail('the USDM weekly index could not be read', err, announce);
    releaseTails(mine);
    return;
  }
  if (mine !== seq) return;

  if (!ensureLayer(map, handle)) {
    // Nothing was created and nothing is claimed. Drop the target so the next
    // reconcile — the one after the county stack lands — runs this again.
    targetKey = null;
    releaseTails(mine);
    return;
  }
  // BEFORE any setData: a hidden layer's source is never updated.
  show(map);

  if (!iso || !index.dateSet.has(iso)) {
    /* A WARN, deliberately, and this is the one place in this file where that
       is right. The weekly archive is refreshed on a Thursday cron and the app
       is a static page: a reader on the newest Tuesday, hours before the
       producer has published it, is looking at ordinary publishing skew that
       heals itself. Failing a console-clean gate over it would make the gate
       depend on the day of the week. */
    console.warn('[usdm-overlay] ' + (iso
      ? 'the USDM has not published a map for ' + iso + ' (the index runs '
        + index.dates[0] + ' to ' + index.dates[index.dates.length - 1] + ', '
        + index.dates.length + ' weeks)'
      : 'no week is selected yet')
      + '; the overlay is drawing nothing.');
    clearStamp(map);
    attached = null;
    setData(map, EMPTY_FC);
    marker('missing');
    // A week that was never published is an answer, not a wait. The counties
    // for it are still real — the choropleth is computed from a different
    // archive — so the tail goes back in the same task the answer is known.
    releaseTails(mine);
    return;
  }

  const cached = weeks.get(iso);
  if (cached && cached.value) {
    /* INSTANT, and the old week is still up for it: nothing was cleared, so
       there is no empty frame between two cached weeks and no frame of the new
       counties over the old polygons either — the tail is held through the one
       re-tiling this costs, exactly as it is through a fetch.
       weekEntry() refreshes the LRU position on the way past. */
    weekEntry(iso, index);
    setData(map, cached.value);
    stampWhenDrawn(map, iso, cached.value, mine);
    return;
  }

  /* The `loading` marker already happened, synchronously, in sync(). What is
     left is the fetch, and — since the clear went away — the old week is still
     on screen while it runs.

     Reuse an in-flight promise if warm-on-intent already started one. It is
     not ours to abort in that case, which is fine: the seq guard abandons the
     result, and the fetch is already paid for. */
  let controller = null;
  if (!weeks.has(iso) && typeof AbortController === 'function') {
    controller = new AbortController();
    inflight = { iso, controller };
  }

  let fc;
  try {
    fc = await weekEntry(iso, index, controller ? controller.signal : undefined)
      .promise;
  } catch (err) {
    if (mine !== seq) return;                      // superseded — silent
    if (err && err.name === 'AbortError') {
      // §8 — silent, not even a warn. An abort this run is still `seq` for did
      // not come from a newer sync (those bump seq before aborting), so it is
      // somebody else's cancellation landing on a shared promise, and the tail
      // is still owed to the caller.
      releaseTails(mine);
      return;
    }
    fail('the USDM polygons for ' + iso + ' could not be loaded', err, announce);
    releaseTails(mine);
    return;
  }
  if (mine !== seq) return;

  if (inflight && inflight.iso === iso) inflight = null;
  setData(map, fc);
  stampWhenDrawn(map, iso, fc, mine);
}

/**
 * Put the overlay back where it belongs after a change of county authority.
 *
 * The kit inserts an incoming stack BENEATH the whole county block (county.js
 * § anchorFor), so a swap leaves this layer above the counties that have just
 * arrived — the blobs would hide the boundaries they exist to be compared
 * against. app.js calls this from swapBoundary() with the NEW front stack's
 * line layer, which is why this takes the id rather than the handle: the
 * caller has just read it, at the moment of use, from `handle.layers`.
 *
 * A no-op when there is no overlay, and when the anchor names no layer —
 * `moveLayer` throws on a missing beforeId, and a swap is not the place to
 * find out.
 *
 * @param {object} map
 * @param {string} beforeId `handle.layers.line`, read now
 * @returns {void}
 */
export function reanchor(map, beforeId) {
  if (!map || typeof map.getLayer !== 'function') return;
  if (!map.getLayer(OVERLAY_FILL_ID)) return;
  if (!beforeId || !map.getLayer(beforeId)) return;
  map.moveLayer(OVERLAY_FILL_ID, beforeId);
}

/* ── The other two callers ───────────────────────────────────────────────── */

/**
 * One week's polygons, for a caller that needs the data rather than the map.
 *
 * The poster path (js/export.js) is the caller, and it wants the OPPOSITE of
 * sync()'s discipline: it THROWS on failure rather than degrading, because a
 * poster that quietly lacked the overlay the reader asked for would be a lie
 * with a filename and a date on it, printable and citable long after the tab
 * is closed.
 *
 * Shares the LRU with sync(), so exporting the week on screen costs nothing.
 * Unabortable without a signal, which is what the export path wants: the
 * poster's week is frozen before the offscreen map is built precisely so a
 * concurrent scrub cannot change it.
 *
 * @param {string} dateIso
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<object>} a GeoJSON FeatureCollection
 */
export async function ensureWeek(dateIso, { signal } = {}) {
  const index = await loadIndex();
  if (!dateIso || !index.dateSet.has(dateIso)) {
    throw new Error('[usdm-overlay] the USDM published no map for '
      + JSON.stringify(String(dateIso)) + ', so there are no polygons to draw '
      + 'on this poster.');
  }
  try {
    return await weekEntry(dateIso, index, signal).promise;
  } catch (err) {
    /* ONE retry, and only for a cancellation. The LRU is shared with sync(),
       so a reader who nudges the week scrubber while the poster is being built
       can abort the very fetch this export is waiting on — the entry is
       evicted at that moment, so asking again starts a clean one under this
       caller's own signal. Anything else, and any second cancellation, is the
       export's to report. */
    if (err && err.name === 'AbortError') {
      return weekEntry(dateIso, index, signal).promise;
    }
    throw err;
  }
}

/**
 * The week the map is really drawing, or null.
 *
 * Deliberately not "the week that was asked for". Between the request and the
 * settle the map is showing the PREVIOUS week (or nothing, when there was no
 * previous week to hold), and a caller told otherwise would be told about an
 * intention rather than a picture — which is also precisely why the fuse
 * condition in sync() asks this and not `targetKey`.
 *
 * @returns {{dateIso: string, fc: object}|null}
 */
export function drawn() {
  return attached;
}

/**
 * Build the overlay on a throwaway map — the poster's offscreen composite.
 *
 * Same ids, which is safe because layer ids are per-map, and same paint, which
 * is the point: the poster has to be the picture the reader was looking at.
 * That now includes the STRENGTH they set it to — a printed map at an opacity
 * nobody chose is a different picture — and the caller passes it rather than
 * this module reading `wantOpacity`, because the poster's whole discipline is
 * that every value on it is frozen off one `sel` before the capture starts.
 * Omitted, it is the default, which is what every caller written before the
 * slider existed meant.
 *
 * Touches NO module state and writes NO marker; the settle machinery above is
 * about the live map, and this map is captured and disposed inside one call.
 *
 * @param {object} targetMap the offscreen map
 * @param {object} fc an ensureWeek() FeatureCollection
 * @param {string} beforeId the offscreen handle's county line layer
 * @param {{opacity?: number}} [opts] the reader's strength, 0–1
 * @returns {void}
 */
export function addOverlayLayers(targetMap, fc, beforeId, { opacity } = {}) {
  if (!targetMap || typeof targetMap.getLayer !== 'function' || !fc) return;

  const src = targetMap.getSource(OVERLAY_SOURCE_ID);
  if (!src) targetMap.addSource(OVERLAY_SOURCE_ID, { type: 'geojson', data: fc });
  else if (typeof src.setData === 'function') src.setData(fc);

  if (targetMap.getLayer(OVERLAY_FILL_ID)) return;
  const anchor = (beforeId && targetMap.getLayer(beforeId)) ? beforeId : undefined;
  targetMap.addLayer(fillLayerDef(opacity), anchor);
}

/**
 * Warm one week on intent — a pointer entering the toggle, or focus landing on
 * it. Best-effort by definition: every failure is swallowed, including a week
 * the index does not have, because the cost of guessing wrong is a fetch
 * nobody used and the cost of saying so is a console entry for a hover.
 *
 * The app's warm-on-intent precedent is the geometry (js/app.js
 * § warmGeometry): warm what the NEXT click would need, never what a slider
 * that has not moved yet might mean.
 *
 * @param {string|null} dateIso
 * @returns {void}
 */
export function warm(dateIso) {
  if (!dateIso) return;
  loadIndex().then((index) => {
    if (!index.dateSet.has(dateIso)) return;
    weekEntry(dateIso, index).promise.catch(() => {});
  }).catch(() => {});
}
