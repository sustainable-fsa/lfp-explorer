/* ============================================================================
   LFP Explorer · tools/config.mjs
   The one place the two harnesses agree about the app.

   `verify.mjs` and `a11y-audit.mjs` are separate programs with separate jobs,
   and until this file existed they hand-duplicated every fact they share about
   the page: the subpath it deploys to, the two themes the kit ships, the two
   viewports, the localStorage seeds, the ngpReady predicate and its timeout,
   the MIME table, and the whole static-server block. Nine facts in two places
   is eighteen chances for one of them to drift a version behind the other, and
   the failure mode is the worst kind: both harnesses stay green while auditing
   two subtly different pages.

   WHAT BELONGS HERE: data about the app, plus the server factory. Nothing that
   asserts. A knob only one harness has an opinion about — verify's screenshot
   directory, settle window, feature-state source id; the a11y run's own settle
   window — stays in that harness, where a reader looking for it will be.

   WHAT `INTERFACES` IS FOR: the probe table. The app is growing from one view
   ("interface", in the plan's language) to four, each with its own datasets,
   legend body, export filename scheme and deep link. Every harness fact about
   a view lives in one entry here, so adding a view to the gates is adding a
   literal — not editing assertions scattered through 1,700 lines. PR 1 ships
   the `ngp` entry only; the fields the PR 2+ section template consumes are
   named and documented now so the shape is not invented four times.

   Ids, slugs and filenames in this file are FROZEN CONTRACT with the app: they
   are the same strings index.html authors and js/app.js reads. Change one here
   only in the commit that changes it there.
   ========================================================================== */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ══════════════════════════════════════════════════════════════════════════
   THE PAGE
   ══════════════════════════════════════════════════════════════════════════ */

/** The app, as a server path — a SUBDIRECTORY, which is how it deploys. Both
    harnesses serve the WORKSPACE ROOT (the parent of this checkout) so that a
    path bug which only appears under a subdirectory deploy appears here too.
    It matches the documented dev command,
    `python3 -m http.server 8000 -d <workspace>`. */
export const PAGE_PATH = '/lfp-explorer/';

/** The kit ships exactly these two. */
export const THEMES = Object.freeze(['light', 'high-contrast']);

/** The two viewports both harnesses measure.

    `compact` is the phone. a11y-audit prints its own viewport name in every
    report row and in the CI log, where it has always been `narrow`; it builds
    its list from these numbers and keeps that label, so this de-duplication
    changed no output. */
export const VIEWPORTS = Object.freeze({
  wide: Object.freeze({ width: 1440, height: 900 }),
  compact: Object.freeze({ width: 375, height: 720 }),
});

/** Seeded into localStorage before load, by both harnesses.

    `sfsa-ngp-seen-intro` suppresses the first-visit help auto-open, which
    fires 350ms after the help fetch resolves and would otherwise land on top
    of whichever step or state is running then. The help modal is exercised
    deliberately instead, in its own assertion (verify) and its own axe pass
    (a11y).

    `sfsa-ngp-drawer` pins the desktop control drawer OPEN, which is also the
    app's default — the seed states the assumption rather than changing it, so
    every section starts from one known layout instead of from whatever a
    previous session left behind. It is deliberately seeded for the COMPACT run
    too: the phone force-closes the drawer regardless of what is stored, and
    that force-close is itself asserted.

    NO VIEW OR DATASET SEED. The default view is `ngp` on the FSA official
    dataset, and both harnesses assert that default rather than pinning it —
    a seed here would hide a regression in the boot path. */
export const INIT_LS = Object.freeze({
  'sfsa-ngp-seen-intro': '1',
  'sfsa-ngp-drawer': 'open',
});

/** RENDER EVIDENCE. A FUNCTION, never a string: a string predicate is eval'd
    in-page and the page's meta CSP has no 'unsafe-eval'.

    What the flag means: the payload joined and the first choropleth paint ran.
    It is NOT evidence of painted tiles, and nothing in CI should read it that
    way. It is stamped ONCE, at boot — view and dataset transitions after boot
    are sequenced by `data-ngp-view-seq` instead (see MARKERS below). */
