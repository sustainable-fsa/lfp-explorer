/* ============================================================================
   LFP Explorer · js/decoders/lfp-eligibility.js
   The `fsa-lfp-eligibility/1` decoder: one packed payload of qualifying drought
   events in, one frozen instance of memoized reductions out.

   ES module, no build step. Imports only the two assertions from ./common.js,
   which are pure — so this file decodes in node as readily as in the browser.

   ── The payload ────────────────────────────────────────────────────────────
   Schema `fsa-lfp-eligibility/1` (FROZEN), built and committed by an archive
   repo and fetched at runtime from its own same-origin Pages copy. THREE
   archives publish it, and they answer three different questions — see the
   descriptor (js/interfaces/eligibility.js):

     fsa-lfp-eligibility          FSA's own determinations, obtained by FOIA
     fsa-lfp-eligibility-web      FSA's weekly public web tables
     fsa-lfp-eligibility-derived  the same ladder recomputed from the USDM,
                                  under four county-aggregation conventions

   All three declare the same schema AND the same `year0`, so the tripwire that
   tells them apart is `dataset`, checked here against the descriptor's
   `expectedDataset` (js/decoders/common.js § assertExpectations explains why a
   schema string is not an identity).

     scalars       schema, dataset, license, year0, n
     dictionaries  years[2] (min, max) · types[15] · events[5 or 7] ·
                   counties[] (FSA) · fips_codes[] (Census) · sources[4]
                   (derived only)
     columns       type county fips year event qy qo df, all length n, plus
                   mepm + pf (official/web) or source (derived)

   ── One row is ONE QUALIFYING EVENT ────────────────────────────────────────
   Not one determination: a county whose drought deepened through the season
   carries a row per tier as it was reached (D2, then D3a, then D3b …). Every
   surface in the app therefore reduces — to the BEST event of the year, by one
   comparator, used by the paint, the card and the table alike (see bestOf()).

   ── The two county keys, and why both dictionaries are here ────────────────
   An LFP determination needs two counties: the grazing period is set per FSA
   county (the administrative unit) and drought triggers "in any area of the
   county" as a CENSUS county (the unit the USDM is aggregated to). The two do
   not nest in either direction, so the archives key every row on BOTH and never
   combine them.

   MEASURED, and the reason `county[]` and `fips[]` are separate index columns
   into separate dictionaries: on the official payload `counties` holds 2,829
   FSA ids and `fips_codes` 2,822 Census ids, and 82,486 of 105,719 rows have a
   different index in each. Reading `fips[i]` against `counties[]` would name a
   different county on four rows in five.

   The MAP is drawn on FSA counties, so `keySpace` is 'fsa' and nothing here
   goes through the FIPS crosswalk. The Census key is provenance: the card
   prints it, and officesFor() answers "do several FSA offices share this Census
   county?" — which is the whole Nye County story.

   ── Dates are UTC, and some are absent ─────────────────────────────────────
   `qy` is the day of the year and `qo` the year offset (0, or −1 for a tier
   satisfied in the calendar year before the program year), so the qualifying
   date is `Date.UTC(year0 + year[i] + qo[i], 0, qy[i])` — day-of-year
   arithmetic Date.UTC does for us, and UTC midnight throughout. NEVER read one
   back with a local-time getter: west of Greenwich that is the previous day.

   `qy`/`qo` are NULL on 2,839 official rows, all of them program years
   2008–2011: that era came from a different FOIA response, which reports when
   the drought BEGAN rather than when a tier was satisfied, so for the D2 and
   D3b tiers no satisfaction date is recoverable. An undated event is a real
   qualifying event, and the app says so in words rather than dropping it.

   ── months is PAYMENT months, never the drought factor ─────────────────────
   `df` is the monthly payments a tier earns under the ladder in force. `mepm`
   is FSA's cap, a function of the grazing period's length. `pf` is the payable
   figure, min(df, mepm). The official and web payloads carry all three; the
   derived payload carries only `df`, uncapped, because the cap follows from the
   grazing period alone and that archive does not apply it.

   So `months` on a Rec is `pf` where a payload has one (NULL where FSA
   reported none — 14,064 web rows, again 2008–2011) and `df` where it does
   not. It is NEVER df on a payload that has pf: an uncapped drought factor
   shown as payment months would overstate the award. `hasPayments` is how a
   consumer tells the two cases apart, and the legend says which it is looking
   at.
   ========================================================================== */

