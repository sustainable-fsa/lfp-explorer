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

   All three are keyed by Census FIPS and the map draws FSA counties, so all
   three arrive through js/decoders/crosswalk.js.

   ── The crosswalk rule, stated once ────────────────────────────────────────
   One Census county split between two FSA offices replicates onto both. Several
   Census counties administered by ONE FSA office collide, and reduceFips()
   takes the WORST class — the same any-area logic one level up: if any part of
   the FSA county was in D3, the FSA county was in D3. A county absent from the
   week contributes nothing (it is not a zero), and an FSA county all of whose
   constituents are absent is absent itself.
   ========================================================================== */

import { toFsaMap } from '../decoders/crosswalk.js';
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
const CLASS_COLORS = Object.freeze([
  '#f0ead8',   // None — see above
  '#ffff00',   // D0 Abnormally Dry
  '#fcd37f',   // D1 Moderate Drought
  '#ffaa00',   // D2 Severe Drought
  '#e60000',   // D3 Extreme Drought
  '#730000',   // D4 Exceptional Drought
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

/* ── The crosswalk join, memoized ────────────────────────────────────────────
   A scrubbed week slider repaints every animation frame, and the expensive half
   of a repaint is not reading the classes (one linear pass over 3,200 strings)
   but JOINING them onto FSA counties: 3,200 crosswalk lookups, a bucket Map,
   and an array per bucket, all of it identical from one week to the next.

   So the join's SHAPE is built once per (dataset, vintage) and only the values
   move. What is cached is the grouping — every FSA county with the FIPS ids it
   administers, plus the FIPS ids in this payload that the crosswalk cannot
   reach at all — which is a fact about two tables and not about any week.

   Six entries at most (three datasets × two boundary vintages), so this never
   grows. It is keyed by dataset id, and a dataset id is one payload for the
   life of the session (decoders/common.js caches by URL), so an entry cannot
   go stale under a reload of the same name. */
const joins = new Map();

/**
 * @param {object} data the decoder instance
 * @param {object} xw the crosswalk
 * @param {object} sel {dataset, vintage}
 * @returns {{groups: Array<[string, string[]]>, orphans: string[],
 *            universe: number}|null}
 */
function joinFor(data, xw, sel) {
  const key = sel.dataset + '|' + sel.vintage;
  const hit = joins.get(key);
  if (hit) return hit;
  if (!data || !xw || typeof data.allCountyIds !== 'function') return null;

  const buckets = new Map();
  const orphans = [];
  for (const fipsId of data.allCountyIds()) {
    const fsaIds = xw.toFsa(sel.vintage, fipsId);
    if (!fsaIds.length) {
      orphans.push(fipsId);
      continue;
    }
    for (const fsaId of fsaIds) {
      const seenIds = buckets.get(fsaId);
      if (seenIds) seenIds.push(fipsId);
      else buckets.set(fsaId, [fipsId]);
    }
  }
  const built = {
    groups: Array.from(buckets.entries()),
    orphans,
    /* The DENOMINATOR, and deliberately not buckets.size: the question the live
       region answers is "how many of the counties on this map are colored", and
       the counties on this map are every FSA county this vintage has. A dataset
       that can never reach some of them (the reported set cannot reach
       Connecticut) must still count them as uncolored — with buckets.size the
       sentence would read "3,095 of 3,095" and never mention the eight gray
       counties the reader is looking at. */
    universe: new Set(xw.pairs(sel.vintage).fsa).size,
  };
  joins.set(key, built);
  return built;
}

/** The cached join for a selection, without building one. For the leaves that
    need the denominator (how many FSA counties this vintage's crosswalk knows)
    but are not handed the crosswalk — the table's caption. Null before the
    first paint, which cannot happen: nothing can open a table for a map that
    has not been drawn. */
function cachedJoin(sel) {
  return joins.get(sel.dataset + '|' + sel.vintage) || null;
}

/* ── Records ─────────────────────────────────────────────────────────────── */

/**
 * The worst class among the Census counties one FSA office administers.
 *
 * The any-area rule, one level up: LFP asks whether the county has HAD the
 * class, so if any constituent reached D3 the FSA county reached D3. An absent
 * constituent contributes nothing — it never reaches this function, because
 * classesFor() omits it rather than reporting a zero — and an FSA county whose
 * every constituent is absent is absent itself.
 *
 * @param {number[]} codes constituent class codes, at least one
 * @returns {number} the highest
 */
export function reduceFips(codes) {
  let worst = codes[0];
  for (let i = 1; i < codes.length; i++) if (codes[i] > worst) worst = codes[i];
  return worst;
}

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
  if (!data || !xw || typeof data.classCodeAt !== 'function') return out;
  if (!Number.isInteger(sel.week)) return out;

  for (const fipsId of xw.toFips(sel.vintage, id)) {
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

  if (!xw) {
    // The honest failure: treating FIPS ids as FSA ids would paint a map that
    // is 97% right and therefore wrong in a way nobody sees.
    console.warn('[usdm/iface] the ' + sel.dataset + ' dataset is FIPS-keyed and '
      + 'the FSA ⇄ FIPS crosswalk is not loaded — nothing can be painted.');
    return { colors, unmatchedFips: Array.from(classes.keys()), stats };
  }

  const join = joinFor(data, xw, sel);
  if (!join) return { colors, unmatchedFips: [], stats };

  for (const [fsaId, fipsIds] of join.groups) {
    let worst = ABSENT;
    for (let i = 0; i < fipsIds.length; i++) {
      const code = classes.get(fipsIds[i]);
      if (code !== undefined && code > worst) worst = code;
    }
    if (worst < 0) continue;              // every constituent absent this week
    colors.set(fsaId, CLASS_COLORS[worst]);
    if (worst >= D2_CODE) stats.severe += 1;
  }

  // Only the orphans that are actually IN this week count as unreached: on the
  // Census set a planning region is '.' for two decades and reporting it as an
  // unmatched area every one of those weeks would be noise, not honesty.
  const unmatchedFips = [];
  for (const fipsId of join.orphans) {
    if (classes.has(fipsId)) unmatchedFips.push(fipsId);
  }

  stats.classed = colors.size;
  stats.total = join.universe;
  stats.absent = Math.max(0, stats.total - stats.classed);
  stats.unmatched = unmatchedFips.length;
  return { colors, unmatchedFips, stats };
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
 */
function legendKey() {
  return 'Color is the worst drought class touching any part of the county that '
    + 'week — the same any-area rule LFP uses (7 U.S.C. § 1531(d)(3)). Yellow is '
    + 'abnormally dry; deep red is exceptional drought. Pale counties are '
    + 'drought-free; gray counties are not in this week\'s county set.';
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

  rows.push({ term: 'FSA county code', value: String(id) });
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

  // What was combined, and out of what. Only where there is something to
  // reconcile: naming one constituent would be noise, and the reader of a
  // five-county FSA office needs to see that the class on the map is the worst
  // of five — with each one's own class, so the reduction is auditable.
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

  // Partial coverage: the class on the map is real, but it is the worst of only
  // SOME of this office's counties. Said once, in whichever form fits — the
  // multi-county case has already listed each constituent above.
  if (found.absent && found.code >= 0) {
    rows.push({
      term: 'Coverage',
      value: found.parts.length > 1
        ? count(found.absent) + ' of ' + count(found.parts.length)
          + ' Census counties in this FSA office are not in this week\'s county '
          + 'set; the class shown is the worst of the rest.'
        : 'Part of this FSA county is not in this week\'s county set.',
      isNote: true,
    });
  }

  if (sel.hasGeometry === false) {
    rows.push({
      term: 'Boundary',
      value: 'No boundary available to display — this county is not in the '
        + (sel.vintage || 'current') + ' FSA boundary archive.',
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
  const fipsIds = xw ? xw.toFips(sel.vintage, id) : [];
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
  if (!data || typeof data.classesFor !== 'function' || !xw) {
    container.replaceChildren();
    return null;
  }

  const years = data.years();
  const codes = countySeries(data, xw, sel, id);
  const primary = (xw.toFips(sel.vintage, id) || [])[0];
  const nm = primary ? data.countyName(primary) : null;
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
  if (!stats || !stats.total) {
    return head + ', ' + datasetLabel(sel) + ': nothing to show yet.';
  }

  let msg = head + ', ' + datasetLabel(sel) + ': ' + count(stats.classed) + ' of '
    + count(stats.total) + ' counties classed — ' + count(stats.severe)
    + ' in D2 or worse.';
  if (stats.absent > 0) {
    msg += ' ' + count(stats.absent) + (stats.absent === 1 ? ' county is' : ' counties are')
      + ' not in this week\'s county set.';
  }
  if (stats.unmatched > 0) {
    // The Connecticut planning regions on the NDMC-reported set, and anything
    // else the crosswalk cannot reach. Counted out loud, always.
    msg += ' ' + count(stats.unmatched) + ' reported '
      + (stats.unmatched === 1 ? 'area' : 'areas')
      + ' could not be matched to an FSA county.';
  }
  if (missingGeometry > 0 && stats.unmatched !== missingGeometry) {
    msg += ' ' + count(missingGeometry - stats.unmatched)
      + ' more have data but no county boundary to draw.';
  }
  return msg;
}

/* ── The data table ──────────────────────────────────────────────────────── */

function tableColumns() {
  return [
    { label: 'County', key: 'county', rowHeader: true },
    { label: 'State', key: 'state' },
    // FSA, not FIPS: these rows are the JOIN's output — one per FSA county the
    // map draws — even though the payload underneath is keyed by Census FIPS.
    { label: 'FSA code', key: 'id', code: true },
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
  if (!data || !xw || typeof data.classesFor !== 'function') return rows;
  if (!Number.isInteger(sel.week)) return rows;

  // The shared join helper here, not colorsFor's memo: a table is built once
  // per (dataset, week) and wants the VALUES, and reading them through the one
  // documented crosswalk join is worth more than saving a millisecond. The two
  // paths agree by construction — same reduce, same vintage — and the smoke
  // test asserts it, because a table that disagreed with the map would be worse
  // than no table.
  const classes = data.classesFor(sel.week);
  const { byFsa } = toFsaMap(xw, sel.vintage, classes, reduceFips);

  for (const [id, code] of byFsa) {
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
  const join = cachedJoin(sel);
  const n = Number(nRows) || 0;
  let msg = when + ' — ' + datasetLabel(sel) + ' — ' + count(n)
    + (n === 1 ? ' county classed' : ' counties classed');
  if (join) {
    const absent = Math.max(0, join.universe - n);
    if (absent > 0) msg += '; ' + count(absent) + ' not in this week\'s county set';
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
    in this interface is a UTC midnight (js/decoders/usdm-max-class.js). */
function weekIso(sel) {
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
  reduceFips,
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
