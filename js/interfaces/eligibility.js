/* ============================================================================
   LFP Explorer · js/interfaces/eligibility.js
   Interface 3 · LFP eligibility. Which counties the Livestock Forage Program
   found eligible for drought, in which program year, for which pasture type —
   and every sentence the app says about it.

   ES module, no build step. Imports the color scales, the
   `fsa-lfp-eligibility/1` decoder and the card's chart; imports nothing from
   app.js (the module graph stays acyclic: app.js → registry → descriptors →
   decoders + color). It also reads the grazing-period facade's county
   gazetteer, for the one thing these payloads do not carry — see NAMES below.

   ── What this map paints ───────────────────────────────────────────────────
   One row of the archive is ONE QUALIFYING EVENT, not one determination: a
   county whose drought deepened through the season carries a row per tier as it
   was reached. The map paints the BEST event of the year per county — most
   payment months, then highest drought factor, then earliest date — by the one
   comparator in js/decoders/lfp-eligibility.js, which the card and the table
   read too. The table shows every event; the map shows the answer.

   The geometry is FSA counties and so are these payloads' keys, so nothing here
   goes through the FIPS crosswalk. The Census key rides along as provenance,
   and it is not decoration: it is why the same drought can pay four months on
   one side of a county line and one on the other (see NYE below).

   ── The three archives ─────────────────────────────────────────────────────
     FSA official (FOIA)  what FSA determined, obtained by FOIA. Program years
                          2008–2025 — the archive is the record, so the slider's
                          ceiling follows it and a reader who arrives at 2026
                          is told why they are looking at 2025.
     FSA weekly web       FSA's own public weekly tables, 2008–2026: the current
                          program year as it is being determined, plus every
                          superseded version behind it.
     Derived from USDM    the same statutory ladder recomputed from the U.S.
                          Drought Monitor, under four different conventions for
                          "any area of the county". NOT an FSA determination,
                          and every string in this file that describes it says
                          so — including the poster's credit line.

   ── Drought factor is not the payable amount ───────────────────────────────
   The ladder earns a DROUGHT FACTOR — monthly payments a tier is worth. FSA
   then caps it at the MAXIMUM ELIGIBLE PAYMENT MONTHS the grazing period's own
   length allows, and the payable figure is the PAYMENT FACTOR, min(df, mepm).
   The two FSA archives carry all three numbers; the derived archive carries the
   drought factor alone, uncapped, because the cap follows from the grazing
   period and that archive does not apply it.

   So `months` — what the map colors by — is FSA's payable figure where there is
   one and the recomputed drought factor where there is not, the legend key says
   which, and the derived card carries the uncapped warning in words. MEASURED:
   Phillips County, Arkansas (05107) in program year 2024 on Short Season Small
   Grains reached D4b, drought factor 5, with a four-month grazing period — FSA
   paid four. The derived archive says 5 and means something else by it.

   From program year 2026 FSA reports BOTH D2 sub-tiers as drought factor 1 and
   carries the two-payment outcome in the payment factor alone (P.L. 119-21
   § 10401(b) split the tier). These archives score D2b_2026 as 2, so a 2026
   comparison against FSA has to be made on payment months. The card says that
   too, on any 2026-or-later row.
   ========================================================================== */

import { NO_DATA, cyclicColor, dfColor, dfRamps, loadDfRamp } from '../color.js';
/* NAMES. These payloads carry two county dictionaries and no county NAMES at
   all, and a card headed "32023" is not a card. FSA county names are FSA's own,
   the grazing-period facade is the app's gazetteer for them (js/app.js § Live
   state), and it is always loaded — boot fetches that payload before anything
   can select a county. The data table gets the geometry's gazetteer handed to
   it instead (js/table-view.js § names), which is better still; this is the
   fallback for the surfaces that are not handed one. */
import { countyName } from '../data.js';
import { typeSlug } from '../decoders/common.js';
import { ALL_TYPES, makeEligibilityData } from '../decoders/lfp-eligibility.js';
import { renderEligibilityFigure } from './eligibility-chart.js';

/* ── The archives ────────────────────────────────────────────────────────────
   All three declare the SAME schema and the same year0, so `expect` cannot tell
   them apart — `expectedDataset` is the tripwire, checked against the payload's
   own `dataset` field in the decoder. The years are deliberately NOT pinned:
   the official archive's ceiling moves the day FSA publishes a new program
   year, and applyYearDomain() re-authors the slider from the payload anyway. */
const DATASETS = Object.freeze([
  Object.freeze({
    id: 'official',
    label: 'FSA official (FOIA)',
    url: '../fsa-lfp-eligibility/fsa-lfp-eligibility-events.json',
    schema: 'fsa-lfp-eligibility/1',
    keySpace: 'fsa',
    expect: Object.freeze({ year0: 2008 }),
    expectedDataset: 'fsa-lfp-eligibility',
    decode: makeEligibilityData,
  }),
  Object.freeze({
    id: 'web',
    label: 'FSA weekly web',
    url: '../fsa-lfp-eligibility-web/fsa-lfp-eligibility-web-events.json',
    schema: 'fsa-lfp-eligibility/1',
    keySpace: 'fsa',
    expect: Object.freeze({ year0: 2008 }),
    expectedDataset: 'fsa-lfp-eligibility-web',
    decode: makeEligibilityData,
  }),
  Object.freeze({
    id: 'derived',
    label: 'Derived from USDM',
    url: '../fsa-lfp-eligibility-derived/fsa-lfp-eligibility-derived.json',
    schema: 'fsa-lfp-eligibility/1',
    keySpace: 'fsa',
    expect: Object.freeze({ year0: 2008 }),
    expectedDataset: 'fsa-lfp-eligibility-derived',
    decode: makeEligibilityData,
    /** This is the one archive with a `sources` dictionary, so it is the one
        whose aggregation picker appears (app.js § syncSourceControl). */
    hasSources: true,
    /** 11 MB of JSON, uncompressed — four aggregations of nineteen program
        years. Over a fast connection it gzips to a fraction of that, but the
        PARSE is real on a phone, and a pill that says nothing for four seconds
        reads as a broken app. */
    loadingNote: 'Loading the derived eligibility archive — an 11 MB file, so '
      + 'this can take a moment…',
  }),
]);

