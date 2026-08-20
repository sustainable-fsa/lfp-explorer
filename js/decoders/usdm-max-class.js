/* ============================================================================
   LFP Explorer · js/decoders/usdm-max-class.js
   The `usdm-max-class/1` decoder: one packed payload of weekly U.S. Drought
   Monitor classes in, one frozen instance of O(1) lookups out.

   ES module, no build step. Imports only the two assertions from ./common.js,
   which are pure — so this file decodes in node as readily as in the browser.

   ── The payload ────────────────────────────────────────────────────────────
   Schema `usdm-max-class/1` (FROZEN), built and committed by an archive repo
   and fetched at runtime from its own same-origin Pages copy. THREE archives
   publish it, and they are not interchangeable — see the descriptor
   (js/interfaces/usdm.js) for what each one counts:

     usdm-counties-fsa-lfp   FSA's own FOIA'd LFP boundary statistics
     usdm-counties-reported  NDMC's published county statistics
     usdm-counties           vintage-matched TIGER counties

   All three declare the same schema and the same `week0`, so the tripwire that
   tells them apart is `dataset` — checked here against the descriptor's
   `expectedDataset`, because every other structural check passes on all three
   and the only symptom of a swapped URL is a map that is subtly wrong.

     scalars      schema, dataset, license, week0, weeks, n
     dictionaries classes[] (6: None, D0…D4) ·
                  counties[] / county_names[] / state_names[] (index-aligned)
     series       ONE fixed-width string per county, `weeks` characters long

   ── The series encoding, and why it is a string ────────────────────────────
   `series[i]` is county i's whole record: character j is the week starting
   `week0 + 7j` days, and

     '0'–'5'   the worst drought class touching any part of the county that
               week, as an index into `classes` ('0' = None, '5' = D4);
     '.'       the county is not in that week's county set at all — it did not
               exist yet, or it no longer does.

   Decoded with `charCodeAt(j) - 48`, which yields 0–5 for a class and −2 for
   '.', so one comparison covers both. That is the point of the encoding: 3,221
   strings of 1,389 characters is 4.5 MB of JSON that gzips to ~100 KB and needs
   NO per-week parsing — a week of the whole country is one linear pass over the
   strings, and one county's whole history is one string.

   '.' IS NOT ZERO. A county with no drought that week is '0' (None); a county
   that is not in the set is '.'. Painting the second as the first would claim
   the USDM said "no drought" about a county it had never heard of, which is the
   one error this whole module is arranged to prevent — hence classCodeAt()'s
   −1 and classesFor()'s omission rather than a default.

   ── Dates are UTC, always ──────────────────────────────────────────────────
   Every date here is built with Date.UTC and read back through a UTC-pinned
   Intl formatter, exactly as in js/decoders/ngp-web.js. NEVER use a local-time
   getter on one: a Tuesday built at UTC midnight is the previous MONDAY for
   every reader west of Greenwich, which would shift a week's map into the
   wrong week — and, in the first week of January, into the wrong year.
   ========================================================================== */

import { assertExpectations, assertSchema } from './common.js';

const MS_PER_WEEK = 604800000;

/** The schema this decoder reads. */
export const USDM_SCHEMA = 'usdm-max-class/1';

/** One formatter for the module — constructing an Intl.DateTimeFormat is the
    expensive half of formatting. timeZone: 'UTC' is not optional (see the
    header). Shape: "Jul 24, 2012". */
const LABEL_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
});

/** '.' → −2 under `charCodeAt − 48`, so anything below 0 is "not in the set".
    Spelled out because the arithmetic is only obvious once. */
const ABSENT = -1;

/**
 * Decode and index one `usdm-max-class/1` payload.
 *
 * @param {object} payload the parsed JSON (loadDataset has already checked the
 *        schema and the expectations; both are re-checked here so a direct
 *        call — a smoke test, a node script — is just as safe)
 * @param {{id?: string, url?: string, expectedDataset?: string,
 *          expect?: object, keySpace?: string}} [ds] the dataset descriptor
 * @returns {Readonly<object>} a frozen instance
 */
