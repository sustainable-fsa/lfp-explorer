/* ============================================================================
   LFP Explorer · js/decoders/crosswalk.js
   The FSA ⇄ FIPS county crosswalk, and the one function that carries a
   FIPS-keyed data map onto the FSA geometry the map actually draws.

   ES module, no build step. Kit dependencies: fetchJSON and promiseCache.

   ── Two county keys, and why this app needs both ───────────────────────────
   FSA administers its programs on ITS OWN county geography: 3,1xx county
   offices whose 5-character `FSA_STCOU` codes are *not* Census FIPS codes.
   Most are identical strings, and that is exactly what makes the difference
   dangerous — a join that is 97% right looks right.

   Two shapes of disagreement matter, and they are not symmetric:

     one FIPS → many FSA   a Census county split across two FSA offices
                           (Nye NV 32023 is FSA 32023 + 32035; nine such
                           splits today). The FIPS value REPLICATES onto both
                           polygons; nothing has to be reconciled.
     many FIPS → one FSA   an FSA office administering several Census counties
                           (Alaska boroughs, Puerto Rico municipios, some
                           Virginia city/county pairs; up to 23 FIPS onto one
                           FSA code). Several values arrive at one polygon and
                           SOMETHING has to give — see toFsaMap()'s `reduce`.

   The tables differ between boundary vintages (43 collided FSA codes in dd17,
   38 in dd22), so the crosswalk is stored and queried PER VINTAGE and the join
   is redone whenever the app swaps vintages. That falls out free: a vintage
   swap already recolors.

   ── The artifact ───────────────────────────────────────────────────────────
   `assets/fsa-fips-crosswalk.json`, schema `fsa-fips-crosswalk/1`, committed
   in THIS repo (the only data file that is — every payload is fetched from its
   own archive's Pages copy). It is built by `build_crosswalk()` in
   R/web-assets.R from the two sibling boundary archives' geoparquet, which are
   the same files the boundary TopoJSON is built from, so the crosswalk cannot
   drift from the polygons it keys.

   Two parallel arrays per vintage rather than an object of arrays: it is ~40%
   smaller over the wire, it sorts (by FSA, then FIPS) so a diff of the
   artifact is readable, and it makes both directions one pass to index instead
   of one direction free and the other reconstructed.

   ── What this module does NOT do ───────────────────────────────────────────
   It has no opinion about what to do with a collision. `toFsaMap()` takes a
   `reduce` from the interface descriptor, because the right answer is
   dataset-specific: for grazing periods it is the longest period (a
   RECORD-level choice — never a blend of one county's start with another's
   end); for the drought monitor it is the worst class; for disaster
   designations Primary beats Contiguous.
   ========================================================================== */

import { fetchJSON, promiseCache } from 'https://sustainable-fsa.com/style/v0.2.1/core/core.js';
import { assertSchema } from './common.js';

/** Same-origin, in this repo. Relative like every other asset path, so the app
    works from a subdirectory Pages deploy and from the local workspace root. */
export const CROSSWALK_URL = 'assets/fsa-fips-crosswalk.json';

/** The schema this module knows how to read. A mismatch is a hard failure. */
export const CROSSWALK_SCHEMA = 'fsa-fips-crosswalk/1';

const _crosswalks = promiseCache();

/** Frozen empty result for every unknown lookup — one allocation, and a caller
    that ignores the "unknown" case gets a harmless empty loop rather than a
    TypeError three frames later. */
const NONE = Object.freeze([]);

/* ── Loading ─────────────────────────────────────────────────────────────── */

/**
 * Fetch and index the crosswalk. Deduped and memoized by URL, like every
 * payload: the app fetches it LAZILY (only a FIPS-keyed dataset needs it), and
 * two datasets that both need it share one fetch.
 *
 * @param {string} [url]
 * @returns {Promise<Readonly<{toFsa: (vintage: string, fipsId: string) => string[],
 *                             toFips: (vintage: string, fsaId: string) => string[],
 *                             pairs: (vintage: string) => {fsa: string[], fips: string[]},
 *                             vintages: () => string[],
 *                             meta: () => object}>>}
 */
