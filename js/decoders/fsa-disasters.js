/* ============================================================================
   LFP Explorer · js/decoders/fsa-disasters.js
   The `fsa-disasters/1` decoder: one packed payload of disaster designations
   in, one frozen instance of memoized slices out.

   ES module, no build step. Imports only the two assertions from ./common.js,
   which are pure — so this file decodes in node as readily as in the browser.

   ── The payload ────────────────────────────────────────────────────────────
   Schema `fsa-disasters/1` (FROZEN), built and committed by the fsa-disasters
   archive and fetched at runtime from its own Pages copy. ONE archive, and —
   uniquely in this app — TWO tables:

     declarations (n_decl 3,907)  decl_year decl_type decl_number
                                  decl_amendment decl_description decl_approval
                                  decl_begin decl_end
     county rows  (n 184,815)     decl (an index into the table above)
                                  disaster_type fips county_name state code

   The flat archive repeats every declaration's year, number, description and
   three dates once per county it names; this payload normalises that into a
   declaration table the county rows index. Everything is dictionary-coded:
   `years`, `decl_types`, `numbers`, `descriptions`, `disaster_types`,
   `fips_codes`, `county_names`, `states` and `codes` are lookup arrays and the
   record columns hold integer indices into them.

   ── One row is ONE (declaration × county × disaster type) ──────────────────
   A single declaration can name a county under several disaster types — the
   histogram runs to twelve — so a county's rows are not its declarations.
   MEASURED: there are no exact duplicate (declaration, county, disaster type,
   code) tuples, and 87 (declaration, county) pairs carry BOTH designation
   codes. Which is why every surface in the app reduces the same way: Primary
   beats Contiguous, within a county's rows and again across the FIPS → FSA
   crosswalk (js/interfaces/disasters.js).

   ── Dates are day counts, UTC-pinned, and often absent ─────────────────────
   Each of the three dates is an integer count of days since the payload's own
   `epoch` (1970-01-01), or null where FSA reports no date. So a date is
   `epochMs + days × 86,400,000`, which lands on UTC midnight, and it must be
   read back with UTC getters — west of Greenwich a local-time getter is the
   previous day. MEASURED on the 3,907 declarations: 2,146 have no end date, 5
   no begin date, 7 no approval date.

   FOUR approvals are NEGATIVE (−25,569 = 1899-12-30, the Excel serial zero).
   They are kept, exactly as they are — `approval` is that Date and
   `approvalDays` is that number — and `approvalReported` is false, so the
   presentation layer says "approval date not reported" rather than printing a
   date from the nineteenth century. latestApproval() ignores them for the same
   reason: "approved through 1899" is not a fact about this archive.

   One declaration (S5500, 2023) reports an END BEFORE ITS BEGIN. That is the
   archive's text and it is printed as such; nothing here reorders it.

   ── Junk is data ───────────────────────────────────────────────────────────
   The archive's own QA is visible in its dictionaries, and this decoder mirrors
   it rather than cleaning it (the archive README's § "Values verbatim,
   irregularities included"):

     years        17 entries, of which "0" and "2011, 2012" are not years. The
                  15 that are (2012–2026) are what years() returns; the other
                  two are counted in meta().junkYears, and the 94 county rows
                  behind them match NO clean year — so they are absent from
                  every slice, and therefore from the map and the table alike.
     fips_codes   3,306 entries, of which 72 are not 5-character county keys
                  ("0", "0010", "400", …: tribal areas and truncated codes).
                  They are KEPT in the slices: they fail the crosswalk
                  downstream, where they are counted out loud, and they carry
                  the archive's own text into the data table. 249 county rows
                  reference one.
     states       60 entries, including "0" and "Acoma"; county_names carries
                  entries like "Oglala Sioux Tribe, Cheyenne River Sioux".
                  Both reach the table verbatim — 394 FIPS keys carry more than
                  one spelling of a county name, so there is no per-key
                  gazetteer here and every ROW is labelled with its own text.

   The one thing junk must never do is silently match something clean, and the
   one thing this decoder must never do is drop it.
   ========================================================================== */

import { assertExpectations, assertSchema } from './common.js';

const MS_PER_DAY = 86400000;

/** The schema this decoder reads. */
export const DISASTERS_SCHEMA = 'fsa-disasters/1';

/** A year entry this app can put on a slider: exactly four digits, and inside
    a window no clerical accident lands in. Everything else — "0",
    "2011, 2012" — is junk by this definition, which is the whole definition
    (see § Junk is data). */