import { assertExpectations, assertSchema } from './common.js';

const MS_PER_DAY = 86400000;

/** The schema this decoder reads. */
export const ELIGIBILITY_SCHEMA = 'fsa-lfp-eligibility/1';

/**
 * The "every pasture type at once" sentinel, for getYearType/getCountySeries.
 *
 * A STRING rather than a Symbol because it is also a `<select>` value and a URL
 * slug (`?type=all-types`), and it is deliberately not one of the fifteen names
 * the dictionary holds, so it cannot collide with a real type. The reduction it
 * asks for is the same one every other surface makes — the best event of the
 * year — taken across all fifteen dictionaries at once, which is the worst case
 * a county reached that year whatever it grazed.
 */
export const ALL_TYPES = 'All types';

/** One formatter for the module — constructing an Intl.DateTimeFormat is the
    expensive half of formatting. timeZone: 'UTC' is not optional (see the
    header). Shape: "Jul 24, 2012". */
const LABEL_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
});

/** How many (year, type, source) reductions to keep. The map is INSERTION
    ORDERED, so the oldest key is the first one out — a dragged year slider
    cannot grow this without bound, and a reader sweeping back and forth over a
    decade still pays for each year once. */
const MEMO_MAX = 48;

/** Where a null month count sorts: below one month, above nothing. An event
    with no stated month count still qualified the county. */
const NO_MONTHS = 0;

/**
 * The better of two events, and the ONE rule the whole interface reduces by.
 *
 * More payment months first — that is the number the program pays on. Then the
 * higher drought factor, which breaks ties between a capped 5 and an uncapped
 * one. Then the EARLIEST qualifying date, because the first tier that qualified
 * the county is the one a reader is looking for; an undated event sorts last
 * there rather than first, so a dated event is never displaced by one whose
 * date the record does not carry. Then the lower event index, which makes the
 * answer deterministic in any browser, in any session.
 *
 * @param {object} a a Rec
 * @param {object} b a Rec
 * @returns {number} < 0 when `a` is the better event
 */
export function compareRecs(a, b) {
  const am = a.months == null ? NO_MONTHS : a.months;
  const bm = b.months == null ? NO_MONTHS : b.months;
  if (am !== bm) return bm - am;
  if (a.df !== b.df) return b.df - a.df;
  const at = a.date ? +a.date : Infinity;
  const bt = b.date ? +b.date : Infinity;
  if (at !== bt) return at - bt;
  return a.eventIdx - b.eventIdx;
}

/**
 * The best event of a list, by compareRecs. Returns one of the Recs it was
 * handed and never builds a new one: a card showing one event's date beside
 * another's month count would describe a determination that does not exist.
 *
 * @param {object[]} recs at least one Rec
 * @returns {object} one of them
 */
export function bestOf(recs) {
  let best = recs[0];
  for (let i = 1; i < recs.length; i++) {
    if (compareRecs(recs[i], best) < 0) best = recs[i];
  }
  return best;
}

/**
 * Decode and index one `fsa-lfp-eligibility/1` payload.
 *
 * @param {object} payload the parsed JSON (loadDataset has already checked the
 *        schema and the expectations; both are re-checked here so a direct
 *        call — a smoke test, a node script — is just as safe)
 * @param {{id?: string, url?: string, expectedDataset?: string,
 *          expect?: object}} [ds] the dataset descriptor
 * @returns {Readonly<object>} a frozen instance
 */
