/* ============================================================================
   LFP Explorer · js/interfaces/usdm.js
   Interface 2 · Drought monitor. The weekly U.S. Drought Monitor, county by
   county, as the Livestock Forage Program reads it — and every sentence the app
   says about it.

   ES module, no build step. Imports the `usdm-max-class/1` decoder and the
   crosswalk join; imports nothing from app.js (the module graph stays acyclic:
   app.js → registry → descriptors → decoders + color).

   ── Why this map exists ────────────────────────────────────────────────────
   LFP eligibility for a normal grazing period turns on the drought classes a
   county reached: D2 for one week, D3 for eight weeks, and so on. The rule is
   an ANY-AREA rule — 7 U.S.C. § 1531(d)(3) asks whether the county "has had"
   the class, and the USDM's polygons cut across county lines — so the number
   that matters is the WORST class touching any part of the county that week.
   That is what this map paints: no threshold, no area weighting, no duration
   test. The thresholds are the eligibility interface's business; this one shows
   the input they are applied to.

   ── Three answers to "which county?" ───────────────────────────────────────
   The USDM is drawn as polygons and reported as county statistics, and there
   is more than one county layer to report it against. Three archives publish
   the same schema against three different ideas of a county, and the
   difference between them is a fact about the data rather than a modelling
   choice. They are listed — in the seg, and here — from the most general idea
   of a county to the most program-specific:

     Census counties     vintage-matched TIGER counties. The one non-rectangular
                         set: a county absent from a week is a real '.' in the
                         series, and the old Connecticut counties give way to
                         the planning regions partway through the record.
     NDMC reported       NDMC's published county statistics. MEASURED FACT:
                         Connecticut appears ONLY as its nine planning regions
                         (09110–09190) for the entire record, with no county
                         names, and the FSA ⇄ FIPS crosswalk has no row for any
                         of them. So Connecticut is honestly UNCOLORED on this
                         dataset, and the live region counts the nine areas out
                         loud. Dropping them silently is the one thing this
                         interface must not do.
     FSA LFP boundaries  FSA's own FOIA'd LFP boundary statistics — the county
                         set the PROGRAM is administered on, and the DEFAULT
                         here for exactly that reason, last in the list though
                         it is. Rectangular (every county in every week) and
                         Connecticut-clean.

   All three are keyed by Census FIPS, and each is now DRAWN ON ITS OWN
   POLYGONS — the vintage-matched Census counties, or the FSA LFP determination
   boundaries (js/boundaries.js). So none of them touches the crosswalk, and
   this file no longer performs a join of any kind: a class code is a colour for
   the county it is keyed to. See § THERE IS NO JOIN ANY MORE below for what
   that removed and what it cost.

   ── The rule that used to live here ────────────────────────────────────────
   There was a crosswalk reduce in this file — one Census county split between
   two FSA offices replicated onto both; several administered by one office
   collided and the WORST class won. That rule is still correct and still runs,
   for the two datasets in the app that genuinely cross key spaces: the
   grazing periods' nClimGrid climatology and the disaster designations. It is
   stated in each of those descriptors and in js/decoders/crosswalk.js. It is
   not stated here any more, because here it would be a description of nothing.
   ========================================================================== */

import { boundaryNoteValue } from '../boundaries.js';
import { makeUsdmData } from '../decoders/usdm-max-class.js';

/* ── The palette ─────────────────────────────────────────────────────────────
   The five drought classes are the NDMC's OWN hexes, unchanged. This is a
   NATIONAL CONVENTION, not a design choice: every drought map a rancher, an
   extension agent or an FSA county committee has ever read uses these five
   colors, and re-deriving them from an approved kit ramp — however much better
   it might survive a CVD simulation — would make this map say something
   different from every other USDM map in circulation. So they are frozen here
   with the words above, and the LABELS carry the meaning for anyone the colors
   do not reach (which is the whole reason legend.items() exists).

   `None` is the one color that is ours, and it is not gray. The obvious choice
   — the kit's `--no-data` #cccccc — would be byte-identical to the fill this
   very map uses for "not in this week's county set", making "drought-free" and
   "we have no idea" the same picture. #f0ead8 is a warm near-surface neutral
   instead: measured ΔE00 10.4 from the light theme's --no-data (#cccccc) and
   8.7 from the high-contrast theme's (#d9d9d9), so the distinction survives
   both themes; and 6.1 / 9.0 from the two themes' --map-bg, so a drought-free
   county does not dissolve into the page either. Like every data color in this
   app (js/color.js), it is NOT themed. */

/**
 * The five drought classes BY NAME rather than by index.
 *
 * The same five hexes as CLASS_COLORS[1..5] and the same objection to changing
 * them — this is just the reading a consumer OUTSIDE the choropleth needs. The
 * weekly-polygon overlay (js/usdm-overlay.js) matches on the USDM's own
 * `usdm_class` property, which is the string "D2" and not the number 3, and a
 * layer that looked its colours up by index would have to know that this
 * app's code 3 is the USDM's D2 — the off-by-one D2_CODE exists to name.
 *
 * `None` is deliberately absent. The weekly files carry one feature per class
 * PRESENT, D0 through D4; drought-free is the absence of a polygon there, not
 * a polygon of its own, so an overlay has nothing to paint it on.
 */
export const CLASS_HEX = Object.freeze({
  D0: '#ffff00',   // Abnormally Dry
  D1: '#fcd37f',   // Moderate Drought
  D2: '#ffaa00',   // Severe Drought
  D3: '#e60000',   // Extreme Drought
  D4: '#730000',   // Exceptional Drought
});

/** The palette AS THE PAYLOAD INDEXES IT: the code a county carries this week
    is a position in this array, `None` included. Derived from CLASS_HEX rather
    than restated, so the map and the polygons drawn over it cannot drift into
    two slightly different yellows. */