export function loadCrosswalk(url = CROSSWALK_URL) {
  return _crosswalks.cached(url, async () => {
    const payload = await fetchJSON(url);
    assertSchema(payload, CROSSWALK_SCHEMA, url);
    return indexCrosswalk(payload, url);
  });
}

/**
 * Build the two directions for every vintage in the payload. Exported for the
 * smoke tests, which build one from a literal rather than a fetch.
 *
 * @param {object} payload
 * @param {string} [url] named in errors and warnings
 * @returns {Readonly<object>} the crosswalk instance
 */
export function indexCrosswalk(payload, url = CROSSWALK_URL) {
  const vintages = Object.keys(payload).filter((key) => {
    const v = payload[key];
    return v && typeof v === 'object' && Array.isArray(v.fsa) && Array.isArray(v.fips);
  });
  if (!vintages.length) {
    throw new Error('[ngp/crosswalk] ' + url + ': no vintage carries parallel '
      + 'fsa[]/fips[] arrays — expected at least dd17 and dd22.');
  }

  const byVintage = new Map();

  for (const vintage of vintages) {
    const table = payload[vintage];
    const fsa = table.fsa;
    const fips = table.fips;

    if (fsa.length !== fips.length) {
      throw new Error('[ngp/crosswalk] ' + url + ': ' + vintage + ' fsa[] and '
        + 'fips[] are not parallel (' + fsa.length + ' vs ' + fips.length + ').');
    }
    if (typeof table.n === 'number' && table.n !== fsa.length) {
      throw new Error('[ngp/crosswalk] ' + url + ': ' + vintage + ' declares n='
        + table.n + ' but carries ' + fsa.length + ' pairs.');
    }

    // Both directions in one pass. Values are 5-character STRINGS; String() is
    // documentation, not a coercion, and a numeric id in a future artifact
    // fails the shape check below rather than joining to nothing quietly.
    const fipsToFsa = new Map();
    const fsaToFips = new Map();
    let malformed = 0;
    const firstBad = [];

    for (let i = 0; i < fsa.length; i++) {
      const a = String(fsa[i]);
      const b = String(fips[i]);
      if (!/^[0-9]{5}$/.test(a) || !/^[0-9]{5}$/.test(b)) {
        malformed++;
        if (firstBad.length < 5) firstBad.push(a + '↔' + b);
        continue;
      }
      const toA = fipsToFsa.get(b);
      if (toA) toA.push(a); else fipsToFsa.set(b, [a]);
      const toB = fsaToFips.get(a);
      if (toB) toB.push(b); else fsaToFips.set(a, [b]);
    }

    if (malformed) {
      console.warn('[ngp/crosswalk] ' + url + ': ' + vintage + ' dropped '
        + malformed + ' pair(s) that are not 5-character id strings: '
        + firstBad.join(', '));
    }

    // Handed out by reference (see toFsa/toFips), so freeze them: a consumer
    // that pushed onto one would rewrite the crosswalk for the session.
    for (const list of fipsToFsa.values()) Object.freeze(list);
    for (const list of fsaToFips.values()) Object.freeze(list);

    byVintage.set(vintage, {
      fipsToFsa,
      fsaToFips,
      fsa: Object.freeze(fsa.map(String)),
      fips: Object.freeze(fips.map(String)),
    });
  }

  /**
   * Which FSA county offices cover this Census county in this vintage.
   * @param {string} vintage 'dd17' | 'dd22'
   * @param {string} fipsId 5-character FIPS string
   * @returns {string[]} frozen, shared — read, never mutate; [] when unknown
   */
  function toFsa(vintage, fipsId) {
    const t = byVintage.get(vintage);
    if (!t) return NONE;
    return t.fipsToFsa.get(String(fipsId)) || NONE;
  }

  /**
   * Which Census counties this FSA office administers in this vintage. The
   * card uses it to name what it combined.
   * @param {string} vintage
   * @param {string} fsaId 5-character FSA string
   * @returns {string[]} frozen, shared — read, never mutate; [] when unknown
   */
  function toFips(vintage, fsaId) {
    const t = byVintage.get(vintage);
    if (!t) return NONE;
    return t.fsaToFips.get(String(fsaId)) || NONE;
  }

  /**
   * The raw parallel arrays for one vintage, for a check that wants to walk
   * every pair. RAW: a malformed pair the indexes above dropped (with a
   * warning) is still here, because a checker asking for every pair is asking
   * what the artifact says, not what this module could use.
   * @param {string} vintage
   * @returns {{fsa: string[], fips: string[]}} frozen arrays; empty for an
   *          unknown vintage
   */
  function pairs(vintage) {
    const t = byVintage.get(vintage);
    if (!t) return { fsa: NONE, fips: NONE };
    return { fsa: t.fsa, fips: t.fips };
  }

  return Object.freeze({
    toFsa,
    toFips,
    pairs,
    /** @returns {string[]} the vintages this artifact carries. */
    vintages: () => Array.from(byVintage.keys()),
    /** @returns {object} scalars worth quoting in a citation or a check. */
    meta: () => ({
      schema: payload.schema,
      license: payload.license || null,
      source: payload.source || null,
      counts: Object.fromEntries(
        Array.from(byVintage.entries()).map(([v, t]) => [v, t.fsa.length]),
      ),
    }),
  });
}

