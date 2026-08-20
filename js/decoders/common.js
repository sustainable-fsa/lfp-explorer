/* ============================================================================
   LFP Explorer · js/decoders/common.js
   The plumbing every payload decoder shares: the two assertions that stand
   between a wrong file and a wrong map, one promise cache keyed by payload
   URL, and the canonical type→slug function.

   ES module, no build step. The only kit dependency is core's fetchJSON (hard
   timeout + non-2xx rejection) and promiseCache, so this file is importable
   under node with the kit path rewritten — the same property js/data.js has
   always had, and the reason the smoke tests can exercise a decoder head-on.

   ── Why assertExpectations() exists at all ─────────────────────────────────
   A schema string is not an identity. The nClimGrid climatology payload
   declares the SAME schema as FSA's official grazing periods
   (`fsa-ngp-web/1`) — same columns, same dictionaries, same encodings — and
   differs only in what the numbers MEAN: it is keyed by FIPS rather than FSA
   county codes and its `years` are nominal (2001–2001, standing in for a
   1991–2020 climatology). Point a dataset descriptor at the wrong one of the
   two URLs and every structural check passes; the map simply paints the wrong
   country and says nothing about it.

   So each dataset descriptor carries `expect` — a handful of scalars that are
   cheap to state and impossible to get right by accident (`{year0: 2008}` vs
   `{year0: 2001}`). A mismatch is a HARD failure, not a warning: the whole
   point is to fail before a single county is colored.

   ── Why the cache stores promises ──────────────────────────────────────────
   The kit's promiseCache keys on the URL and stores the in-flight promise, so
   two dataset toggles racing each other share one fetch instead of two, and a
   FAILED promise evicts itself — which is what makes the app's `failNote`
   Retry button actually retry rather than re-await a rejected promise forever.
   Decoding happens INSIDE the cached maker, so the cache hands out one shared,
   already-indexed instance per payload; a toggle back to a dataset the session
   has already seen costs nothing.

   The cache key is the URL, which means two dataset descriptors that point at
   the same file must decode it the same way. That is true by construction
   today (every descriptor has its own payload); a future descriptor that
   wanted a second reading of a file already loaded must give the reading its
   own key, not a second decode of the same URL.

   ── Why typeSlug() lives down here ────────────────────────────────────────
   It is PURE and it is needed before any payload exists: boot reads `?type=`
   and has to hold a validated slug while the fetch is still in flight. Every
   interface's dictionary slugs the same way, so there is exactly one copy of
   the function, and js/data.js re-exports it so its long-standing consumers
   (app.js, export.js) do not have to move.
   ========================================================================== */

import { fetchJSON, promiseCache } from 'https://sustainable-fsa.com/style/v0.2.0/core/core.js';

/** URL → Promise<instance>. Module-level on purpose: the identity of a payload
    is its URL, and the app wants one decoded instance per payload per session
    no matter which interface asked for it first. */
const _datasets = promiseCache();

/* ── Assertions ──────────────────────────────────────────────────────────── */

/**
 * The payload declares the schema this decoder knows how to read, or nothing
 * happens at all.
 *
 * @param {any} payload  the parsed JSON
 * @param {string} schema the expected `schema` string
 * @param {string} url    named in the error — with several payloads in play,
 *        "which file" is the first thing a reader needs
 * @returns {any} the payload, so this can be used inline
 */
export function assertSchema(payload, schema, url) {
  if (!payload || payload.schema !== schema) {
    throw new Error('[ngp/decode] ' + url + ': unexpected payload schema: expected '
      + JSON.stringify(schema) + ', got '
      + JSON.stringify(payload && payload.schema));
  }
  return payload;
}

/**
 * Check the descriptor's fingerprint scalars against the payload. See the
 * header: this is the tripwire for a URL that is structurally valid and
 * semantically the wrong file.
 *
 * Values compare with ===, except arrays, which compare element-wise (so an
 * `expect` may pin `years: [2001, 2001]` as easily as `year0: 2001`).
 *
 * @param {any} payload
 * @param {Record<string, any>|null|undefined} expect
 * @param {string} url
 * @returns {any} the payload
 */
export function assertExpectations(payload, expect, url) {
  if (!expect) return payload;
  for (const key of Object.keys(expect)) {
    const want = expect[key];
    const got = payload ? payload[key] : undefined;
    const ok = Array.isArray(want)
      ? Array.isArray(got) && got.length === want.length
        && want.every((v, i) => v === got[i])
      : got === want;
    if (!ok) {
      throw new Error('[ngp/decode] ' + url + ': expected ' + key + ' = '
        + JSON.stringify(want) + ', got ' + JSON.stringify(got)
        + ' — this is almost certainly the wrong payload for this dataset.');
    }
  }
  return payload;
}

/* ── Loading ─────────────────────────────────────────────────────────────── */

/**
 * Fetch, verify and decode one dataset. Deduped and memoized by `ds.url`.
 *
 * Not declared async so a malformed descriptor — a programming error, not a
 * network condition — throws where it is written rather than one microtask
 * later inside somebody's catch block for fetch failures.
 *
 * @param {{url: string, schema?: string, expect?: object,
 *          decode: (payload: any, ds: object) => any}} ds a dataset descriptor
 *        from an interface's `datasets[]`
 * @returns {Promise<any>} the decoded instance the descriptor's decode() built
 */
export function loadDataset(ds) {
  if (!ds || typeof ds.url !== 'string' || !ds.url) {
    throw new Error('[ngp/decode] loadDataset() needs a dataset descriptor with a url.');
  }
  if (typeof ds.decode !== 'function') {
    throw new Error('[ngp/decode] dataset ' + JSON.stringify(ds.id || ds.url)
      + ' has no decode() — a descriptor without one cannot be read.');
  }
  return _datasets.cached(ds.url, async () => {
    const payload = await fetchJSON(ds.url);
    if (ds.schema) assertSchema(payload, ds.schema, ds.url);
    assertExpectations(payload, ds.expect, ds.url);
    const instance = ds.decode(payload, ds);
    _loaded.add(ds.url);
    return instance;
  });
}

/** URLs whose decode has RESOLVED. promiseCache is deliberately opaque (no
    `has`), and "is this already in hand" is a question the UI needs answered
    synchronously — see isDatasetLoaded(). */
const _loaded = new Set();

/**
 * Has this payload already been decoded in this session? The caller is the
 * dataset toggle: a cached toggle settles inside one task, and a "Loading…"
 * pill that appears and vanishes in the same frame is worse than no pill.
 *
 * @param {{url?: string}} ds
 * @returns {boolean}
 */
export function isDatasetLoaded(ds) {
  return !!(ds && ds.url && _loaded.has(ds.url));
}

/* ── Slugs ───────────────────────────────────────────────────────────────── */

/**
 * Type name → URL slug. PURE: it works before any payload has landed, because
 * the boot path has to validate a `?type=` param against a slug the moment the
 * URL is read.
 *
 * Lowercase, every run of non-alphanumerics collapsed to one hyphen, hyphens
 * trimmed from both ends. The pairs that make this worth testing:
 *   "Short Season Small Grains"     → short-season-small-grains
 *   "Short Season Small Grains (1)" → short-season-small-grains-1
 *   "Short Season Fall/Winter Small Grains"
 *                                   → short-season-fall-winter-small-grains
 *   "Cool Season"                   → cool-season
 *
 * @param {string} type
 * @returns {string}
 */
export function typeSlug(type) {
  return String(type)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