const CLASS_COLORS = Object.freeze([
  '#f0ead8',       // None — see above
  CLASS_HEX.D0,    // D0 Abnormally Dry
  CLASS_HEX.D1,    // D1 Moderate Drought
  CLASS_HEX.D2,    // D2 Severe Drought
  CLASS_HEX.D3,    // D3 Extreme Drought
  CLASS_HEX.D4,    // D4 Exceptional Drought
]);

/** The class codes, as the USDM writes them. Index = the payload's own code. */
const CODES = Object.freeze(['None', 'D0', 'D1', 'D2', 'D3', 'D4']);

/** Short severity words — the legend, the tables, the heatmap's twin. */
const ADJ = Object.freeze(['drought-free', 'Abnormally dry', 'Moderate',
  'Severe', 'Extreme', 'Exceptional']);

/** The full names — the tooltip and the card, where there is room to be plain. */
const FULL = Object.freeze(['drought-free', 'Abnormally dry', 'Moderate drought',
  'Severe drought', 'Extreme drought', 'Exceptional drought']);

/** Where "D2 or worse" starts. A NAMED constant because the arithmetic is a
    trap: D2 is the fourth class, so its code is 3 — the payload counts None as
    a class, and every LFP threshold is stated in D-numbers. */
const D2_CODE = 3;

/** The absence, in the words the legend, the tooltip, the card and the table
    all use. One string: "gray" is never the only channel, and the sentence has
    to be the same one everywhere. */
const ABSENT_PHRASE = "Not in this week's county set";

/** What a county absent from a week is, in the app's internal arithmetic. */
const ABSENT = -1;

/**
 * The three archives, declaratively, in the order the seg shows them (see the
 * header) — which is NOT the order of preference: `default: true` marks the one
 * the app opens on and the one `?dataset=` is elided at, wherever in the list it
 * sits (js/interfaces/registry.js § defaultDatasetOf).
 *
 * All three declare schema `usdm-max-class/1` AND the same `week0`, so `expect`
 * cannot tell them apart — `expectedDataset` is the tripwire, checked against
 * the payload's own `dataset` field in the decoder. A swapped URL therefore
 * fails before a single county is colored, rather than painting a county set
 * that is 99% right.
 */
const DATASETS = Object.freeze([
  Object.freeze({
    id: 'census',
    label: 'Census counties',
    url: '../usdm-counties/usdm-counties.json',
    schema: 'usdm-max-class/1',
    keySpace: 'fips',
    /** Vintage-matched Census counties, BY CONSTRUCTION: this archive
        intersects each week with the counties in force for it, so its county
        dictionary is the union over eighteen vintages (3,251 ids) and a county
        outside a week's vintage is a real '.' in the series. Measured for all
        27 years: the ids reporting in year Y are exactly
        census-counties-<vintage(Y)>'s, plus the 13 territory ids the tilesets
        drop. tools/check-boundaries.mjs re-runs that against the live data. */
    boundary: 'census',
    expect: Object.freeze({ week0: '2000-01-04' }),
    expectedDataset: 'usdm-counties',
    decode: makeUsdmData,
  }),
  Object.freeze({
    id: 'reported',
    label: 'NDMC reported',
    url: '../usdm-counties-reported/usdm-counties-reported.json',
    schema: 'usdm-max-class/1',
    keySpace: 'fips',
    /** The NDMC publishes against its own layer and no tileset of it exists.
        Drawn on the LFP determination boundaries, the nearest authority in the
        same key space: measured, this payload's 3,222 ids are that set's 3,221
        with Connecticut swapped — nine planning regions in, eight counties out.
        So nine reported areas reach no polygon and eight polygons stay
        uncoloured, which is the honest picture and the one the live region has
        always counted out loud. */
    boundary: 'fsa-lfp',
    expect: Object.freeze({ week0: '2000-01-04' }),
    expectedDataset: 'usdm-counties-reported',
    decode: makeUsdmData,
  }),
  Object.freeze({
    id: 'fsa-lfp',
    label: 'FSA LFP boundaries',
    url: '../usdm-counties-fsa-lfp/usdm-counties-fsa-lfp.json',
    schema: 'usdm-max-class/1',
    keySpace: 'fips',
    /** The county set the program is administered on, now drawn on its own
        polygons — and this is the join the whole change was worth making for:
        measured, this payload's county dictionary and the tileset's id set are
        IDENTICAL, 3,221 each, zero symmetric difference in both directions.
        Nothing is crosswalked, nothing is reduced, nothing is lost. Through the
        FSA composite it used to lose 131 counties. */
    boundary: 'fsa-lfp',
    expect: Object.freeze({ week0: '2000-01-04' }),
    expectedDataset: 'usdm-counties-fsa-lfp',
    /** The county set the program is administered on — see the header. */
    default: true,
    decode: makeUsdmData,
  }),
]);

/** The dataset the app opens on, for the fallbacks below: an id this interface
    does not know must resolve to the DEFAULT rather than to whichever archive
    happens to be listed first, or a stale `?dataset=` would quietly repaint the
    map as the Census county set. */
const DEFAULT_DATASET = DATASETS.find((d) => d.default) || DATASETS[0];

/* ── Small shared readings ───────────────────────────────────────────────── */

function datasetById(id) {
  for (const ds of DATASETS) if (ds.id === id) return ds;
  return DEFAULT_DATASET;
}

function datasetLabel(sel) {
  return datasetById(sel && sel.dataset).label;
}

/** The class code, in words, at the level of detail each surface has room for. */
function longPhrase(code) {
  return code < 0 ? ABSENT_PHRASE : CODES[code] + ' — ' + FULL[code];
}

function shortPhrase(code) {
  return code < 0 ? ABSENT_PHRASE : CODES[code] + ' — ' + ADJ[code];
}

function count(n) {
  return Number(n || 0).toLocaleString('en-US');
}

