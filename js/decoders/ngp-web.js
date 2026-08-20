/* ============================================================================
   LFP Explorer · js/decoders/ngp-web.js
   The `fsa-ngp-web/1` decoder: one packed payload in, one frozen instance of
   O(1) lookups out.

   ES module, no build step. This file has no imports at all beyond the slug
   helper — it is pure decoding, so it runs under node as readily as in the
   browser.

   This IS js/data.js's old body, lifted into an INSTANCE FACTORY. Nothing about
   the decoding changed; what changed is that there can now be more than one of
   it at a time. js/data.js is a thin facade over whichever instance the app is
   currently reading (see its header), and every satellite module keeps working
   through that facade unchanged.

   ── The payload ────────────────────────────────────────────────────────────
   Schema `fsa-ngp-web/1` (FROZEN), built and committed by an archive repo and
   fetched at runtime from its own same-origin Pages copy:

     scalars      schema, license, year0, n
     years        [firstProgramYear, lastProgramYear] — a RANGE, not a list
     dictionaries types[] · counties[] · county_names[] · state_names[]
                  (the three county arrays are index-aligned)
     rows         type[] county[] year[] sy[] ey[] so[] eo[]  — parallel arrays,
                  n entries each, sorted by (type, county, year)

   Three encodings in those rows deserve to be said out loud:

     · `type[i]` and `county[i]` are INDEXES into the dictionaries. The county
       dictionary holds 5-CHARACTER STRINGS ("01001"), and this module never
       parses one as a number — leading zeros are eight whole states, and FSA
       codes are not FIPS codes (kit AGENTS.md §10).
     · `year[i]` is an OFFSET from `year0`. The program year is year0 + year[i].
     · `so[i]` / `eo[i]` are year offsets of the start/end date RELATIVE TO THE
       PROGRAM YEAR. A winter forage type can start in the calendar year before
       its program year (so = −1) and end in the one after (eo = +1). Today's
       data uses {−1, 0} and {−1, 0, +1}; nothing here hardcodes those domains,
       because next year's data may not.

   ── Two payloads, one schema: keySpace and nominalYears ────────────────────
   TWO archives publish this schema, and they are not interchangeable:

     fsa-normal-grazing-period      keySpace 'fsa'   year0 2008, 16 types
       FSA's own reported periods, keyed by 5-character FSA county code.
     nclimgrid-normal-grazing-period keySpace 'fips' year0 2001, 3 seasons
       What NAP-190's method yields from 1991–2020 climate normals, keyed by
       5-character COUNTY FIPS code, with NOMINAL years: the payload declares
       years [2001, 2001] because a climatology has no program year at all.

   `keySpace` is carried on the instance rather than acted on here: this
   decoder's job is to say faithfully what the payload says, and turning FIPS
   keys into paintable FSA keys is the interface descriptor's job, through
   js/decoders/crosswalk.js. `nominalYears` IS acted on here, in exactly one
   place: getYearType() ignores the year it is asked for and answers with the
   payload's single year, so the app's shared year slider can sit at 2026 while
   a climatology paints. years() still reports what the payload really carries.

   ── Dates are UTC, always ──────────────────────────────────────────────────
   Every Date in this module is built with Date.UTC and read back through a
   UTC-pinned Intl formatter. NEVER use a local-time getter (getFullYear,
   getMonth, getDate, toLocaleDateString without timeZone) on these values: a
   day-of-year 1 date built at UTC midnight is December 31 of the PREVIOUS YEAR
   for every reader west of Greenwich, which silently shifts a grazing period
   into the wrong program year for most of the United States.
   ========================================================================== */

import { typeSlug } from './common.js';

const MS_PER_WEEK = 604800000;

/** One formatter for the whole module — constructing an Intl.DateTimeFormat is
    the expensive half of formatting, and a per-row construction would rebuild
    it 3,000 times per repaint. timeZone: 'UTC' is not optional here (see the
    header). Shape: "Apr 15, 2026". */
const LABEL_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
});