const CLEAN_YEAR_RE = /^[0-9]{4}$/;
const YEAR_FLOOR = 1900;
const YEAR_CEIL = 2200;

/** A well-formed county key: five digits, leading zeros intact. Ids are
    STRINGS end to end — no parse, no arithmetic, ever. */
const FIPS_RE = /^[0-9]{5}$/;

/** How the archive's own README filters this archive for drought, and therefore
    how the app does: a regular expression, not an equality test. Today
    `disaster_types` holds exactly one matching entry ("DROUGHT"), and the
    twenty-one others include "Heat, Excessive heat" and "Ground
    Saturation/Standing Water" — the day FSA adds "Drought, Excessive Heat"
    this keeps meaning what it means. */
const DROUGHT_RE = /DROUGHT/i;

/** One formatter for the module — constructing an Intl.DateTimeFormat is the
    expensive half of formatting. timeZone 'UTC' is not optional (see the
    header). Shape: "Jan 15, 2025". */
const LABEL_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
});

/** How many (year, declaration type, scope) slices to keep. Fifteen years × 2
    types × 2 scopes is 60 possible keys, so this holds every one a session can
    ask for and the eviction below is a safety net rather than a policy. */
const MEMO_MAX = 64;

/** The designation codes, as the archive spells them. Index = the payload's own
    code, and the ORDER is the precedence: Primary beats Contiguous. */
const PRIMARY = 'Primary';
const CONTIGUOUS = 'Contiguous';

/**
 * Decode and index one `fsa-disasters/1` payload.
 *
 * @param {object} payload the parsed JSON (loadDataset has already checked the
 *        schema and the expectations; both are re-checked here so a direct
 *        call — a smoke test, a node script — is just as safe)
 * @param {{id?: string, url?: string, expect?: object}} [ds] the dataset
 *        descriptor
 * @returns {Readonly<object>} a frozen instance
 */
