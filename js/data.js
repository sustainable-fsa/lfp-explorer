/* ============================================================================
   LFP Explorer · js/data.js
   The data layer's FACADE: one module-level view of whichever grazing-period
   dataset the app is currently reading.

   ES module, no build step. Every kit dependency now lives one directory down
   (js/decoders/), so this file imports nothing but app-local modules and is
   importable under node with the kit path rewritten — which is exactly how the
   smoke tests exercise it.

   ── What moved, and why this file stayed ───────────────────────────────────
   This module used to BE the data layer: one fetch, one set of module-level
   indexes, one payload for the lifetime of the page. The app now reads more
   than one payload — FSA's own grazing periods and the nClimGrid climatology,
   two files that declare the same schema and mean different things — so the
   decoding and indexing moved into an INSTANCE FACTORY,
   js/decoders/ngp-web.js, and the loading into js/decoders/common.js.

   What did not move is this file's SURFACE. `getYearType`, `getCountySeries`,
   `years`, `types`, `typeFromSlug`, `typeSlug`, `countyName`, `allCountyIds`,
   `meta`, `initData`, `DATA_URL` and `SCHEMA` all still mean exactly what they
   meant, and they now delegate to the active instance. Three satellite modules
   (js/card-content.js, js/table-view.js, js/export.js) and the audit harness
   import them by name; a rename here is a breakage there for no gain.

   `setActiveNgpDataset(instance)` is the one addition: the app calls it when
   the reader toggles datasets, and every function above starts answering for
   the new payload on the next call. There is no event — the app repaints,
   refills the card and rebuilds the table itself, in a known order, right
   after the swap (js/app.js § setDataset).

   ── Which payload ──────────────────────────────────────────────────────────
   `initData()` boots the FSA official payload, schema `fsa-ngp-web/1` (FROZEN),
   fetched from `../fsa-normal-grazing-period/…`. This repo does not ship it:
   the archive repo builds and commits it on every update, and the RELATIVE
   path resolves to the archive's own same-origin Pages copy in production
   (sustainable-fsa.com/fsa-normal-grazing-period/…) and to the sibling
   checkout in local dev, where the workspace root is what gets served. The
   climatology payload is the same story one directory over, and is fetched
   LAZILY — a visitor who never toggles never pays for it.

   The payload's layout, its three encodings (dictionary indexes, the year
   offset, the start/end year offsets) and the UTC discipline every Date in it
   requires are documented where the decoding happens: js/decoders/ngp-web.js.
   ========================================================================== */

import { isDatasetLoaded, loadDataset, typeSlug as _typeSlug } from './decoders/common.js';
import { NGP } from './interfaces/ngp.js';

/* ── Constants ───────────────────────────────────────────────────────────── */

/** The official dataset's descriptor — the one `initData()` boots. Read off the
    family's own `default` flag rather than off its position in the list, which
    is the reader's order and not a statement about which payload boots
    (js/interfaces/registry.js § defaultDatasetOf). */
const OFFICIAL = NGP.datasets.find((d) => d.default) || NGP.datasets[0];

/** Default payload location, relative to the app page — the archive repo's own
    committed copy, one directory up. Deliberately RELATIVE and not the
    data.sustainable-fsa.com mirror: same-origin Pages gzips the ~5 MB file to
    ~100 KB, the mirror is cross-origin and serves it uncompressed. Read off
    the dataset descriptor so the URL has exactly one source of truth. */
export const DATA_URL = OFFICIAL.url;

/** The schema this module knows how to read. A mismatch is a hard failure —
    thrown by js/decoders/common.js before a single county is colored. */
export const SCHEMA = OFFICIAL.schema;

/* ── Module state ────────────────────────────────────────────────────────── */

/** The instance every function below answers from: whichever dataset is on
    screen. Null until initData() resolves. */
let active = null;

function assertReady(who) {
  if (!active) {
    throw new Error('[ngp/data] ' + who + '() before initData() resolved.');
  }
  return active;
}

/* ── Boot ────────────────────────────────────────────────────────────────── */

/**
 * Fetch, verify and index the official payload, and make it the active
 * dataset. Idempotent: the decoded instance is cached by URL one module down,
 * so a second call resolves immediately against the already-built indexes.
 *
 * @param {string} [url] an override, for a harness pointing at a fixture; any
 *        value other than DATA_URL is loaded as the official dataset from a
 *        different location, with the same schema and expectation checks.
 * @returns {Promise<{schema: string, license: string, n: number,
 *                    years: number[], types: string[]}>}
 *          a small metadata summary — the indexes themselves stay private.
 */