/** The pasture type a session with no opinion lands on: the one most of the
    country grazes, and the same default the grazing-period interface uses, so a
    switch between the two families compares like with like. */
const DEFAULT_TYPE = 'Native Pasture';

/** The label for the ALL_TYPES sentinel. The VALUE is the decoder's constant
    (and slugs to `all-types`); this is what the reader sees. */
const ALL_TYPES_LABEL = 'All types (worst case)';

/**
 * The four ways to read "any area of the county", with the UI's own words for
 * them. The ids are the archive names, in the payload's own order, and they are
 * also the `?source=` slug — one string, so nothing has to be mapped.
 *
 * The default is the FSA LFP boundary aggregation, which is the same convention
 * the drought-monitor interface defaults to and for the same reason: it is the
 * geometry the PROGRAM is administered on.
 */
const SOURCE_LABELS = Object.freeze({
  'usdm-counties-fsa-lfp': 'FSA LFP boundaries',
  'usdm-counties-reported': 'NDMC reported',
  'usdm-counties-census-2020': 'Census 2020',
  'usdm-counties': 'Census vintage-matched',
});
const DEFAULT_SOURCE = 'usdm-counties-fsa-lfp';

/**
 * The statutory ladder, tier by tier, in the archives' own words.
 *
 * Lifted from fsa-lfp-eligibility/README.md § Drought tiers and payment
 * ladders: the `a` tiers trigger at any time and the `b` tiers require a
 * duration, and the D2 sub-tiers of 2026 onward are P.L. 119-21 § 10401(b)'s
 * split of the old single D2. The gloss is the redundancy channel that makes a
 * tier code mean something to a reader who has never seen one.
 */
const EVENT_GLOSS = Object.freeze({
  D2: 'severe drought eight consecutive weeks',
  D3a: 'extreme drought at any time',
  D3b: 'extreme drought four weeks or more',
  D4a: 'exceptional drought at any time',
  D4b: 'exceptional drought four weeks or more',
  D2a_2026: 'severe drought four consecutive weeks',
  D2b_2026: 'severe drought in seven of the previous eight consecutive weeks',
});

/** The first program year of the 2014 Farm Bill's ladder. Before it, the 2008
    Farm Bill's ladder paid two months for extreme drought where 2012 onward
    pays three — so a drought factor is not comparable across this line, and the
    card says so on the early years. */
const LADDER_2014 = 2012;

/** The first program year of P.L. 119-21's ladder, where the D2 tier splits and
    FSA's own drought-factor column stops distinguishing the two halves. */
const LADDER_2026 = 2026;

/** Small numbers in words, for the cross-archive sentence: the gap between two
    determinations is never more than four. */
const NUMBER_WORDS = Object.freeze(['no', 'one', 'two', 'three', 'four', 'five']);

/**
 * The two things this map can color by — its OWN registry, not js/color.js's
 * VARIABLES, which are the grazing-period family's three.
 *
 * `?variable=` is validated against the ACTIVE interface's registry (js/app.js
 * § setVariable), so `duration` is meaningless here and `date` is meaningless
 * there, and each falls back to its own family's default with a warning rather
 * than blanking a map.
 *
 * `label` is the neutral name. What the quantity IS depends on the archive —
 * FSA's payable months, or a recomputed uncapped drought factor — and that is
 * variableLabel()'s job, because a poster subtitled "Payment months" over the
 * derived archive would be a false claim that outlives the tab it came from.
 */
const VARIABLES = Object.freeze({
  months: Object.freeze({
    field: 'months', scale: dfColor, label: 'Payment months', cyclic: false,
  }),
  date: Object.freeze({
    field: 'date', scale: cyclicColor, label: 'Qualifying date', cyclic: true,
  }),
});

const MS_PER_DAY = 86400000;

/* ── Small shared readings of `sel` ──────────────────────────────────────────
   `sel` is the app's selection: {year, type, variable, dataset, source,
   vintage, universe}, plus an optional hasGeometry the card uses. Every
   function below reads it and none of them mutate it. */

function datasetById(id) {
  for (const ds of DATASETS) if (ds.id === id) return ds;
  return DATASETS[0];
}

function datasetLabel(sel) {
  return datasetById(sel && sel.dataset).label;
}

/** True for the archive that recomputes the ladder rather than reporting FSA's
    determinations. Asked of the DESCRIPTOR's own facts, so the prose follows
    the dataset's nature and not a spelling. */
function isDerived(sel) {
  return !!datasetById(sel && sel.dataset).hasSources;
}

function spec(sel) {
  return VARIABLES[sel && sel.variable] || VARIABLES.months;
}

/** What the numbers on screen ARE, in the archive's own terms. The one place
    the app is allowed to call an uncapped drought factor anything, and it never
    calls it payment months. */
function quantity(sel) {
  return isDerived(sel) ? 'drought factor' : 'payment months';
}

/** The color-by label for a poster or a live sentence. */
function variableLabel(sel) {
  if (sel && sel.variable === 'date') return VARIABLES.date.label;
  return isDerived(sel) ? 'Drought factor' : VARIABLES.months.label;
}

function months(n) {
  return n + (n === 1 ? ' month' : ' months');
}