/* ── The instances this interface has seen ───────────────────────────────────
   Two leaves need the payload and are not handed it: the poster's filename and
   subtitle need the selected week's DATE, and only the decoder knows the Tuesday
   grid. Noted on the way past in colorsFor(), which every paint goes through —
   the same arrangement js/interfaces/ngp.js uses, and for the same reason. */
const seen = new Map();

function remember(sel, data) {
  if (data && typeof data.weekDate === 'function' && sel) seen.set(sel.dataset, data);
}

function instanceFor(sel) {
  return seen.get(sel && sel.dataset) || null;
}

/* ── THERE IS NO JOIN ANY MORE ───────────────────────────────────────────────
   This section used to hold a memoized crosswalk join: every FSA county with
   the FIPS ids it administered, the FIPS ids the crosswalk could not reach, and
   a bucket-and-reduce over them on every paint. It is gone, and its absence is
   the whole point of this interface's part in the boundary work.

   All three of these archives are keyed by Census FIPS, and each one now draws
   the polygons its own numbers were computed against (js/boundaries.js): the
   vintage-matched Census counties, or the FSA LFP determination boundaries. The
   payload's keys ARE the tileset's ids. So the "join" is `colors.set(id, …)`.

   What that bought, measured: the counties whose data reached no polygon at all
   went from 131 / 140 / 159 (fsa-lfp / reported / census, crosswalked onto the
   FSA composite) to 0 / 9 / 13. The 9 are Connecticut's planning regions, which
   no county in the determination boundaries covers, and the 13 are the
   territories the tilesets drop — both real, both still reported.

   Two things went with it, and it is worth being honest that they were losses.
   The card's "Combined from" constituent-FIPS rows and its "part of this FSA
   county is not in this week's county set" note had nothing left to say: an
   identity authority has no constituents. That story survives on the grazing
   periods' nClimGrid dataset and on the disaster designations, both of which
   still cross key spaces and still crosswalk.

   The per-frame cost went with it too. The expensive half of a week scrub used
   to be the join, not the read; now there is only the read. */

/* ── Records ─────────────────────────────────────────────────────────────── */

/**
 * One FSA county's class this week, with what it was reduced from.
 *
 * @returns {{code: number, parts: Array<{id: string, name: string, code: number}>,
 *            absent: number}} `code` is −1 for an FSA county with no classed
 *          constituent; `absent` counts the constituents that were not in the
 *          week's county set at all.
 */
function classFor(data, xw, sel, id) {
  const out = { code: ABSENT, parts: [], absent: 0 };
  if (!data || typeof data.classCodeAt !== 'function') return out;
  if (!Number.isInteger(sel.week)) return out;

  /* ONE constituent, always: this archive's keys are the drawn authority's ids,
     so a county is itself. `parts` keeps its shape because the card's rows and
     the tooltip are written against it and the one-element case reads fine —
     but the "Combined from" rows it used to feed can no longer appear here, and
     `absent` is now 0 or 1 rather than a count of pieces. */
  for (const fipsId of [String(id)]) {
    const code = data.classCodeAt(fipsId, sel.week);
    const nm = data.countyName(fipsId);
    if (code < 0) out.absent += 1;
    else if (code > out.code) out.code = code;
    out.parts.push({
      id: fipsId,
      // The NDMC-reported archive carries some areas with an EMPTY name; the id
      // is then the only honest label for them.
      name: nm && nm.county ? nm.county : '',
      code,
    });
  }
  return out;
}

/* ── Paint ───────────────────────────────────────────────────────────────── */

/**
 * The Map<fsaId, cssColor> the choropleth is painted from, the FIPS ids that
 * landed nowhere, and the counts only this join can produce.
 *
 * `stats` is handed straight back to liveSentence(): how many FSA counties were
 * classed, out of how many the crosswalk knows for this vintage, how many of
 * them are in D2 or worse, and which week this all was. Recovering those
 * numbers anywhere else would mean redoing the join.
 *
 * @param {object} data the active decoder instance
 * @param {object|null} xw a loadCrosswalk() instance, or null
 * @param {{dataset: string, vintage: string, week: number}} sel
 * @returns {{colors: Map<string, string>, unmatchedFips: string[], stats: object}}
 */
function colorsFor(data, xw, sel) {
  remember(sel, data);
  const colors = new Map();
  const stats = {
    classed: 0, total: 0, absent: 0, severe: 0, unmatched: 0,
    label: null, week: null, weeks: null,
  };

  if (!data || typeof data.classesFor !== 'function' || !Number.isInteger(sel.week)) {
    return { colors, unmatchedFips: [], stats };
  }

  const pos = data.weekOfYear(sel.week);
  stats.label = data.weekLabel(sel.week);
  stats.week = pos ? pos.index : null;
  stats.weeks = pos ? pos.count : null;

  const classes = data.classesFor(sel.week);

  /* One pass, no join. `classes` is keyed by this archive's own county ids and
     so is the authority underneath it, so a class code IS a colour for that
     polygon (§ THERE IS NO JOIN ANY MORE). A negative code is a county the
     archive does not report this week — '.' in the series, which on the Census
     set is how a county outside the week's boundary vintage appears — and it
     falls through to --no-data rather than being coloured "None". */
  for (const [id, code] of classes) {
    if (code < 0) continue;
    colors.set(id, CLASS_COLORS[code]);
    if (code >= D2_CODE) stats.severe += 1;
  }

  stats.classed = colors.size;
  /* The DENOMINATOR is the MAP's county count, not this payload's: the question
     the live region answers is "how many of the counties on screen are
     coloured". `sel.universe` is the drawn authority's index size, which is
     exactly that. */
  stats.total = Number(sel.universe) || 0;
  stats.absent = Math.max(0, stats.total - stats.classed);
  /* `unmatchedFips` is now always empty, and app.js is the one that reports the
     misses. It already does it better than this function could: handle.recolor()
     returns the ids it was HANDED that have no polygon in the loaded geometry,
     which is the same question asked of the thing actually on screen. On the
     reported set that is Connecticut's nine planning regions; on the Census set
     the thirteen territories. Kept in the return shape because the descriptor
     contract has it and every other interface still uses it. */
  stats.unmatched = 0;
  return { colors, unmatchedFips: [], stats };
}