export const renderEvidence = () => document.documentElement.dataset.ngpReady === '1';

/** How long the harnesses wait for render evidence: a 5 MB local payload plus
    a ~2 MB boundary archive over the network. Generous on purpose, because the
    failure it exists to catch is "never", not "slow". */
export const READY_MS = 60000;

/* ══════════════════════════════════════════════════════════════════════════
   READINESS MARKERS — what a harness may wait on
   Documented here because both harnesses wait on them and neither owns them.
   All are on `document.documentElement.dataset`, and every wait is a FUNCTION
   predicate (`page.waitForFunction((prev) => …, prev)`) — never a string, for
   the same CSP reason as renderEvidence.

   THIS TABLE IS DOCUMENTATION, not indirection: a predicate that runs in-page
   has to be self-contained, so the harnesses spell `dataset.ngpViewSeq` out
   inside their probes rather than closing over a name from here. Renaming a
   marker means changing the app, this table, and the probes that read it — the
   table exists so the third of those is findable.
   ══════════════════════════════════════════════════════════════════════════ */

export const MARKERS = Object.freeze({
  /** `data-ngp-ready` — '1', stamped once at boot. The boot gate. */
  ready: 'ngpReady',
  /** `data-ngp-view` — the active view's slug; 'ngp' at boot. */
  view: 'ngpView',
  /** `data-ngp-view-seq` — a monotonic integer, '1' at boot, incremented
      AFTER a fetch-involving view or dataset transition has recolored and
      flushed feature state (two rAFs — the kit coalesces one flush per frame,
      so a signature read at seq N is never the N−1 paint). */
  viewSeq: 'ngpViewSeq',
  /** `data-ngp-view-error` — '1' when a transition's fetch failed; deleted on
      the next success. It exists so a harness can assert the failure UI
      instead of timing out on a transition that will never complete. */
  viewError: 'ngpViewError',
});

/* ══════════════════════════════════════════════════════════════════════════
   THE PROBE TABLE — one entry per view ("interface")
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Everything the gates know about a view. PR 1 ships `ngp`; `usdm`,
 * `eligibility` and `disasters` land with their own PRs.
 *
 * Fields:
 *   slug        `?view=` value. The default view emits NO param at all.
 *   label       prose for check labels, not markup.
 *   isDefault   true for exactly one entry.
 *   switchSel   the view switcher's seg button (`aria-pressed` drives its
 *               styling, so aria-pressed is also what a harness reads).
 *   sectionSel  the switcher section itself, first child of the drawer scroll.
 *   county      a county with data and a polygon in BOTH boundary vintages, so
 *               no assertion depends on which side of 2015 the year sits.
 *   datasets    keyed by dataset id; exactly one `isDefault`. Per entry:
 *               `sel` (its seg button), `label`, `payload` (the basename the
 *               lazy-boot resource assertion looks for), `keySpace`
 *               ('fsa' → direct join; 'fips' → through the crosswalk), plus
 *               whatever that dataset makes true about the controls
 *               (`nominalYears` disables the year slider and unhides its
 *               note; `types` is how many options its dictionary offers).
 *   legend      which body each variable is expected to show, and — for a
 *               categorical view — the class labels and the no-data label the
 *               swatches must print in words.
 *   yearDomain  the first year the view's data covers. The LAST year is never
 *               a literal here: it grows with the archive (the USDM record
 *               gains a week every Tuesday), so the harness reads it from the
 *               live decoder and only the floor is frozen.
 *   exportName  the download filename regex for the view's default dataset.
 *   deepLink    a query string every param of which the view must honour on
 *               load, with `deepLinkExpect` naming what that link must produce.
 *   tableOracle async (page) → expected row count, read from the DECODER
 *               rather than from a number typed here. The convention for every
 *               oracle in this table: return a NUMBER, or a STRING saying why
 *               it could not be computed — the harness turns the string into a
 *               named skip instead of comparing a row count against null.
 *   paintOracle async (page) → how many counties should carry a colour.
 *   week        (a view with a time control inside the year) its selectors and
 *               the format its <output> owes a reader.
 *   unmatchedOracle async (page) → how many source areas this view's join
 *               cannot reach, for the count the live region must say out loud.
 *   extraChecks the view's own controls (a week scrubber, a source picker),
 *               each followed by a repaint witness and a clean(). NULL here
 *               when those checks need the harness's own paint-signature and
 *               marker probes: this file holds DATA and probes, never
 *               assertions (see the header), so the assertion body lives in
 *               tools/verify.mjs beside those probes and is passed to the
 *               section template at the call site. The selectors, formats and
 *               fixtures it reads still live here, in the entry — which is the
 *               part that has to be right for a NEW view to be gated.
 */
