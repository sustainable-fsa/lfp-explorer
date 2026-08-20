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
 *   legend      which body each variable is expected to show.
 *   exportName  the download filename regex for the view's default dataset.
 *   deepLink    a query string every param of which the view must honour on
 *               load.
 *   tableOracle (PR 2+) async (page) → expected row count, read from the
 *               decoder rather than from a number typed here.
 *   extraChecks (PR 2+) async ({page, check, clean, shot}) → the view's own
 *               controls (a week scrubber, a source picker), each followed by
 *               a repaint witness and a clean().
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
    exportName: /^fsa-ngp_\d{4}_[a-z0-9-]+_(start|end|duration)\.png$/,
    deepLink: '?county=30063&year=2012&type=native-pasture&variable=start',
    tableOracle: null,
    extraChecks: null,
  }),
});

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