/* ── Legend ──────────────────────────────────────────────────────────────── */

/** One variable, one scale, and it is categorical: six named classes and the
    absence. Never a bar — the classes are not evenly spaced in anything. */
function legendKind() {
  return 'swatches';
}

/** The chips, in the order the USDM states them. The LABELS are the legend: a
    hue-only categorical scheme has nothing left in grayscale (HOUSE-STYLE §6),
    so every class is named here and the names reach the drawer, the poster and
    the screen reader from this one list. */
function legendItems() {
  return CLASS_COLORS.map((color, code) => ({
    color,
    label: code === 0 ? CODES[0] : CODES[code] + ' ' + ADJ[code],
  }));
}

function legendNoDataLabel() {
  return ABSENT_PHRASE;
}

/**
 * What the colors mean, in a sentence. The redundancy channel that makes this
 * map legible in grayscale, to a CVD reader and to a screen reader — and the
 * place the any-area rule is stated, because a reader who takes this for an
 * area-weighted average will misread every county on it.
 *
 * @param {object} [sel] the app's selection (js/app.js § syncLegend calls this
 *        as `legend.key(sel)`). Taken now because the polygon overlay puts a
 *        second thing on the map, and a key that described only the counties
 *        would be describing half the picture.
 */
function legendKey(sel) {
  let msg = 'Color is the worst drought class touching any part of the county that '
    + 'week — the same any-area rule LFP uses (7 U.S.C. § 1531(d)(3)). Yellow is '
    + 'abnormally dry; deep red is exceptional drought. Pale counties are '
    + 'drought-free; gray counties are not in this week\'s county set.';
  /* The swatches are the same five hexes either way (CLASS_HEX), so nothing in
     the legend's PICTURE changes when the overlay comes on — which is exactly
     why the key has to say it in words. "Drawn as published" is doing real
     work: the USDM is issued at roughly 1:2,000,000 and unclipped, so its
     edges overrun the coastline, and a reader who took that for a rendering
     fault would distrust the layer instead of reading it. */
  if (sel && sel.polygons === 'on') {
    msg += ' The translucent overlay is the USDM\'s own weekly map, drawn as '
      + 'published.';
  }
  return msg;
}

/* ── Tooltip ─────────────────────────────────────────────────────────────── */

/**
 * The tooltip's value line — the same words the card uses. The tooltip is
 * aria-hidden decoration; this content reaches assistive technology through the
 * live region and the card.
 */
function tooltip(data, xw, sel, id) {
  return longPhrase(classFor(data, xw, sel, id).code);
}

/* ── The county card ─────────────────────────────────────────────────────── */

/**
 * The card's rows for one county in the selected week.
 *
 * Every case is stated in WORDS rather than implied by an empty box: the class,
 * the week it belongs to, what the value was reduced from when one FSA office
 * administers several Census counties, and the two kinds of absence — a county
 * that is not in this week's set at all, and one that is only partly covered.
 *
 * @returns {Array<{term: string, value: string, isNote?: boolean}>}
 */
function cardRows(data, xw, sel, id) {
  const rows = [];
  const found = classFor(data, xw, sel, id);
  const inst = data || instanceFor(sel);

  /* The label follows the AUTHORITY, because the id space does. This view used
     to draw FSA service areas and every id was an FSA county code; it now draws
     the polygons each archive was computed against, and all three of those are
     keyed by Census FIPS. Leaving the old label would have been a small, fluent
     lie on every card in the view. */
  rows.push({
    term: (sel.boundary && sel.boundary.keySpace === 'fsa')
      ? 'FSA county code' : 'County code (FIPS)',
    value: String(id),
  });
  rows.push({
    term: 'Week',
    value: (inst && Number.isInteger(sel.week)) ? inst.weekLabel(sel.week) : '—',
  });

  if (found.code >= 0) {
    rows.push({ term: 'Drought class', value: longPhrase(found.code) });
  } else {
    rows.push({
      term: 'Drought class',
      value: 'Not in the county set for this week — boundaries changed under '
        + 'this dataset.',
      isNote: true,
    });
  }

  /* What was combined, and out of what — DEAD ON THIS VIEW NOW, and left in
     place deliberately rather than deleted. `parts` has exactly one entry once
     an archive is drawn on its own polygons (§ THERE IS NO JOIN ANY MORE), so
     this block cannot fire, and the guard below is what makes that a no-op
     rather than a row reading "combined from itself".

     It stays because the shape it renders is still the right shape for the
     question, and the two views that DO still crosswalk render the same thing
     from their own descriptors. If a future dataset arrives on this view that
     does cross key spaces, this is what it needs and it already works. */
  if (found.parts.length > 1) {
    const parts = found.parts.map((part) => {
      const label = part.name ? part.name + ' (' + part.id + ')' : part.id;
      return label + ' ' + (part.code < 0 ? 'not in this week' : CODES[part.code]);
    });
    rows.push({
      term: 'Combined from',
      value: parts.join('; ') + '. The worst class is shown.',
      isNote: true,
    });
  }

  /* Partial coverage. On this view `parts` is always one entry — the county is
     its own key — so the multi-county branch is unreachable and the remaining
     case is simply "this county is not in the week's county set", which is a
     fact about the ARCHIVE and not about any office. It kept saying "FSA
     county" after the geometry stopped being FSA's. */
  if (found.absent && found.code >= 0) {
    rows.push({
      term: 'Coverage',
      value: found.parts.length > 1
        ? count(found.absent) + ' of ' + count(found.parts.length)
          + ' constituent counties are not in this week\'s county set; the class '
          + 'shown is the worst of the rest.'
        : 'Part of this county is not in this week\'s county set.',
      isNote: true,
    });
  }

  if (sel.hasGeometry === false) {
    rows.push({
      term: 'Boundary',
      value: boundaryNoteValue(sel),
      isNote: true,
    });
  }

  return rows;
}

