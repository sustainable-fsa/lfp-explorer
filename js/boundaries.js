/* ============================================================================
   LFP Explorer · js/boundaries.js
   Which county polygons a selection is allowed to be drawn on, and the one
   place that answers it.

   ES module, no build step. Kit dependencies: loadCountyIndex, TILE_BASE and
   vintageForYear from county/county.js. App dependency: assertProjectedSpace
   from js/projection.js.

   ── The problem this file exists to solve ──────────────────────────────────
   This app drew ONE county composite — FSA's administrative geography, dd17
   for program years ≤ 2014 and dd22 for 2015 onward — under all four
   interfaces, and bent every FIPS-keyed payload onto it through the crosswalk.

   That is a misregistration, and it was measurable. On the drought monitor,
   counting the counties whose data reached no polygon at all:

     usdm-counties-fsa-lfp    131 → 0     an identity join, once it is drawn
                                          on the boundaries it was computed on
     usdm-counties-reported   140 → 9     the nine Connecticut planning
                                          regions, which no county in the LFP
                                          determination set covers
     usdm-counties            159 → 13    the six territory FIPS the tilesets
                                          drop (AS, GU, MP, VI)

   Each archive computed its numbers against a particular set of polygons. A
   choropleth has to be drawn on the polygons its numbers came from — the three
   county sets disagree with one another, and the disagreement is the finding,
   not noise to be smoothed away. So the geometry follows the DATASET, and this
   module is the only thing that knows how.

   ── THE THREE AUTHORITIES ──────────────────────────────────────────────────
   An "authority" is a way of answering *where is this county*. There are three
   in play, and they differ in two ways that both bite:

                  id space              vintage axis            n
     fsa          FSA county codes      dd17 / dd22 by          3,104 / 3,106
                                        PROGRAM YEAR
     fsa-lfp      Census FIPS           none — one FOIA         3,221
                                        snapshot, whole record
     census       Census FIPS           eighteen annual TIGER   3,219 … 3,222
                                        vintages by YEAR

   `fsa-lfp` and `census-counties-2020` have IDENTICAL id sets — 3,221 each,
   zero symmetric difference in both directions — and different geometry: the
   LFP set is unclipped and not edge-matched. That pair is the sharpest
   demonstration in the app of why this work was worth doing, because switching
   between them changes nothing but the boundary.

   ── TWO VINTAGE AXES, AND THEY MUST NEVER MEET IN ONE FUNCTION ─────────────
   FSA's axis is a two-value split on the program year, and the kit owns it
   (`vintageForYear`). The Census axis is eighteen annual releases. A year has
   BOTH, independently, and which one is in play is a fact about the dataset.

   The trap is `sel.vintage`. It means the FSA program-year vintage and nothing
   else, because it is what indexes the crosswalk (`js/decoders/crosswalk.js` is
   built per FSA vintage). On a drought map drawn on the 2011 Census counties
   there is no FSA vintage in play at all — and a leaf that reached for the
   DRAWN authority's vintage there would index the crosswalk with `'2011'` and
   match nothing. So the drawn authority travels as `sel.boundary`, separately,
   and the two are unrelated on the interfaces where they are unrelated.

   ── WHEN A CROSSWALK IS NEEDED ─────────────────────────────────────────────
   Exactly when the dataset's key space is not the authority's:

     dataset keySpace   authority keySpace   crosswalk
     fsa                fsa                  no    NGP official, eligibility
     fips               fips                 no    all three drought datasets
     fips               fsa                  yes   NGP nClimGrid, disasters

   `needsCrosswalk()` is that table. Note it is NOT `keySpace === 'fips'`, which
   is what the app used to ask: three FIPS-keyed datasets now land on FIPS-keyed
   authorities and touch no crosswalk at all.

   ── What this module does NOT do ───────────────────────────────────────────
   It does not decide which authority a dataset belongs on. Each dataset
   descriptor declares that itself, in `js/interfaces/*.js`, because "which
   polygons were these numbers computed against" is a fact about an archive and
   belongs next to the archive's URL. This module only resolves a declared
   authority plus a year into one published tileset, and loads it.
   ========================================================================== */

import {
  TILE_BASE, loadCountyIndex, vintageForYear,
} from 'https://sustainable-fsa.com/style/v0.4.1/county/county.js';
import { assertProjectedSpace } from './projection.js';