export const INTERFACES = Object.freeze({
  ngp: Object.freeze({
    slug: 'ngp',
    label: 'Grazing periods',
    isDefault: true,
    switchSel: '#btn-view-ngp',
    sectionSel: '#view-seg',
    county: Object.freeze({ id: '30063', name: 'Missoula' }),
    datasets: Object.freeze({
      fsa: Object.freeze({
        id: 'fsa',
        isDefault: true,
        label: 'FSA official (FOIA)',
        sel: '#btn-ngp-official',
        payload: 'fsa-normal-grazing-period.json',
        keySpace: 'fsa',
      }),
      nclimgrid: Object.freeze({
        id: 'nclimgrid',
        isDefault: false,
        label: 'nClimGrid climatology',
        sel: '#btn-ngp-nclimgrid',
        payload: 'nclimgrid-normal-grazing-period.json',
        keySpace: 'fips',
        /** One set of periods for all years: the year slider is disabled and
            `#year-note` is unhidden while this dataset is active. */
        nominalYears: true,
        noteSel: '#year-note',
        /** Its dictionary is three seasons, disjoint from the official pasture
            types — so the type select is REPOPULATED on the toggle, and the
            slug in the URL is interpreted against whichever dictionary is
            active. `fromDefaultType` is the seed the app's TYPE_ALIASES give
            it the first time, mapping the official default across. */
        types: 3,
        fromDefaultType: 'Full Season',
      }),
    }),
    legend: Object.freeze({
      kinds: Object.freeze({ start: 'wheel', end: 'wheel', duration: 'bar' }),
    }),
    /** 2008 is the first program year FSA published, and the payload's own
        `expect: { year0: 2008 }`. The ceiling is the archive's, not a literal.

        `clampSays` is the COPY CONTRACT for arriving here from a view that
        covers earlier years: the shared year is the visitor's, so moving it has
        to be said out loud, and a sentence that merely happens to mention 2008
        (every grazing-period announcement does) is not saying it. The exact
        wording is the app's to choose — this pattern only insists that the
        announcement acknowledges a MOVE. Widen it here if the copy changes. */
    yearDomain: Object.freeze({
      min: 2008,
      clampSays: /adjust|clamp|moved|nearest|closest|earliest|instead|outside|out of|does not (?:cover|go|reach)|only (?:goes|covers|reaches)|first (?:program )?year/i,
    }),
    exportName: /^fsa-ngp_\d{4}_[a-z0-9-]+_(start|end|duration)\.png$/,
    deepLink: '?county=30063&year=2012&type=native-pasture&variable=start',
    tableOracle: null,
    paintOracle: null,
    extraChecks: null,
  }),

  usdm: Object.freeze({
    slug: 'usdm',
    label: 'Drought monitor',
    isDefault: false,
    switchSel: '#btn-view-usdm',
    sectionSel: '#view-seg',
    /** The same county as the default view, deliberately: a state-memory round
        trip can only prove the SELECTION is the visitor's rather than the
        view's if both views can show it. Missoula is in all three USDM county
        sets and in both boundary vintages. */
    county: Object.freeze({ id: '30063', name: 'Missoula' }),

    /* Three answers to one question, and the difference between them is a
       fact about how the USDM is keyed rather than a modelling choice. All
       three are FIPS-keyed, so all three arrive through the crosswalk. */
    datasets: Object.freeze({
      'fsa-lfp': Object.freeze({
        id: 'fsa-lfp',
        isDefault: true,
        label: 'FSA LFP boundaries',
        sel: '#btn-usdm-fsa-lfp',
        payload: 'usdm-counties-fsa-lfp.json',
        keySpace: 'fips',
        /** FSA's own FOIA'd LFP boundary statistics: rectangular (every county
            in every week) and CT-clean, which is why it is the default. */
        rectangular: true,
      }),
      reported: Object.freeze({
        id: 'reported',
        isDefault: false,
        label: 'NDMC reported',
        sel: '#btn-usdm-reported',
        payload: 'usdm-counties-reported.json',
        keySpace: 'fips',
        rectangular: true,
        /** MEASURED, and the reason this dataset is not the default: NDMC keys
            Connecticut as the nine planning regions 09110–09190 for the whole
            record, and the FSA crosswalk has no row for any of them. So on a
            dd22 year exactly nine reported areas cannot reach an FSA county,
            and the app must COUNT them out loud rather than drop them. The
            harness still computes the number from the payload — this literal
            is what the live region is checked to be talking about, not the
            source of truth. (On a dd17 year it is eleven: Alaska's 02063 and
            02066 post-date that vintage's crosswalk too.) */
        unmatchedAtDefaultYear: 9,
      }),
      census: Object.freeze({
        id: 'census',
        isDefault: false,
        label: 'Census counties',
        sel: '#btn-usdm-census',
        payload: 'usdm-counties.json',
        keySpace: 'fips',
        /** Vintage-matched TIGER, so it is the one NON-rectangular set: a
            county absent from a week is a real '.' in the series, and the
            harness's absent-county copy is checked against this one. */
        rectangular: false,
      }),
    }),

    /** One variable, so one legend body — the categorical swatches the kit
        ships, into the `#legend-swatches` container PR 1 authored. The labels
        are the legend (a hue-only scheme has nothing left in grayscale), so
        they are frozen here in the order they must appear. `noData` is the
        outlined chip the kit appends LAST. */
    legend: Object.freeze({
      kind: 'swatches',
      items: Object.freeze(['None', 'D0 Abnormally dry', 'D1 Moderate',
        'D2 Severe', 'D3 Extreme', 'D4 Exceptional']),
      noData: "Not in this week's county set",
    }),

    /** 2000-01-04 is the first USDM week ever published; the ceiling moves
        every Tuesday, so the harness reads it from the decoder. */
    yearDomain: Object.freeze({ min: 2000 }),

    /** The week-within-year scrubber: the one control this view adds, and the
        only one in the app whose repaint is synchronous (no fetch, so no
        `data-ngp-view-seq` bump — see MARKERS). `outFormat` is the contract
        with the <output>: a human-readable Tuesday AND the week's place in its
        year, because "week 30" alone is not a date and "Jul 24, 2012" alone
        does not say how far through the year it is. */
    week: Object.freeze({
      sectionSel: '#week-section',
      rangeSel: '#week-range',
      outSel: '#week-out',
      prevSel: '#btn-week-prev',
      nextSel: '#btn-week-next',
      outFormat: /·\s*week\s+\d+\s+of\s+\d+/,
      /** The <output> is the harness's canonical week number: `?week` is
          1-based WITHIN THE YEAR, and reading the printed "week N of M" makes
          every assertion below independent of whether the range input happens
          to carry that number or an absolute week index. */
      outWeek: /week\s+(\d+)\s+of\s+(\d+)/i,
      param: 'week',
    }),

    exportName: /^usdm_(fsa-lfp|reported|census)_\d{4}-\d{2}-\d{2}\.png$/,

    deepLink: '?view=usdm&year=2012&week=30&county=30063',
    /** What that link MUST produce, all four measured against the published
        payloads rather than chosen: week 30 of 2012 is the Tuesday 2012-07-24
        (the grid is week0 + 7j from 2000-01-04, and 2012's first Tuesday, Jan
        3, lands exactly 626 weeks along it), and 2012 holds 52 Tuesdays —
        Jan 3 through Dec 25. The frozen contract's illustrative "week 30 of
        53" was 2008's count, not 2012's. A pre-2015 year draws on dd17. */
    deepLinkExpect: Object.freeze({
      year: 2012, week: 30, weeks: 52, label: 'Jul 24, 2012', vintage: 'dd17',
    }),

    /** Row for row, the crosswalked classes for the week on screen. Not a
        round number, and not typed here: at the default week (the latest the
        record holds) it is ~3,105 on FSA LFP boundaries and ~3,097 on the
        NDMC-reported set, and it changes every Tuesday. */
    tableOracle: async (page) => oracle(await usdmJoin(page), 'classed'),
    paintOracle: async (page) => oracle(await usdmJoin(page), 'painted'),
    /** How many reported areas the crosswalk cannot reach this week — the
        number the live region has to say out loud. */
    unmatchedOracle: async (page) => oracle(await usdmJoin(page), 'unmatched'),

    /** See the `extraChecks` note in the field list above: the week scrubber,
        the three dataset toggles and the year-domain re-author are asserted in
        tools/verify.mjs § the drought monitor's own controls, which is where
        the paint-signature and marker probes they need live. Everything those
        assertions READ — selectors, the <output> format, the deep-link
        fixture, the oracles — is in this entry. */
    extraChecks: null,
  }),
});