function count(n) {
  return Number(n || 0).toLocaleString('en-US');
}

/** The pasture-type row's own words: the sentinel is a selection across the
    dictionary rather than a name in it. */
function typeLabel(type) {
  return type === ALL_TYPES ? ALL_TYPES_LABEL : String(type);
}

/** "D3b — extreme drought four weeks or more". The gloss table is the whole
    reason a tier code is legible; an unknown code prints bare rather than
    inventing a meaning for it. */
function eventPhrase(code) {
  const gloss = EVENT_GLOSS[code];
  return gloss ? code + ' — ' + gloss : String(code);
}

/** Day of the year of a UTC date, 1–366 — the cyclic ramp's own index. Read in
    the date's OWN calendar year, which is what makes a tier satisfied in the
    previous December (qo = −1) land in late December on the wheel rather than in
    the middle of the following year. */
function ydayOf(date) {
  return Math.round((+date - Date.UTC(date.getUTCFullYear(), 0, 1)) / MS_PER_DAY) + 1;
}

/** The color for one best event under the active variable. An undated event
    paints the ramp's index-0 slate: the county qualified, and the date is a
    fact the record does not carry — which is not the same as not qualifying. */
function colorOf(rec, sel) {
  if (sel.variable !== 'date') return dfColor(rec.months);
  if (!rec.date) return dfRamps()[0] || NO_DATA();
  return cyclicColor(ydayOf(rec.date));
}

/* ── The instances this interface has seen ───────────────────────────────────
   Every leaf below is handed the instance the app is CURRENTLY painting from.
   The card wants one more thing: what ANOTHER archive says about the same
   county, year and type, which is the comparison three archives on one map
   exist to make. So each instance is noted the first time it reaches the
   screen, keyed by dataset id, and the card reads whichever ones are there.

   NOTHING here fetches. The comparison sentence appears once the reader has
   loaded a second archive (by selecting it at least once) and not before: a
   county click must never turn into an 11 MB download. */
const seen = new Map();

function remember(sel, data) {
  if (data && sel && typeof data.getYearType === 'function') seen.set(sel.dataset, data);
}

/** Which aggregation to read a derived instance at: the reader's choice if this
    payload has one, its default if not, and undefined for an archive with no
    aggregations at all (where the decoder ignores it). */
function sourceIndexFor(data, sel) {
  if (!data || typeof data.sources !== 'function') return undefined;
  const list = data.sources();
  if (!list.length) return undefined;
  const want = (sel && sel.source) || DEFAULT_SOURCE;
  const found = list.indexOf(want);
  if (found >= 0) return found;
  const fallback = list.indexOf(DEFAULT_SOURCE);
  return fallback >= 0 ? fallback : 0;
}

/** The aggregation actually being read, as an id — for the prose that has to
    name it (the poster's filename, the comparison sentence, the card). */
function sourceIdFor(data, sel) {
  const idx = sourceIndexFor(data, sel);
  if (!Number.isInteger(idx)) return null;
  return data.sources()[idx] || null;
}

function sourceLabel(id) {
  return SOURCE_LABELS[id] || String(id || '');
}

/** One county's best event under a selection, or null. */
function bestFor(data, sel, id) {
  if (!data || typeof data.getYearType !== 'function') return null;
  const found = data.getYearType(sel.year, sel.type, sourceIndexFor(data, sel))
    .get(String(id));
  return found ? found.best : null;
}

/** One county's every event under a selection, best first. */
function eventsFor(data, sel, id) {
  if (!data || typeof data.getYearType !== 'function') return [];
  const found = data.getYearType(sel.year, sel.type, sourceIndexFor(data, sel))
    .get(String(id));
  return found ? found.events : [];
}

/* ── Paint ───────────────────────────────────────────────────────────────── */

/**
 * The Map<fsaId, cssColor> the choropleth is painted from, plus the counts only
 * this reduction can produce.
 *
 * These payloads are keyed by FSA county, exactly like the geometry, so there is
 * no crosswalk in this path and `unmatchedFips` is always empty — the honest
 * value for a family that never joins.
 *
 * `stats` is handed straight back to liveSentence(): how many counties were
 * found eligible, how many reached four months or more, how many qualified with
 * no month count and how many with no date, and how many counties the MAP has
 * (the denominator, `sel.universe` — the number of counties a reader is looking
 * at, not the number the payload happens to name).
 *
 * @param {object} data the active decoder instance
 * @param {object|null} xw the crosswalk (unused: this family answers in the
 *        geometry's own key space)
 * @param {object} sel
 * @returns {{colors: Map<string, string>, unmatchedFips: string[], stats: object}}
 */
function colorsFor(data, xw, sel) {
  remember(sel, data);
  const colors = new Map();
  const stats = {
    eligible: 0, four: 0, unstated: 0, undated: 0,
    universe: Number(sel && sel.universe) || 0,
    source: null,
  };
  if (!data || typeof data.getYearType !== 'function') {
    return { colors, unmatchedFips: [], stats };
  }
  stats.source = sourceIdFor(data, sel);

  const recs = data.getYearType(sel.year, sel.type, sourceIndexFor(data, sel));
  for (const [id, entry] of recs) {
    const rec = entry.best;
    colors.set(id, colorOf(rec, sel));
    stats.eligible += 1;
    if ((rec.months == null ? 0 : rec.months) >= 4) stats.four += 1;
    if (rec.months == null) stats.unstated += 1;
    if (!rec.date) stats.undated += 1;
  }
  return { colors, unmatchedFips: [], stats };
}

/* ── Legend ──────────────────────────────────────────────────────────────── */

/** Payment months are five discrete steps plus a category, so they are CHIPS,
    never a bar; a qualifying date is a day of the year, so it is the same month
    WHEEL the grazing-period interface reads dates on. */