/* ── The catalogue ───────────────────────────────────────────────────────── */

/** Where `data-tiles` publishes. A SECOND ORIGIN, and therefore a CSP entry:
    index.html names it in `connect-src` and preconnects to it. Re-exported from
    the kit rather than restated, so there is one string. */
export { TILE_BASE };

/**
 * The Census boundary vintages `data-tiles` publishes, ASCENDING.
 *
 * THE MAINTENANCE LIST. Note the gap: 2000, then nothing until 2009, because
 * TIGER/Line's own web releases start there and the 2000 vintage is lifted out
 * of the 2010 archive. Do not "fix" the gap by filling it — `censusVintageFor`
 * resolves through whatever is here, and inventing 2004 would point at a
 * tileset that does not exist.
 */
export const CENSUS_VINTAGES = Object.freeze([
  2000, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018,
  2019, 2020, 2021, 2022, 2023, 2024, 2025,
]);

/** The newest published Census vintage — the tripwire's ceiling. */
const NEWEST_CENSUS = CENSUS_VINTAGES[CENSUS_VINTAGES.length - 1];

/**
 * THE THREE COUNTY AUTHORITIES.
 *
 *   keySpace    what an id in this authority IS — 'fsa' | 'fips'. Decides,
 *               against the dataset's own keySpace, whether a crosswalk runs.
 *   nameStyle   'bare' ("Autauga") | 'lsad' ("Autauga County", "Bethel Census
 *               Area", "Adjuntas Municipio"). Carried verbatim from the
 *               archive; see § Names below.
 *   tilesetFor  (year) → the ONE published tileset that answers for that year.
 *   labelFor    (year) → the words the card, the live region and the loading
 *               pill use. Prose, never parsed.
 *   vintageFor  (year) → this authority's own vintage label, or null.
 */
export const AUTHORITIES = Object.freeze({
  /* FSA's own administrative composite, on the program-year axis the kit owns.
     The authority every FSA-keyed dataset is administered on, and the only one
     whose ids are FSA county codes rather than Census FIPS — which is why it
     has 16 ids no Census vintage has (02001, 12025, 19156, 23002 …). */
  fsa: Object.freeze({
    id: 'fsa',
    keySpace: 'fsa',
    nameStyle: 'bare',
    tilesetFor: (year) => 'fsa-counties-' + fsaVintageFor(year),
    labelFor: (year) => 'the ' + fsaVintageFor(year) + ' FSA county boundaries',
    vintageFor: (year) => fsaVintageFor(year),
  }),

  /* The boundaries FSA's LFP determinations are actually computed against: the
     FOIA'd NDMC geodatabase (2025-FSA-08431-F). Census-FIPS-shaped, NOT FSA
     codes — measured, its 3,221 ids are byte-identical as a SET to
     census-counties-2020, with different geometry. No vintage axis: one
     snapshot, used for the whole record, which is itself a finding about how
     the program is administered. */
  'fsa-lfp': Object.freeze({
    id: 'fsa-lfp',
    keySpace: 'fips',
    nameStyle: 'lsad',
    tilesetFor: () => 'fsa-lfp-counties',
    labelFor: () => 'the FSA LFP determination boundaries',
    vintageFor: () => null,
  }),

  /* Vintage-matched TIGER counties, eighteen releases. The one authority whose
     id set MOVES inside the record, and the movement is the point: 2000 has
     3,219 counties against 2022–2025's 3,222, and Connecticut is eight counties
     through vintage 2021 and NINE PLANNING REGIONS from 2022 — so on this
     authority Connecticut changes shape at program year 2023. */
  census: Object.freeze({
    id: 'census',
    keySpace: 'fips',
    nameStyle: 'bare',
    tilesetFor: (year) => 'census-counties-' + censusVintageFor(year),
    labelFor: (year) => 'the ' + censusVintageFor(year) + ' Census county set',
    vintageFor: (year) => String(censusVintageFor(year)),
  }),
});

/** The declarable authority ids, for validating a descriptor. */
export const AUTHORITY_IDS = Object.freeze(Object.keys(AUTHORITIES));

/* The fourth reading of a "county" that the archives carry —
   `usdm-counties-census-2020`, the 2020 set held fixed across the whole record
   — is deliberately NOT an authority here. The eligibility interface retires it
   from its aggregation picker (three of the payload's four), so it can never be
   the active reading; if it ever came back it would draw census-counties-2020. */