/* ── The card's picture: the whole record as a heatmap ───────────────────── */

const SVG_NS = 'http://www.w3.org/2000/svg';

/* Heatmap geometry, in viewBox units. 53 columns because a calendar year can
   hold 53 Tuesdays; a 52-week year simply leaves its last cell empty. */
const HM = Object.freeze({
  gutter: 24,      // room for the year labels
  top: 11,         // room for the week axis
  cellW: 5,
  cellH: 5,
  rowGap: 1,
  cols: 53,
});
const HM_W = HM.gutter + HM.cols * HM.cellW + 2;

/** Week numbers labelled on the axis — the same unit the scrubber and `?week=`
    use, so the picture and the control speak the same language. */
const HM_TICKS = Object.freeze([1, 10, 20, 30, 40, 50]);

function svgEl(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const key in attrs) node.setAttribute(key, String(attrs[key]));
  return node;
}

function htmlEl(name, attrs, text) {
  const node = document.createElement(name);
  if (attrs) for (const key in attrs) node.setAttribute(key, String(attrs[key]));
  if (text != null) node.textContent = text;
  return node;
}

/**
 * One FSA county's whole record, reduced week by week.
 *
 * ≤23 strings by ≤1,389 characters, read once when the card is drawn — cheap,
 * and cheaper than any cache would be to invalidate. Absent weeks are −1.
 *
 * @returns {Int8Array} indexed by absolute week
 */
function countySeries(data, xw, sel, id) {
  const out = new Int8Array(data.weeks).fill(ABSENT);
  // One id, not a bucket — see § THERE IS NO JOIN ANY MORE. The loop stays
  // because the worst-of reduction over it is what the heatmap wants either
  // way, and a one-element reduction is the identity.
  const fipsIds = [String(id)];
  for (const fipsId of fipsIds) {
    for (let j = 0; j < data.weeks; j++) {
      const code = data.classCodeAt(fipsId, j);
      if (code > out[j]) out[j] = code;
    }
  }
  return out;
}

/**
 * The card's second half: every week of the record for the selected county, one
 * row per year, one cell per week — then the selected year's numbers under it.
 *
 * The whole record at once is the point. A single week's class says nothing
 * about whether a county was in drought for eight weeks running, which is what
 * every LFP threshold is actually about; twenty-seven rows of it show the
 * droughts as the shapes they are.
 *
 * Scrubbing the week does NOT rebuild this. The picture depends on the county
 * and the dataset, not on which week is selected, so the returned update() just
 * moves the marker — see js/card-content.js on the two kinds of redraw.
 *
 * @returns {{update: (sel: object) => void}|null}
 */
function cardBody(container, data, xw, sel, id) {
  remember(sel, data);
  if (!data || typeof data.classesFor !== 'function') {
    container.replaceChildren();
    return null;
  }

  const years = data.years();
  const codes = countySeries(data, xw, sel, id);
  // The county IS its own key now, so there is no primary constituent to pick.
  const nm = data.countyName(String(id));
  const place = nm && nm.county ? nm.county + ', ' + nm.state : String(id);

  const rowH = HM.cellH + HM.rowGap;
  const height = HM.top + years.length * rowH + 2;

  const root = svgEl('svg', {
    viewBox: '0 0 ' + HM_W + ' ' + height,
    'aria-hidden': 'true',
    focusable: 'false',
  });

  /* The week axis. */
  const axis = svgEl('g', {
    fill: 'var(--text-dim)', 'font-size': 6, 'text-anchor': 'middle',
  });
  for (const tick of HM_TICKS) {
    const text = svgEl('text', {
      x: HM.gutter + (tick - 0.5) * HM.cellW,
      y: HM.top - 4,
    });
    text.textContent = String(tick);
    axis.appendChild(text);
  }
  root.appendChild(axis);

  /* One row per year: the cells, then the label. A cell with no class is left
     EMPTY rather than filled with a "no data" gray — an absent week and a
     drought-free week must not look alike, and the ground shows through. */
  const cells = svgEl('g', {});
  const labels = svgEl('g', { fill: 'var(--text-dim)', 'font-size': 6, 'text-anchor': 'end' });
  years.forEach((year, row) => {
    const range = data.weekRange(year);
    const y = HM.top + row * rowH;
    for (let k = 0; range && k < range[1] - range[0] + 1; k++) {
      const code = codes[range[0] + k];
      if (code < 0) continue;
      cells.appendChild(svgEl('rect', {
        x: HM.gutter + k * HM.cellW,
        y,
        width: HM.cellW,
        height: HM.cellH,
        fill: CLASS_COLORS[code],
      }));
    }
    const isCurrent = year === sel.year;
    const label = svgEl('text', {
      x: HM.gutter - 4,
      y: y + HM.cellH - 0.6,
      // The selected year is called out twice — a bolder, darker label AND the
      // outline below — because either one alone is a color-only distinction
      // (WCAG 1.4.1).
      fill: isCurrent ? 'var(--accent-line)' : 'var(--text-dim)',
      'font-weight': isCurrent ? 700 : 400,
    });
    label.textContent = String(year);
    labels.appendChild(label);
  });
  root.appendChild(cells);
  root.appendChild(labels);

  /* The selected year's outline and the selected week's marker: the only two
     things update() moves. */
  const outline = svgEl('rect', {
    x: HM.gutter - 1,
    y: 0,
    width: HM.cols * HM.cellW + 2,
    height: HM.cellH + 2,
    fill: 'none',
    stroke: 'var(--accent-line)',
    'stroke-width': 0.8,
  });
  const marker = svgEl('path', {
    d: 'M -2.2 -3.2 L 2.2 -3.2 L 0 0 Z',
    fill: 'var(--accent-line)',
  });
  root.appendChild(outline);
  root.appendChild(marker);

  const figure = htmlEl('figure', { class: 'usdm-figure' });
  figure.appendChild(root);
  figure.appendChild(htmlEl('figcaption', { class: 'sr-only' },
    'Weekly drought class, ' + years[0] + '–' + years[years.length - 1] + ', for '
    + place + '. One row per year, one cell per week. Values for the selected '
    + 'year are in the table below.'));

  const details = htmlEl('details', { id: 'card-table-details' });
  details.appendChild(htmlEl('summary', null, 'Show the selected year as a table'));
  details.appendChild(buildYearTable(data, codes, sel, place));

  container.replaceChildren(figure, details);

  /** Move the year outline and the week marker to wherever the selection is
      now. Called on every frame of a scrub, so it does arithmetic and three
      attribute writes and nothing else. */
  function moveMarker(next) {
    const row = years.indexOf(next.year);
    if (row < 0) {
      outline.setAttribute('visibility', 'hidden');
      marker.setAttribute('visibility', 'hidden');
      return;
    }
    outline.removeAttribute('visibility');
    marker.removeAttribute('visibility');
    outline.setAttribute('y', String(HM.top + row * rowH - 1));
    const range = data.weekRange(next.year);
    const k = (range && Number.isInteger(next.week)) ? next.week - range[0] : 0;
    marker.setAttribute('transform', 'translate('
      + (HM.gutter + (k + 0.5) * HM.cellW) + ' ' + (HM.top - 1) + ')');
  }
  moveMarker(sel);

  return { update: moveMarker };
}