function legendKind(sel) {
  return spec(sel).cyclic ? 'wheel' : 'swatches';
}

/**
 * The chips, in ladder order, then the qualified-but-unstated category.
 *
 * The LABELS are the legend: five steps of one hue family have nothing left in
 * grayscale (HOUSE-STYLE §6), so every step is named here and the names reach
 * the drawer, the poster and the screen reader from this one list. The slate
 * chip is LAST of the real categories and reads as a category, not as a sixth
 * month — which is exactly what its color was chosen to say (js/color.js).
 */
function legendItems() {
  const ramp = dfRamps();
  const items = [];
  for (let m = 1; m <= 5; m++) {
    items.push({ color: ramp[m] || dfColor(m), label: months(m) });
  }
  items.push({
    color: ramp[0] || dfColor(null),
    label: 'Eligible — months not stated',
  });
  return items;
}

/** What the absence of color means here — and it is not "no data": the county
    is in the archive, it was simply not eligible that year. */
function legendNoDataLabel() {
  return 'Not eligible this year';
}

/**
 * What the colors mean, in a sentence — the redundancy channel that makes this
 * map legible in grayscale, to a CVD reader and to a screen reader, and the
 * place the cap is explained, because a reader who takes a drought factor for a
 * payment will misread every county on the derived archive.
 */
function legendKey(sel) {
  if (spec(sel).cyclic) {
    return 'Color is the date the best qualifying event was satisfied, read '
      + 'against the months around the wheel. The scale wraps, so late December '
      + 'and early January are neighboring colors. Slate counties qualified on a '
      + 'date the record does not carry (most 2008–2011 determinations); gray '
      + 'counties were not eligible this year.';
  }
  const first = 'Color is the payment months the determination supports — one '
    + 'month for brief severe drought up to five for a month of exceptional '
    + 'drought. ';
  const second = isDerived(sel)
    ? 'These are recomputed drought factors, not FSA\'s payable months — no cap '
      + 'is applied. '
    : 'Payments are also capped by the grazing period\'s length. ';
  return first + second + 'Slate counties qualified without a stated month '
    + 'count; gray counties did not qualify.';
}

/* ── Tooltip ─────────────────────────────────────────────────────────────── */

/**
 * The tooltip's value line — the same words the card uses. The tooltip is
 * aria-hidden decoration; this content reaches assistive technology through the
 * live region and the card.
 */
function tooltip(data, xw, sel, id) {
  const rec = bestFor(data, sel, id);
  if (!rec) return 'Not eligible this year';
  if (sel.variable === 'date') {
    return (rec.dateLabel
      ? 'Qualified ' + rec.dateLabel
      : 'Qualified on a date the record does not carry')
      + ' (' + rec.event + ')';
  }
  if (rec.months == null) return 'Eligible — months not stated (' + rec.event + ')';
  return (isDerived(sel) ? 'Drought factor ' + rec.months : months(rec.months))
    + ' (' + rec.event + ')';
}

/* ── The county card ─────────────────────────────────────────────────────── */

/**
 * The card's rows for one county at the CURRENT selection.
 *
 * Every case is stated in WORDS rather than implied by an empty box: the tier
 * and what it means, a date the record does not carry, the cap and the payable
 * figure, the two county keys, and the two places in the record where a drought
 * factor is not comparable with another year's.
 *
 * @returns {Array<{term: string, value: string, isNote?: boolean}>}
 */
function cardRows(data, xw, sel, id) {
  const rows = [];
  const rec = bestFor(data, sel, id);
  const derived = isDerived(sel);

  rows.push({ term: 'FSA county code', value: String(id) });

  /* The Census key. Provenance, not a join: it is the county the Drought
     Monitor was read for, and when several FSA offices share it, that IS the
     reason two neighbouring counties on this map can disagree. */
  const fipsId = rec ? rec.fips : null;
  if (fipsId) {
    const offices = (data && typeof data.officesFor === 'function')
      ? data.officesFor(fipsId) : [];
    /* The NAME, only where it is certainly the Census county's. The app's
       gazetteer is FSA's (see NAMES at the top), and FSA's name for a county it
       has split is the OFFICE's: 32023 is "Northwest Nye" to FSA and Nye to the
       Census. So the name is printed only where the two keys are the same code
       and that code is one office — where the FSA county and the Census county
       are the same county — and the bare code stands alone everywhere else,
       which is the honest answer rather than a plausible wrong one. */
    const named = fipsId === String(id) && offices.length <= 1
      ? countyName(fipsId) : null;
    rows.push({
      term: 'Census county',
      value: fipsId + (named ? ' — ' + named.county : '')
        + (offices.length > 1 ? ' (shared office)' : ''),
    });
    if (offices.length > 1) {
      rows.push({
        term: 'Shared with',
        value: offices.length + ' FSA offices administer parts of this Census '
          + 'county (' + offices.join(', ') + '); each sets its own grazing '
          + 'period, so their determinations can differ.',
        isNote: true,
      });
    }
  }

  rows.push({ term: 'Pasture type', value: typeLabel(sel.type) });

  if (!rec) {
    rows.push({
      term: sel.year + ' eligibility',
      value: 'Not eligible: this archive records no qualifying drought event for '
        + typeLabel(sel.type) + ' in ' + sel.year + '.',
      isNote: true,
    });
    if (sel.hasGeometry === false) rows.push(boundaryNote(sel));
    return rows;
  }

  rows.push({ term: 'Best event', value: eventPhrase(rec.event) });
  // On the sentinel the reader is looking at the worst case across fifteen
  // dictionaries, so which one it came from is the next thing they need.
  if (sel.type === ALL_TYPES) {
    rows.push({ term: 'Best event type', value: rec.type });
  }
  rows.push({
    term: 'Qualifying date',
    value: rec.dateLabel
      || 'Not recorded — most 2008–2011 determinations are undated.',
    isNote: !rec.dateLabel,
  });
  rows.push({ term: 'Drought factor', value: months(rec.df) });

  if (derived) {
    rows.push({
      term: 'Aggregation',
      value: sourceLabel(rec.source) + ' (' + rec.source + ')',
    });
    rows.push({
      term: 'Cap',
      value: 'Drought factor is uncapped — the payable amount depends on the '
        + 'grazing period\'s length, which this archive does not apply.',
      isNote: true,
    });
  } else {
    rows.push({
      term: 'Max eligible (grazing period)',
      value: rec.mepm == null ? 'Not reported' : months(rec.mepm),
      isNote: rec.mepm == null,
    });
    rows.push({
      term: 'Payment months',
      value: rec.months == null ? 'Eligible — months not stated' : months(rec.months),
      isNote: rec.months == null,
    });
  }

  /* The two ladder lines. A drought factor means different things either side of
     each of them, and a reader comparing years across one without being told is
     a reader the app has misled. */
  if (sel.year < LADDER_2014) {
    rows.push({
      term: 'Ladder',
      value: 'Program years 2008–2011 ran the 2008 Farm Bill ladder, which paid '
        + 'two months for extreme drought where 2012 onward pays three.',
      isNote: true,
    });
  }
  if (sel.year >= LADDER_2026) {
    rows.push({
      term: 'Ladder',
      value: 'From 2026 FSA reports both D2 tiers as drought factor 1 — compare '
        + 'payment months, not drought factors.',
      isNote: true,
    });
  }

  if (sel.hasGeometry === false) rows.push(boundaryNote(sel));
  return rows;
}