export function makeEligibilityData(payload, ds = {}) {
  const where = ds.url || ds.id || ELIGIBILITY_SCHEMA + ' payload';

  assertSchema(payload, ELIGIBILITY_SCHEMA, where);
  assertExpectations(payload, ds.expect, where);

  /* Which of the three archives this is. The check the schema cannot make: all
     three declare the same schema and the same year0, and the only symptom of a
     swapped URL is a map that is subtly, invisibly wrong. */
  if (ds.expectedDataset && payload.dataset !== ds.expectedDataset) {
    throw new Error('[ngp/elig] ' + where + ': expected dataset '
      + JSON.stringify(ds.expectedDataset) + ', got '
      + JSON.stringify(payload.dataset) + ' — this is one of the OTHER LFP '
      + 'eligibility archives, which answers a different question.');
  }

  /* ── Structure ─────────────────────────────────────────────────────────── */

  const n = payload.n;
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('[ngp/elig] ' + where + ': n is ' + JSON.stringify(n)
      + ', which is not a row count.');
  }
  const year0 = payload.year0;
  if (!Number.isInteger(year0)) {
    throw new Error('[ngp/elig] ' + where + ': year0 is '
      + JSON.stringify(year0) + ', which is not a program year.');
  }

  for (const key of ['years', 'types', 'events', 'counties', 'fips_codes']) {
    if (!Array.isArray(payload[key])) {
      throw new Error('[ngp/elig] ' + where + ': ' + JSON.stringify(key)
        + ' is missing or not an array.');
    }
  }
  if (payload.years.length !== 2 || !(payload.years[0] <= payload.years[1])) {
    throw new Error('[ngp/elig] ' + where + ': years is '
      + JSON.stringify(payload.years) + ', not an ascending [first, last].');
  }

  /* The columns, every one of them n long. A short column is the one defect
     that would otherwise read as data: `undefined` decodes to NaN, and a NaN
     drought factor paints a county the no-data grey while the row count still
     says the record is there. */
  const COLUMNS = ['type', 'county', 'fips', 'year', 'event', 'qy', 'qo', 'df'];
  const hasPayments = Array.isArray(payload.pf);
  const hasSources = Array.isArray(payload.source);
  if (hasPayments) COLUMNS.push('mepm', 'pf');
  if (hasSources) COLUMNS.push('source');
  for (const key of COLUMNS) {
    if (!Array.isArray(payload[key]) || payload[key].length !== n) {
      throw new Error('[ngp/elig] ' + where + ': column ' + JSON.stringify(key)
        + ' is ' + (Array.isArray(payload[key]) ? payload[key].length + ' long'
          : 'missing or not an array') + ', not the declared n = ' + n + '.');
    }
  }
  if (hasPayments !== Array.isArray(payload.mepm)) {
    throw new Error('[ngp/elig] ' + where + ': a payload with payment factors '
      + 'must carry the cap they are computed from — pf is '
      + (hasPayments ? 'present' : 'absent') + ' and mepm is '
      + (Array.isArray(payload.mepm) ? 'present' : 'absent') + '.');
  }
  if (hasSources && !Array.isArray(payload.sources)) {
    throw new Error('[ngp/elig] ' + where + ': the source column has no '
      + '`sources` dictionary to read it against.');
  }

  // String(), not a coercion: both dictionaries already hold 5-character
  // strings. This documents the type and makes a numeric id in a future payload
  // fail the shape check below rather than joining to nothing quietly.
  const countyList = payload.counties.map((id) => String(id));
  const fipsList = payload.fips_codes.map((id) => String(id));
  const typeList = payload.types.slice();
  const eventList = payload.events.slice();
  const sourceList = hasSources ? payload.sources.slice() : [];

  for (const [label, list] of [['counties', countyList], ['fips_codes', fipsList]]) {
    const bad = list.filter((id) => !/^[0-9]{5}$/.test(id));
    if (bad.length) {
      console.warn('[ngp/elig] ' + where + ': ' + bad.length + ' ' + label
        + ' id(s) are not 5-character strings — a leading zero has probably been '
        + 'lost somewhere upstream: ' + bad.slice(0, 5).join(', '));
    }
  }

  /* Every index column points inside its own dictionary. Checked once here so
     no lookup below has to defend itself. */
  const bounds = [
    ['type', payload.type, typeList.length],
    ['county', payload.county, countyList.length],
    ['fips', payload.fips, fipsList.length],
    ['event', payload.event, eventList.length],
  ];
  if (hasSources) bounds.push(['source', payload.source, sourceList.length]);
  for (const [label, col, size] of bounds) {
    for (let i = 0; i < n; i++) {
      const v = col[i];
      if (!Number.isInteger(v) || v < 0 || v >= size) {
        throw new Error('[ngp/elig] ' + where + ': ' + label + '[' + i + '] is '
          + JSON.stringify(v) + ', outside its ' + size + '-entry dictionary.');
      }
    }
  }

  const typeIdx = new Map(typeList.map((t, i) => [t, i]));
  const countyIdxOf = new Map(countyList.map((id, i) => [id, i]));
  const sourceIdxOf = new Map(sourceList.map((s, i) => [s, i]));

  /* ── Row ranges by pasture type ────────────────────────────────────────────
     MEASURED: the payload is grouped by type (the `type` column is
     non-decreasing on all three archives), so one named type is a contiguous
     row range and a reduction for it never touches the other fourteen. Within a
     type the rows are grouped by county too, which is what makes one county's
     whole history a binary search rather than a scan (rangeFor()).

     Verified rather than assumed: a payload that arrived in another order would
     make every lookup below silently partial, so the grouping is checked and a
     violation is a hard failure. */
  const typeStart = new Int32Array(typeList.length + 1).fill(-1);
  {
    let prev = -1;
    for (let i = 0; i < n; i++) {
      const t = payload.type[i];
      if (t < prev) {
        throw new Error('[ngp/elig] ' + where + ': the type column is not '
          + 'grouped (row ' + i + ' is type ' + t + ' after type ' + prev
          + ') — every index in this decoder assumes it is.');
      }
      if (t !== prev) {
        for (let k = prev + 1; k <= t; k++) typeStart[k] = i;
        prev = t;
      }
    }
    // Every remaining boundary — including the sentinel past the last type —
    // is the end of the column. A type with no rows anywhere therefore gets an
    // empty range rather than a −1, and typeRange() needs no special case.
    for (let k = prev + 1; k <= typeList.length; k++) typeStart[k] = n;
  }

  /** The half-open row range [lo, hi) of one pasture type. */
  function typeRange(t) {
    return [typeStart[t], typeStart[t + 1]];
  }

  /**
   * The half-open row range of one county WITHIN one type's rows, by binary
   * search on the grouped `county` column. Empty ([x, x]) when this type has no
   * row for the county at all.
   */
  function rangeFor(t, countyIndex) {
    const [lo, hi] = typeRange(t);
    let a = lo;
    let b = hi;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (payload.county[mid] < countyIndex) a = mid + 1; else b = mid;
    }
    let c = a;
    let d = hi;
    while (c < d) {
      const mid = (c + d) >> 1;
      if (payload.county[mid] <= countyIndex) c = mid + 1; else d = mid;
    }
    return [a, c];
  }

  /* ── Records ───────────────────────────────────────────────────────────── */

  /**
   * One row as a Rec. Built on demand — the payload is up to 452,114 rows and
   * materialising all of them would cost tens of megabytes for a reader who
   * looks at one year.
   *
   * @param {number} i row index
   * @returns {object} frozen? No: the reductions hand these straight to the
   *          card and the table, which only read them, and freezing 30,000
   *          objects per year change is measurable where the guarantee is not.
   */
  function recAt(i) {
    const qy = payload.qy[i];
    const qo = payload.qo[i];
    const year = year0 + payload.year[i];
    // Day-of-year arithmetic Date.UTC does for us: day 366 of a common year
    // rolls into January 1 of the next, which is what the archive means by it.
    const date = (qy == null || qo == null)
      ? null : new Date(Date.UTC(year + qo, 0, qy));
    const pf = hasPayments ? payload.pf[i] : null;
    const df = payload.df[i];
    return {
      id: countyList[payload.county[i]],
      fips: fipsList[payload.fips[i]],
      year,
      type: typeList[payload.type[i]],
      event: eventList[payload.event[i]],
      /** The dictionary index, for compareRecs's last tie-break. */
      eventIdx: payload.event[i],
      date,
      dateLabel: date ? LABEL_FMT.format(date) : null,
      df,
      mepm: hasPayments ? payload.mepm[i] : null,
      pf,
      /* PAYMENT months where the archive has them, the drought factor where it
         does not — never one dressed as the other. See the header. */
      months: hasPayments ? pf : df,
      source: hasSources ? sourceList[payload.source[i]] : null,
    };
  }

  /* ── The reductions, memoized ──────────────────────────────────────────── */

  const yearTypeMemo = new Map();
  const seriesMemo = new Map();

  /** Bounded insertion-order cache: the oldest key leaves when the map is
      full. See MEMO_MAX. */
  function remember(memo, key, value) {
    if (memo.size >= MEMO_MAX) {
      const oldest = memo.keys().next();
      if (!oldest.done) memo.delete(oldest.value);
    }
    memo.set(key, value);
    return value;
  }

  function sourceKey(sourceIndex) {
    return Number.isInteger(sourceIndex) ? String(sourceIndex) : '';
  }

  /** Does this row belong to the requested source? Always true for a payload
      with no source column, so one code path serves all three archives. */
  function inSource(i, sourceIndex) {
    return !hasSources || !Number.isInteger(sourceIndex)
      || payload.source[i] === sourceIndex;
  }

  /**
   * Every county's events and best event for one program year and one pasture
   * type — the reduction the paint, the card and the table all read.
   *
   * @param {number} year a program year
   * @param {string} typeOrAll a type name, or ALL_TYPES for the per-county best
   *        across every type (the worst case the county reached that year)
   * @param {number} [sourceIndex] which aggregation, on the derived payload
   *        only; ignored elsewhere
   * @returns {Map<string, {events: object[], best: object}>} keyed by FSA id
   */
  function getYearType(year, typeOrAll, sourceIndex) {
    const y = Number(year);
    const key = y + '|' + typeOrAll + '|' + sourceKey(sourceIndex);
    const hit = yearTypeMemo.get(key);
    if (hit) return hit;

    const out = new Map();
    const offset = y - year0;
    // A year outside the payload is an empty answer, not an error: the shared
    // year slider spans every family's domain.
    if (Number.isInteger(offset) && offset >= 0) {
      // A named type is one contiguous row range (see § Row ranges); the
      // sentinel is the whole column, which measures at ~4 ms on the 452,114-row
      // derived payload — paid once per (year, source) and then memoized.
      const ranges = typeOrAll === ALL_TYPES
        ? [[0, n]]
        : (typeIdx.has(typeOrAll) ? [typeRange(typeIdx.get(typeOrAll))] : []);
      for (const [lo, hi] of ranges) {
        for (let i = lo; i < hi; i++) {
          if (payload.year[i] !== offset) continue;
          if (!inSource(i, sourceIndex)) continue;
          const rec = recAt(i);
          const entry = out.get(rec.id);
          if (entry) {
            entry.events.push(rec);
            if (compareRecs(rec, entry.best) < 0) entry.best = rec;
          } else {
            out.set(rec.id, { events: [rec], best: rec });
          }
        }
      }
    }
    return remember(yearTypeMemo, key, out);
  }

  /**
   * One county's best event per program year, ascending. Years with no
   * qualifying event are ABSENT rather than present-and-empty — the card's chart
   * marks them as the ineligible years they are.
   *
   * @param {string} id a 5-character FSA county id
   * @param {string} typeOrAll a type name or ALL_TYPES
   * @param {number} [sourceIndex] derived payload only
   * @returns {object[]} Recs, ascending by year
   */
  function getCountySeries(id, typeOrAll, sourceIndex) {
    const key = String(id) + '|' + typeOrAll + '|' + sourceKey(sourceIndex);
    const hit = seriesMemo.get(key);
    if (hit) return hit;

    const countyIndex = countyIdxOf.get(String(id));
    const byYear = new Map();
    if (countyIndex !== undefined) {
      // Both cases are binary searches: the payload is grouped by type and, in
      // each type, by county, so the sentinel costs fifteen small ranges rather
      // than a scan of the whole column.
      const types = typeOrAll === ALL_TYPES
        ? typeList.map((_, t) => t)
        : (typeIdx.has(typeOrAll) ? [typeIdx.get(typeOrAll)] : []);
      for (const t of types) {
        const [lo, hi] = rangeFor(t, countyIndex);
        for (let i = lo; i < hi; i++) {
          if (!inSource(i, sourceIndex)) continue;
          const rec = recAt(i);
          const best = byYear.get(rec.year);
          if (!best || compareRecs(rec, best) < 0) byYear.set(rec.year, rec);
        }
      }
    }
    const out = Array.from(byYear.values()).sort((a, b) => a.year - b.year);
    return remember(seriesMemo, key, out);
  }

  /* ── The Census key ────────────────────────────────────────────────────── */

  /** fips id → the FSA offices that administer part of it, built on first ask.
      One pass over the county and fips columns; the answer is a fact about two
      dictionaries, not about any year, so it is built once. */
  let offices = null;

  function buildOffices() {
    offices = new Map();
    for (let i = 0; i < n; i++) {
      const fipsId = fipsList[payload.fips[i]];
      const fsaId = countyList[payload.county[i]];
      const seen = offices.get(fipsId);
      if (seen) { if (!seen.includes(fsaId)) seen.push(fsaId); } else offices.set(fipsId, [fsaId]);
    }
    for (const list of offices.values()) list.sort();
  }

  /**
   * Which FSA offices share one Census county — the Nye County question.
   *
   * Several FSA counties inside one Census county is the case that makes two
   * keys necessary: each office sets its own grazing period, so the same
   * drought can earn four payment months on one side of the county line and one
   * on the other.
   *
   * @param {string} fipsId a 5-character Census id
   * @returns {string[]} FSA ids, ascending; empty for an id not in this payload
   */
  function officesFor(fipsId) {
    if (!offices) buildOffices();
    const list = offices.get(String(fipsId));
    return list ? list.slice() : [];
  }

  /* ── Dictionaries ──────────────────────────────────────────────────────── */

  const yearList = [];
  for (let y = payload.years[0]; y <= payload.years[1]; y++) yearList.push(y);

  /** @returns {number[]} every program year the archive covers, ascending. The
      DOMAIN, not the years that happen to have events: a year with no
      qualifying county anywhere is still a year FSA published. */
  function years() {
    return yearList.slice();
  }

  /** @returns {string[]} the fifteen pasture types, as FSA names them. */
  function types() {
    return typeList.slice();
  }

  /** @returns {string[]} the tier codes this archive uses — FIVE on the
      official payload (D2 D3a D3b D4a D4b) and seven on the other two, which
      carry the P.L. 119-21 split of D2. Read from the payload, never assumed. */
  function events() {
    return eventList.slice();
  }

  /** @returns {string[]} the aggregation conventions, in payload order; empty
      for an archive that has only one. */
  function sources() {
    return sourceList.slice();
  }

  /** @param {string} source an aggregation name
   *  @returns {number} its column value, or −1 */
  function sourceIndex(source) {
    const i = sourceIdxOf.get(String(source));
    return i === undefined ? -1 : i;
  }

  /** @returns {string[]} every FSA county id in the data. */
  function allCountyIds() {
    return countyList.slice();
  }

  /**
   * The Census county of one event — provenance, not a join key.
   * @param {object} rec a Rec
   * @returns {string|null}
   */
  function fipsOf(rec) {
    return rec && rec.fips ? String(rec.fips) : null;
  }

  /** @returns {object} a small metadata summary — the indexes stay private. */
  function meta() {
    return {
      schema: payload.schema,
      dataset: payload.dataset,
      license: payload.license,
      n,
      year0,
      years: yearList.slice(),
      types: typeList.slice(),
      events: eventList.slice(),
      sources: sourceList.slice(),
      counties: countyList.length,
      fipsCodes: fipsList.length,
      hasPayments,
      keySpace: 'fsa',
      nominalYears: false,
    };
  }

  return Object.freeze({
    getYearType,
    getCountySeries,
    years,
    types,
    events,
    sources,
    sourceIndex,
    allCountyIds,
    officesFor,
    fipsOf,
    meta,
    /* The descriptor facts, carried on the instance like the other decoders':
       every eligibility archive is keyed by FSA county and every one is a real
       program-year series, so these are constants rather than options.
       `hasPayments` is the one that varies, and it is what tells a consumer
       whether `months` is FSA's payable figure or a recomputed drought
       factor. */
    keySpace: 'fsa',
    nominalYears: false,
    hasPayments,
    dataset: payload.dataset,
  });
}