/** The heatmap's twin: the selected year, week by week, in words. The picture is
    aria-hidden decoration; this is the same data for everyone the picture does
    not serve (HOUSE-STYLE §5.2). */
function buildYearTable(data, codes, sel, place) {
  const table = htmlEl('table', { class: 'card-table' });
  table.appendChild(htmlEl('caption', { class: 'sr-only' },
    'Weekly drought class in ' + sel.year + ' for ' + place + '.'));

  const thead = htmlEl('thead');
  const hrow = htmlEl('tr');
  hrow.appendChild(htmlEl('th', { scope: 'col' }, 'Week (Tuesday)'));
  hrow.appendChild(htmlEl('th', { scope: 'col' }, 'Class'));
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = htmlEl('tbody');
  const range = data.weekRange(sel.year);
  for (let j = range ? range[0] : 0; range && j <= range[1]; j++) {
    const row = htmlEl('tr');
    row.appendChild(htmlEl('th', { scope: 'row' }, data.weekLabel(j)));
    const code = codes[j];
    row.appendChild(htmlEl('td',
      code < 0 ? { class: 'card-table-empty' } : null, shortPhrase(code)));
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  return table;
}

/** What this interface adds to the card's render key. Deliberately NOT the
    week: the heatmap is the whole record either way, and rebuilding twenty-seven
    years of it on every frame of a scrub — under the reader's cursor, inside an
    open <details> — is exactly what update() exists to avoid. */
function cardKey() {
  return 'record';
}

/* ── The live region ─────────────────────────────────────────────────────── */

/**
 * The always-on half of the a11y twin: what the canvas is showing, in a
 * sentence. The on-demand table is the other half.
 *
 * The counts come from `stats`, which colorsFor() produced on its way through
 * the join — including the one number this interface must never leave out: how
 * many reported areas the crosswalk could not place on any FSA county.
 *
 * @param {object} sel
 * @param {number} shown counties actually painted (the app's own count)
 * @param {number} total counties in the payload (unused: the payload's counties
 *        are Census counties and this sentence is about FSA ones)
 * @param {number} missingGeometry counties with data and nowhere to draw it
 * @param {object} [stats] from colorsFor()
 * @returns {string}
 */
function liveSentence(sel, shown, total, missingGeometry, stats) {
  const head = stats && stats.label
    ? 'Week of ' + stats.label
      + (stats.week ? ' (week ' + stats.week + ' of ' + stats.weeks + ')' : '')
    : 'Drought monitor';
  /* The overlay is a second layer on the same canvas, and the canvas has one
     live region. A reader who cannot see it is otherwise told the county
     counts and nothing about the polygons sitting over them — which on this
     view is the difference between "the county reached D4" and "here is the
     four per cent of it that did". No numbers: a week is 3–5 national
     MultiPolygons, and "5 features" is a fact about the file rather than about
     the map. Appended to BOTH endings below, because the polygons can be on
     screen while the county payload is still arriving. */
  const overlay = (sel && sel.polygons === 'on')
    ? ' The weekly USDM drought polygons are drawn over the counties.' : '';
  if (!stats || !stats.total) {
    return head + ', ' + datasetLabel(sel) + ': nothing to show yet.' + overlay;
  }

  /* `shown` and not stats.classed, and this is the whole reason app.js computes
     it. stats.classed counts every county the ARCHIVE classed this week; `shown`
     is that minus the ones with no polygon on the drawn authority, which is what
     a reader is actually looking at. Using stats.classed here produced
     "3,235 of 3,222 counties classed" on the Census set — a numerator above its
     own denominator, because the payload reports thirteen territories the
     tilesets do not carry. */
  const classed = Number.isInteger(shown) ? shown : stats.classed;
  const universe = Number(sel.universe) || stats.total;
  let msg = head + ', ' + datasetLabel(sel) + ': ' + count(classed) + ' of '
    + count(universe) + ' counties classed — ' + count(stats.severe)
    + ' in D2 or worse.';
  const absent = Math.max(0, universe - classed - (Number(missingGeometry) || 0));
  if (absent > 0) {
    msg += ' ' + count(absent) + (absent === 1 ? ' county is' : ' counties are')
      + ' not in this week\'s county set.';
  }
  /* ONE clause for the misses now, because there is one kind. There used to be
     two — areas the crosswalk could not reach, and areas it reached that had no
     polygon — and with the crosswalk gone from this view they collapse into the
     same fact: this archive reports a county that the authority on screen does
     not have. On the NDMC-reported set that is Connecticut's nine planning
     regions, which the LFP determination boundaries answer as eight counties;
     on the Census set it is the thirteen territories the tilesets drop. Named
     by authority, because "not in the FSA boundary archive" was wrong on two of
     the three. */
  if (missingGeometry > 0) {
    msg += ' ' + count(missingGeometry) + ' reported '
      + (missingGeometry === 1 ? 'area is' : 'areas are')
      + ' not in ' + (sel.boundary ? sel.boundary.label : 'the county set on screen')
      + '.';
  }
  return msg + overlay;
}

/* ── The data table ──────────────────────────────────────────────────────── */

/**
 * @param {object} sel the app's selection — table-view.js calls this as
 *        `iface.table.columns(sel)`. Taken now because the id column's HEADER
 *        depends on the drawn authority's key space.
 */
function tableColumns(sel) {
  return [
    { label: 'County', key: 'county', rowHeader: true },
    { label: 'State', key: 'state' },
    /* The id space is the AUTHORITY's. This column said "FSA code" when the
       rows were a crosswalk join's output; they are now the archive's own keys
       drawn on the archive's own polygons, and all three of this view's
       authorities are keyed by Census FIPS. Derived rather than hardcoded so it
       stays true if an FSA-keyed drought dataset ever arrives. */
    { label: (sel && sel.boundary && sel.boundary.keySpace === 'fsa')
      ? 'FSA code' : 'FIPS code', key: 'id', code: true },
    { label: 'Class', key: 'klass' },
  ];
}

/**
 * The week on screen, county by county, exactly as the map is painted: the
 * crosswalked classes, including the FSA counties that have a class but no
 * polygon in this vintage (they are data, and the table is the data).
 *
 * @param {object} data the active decoder instance
 * @param {object|null} xw the crosswalk
 * @param {object} sel
 * @param {(id: string) => ({county: string, state: string}|null)} [names] the
 *        geometry's gazetteer, handed in by js/table-view.js — these rows are
 *        FSA counties and the payload has no names for them
 */
function tableRows(data, xw, sel, names) {
  const rows = [];
  if (!data || typeof data.classesFor !== 'function') return rows;
  if (!Number.isInteger(sel.week)) return rows;

  // The same one-pass read colorsFor does, over the same Map — so the table and
  // the map cannot disagree, because there is no longer a reduction for them to
  // disagree ABOUT (§ THERE IS NO JOIN ANY MORE). A negative code is a county
  // this archive does not report this week and gets no row, exactly as it gets
  // no colour.
  const classes = data.classesFor(sel.week);

  for (const [id, code] of classes) {
    if (code < 0) continue;
    const nm = (names && names(id)) || null;
    rows.push({
      id,
      county: nm ? nm.county : id,
      state: nm ? nm.state : '',
      klass: shortPhrase(code),
    });
  }
  rows.sort((a, b) => a.state.localeCompare(b.state, 'en')
    || a.county.localeCompare(b.county, 'en')
    || a.id.localeCompare(b.id, 'en'));
  return rows;
}

/** The sentence that names the table — the dialog's subtitle, the table's own
    sr-only <caption>, and the scroll region's accessible name. */
function tableCaption(sel, nRows) {
  const inst = instanceFor(sel);
  const when = (inst && Number.isInteger(sel.week))
    ? 'Week of ' + inst.weekLabel(sel.week) : 'Drought monitor';
  const n = Number(nRows) || 0;
  let msg = when + ' — ' + datasetLabel(sel) + ' — ' + count(n)
    + (n === 1 ? ' county classed' : ' counties classed');
  // The denominator is the MAP's, handed down on `sel` — the drawn authority's
  // county count. It used to come from the crosswalk's FSA table, which was the
  // right number for a map drawn on FSA counties and is the wrong one now.
  const universe = Number(sel.universe) || 0;
  const absent = Math.max(0, universe - n);
  if (universe && absent > 0) {
    msg += '; ' + count(absent) + ' not in this week\'s county set';
  }
  return msg + '.';
}

/** What makes one built table different from another: the dataset and the week.
    Not the year — the week index already carries it. */
function tableCacheKey(sel) {
  return sel.dataset + '|' + sel.week;
}

/* ── The poster ──────────────────────────────────────────────────────────── */

function exportTitle() {
  return 'U.S. Drought Monitor — County Worst Class';
}

/** The Tuesday, as an ISO date. UTC-pinned via toISOString, because every date
    in this interface is a UTC midnight (js/decoders/usdm-max-class.js).

    EXPORTED because it is now two things: the poster's filename, and the key
    the weekly-polygon archive is addressed by (js/export.js asks for the
    week's polygons by this exact string). One derivation, so a poster cannot
    be titled one week and drawn with another's. */
export function weekIso(sel) {
  const inst = instanceFor(sel);
  if (!inst || !Number.isInteger(sel.week)) return 'unknown-week';
  return inst.weekDate(sel.week).toISOString().slice(0, 10);
}

/** `usdm_<dataset>_<YYYY-MM-DD>.png`. The date is what a reader tells two of
    these posters apart by; the dataset is what they tell two of the same week
    apart by. Neither the pasture type nor a color-by variable exists here. */
function exportFilename(sel) {
  return 'usdm_' + datasetById(sel.dataset).id + '_' + weekIso(sel) + '.png';
}

function exportSubtitle(sel) {
  const inst = instanceFor(sel);
  const when = (inst && Number.isInteger(sel.week))
    ? 'Week of ' + inst.weekLabel(sel.week) : 'Drought monitor';
  return when + ' · ' + datasetLabel(sel);
}

function exportCredit() {
  return 'Sustainable FSA · U.S. Drought Monitor: NDMC / USDA / NOAA · '
    + 'Montana Climate Office · sustainable-fsa.com/lfp-explorer';
}

/**
 * The NDMC's own attribution, VERBATIM and non-negotiable: the U.S. Drought
 * Monitor's terms of use require the producing agencies to be named wherever it
 * is republished, and a poster outlives the page it came from. Two lines,
 * drawn right-aligned inside the legend band (js/export.js § drawSwatchLegend),
 * with the first fit-shrunk if the band is narrower than the sentence — the
 * type gives way, never the words.
 *
 * @returns {string[]}
 */
function exportAttribution() {
  return [
    'The U.S. Drought Monitor is jointly produced by the National Drought '
      + 'Mitigation Center at the University of Nebraska-Lincoln, the United '
      + 'States Department of Agriculture, and the National Oceanic and '
      + 'Atmospheric Administration.',
    'Map data courtesy of NDMC. Aggregation and map courtesy of the Montana '
      + 'Climate Office.',
  ];
}

/* ── Pending state ───────────────────────────────────────────────────────── */

/**
 * Resolve a parked `?week=` against the payload that has just arrived.
 *
 * A week number means nothing without both the year and the payload: 2012 holds
 * 52 Tuesdays and 2008 holds 53, and only the data knows which. So the app
 * parks the raw param at boot and asks here once the grid exists.
 *
 * Returns null for "no opinion" — no param, or one that cannot be honoured —
 * and the app then keeps whatever it remembered or falls back to the year's last
 * week. Never returns a number outside the year.
 *
 * @param {object} data the arrived decoder instance
 * @param {{week?: string|number|null, year?: number}} pending
 * @returns {number|null} a 1-based week within `pending.year`
 */
function applyPending(data, pending) {
  const raw = pending && pending.week;
  if (raw == null || raw === '') return null;
  if (!data || typeof data.weekRange !== 'function') return null;

  const range = data.weekRange(pending && pending.year);
  if (!range) return null;
  const weeksInYear = range[1] - range[0] + 1;

  // Number() on a WEEK, never on a county id.
  const week = Number(raw);
  if (Number.isInteger(week) && week >= 1 && week <= weeksInYear) return week;

  console.warn('[usdm/iface] ignoring week ' + JSON.stringify(String(raw))
    + ' — ' + (pending && pending.year) + ' has ' + weeksInYear
    + ' weeks; falling back to the latest.');
  return null;
}

/* ── The descriptor ──────────────────────────────────────────────────────── */

/**
 * Interface 1 of the story, and where it starts: the map that says where the
 * drought was. Frozen, like every descriptor: the app reads it on every repaint
 * and a mutated leaf would mean the legend and the paint disagreed.
 *
 * FIRST IN THE SWITCHER AND NOT THE DEFAULT VIEW — the app still boots on the
 * grazing periods (js/interfaces/registry.js § DEFAULT_VIEW), so this family's
 * payloads are still fetched on the first press and never at boot.
 */
export const USDM = Object.freeze({
  id: 'usdm',
  label: 'Drought monitor',
  /** See ngp.js — the map's accessible name follows the active family. */
  mapLabel: 'Choropleth map of weekly U.S. Drought Monitor drought classes by county',
  order: 1,
  datasets: DATASETS,
  /** 2000-01-04 is the first USDM week ever published. The ceiling moves every
      Tuesday, so it is the widest year the app will validate — the slider's real
      maximum is re-authored from the payload (app.js § applyYearDomain). */
  years: Object.freeze({ min: 2000, max: 2026 }),
  /** No pasture type and no color-by variable — one quantity, one scale — and a
      week within the year, which no other family has. */
  controls: Object.freeze({ type: false, variable: false, week: true }),
  /**
   * The first enumerated choice any shipped family declares (js/app.js
   * § Enumerated choices): whether the USDM's OWN weekly polygons are drawn,
   * translucent, over the county choropleth (js/usdm-overlay.js).
   *
   * OFF BY DEFAULT, and that is an editorial decision rather than a
   * performance one. The subject of this view is the reduction — the worst
   * class touching a county, which is what LFP is administered on — and the
   * raw polygons are the evidence a reader turns to when they want to check
   * it. Opening with both layers up would present the reduction and its
   * evidence as one picture, which is the confusion this view exists to
   * remove.
   *
   * A choice and not a dataset: it changes nothing about which numbers are
   * read, which county set is drawn, or what the legend's swatches mean. Only
   * whether a second layer is on the canvas. The app's generic machinery
   * carries it from here — `?polygons=on` (elided at the default),
   * `sfsa-ngp-polygons-usdm`, and the seg buttons — with no plumbing of its
   * own, which is the whole point of declaring it rather than wiring it.
   */
  choices: Object.freeze([Object.freeze({
    id: 'polygons',
    values: Object.freeze(['off', 'on']),
    default: 'off',
  })]),
  colorsFor,
  legend: Object.freeze({
    kind: legendKind,
    key: legendKey,
    items: legendItems,
    noDataLabel: legendNoDataLabel,
  }),
  tooltip,
  cardRows,
  cardBody,
  cardKey,
  liveSentence,
  table: Object.freeze({
    columns: tableColumns,
    rows: tableRows,
    caption: tableCaption,
    cacheKey: tableCacheKey,
  }),
  export: Object.freeze({
    title: exportTitle,
    filename: exportFilename,
    subtitle: exportSubtitle,
    credit: exportCredit,
    attribution: exportAttribution,
  }),
  applyPending,
});