function boundaryNote(sel) {
  return {
    term: 'Boundary',
    value: 'No boundary available to display — this county is not in the '
      + (sel.vintage || 'current') + ' FSA boundary archive.',
    isNote: true,
  };
}

/* ── The card's picture: every program year as a bar ─────────────────────── */

/** The table twin's columns after the year — the cap and the payable figure on
    the FSA archives, the aggregation on the derived one, because those are the
    fields each of them actually has. Nulls print as an em dash, never as a
    blank cell: an empty cell is indistinguishable from a rendering bug. */
function tableTwinColumns(sel) {
  const dash = '—';
  const cols = [
    { label: 'Event', cell: (rec) => rec.event },
    { label: 'Qualifying date', cell: (rec) => rec.dateLabel || 'Not recorded' },
    { label: 'Drought factor', cell: (rec) => String(rec.df) },
  ];
  if (isDerived(sel)) {
    cols.push({ label: 'Aggregation', cell: (rec) => sourceLabel(rec.source) });
    return cols;
  }
  cols.push({ label: 'Max eligible', cell: (rec) => (rec.mepm == null ? dash : String(rec.mepm)) });
  cols.push({
    label: 'Payment months',
    cell: (rec) => (rec.months == null ? 'Not stated' : String(rec.months)),
  });
  return cols;
}

/**
 * One sentence comparing what ANOTHER archive says about this county, year and
 * type — the Phillips County story, on whichever county the reader has open.
 *
 * Only from what is already in hand (see `seen`): this never fetches, so the
 * sentence appears once the reader has looked at a second archive and stays
 * silent until then. The preference order is the interesting comparison: from
 * an FSA archive, what the recomputation says; from the recomputation, what FSA
 * determined.
 *
 * @returns {string|null}
 */
function comparisonSentence(sel, id) {
  const active = datasetById(sel.dataset);
  const order = active.hasSources
    ? ['official', 'web'] : ['derived', 'official', 'web'];
  const mine = bestFor(seen.get(active.id), sel, id);

  for (const otherId of order) {
    if (otherId === active.id) continue;
    const other = seen.get(otherId);
    if (!other) continue;
    const otherSel = { ...sel, dataset: otherId };
    const theirs = bestFor(other, otherSel, id);
    const head = datasetById(otherId).label
      + (otherId === 'derived'
        ? ' (' + sourceLabel(sourceIdFor(other, otherSel)) + ')' : '');
    if (!theirs) {
      if (!mine) continue;      // both silent: nothing worth a sentence
      return head + ': no qualifying event for this county in ' + sel.year + '.';
    }
    const theirQ = quantity(otherSel);
    const theirs_ = theirs.months == null
      ? 'no stated month count' : theirQ + ' ' + theirs.months;
    if (!mine) {
      return head + ': ' + theirs_ + ' (' + theirs.event
        + '), where this archive records no qualifying event.';
    }
    const a = mine.months == null ? null : mine.months;
    const b = theirs.months == null ? null : theirs.months;
    if (a == null || b == null || a === b) {
      return head + ': ' + theirs_ + ' (' + theirs.event + ') — the same '
        + 'as this archive\'s ' + (a == null ? 'unstated count' : a) + '.';
    }
    const gap = Math.abs(b - a);
    const word = NUMBER_WORDS[gap] || String(gap);
    return head + ': ' + theirs_ + ' (' + theirs.event + ') — ' + word
      + (b > a ? ' more' : ' fewer') + ' than this archive\'s ' + quantity(sel)
      + ' of ' + a + '.';
  }
  return null;
}

/**
 * The card's second half: every program year of this county's determinations as
 * a bar of payment months, then the same numbers under it as a table.
 *
 * The whole record at once is the point. One year's tier says nothing about
 * whether a county is eligible most years or was eligible once; nineteen bars
 * show which it is — and, on the derived archive, how a recomputation drifts
 * from the determinations beside it.
 *
 * @returns {null} this body has no per-frame update of its own
 */