/**
 * The USDM week, joined onto the FSA composite the way the map's own colours
 * are, in one round trip — and INDEPENDENTLY of the descriptor that painted
 * them. This is the oracle behind `tableOracle`, `paintOracle` and
 * `unmatchedOracle`: it reads the live decoder and the live crosswalk through
 * the app's context, walks the week's classes itself, and re-implements the
 * one rule that matters (worst class wins over the FSA county's constituent
 * FIPS counties). A "check" that called the descriptor's own colorsFor() would
 * be comparing the app to itself.
 *
 * WHICH WEEK: the app's own selection if it carries one, else the number the
 * <output> prints, resolved against the decoder's `weekRange(year)`. The
 * fallback is there because the printed week is the CONTRACT (`?week` is
 * 1-based within the year) while the range input's units are an
 * implementation detail.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<object>} counts, or `{error}` if the view is not up yet.
 */
function usdmJoin(page) {
  // A THROW IS AN ANSWER. Every branch below reaches into the running app, and
  // an app whose view wiring is half-landed throws from inside the evaluate —
  // which rejects in Node and would abort the harness mid-section. The reason
  // travels back as `{error}` instead, and the oracle's caller turns it into a
  // named skip.
  return page.evaluate(async () => {
    try {
      const app = await import(new URL('js/app.js', document.baseURI).href);
      const c = app.ngpContext();
      const data = typeof c.getData === 'function' ? c.getData() : null;
      const xw = typeof c.getCrosswalk === 'function' ? c.getCrosswalk() : null;
      if (!data) return { error: 'the app has no active decoder' };
      if (!xw) return { error: 'the crosswalk has not been fetched' };
      if (typeof data.classesFor !== 'function') {
        return { error: 'the active decoder is not a USDM one (no classesFor)' };
      }
      const sel = typeof c.getSelection === 'function' ? c.getSelection() : {};
      const idx = c.getCounties() ? c.getCounties().index : new Map();
      const out = document.getElementById('week-out');
      const m = /week\s+(\d+)\s+of\s+(\d+)/i.exec((out && out.textContent) || '');
      const range = typeof data.weekRange === 'function' ? data.weekRange(sel.year) : null;
      let j = Number.isInteger(sel.week) ? sel.week : null;
      if (j === null && m && range) j = range[0] + Number(m[1]) - 1;
      if (j === null) return { error: 'could not tell which week is on screen' };

      const byFsa = new Map();
      const unmatched = [];
      for (const [fips, code] of data.classesFor(j)) {
        const fsa = xw.toFsa(sel.vintage, fips);
        if (!fsa.length) { unmatched.push(fips); continue; }
        for (const id of fsa) {
          const prev = byFsa.get(id);
          byFsa.set(id, prev === undefined ? code : Math.max(prev, code));
        }
      }
      let painted = 0;
      for (const id of byFsa.keys()) if (idx.has(id)) painted++;
      return {
        j, week: m ? Number(m[1]) : null, weeks: m ? Number(m[2]) : null,
        classed: byFsa.size, painted, unmatched: unmatched.length,
        unmatchedSample: unmatched.slice(0, 5),
        geometry: idx.size, dataset: sel.dataset, year: sel.year,
        vintage: sel.vintage,
      };
    } catch (err) {
      return {
        error: 'the join threw inside the app: ' + String(err).split('\n')[0],
      };
    }
  });
}