export async function initData(url = DATA_URL) {
  const ds = url === DATA_URL ? OFFICIAL : { ...OFFICIAL, url };
  active = await loadDataset(ds);
  return meta();
}

/**
 * Point the facade at another decoded dataset instance — the app's dataset
 * toggle, and the only way the active instance ever changes after boot.
 *
 * @param {object} instance a js/decoders/ngp-web.js instance
 * @returns {object} the instance, so a caller can chain
 */
export function setActiveNgpDataset(instance) {
  if (!instance || typeof instance.getYearType !== 'function'
      || typeof instance.types !== 'function') {
    throw new Error('[ngp/data] setActiveNgpDataset() needs a decoded dataset '
      + 'instance (got ' + (instance === null ? 'null' : typeof instance) + ').');
  }
  active = instance;
  return instance;
}

/** The active instance itself, for a caller that needs the key space or the
    nominal-year flag rather than a lookup. Null before boot. */
export function activeNgpDataset() {
  return active;
}

/** Is a dataset descriptor's payload already decoded in this session? Re-export
    of the loader's own answer, so a caller with this module in hand does not
    need the decoder layer too. */
export { isDatasetLoaded };

/* ── Lookups (all delegating) ────────────────────────────────────────────── */

/**
 * Every county with a reported period for one (program year, pasture type).
 * The returned Map belongs to the instance and is handed out by reference —
 * READ IT, never mutate it. Keys are 5-character county ids in the ACTIVE
 * dataset's key space: FSA codes on the official payload, Census FIPS on the
 * climatology (which is why the paint path goes through the crosswalk —
 * js/interfaces/ngp.js § colorsFor).
 *
 * @param {number} year program year (ignored by a climatology, which has one)
 * @param {string} type pasture type / season name
 * @returns {Map<string, object>}
 */
export function getYearType(year, type) {
  return assertReady('getYearType').getYearType(year, type);
}

/**
 * One county's reported periods for one pasture type, every year present in
 * the data, ascending. Years with no reported period are ABSENT rather than
 * null-filled — a gap in this array is a real fact about FSA's reporting, and
 * the consumer (the card's span chart) draws it as a gap.
 *
 * @param {string} id 5-character county id
 * @param {string} type
 * @returns {object[]} shared, memoized — read, never mutate
 */
export function getCountySeries(id, type) {
  return assertReady('getCountySeries').getCountySeries(id, type);
}

/** @returns {number[]} every program year in the active data, ascending. */
export function years() {
  return assertReady('years').years();
}

/** @returns {string[]} the active dataset's pasture types / seasons, in the
 *  payload's own sort order (16 for FSA, 3 for the climatology). */
export function types() {
  return assertReady('types').types();
}

/**
 * Type name → URL slug. PURE: it works before initData, because the boot path
 * has to validate a `?type=` param against a slug the moment the URL is read.
 * The implementation is js/decoders/common.js's — one copy, shared by every
 * interface — and it is re-exported here because this is where the app has
 * always imported it from.
 *
 * @param {string} type
 * @returns {string}
 */
export function typeSlug(type) {
  return _typeSlug(type);
}

/**
 * URL slug → type name, or null for anything not in the ACTIVE dataset's
 * dictionary. Needs the data (the dictionary IS the whitelist), so a boot path
 * that reads `?type=` before initData resolves must hold the raw slug and
 * re-validate here — or hand it to js/interfaces/ngp.js § applyPending, which
 * also knows what to fall back to.
 *
 * @param {string} slug
 * @returns {string|null}
 */
export function typeFromSlug(slug) {
  if (!active) return null;
  return active.typeFromSlug(slug);
}

/**
 * @param {string} id 5-character county id
 * @returns {{county: string, state: string}|null} null for an id that is not
 *          in the data at all (which is different from an id with no polygon).
 */
export function countyName(id) {
  return assertReady('countyName').countyName(id);
}

/** @returns {string[]} every county id in the DATA — including, on the FSA
 *  payload, the island territories, which have no polygon in either boundary
 *  archive. */
export function allCountyIds() {
  return assertReady('allCountyIds').allCountyIds();
}

/** @returns {{schema: string, license: string, n: number, years: number[],
 *             types: string[]}} the active payload's metadata summary. Safe
 *  before boot, where it reports an empty dataset rather than throwing. */
export function meta() {
  if (!active) {
    return { schema: null, license: null, n: 0, years: [], types: [] };
  }
  return active.meta();
}