function cardBody(container, data, xw, sel, id) {
  remember(sel, data);
  if (!data || typeof data.getCountySeries !== 'function') {
    container.replaceChildren();
    return null;
  }

  const series = data.getCountySeries(id, sel.type, sourceIndexFor(data, sel));
  const byYear = new Map(series.map((rec) => [rec.year, rec]));
  const yearList = data.years();
  const nm = countyName(id);
  const place = nm ? nm.county + ', ' + nm.state : String(id);
  /* The BARS are always the month count, whichever variable the map is painted
     by: a chart of nineteen dates would be nineteen unordered colors, and what
     a reader wants from the card is the history of the award. So the caption
     names what the chart shows, not what the map is colored by. */
  const label = isDerived(sel) ? 'Drought factor' : 'Payment months';
  const where = datasetLabel(sel)
    + (isDerived(sel) ? ' (' + sourceLabel(sourceIdFor(data, sel)) + ')' : '');

  renderEligibilityFigure(container, {
    byYear,
    yearList,
    year: sel.year,
    color: (m) => dfColor(m),
    columns: tableTwinColumns(sel),
    caption: label + ' by program year, '
      + yearList[0] + '–' + yearList[yearList.length - 1] + ', for ' + place
      + ' — ' + typeLabel(sel.type) + ', ' + where + '. Years with no qualifying '
      + 'drought event are marked with a cross; a half-height slate bar is a '
      + 'year the county qualified without a stated month count. Full values in '
      + 'the table below.',
    tableCaption: 'Qualifying drought events by program year for ' + place + ', '
      + typeLabel(sel.type) + ', ' + where + '.',
    emptyLabel: 'Not eligible',
    compare: comparisonSentence(sel, id),
    summaryLabel: 'Show all years as a table',
  });
  return null;
}

/**
 * What this interface adds to the card's render key, beyond the county, view,
 * dataset, year and type the app already keys on: the aggregation, the variable
 * (the caption names the quantity) and which OTHER archives are in hand — the
 * comparison sentence appears the first time a second payload lands, and a card
 * already open for the right county would otherwise keep the silent version.
 *
 * @returns {string}
 */
function cardKey(sel) {
  return [sel.source || '', sel.variable, Array.from(seen.keys()).sort().join('+')]
    .join('|');
}

/* ── The live region ─────────────────────────────────────────────────────── */

/**
 * The always-on half of the a11y twin: what the canvas is showing, in a
 * sentence. The on-demand table is the other half.
 *
 * The denominator is the MAP's county count, not the payload's: the question a
 * reader has is "how many of the counties I am looking at are colored", and an
 * archive that names 2,829 counties out of 3,095 on screen must not report
 * "1,208 of 2,829" as if the rest had been asked.
 *
 * @param {object} sel
 * @param {number} shown counties actually painted (the app's own count)
 * @param {number} total counties in the payload — the fallback denominator
 * @param {number} missingGeometry counties with data and nowhere to draw it
 * @param {object} [stats] from colorsFor()
 * @returns {string}
 */
function liveSentence(sel, shown, total, missingGeometry, stats) {
  const head = sel.year + ' ' + typeLabel(sel.type) + ', ' + datasetLabel(sel)
    + (isDerived(sel) && stats && stats.source
      ? ' (' + sourceLabel(stats.source) + ')' : '');
  if (!stats) return head + ': nothing to show yet.';

  const denominator = stats.universe || total || 0;
  let msg = head + ': ' + count(stats.eligible) + ' of ' + count(denominator)
    + ' counties eligible';
  if (sel.variable === 'date') {
    msg += ', colored by qualifying date.';
    if (stats.undated > 0) {
      msg += ' ' + count(stats.undated) + ' qualified on a date the record does '
        + 'not carry.';
    }
  } else {
    msg += ' — ' + count(stats.four) + ' for four or more '
      + (isDerived(sel) ? 'drought-factor months.' : 'months.');
    if (stats.unstated > 0) {
      msg += ' ' + count(stats.unstated) + ' qualified without a stated month '
        + 'count.';
    }
  }
  if (missingGeometry > 0) {
    msg += ' ' + count(missingGeometry) + ' more have a determination but no '
      + 'county boundary to draw.';
  }
  if (isDerived(sel)) {
    msg += ' These are recomputed from the Drought Monitor, not FSA\'s '
      + 'determinations.';
  }
  return msg;
}

/* ── The data table ──────────────────────────────────────────────────────── */

/**
 * EVERY qualifying event, not the reduction the map paints.
 *
 * That is the point of this table: the map can only show one tier per county,
 * and the record's own grain is the ladder as it was climbed. A county with four
 * rows here is a county whose drought deepened through the season.
 */
function tableColumns(sel) {
  const cols = [
    { label: 'County', key: 'county', rowHeader: true },
    { label: 'State', key: 'state' },
    { label: 'FSA code', key: 'id', code: true },
    // Both keys, because an LFP determination needs both — see the header.
    { label: 'FIPS', key: 'fips', code: true },
    { label: 'Event', key: 'event', code: true },
    { label: 'Qualifying date', key: 'date' },
    { label: 'Drought factor', key: 'df', num: true },
  ];
  if (isDerived(sel)) {
    cols.push({ label: 'Aggregation', key: 'source' });
    return cols;
  }
  cols.push({ label: 'Max eligible', key: 'mepm', num: true });
  cols.push({ label: 'Payment months', key: 'months', num: true });
  return cols;
}

/** How many counties the last built table covered. The caption is handed the
    ROW count (one row per event) and needs the county count beside it; noting it
    on the way past is cheaper and more honest than re-running the reduction from
    a leaf that is not handed the data. One table is built at a time (the modal
    is one dialog), so one slot is enough. */
let countiesInLastRows = 0;