/* ── The join ────────────────────────────────────────────────────────────── */

/**
 * Carry a FIPS-keyed map of values onto FSA county keys.
 *
 * One FIPS county covered by two FSA offices REPLICATES (both polygons get the
 * value). Several FIPS counties administered by one FSA office COLLIDE, and
 * `reduce` decides — it is handed every constituent value and the FSA id, and
 * must return ONE of the same kind. `reduce` is called even for a single
 * value, so a descriptor cannot accidentally have two behaviours depending on
 * how many counties happened to arrive.
 *
 * `unmatchedFips` is the honest remainder: FIPS keys in the data that this
 * vintage's crosswalk does not cover at all. The app folds it into the live
 * region's "have data but no county boundary to draw" count rather than
 * dropping it, because a growing number there is a broken join, not a quirk.
 *
 * @template V
 * @param {object} xw a loadCrosswalk() instance
 * @param {string} vintage 'dd17' | 'dd22'
 * @param {Map<string, V>} fipsMap keyed by 5-character FIPS strings
 * @param {(values: V[], fsaId: string) => V} reduce
 * @returns {{byFsa: Map<string, V>, unmatchedFips: string[]}}
 */
export function toFsaMap(xw, vintage, fipsMap, reduce) {
  const byFsa = new Map();
  const unmatchedFips = [];
  if (!xw || !fipsMap) return { byFsa, unmatchedFips };

  // Bucket first, reduce second: a value can arrive at an FSA id long after the
  // first one did (the artifact is sorted by FSA, the data by county
  // dictionary), so there is no streaming shortcut that stays correct.
  const bucket = new Map();
  for (const [fipsId, value] of fipsMap) {
    const fsaIds = xw.toFsa(vintage, fipsId);
    if (!fsaIds.length) {
      unmatchedFips.push(fipsId);
      continue;
    }
    for (const fsaId of fsaIds) {
      const seen = bucket.get(fsaId);
      if (seen) seen.push(value);
      else bucket.set(fsaId, [value]);
    }
  }

  for (const [fsaId, values] of bucket) {
    byFsa.set(fsaId, typeof reduce === 'function' ? reduce(values, fsaId) : values[0]);
  }

  return { byFsa, unmatchedFips };
}