/** An oracle's answer, or the reason there isn't one — the string/number
    convention documented in the probe table's field list. */
function oracle(join, field) {
  return join.error ? join.error : join[field];
}

/** The default view — the one whose slug is never emitted. */
export const DEFAULT_INTERFACE = Object.values(INTERFACES)
  .find((i) => i.isDefault) || null;

/**
 * The FIPS↔FSA crosswalk: a committed repo asset, not a staged payload.
 *
 * FIPS-keyed payloads (nClimGrid here; USDM and disasters later) are joined
 * onto the FSA composite through this table, per vintage — dd17 and dd22 do
 * not hold the same county footprints, so a vintage swap re-joins. The pair
 * counts are the contract's: a legitimate archive rebuild that moves them
 * means updating this literal in the same commit as the asset.
 */
export const CROSSWALK = Object.freeze({
  path: 'assets/fsa-fips-crosswalk.json',
  schema: 'fsa-fips-crosswalk/1',
  vintages: Object.freeze(['dd17', 'dd22']),
  pairs: Object.freeze({ dd17: 3247, dd22: 3245 }),
});

/* ══════════════════════════════════════════════════════════════════════════
   THE SERVER
   ══════════════════════════════════════════════════════════════════════════ */

const MIME_TABLE = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.topojson': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Exported for a harness that needs to reason about a content type; the
    server below is the only thing that normally reads it. */