/* ── The two independent vintage resolvers ───────────────────────────────── */

/**
 * The FSA program-year vintage. A one-line delegation to the kit, present so
 * that every caller in this app reads both axes through one module and nobody
 * is tempted to inline `year < 2015`.
 *
 * @param {number|string} year
 * @returns {'dd17'|'dd22'}
 */
export function fsaVintageFor(year) {
  return vintageForYear(year);
}

/**
 * The CENSUS annual boundary vintage for a program year.
 *
 * The rule is the upstream archive's, reproduced from
 * `usdm-counties/usdm-counties.R` (`Year = vintage + 1`, then fill down and
 * up): the vintage in force for year Y is the newest PUBLISHED vintage
 * v ≤ Y − 1, floored at the oldest published and capped at the newest.
 *
 *   2000 → 2000 (floored)   2001–2009 → 2000   2010 → 2009   2011 → 2010
 *   2015 → 2014             2023 → 2022        2026 → 2025 (capped)
 *
 * VERIFIED against the published data, not just the code: for all 27 calendar
 * years, the set of counties with a non-'.' week in usdm-counties.json equals
 * this vintage's sidecar county set exactly, plus the 13 territory ids the
 * tilesets drop and nothing else. `tools/verify.mjs` re-runs that check.
 *
 * A count-based test of this would pass wrongly — census-counties-2014 and
 * 2015–2019 are DIFFERENT sets of the same size, 3,220 — so the gate compares
 * sets.
 *
 * @param {number|string} year
 * @returns {number} a member of CENSUS_VINTAGES
 */
export function censusVintageFor(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) {
    throw new Error('[ngp/boundaries] censusVintageFor: expected a program year, '
      + 'got ' + JSON.stringify(year));
  }
  if (y - 1 > NEWEST_CENSUS) {
    // console.ERROR, not warn. Both audit harnesses collect m.type() === 'error'
    // ONLY (tools/verify.mjs, tools/a11y-audit.mjs), so a warn here would be a
    // tripwire that never trips — which is the state the year-domain warn is
    // already in. The map still draws, capped at the newest vintage, and the
    // console-clean gate goes red until CENSUS_VINTAGES gains the new year.
    console.error('[ngp/boundaries] program year ' + y + ' wants Census boundary '
      + 'vintage ' + (y - 1) + ', and the newest tileset this app knows is '
      + NEWEST_CENSUS + '. Drawing ' + NEWEST_CENSUS + '. Add ' + (y - 1)
      + ' to CENSUS_VINTAGES once data-tiles publishes census-counties-'
      + (y - 1) + '.');
    return NEWEST_CENSUS;
  }
  let v = CENSUS_VINTAGES[0];
  for (const candidate of CENSUS_VINTAGES) if (candidate <= y - 1) v = candidate;
  return v;
}

/* ── Resolution ──────────────────────────────────────────────────────────── */

/**
 * @typedef {Readonly<{
 *   key: string, authority: string, tileset: string, indexUrl: string,
 *   keySpace: 'fsa'|'fips', nameStyle: 'bare'|'lsad', label: string,
 *   vintage: string|null
 * }>} BoundaryRef
 */

// Refs are immutable and cheap, and the app diffs them by `key` on every year
// tick — so they are built once per (authority, year) answer and handed back.
const _refs = new Map();

/**
 * The one published tileset a declared authority answers with for a given year.
 *
 * `key` IS the identity, and it is the tileset basename, so two authorities can
 * never collide and a year that does not move the vintage resolves to the same
 * key twice — which is what makes the app's swap check a string compare.
 *
 * An unknown authority THROWS rather than falling back. Drawing a dataset on
 * the wrong county set is the exact failure this module exists to prevent, and
 * a silent default would reintroduce it.
 *
 * @param {string} authorityId
 * @param {number} year
 * @returns {BoundaryRef}
 */
export function boundaryRef(authorityId, year) {
  const a = AUTHORITIES[authorityId];
  if (!a) {
    throw new Error('[ngp/boundaries] unknown county authority '
      + JSON.stringify(authorityId) + '. Declare one of: '
      + AUTHORITY_IDS.join(', ') + '.');
  }
  const tileset = a.tilesetFor(year);
  const hit = _refs.get(tileset);
  if (hit) return hit;
  const ref = Object.freeze({
    key: tileset,
    authority: a.id,
    tileset,
    indexUrl: TILE_BASE + tileset + '-index.json',
    keySpace: a.keySpace,
    nameStyle: a.nameStyle,
    label: a.labelFor(year),
    vintage: a.vintageFor(year),
  });
  _refs.set(tileset, ref);
  return ref;
}