export function makeUsdmData(payload, ds = {}) {
  const where = ds.url || ds.id || USDM_SCHEMA + ' payload';

  assertSchema(payload, USDM_SCHEMA, where);
  assertExpectations(payload, ds.expect, where);

  /* Which of the three archives this is. The check the schema cannot make. */
  if (ds.expectedDataset && payload.dataset !== ds.expectedDataset) {
    throw new Error('[ngp/usdm] ' + where + ': expected dataset '
      + JSON.stringify(ds.expectedDataset) + ', got '
      + JSON.stringify(payload.dataset) + ' — this is one of the OTHER USDM '
      + 'county archives, which counts a different set of counties.');
  }

  /* ── Structure ─────────────────────────────────────────────────────────── */

  const weeks = payload.weeks;
  if (!Number.isInteger(weeks) || weeks < 1) {
    throw new Error('[ngp/usdm] ' + where + ': weeks is '
      + JSON.stringify(weeks) + ', which is not a week count.');
  }
  for (const key of ['classes', 'counties', 'county_names', 'state_names', 'series']) {
    if (!Array.isArray(payload[key])) {
      throw new Error('[ngp/usdm] ' + where + ': ' + JSON.stringify(key)
        + ' is missing or not an array.');
    }
  }

  const classList = payload.classes.slice();
  // String(), not a coercion: the dictionary already holds 5-character strings.
  // This documents the type and makes a numeric id in a future payload fail the
  // shape check below rather than joining to nothing quietly.
  const countyList = payload.counties.map((id) => String(id));
  const series = payload.series;

  if (payload.county_names.length !== countyList.length
      || payload.state_names.length !== countyList.length
      || series.length !== countyList.length) {
    throw new Error('[ngp/usdm] ' + where + ': counties (' + countyList.length
      + '), county_names (' + payload.county_names.length + '), state_names ('
      + payload.state_names.length + ') and series (' + series.length
      + ') are not index-aligned.');
  }

  /* Every series is exactly `weeks` characters. A HARD failure, not a warning:
     a short string reads as '.' for every week past its end (charCodeAt of an
     out-of-range index is NaN), so a truncated payload would paint a county
     that quietly vanishes partway through the record. */
  for (let i = 0; i < series.length; i++) {
    if (typeof series[i] !== 'string' || series[i].length !== weeks) {
      throw new Error('[ngp/usdm] ' + where + ': series[' + i + '] (county '
        + JSON.stringify(countyList[i]) + ') is '
        + (typeof series[i] === 'string' ? series[i].length + ' characters'
          : typeof series[i]) + ', not the declared ' + weeks + '.');
    }
  }

  const countyIdx = new Map(countyList.map((id, i) => [id, i]));
  const malformed = countyList.filter((id) => !/^[0-9]{5}$/.test(id));
  if (malformed.length) {
    console.warn('[ngp/usdm] ' + where + ': ' + malformed.length + ' county id(s) '
      + 'are not 5-character FIPS strings — the crosswalk join will miss them: '
      + malformed.slice(0, 5).join(', '));
  }

  /* ── The Tuesday grid ──────────────────────────────────────────────────────
     One anchor date and one multiplication. `week0` is a plain ISO date and is
     parsed as UTC midnight by definition (a date-only string is UTC in every
     engine); Date.UTC on its parts would be identical and is not worth the
     three parseInts. */
  const week0 = Date.parse(String(payload.week0) + 'T00:00:00Z');
  if (!Number.isFinite(week0)) {
    throw new Error('[ngp/usdm] ' + where + ': week0 '
      + JSON.stringify(payload.week0) + ' is not a date.');
  }

  /** UTC Date of week j. Weeks outside the record still compute — the grid is
      arithmetic — but every lookup that reads the DATA range-checks first. */
  function weekDate(j) {
    return new Date(week0 + j * MS_PER_WEEK);
  }

  /** "Jul 24, 2012". */
  function weekLabel(j) {
    return LABEL_FMT.format(weekDate(j));
  }

  /* Year → [firstWeek, lastWeek], built in one pass. A calendar year holds 52
     or 53 Tuesdays and the payload's own grid decides which, so this is
     measured rather than computed — and it is what makes "week 30 of 2012" a
     resolvable address instead of an approximation. */
  const byYear = new Map();
  const yearOf = new Int32Array(weeks);
  for (let j = 0; j < weeks; j++) {
    // getUTCFullYear, never getFullYear — see the header.
    const y = weekDate(j).getUTCFullYear();
    yearOf[j] = y;
    const range = byYear.get(y);
    if (range) range[1] = j;
    else byYear.set(y, [j, j]);
  }
  const yearList = Array.from(byYear.keys());

  /* ── Lookups ───────────────────────────────────────────────────────────── */

  /**
   * The half-open-free, INCLUSIVE week range of one calendar year.
   *
   * @param {number} year
   * @returns {[number, number]|null} null for a year the record does not reach
   */
  function weekRange(year) {
    const range = byYear.get(Number(year));
    return range ? [range[0], range[1]] : null;
  }

  /**
   * Where week j sits in its own year — the address `?week=` carries.
   *
   * @param {number} j
   * @returns {{year: number, index: number, count: number}|null} `index` is
   *          1-based within the year; `count` is that year's length in weeks
   */
  function weekOfYear(j) {
    if (!Number.isInteger(j) || j < 0 || j >= weeks) return null;
    const year = yearOf[j];
    const range = byYear.get(year);
    return { year, index: j - range[0] + 1, count: range[1] - range[0] + 1 };
  }

  /**
   * The class of one county in one week.
   *
   * @param {string} id 5-character FIPS string
   * @param {number} j absolute week index
   * @returns {number} 0–5, or −1 for a county absent from that week's set (and
   *          for an unknown id or an out-of-range week — a caller that needs to
   *          tell those apart has countyName() and weeks)
   */
  function classCodeAt(id, j) {
    if (!Number.isInteger(j) || j < 0 || j >= weeks) return ABSENT;
    const i = countyIdx.get(String(id));
    if (i === undefined) return ABSENT;
    const code = series[i].charCodeAt(j) - 48;
    return (code >= 0 && code < classList.length) ? code : ABSENT;
  }

  /**
   * Every county with a class in one week.
   *
   * ONE linear pass over the series strings, and deliberately NOT memoized:
   * there are 1,389 weeks and a scrubbed slider would visit hundreds of them,
   * so a per-week cache is a slow memory leak that buys nothing — the pass
   * itself is ~3,200 charCodeAt calls, which is well under a frame.
   *
   * Counties absent from the week are OMITTED, never entered as 0: see the
   * header on why '.' is not None.
   *
   * @param {number} j absolute week index
   * @returns {Map<string, number>} FIPS id → class code 0–5
   */
  function classesFor(j) {
    const out = new Map();
    if (!Number.isInteger(j) || j < 0 || j >= weeks) return out;
    const top = classList.length;
    for (let i = 0; i < series.length; i++) {
      const code = series[i].charCodeAt(j) - 48;
      if (code >= 0 && code < top) out.set(countyList[i], code);
    }
    return out;
  }

  /** @returns {string[]} the class dictionary: None, D0 … D4. */
  function classes() {
    return classList.slice();
  }

  /** @returns {number[]} every calendar year the record reaches, ascending. */
  function years() {
    return yearList.slice();
  }

  /** @returns {number} the last week the record holds. */
  function latestWeek() {
    return weeks - 1;
  }

  /**
   * @param {string} id 5-character FIPS string
   * @returns {{county: string, state: string}|null} null for an id that is not
   *          in this payload at all.
   *
   * The name can be an EMPTY STRING and that is data, not a bug: the
   * NDMC-reported archive carries Connecticut's nine planning regions with no
   * county name at all. Callers print the id when the name is blank.
   */
  function countyName(id) {
    const i = countyIdx.get(String(id));
    if (i === undefined) return null;
    return { county: payload.county_names[i], state: payload.state_names[i] };
  }

  /** @returns {string[]} every county id in the DATA, in its own key space
   *  (Census FIPS for all three archives). */
  function allCountyIds() {
    return countyList.slice();
  }

  /** @returns {object} a small metadata summary — the indexes stay private. */
  function meta() {
    return {
      schema: payload.schema,
      dataset: payload.dataset,
      license: payload.license,
      n: payload.n,
      weeks,
      week0: payload.week0,
      classes: classList.slice(),
      counties: countyList.length,
      years: yearList.slice(),
      keySpace: 'fips',
      nominalYears: false,
    };
  }

  return Object.freeze({
    weeks,
    weekDate,
    weekLabel,
    weekRange,
    weekOfYear,
    years,
    latestWeek,
    classCodeAt,
    classesFor,
    classes,
    countyName,
    allCountyIds,
    meta,
    /* The descriptor facts, carried on the instance like ngp-web.js's: every
       USDM archive is keyed by Census FIPS and every one of them is a real time
       series, so these are constants rather than options. */
    keySpace: 'fips',
    nominalYears: false,
    dataset: payload.dataset,
  });
}