/**
 * @param {object} data the active decoder instance
 * @param {object|null} xw the crosswalk (unused: FSA-keyed both sides)
 * @param {object} sel
 * @param {(id: string) => ({county: string, state: string}|null)} [names] the
 *        geometry's gazetteer, handed in by js/table-view.js — these payloads
 *        carry no county names of their own
 */
function tableRows(data, xw, sel, names) {
  const rows = [];
  if (!data || typeof data.getYearType !== 'function') return rows;
  const dash = '—';

  for (const [id, entry] of data.getYearType(sel.year, sel.type,
    sourceIndexFor(data, sel))) {
    const nm = (names && names(id)) || countyName(id);
    for (const rec of entry.events) {
      rows.push({
        id,
        county: nm ? nm.county : id,
        state: nm ? nm.state : '',
        fips: rec.fips,
        event: rec.event,
        // Em-dash text, never a blank cell: "the record does not say" is a
        // value, and an empty cell reads as a bug.
        date: rec.dateLabel || dash,
        df: String(rec.df),
        mepm: rec.mepm == null ? dash : String(rec.mepm),
        months: rec.months == null ? dash : String(rec.months),
        source: rec.source ? sourceLabel(rec.source) : dash,
      });
    }
  }
  rows.sort((a, b) => a.state.localeCompare(b.state, 'en')
    || a.county.localeCompare(b.county, 'en')
    || a.id.localeCompare(b.id, 'en')
    // Several events per county, in ladder order — the order they happened in.
    || a.event.localeCompare(b.event, 'en'));
  return rows;
}

/** The sentence that names the table — the dialog's subtitle, the table's own
    sr-only <caption>, and the scroll region's accessible name. It counts EVENTS
    and counties, because the row count is not the county count here and a
    reader who assumes it is has misread the whole table. */
function tableCaption(sel, nRows) {
  const n = Number(nRows) || 0;
  const counties = countiesInLastRows;
  return typeLabel(sel.type) + ', ' + sel.year + ' — ' + datasetLabel(sel)
    + (isDerived(sel) ? ' (' + sourceLabel(sel.source || DEFAULT_SOURCE) + ')' : '')
    + ' — ' + count(n) + (n === 1 ? ' qualifying event' : ' qualifying events')
    + ' in ' + count(counties) + (counties === 1 ? ' county.' : ' counties.');
}

/** What makes one built table different from another: the archive, the
    aggregation, the year and the type. Not the variable — both variables show
    the same rows. */
function tableCacheKey(sel) {
  return sel.dataset + '|' + (sel.source || '') + '|' + sel.year + '|' + sel.type;
}

/* ── The poster ──────────────────────────────────────────────────────────── */

function exportTitle() {
  return 'LFP Drought Eligibility';
}

/** `fsa-lfp-eligibility_<archive>[_<aggregation>]_<year>_<type>_<variable>.png`.
    The aggregation is in the name only where there is one to choose: four
    posters of the same year and type differ by nothing else. */
function exportFilename(sel) {
  const parts = ['fsa-lfp-eligibility', datasetById(sel.dataset).id];
  if (isDerived(sel)) parts.push(sel.source || DEFAULT_SOURCE);
  parts.push(String(sel.year), typeSlug(sel.type), sel.variable);
  return parts.join('_') + '.png';
}

function exportSubtitle(sel) {
  return typeLabel(sel.type) + ' · ' + sel.year + ' · ' + variableLabel(sel)
    + ' · ' + datasetLabel(sel)
    + (isDerived(sel) ? ' (' + sourceLabel(sel.source || DEFAULT_SOURCE) + ')' : '');
}

/** The credit line along the poster's foot. A poster outlives the page it came
    from, so the provenance travels with the pixels — and on the derived archive
    that provenance is the whole point: this is a recomputation from the Drought
    Monitor and not a determination anybody can take to a county office. */
function exportCredit(sel) {
  if (isDerived(sel)) {
    return 'Sustainable FSA · derived from the U.S. Drought Monitor (NDMC/USDA/'
      + 'NOAA) · not an official FSA determination · Montana Climate Office · '
      + 'sustainable-fsa.com/lfp-explorer';
  }
  return 'Sustainable FSA · USDA FSA data via FOIA · Montana Climate Office · '
    + 'sustainable-fsa.com/lfp-explorer';
}

/** The two lines the poster's WHEEL painter draws beside the ring. The wheel is
    shared with the grazing-period family, whose sentence is about a season
    starting or ending; this one is about the day a drought tier was satisfied,
    and a poster carrying the wrong one of those would be wrong in the one place
    a reader cannot hover to check. */
function exportLegendLines(sel) {
  if (!spec(sel).cyclic) return null;
  return [
    'Color is the date the best qualifying drought event was satisfied, read '
      + 'against the months around the wheel.',
    'The scale wraps, so late December and early January are neighboring '
      + 'colors. Slate counties qualified on a date the record does not carry.',
  ];
}

/* ── Controls ────────────────────────────────────────────────────────────────
   Two things the app builds from the payload and cannot guess: the type select's
   options (fifteen names plus a sentinel that is in no dictionary) and the
   aggregation select's (four conventions, in the payload's own order). */

/**
 * The pasture-type options, sentinel first.
 *
 * "All types (worst case)" is a real question — was this county eligible for
 * ANYTHING this year — and it belongs at the top because it is the widest
 * answer, not because it is the default. The default is Native Pasture.
 *
 * @param {object} data the active instance
 * @returns {Array<{value: string, label: string}>}
 */
function typeOptions(data) {
  const names = (data && typeof data.types === 'function') ? data.types() : [];
  return [{ value: ALL_TYPES, label: ALL_TYPES_LABEL }]
    .concat(names.map((t) => ({ value: t, label: t })));
}