/**
 * The ref a full selection demands. `sel.authority` is the id app.js resolved
 * from the active dataset's declaration — this function does not read the
 * interface registry, so the module graph stays one-way.
 *
 * @param {{authority: string, year: number}} sel
 * @returns {BoundaryRef}
 */
export function boundaryFor(sel) {
  return boundaryRef(sel && sel.authority, sel && sel.year);
}

/**
 * Does this dataset's payload have to go through the FIPS↔FSA crosswalk to
 * reach these polygons?
 *
 * The whole rule: only when the key spaces differ. This REPLACES
 * `ds.keySpace === 'fips'` as the thing that decides whether the crosswalk is
 * even fetched — three FIPS-keyed datasets now land on FIPS-keyed authorities
 * and never touch it.
 *
 * @param {string} datasetKeySpace 'fsa' | 'fips'
 * @param {BoundaryRef} ref
 * @returns {boolean}
 */
export function needsCrosswalk(datasetKeySpace, ref) {
  return !!ref && datasetKeySpace !== ref.keySpace;
}

/* ── Loading ─────────────────────────────────────────────────────────────── */

/**
 * Fetch, decode and VALIDATE one authority's index sidecar.
 *
 * The kit memoizes by URL, so a year drag across a decade of the Census
 * authority refetches nothing it has already seen. That cache is per session and
 * says nothing about the CDN: `data-tiles` serves both the sidecars and the
 * archives `public, max-age=3600` and deliberately NOT `immutable`, because the
 * filenames are stable across rebuilds and `immutable` under a stable filename
 * means a correction is invisible to anyone holding a copy.
 *
 * The space assertion is HERE, inside the only loader, rather than at each call
 * site — which is the point. A registration check that a caller can forget is
 * not a check.
 *
 * @param {BoundaryRef} ref
 * @returns {Promise<object>} the kit's index result: {index, names, bounds,
 *          tiles, space, n, maskYear, tiled} — the tiled analogue of
 *          loadCounties()
 */
export async function loadBoundary(ref) {
  const loaded = await loadCountyIndex(ref.indexUrl, { key: ref.key });
  return assertProjectedSpace(loaded, ref.key);
}

/**
 * Warm one without waiting for it. A failed prefetch is swallowed with a warn:
 * it is an optimisation, and surfacing it as an error the reader can see would
 * make the app look broken over something that costs a later spinner at worst.
 *
 * @param {BoundaryRef} ref
 * @returns {void}
 */
export function prefetchBoundary(ref) {
  if (!ref) return;
  loadBoundary(ref).catch((err) => {
    console.warn('[ngp/boundaries] prefetch of ' + ref.key + ' failed; it will '
      + 'be fetched again when it is actually needed.', err);
  });
}

/* ── Prose ───────────────────────────────────────────────────────────────────
   § Names. `fsa-lfp-counties` carries the LSAD form ("Autauga County", "Bethel
   Census Area", "Adjuntas Municipio") and the other twenty tilesets carry the
   bare form ("Autauga"). Both are the archives' own strings and neither is
   normalized here, because every rule that could reconcile them is wrong
   somewhere: stripping a trailing type word turns "Carson City" into "Carson",
   and appending one turns "Bethel Census Area" into "Bethel Census Area
   County". Nothing in js/ appends a county-type word today, and a gate freezes
   that. The label changing when the reader switches authority is information —
   it is the archive telling them they are looking at a different county set. */

/**
 * The county card's "no boundary" row, in the vocabulary of what is on screen.
 *
 * One implementation because four descriptors emit this row, and four copies of
 * the sentence all said "the FSA boundary archive" — which is wrong on two of
 * the three authorities.
 *
 * @param {{boundary?: BoundaryRef|null}} sel
 * @returns {string}
 */
export function boundaryNoteValue(sel) {
  const ref = sel && sel.boundary;
  return 'No boundary available to display — this county is not in '
    + (ref ? ref.label : 'the county set on screen') + '.';
}