export const MIME = Object.freeze({ ...MIME_TABLE });

/**
 * Where to serve from: the workspace root, two levels up from this file
 * (tools/ → repo → workspace), unless a caller passes one.
 *
 * On a CI runner the checkout is at $GITHUB_WORKSPACE, whose basename is the
 * repository name, so the default is already right and no argument is needed.
 *
 * @param {string} [override] argv[1], if the invoker took one.
 * @returns {string} an absolute path.
 */
export function workspaceRoot(override) {
  return resolve(override
    || join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
}

/**
 * The static server both harnesses run: the workspace root, no compression, no
 * caching, CORS open, and 404 on anything outside the root.
 *
 * The caller owns `listen()` and `close()` — verify wants a base URL that
 * includes PAGE_PATH and a11y wants the bare origin, and a factory that
 * listened would have to guess.
 *
 * @param {string} root absolute path to serve.
 * @returns {import('node:http').Server} not yet listening.
 */
export function serveWorkspace(root) {
  return createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const f = normalize(join(root, p));
      if (!f.startsWith(root)) { res.writeHead(403).end(); return; }
      // Read BEFORE writing headers — the other order commits a 200 and only
      // then finds the file missing, and the catch dies with
      // ERR_HTTP_HEADERS_SENT on an already-sent response.
      const body = await readFile(f);
      res.writeHead(200, {
        'content-type': MIME_TABLE[extname(f)] || 'application/octet-stream',
        'access-control-allow-origin': '*',
      });
      res.end(body);
    } catch { res.writeHead(404).end('not found'); }
  });
}