export function makeDisastersData(payload, ds = {}) {
  const where = ds.url || ds.id || DISASTERS_SCHEMA + ' payload';

  assertSchema(payload, DISASTERS_SCHEMA, where);
  assertExpectations(payload, ds.expect, where);

  /* ── Structure ─────────────────────────────────────────────────────────── */

  const nDecl = payload.n_decl;
  const n = payload.n;
  for (const [label, value] of [['n_decl', nDecl], ['n', n]]) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error('[ngp/disasters] ' + where + ': ' + label + ' is '
        + JSON.stringify(value) + ', which is not a row count.');
    }
  }

  const DICTS = ['years', 'decl_types', 'numbers', 'descriptions',
    'disaster_types', 'fips_codes', 'county_names', 'states', 'codes'];
  for (const key of DICTS) {
    if (!Array.isArray(payload[key]) || !payload[key].length) {
      throw new Error('[ngp/disasters] ' + where + ': dictionary '
        + JSON.stringify(key) + ' is missing, empty or not an array.');
    }
  }

  /* The two tables' columns, each checked against its OWN length. A short
     column is the one defect that would otherwise read as data: `undefined`
     indexes into a dictionary as `undefined`, and a card headed "undefined"
     is a card that looks like a rendering bug rather than a wrong file. */
  const DECL_COLUMNS = ['decl_year', 'decl_type', 'decl_number',
    'decl_amendment', 'decl_description', 'decl_approval', 'decl_begin',
    'decl_end'];
  const ROW_COLUMNS = ['decl', 'disaster_type', 'fips', 'county_name', 'state',
    'code'];
  for (const [columns, length, label] of [[DECL_COLUMNS, nDecl, 'n_decl'],
    [ROW_COLUMNS, n, 'n']]) {
    for (const key of columns) {
      if (!Array.isArray(payload[key]) || payload[key].length !== length) {
        throw new Error('[ngp/disasters] ' + where + ': column '
          + JSON.stringify(key) + ' is '
          + (Array.isArray(payload[key]) ? payload[key].length + ' long'
            : 'missing or not an array') + ', not the declared ' + label
          + ' = ' + length + '.');
      }
    }
  }

  /* The epoch every date in the payload counts from. Read from the payload
     rather than assumed — and parsed as UTC, because a bare "1970-01-01" in a
     Date constructor is UTC while "1970-1-1" would be local, and the whole
     archive would shift by a timezone. */
  const epochMs = parseEpoch(payload.epoch, where);

  if (payload.codes.indexOf(PRIMARY) < 0 || payload.codes.indexOf(CONTIGUOUS) < 0) {
    throw new Error('[ngp/disasters] ' + where + ': the codes dictionary is '
      + JSON.stringify(payload.codes) + ' — this decoder reduces by '
      + JSON.stringify(PRIMARY) + ' beating ' + JSON.stringify(CONTIGUOUS)
      + ' and cannot say what any other pair of codes means.');
  }

  // String(), not a coercion: every dictionary below already holds strings.
  // This documents the type and makes a numeric id in a future payload fail
  // the shape checks rather than joining to nothing quietly.
  const yearList = payload.years.map(String);
  const declTypeList = payload.decl_types.map(String);
  const numberList = payload.numbers.map(String);
  const descriptionList = payload.descriptions.map(String);
  const disasterTypeList = payload.disaster_types.map(String);
  const fipsList = payload.fips_codes.map(String);
  const countyNameList = payload.county_names.map(String);
  const stateList = payload.states.map(String);
  const codeList = payload.codes.map(String);

  /* Every index column points inside its own dictionary. Checked once here so
     no lookup below has to defend itself. */
  const bounds = [
    ['decl_year', payload.decl_year, yearList.length],
    ['decl_type', payload.decl_type, declTypeList.length],
    ['decl_number', payload.decl_number, numberList.length],
    ['decl_description', payload.decl_description, descriptionList.length],
    ['decl', payload.decl, nDecl],
    ['disaster_type', payload.disaster_type, disasterTypeList.length],
    ['fips', payload.fips, fipsList.length],
    ['county_name', payload.county_name, countyNameList.length],
    ['state', payload.state, stateList.length],
    ['code', payload.code, codeList.length],
  ];
  for (const [label, col, size] of bounds) {
    for (let i = 0; i < col.length; i++) {
      const v = col[i];
      if (!Number.isInteger(v) || v < 0 || v >= size) {
        throw new Error('[ngp/disasters] ' + where + ': ' + label + '[' + i
          + '] is ' + JSON.stringify(v) + ', outside its ' + size
          + '-entry dictionary.');
      }
    }
  }

  /* ── The year dictionary, sorted into years and junk ─────────────────────
     The junk is COUNTED rather than dropped, and the count is quoted in the
     help text and the archive's citation. What makes it junk is stated once,
     here: a slice is asked for by INTEGER year, and a string that is not one
     can never answer. */
  const declYearInt = new Int32Array(nDecl).fill(-1);
  const cleanYears = new Set();
  const junkYearLabels = [];
  {
    const parsed = yearList.map((raw) => {
      if (!CLEAN_YEAR_RE.test(raw)) return null;
      const y = Number(raw);
      return (y >= YEAR_FLOOR && y <= YEAR_CEIL) ? y : null;
    });
    parsed.forEach((y, i) => { if (y == null) junkYearLabels.push(yearList[i]); });
    for (let d = 0; d < nDecl; d++) {
      const y = parsed[payload.decl_year[d]];
      if (y != null) {
        declYearInt[d] = y;
        cleanYears.add(y);
      }
    }
  }
  const years = Array.from(cleanYears).sort((a, b) => a - b);
  if (!years.length) {
    throw new Error('[ngp/disasters] ' + where + ': not one of the '
      + yearList.length + ' year strings is a four-digit year — there is '
      + 'nothing this map could put on its slider.');
  }

  /* ── The junk county keys ──────────────────────────────────────────────── */
  const junkFipsKeys = fipsList.filter((id) => !FIPS_RE.test(id));

  /* ── Row ranges by declaration ────────────────────────────────────────────
     MEASURED: the county-row table is grouped by declaration — the `decl`
     column never descends and every one of the 3,907 declarations is one
     contiguous block — so a slice iterates the ROWS OF ITS OWN DECLARATIONS
     (a few thousand) rather than all 184,815 of them.

     Verified rather than assumed: a payload that arrived in another order
     would make every slice below silently partial, so the grouping is checked
     and a violation is a hard failure. */
  const declStart = new Int32Array(nDecl + 1).fill(-1);
  {
    let prev = -1;
    for (let i = 0; i < n; i++) {
      const d = payload.decl[i];
      if (d < prev) {
        throw new Error('[ngp/disasters] ' + where + ': the decl column is not '
          + 'grouped (row ' + i + ' belongs to declaration ' + d + ' after '
          + prev + ') — every slice in this decoder assumes it is.');
      }
      if (d !== prev) {
        for (let k = prev + 1; k <= d; k++) declStart[k] = i;
        prev = d;
      }
    }
    // Every remaining boundary — including the sentinel past the last
    // declaration — is the end of the column, so a declaration that names no
    // county at all gets an empty range rather than a −1.
    for (let k = prev + 1; k <= nDecl; k++) declStart[k] = n;
  }

  /* ── Drought, by dictionary rather than by row ───────────────────────────
     The filter is a regular expression over 22 strings, applied once. A row is
     then a lookup in a byte array — which is what makes the drought scope free
     on a slice of several thousand rows. */
  const droughtType = new Uint8Array(disasterTypeList.length);
  disasterTypeList.forEach((label, i) => {
    droughtType[i] = DROUGHT_RE.test(label) ? 1 : 0;
  });

  const declTypeIdxOf = new Map(declTypeList.map((t, i) => [t, i]));

  /* ── Declarations ───────────────────────────────────────────────────────── */

  /** Built on demand and kept: 3,907 records at most, each shared by every row
      that indexes it, so a card listing eight declarations builds eight
      objects and a second look at the same year builds none. */
  const declCache = new Array(nDecl).fill(null);

  function dateAt(days) {
    return days == null ? null : new Date(epochMs + days * MS_PER_DAY);
  }

  /**
   * One declaration, in the app's own terms.
   *
   * @param {number} declIdx an index into the declarations table — what a
   *        county row's `decl` column holds
   * @returns {Readonly<object>|null}
   */
  function declOf(declIdx) {
    const d = Number(declIdx);
    if (!Number.isInteger(d) || d < 0 || d >= nDecl) return null;
    const hit = declCache[d];
    if (hit) return hit;

    const approvalDays = payload.decl_approval[d];
    const beginDays = payload.decl_begin[d];
    const endDays = payload.decl_end[d];
    const approval = dateAt(approvalDays);
    const begin = dateAt(beginDays);
    const end = dateAt(endDays);
    /* An approval of zero or less is the Excel serial zero (1899-12-30) — a
       spreadsheet's way of writing "blank". The DATE is kept, because the
       payload says so and this decoder does not edit its archive; the flag is
       how every surface knows to say so in words instead. */
    const approvalReported = approvalDays != null && approvalDays > 0;
    const amendment = payload.decl_amendment[d];

    const record = Object.freeze({
      index: d,
      /** The clean program year, or null for a declaration whose year string
          is one of the two the archive cannot date (§ Junk is data). */
      year: declYearInt[d] >= 0 ? declYearInt[d] : null,
      /** The year string EXACTLY as the archive carries it, junk included. */
      yearLabel: yearList[payload.decl_year[d]],
      type: declTypeList[payload.decl_type[d]],
      number: numberList[payload.decl_number[d]],
      /** MEASURED: null on all 2,959 Secretarial designations — the amendment
          column belongs to the Presidential declarations, where it runs 0–16
          and 193 declaration numbers carry more than one record. */
      amendment: Number.isInteger(amendment) ? amendment : null,
      description: descriptionList[payload.decl_description[d]],
      approval,
      begin,
      end,
      approvalDays: approvalDays == null ? null : approvalDays,
      approvalReported,
      labels: Object.freeze({
        approval: approval ? LABEL_FMT.format(approval) : null,
        begin: begin ? LABEL_FMT.format(begin) : null,
        end: end ? LABEL_FMT.format(end) : null,
      }),
    });
    declCache[d] = record;
    return record;
  }

  /* ── Slices ───────────────────────────────────────────────────────────────
     One slice is what the map, the card, the table and the poster all read:
     every county row of one program year, one declaration type and one scope
     (drought only, or every disaster). Keyed by the raw FIPS string — junk
     keys included, because they fail the crosswalk downstream where they are
     counted, and because the table is the archive's text. */

  const sliceMemo = new Map();

  function remember(key, value) {
    if (sliceMemo.size >= MEMO_MAX) {
      const oldest = sliceMemo.keys().next();
      if (!oldest.done) sliceMemo.delete(oldest.value);
    }
    sliceMemo.set(key, value);
    return value;
  }

  /** Frozen empty slice, for a question this payload cannot answer (a year
      outside the record, a declaration type it does not carry). An empty
      answer, never an error: the year slider spans every family's domain. */
  const EMPTY_SLICE = Object.freeze({
    byFips: new Map(),
    rows: 0,
    declarations: 0,
    counties: 0,
    junkFipsKeys: 0,
    junkFipsRows: 0,
    latestApproval: null,
  });

  /**
   * @param {number|string} year a program year
   * @param {string} declType a name from the `decl_types` dictionary
   * @param {boolean} droughtOnly
   * @returns {Readonly<object>} the memoized slice
   */
  function sliceOf(year, declType, droughtOnly) {
    const y = Number(year);
    const ti = declTypeIdxOf.get(String(declType));
    const drought = !!droughtOnly;
    if (!Number.isInteger(y) || ti === undefined) return EMPTY_SLICE;

    const key = y + '|' + ti + '|' + (drought ? 'd' : 'a');
    const hit = sliceMemo.get(key);
    if (hit) return hit;

    const byFips = new Map();
    let rows = 0;
    let declarations = 0;
    let junkFipsRows = 0;
    let latest = null;

    for (let d = 0; d < nDecl; d++) {
      if (declYearInt[d] !== y) continue;
      if (payload.decl_type[d] !== ti) continue;
      const lo = declStart[d];
      const hi = declStart[d + 1];
      let named = false;
      for (let i = lo; i < hi; i++) {
        if (drought && !droughtType[payload.disaster_type[i]]) continue;
        const fips = fipsList[payload.fips[i]];
        const role = codeList[payload.code[i]];
        /* One county row, in the app's own terms. Six fields and no more: a
           slice of the drought scope can run to twenty-five thousand of these,
           and a field nothing reads is a field that drifts. The declaration is
           the SHARED record every row of it points at (see declOf), never a
           copy. */
        const row = {
          decl: declOf(d),
          fips,
          /* The row's OWN county name and state, junk included: 394 FIPS keys
             carry more than one spelling, so there is no per-key gazetteer to
             prefer and the archive's text for THIS row is the honest label. */
          county: countyNameList[payload.county_name[i]],
          state: stateList[payload.state[i]],
          disasterType: disasterTypeList[payload.disaster_type[i]],
          role,
        };
        let entry = byFips.get(fips);
        if (!entry) {
          entry = { primary: [], contiguous: [] };
          byFips.set(fips, entry);
        }
        if (role === PRIMARY) entry.primary.push(row); else entry.contiguous.push(row);
        if (!FIPS_RE.test(fips)) junkFipsRows += 1;
        rows += 1;
        named = true;
      }
      if (!named) continue;
      declarations += 1;
      // The freshest APPROVAL in view, for the poster's subtitle. Unreported
      // approvals (the Excel zeros) are skipped: "approved through 1899" is
      // not a fact about this archive.
      const record = declOf(d);
      if (record.approvalReported
        && (latest == null || +record.approval > +latest)) latest = record.approval;
    }

    let junkKeys = 0;
    for (const fips of byFips.keys()) if (!FIPS_RE.test(fips)) junkKeys += 1;

    return remember(key, Object.freeze({
      byFips,
      rows,
      declarations,
      counties: byFips.size,
      junkFipsKeys: junkKeys,
      junkFipsRows,
      latestApproval: latest,
    }));
  }

  /**
   * Every county named by one program year's designations, with its rows split
   * by designation code — the reduction the paint, the card and the table all
   * read.
   *
   * Keyed by the raw FIPS string, so the map goes through the FSA ⇄ FIPS
   * crosswalk (js/decoders/crosswalk.js) on its way to the geometry.
   *
   * @param {number} year a program year
   * @param {string} declType 'Secretarial' | 'Presidential'
   * @param {boolean} droughtOnly
   * @returns {Map<string, {primary: object[], contiguous: object[]}>}
   */
  function getYear(year, declType, droughtOnly) {
    return sliceOf(year, declType, droughtOnly).byFips;
  }

  /**
   * One county's rows in one slice, Primary first — the card's list.
   *
   * @param {string} fipsId a key from the payload's own dictionary (junk keys
   *        included: they are what the archive says)
   * @returns {object[]} empty when this county is not in the slice
   */
  function countyRowsFor(fipsId, year, declType, droughtOnly) {
    const entry = getYear(year, declType, droughtOnly).get(String(fipsId));
    if (!entry) return [];
    return entry.primary.concat(entry.contiguous);
  }

  /**
   * The freshest reported approval date in one slice — the poster's "approved
   * through" clause, and the honest way to date a map of a program year that
   * is still being designated.
   *
   * @returns {Date|null} null when the slice is empty, or when none of its
   *          declarations carries a reported approval date
   */
  function latestApproval(year, declType, droughtOnly) {
    return sliceOf(year, declType, droughtOnly).latestApproval;
  }

  /* NO hasAny(). This instance used to answer "does the archive hold ANY row of
     one declaration type at one scope, in any year?", because the map could be
     read at four (declaration type × scope) corners and one of them —
     Presidential × drought — is empty in every year: not one of the 948
     Presidential declarations carries the drought disaster type. The live region
     said so, in those words, rather than reporting an empty map.

     The app now reads this archive at ONE corner, the Secretarial drought slice
     (js/interfaces/disasters.js § ONE SLICE), which is never empty across the
     record — so the question has no caller, and a memo answering it would be a
     leaf a reader has to trace to nothing. Everything the slice itself needs is
     sliceOf() below, whose arguments are still general: this decoder can be
     asked about either instrument at either scope, and only the descriptor
     decided to stop asking. */

  /**
   * The counts one slice can produce and nothing outside it can recover: how
   * many county rows, under how many declarations, over how many county keys,
   * and how much of that is the archive's junk.
   *
   * @returns {{rows: number, declarations: number, counties: number,
   *            junkFipsKeys: number, junkFipsRows: number}}
   */
  function sliceMeta(year, declType, droughtOnly) {
    const s = sliceOf(year, declType, droughtOnly);
    return {
      rows: s.rows,
      declarations: s.declarations,
      counties: s.counties,
      junkFipsKeys: s.junkFipsKeys,
      junkFipsRows: s.junkFipsRows,
    };
  }

  /* ── Dictionaries ──────────────────────────────────────────────────────── */

  /** @returns {number[]} the program years this archive can be asked for,
      ascending — the fifteen four-digit strings in its year dictionary. The
      other two are junk (§ Junk is data) and are counted in meta(). */
  function yearsOf() {
    return years.slice();
  }

  /** @returns {string[]} ['Presidential', 'Secretarial'], in payload order. */
  function declTypes() {
    return declTypeList.slice();
  }

  /** @returns {string[]} ['Primary', 'Contiguous'] — the designation codes,
      in the payload's own order, which is also their precedence. */
  function codes() {
    return codeList.slice();
  }

  /** @returns {string[]} the 22 disaster-type strings, uncleaned. */
  function disasterTypes() {
    return disasterTypeList.slice();
  }

  /** @returns {string[]} every county key in the data — junk included, because
      the count of keys this archive uses is one of the facts about it. */
  function allCountyIds() {
    return fipsList.slice();
  }

  /** @returns {object} a small metadata summary — the indexes stay private. */
  function meta() {
    return {
      schema: payload.schema,
      dataset: 'fsa-disasters',
      license: payload.license || null,
      epoch: payload.epoch,
      nDecl,
      n,
      years: years.slice(),
      junkYears: junkYearLabels.slice(),
      declTypes: declTypeList.slice(),
      codes: codeList.slice(),
      disasterTypes: disasterTypeList.length,
      droughtTypes: disasterTypeList.filter((t) => DROUGHT_RE.test(t)),
      fipsCodes: fipsList.length,
      junkFipsKeys: junkFipsKeys.slice(),
      keySpace: 'fips',
      nominalYears: false,
    };
  }

  return Object.freeze({
    years: yearsOf,
    declOf,
    getYear,
    countyRowsFor,
    latestApproval,
    sliceMeta,
    declTypes,
    codes,
    disasterTypes,
    allCountyIds,
    meta,
    /* The descriptor facts, carried on the instance like the other decoders':
       this archive is keyed by Census FIPS (so the map joins through the
       crosswalk) and its years are real program years. */
    keySpace: 'fips',
    nominalYears: false,
    dataset: 'fsa-disasters',
  });
}

/**
 * The payload's epoch as a UTC millisecond count.
 *
 * Parsed by hand rather than through Date.parse: an ISO date-only string is UTC
 * in every modern engine, but a payload that ever wrote "1970-1-1" would be
 * LOCAL — and a whole archive silently shifted by one timezone is exactly the
 * kind of defect this app's assertions exist to make loud.
 *
 * @param {any} raw payload.epoch
 * @param {string} where named in the error
 * @returns {number}
 */
function parseEpoch(raw, where) {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(String(raw));
  if (!match) {
    throw new Error('[ngp/disasters] ' + where + ': epoch is '
      + JSON.stringify(raw) + ', not a YYYY-MM-DD date — every date in this '
      + 'payload is a day count from it.');
  }
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