/** The aggregation picker's options, and the resolution of a parked `?source=`.
    Grouped so app.js reads one leaf rather than four. */
const source = Object.freeze({
  /** @returns {Array<{value: string, label: string}>} */
  options(data) {
    const list = (data && typeof data.sources === 'function') ? data.sources() : [];
    return list.map((id) => ({ value: id, label: sourceLabel(id) }));
  },
  /** The convention a session with no opinion reads: the boundaries the program
      is administered on. */
  defaultId(data) {
    const list = (data && typeof data.sources === 'function') ? data.sources() : [];
    if (!list.length) return null;
    return list.includes(DEFAULT_SOURCE) ? DEFAULT_SOURCE : list[0];
  },
  label: sourceLabel,
  /**
   * Resolve a parked `?source=` (or stored) slug against the dictionary that has
   * just arrived. Anything unknown falls back to the default rather than
   * blanking the map — the same discipline every other param gets.
   *
   * @param {object} data the arrived instance
   * @param {string|null} raw
   * @returns {string|null}
   */
  resolve(data, raw) {
    const fallback = source.defaultId(data);
    if (raw == null || raw === '') return fallback;
    const list = (data && typeof data.sources === 'function') ? data.sources() : [];
    const want = String(raw).toLowerCase();
    if (list.includes(want)) return want;
    console.warn('[elig/iface] unknown aggregation ' + JSON.stringify(String(raw))
      + ' — falling back to ' + JSON.stringify(fallback) + '.');
    return fallback;
  },
});

/* ── Pending state ───────────────────────────────────────────────────────── */

/**
 * Resolve a parked `?type=` slug against a dictionary that has only just
 * arrived. Anything unknown — a hand-edited URL, a type retired from the
 * payload, a slug from another family's dictionary — falls back to this
 * family's default rather than blanking the map.
 *
 * The sentinel resolves too: `?type=all-types` is a real selection, and it is
 * the one value that is NOT in the payload's dictionary.
 *
 * @param {object} data the arrived decoder instance
 * @param {string|{type?: string, typeSlug?: string}|null} pending
 * @returns {string|null} a type name, or ALL_TYPES
 */
function applyPending(data, pending) {
  if (!data) return null;
  const slug = typeof pending === 'string'
    ? pending
    : (pending && (pending.typeSlug || pending.type)) || null;

  const have = (typeof data.types === 'function') ? data.types() : [];
  const fallback = have.includes(DEFAULT_TYPE) ? DEFAULT_TYPE : (have[0] || null);
  if (!slug) return fallback;
  if (String(slug).toLowerCase() === typeSlug(ALL_TYPES)) return ALL_TYPES;
  const hit = have.find((t) => typeSlug(t) === String(slug).toLowerCase());
  if (hit) return hit;
  console.warn('[elig/iface] unknown pasture type ' + JSON.stringify(String(slug))
    + ' — falling back to ' + JSON.stringify(fallback) + '.');
  return fallback;
}

/**
 * What to say when the shared year has to move to come on screen here.
 *
 * The generic sentence ("2026 is outside … showing 2025") is true and tells the
 * reader nothing they can act on. The reason is specific and worth the words:
 * FSA has not published that program year yet, and the two other archives in
 * this very interface have.
 *
 * @param {number} from the year the reader asked for
 * @param {number} to the year they are getting
 * @param {object} sel
 * @returns {string|null} null to accept the app's own wording
 */
function clampNotice(from, to, sel) {
  if (from <= to) return null;            // clamped UP: the generic sentence fits
  if (isDerived(sel)) return null;
  return 'Showing ' + to + ' — FSA has not published ' + from + ' determinations.';
}

/* ── The descriptor ──────────────────────────────────────────────────────── */

/**
 * Interface 3. Frozen, like every descriptor: the app reads it on every repaint
 * and a mutated leaf would mean the legend and the paint disagreed.
 */
export const ELIGIBILITY = Object.freeze({
  id: 'eligibility',
  label: 'LFP eligibility',
  /** See ngp.js — the map's accessible name follows the active family. */
  mapLabel: 'Choropleth map of Livestock Forage Disaster Program drought '
    + 'eligibility by county',
  order: 3,
  datasets: DATASETS,
  /** This family's OWN two variables. Not js/color.js's VARIABLES — see the
      registry above on why `?variable=` is read against the active family. */
  variables: VARIABLES,
  defaultVariable: 'months',
  /** The widest span any of the three archives carries. The official one stops
      at 2025 and applyYearDomain() re-authors the slider to say so. */
  years: Object.freeze({ min: 2008, max: 2026 }),
  /** Which shared controls this family answers to. `source` is new: one archive
      here publishes four readings of the same question. */
  controls: Object.freeze({ type: true, variable: true, week: false, source: true }),
  /** The type dictionary is the same fifteen names in all three archives, so
      one remembered type serves the whole interface — unlike the grazing
      periods, where each dataset has a dictionary of its own. */
  typeScope: 'view',
  /** This family's own type select: its options carry a sentinel the shared one
      knows nothing about. */
  typeSelectId: 'elig-type-select',
  typeOptions,
  source,
  /** The payment-months ramp, fetched with this interface and not at boot. */
  ensureAssets: loadDfRamp,
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
    rows: (data, xw, sel, names) => {
      const rows = tableRows(data, xw, sel, names);
      countiesInLastRows = new Set(rows.map((r) => r.id)).size;
      return rows;
    },
    caption: tableCaption,
    cacheKey: tableCacheKey,
  }),
  export: Object.freeze({
    title: exportTitle,
    filename: exportFilename,
    subtitle: exportSubtitle,
    credit: exportCredit,
    legendLines: exportLegendLines,
  }),
  applyPending,
  clampNotice,
});