/**
 * @typedef {object} Rec
 * @property {string} id             5-character county id, in the instance's
 *                                   own keySpace ('fsa' or 'fips')
 * @property {number} year           PROGRAM year (not a calendar year)
 * @property {string} type           pasture type / season name
 * @property {Date}   start          UTC midnight of the season start
 * @property {Date}   end            UTC midnight of the season end
 * @property {number} start_yday     day of year 1–366, in the start's own year
 * @property {number} end_yday       day of year 1–366, in the end's own year
 * @property {number} duration_weeks whole weeks from start to end
 * @property {string} startLabel     "Apr 15, 2026"
 * @property {string} endLabel       "Nov 30, 2026"
 */

/**
 * Decode and index one `fsa-ngp-web/1` payload.
 *
 * @param {object} payload the parsed JSON, already schema-checked by
 *        js/decoders/common.js loadDataset()
 * @param {{id?: string, url?: string, keySpace?: 'fsa'|'fips',
 *          nominalYears?: boolean}} [ds] the dataset descriptor that asked
 * @returns {Readonly<object>} a frozen instance: getYearType, getCountySeries,
 *          years, types, typeFromSlug, countyName, allCountyIds, meta, plus
 *          the descriptor facts keySpace / nominalYears / nominalYear.
 */
export function makeNgpData(payload, ds = {}) {
  /* Which file this is, for every message below. With two payloads sharing one
     schema, "which one failed" is the first thing a reader needs. */
  const where = ds.url || ds.id || 'fsa-ngp-web/1 payload';
  const keySpace = ds.keySpace === 'fips' ? 'fips' : 'fsa';
  const nominalYears = !!ds.nominalYears;
  /* The word for a malformed id in warnings. Same 5-digit test either way —
     what differs is which archive a broken id would fail to join to. */
  const keyWord = keySpace === 'fips' ? 'FIPS' : 'FSA';

  /* ── Structure ─────────────────────────────────────────────────────────── */

  const n = payload.n;
  const cols = ['type', 'county', 'year', 'sy', 'ey', 'so', 'eo'];
  for (const key of cols) {
    const col = payload[key];
    if (!Array.isArray(col) || col.length !== n) {
      throw new Error('[ngp/data] ' + where + ': column ' + JSON.stringify(key)
        + ' is not an array of length n=' + n + ' (got ' + (col && col.length) + ').');
    }
  }
  if (!Array.isArray(payload.counties) || !Array.isArray(payload.types)) {
    throw new Error('[ngp/data] ' + where
      + ': payload is missing the types/counties dictionaries.');
  }
  if (payload.county_names.length !== payload.counties.length
      || payload.state_names.length !== payload.counties.length) {
    throw new Error('[ngp/data] ' + where
      + ': county_names/state_names are not aligned with counties.');
  }

  const raw = payload;
  const year0 = payload.year0;
  const typeList = payload.types.slice();
  // String(), not a coercion: the dictionary already holds 5-character strings.
  // This documents the type and makes an accidental numeric id in a future
  // payload fail loudly at the shape check below instead of quietly.
  const countyList = payload.counties.map((id) => String(id));

  const typeIndex = new Map(typeList.map((t, i) => [t, i]));
  const countyIdx = new Map(countyList.map((id, i) => [id, i]));

  const malformed = countyList.filter((id) => !/^[0-9]{5}$/.test(id));
  if (malformed.length) {
    console.warn('[ngp/data] ' + where + ': ' + malformed.length + ' county id(s) '
      + 'are not 5-character ' + keyWord + ' strings — joins to the boundary '
      + 'archives will miss: ' + malformed.slice(0, 5).join(', '));
  }

  // years[] is a [first, last] RANGE in the payload; expand it to the list the
  // UI actually wants, then check it against what the rows really contain.
  const [firstYear, lastYear] = payload.years;
  const yearList = [];
  for (let y = firstYear; y <= lastYear; y++) yearList.push(y);

  /* The one year a nominal payload has. A climatology answers every year with
     the same periods; asserting that it really only ships one keeps a future
     multi-year climatology from being silently collapsed onto its first. */
  const nominalYear = yearList.length ? yearList[0] : year0;
  if (nominalYears && yearList.length !== 1) {
    console.warn('[ngp/data] ' + where + ': declared nominalYears, but the payload '
      + 'carries ' + yearList.length + ' years (' + firstYear + '–' + lastYear
      + ') — every lookup will answer with ' + nominalYear + '.');
  }

  /* ── Row indexes ───────────────────────────────────────────────────────────
     One pass over the rows recording, for each type and each (type, county),
     the half-open row range it occupies. The payload is sorted by
     (type, county, year), so every such group is CONTIGUOUS and a range is all
     the index a lookup needs — no per-row objects, no per-row Map entries,
     ~50k small arrays instead of 245k of anything.

     The contiguity assumption is checked rather than trusted: a re-sorted
     future payload would otherwise silently truncate every county series. */

  const typeRanges = [];
  const seriesRanges = new Map();
  {
    const types = raw.type;
    const counties = raw.county;
    let lastKey = null;
    let broken = 0;

    for (let i = 0; i < n; i++) {
      const t = types[i];
      const range = typeRanges[t];
      if (range === undefined) typeRanges[t] = [i, i + 1];
      else range[1] = i + 1;

      const key = t + '|' + counties[i];
      const seen = seriesRanges.get(key);
      if (seen === undefined) {
        seriesRanges.set(key, [i, i + 1]);
      } else {
        if (key !== lastKey) broken++;   // group re-opened: rows are not sorted
        seen[1] = i + 1;
      }
      lastKey = key;
    }

    if (broken) {
      console.warn('[ngp/data] ' + where + ': ' + broken + ' (type, county) '
        + 'group(s) are not contiguous — the payload is not sorted by '
        + '(type, county, year) and county series will be wrong.');
    }
  }

  let minOff = Infinity;
  let maxOff = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = raw.year[i];
    if (y < minOff) minOff = y;
    if (y > maxOff) maxOff = y;
  }
  if (n && (year0 + minOff !== firstYear || year0 + maxOff !== lastYear)) {
    console.warn('[ngp/data] ' + where + ': declared year range ' + firstYear
      + '–' + lastYear + ' disagrees with the rows (' + (year0 + minOff) + '–'
      + (year0 + maxOff) + ').');
  }

  /* Slug ⇄ type, built once and checked for collisions: two types that slugged
     to the same string would make ?type= ambiguous, and the URL is the app's
     primary state. */
  const slugToType = new Map();
  for (const t of typeList) {
    const slug = typeSlug(t);
    if (slugToType.has(slug)) {
      console.warn('[ngp/data] ' + where + ': slug collision on '
        + JSON.stringify(slug) + ': ' + JSON.stringify(slugToType.get(slug))
        + ' and ' + JSON.stringify(t));
      continue;
    }
    slugToType.set(slug, t);
  }

  /* ── Memo caches, per instance ─────────────────────────────────────────── */

  const yearTypeCache = new Map(); // `${year}|${typeIdx}` → Map<id, Rec>
  const seriesCache = new Map();   // `${typeIdx}|${countyIdx}` → Rec[]

  /* ── Records ───────────────────────────────────────────────────────────── */

  /**
   * Build the record for row `i`.
   *
   * Date.UTC(year, 0, dayOfYear) is the idiomatic day-of-year constructor:
   * month 0 with a day past 31 rolls forward through the calendar, and it gets
   * leap years right for free (yday 60 is Feb 29 in 2024 and Mar 1 in 2025).
   */
  function makeRec(i) {
    const year = year0 + raw.year[i];
    const id = countyList[raw.county[i]];
    const sy = raw.sy[i];
    const ey = raw.ey[i];
    const start = new Date(Date.UTC(year + raw.so[i], 0, sy));
    const end = new Date(Date.UTC(year + raw.eo[i], 0, ey));
    return {
      id,
      year,
      type: typeList[raw.type[i]],
      start,
      end,
      start_yday: sy,
      end_yday: ey,
      // Whole weeks, floored: "33 weeks" reads as a period the reader can
      // count, and a fractional week on a program date is noise.
      duration_weeks: Math.floor((end - start) / MS_PER_WEEK),
      startLabel: LABEL_FMT.format(start),
      endLabel: LABEL_FMT.format(end),
    };
  }

  /* ── Lookups ───────────────────────────────────────────────────────────── */

  /**
   * Every county with a reported period for one (program year, pasture type).
   * Memoized: the returned Map is the instance's own and is handed out by
   * reference — READ IT, never mutate it.
   *
   * On a nominalYears instance the requested year is IGNORED (a climatology is
   * the same in every program year), so every year shares one cache entry.
   *
   * @param {number} year program year
   * @param {string} type pasture type / season name
   * @returns {Map<string, Rec>} keyed by 5-character county id in this
   *          instance's keySpace (empty when the combination has no rows, or
   *          the type is unknown)
   */
  function getYearType(year, type) {
    const t = typeIndex.get(type);
    if (t === undefined) return new Map();

    const y = nominalYears ? nominalYear : year;
    const key = y + '|' + t;
    const hit = yearTypeCache.get(key);
    if (hit) return hit;

    const out = new Map();
    const range = typeRanges[t];
    const offset = y - year0;
    if (range) {
      // Scans one type's rows (~15k), not the whole payload (245k).
      for (let i = range[0]; i < range[1]; i++) {
        if (raw.year[i] === offset) out.set(countyList[raw.county[i]], makeRec(i));
      }
    }
    yearTypeCache.set(key, out);
    return out;
  }

  /**
   * One county's reported periods for one pasture type, every year present in
   * the data, ascending. Years with no reported period are ABSENT rather than
   * null-filled — a gap in this array is a real fact about FSA's reporting, and
   * the consumer (the card's span chart) draws it as a gap. A nominal payload
   * has exactly one entry here, which is the truth about a climatology.
   *
   * @param {string} id 5-character county id in this instance's keySpace
   * @param {string} type
   * @returns {Rec[]} shared, memoized — read, never mutate
   */
  function getCountySeries(id, type) {
    const t = typeIndex.get(type);
    const c = countyIdx.get(String(id));
    if (t === undefined || c === undefined) return [];

    const key = t + '|' + c;
    const hit = seriesCache.get(key);
    if (hit) return hit;

    const range = seriesRanges.get(key);
    const out = [];
    if (range) for (let i = range[0]; i < range[1]; i++) out.push(makeRec(i));
    // Sorted by (type, county, year) upstream, so this is already ascending;
    // the sort is a cheap guarantee for a consumer that reads out[0] as
    // "earliest".
    out.sort((a, b) => a.year - b.year);
    seriesCache.set(key, out);
    return out;
  }

  /** @returns {number[]} every program year the PAYLOAD carries, ascending —
   *  [2001] for a climatology, not the app's year domain. */
  function years() {
    return yearList.slice();
  }

  /** @returns {string[]} the pasture types / seasons, in the payload's own
   *  sort order. */
  function types() {
    return typeList.slice();
  }

  /**
   * URL slug → type name, or null for anything not in this payload's
   * dictionary. The dictionary IS the whitelist, and it differs per dataset:
   * `full-season` resolves on the climatology and not on FSA's own types.
   *
   * @param {string} slug
   * @returns {string|null}
   */
  function typeFromSlug(slug) {
    if (slug == null) return null;
    return slugToType.get(String(slug).toLowerCase()) || null;
  }

  /**
   * @param {string} id 5-character county id in this instance's keySpace
   * @returns {{county: string, state: string}|null} null for an id that is not
   *          in the data at all (which is different from an id with no polygon).
   */
  function countyName(id) {
    const i = countyIdx.get(String(id));
    if (i === undefined) return null;
    return { county: raw.county_names[i], state: raw.state_names[i] };
  }

  /** @returns {string[]} every county id in the DATA — including, on the FSA
   *  payload, the island territories, which have no polygon in either boundary
   *  archive. */
  function allCountyIds() {
    return countyList.slice();
  }

  /** @returns {{schema: string, license: string, n: number, years: number[],
   *             types: string[], keySpace: string, nominalYears: boolean}}
   *          a small metadata summary — the indexes themselves stay private. */
  function meta() {
    return {
      schema: raw.schema,
      license: raw.license,
      n: raw.n,
      years: yearList.slice(),
      types: typeList.slice(),
      keySpace,
      nominalYears,
    };
  }

  return Object.freeze({
    getYearType,
    getCountySeries,
    years,
    types,
    typeFromSlug,
    countyName,
    allCountyIds,
    meta,
    keySpace,
    nominalYears,
    nominalYear,
  });
}
