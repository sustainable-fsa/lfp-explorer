#!/usr/bin/env node
/* ============================================================================
   LFP Explorer · tools/verify.mjs
   The deploy gate. Boots the app on a local static server and drives every
   route a user has, asserting that each one does the thing it exists to do —
   and that the console stays silent the whole way through.

     node tools/verify.mjs [workspaceRoot]

   Tooling is dev-only, in tools/package.json:

     npm ci --prefix tools
     npx --prefix tools playwright install --with-deps chromium

   ── Adapted from sustainable-fsa/style tools/consumer-verify.mjs ───────────
   That file is a SKELETON with an empty `appAsserts` array and a standing note
   that a run with it empty "proves nothing about what your app is FOR". This
   is that array, filled: every section below is about something this county
   choropleth is actually for. The run prints its own passed/failed/skipped
   count at the end — that is the count, and it is the only place one is
   maintained. Nothing here is numbered by hand.

   Deltas from the skeleton, and why:

     · THE WORKSPACE ROOT IS SERVED, not the repo, with the app at
       /lfp-explorer/. It matches the documented dev command
       (`python3 -m http.server 8000 -d <workspace>`), so a path bug that only
       shows up under a subdirectory deploy shows up here too. Everything the
       app loads from sustainable-fsa.com (the pinned style kit, the two county
       boundary archives) is fetched LIVE over the network — those origins are
       part of the contract, and a run that stubbed them would be verifying a
       different app.

     · THE ASSERTIONS DRIVE THE UI, not the state object. The year moves by
       dispatching `input` on the range; the pasture type by `change` on the
       select; a county opens by a real mouse click at the pixel MapLibre
       projects its centroid to. Where the app's own module API is used at all
       (`ngpContext()`, reached by a dynamic import that hits the page's module
       registry) it is to READ evidence or to reach a county that has no
       polygon to click — never to fake an interaction.

     · CONSOLE-CLEAN IS CHECKED AFTER EVERY STEP, not once at the end, so a
       CSP violation or a caught-and-logged failure is attributed to the
       interaction that caused it. With a meta CSP live this is the check that
       catches a stale anti-flash hash or a directive missing an origin — the
       page still renders, so the failure is otherwise invisible.

     · RENDER EVIDENCE IS `ngpReady`, and that flag means the payload joined
       and the first choropleth paint ran. It is NOT evidence of painted tiles.
       Nothing in CI should read it that way. It is a BOOT stamp only:
       transitions after boot (a view switch, a dataset toggle) are sequenced
       by `data-ngp-view-seq`, which the app bumps after the transition's
       recolor and feature-state flush. See tools/config.mjs § MARKERS.

     · EVERY FACT ABOUT THE APP THAT THE a11y HARNESS ALSO NEEDS lives in
       tools/config.mjs, including the per-view probe table this file's
       interface sections read. Verify-only knobs stay in CONFIG below.

   Screenshots of every state land in verify-out/ (gitignored).
   ========================================================================== */
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  CROSSWALK, DEFAULT_INTERFACE, INTERFACES, INIT_LS, PAGE_PATH, READY_MS,
  THEMES, VIEWPORTS, renderEvidence, serveWorkspace, workspaceRoot,
} from './config.mjs';

/* ══════════════════════════════════════════════════════════════════════════
   CONFIG
   The shared half comes from tools/config.mjs, which a11y-audit.mjs imports
   too — page path, themes, viewports, localStorage seeds, the ngpReady
   predicate and its timeout, the probe table, the server. It is re-exposed on
   CONFIG rather than used directly so this file still reads as one block of
   settings, and so a reader who changes a shared number is sent to the file
   that owns it. Everything below the shared block is verify-only.
   ══════════════════════════════════════════════════════════════════════════ */
const CONFIG = {
  /** Workspace root: tools/ → repo → workspace. Override with argv[1]. */
  root: workspaceRoot(process.argv[2]),

  /** Shared with a11y-audit — see tools/config.mjs. */
  pagePath: PAGE_PATH,
  themes: THEMES,
  viewports: VIEWPORTS,
  initLocalStorage: INIT_LS,
  renderEvidence,
  readyMs: READY_MS,

  /** The per-view probe table. PR 1 holds one entry, `ngp`; the interface
      section template at the bottom of this file consumes the rest as they
      land. */
  interfaces: INTERFACES,

  /** Extra settle after the evidence fires: the font swap, the legend, the
      map's final frames. */
  settleMs: 2000,

  /** How long a dataset or view transition may take: the payload fetch, the
      crosswalk fetch, the join, the recolor and the two-rAF flush. Longer than
      a synchronous repaint's 400ms and shorter than the boot budget — the
      failure it catches is a transition that never completes. */
  switchMs: 30000,

  screenshotDir: resolve(join(dirname(fileURLToPath(import.meta.url)), '..', 'verify-out')),

  /** The county every state-dependent assertion uses. Missoula County, MT:
      data in every program year, and a polygon in BOTH boundary vintages, so
      no assertion below depends on which side of 2015 the slider sits. */
  county: INTERFACES.ngp.county,

  /** The source id the kit's addCountyLayers creates. Feature state lives
      here, and feature state is how a repaint is proved. */
  sourceId: 'sfsa-counties',
};
/* ══════════════════════════════════════════════════════════════════════════ */

/** The pinned kit build, imported IN-PAGE by three probes below (a county
    centroid is the kit's arithmetic, not this file's). One constant so a
    version bump or a dev-state sweep has exactly one site to hit here —
    README § Developing against an unreleased kit lists this file alongside
    index.html and js/. It is passed INTO page.evaluate as an argument: a
    string built in-page from an outer-scope binding would not exist. */
const KIT_COUNTY_URL = 'https://sustainable-fsa.com/style/v0.2.0/county/county.js';

const server = serveWorkspace(CONFIG.root);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}${CONFIG.pagePath}`;

await rm(CONFIG.screenshotDir, { recursive: true, force: true });
await mkdir(CONFIG.screenshotDir, { recursive: true });

const browser = await chromium.launch({
  // A GitHub runner has no GPU; without a software rasterizer MapLibre never
  // gets a WebGL context and ngpReady never fires.
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
  ],
});

/* ── Reporting ───────────────────────────────────────────────────────────── */

let failures = 0;
let skips = 0;
const results = [];

function check(label, ok, detail = '') {
  results.push({ label, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${ok || !detail ? '' : ' — ' + detail}`);
  if (!ok) failures++;
}

function skip(label, why) {
  skips++;
  results.push({ label, ok: null, detail: why });
  console.log(`  ○ ${label} — SKIPPED: ${why}`);
}

function section(name) { console.log(`\n${name}`); }

/* ── Session ─────────────────────────────────────────────────────────────── */

/**
 * Open the app in a fresh context and wait for real render evidence.
 *
 * @param {{query?: string, viewport?: object, theme?: string,
 *          storage?: object, permissions?: string[], downloads?: boolean,
 *          requireReady?: boolean}} [opts]
 */
async function open({
  query = '', viewport = CONFIG.viewports.wide, theme = 'light',
  storage = {}, permissions = [], downloads = false, requireReady = true,
  touch = false,
} = {}) {
  const ctx = await browser.newContext({
    viewport,
    acceptDownloads: downloads,
    permissions,
    // hasTouch is what makes `(hover: none)` and `(pointer: coarse)` MATCH. A
    // plain 375px desktop context still reports a fine pointer, so every
    // touch-target rule the kit ships behind `@media (hover: none)` stays
    // inert and a WCAG 2.5.5 measurement taken there is meaningless.
    hasTouch: touch,
    // Not a real origin grant until a page is loaded; Playwright scopes
    // permissions per-origin, so this is set again after goto below.
    baseURL: base,
  });
  await ctx.addInitScript((kv) => {
    for (const [k, v] of Object.entries(kv)) {
      try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ }
    }
  }, { ...CONFIG.initLocalStorage, 'sfsa-theme': theme, ...storage });

  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).split('\n')[0]));
  const downloadList = [];
  page.on('download', (d) => downloadList.push(d));

  await page.goto(base + query, { waitUntil: 'load', timeout: 60000 });
  let ready = true;
  if (requireReady) {
    try {
      await page.waitForFunction(CONFIG.renderEvidence, null, { timeout: CONFIG.readyMs });
    } catch (err) {
      ready = false;
      errors.push('render evidence (ngpReady) never fired: ' + String(err).split('\n')[0]);
    }
  }
  await page.waitForTimeout(CONFIG.settleMs);

  /** Drain the console errors seen so far and report them under `label`. */
  const clean = (label) => {
    const seen = errors.splice(0, errors.length);
    check(`console clean · ${label}`, seen.length === 0,
      seen.slice(0, 3).join(' | ') + (seen.length > 3 ? ` (+${seen.length - 3} more)` : ''));
  };

  const shot = async (name) => {
    await page.screenshot({ path: join(CONFIG.screenshotDir, name + '.png') });
  };

  // `downloads` is the LIST (always an array, so never a flag); the flag is
  // separate, because a caller that did not ask for downloads must not have its
  // export step run — an empty array is truthy, and the section template used
  // to read it as "this session can download".
  return {
    ctx, page, errors, ready, clean, shot,
    downloads: downloadList, acceptsDownloads: downloads,
  };
}

/* ── In-page probes ──────────────────────────────────────────────────────────
   Every one of these reaches the LIVE app module: `js/app.js` is the page's
   entry point, and a dynamic import of the same URL hits the module registry
   and hands back the running instance rather than a second copy. The import is
   a module fetch, so it is `script-src 'self'`; nothing here builds a function
   from a string, which the CSP would (correctly) block. */

/** State + vintage + geometry count, in one round trip.
 *
 * `state.dataset` is a CONVENIENCE the app does not carry: the active view's
 * dataset lives in the per-view `viewState`, not in shared state, because two
 * views remember their own. It is folded in here so every assertion that
 * compares "the view" can compare one flat object. Both shapes `getViewState()`
 * may hand back are accepted — the whole per-view map, or just the active
 * view's slice — so this probe does not have to be edited if that seam is
 * tightened later.
 *
 * A HALF-BOOTED PAGE IS AN ANSWER, not an exception. A page whose boot failed
 * has no map and no geometry index, and reading a centre off it used to throw
 * out of the middle of a section — which aborted the process and took the
 * summary, and every assertion after it, with it (the same reasoning as the
 * crosswalk probe in §7). Nulls travel back instead; the comparisons that use
 * them fail as named checks with the nulls printed. */
const snapshot = (page) => page.evaluate(async () => {
  const app = await import(new URL('js/app.js', document.baseURI).href);
  const c = app.ngpContext();
  const state = c.getState();
  const vs = typeof c.getViewState === 'function' ? c.getViewState() : null;
  const slice = vs && (typeof vs.dataset === 'string' ? vs : vs[state.view]);
  const map = c.getMap();
  return {
    state: { ...state, dataset: (slice && slice.dataset) || null },
    viewState: slice || null,
    vintage: c.getVintage(),
    geometryCount: c.getCounties() ? c.getCounties().index.size : 0,
    center: map ? map.getCenter().toArray() : [null, null],
    zoom: map ? map.getZoom() : null,
    markers: { ...document.documentElement.dataset },
  };
});

/**
 * Click a control and say whether it was there to click.
 *
 * Used for the view and dataset seg buttons only. Everywhere else in this file
 * a bare `.click()` is right: a missing #btn-table is a broken app and a
 * Playwright timeout is a fine way to say so. These buttons are different —
 * they are the newest markup in the page, they are what a half-landed refactor
 * omits, and a run that aborted on the first one would report nothing about
 * the twenty assertions after it. A false here fails ONE named check with a
 * reason, and the checks that depended on the click fail with their own
 * evidence instead of a stack trace.
 */
const clickControl = (page, sel) => page.locator(sel)
  .click({ timeout: 5000 }).then(() => true).catch(() => false);

/** The transition sequence marker as a number, or 0 if the app never stamped
    one. Every wait on it is a function predicate over this value. */
const viewSeq = (page) => page.evaluate(
  () => Number(document.documentElement.dataset.ngpViewSeq || 0));

/**
 * Wait for a view or dataset transition to finish, by the app's own marker:
 * `data-ngp-view-seq` is bumped only AFTER the transition has recolored and
 * flushed feature state (two rAFs), so a signature read after this resolves is
 * never the previous paint. Returns false on timeout rather than throwing —
 * the caller turns that into a named failure instead of a stack trace.
 */
const awaitViewSeq = async (page, prev, ms = CONFIG.switchMs) => {
  const bumped = await page.waitForFunction(
    (before) => Number(document.documentElement.dataset.ngpViewSeq || 0) > before,
    prev, { timeout: ms }).then(() => true).catch(() => false);
  await settleFrames(page);
  return bumped;
};

/** Every resource URL the page has fetched so far, as basenames. The lazy-boot
    assertion is about which payloads are NOT in here. */
const resourceNames = (page) => page.evaluate(
  () => performance.getEntriesByType('resource').map((e) => e.name));

/**
 * Everything the drawer says about the active view and dataset, in one round
 * trip: which seg buttons are pressed, what the type dictionary currently
 * offers, whether the year control is live, and which legend body is showing.
 *
 * `aria-pressed` is read rather than a class, because aria-pressed is what the
 * kit styles a seg button from (HOUSE-STYLE): if the attribute is wrong the
 * button LOOKS wrong, so there is no second source of truth to check against.
 *
 * DATASET BUTTONS ARE COUNTED PER VIEW, not per document. Every view's dataset
 * seg is in the markup at all times — `syncSections()` hides the ones that do
 * not belong to the active view — so from PR 2 on `[data-dataset]` matches five
 * buttons and two of them are pressed, one in each view's own remembered state.
 * Reading them all would make "the dataset seg offers both grazing-period
 * datasets, with one pressed" false the moment a second view exists, and it
 * would be false about the app rather than about a bug. The filter is the
 * `hidden` attribute on the owning `[data-view]` section, not a client rect: on
 * a phone the whole drawer is `visibility: hidden` and every control in it
 * would otherwise read as out of play.
 */
const viewControls = (page) => page.evaluate(() => {
  const el = (id) => document.getElementById(id);
  const live = (n) => !n.closest('[data-view][hidden]');
  const inPlay = (sel) => Array.from(document.querySelectorAll(sel)).filter(live);
  const pressed = (sel) => inPlay(sel)
    .filter((b) => b.getAttribute('aria-pressed') === 'true');
  const note = el('year-note');
  const text = (n) => (n ? (n.textContent || '').trim() : null);
  const visible = (n) => !!(n && !n.hidden && n.getClientRects().length > 0);
  const bodyState = (id) => { const n = el(id); return n ? !n.hidden : null; };
  return {
    views: pressed('[data-view-btn]').map((b) => b.dataset.viewBtn),
    viewBtns: inPlay('[data-view-btn]').length,
    datasets: pressed('[data-dataset]').map((b) => b.dataset.dataset),
    datasetBtns: inPlay('[data-dataset]').length,
    types: Array.from(document.querySelectorAll('#type-select option'))
      .map((o) => o.value),
    type: el('type-select') ? el('type-select').value : null,
    year: el('year-range') ? el('year-range').value : null,
    /** The year slider's DOMAIN, not just its value: a view whose data starts
        in 2000 re-authors min/max on the way in and hands them back on the way
        out, and a stale domain is invisible until someone drags to a year the
        active payload has never heard of. */
    yearMin: el('year-range') ? el('year-range').min : null,
    yearMax: el('year-range') ? el('year-range').max : null,
    yearDisabled: el('year-range') ? el('year-range').disabled : null,
    noteShown: visible(note),
    noteText: text(note),
    legend: {
      wheel: bodyState('legend-wheel'),
      bar: bodyState('legend-bar'),
      swatches: bodyState('legend-swatches'),
      key: text(el('legend-key')),
    },
    sections: Array.from(document.querySelectorAll('.sfsa-drawer-scroll [data-view]'))
      .map((s) => ({ id: s.id, view: s.dataset.view, hidden: s.hidden })),
  };
});

/**
 * A fingerprint of what the choropleth is actually painting: how many counties
 * carry a color in MapLibre's feature state, and a hash of those colors in
 * geometry order. Two snapshots that differ prove a repaint reached GL; two
 * that match prove it did not.
 */
const paintSignature = (page, sourceId) => page.evaluate(async (src) => {
  const app = await import(new URL('js/app.js', document.baseURI).href);
  const c = app.ngpContext();
  const map = c.getMap();
  let colored = 0;
  let hash = 5381;
  // No map or no geometry means nothing is painted, which is a signature too —
  // and one that fails every "the paint changed" comparison rather than
  // throwing the run away.
  if (!map || !c.getCounties()) return { colored: 0, hash: 0 };
  for (const id of c.getCounties().index.keys()) {
    const st = map.getFeatureState({ source: src, id });
    const color = (st && st.color) || '';
    if (color) colored++;
    for (let i = 0; i < color.length; i++) {
      hash = (Math.imul(hash, 33) ^ color.charCodeAt(i)) >>> 0;
    }
  }
  return { colored, hash };
}, sourceId);

/** The paint color of one county, straight out of feature state. Null if there
    is no map to ask — see snapshot() on why a broken boot does not throw. */
const colorOf = (page, id, sourceId) => page.evaluate(async ([i, src]) => {
  const app = await import(new URL('js/app.js', document.baseURI).href);
  const map = app.ngpContext().getMap();
  const st = map && map.getFeatureState({ source: src, id: i });
  return (st && st.color) || null;
}, [id, sourceId]);

/** Move the year slider the way a pointer does: set the value, fire `input`. */
const slideYear = (page, year) => page.evaluate((y) => {
  const el = document.getElementById('year-range');
  el.value = String(y);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, year);

/** Two animation frames — the kit coalesces feature-state writes to one flush
    per frame, so a signature read in the same task reads the OLD paint. */
const settleFrames = (page) => page.evaluate(() => new Promise((r) => {
  requestAnimationFrame(() => requestAnimationFrame(r));
}));

/**
 * What a screen reader has just been told.
 *
 * The kit's `createLiveRegion()` appends one `div.sr-only[aria-live=polite]` to
 * <body> and the app announces into it; `createToast()` makes a SECOND polite
 * region for the visible pill, which is a different message to a different
 * reader. Excluding the toast is what keeps "the live region said N counties"
 * from passing on "switching boundaries…".
 */
const liveText = (page) => page.evaluate(() => Array.from(
  document.querySelectorAll('[aria-live="polite"]:not(.sfsa-toast)'))
  .map((n) => (n.textContent || '').trim()).filter(Boolean).join(' | '));

/**
 * A boundary-vintage swap, waited out.
 *
 * Any year move across 2015 kicks off a debounced archive fetch and shows the
 * transient pill; a signature read before it lands is a read of the old
 * geometry. The main run asserts the pill and the swap in their own section —
 * this is the version for the sections that merely need to GET to a year.
 */
const settleVintage = async (page) => {
  await page.waitForFunction(() => document.getElementById('app-note').hidden,
    null, { timeout: CONFIG.switchMs }).catch(() => {});
  await page.waitForTimeout(500);
  await settleFrames(page);
};

/** A drawer slide is 0.2s of CSS transition and THEN the app's post-transition
    `map.resize()` (240ms, so the resize lands on the final geometry rather than
    mid-slide). Both have to be over before a width is worth reading; 600ms
    clears them with room for a slow runner. */
const settleDrawer = async (page) => {
  await page.waitForTimeout(600);
  await settleFrames(page);
};

/**
 * Everything about the drawer, the map frame and the two toggles in one round
 * trip. The three widths are the point: `drawerW` says the drawer moved,
 * `frameW` says the layout followed, and `canvasW` says MapLibre was told —
 * a canvas that lags the frame is the letterboxing bug this exists to catch.
 *
 * Visibility, not client rects, is what a closed drawer offers: `.is-closed`
 * slides it out with `margin-left` and hides it with `visibility: hidden`, and
 * a `visibility: hidden` box still reports rects. The edge tab and the navbar
 * hamburger ARE display-toggled, so those two read as rects.
 */
const drawerGeom = (page) => page.evaluate(() => {
  const drawer = document.getElementById('drawer');
  const frame = document.getElementById('map-frame');
  const tab = document.getElementById('drawer-tab');
  const toggle = document.getElementById('btn-drawer');
  const scrim = document.getElementById('drawer-scrim');
  const search = document.getElementById('county-search');
  const nav = document.querySelector('header.sfsa-navbar');
  const cs = getComputedStyle(drawer);
  const shown = (el) => !!(el && el.getClientRects().length > 0);
  return {
    closed: drawer.classList.contains('is-closed'),
    drawerW: Math.round(drawer.getBoundingClientRect().width),
    position: cs.position,
    visibility: cs.visibility,
    zIndex: cs.zIndex,
    transform: cs.transform,
    frameW: frame.clientWidth,
    frameH: frame.clientHeight,
    canvasW: (() => {
      const c = document.querySelector('#map .maplibregl-canvas');
      return c ? Math.round(c.getBoundingClientRect().width) : null;
    })(),
    winW: document.documentElement.clientWidth,
    tabShown: shown(tab),
    tabExpanded: tab ? tab.getAttribute('aria-expanded') : null,
    toggleShown: shown(toggle),
    toggleExpanded: toggle ? toggle.getAttribute('aria-expanded') : null,
    scrimShown: shown(scrim) && !scrim.hidden,
    scrimZ: scrim ? getComputedStyle(scrim).zIndex : null,
    scrimTop: scrim ? Math.round(scrim.getBoundingClientRect().top) : null,
    navBottom: nav ? Math.round(nav.getBoundingClientRect().bottom) : null,
    searchInDrawer: !!(search && drawer.contains(search)),
    searchVisible: !!(search && search.getClientRects().length > 0
      && getComputedStyle(search).visibility !== 'hidden'),
    stored: (() => {
      try { return localStorage.getItem('sfsa-ngp-drawer'); }
      catch (e) { return 'unavailable'; }
    })(),
  };
});

/** translateX(0) computes to either `none` or the identity matrix, depending on
    whether anything else on the element also produced a transform. */
const noTranslate = (t) => t === 'none' || /^matrix\(1,\s*0,\s*0,\s*1,\s*0,\s*0\)$/.test(t);

/* ══════════════════════════════════════════════════════════════════════════
   1. THE MAIN RUN — light theme, 1440×900, one page, in order.
   ══════════════════════════════════════════════════════════════════════════ */

section('▸ Main run — light · 1440×900');

const main = await open({ permissions: ['clipboard-read', 'clipboard-write'] });
{
  const { page, clean, shot } = main;

  check('ngpReady fired (payload joined, first choropleth paint ran)', main.ready);
  clean('boot');
  await shot('01-boot');

  const boot = await snapshot(page);
  check('boot state is the documented default (grazing periods · FSA official · '
    + '2026 · Native Pasture · duration)',
  boot.state.view === 'ngp' && boot.state.dataset === 'fsa'
    && boot.state.year === 2026 && boot.state.type === 'Native Pasture'
    && boot.state.variable === 'duration',
  JSON.stringify(boot.state));
  check('an all-defaults view emits a CLEAN url (no query string)',
    new URL(page.url()).search === '', 'search is ' + new URL(page.url()).search);
  /* The two newest params get their own assertion rather than riding on the
     one above: `?view=` and `?dataset=` are the ones a refactor is most likely
     to start emitting unconditionally, and "the whole search string is empty"
     names the symptom without naming the cause. */
  check('the defaults emit NEITHER ?view NOR ?dataset — the app boots on its '
    + 'first view and that view\'s first dataset, and says nothing about it',
  !new URL(page.url()).searchParams.has('view')
    && !new URL(page.url()).searchParams.has('dataset'), page.url());
  check('boot vintage follows the program year (2026 → dd22)',
    boot.vintage === 'dd22', 'vintage is ' + boot.vintage);

  /* ── The boot path fetches ONE payload ──────────────────────────────────
     This is the guarantee Lighthouse cannot express: the app now knows about
     more than one dataset, and the LCP it is measured on is the one where
     exactly one of them has been fetched. Everything else — the nClimGrid
     climatology, the three USDM county sets, the FIPS↔FSA crosswalk — is lazy,
     fetched on the switch or toggle that needs it. A speculative prefetch added
     "for smoothness" would fail here, and would also cost the best-practices
     score a console error if it 404'd. Resource entries, not request
     interception: this is what the page's own performance timeline says it went
     and got.

     The lazy list is DERIVED from the probe table rather than typed: it is
     every dataset in the app except the default view's default one, so a fifth
     payload is covered here by the commit that adds it to config.mjs. */
  {
    const NGP = CONFIG.interfaces.ngp;
    const fetched = await resourceNames(page);
    const has = (needle) => fetched.filter((n) => n.includes(needle));
    const official = has(NGP.datasets.fsa.payload);
    const lazy = [...has(CROSSWALK.path.split('/').pop())];
    let lazyCount = 0;
    for (const iface of Object.values(CONFIG.interfaces)) {
      for (const ds of Object.values(iface.datasets)) {
        if (iface.isDefault && ds.isDefault) continue;
        lazyCount++;
        lazy.push(...has(ds.payload));
      }
    }
    check('the boot path fetched the FSA official grazing-period payload',
      official.length > 0, `${fetched.length} resources, none named `
      + JSON.stringify(NGP.datasets.fsa.payload));
    check(`…and NOTHING ELSE: all ${lazyCount} other datasets and the crosswalk `
      + 'stay lazy until something asks for them (the LCP guarantee)',
    lazy.length === 0, lazy.join(' | '));
  }

  /* ── The rendered space is the PROJECTED one ─────────────────────────────
     MapLibre has no conic projection, so the app runs every county coordinate
     through EPSG:5070 and rescales the result into a fixed 10 × 6.075 box of
     dummy degrees centred on (0, 0) (js/projection.js). Nothing else in this
     file would notice if that regressed: the choropleth, the card, the search
     and the URL all work exactly the same on raw lng/lat, and the only symptom
     would be a Mercator-stretched map nobody's assertion looks at. So assert
     the thing that is true ONLY when the projected space is what is on screen —
     the default fit frames that box and nothing like a continent's worth of
     degrees. */
  const framing = await page.evaluate(async () => {
    const app = await import(new URL('js/app.js', document.baseURI).href);
    const proj = await import(new URL('js/projection.js', document.baseURI).href);
    const b = app.ngpContext().getMap().getBounds();
    return {
      view: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
      box: [proj.PROJECTED_BOUNDS[0][0], proj.PROJECTED_BOUNDS[0][1],
        proj.PROJECTED_BOUNDS[1][0], proj.PROJECTED_BOUNDS[1][1]],
    };
  });
  {
    const [vw, vs, ve, vn] = framing.view;
    const [bw, bs, be, bn] = framing.box;
    const show = (a) => '[' + a.map((n) => n.toFixed(3)).join(', ') + ']';
    check('the map renders the EPSG:5070 projected space: the default view '
      + 'contains the whole dummy box and little more',
    vw <= bw && vs <= bs && ve >= be && vn >= bn
      && (ve - vw) < (be - bw) * 1.6 && (vn - vs) < (bn - bs) * 1.6,
    `view ${show(framing.view)} against box ${show(framing.box)}`);
  }

  /* ── 1a. Year slider → repaint ──────────────────────────────────────────
     "The slider moved and the map changed" is the app's core claim. Prove it
     on a county whose duration is KNOWN to differ between the two years, and
     stay on one side of 2015 so a vintage swap cannot be what changed. */
  section('▸ Year slider → repaint');
  const yearProbe = await page.evaluate(async () => {
    const d = await import(new URL('js/data.js', document.baseURI).href);
    const app = await import(new URL('js/app.js', document.baseURI).href);
    const { year, type } = app.ngpContext().getState();
    const ids = [...app.ngpContext().getCounties().index.keys()];
    for (const y of d.years()) {
      if (y === year || y < 2015) continue;   // one vintage only
      const now = d.getYearType(year, type);
      const then = d.getYearType(y, type);
      for (const id of ids) {
        const a = now.get(id);
        const b = then.get(id);
        if (a && b && a.duration_weeks !== b.duration_weeks) {
          return { year: y, id, from: a.duration_weeks, to: b.duration_weeks };
        }
      }
    }
    return null;
  });

  if (!yearProbe) {
    skip('year slider repaints the choropleth',
      'no county changes duration between two dd22 program years — the data '
      + 'cannot support this assertion');
  } else {
    const sigBefore = await paintSignature(page, CONFIG.sourceId);
    const colorBefore = await colorOf(page, yearProbe.id, CONFIG.sourceId);
    await slideYear(page, yearProbe.year);
    await page.waitForTimeout(400);
    await settleFrames(page);
    const sigAfter = await paintSignature(page, CONFIG.sourceId);
    const colorAfter = await colorOf(page, yearProbe.id, CONFIG.sourceId);
    const after = await snapshot(page);

    check(`year slider moved the app to ${yearProbe.year}`,
      after.state.year === yearProbe.year, 'state.year is ' + after.state.year);
    check('the <output> under the thumb tracks the slider',
      (await page.locator('#year-out').textContent()) === String(yearProbe.year));
    check(`county ${yearProbe.id} repainted `
      + `(${yearProbe.from} wk → ${yearProbe.to} wk)`,
      !!colorBefore && !!colorAfter && colorBefore !== colorAfter,
      `feature-state color ${colorBefore} → ${colorAfter}`);
    check('the whole choropleth repainted (feature-state signature changed)',
      sigBefore.hash !== sigAfter.hash,
      `${sigBefore.colored} colored @${sigBefore.hash} → ${sigAfter.colored} @${sigAfter.hash}`);
    check('the year is mirrored into the URL',
      new URL(page.url()).searchParams.get('year') === String(yearProbe.year),
      page.url());
    clean('year slider');
    await shot('02-year-slider');
  }

  /* ── 1b. Pasture type → repaint ─────────────────────────────────────────── */
  section('▸ Pasture type → repaint');
  const typeProbe = await page.evaluate(async () => {
    const d = await import(new URL('js/data.js', document.baseURI).href);
    const app = await import(new URL('js/app.js', document.baseURI).href);
    const { year, type } = app.ngpContext().getState();
    const ids = [...app.ngpContext().getCounties().index.keys()];
    const now = d.getYearType(year, type);
    for (const t of d.types()) {
      if (t === type) continue;
      const other = d.getYearType(year, t);
      if (!other.size) continue;
      for (const id of ids) {
        const a = now.get(id);
        const b = other.get(id);
        if (a && b && a.duration_weeks !== b.duration_weeks) return { type: t, id };
      }
    }
    return null;
  });

  if (!typeProbe) {
    skip('pasture type repaints the choropleth', 'no second type differs on any county');
  } else {
    const sigBefore = await paintSignature(page, CONFIG.sourceId);
    await page.selectOption('#type-select', typeProbe.type);
    await page.waitForTimeout(400);
    await settleFrames(page);
    const sigAfter = await paintSignature(page, CONFIG.sourceId);
    const after = await snapshot(page);
    check(`pasture type select changed the app to ${JSON.stringify(typeProbe.type)}`,
      after.state.type === typeProbe.type, 'state.type is ' + after.state.type);
    check('the choropleth repainted for the new type',
      sigBefore.hash !== sigAfter.hash,
      `${sigBefore.colored} colored @${sigBefore.hash} → ${sigAfter.colored} @${sigAfter.hash}`);
    check('the type is mirrored into the URL as a slug',
      /^[a-z0-9-]+$/.test(new URL(page.url()).searchParams.get('type') || ''),
      page.url());
    clean('type select');
    await shot('03-type-select');
    // Back to the default so the rest of the run reads against known data.
    await page.selectOption('#type-select', 'Native Pasture');
    await page.waitForTimeout(300);
  }

  /* ── 1c. Color-by → aria-pressed + the right legend body ───────────────── */
  section('▸ Color-by buttons → aria-pressed + legend swap');
  for (const [variable, cyclic] of [['start', true], ['end', true], ['duration', false]]) {
    await page.locator('#btn-var-' + variable).click();
    await page.waitForTimeout(300);
    await settleFrames(page);
    const st = await page.evaluate(() => ({
      pressed: Array.from(document.querySelectorAll('.seg-btn[data-variable]'))
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
        .map((b) => b.dataset.variable),
      wheelHidden: document.getElementById('legend-wheel').hidden,
      barHidden: document.getElementById('legend-bar').hidden,
      wheelHasSvg: !!document.querySelector('#legend-wheel svg'),
      key: (document.getElementById('legend-key').textContent || '').trim(),
    }));
    check(`color-by ${variable}: exactly one button is aria-pressed, and it is this one`,
      st.pressed.length === 1 && st.pressed[0] === variable,
      'pressed = ' + JSON.stringify(st.pressed));
    check(`color-by ${variable}: the ${cyclic ? 'month wheel' : 'colorbar'} is the visible legend`,
      st.wheelHidden === !cyclic && st.barHidden === cyclic,
      `#legend-wheel hidden=${st.wheelHidden}, #legend-bar hidden=${st.barHidden}`);
    check(`color-by ${variable}: the text key is present (color is never the only channel)`,
      st.key.length > 40, JSON.stringify(st.key.slice(0, 60)));
    if (cyclic) {
      check('the month wheel is a real drawing, not the placeholder',
        st.wheelHasSvg, '#legend-wheel has no <svg>');
    }
    await shot('04-legend-' + variable);
  }
  clean('color-by buttons');

  /* ── 1d. Drag across 2015 → boundary vintage swap ───────────────────────
     A real drag: several `input` events in a row crossing the line once. The
     app debounces the swap by 250ms for exactly this reason, and the pill it
     shows while the archive is in flight is transient — so the swap is proved
     by the geometry count and the vintage, and the pill is caught if it can
     be. Mixing vintages inside a year would be a data-integrity bug, not a
     cosmetic one (kit county.js: dd17 ≤ 2014, dd22 ≥ 2015). */
  section('▸ Year drag across 2015 → boundary vintage swap');
  {
    const before = await snapshot(page);
    let sawPill = false;
    const pillWatch = page.waitForFunction(
      () => { const n = document.getElementById('app-note');
        return !n.hidden && /boundaries/i.test(n.textContent || ''); },
      null, { timeout: 4000 }).then(() => { sawPill = true; }).catch(() => {});

    for (const y of [2020, 2018, 2016, 2014, 2012]) {
      await slideYear(page, y);
      await page.waitForTimeout(60);
    }
    await pillWatch;
    await page.waitForFunction(() => document.getElementById('app-note').hidden,
      null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(500);
    await settleFrames(page);

    const after = await snapshot(page);
    check('the drag landed on 2012', after.state.year === 2012,
      'state.year is ' + after.state.year);
    check(`the boundary vintage swapped dd22 → dd17 for a pre-2015 year`,
      before.vintage === 'dd22' && after.vintage === 'dd17',
      `${before.vintage} → ${after.vintage}`);
    check('the geometry really changed under the map '
      + `(${before.geometryCount} → ${after.geometryCount} counties)`,
      after.geometryCount !== before.geometryCount && after.geometryCount > 3000,
      `${before.geometryCount} → ${after.geometryCount}`);
    check('the transient "switching boundaries" pill was shown', sawPill,
      'never saw #app-note say "boundaries" — the swap may have been silent');
    check('the pill was cleared once the swap finished',
      await page.locator('#app-note').isHidden());
    // Against the DATA, not a round number. 2012 Native Pasture has 2,979
    // reporting counties — a hardcoded "> 3000" here passes for the default
    // year and fails for this one, which says nothing about the app.
    const painted = await paintSignature(page, CONFIG.sourceId);
    const expected = await page.evaluate(async () => {
      const d = await import(new URL('js/data.js', document.baseURI).href);
      const app = await import(new URL('js/app.js', document.baseURI).href);
      const c = app.ngpContext();
      const { year, type } = c.getState();
      const idx = c.getCounties().index;
      let n = 0;
      for (const id of d.getYearType(year, type).keys()) if (idx.has(id)) n++;
      return n;
    });
    check('after the swap, every county with data AND a dd17 polygon carries a color',
      painted.colored === expected && expected > 2000,
      `${painted.colored} painted, ${expected} expected`);
    clean('vintage swap');
    await shot('05-vintage-dd17');
  }

  /* ── 1e. County click → card ────────────────────────────────────────────
     A genuine mouse click, at the pixel MapLibre projects the county's
     centroid to — not a call into the app. Clicking blind at the canvas
     centre would be a click on whatever the projection happens to put there. */
  section('▸ County click → detail card');
  {
    const pt = await page.evaluate(async ([id, kitUrl]) => {
      const app = await import(new URL('js/app.js', document.baseURI).href);
      // Kit import in the SAME form the app uses, so the harness never mixes
      // two kit builds in one page. The URL is KIT_COUNTY_URL, passed in — see
      // its definition for the sweep note.
      const county = await import(kitUrl);
      const c = app.ngpContext();
      const feature = c.getCounties().index.get(id);
      if (!feature) return null;
      const center = county.countyCentroid(feature);
      if (!center) return null;
      const p = c.getMap().project(center);
      const box = document.getElementById('map').getBoundingClientRect();
      return { x: Math.round(box.x + p.x), y: Math.round(box.y + p.y) };
    }, [CONFIG.county.id, KIT_COUNTY_URL]);

    if (!pt) {
      skip('county click opens the card', `no polygon for ${CONFIG.county.id}`);
    } else {
      // Read before the click: the desktop card is a DOCK, and a dock that
      // stole width from the map would be a flex column, not an overlay.
      const frameBefore = await page.evaluate(
        () => document.getElementById('map-frame').clientWidth);
      await page.mouse.click(pt.x, pt.y);
      const opened = await page.waitForFunction(
        () => !document.getElementById('county-card').hidden, null, { timeout: 8000 })
        .then(() => true).catch(() => false);
      check('a click on the county polygon opens the detail card', opened,
        `clicked (${pt.x}, ${pt.y}) and #county-card stayed hidden`);

      const card = await page.evaluate(() => ({
        title: (document.getElementById('card-title').textContent || '').trim(),
        rows: document.querySelectorAll('#card-rows dt').length,
        text: (document.getElementById('card-rows').textContent || '').trim(),
        svg: !!document.querySelector('#card-content .span-figure svg'),
        bars: document.querySelectorAll('#card-content .span-figure svg rect').length,
        figcaption: !!document.querySelector('#card-content figcaption'),
        detailsTable: document.querySelectorAll('#card-content details table tbody tr').length,
      }));
      check('the card names the county it opened',
        card.title.includes(CONFIG.county.name), 'title is ' + JSON.stringify(card.title));
      check('#card-rows is a populated readout, not an empty box',
        card.rows >= 4 && card.text.length > 40, `${card.rows} rows`);
      check('the all-years span chart rendered as an SVG',
        card.svg && card.bars > 0, `svg=${card.svg}, ${card.bars} bar(s)`);
      check('the chart has its accessible twin (figcaption + a table of the same years)',
        card.figcaption && card.detailsTable > 10,
        `figcaption=${card.figcaption}, ${card.detailsTable} table row(s)`);
      check('the county is mirrored into the URL as a 5-CHARACTER STRING',
        new URL(page.url()).searchParams.get('county') === CONFIG.county.id,
        page.url());

      /* ── The desktop dock geometry ──────────────────────────────────────
         On a desktop the card is not a floating panel: the kit's
         `.sfsa-card.dock-right` pins it to the right edge of #map-frame, runs
         it the frame's full height, and slides it in over the map. The map
         frame's own width must not move — the dock is an overlay, so MapLibre
         is never relaid out and no `map.resize()` is owed. */
      await page.waitForTimeout(400);
      const dock = await page.evaluate(() => {
        const card = document.getElementById('county-card');
        const frame = document.getElementById('map-frame');
        const cr = card.getBoundingClientRect();
        const fr = frame.getBoundingClientRect();
        return {
          card: {
            top: Math.round(cr.top), right: Math.round(cr.right),
            width: Math.round(cr.width), height: Math.round(cr.height),
          },
          frame: {
            top: Math.round(fr.top), right: Math.round(fr.right),
            width: frame.clientWidth, height: Math.round(fr.height),
          },
          winRight: document.documentElement.clientWidth,
          // The kit's dock width, evaluated here rather than hardcoded at 360:
          // 34vw wins on a narrow desktop and 360 on a wide one.
          expectWidth: Math.round(Math.min(360, 0.34 * window.innerWidth)),
        };
      });
      check('the card DOCKS to the right edge of the map frame, which is the '
        + 'right edge of the window',
      Math.abs(dock.card.right - dock.frame.right) <= 2
        && Math.abs(dock.card.right - dock.winRight) <= 2,
      `card right ${dock.card.right}, frame right ${dock.frame.right}, `
        + `window right ${dock.winRight}`);
      check('the dock runs the FULL height of the map frame (top and height both '
        + 'match, so there is no floating inset and no max-height clamp)',
      Math.abs(dock.card.top - dock.frame.top) <= 2
        && Math.abs(dock.card.height - dock.frame.height) <= 2,
      `card y ${dock.card.top} h ${dock.card.height} vs frame y ${dock.frame.top} `
        + `h ${dock.frame.height}`);
      check(`the dock is min(360px, 34vw) wide (${dock.expectWidth}px here)`,
        Math.abs(dock.card.width - dock.expectWidth) <= 2,
        `card is ${dock.card.width}px wide`);
      check('opening the dock does NOT resize the map frame (it overlays the '
        + 'map instead of taking a column from it)',
      dock.frame.width === frameBefore,
      `#map-frame was ${frameBefore}px, is now ${dock.frame.width}px`);

      /* ── The reveal push ─────────────────────────────────────────────────
         Selecting a county that sits UNDER the dock must not leave it hidden
         behind its own readout. A camera pan cannot fix this at the default
         framing (the maxBounds cage clamps it), so the app pushes instead:
         .card-pushes narrows the canvas by the dock's width and, at the fit
         floor, re-frames the whole composite beside the card
         (js/app.js revealSelectedCounty). The probe finds a real victim at
         the live camera rather than hardcoding one, selects it through the
         seam exactly like a map click (no fly), and asserts the push, the
         reveal, the close-restore, and that an unobscured county does NOT
         push. */
      const victim = await page.evaluate(async (kitUrl) => {
        const app = await import(new URL('js/app.js', document.baseURI).href);
        const county = await import(kitUrl);
        const c = app.ngpContext();
        const m = c.getMap();
        const cardW = document.getElementById('county-card').offsetWidth;
        const w = document.getElementById('map').clientWidth;
        const h = document.getElementById('map').clientHeight;
        for (const [id, f] of c.getCounties().index) {
          const center = county.countyCentroid(f);
          if (!center) continue;
          const p = m.project(center);
          // Well under the dock, and vertically inside the canvas.
          if (p.x > w - cardW + 60 && p.y > 80 && p.y < h - 80) return id;
        }
        return null;
      }, KIT_COUNTY_URL);
      if (!victim) {
        skip('the reveal pan brings an obscured county out from under the dock',
          'no county centroid projects under the dock at this camera');
      } else {
        await page.evaluate(async (id) => {
          const app = await import(new URL('js/app.js', document.baseURI).href);
          app.ngpContext().selectCounty(id);   // no fly — the map-click path
        }, victim);
        await page.waitForTimeout(700);        // rAF + resize + re-fit + settle
        const pushed = await page.evaluate(async ([id, kitUrl]) => {
          const app = await import(new URL('js/app.js', document.baseURI).href);
          const county = await import(kitUrl);
          const c = app.ngpContext();
          const f = c.getCounties().index.get(id);
          const p = c.getMap().project(county.countyCentroid(f));
          return {
            pushes: document.getElementById('map-frame').classList.contains('card-pushes'),
            mapW: document.getElementById('map').clientWidth,
            frameW: document.getElementById('map-frame').clientWidth,
            cardW: document.getElementById('county-card').offsetWidth,
            x: Math.round(p.x),
          };
        }, [victim, KIT_COUNTY_URL]);
        check(`selecting an obscured county (${victim}) pushes the map: the `
          + 'canvas gives up the dock\'s width',
        pushed.pushes && Math.abs(pushed.mapW - (pushed.frameW - pushed.cardW)) <= 2,
        `canvas ${pushed.mapW}px in a ${pushed.frameW}px frame, dock ${pushed.cardW}px`);
        check('…and the re-fit brings its centroid onto the visible canvas',
          pushed.x > 16 && pushed.x < pushed.mapW - 16,
          `centroid x ${pushed.x} of ${pushed.mapW}`);

        // Close-restore: Escape closes the card (the desktop drawer is not a
        // layer), the push unwinds, and the kit zoom floor's resize handler
        // springs the camera back to the full-width fit.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(700);        // 200ms debounce + fit + settle
        const restored = await page.evaluate(() => ({
          pushes: document.getElementById('map-frame').classList.contains('card-pushes'),
          mapW: document.getElementById('map').clientWidth,
          frameW: document.getElementById('map-frame').clientWidth,
        }));
        check('closing the card un-pushes: the canvas gets its width back',
          !restored.pushes && restored.mapW === restored.frameW,
          `canvas ${restored.mapW}px in a ${restored.frameW}px frame`);

        // Re-open the run's canonical county: it is in the clear, so the card
        // must stay a pure overlay — no push, no camera motion.
        await page.evaluate(async (id) => {
          const app = await import(new URL('js/app.js', document.baseURI).href);
          app.ngpContext().selectCounty(id);
        }, CONFIG.county.id);
        await page.waitForTimeout(500);
        const clear = await page.evaluate(() => ({
          pushes: document.getElementById('map-frame').classList.contains('card-pushes'),
          mapW: document.getElementById('map').clientWidth,
          frameW: document.getElementById('map-frame').clientWidth,
          open: !document.getElementById('county-card').hidden,
        }));
        check('an unobscured county does NOT push — the dock stays an overlay',
          clear.open && !clear.pushes && clear.mapW === clear.frameW,
          `open=${clear.open}, pushes=${clear.pushes}, canvas ${clear.mapW}/${clear.frameW}`);
      }
      clean('county click');
      await shot('06-card-open');
    }
  }

  /* ── 1f. Escape precedence: dropdown above card ─────────────────────────
     The kit documents one Escape key shared by the two layers (ui/card.js §):
     the combobox takes it first and stops propagation; the card only sees an
     Escape nothing else handled. One press must never close both.

     The control drawer is registered ahead of both (initDrawer before
     initDetailCard, js/app.js wireControls) but it is an Escape LAYER ONLY ON
     COMPACT: on a desktop it is the fixture the app's controls live in, and an
     Escape that swallowed it would take the year slider, the pasture-type
     select and the legend with it. The third press below is the proof. The
     compact half of the same contract — drawer above sheet, one press each —
     is in §6. */
  section('▸ Escape layering — dropdown above card, desktop drawer untouchable');
  {
    await page.locator('#county-search').fill('Miss');
    await page.waitForSelector('#county-results [role="option"]:not([aria-disabled="true"])',
      { timeout: 5000 });
    const beforeEsc = await page.evaluate(() => ({
      dropdown: !document.getElementById('county-results').hidden,
      card: !document.getElementById('county-card').hidden,
    }));
    check('setup: dropdown and card are both open',
      beforeEsc.dropdown && beforeEsc.card, JSON.stringify(beforeEsc));

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const afterFirst = await page.evaluate(() => ({
      dropdown: !document.getElementById('county-results').hidden,
      card: !document.getElementById('county-card').hidden,
      expanded: document.getElementById('county-search').getAttribute('aria-expanded'),
    }));
    check('the FIRST Escape closes the dropdown and leaves the card open',
      !afterFirst.dropdown && afterFirst.card, JSON.stringify(afterFirst));
    check('the combobox reports itself collapsed', afterFirst.expanded === 'false');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const afterSecond = await page.evaluate(() => ({
      card: !document.getElementById('county-card').hidden,
      info: document.getElementById('info-modal').open,
      table: document.getElementById('table-modal').open,
    }));
    check('the SECOND Escape closes the card', !afterSecond.card);
    check('Escape did not disturb the other layers (both dialogs still shut)',
      !afterSecond.info && !afterSecond.table, JSON.stringify(afterSecond));
    check('closing the card drops ?county from the URL',
      !new URL(page.url()).searchParams.has('county'), page.url());

    /* A THIRD press, with every real layer now closed. The only thing left on
       screen that answers to Escape anywhere is the drawer, and on a desktop it
       must not: nothing is open, so nothing may close. */
    const beforeDrawerEsc = await drawerGeom(page);
    check('setup: the desktop drawer is open and every Escape layer is now shut',
      !beforeDrawerEsc.closed && !afterSecond.card && !afterSecond.info
        && !afterSecond.table, JSON.stringify(beforeDrawerEsc));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const afterDrawerEsc = await drawerGeom(page);
    check('Escape does NOT close the desktop drawer — it is a fixture, not a '
      + 'layer, and it keeps saying so through aria-expanded',
    !afterDrawerEsc.closed && afterDrawerEsc.tabExpanded === 'true'
      && afterDrawerEsc.searchVisible,
    JSON.stringify(afterDrawerEsc));
    check('the drawer-less Escape did not put a stray param in the URL',
      !new URL(page.url()).searchParams.has('drawer'), page.url());
    clean('escape layering');
    await shot('07-escape');
  }

  /* ── 1g. Search → Enter → card + camera ─────────────────────────────────── */
  section('▸ Search → Enter → card opens and the camera moves');
  {
    const before = await snapshot(page);
    await page.evaluate(async () => {
      const app = await import(new URL('js/app.js', document.baseURI).href);
      window.__ngpMoved = false;
      app.ngpContext().getMap().once('moveend', () => { window.__ngpMoved = true; });
    });

    await page.locator('#county-search').fill('');
    await page.locator('#county-search').fill('Missoula');
    await page.waitForSelector('#county-results [role="option"]:not([aria-disabled="true"])',
      { timeout: 5000 });
    const rows = await page.evaluate(() => Array.from(
      document.querySelectorAll('#county-results [role="option"]:not([aria-disabled="true"])'))
      .map((li) => li.textContent.trim()));
    check('searching "Missoula" offers a matching county option',
      rows.some((r) => /Missoula/i.test(r)), JSON.stringify(rows.slice(0, 3)));

    await page.keyboard.press('Enter');
    const opened = await page.waitForFunction(
      () => !document.getElementById('county-card').hidden, null, { timeout: 8000 })
      .then(() => true).catch(() => false);
    check('Enter on the top hit opens the card', opened);
    const moved = await page.waitForFunction(() => window.__ngpMoved === true,
      null, { timeout: 15000 }).then(() => true).catch(() => false);
    const after = await snapshot(page);
    // The centre is in the app's PROJECTED space, not degrees: the composite
    // spans 10 dummy units where it used to span 58.31° of longitude
    // (js/projection.js), so every distance here is 5.83× smaller and the old
    // `> 1°` threshold would pass on almost any flight. 0.15 is the same
    // fraction of the composite width that 1° was.
    const dist = Math.hypot(after.center[0] - before.center[0],
      after.center[1] - before.center[1]);
    check('the camera flew to the county (moveend fired and the centre moved)',
      moved && dist > 0.15,
      `moveend=${moved}, centre moved ${dist.toFixed(3)} projected units `
      + `(${before.center.map((n) => n.toFixed(2))} → ${after.center.map((n) => n.toFixed(2))})`);
    check('the card is the searched county',
      (await page.locator('#card-title').textContent()).includes('Missoula'));
    clean('search → enter');
    await shot('08-search-select');
  }

  /* ── 1h. Help modal, rendered from help.md ──────────────────────────────── */
  section('▸ Help modal — rendered from help.md, not the offline fallback');
  {
    await page.locator('#btn-info').click();
    const open = await page.waitForFunction(
      () => document.getElementById('info-modal').open, null, { timeout: 5000 })
      .then(() => true).catch(() => false);
    check('the ? button opens the help dialog', open);
    const help = await page.waitForFunction(
      () => {
        const el = document.querySelector('#info-modal [data-help-content]');
        return !!(el && el.querySelector('h2') && el.querySelector('table'));
      }, null, { timeout: 15000 }).then(() => true).catch(() => false);
    const shape = await page.evaluate(() => {
      const el = document.querySelector('#info-modal [data-help-content]');
      return {
        h2: el ? el.querySelectorAll('h2').length : 0,
        tables: el ? el.querySelectorAll('table').length : 0,
        tableRows: el ? el.querySelectorAll('table tbody tr').length : 0,
        chars: el ? (el.textContent || '').trim().length : 0,
      };
    });
    check('help.md rendered into the modal (an H2 and a table are present, so '
      + 'this is the real help and not the offline fallback paragraph)',
      help && shape.h2 > 0 && shape.tables > 0, JSON.stringify(shape));
    await shot('09-help-modal');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('info-modal').open,
      null, { timeout: 5000 }).catch(() => {});
    check('Escape closes the help dialog and the card underneath survives it',
      !(await page.evaluate(() => document.getElementById('info-modal').open))
        && !(await page.evaluate(() => document.getElementById('county-card').hidden)));
    clean('help modal');
  }

  /* ── 1i. The data table — the a11y twin's escape hatch ──────────────────
     Slide back to the default year first: it is where the payload is fullest
     (3,082 Native Pasture counties in 2026 against 2,979 in 2012), so the
     "more than three thousand rows" claim is testable — and the trip back
     across 2015 exercises the vintage swap in the OTHER direction, which the
     drag above never does. */
  section('▸ Data table dialog');
  {
    await slideYear(page, 2026);
    await page.waitForFunction(() => document.getElementById('app-note').hidden,
      null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(500);
    const back = await snapshot(page);
    check('sliding back over 2015 swaps the vintage the other way (dd17 → dd22)',
      back.vintage === 'dd22' && back.geometryCount === 3106,
      `${back.vintage}, ${back.geometryCount} polygons`);

    const st = await snapshot(page);
    await page.locator('#btn-table').click();
    const built = await page.waitForFunction(
      () => document.getElementById('table-modal').open
        && document.querySelectorAll('#table-modal-body tbody tr').length > 0,
      null, { timeout: 30000 }).then(() => true).catch(() => false);
    check('the table button opens the dialog and builds the table', built);
    const table = await page.evaluate(() => ({
      rows: document.querySelectorAll('#table-modal-body tbody tr').length,
      caption: (document.getElementById('table-modal-caption').textContent || '').trim(),
      srCaption: (document.querySelector('#table-modal-body table caption') || {}).textContent || '',
      headers: Array.from(document.querySelectorAll('#table-modal-body thead th'))
        .map((th) => th.textContent.trim()),
      scoped: document.querySelectorAll('#table-modal-body thead th[scope="col"]').length,
      rowHeaders: document.querySelectorAll('#table-modal-body tbody th[scope="row"]').length,
      region: document.getElementById('table-modal-body').getAttribute('role'),
      regionLabel: document.getElementById('table-modal-body').getAttribute('aria-label'),
      tabbable: document.getElementById('table-modal-body').tabIndex,
    }));
    const dataRows = await page.evaluate(async () => {
      const d = await import(new URL('js/data.js', document.baseURI).href);
      const app = await import(new URL('js/app.js', document.baseURI).href);
      const { year, type } = app.ngpContext().getState();
      return d.getYearType(year, type).size;
    });
    check('the table holds more than 3,000 county rows', table.rows > 3000,
      table.rows + ' rows');
    check('it is the map\'s DATA, row for row — not a sample and not a summary',
      table.rows === dataRows, `${table.rows} rows vs ${dataRows} records`);
    check('the caption names the program year AND the pasture type',
      table.caption.includes(String(st.state.year)) && table.caption.includes(st.state.type),
      JSON.stringify(table.caption));
    check('the table has a name of its own for table navigation (sr-only <caption>)',
      table.srCaption.trim().length > 0, JSON.stringify(table.srCaption));
    check('every column header is scope="col" and every row has a row header',
      table.scoped === table.headers.length && table.rowHeaders === table.rows,
      `${table.scoped}/${table.headers.length} col, ${table.rowHeaders}/${table.rows} row`);
    check('the scrolling body is keyboard-reachable and named (WCAG 2.1.1)',
      table.region === 'region' && !!table.regionLabel && table.tabbable === 0,
      JSON.stringify({ region: table.region, tabindex: table.tabbable }));
    await shot('10-table-modal');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('table-modal').open,
      null, { timeout: 5000 }).catch(() => {});
    clean('data table');
  }

  /* ── 1j. Share → clipboard ──────────────────────────────────────────────── */
  section('▸ Share → clipboard');
  {
    await page.evaluate(() => navigator.clipboard.writeText('sentinel')).catch(() => {});
    await page.locator('#btn-share').click();
    await page.waitForTimeout(600);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    const here = await page.evaluate(() => location.href);
    check('Share writes the current view URL to the clipboard',
      copied === here, `clipboard ${JSON.stringify(copied)} vs location ${JSON.stringify(here)}`);
    // "Round-trips" has to mean the URL REPRODUCES the view, not that it
    // carries a particular set of keys: the app elides every param that is at
    // its default, so asserting `year` is present fails a view that is legally
    // at 2026. Load the copied link in a clean context and compare.
    const mine = await snapshot(page);
    check('the copied URL keeps the clean-URL discipline (no param at its default)',
      !new URL(copied).searchParams.has('variable')
        && (mine.state.year !== 2026) === new URL(copied).searchParams.has('year'),
      copied);
    // The main run is on the default view, on its default dataset, so neither
    // slug belongs in a shared link from here. Asserted separately from the
    // reproduction below because the two failures are different bugs: a
    // stray param is a leak, a missing one is a lost view.
    check('a link shared from the default view carries no ?view or ?dataset',
      !new URL(copied).searchParams.has('view')
        && !new URL(copied).searchParams.has('dataset'), copied);
    const trip = await open({ query: new URL(copied).search });
    const theirs = await snapshot(trip.page);
    check('the copied URL really reproduces the view (view, dataset, year, type, '
      + 'variable, county and camera all survive a reload)',
    theirs.state.view === mine.state.view
        && theirs.state.dataset === mine.state.dataset
        && theirs.state.year === mine.state.year
        && theirs.state.type === mine.state.type
        && theirs.state.variable === mine.state.variable
        && theirs.state.countyId === mine.state.countyId
        && Math.abs(theirs.center[0] - mine.center[0]) < 0.05
        && Math.abs(theirs.center[1] - mine.center[1]) < 0.05,
    JSON.stringify({ mine: mine.state, theirs: theirs.state }));
    trip.clean('shared-link reload');
    await trip.shot('10b-shared-link-roundtrip');
    await trip.ctx.close();
    clean('share');
  }

  /* ── 1k. A county with data but no polygon ──────────────────────────────
     Computed, never assumed. The obvious candidate is Puerto Rico — but PR IS
     in both boundary archives, so searching for "Adjuntas" would test the
     ordinary path and call it the exceptional one. The geometry-less set is
     therefore derived at runtime: allCountyIds() minus the loaded geometry
     index. It is vintage-dependent (dd17 and dd22 do not hold the same
     footprints), so both are probed before this gives up, and a genuinely
     empty set SKIPS rather than passing vacuously. */
  section('▸ A county with data but no boundary');
  {
    const probe = async () => page.evaluate(async () => {
      const d = await import(new URL('js/data.js', document.baseURI).href);
      const app = await import(new URL('js/app.js', document.baseURI).href);
      const idx = app.ngpContext().getCounties().index;
      const missing = d.allCountyIds().filter((id) => !idx.has(id));
      return {
        vintage: app.ngpContext().getVintage(),
        total: d.allCountyIds().length,
        geometry: idx.size,
        missing: missing.slice(0, 5),
        count: missing.length,
      };
    });

    let orphans = await probe();
    console.log(`    (data ids ${orphans.total}, ${orphans.vintage} polygons `
      + `${orphans.geometry}, ids with no polygon ${orphans.count})`);
    if (!orphans.count) {
      // Cross the 2015 line and look in the other archive before concluding
      // there is nothing to test.
      const other = (await snapshot(page)).state.year >= 2015 ? 2012 : 2026;
      await slideYear(page, other);
      await page.waitForFunction(() => document.getElementById('app-note').hidden,
        null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(500);
      orphans = await probe();
      console.log(`    (retried on ${orphans.vintage}: ${orphans.geometry} polygons, `
        + `${orphans.count} ids with no polygon)`);
    }

    if (!orphans.count) {
      skip('a data-only county says it has no boundary',
        `every one of the ${orphans.total} county ids in the payload has a polygon `
        + `in ${orphans.vintage} — there is no geometry-less id to test`);
    } else {
      const id = orphans.missing[0];
      await page.evaluate(async (i) => {
        const app = await import(new URL('js/app.js', document.baseURI).href);
        app.ngpContext().selectCounty(i);
      }, id);
      await page.waitForTimeout(500);
      const text = await page.locator('#card-rows').textContent();
      check(`county ${id} has data but no polygon — the card SAYS SO rather than `
        + 'showing an empty box',
      /no boundary available/i.test(text), JSON.stringify(text.slice(0, 160)));
      check('it is still findable in the search index',
        await page.evaluate(async (i) => {
          const app = await import(new URL('js/app.js', document.baseURI).href);
          const d = await import(new URL('js/data.js', document.baseURI).href);
          const nm = d.countyName(i);
          if (!nm) return false;
          const input = document.getElementById('county-search');
          input.value = nm.county;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 200));
          return Array.from(document.querySelectorAll(
            '#county-results [role="option"]:not([aria-disabled="true"])'))
            .some((li) => li.textContent.includes(i));
        }, id));
      await shot('11-no-boundary');
      clean('data-only county');
    }
  }

  await main.ctx.close();
}

/* ══════════════════════════════════════════════════════════════════════════
   2. DEEP LINK — every param honoured on load.
   ══════════════════════════════════════════════════════════════════════════ */

section('▸ Deep link ?county=30063&year=2012&type=native-pasture&variable=start');
{
  const s = await open({
    query: '?county=30063&year=2012&type=native-pasture&variable=start',
  });
  check('deep-linked page reaches ngpReady', s.ready);
  const st = await s.page.evaluate(() => ({
    cardOpen: !document.getElementById('county-card').hidden,
    title: (document.getElementById('card-title').textContent || '').trim(),
    slider: document.getElementById('year-range').value,
    output: (document.getElementById('year-out').textContent || '').trim(),
    type: document.getElementById('type-select').value,
    pressed: Array.from(document.querySelectorAll('.seg-btn[data-variable]'))
      .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.variable),
    wheelHidden: document.getElementById('legend-wheel').hidden,
    barHidden: document.getElementById('legend-bar').hidden,
    helpOpen: document.getElementById('info-modal').open,
  }));
  const snap = await snapshot(s.page);
  check('the card is open on load, on the linked county',
    st.cardOpen && st.title.includes('Missoula'), JSON.stringify(st.title));
  check('the slider AND its output are at 2012',
    st.slider === '2012' && st.output === '2012', JSON.stringify(st));
  check('the pasture-type slug resolved to its dictionary name',
    st.type === 'Native Pasture', JSON.stringify(st.type));
  check('start is the pressed color-by button and the WHEEL is the visible legend',
    st.pressed.length === 1 && st.pressed[0] === 'start'
      && st.wheelHidden === false && st.barHidden === true, JSON.stringify(st));
  check('the pre-2015 year booted straight onto dd17 boundaries (no mixing)',
    snap.vintage === 'dd17', 'vintage is ' + snap.vintage);
  check('a deep link suppresses the first-visit help tour',
    !st.helpOpen);
  check('the choropleth painted for the deep-linked view',
    (await paintSignature(s.page, CONFIG.sourceId)).colored > 2000);
  s.clean('deep link');
  await s.shot('12-deep-link');
  await s.ctx.close();
}

/* ══════════════════════════════════════════════════════════════════════════
   3. ?export= — the headless poster path.
   ══════════════════════════════════════════════════════════════════════════ */

section('▸ ?export=light — headless PNG export');
{
  // A stored theme the export must NOT overwrite: the param forces `light`
  // with persist:false, and a job that rewrote a visitor's preference would be
  // a silent, permanent side effect.
  const s = await open({
    query: '?export=light',
    theme: 'high-contrast',
    downloads: true,
    requireReady: true,
  });
  check('the export page reaches ngpReady before exporting', s.ready);

  const stamped = await s.page.waitForFunction(
    () => document.documentElement.dataset.ngpExported === '1'
      || document.documentElement.dataset.ngpExportError === '1',
    null, { timeout: 120000 }).then(() => true).catch(() => false);
  const flags = await s.page.evaluate(() => ({
    exported: document.documentElement.dataset.ngpExported || null,
    error: document.documentElement.dataset.ngpExportError || null,
    theme: document.documentElement.dataset.theme,
    stored: (() => { try { return localStorage.getItem('sfsa-theme'); } catch (e) { return 'unavailable'; } })(),
  }));
  check('?export= stamps a completion flag rather than hanging', stamped,
    'neither ngpExported nor ngpExportError appeared inside 120s');
  check('the run SUCCEEDED (ngpExported=1, no ngpExportError)',
    flags.exported === '1' && flags.error === null, JSON.stringify(flags));
  check('?export=light forced the light theme for the render',
    flags.theme === 'light', 'data-theme is ' + flags.theme);
  check('?export= did NOT rewrite the visitor\'s stored theme',
    flags.stored === 'high-contrast',
    'sfsa-theme in localStorage is ' + JSON.stringify(flags.stored));

  await s.page.waitForTimeout(1500);
  check('exactly one file was downloaded', s.downloads.length === 1,
    s.downloads.length + ' download(s)');
  if (s.downloads.length) {
    const dl = s.downloads[0];
    const name = dl.suggestedFilename();
    const path = await dl.path();
    const bytes = path ? await readFile(path) : Buffer.alloc(0);
    const png = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50
      && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d
      && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
    check('the download is named for the view it holds '
      + '(fsa-ngp_<year>_<type-slug>_<variable>.png)',
      /^fsa-ngp_\d{4}_[a-z0-9-]+_(start|end|duration)\.png$/.test(name), name);
    check('the file really is a PNG (magic bytes 89 50 4E 47 0D 0A 1A 0A)', png,
      'first bytes: ' + [...bytes.slice(0, 8)].map((b) => b.toString(16)).join(' '));
    check('the poster is a poster, not a blank canvas (> 100 KB)',
      bytes.length > 100 * 1024, Math.round(bytes.length / 1024) + ' KB');
  }
  s.clean('export run');
  await s.shot('13-export');
  await s.ctx.close();
}

/* ══════════════════════════════════════════════════════════════════════════
   4. HIGH-CONTRAST THEME — the second of the kit's two.
   ══════════════════════════════════════════════════════════════════════════ */

section('▸ High-contrast theme');
{
  const s = await open({ theme: 'high-contrast', query: '?theme=high-contrast' });
  check('high-contrast reaches ngpReady', s.ready);
  check('the theme is applied to <html>',
    (await s.page.evaluate(() => document.documentElement.dataset.theme)) === 'high-contrast');
  check('the choropleth painted in high contrast',
    (await paintSignature(s.page, CONFIG.sourceId)).colored > 2000);
  // Before the toggle below, or the file named "high-contrast" holds a light
  // -theme page and the screenshot set quietly stops being evidence.
  await s.shot('14-high-contrast');
  const toggled = await s.page.evaluate(async () => {
    document.getElementById('btn-theme').click();
    await new Promise((r) => setTimeout(r, 300));
    return {
      theme: document.documentElement.dataset.theme,
      pressed: document.getElementById('btn-theme').getAttribute('aria-pressed'),
      label: document.getElementById('btn-theme').getAttribute('aria-label'),
    };
  });
  check('the theme toggle flips the theme and its own accessible state',
    toggled.theme === 'light' && toggled.pressed === 'false'
      && /high-contrast/i.test(toggled.label || ''), JSON.stringify(toggled));
  s.clean('high-contrast');
  await s.shot('14b-toggled-back-to-light');
  await s.ctx.close();
}

/* ══════════════════════════════════════════════════════════════════════════
   5. DRAWER FIXTURE — the desktop control column.
   On a desktop the drawer is not a menu: it is a flex column that OWNS its
   272px and gives them back when it closes. Three things have to be true
   together or the feature is broken in a way a screenshot will not show — the
   layout moves, MapLibre is told (or the map letterboxes inside a canvas that
   is the wrong size), and the collapsed state survives a share link and a
   return visit.
   ══════════════════════════════════════════════════════════════════════════ */

section('▸ Drawer fixture — desktop column, map resize, URL and persistence');
{
  const s = await open();
  const { page } = s;
  check('the drawer page reaches ngpReady', s.ready);

  const booted = await drawerGeom(page);
  check('the drawer is OPEN at boot (the documented desktop default)',
    !booted.closed && booted.visibility === 'visible'
      && booted.tabExpanded === 'true', JSON.stringify(booted));
  check('the county search lives INSIDE the drawer and is visible there — no '
    + 'toggle stands between a desktop visitor and the search box',
  booted.searchInDrawer && booted.searchVisible,
  `inDrawer=${booted.searchInDrawer}, visible=${booted.searchVisible}`);
  check('the edge tab is the desktop control; the navbar hamburger stays out of '
    + 'the way until the viewport is compact',
  booted.tabShown && !booted.toggleShown,
  `#drawer-tab shown=${booted.tabShown}, #btn-drawer shown=${booted.toggleShown}`);
  check('the open drawer is a COLUMN, not an overlay: it and the map frame tile '
    + 'the window between them',
  Math.abs(booted.drawerW + booted.frameW - booted.winW) <= 2,
  `drawer ${booted.drawerW} + frame ${booted.frameW} vs window ${booted.winW}`);
  check('the map canvas is the size of its frame at boot',
    booted.canvasW !== null && Math.abs(booted.canvasW - booted.frameW) <= 2,
    `canvas ${booted.canvasW} vs frame ${booted.frameW}`);
  check('an open drawer is the default, so it emits NO query param',
    !new URL(page.url()).searchParams.has('drawer'), page.url());
  await s.shot('15-drawer-open');

  /* ── Collapse: the map has to grow, and GL has to hear about it ─────────── */
  await page.locator('#drawer-tab').click();
  await settleDrawer(page);
  const closed = await drawerGeom(page);
  check('the edge tab collapses the drawer (.is-closed, and the aria state '
    + 'follows)', closed.closed && closed.tabExpanded === 'false',
  JSON.stringify({ closed: closed.closed, expanded: closed.tabExpanded }));
  check('a closed drawer is out of the tab order and the a11y tree '
    + '(visibility: hidden, which the kit uses instead of JS)',
  closed.visibility === 'hidden' && !closed.searchVisible,
  `visibility ${closed.visibility}, search visible ${closed.searchVisible}`);
  check(`the map frame took the drawer's 272px `
    + `(${booted.frameW} → ${closed.frameW})`,
  Math.abs((closed.frameW - booted.frameW) - 272) <= 20,
  `grew by ${closed.frameW - booted.frameW}px, expected ~272`);
  check('MapLibre was TOLD: the canvas matches the widened frame rather than '
    + 'letterboxing at its old size',
  closed.canvasW !== null && Math.abs(closed.canvasW - closed.frameW) <= 2,
  `canvas ${closed.canvasW} vs frame ${closed.frameW} `
    + `(was ${booted.canvasW} at ${booted.frameW})`);
  check('a closed drawer is a shareable state: the URL gains drawer=closed',
    new URL(page.url()).searchParams.get('drawer') === 'closed', page.url());
  check('and it is remembered for the next visit (sfsa-ngp-drawer = closed)',
    closed.stored === 'closed', 'stored ' + JSON.stringify(closed.stored));
  await s.shot('15b-drawer-closed');

  /* ── Reopen: back to the default, and back to a clean URL ───────────────── */
  await page.locator('#drawer-tab').click();
  await settleDrawer(page);
  const reopened = await drawerGeom(page);
  check('the tab reopens the drawer and the map frame gives the column back',
    !reopened.closed && reopened.tabExpanded === 'true'
      && Math.abs(reopened.frameW - booted.frameW) <= 2,
    `frame ${reopened.frameW} vs ${booted.frameW} at boot`);
  check('the canvas followed back in', reopened.canvasW !== null
    && Math.abs(reopened.canvasW - reopened.frameW) <= 2,
  `canvas ${reopened.canvasW} vs frame ${reopened.frameW}`);
  check('reopening restores the CLEAN url — a param at its default is dropped, '
    + 'not rewritten to drawer=open',
  !new URL(page.url()).searchParams.has('drawer'), page.url());
  check('and the preference round-trips (sfsa-ngp-drawer = open)',
    reopened.stored === 'open', 'stored ' + JSON.stringify(reopened.stored));
  s.clean('drawer collapse and reopen');
  await s.ctx.close();
}

/* ?drawer=closed on a cold boot. The seeded preference says `open`, so this is
   also the precedence test: a link beats a stored preference, or a shared
   collapsed view would silently reopen for anyone who had ever used the app. */
section('▸ Drawer fixture — ?drawer=closed boots collapsed');
{
  const s = await open({ query: '?drawer=closed' });
  const g = await drawerGeom(s.page);
  check('the deep-linked page reaches ngpReady', s.ready);
  check('?drawer=closed boots the drawer collapsed, over a stored "open"',
    g.closed && g.tabExpanded === 'false' && g.visibility === 'hidden',
    JSON.stringify(g));
  check('the map frame boots at the full window width, with a canvas to match',
    Math.abs(g.frameW - g.winW) <= 2 && Math.abs(g.canvasW - g.frameW) <= 2,
    `frame ${g.frameW}, canvas ${g.canvasW}, window ${g.winW}`);
  check('the param survives the boot it described (a closed desktop drawer is '
    + 'still a closed desktop drawer after the app has rewritten the URL)',
  new URL(s.page.url()).searchParams.get('drawer') === 'closed', s.page.url());
  s.clean('drawer deep link');
  await s.shot('15c-drawer-deeplinked-closed');
  await s.ctx.close();
}

/* ══════════════════════════════════════════════════════════════════════════
   6. COMPACT 375×720 — the phone.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * THE TOUCH-TARGET CONTRACT, hoisted out of the measurement so a second view's
 * controls can be measured on exactly the same terms.
 *
 * Every entry is a selector and the size the KIT's own `@media (hover: none)`
 * block promises for it — not a flat number, because a design-system decision
 * is not this app's defect. (40/44 are the house's WCAG 2.5.5-AAA convention;
 * 2.5.8 Target Size (Minimum) at AA asks 24×24.)
 *
 * `.sfsa-drawer-tab` is deliberately absent: the kit sets it `display: none`
 * below the compact breakpoint, so it has no client rects here and would
 * self-skip to a vacuous pass. Its 24px `@media (hover: none)` width is a
 * desktop-with-a-touchscreen concern, and the phone's stand-in — `#btn-drawer`
 * — is measured as a `.nav-btn`.
 */
const TOUCH_CONTRACT = [
  ['.nav-btn, .seg-btn', 40],
  ['#type-select', 40],
  ['.card-close, .modal-close', 44],
  ['.sfsa-combobox input[type="search"]', 40],
  ['#year-range', 40],
  /* The view switcher by id as well as by class: it is the one control that
     decides which of the app's bodies of data a phone visitor can reach, so it
     is named here rather than left to inherit `.seg-btn`. */
  ['#btn-view-ngp', 40],
  ['#btn-view-usdm', 40],
];

/** The drought monitor's own controls. Measured in a SECOND pass, after a
    switch to that view: they live in a `[data-view="usdm"]` section, so on the
    grazing-period view they have no client rects and the pass above would skip
    them into a vacuous pass. */
const USDM_TOUCH_CONTRACT = [
  ['#week-range', 40],
  ['#btn-week-prev', 40],
  ['#btn-week-next', 40],
  ['#btn-usdm-fsa-lfp', 40],
  ['#btn-usdm-reported', 40],
  ['#btn-usdm-census', 40],
];

/** Measure every visible element the contract names. Invisible ones are
    skipped — which is why every caller also checks WHAT it measured. */
const measureTargets = (page, contract) => page.evaluate((rules) => {
  const out = [];
  for (const [sel, min] of rules) {
    for (const el of document.querySelectorAll(sel)) {
      if (!el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      out.push({
        id: el.id || String(el.className).split(' ')[0],
        w: Math.round(r.width), h: Math.round(r.height), min,
      });
    }
  }
  return out;
}, contract);

section('▸ Compact 375×720 (touch)');
{
  const s = await open({ viewport: CONFIG.viewports.compact, touch: true });
  const { page } = s;
  check('compact reaches ngpReady', s.ready);
  check('the context really is a coarse-pointer one (so the kit\'s '
    + '@media (hover: none) touch sizing is live)',
  await page.evaluate(() => window.matchMedia('(hover: none)').matches
    && window.matchMedia('(pointer: coarse)').matches));
  check('the page does not scroll horizontally at 375px',
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    await page.evaluate(() => `scrollWidth ${document.documentElement.scrollWidth} > `
      + `innerWidth ${window.innerWidth}`));

  /* ── The drawer on a phone: an overlay, not a column ─────────────────────
     Everything the desktop drawer is, this one is not. It boots closed no
     matter what `sfsa-ngp-drawer` says (the harness seeds `open`, so this is
     the force-close path, not a default), the navbar hamburger replaces the
     edge tab, opening it lays the drawer OVER the map behind a scrim instead
     of taking a column, and it is a real Escape layer. */
  const compactBoot = await drawerGeom(page);
  check('the drawer boots CLOSED at 375px even though the stored preference '
    + `says open (seeded ${JSON.stringify(compactBoot.stored)})`,
  compactBoot.closed && compactBoot.toggleExpanded === 'false',
  JSON.stringify({ closed: compactBoot.closed,
    expanded: compactBoot.toggleExpanded, stored: compactBoot.stored }));
  check('nothing is dimmed while the drawer is closed (the scrim is [hidden])',
    !compactBoot.scrimShown);
  check('the navbar hamburger is the phone\'s control and the desktop edge tab '
    + 'is gone from the layout entirely',
  compactBoot.toggleShown && !compactBoot.tabShown,
  `#btn-drawer shown=${compactBoot.toggleShown}, `
    + `#drawer-tab shown=${compactBoot.tabShown}`);
  check('the closed drawer takes the search box with it — a phone visitor '
    + 'reaches it through the hamburger, not around it',
  !compactBoot.searchVisible && compactBoot.searchInDrawer);
  check('a closed drawer never emits a param on a phone (there is nothing to '
    + 'share: the phone always boots closed)',
  !new URL(page.url()).searchParams.has('drawer'), page.url());
  await s.shot('16-compact-boot');

  await page.locator('#btn-drawer').tap();
  await settleDrawer(page);
  const overlay = await drawerGeom(page);
  check('the hamburger opens the drawer (.is-closed dropped, aria-expanded '
    + 'true on the button that did it)',
  !overlay.closed && overlay.toggleExpanded === 'true',
  JSON.stringify({ closed: overlay.closed, expanded: overlay.toggleExpanded }));
  check('the open drawer sits OVER the map at the drawer z-tier, fully slid in '
    + '(no leftover translate)',
  overlay.position === 'absolute' && overlay.zIndex === '70'
    && noTranslate(overlay.transform),
  `position ${overlay.position}, z-index ${overlay.zIndex}, `
    + `transform ${overlay.transform}`);
  check('the map frame did NOT shrink for it — an overlay costs the map no '
    + 'width, so there is no resize to owe',
  Math.abs(overlay.frameW - compactBoot.frameW) <= 1
    && Math.abs(overlay.frameW - overlay.winW) <= 2,
  `frame ${compactBoot.frameW} → ${overlay.frameW} of a ${overlay.winW}px window`);
  check('the scrim is showing, one tier below the drawer',
    overlay.scrimShown && overlay.scrimZ === '65',
    `shown=${overlay.scrimShown}, z-index ${overlay.scrimZ}`);
  check('the scrim dims the MAP, not the navbar (it starts at the bottom edge '
    + 'of the header)',
  overlay.scrimTop !== null && overlay.navBottom !== null
    && overlay.scrimTop >= overlay.navBottom - 1,
  `scrim top ${overlay.scrimTop}, navbar bottom ${overlay.navBottom}`);
  check('the search box is reachable once the drawer is open',
    overlay.searchVisible);
  check('the open overlay does not make the page scroll sideways at 375px',
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1),
    await page.evaluate(() => `scrollWidth ${document.documentElement.scrollWidth} > `
      + `innerWidth ${window.innerWidth}`));
  await s.shot('16b-compact-drawer');

  /* Tap the scrim where the drawer is NOT — it covers the whole map area and
     the drawer covers its left 300px, so the centre of the scrim is under the
     drawer and a centre tap would be an actionability failure, not a test. */
  const scrimPt = await page.evaluate(() => {
    const r = document.getElementById('drawer-scrim').getBoundingClientRect();
    return { x: Math.round(r.right - 20), y: Math.round(r.top + r.height / 2) };
  });
  await page.touchscreen.tap(scrimPt.x, scrimPt.y);
  await settleDrawer(page);
  const afterScrim = await drawerGeom(page);
  check('tapping the scrim closes the drawer and takes the scrim with it',
    afterScrim.closed && !afterScrim.scrimShown
      && afterScrim.toggleExpanded === 'false', JSON.stringify(afterScrim));

  await page.locator('#btn-drawer').tap();
  await settleDrawer(page);
  check('setup: the hamburger reopened the drawer',
    !(await drawerGeom(page)).closed);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const afterEsc = await drawerGeom(page);
  check('Escape closes the drawer on a phone — here it IS a layer, because it '
    + 'is covering the map rather than flanking it',
  afterEsc.closed && !afterEsc.scrimShown && afterEsc.toggleExpanded === 'false',
  JSON.stringify(afterEsc));

  // Open a county: at this width the kit's theme docks .sfsa-card as a bottom
  // sheet (theme §6 COMPACT). Everything below is about whether it actually
  // docks — and whether the close button can be TAPPED, which is the only
  // close route a touch user has.
  await page.evaluate(async (id) => {
    const app = await import(new URL('js/app.js', document.baseURI).href);
    app.ngpContext().selectCounty(id);
  }, CONFIG.county.id);
  await page.waitForFunction(() => !document.getElementById('county-card').hidden,
    null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  await s.shot('17-compact-card');

  const sheet = await page.evaluate(() => {
    const card = document.getElementById('county-card');
    const btn = document.getElementById('card-close');
    const r = btn.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {
      card: { top: Math.round(cr.top), bottom: Math.round(cr.bottom), height: Math.round(cr.height) },
      viewportH: window.innerHeight,
      computedTop: getComputedStyle(card).top,
      hitTag: hit ? (hit.id ? '#' + hit.id : hit.tagName.toLowerCase()
        + (hit.className ? '.' + String(hit.className).split(' ')[0] : '')) : null,
      hitInsideCard: !!(hit && card.contains(hit)),
      btnBox: { w: Math.round(r.width), h: Math.round(r.height) },
      sheetVar: getComputedStyle(document.documentElement).getPropertyValue('--sheet-h').trim(),
    };
  });
  check('the county card DOCKS to the bottom edge as a sheet at 375px',
    Math.abs(sheet.card.bottom - sheet.viewportH) <= 2,
    `card occupies y ${sheet.card.top}–${sheet.card.bottom} of a ${sheet.viewportH}px `
    + `viewport (computed top: ${sheet.computedTop}) — it is anchored to the TOP, `
    + `not docked. --sheet-h is stamped at ${sheet.sheetVar} regardless, which `
    + 'lifts the bottom corner controls and the toast by the height of a sheet '
    + 'that is not there');
  check('the card\'s close button is hit-testable (the only close route a touch '
    + 'user has)', sheet.hitInsideCard,
    `elementFromPoint at the button centre returns ${sheet.hitTag}, which is not `
    + 'inside the card — the button is covered');
  check('the close button meets the kit\'s 44px touch target (WCAG 2.5.5)',
    sheet.btnBox.w >= 44 && sheet.btnBox.h >= 44,
    `${sheet.btnBox.w}×${sheet.btnBox.h}px`);

  /* ── Both surfaces at once ──────────────────────────────────────────────
     Open the drawer OVER the open sheet. This is the phone's most crowded
     state, and it is the only one in which every control the contract below
     names is actually on screen: the year slider, the pasture-type select, the
     colour-by buttons and the search box all live in the drawer now, so
     measuring them with the drawer shut would measure boxes no thumb can
     reach. It is also the setup for the layer-order test that follows. */
  await page.locator('#btn-drawer').tap();
  await settleDrawer(page);
  const stacked = await page.evaluate(() => ({
    drawerOpen: !document.getElementById('drawer').classList.contains('is-closed'),
    sheetOpen: !document.getElementById('county-card').hidden,
  }));
  check('setup: the drawer is open over an open county sheet',
    stacked.drawerOpen && stacked.sheetOpen, JSON.stringify(stacked));
  await s.shot('17b-compact-drawer-over-sheet');

  /* Every interactive control on the phone, measured against TOUCH_CONTRACT
     above — the size the KIT's own @media (hover: none) block promises for each
     one. The measurement is printed either way, so a reader can disagree with
     the kit in the open. */
  const targets = await measureTargets(page, TOUCH_CONTRACT);
  const undersized = targets.filter((m) => m.w < m.min || m.h < m.min);
  console.log('    touch targets: '
    + targets.map((m) => `${m.id} ${m.w}×${m.h}`).join(', '));
  check('every visible control meets the touch size the kit promises it '
    + '(40px controls, 44px dismiss)',
  undersized.length === 0,
  undersized.map((m) => `${m.id} ${m.w}×${m.h} < ${m.min}`).join(', '));

  /* ── One Escape, one layer — the compact stack ───────────────────────────
     The drawer registers its keydown handler before initDetailCard (js/app.js
     wireControls, and the kit's ui/drawer.js documents the ordering), so with
     both surfaces open the drawer is on top and takes the first press. A single
     Escape that closed both would leave a phone visitor no way to keep the
     county they had just opened. */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const firstEsc = await page.evaluate(() => ({
    drawerClosed: document.getElementById('drawer').classList.contains('is-closed'),
    scrimShown: (() => { const sc = document.getElementById('drawer-scrim');
      return !!(sc && !sc.hidden && sc.getClientRects().length > 0); })(),
    sheetOpen: !document.getElementById('county-card').hidden,
  }));
  check('the FIRST Escape closes ONLY the drawer and leaves the county sheet up',
    firstEsc.drawerClosed && !firstEsc.scrimShown && firstEsc.sheetOpen,
    JSON.stringify(firstEsc));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('the SECOND Escape closes the sheet',
    await page.evaluate(() => document.getElementById('county-card').hidden));

  s.clean('compact');

  /* ── The second view's controls, on the phone ────────────────────────────
     LAST in this section, and after both surfaces are shut, so nothing above
     depends on the state this leaves behind. A week scrubber is the app's first
     control that is neither a button nor a select, and a range input with two
     icon step buttons beside it is exactly the shape that ends up 24px tall on
     a phone. It cannot be measured from the grazing-period view — the drought
     monitor's sections are `[hidden]` there, and an invisible element skips the
     measurement and passes vacuously — so this reopens the drawer, switches
     view for real, and asserts both that nothing is undersized AND that every
     control the contract names was actually on screen to be measured. */
  // A raw .tap() here has crashed real runs: the tap lands right after the
  // sheet-close map.resize(), and on software WebGL that repaint can stall the
  // renderer long enough for Playwright's scroll-into-view handshake to time
  // out. Settle the frame loop first, give the tap its own bounded timeout,
  // and retry once after another settle — a still-failing tap fails the named
  // check below with a reason instead of eating the whole summary (the same
  // rule clickControl encodes for clicks).
  await settleFrames(page);
  let drawerTapped = await page.locator('#btn-drawer').tap({ timeout: 15000 })
    .then(() => true).catch(() => false);
  if (!drawerTapped) {
    await settleFrames(page);
    drawerTapped = await page.locator('#btn-drawer').tap({ timeout: 15000 })
      .then(() => true).catch(() => false);
  }
  await settleDrawer(page);
  const usdmSeq = await viewSeq(page);
  const switched = drawerTapped
    && await clickControl(page, CONFIG.interfaces.usdm.switchSel);
  const arrived = switched && await awaitViewSeq(page, usdmSeq);
  check('a phone visitor can reach the drought monitor from the drawer', arrived,
    !drawerTapped ? '#btn-drawer never accepted the tap (renderer busy after the sheet-close resize?)'
      : switched ? `data-ngp-view-seq stayed at ${usdmSeq}`
        : `${CONFIG.interfaces.usdm.switchSel} was not clickable at 375px`);
  const usdmTargets = await measureTargets(page, USDM_TOUCH_CONTRACT);
  const usdmUndersized = usdmTargets.filter((m) => m.w < m.min || m.h < m.min);
  const wanted = USDM_TOUCH_CONTRACT.map(([sel]) => sel.replace('#', ''));
  const measured = new Set(usdmTargets.map((m) => m.id));
  const unmeasured = wanted.filter((id) => !measured.has(id));
  console.log('    drought-monitor touch targets: '
    + usdmTargets.map((m) => `${m.id} ${m.w}×${m.h}`).join(', '));
  check('the drought monitor\'s own controls meet the same touch sizes — the '
    + 'week scrubber, its two step buttons and the three dataset buttons, all '
    + 'of them really on screen rather than skipped for being hidden',
  arrived && usdmUndersized.length === 0 && unmeasured.length === 0,
  [arrived ? '' : 'the view switch never completed, so the sizes below are '
    + 'whatever was on screen',
    usdmUndersized.map((m) => `${m.id} ${m.w}×${m.h} < ${m.min}`).join(', '),
    unmeasured.length ? 'never measured: ' + unmeasured.join(', ') : '']
    .filter(Boolean).join(' | '));
  check('the phone does not scroll sideways with the week scrubber in the drawer',
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1),
    await page.evaluate(() => `scrollWidth ${document.documentElement.scrollWidth} > `
      + `innerWidth ${window.innerWidth}`));
  await s.shot('17c-compact-usdm');
  s.clean('compact drought monitor');
  await s.ctx.close();
}

/* ══════════════════════════════════════════════════════════════════════════
   THE PER-VIEW SECTION TEMPLATE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Drive one non-default view end to end, from the probe table entry alone.
 *
 * Written in PR 1 against no caller and first exercised in PR 2 by the drought
 * monitor, which is where three of its steps turned out to be written against
 * markup and conventions that did not exist:
 *
 *   · THE CATEGORICAL LEGEND. The kit's `swatches()` builds
 *     `li.sfsa-legend-item > span.sfsa-legend-label` and appends the no-data
 *     chip as one more row of the same list (style v0.2.0 ui/legend.js). The
 *     template looked for `[data-legend-item]`, which nothing has ever emitted,
 *     and would have reported "0 of 6 classes labelled" for a correct legend.
 *     It now reads the kit's own markup and holds the no-data chip to its
 *     documented place: LAST, and named in words.
 *   · ORACLES CAN FAIL TO EXIST. A row-count oracle reaches into the live
 *     decoder, and before the view is up there is nothing to reach. Returning
 *     a number OR a string (the reason) lets a missing oracle SKIP with a
 *     diagnosis instead of failing as `rows === undefined` — see the field list
 *     in tools/config.mjs.
 *   · WHERE extraChecks LIVES. A view's own controls have to be asserted with
 *     the paint-signature and marker probes at the top of this file, and
 *     tools/config.mjs is a data file that must not assert. So the body may
 *     also be passed in at the call site; the probe table still holds every
 *     selector, format and fixture it reads.
 *
 * The steps, in order, each ending where the plan says it should:
 *   1  switch          aria-pressed follows, the marker advances
 *   2  URL             ?view=<slug> appears for a non-default view
 *   3  lazy fetch      its payload was NOT fetched at boot, and is now
 *   4  repaint         the feature-state signature changed, and the painted
 *                      count is what the data (through the crosswalk, for a
 *                      FIPS-keyed view) says it should be
 *   5  legend          the expected body is the visible one, with a text key
 *   6  extraChecks     the view's own controls, each with its own clean()
 *   7  card            title + populated rows for the view's county
 *   8  table           rows === the view's own oracle
 *   9  export          filename scheme + PNG magic bytes
 *   10 state memory    round trip: the default view is untouched, this view's
 *                      own state is remembered
 *   11 clean URL       back at this view's defaults, only ?view remains
 *   12 clean() + shot
 *
 * @param {object} iface an entry from CONFIG.interfaces.
 * @param {{session: object, bootResources: string[],
 *          extraChecks: ?function}} opts the booted session from open() (with
 *   `downloads: true` if step 9 is wanted), the resource list read at boot for
 *   step 3, and the view's own control checks if they are not on the entry.
 */
async function verifyInterfaceSection(iface, {
  session, bootResources = [], extraChecks = iface.extraChecks,
}) {
  const { page, clean, shot } = session;
  const dflt = DEFAULT_INTERFACE;
  const ds = Object.values(iface.datasets).find((d) => d.isDefault)
    || Object.values(iface.datasets)[0];
  section(`▸ View ${iface.slug} — ${iface.label}`);

  /* 1 · Switch. */
  const sigBefore = await paintSignature(page, CONFIG.sourceId);
  const seq = await viewSeq(page);
  const clicked = await clickControl(page, iface.switchSel);
  const bumped = clicked && await awaitViewSeq(page, seq);
  const now = await viewControls(page);
  check(`the switcher moves the app to ${iface.label} (aria-pressed follows the `
    + 'view, and the transition marker advances)',
  bumped && now.views.length === 1 && now.views[0] === iface.slug,
  JSON.stringify({ clicked, bumped, pressed: now.views }));
  check(`every drawer section not belonging to ${iface.slug} is hidden`,
    now.sections.every((sec) => (sec.view === iface.slug) === !sec.hidden),
    JSON.stringify(now.sections));

  /* 2 · URL. */
  check(`?view=${iface.slug} appears — a non-default view is shareable state`,
    new URL(page.url()).searchParams.get('view') === iface.slug, page.url());

  /* 3 · Lazy fetch proof. */
  const fetched = await resourceNames(page);
  check(`the ${iface.slug} payload was fetched on the FIRST switch and not at `
    + 'boot (the boot path stays one payload wide)',
  !bootResources.some((n) => n.includes(ds.payload))
    && fetched.some((n) => n.includes(ds.payload)),
  `boot had ${bootResources.filter((n) => n.includes(ds.payload)).length}, `
    + `now ${fetched.filter((n) => n.includes(ds.payload)).length}`);

  /* 4 · Repaint, with an oracle rather than a number. */
  const sigAfter = await paintSignature(page, CONFIG.sourceId);
  check(`the choropleth repainted for ${iface.label} (feature-state signature `
    + 'changed)', sigBefore.hash !== sigAfter.hash,
  `${sigBefore.colored} @${sigBefore.hash} → ${sigAfter.colored} @${sigAfter.hash}`);
  if (typeof iface.paintOracle === 'function') {
    const expect = await iface.paintOracle(page);
    if (typeof expect === 'number') {
      check('every county with data in this view carries a colour, and no county '
        + 'without data kept one (no stale paint across the switch)',
      sigAfter.colored === expect, `${sigAfter.colored} painted, ${expect} expected`);
    } else {
      skip(`${iface.slug}: painted count against the data`, String(expect));
    }
  } else {
    skip(`${iface.slug}: painted count against the data`,
      'this view\'s probe-table entry defines no paintOracle');
  }

  /* 5 · Legend body. */
  const variable = (await snapshot(page)).state.variable;
  const kind = iface.legend.kinds ? iface.legend.kinds[variable] : iface.legend.kind;
  const bodies = { wheel: now.legend.wheel, bar: now.legend.bar,
    swatches: now.legend.swatches };
  check(`${iface.label}: the ${kind} legend is the visible body, with a text key`,
    bodies[kind] === true
      && Object.entries(bodies).every(([k, v]) => (k === kind) === (v === true))
      && (now.legend.key || '').length > 20,
    JSON.stringify(now.legend));
  if (Array.isArray(iface.legend.items)) {
    /* The kit's own markup, not a data- attribute of ours: swatches() emits
       `li.sfsa-legend-item` rows and appends the no-data chip as the LAST one
       (ui/legend.js — "no data is a category, and it is always last"). */
    const items = await page.evaluate(() => Array.from(
      document.querySelectorAll('#legend-swatches .sfsa-legend-item'))
      .map((n) => (n.textContent || '').trim()));
    const classes = iface.legend.items;
    check(`${iface.label}: the categorical legend labels every class in words `
      + '(colour is never the only channel)',
    items.length === classes.length + (iface.legend.noData ? 1 : 0)
      && classes.every((t, i) => (items[i] || '').includes(t)),
    JSON.stringify(items));
    if (iface.legend.noData) {
      check(`${iface.label}: "no data" is a NAMED category on the end of that `
        + 'list, not an unexplained grey',
      (items[items.length - 1] || '').includes(iface.legend.noData),
      JSON.stringify(items[items.length - 1] || null));
    }
  }
  clean(`view ${iface.slug} switch`);

  /* 6 · The view's own controls. */
  if (typeof extraChecks === 'function') {
    await extraChecks({ page, check, skip, clean, shot, iface });
  }

  /* 7 · Card.
     The selection goes THROUGH THE APP, so a view whose wiring is half-landed
     throws here — inside a page.evaluate, which rejects in Node and used to
     abort the process, taking the summary and every later section with it. A
     throw is turned into this step's own failed check instead, naming the
     app-side error. */
  const selected = await page.evaluate(async (id) => {
    const app = await import(new URL('js/app.js', document.baseURI).href);
    app.ngpContext().selectCounty(id);
    return true;
  }, iface.county.id).catch((err) => String(err).split('\n')[0]);
  if (selected !== true) {
    check(`${iface.label}: selecting ${iface.county.name} through the app does `
      + 'not throw', false, String(selected));
  }
  await page.waitForFunction(() => !document.getElementById('county-card').hidden,
    null, { timeout: 8000 }).catch(() => {});
  const card = await page.evaluate(() => ({
    title: (document.getElementById('card-title').textContent || '').trim(),
    rows: document.querySelectorAll('#card-rows dt').length,
    text: (document.getElementById('card-rows').textContent || '').trim(),
    figure: !!document.querySelector('#card-content figure'),
    twin: !!document.querySelector('#card-content figcaption'),
  }));
  check(`${iface.label}: the card names ${iface.county.name} and reads out this `
    + 'view\'s own rows',
  card.title.includes(iface.county.name) && card.rows >= 3
    && card.text.length > 40,
  JSON.stringify({ title: card.title, rows: card.rows }));
  check(`${iface.label}: the card's picture carries its accessible twin`,
    !card.figure || card.twin,
    `figure=${card.figure}, figcaption=${card.twin}`);

  /* 8 · Table, against the view's own oracle. */
  await page.locator('#btn-table').click();
  await page.waitForFunction(
    () => document.getElementById('table-modal').open
      && document.querySelectorAll('#table-modal-body tbody tr').length > 0,
    null, { timeout: CONFIG.switchMs }).catch(() => {});
  const table = await page.evaluate(() => ({
    rows: document.querySelectorAll('#table-modal-body tbody tr').length,
    caption: (document.getElementById('table-modal-caption').textContent || '').trim(),
  }));
  if (typeof iface.tableOracle === 'function') {
    const expect = await iface.tableOracle(page);
    if (typeof expect === 'number') {
      check(`${iface.label}: the table is this view's data, row for row`,
        table.rows === expect, `${table.rows} rows vs ${expect} records`);
    } else {
      skip(`${iface.slug}: table row count against the data`, String(expect));
    }
  } else {
    skip(`${iface.slug}: table row count against the data`,
      'this view\'s probe-table entry defines no tableOracle');
  }
  check(`${iface.label}: the caption names what frames this table`,
    table.caption.length > 20, JSON.stringify(table.caption));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('table-modal').open,
    null, { timeout: 5000 }).catch(() => {});
  clean(`view ${iface.slug} card and table`);

  /* 9 · Export. Needs a context opened with downloads: true. */
  if (session.acceptsDownloads) {
    const pending = page.waitForEvent('download', { timeout: 120000 })
      .catch(() => null);
    await page.locator('#btn-export').click();
    const dl = await pending;
    if (!dl) {
      check(`${iface.label}: the export button produces a PNG`, false,
        'no download appeared inside 120s');
    } else {
      const name = dl.suggestedFilename();
      const path = await dl.path();
      const bytes = path ? await readFile(path) : Buffer.alloc(0);
      check(`${iface.label}: the poster is named for the view it holds`,
        iface.exportName.test(name), name);
      check(`${iface.label}: and it really is a PNG`,
        bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50
          && bytes[2] === 0x4e && bytes[3] === 0x47,
        'first bytes: ' + [...bytes.slice(0, 8)].map((b) => b.toString(16)).join(' '));
    }
    clean(`view ${iface.slug} export`);
  }

  /* 10 · State memory across a round trip. */
  const mine = await snapshot(page);
  const seqOut = await viewSeq(page);
  await clickControl(page, dflt.switchSel);
  await awaitViewSeq(page, seqOut);
  const home = await snapshot(page);
  const seqIn = await viewSeq(page);
  await clickControl(page, iface.switchSel);
  await awaitViewSeq(page, seqIn);
  const again = await snapshot(page);
  check(`switching away and back remembers ${iface.label}'s own state, and left `
    + `${dflt.label}'s alone`,
  JSON.stringify(again.viewState) === JSON.stringify(mine.viewState)
    && home.state.view === dflt.slug,
  JSON.stringify({ mine: mine.viewState, again: again.viewState }));
  check('shared state carried across both switches (the county and the camera '
    + 'are the visitor\'s, not the view\'s)',
  again.state.countyId === mine.state.countyId
    && Math.abs(again.center[0] - mine.center[0]) < 0.05,
  JSON.stringify({ county: [mine.state.countyId, again.state.countyId] }));

  /* 11 · Clean URL, both ways. */
  const seqHome = await viewSeq(page);
  await clickControl(page, dflt.switchSel);
  await awaitViewSeq(page, seqHome);
  check('returning to the default view drops ?view entirely',
    !new URL(page.url()).searchParams.has('view'), page.url());

  /* 12 · Console gate and evidence. */
  clean(`view ${iface.slug}`);
  await shot(`2x-${iface.slug}`);
}

/* ══════════════════════════════════════════════════════════════════════════
   7. VIEWS AND DATASETS — the switcher, and one view's two datasets.

   The app is one page over several bodies of data. A view ("interface") is a
   body of data with its own controls, legend and card; a dataset is one
   ANSWER within a view — for grazing periods, what FSA published against what
   NAP-190's method yields from climate normals. The switch between them is the
   app's only asynchronous state change apart from the boundary swap, and it is
   the one a screenshot cannot check: the map still looks like a map when the
   toggle half-lands, when a fetch fails silently, or when the old paint sits
   under the new legend.

   Everything here therefore hangs off the app's own transition marker rather
   than a timeout — `data-ngp-view-seq`, bumped after the recolor's
   feature-state flush — and every interaction ends with a console-clean gate,
   because a superseded fetch is exactly the kind of failure that gets caught,
   logged and forgotten.

   A FRESH CONTEXT, not the main run's: this section asserts clean-URL
   discipline across a round trip, and the main run leaves a year, a county and
   a camera behind it. Starting from a real boot is what makes "the URL is
   clean again" mean anything.
   ══════════════════════════════════════════════════════════════════════════ */

section('▸ View switcher + NGP datasets — FSA official ↔ nClimGrid climatology');
{
  const NGP = CONFIG.interfaces.ngp;
  const OFFICIAL = NGP.datasets.fsa;
  const CLIMO = NGP.datasets.nclimgrid;

  const s = await open();
  const { page } = s;
  check('the dataset-toggle page reaches ngpReady', s.ready);
  s.clean('view section boot');

  /* ── The readiness markers themselves ───────────────────────────────────
     These are a CONTRACT WITH THIS FILE (tools/config.mjs § MARKERS): the
     harness waits on them, so a rename or a missing stamp turns every
     transition assertion below into a 30-second timeout with no diagnosis.
     Assert them by name first, so that failure reads as "the marker is gone"
     instead of "the app is broken". */
  const boot = await snapshot(page);
  check('boot stamps the active view into data-ngp-view (a harness can tell '
    + 'which body of data is on screen without importing the app)',
  boot.markers.ngpView === NGP.slug,
  'data-ngp-view is ' + JSON.stringify(boot.markers.ngpView || null));
  check('boot stamps a monotonic data-ngp-view-seq — the sequence every async '
    + 'transition below is waited on',
  /^[0-9]+$/.test(boot.markers.ngpViewSeq || ''),
  'data-ngp-view-seq is ' + JSON.stringify(boot.markers.ngpViewSeq || null));
  check('a clean boot carries no data-ngp-view-error',
    boot.markers.ngpViewError === undefined,
    'data-ngp-view-error is ' + JSON.stringify(boot.markers.ngpViewError || null));

  const official = await viewControls(page);
  check('the switcher shows exactly one pressed view, and it is the default one',
    official.views.length === 1 && official.views[0] === NGP.slug,
    `pressed ${JSON.stringify(official.views)} of ${official.viewBtns} button(s)`);
  check(`the dataset seg offers both grazing-period datasets with `
    + `"${OFFICIAL.label}" pressed`,
  official.datasetBtns === 2 && official.datasets.length === 1
    && official.datasets[0] === OFFICIAL.id,
  `${official.datasetBtns} button(s), pressed ${JSON.stringify(official.datasets)}`);
  check('exactly one legend body is visible, and on a grazing-period view it is '
    + 'never the swatches one (that body exists for the categorical views)',
  official.legend.swatches === false
    && [official.legend.wheel, official.legend.bar].filter(Boolean).length === 1,
  JSON.stringify(official.legend));
  await s.shot('18-ngp-official');

  /* ── Crosswalk integrity ────────────────────────────────────────────────
     nClimGrid is keyed by CENSUS FIPS and the map is keyed by FSA county, so
     every colour it paints arrives through assets/fsa-fips-crosswalk.json.
     Check the table itself here, by name: a truncated, mis-vintaged or
     integer-mangled crosswalk otherwise shows up as a mysteriously low painted
     count in the toggle below, which is a symptom three joins away from its
     cause. Ids are STRINGS on both sides — a crosswalk that ever saw
     parseInt() loses every leading zero in New England and Alabama at once. */
  const xw = await page.evaluate(async ([path, schema]) => {
    const app = await import(new URL('js/app.js', document.baseURI).href);
    const c = app.ngpContext();
    // A boot that failed leaves no geometry index. Report that instead of
    // throwing: an exception here would abort the run and take the summary
    // (and every assertion after this one) with it.
    if (!c.getCounties()) return { error: 'the app loaded no geometry index' };
    const idx = c.getCounties().index;
    const vintage = c.getVintage();
    let payload;
    try {
      const res = await fetch(new URL(path, document.baseURI).href);
      if (!res.ok) return { error: `HTTP ${res.status} for ${path}` };
      payload = await res.json();
    } catch (err) { return { error: String(err) }; }
    const five = (a) => a.every((v) => typeof v === 'string' && /^[0-9]{5}$/.test(v));
    const out = {
      schema: payload.schema, expectedSchema: schema, vintage,
      geometry: idx.size, vintages: {},
    };
    for (const v of Object.keys(payload)) {
      const t = payload[v];
      if (!t || typeof t !== 'object' || !Array.isArray(t.fsa)) continue;
      out.vintages[v] = {
        n: t.n, fsa: t.fsa.length, fips: t.fips.length,
        strings: five(t.fsa) && five(t.fips),
      };
    }
    const table = payload[vintage];
    if (table) {
      const named = new Set(table.fsa);
      const reachable = [...idx.keys()].filter((id) => named.has(id));
      out.reach = { named: named.size, reachable: reachable.length };
      const orphans = [...named].filter((id) => !idx.has(id));
      out.orphans = { count: orphans.length, sample: orphans.slice(0, 5) };
    }
    return out;
  }, [CROSSWALK.path, CROSSWALK.schema]);

  if (xw.error) {
    check(`the crosswalk at ${CROSSWALK.path} could be read and checked against `
      + 'the loaded geometry', false, xw.error);
  } else {
    check(`the crosswalk declares schema ${JSON.stringify(CROSSWALK.schema)}`,
      xw.schema === CROSSWALK.schema, 'schema is ' + JSON.stringify(xw.schema));
    check('it holds a table for BOTH boundary vintages — dd17 and dd22 do not '
      + 'share county footprints, so a FIPS join needs both',
    CROSSWALK.vintages.every((v) => xw.vintages[v]),
    'tables: ' + JSON.stringify(Object.keys(xw.vintages)));
    check('each table is two PARALLEL arrays whose length is the pair count it '
      + 'declares',
    CROSSWALK.vintages.every((v) => xw.vintages[v]
      && xw.vintages[v].fsa === xw.vintages[v].fips
      && xw.vintages[v].fsa === xw.vintages[v].n),
    JSON.stringify(xw.vintages));
    check('every id on both sides is a 5-CHARACTER STRING (leading zeros '
      + 'intact — never a FIPS integer, never parseInt)',
    CROSSWALK.vintages.every((v) => xw.vintages[v] && xw.vintages[v].strings),
    JSON.stringify(xw.vintages));
    check('the pair counts are the ones the crosswalk contract froze '
      + `(dd17 ${CROSSWALK.pairs.dd17} · dd22 ${CROSSWALK.pairs.dd22})`,
    CROSSWALK.vintages.every((v) => xw.vintages[v]
      && xw.vintages[v].n === CROSSWALK.pairs[v]),
    'counts are ' + JSON.stringify(Object.fromEntries(
      Object.entries(xw.vintages).map(([v, t]) => [v, t.n])))
      + ' — if a boundary archive was legitimately rebuilt, CROSSWALK.pairs in '
      + 'tools/config.mjs moves in the same commit as the asset');
    if (xw.reach) {
      // The direction that matters for painting: can a FIPS-keyed dataset
      // reach the polygons on screen? A few named FSA ids with no polygon are
      // expected (the archives' county lists are not the composite's), so the
      // gate is coverage of the GEOMETRY, and the orphans are printed.
      check('the crosswalk reaches the map: it names essentially every polygon '
        + `in the loaded ${xw.vintage} geometry `
        + `(${xw.reach.reachable} of ${xw.geometry})`,
      xw.reach.reachable >= xw.geometry * 0.98,
      `${xw.reach.reachable} of ${xw.geometry} polygons named, `
        + `${xw.orphans.count} named ids have no polygon `
        + `(${xw.orphans.sample.join(', ')})`);
    }
  }

  /* ── The toggle ─────────────────────────────────────────────────────────
     One click, then wait on the app's marker. Everything the dataset owns has
     to move together: the paint (through the crosswalk), the year control (a
     climatology has no year), the type dictionary (three seasons, not fifteen
     pasture types), the legend's text key, and the URL. */
  const sigOfficial = await paintSignature(page, CONFIG.sourceId);
  const seq0 = await viewSeq(page);
  const clicked = await clickControl(page, CLIMO.sel);
  const bumped = clicked && await awaitViewSeq(page, seq0);
  check(`the ${JSON.stringify(CLIMO.label)} toggle completes: data-ngp-view-seq `
    + 'advances, which the app stamps only after the fetch, the recolor and the '
    + 'feature-state flush',
  bumped, clicked
    ? `data-ngp-view-seq stayed at ${seq0} for ${CONFIG.switchMs / 1000}s`
    : `${CLIMO.sel} was not clickable — the dataset seg is missing or covered`);
  const climo = await viewControls(page);
  const climoSnap = await snapshot(page);
  check('no transition error was recorded (a failed fetch would stamp '
    + 'data-ngp-view-error and show the retry note)',
  climoSnap.markers.ngpViewError === undefined,
  'data-ngp-view-error is ' + JSON.stringify(climoSnap.markers.ngpViewError || null));
  check('the nClimGrid button is the pressed one now, and the official one is '
    + 'not — aria-pressed is what the kit styles them from',
  climo.datasets.length === 1 && climo.datasets[0] === CLIMO.id,
  'pressed ' + JSON.stringify(climo.datasets));
  check('?dataset=nclimgrid appears — a non-default dataset is shareable state',
    new URL(page.url()).searchParams.get('dataset') === CLIMO.id, page.url());
  check('the app is on the nClimGrid dataset by its own account',
    climoSnap.state.dataset === CLIMO.id,
    JSON.stringify(climoSnap.state));

  const sigClimo = await paintSignature(page, CONFIG.sourceId);
  check('the choropleth repainted onto the climatology (feature-state signature '
    + 'changed)', sigOfficial.hash !== sigClimo.hash,
  `${sigOfficial.colored} colored @${sigOfficial.hash} → `
    + `${sigClimo.colored} @${sigClimo.hash}`);

  /* The painted count, against the crosswalk rather than against a number
     typed here: the expectation is the set of FSA polygons any reporting FIPS
     county maps onto, computed from the asset and the active decoder. A round
     number would pass for the wrong reason the first time a vintage changed. */
  const expected = await page.evaluate(async (path) => {
    const d = await import(new URL('js/data.js', document.baseURI).href);
    const app = await import(new URL('js/app.js', document.baseURI).href);
    const c = app.ngpContext();
    const { year, type } = c.getState();
    if (!c.getCounties()) return { error: 'the app loaded no geometry index' };
    const idx = c.getCounties().index;
    const res = await fetch(new URL(path, document.baseURI).href);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const table = (await res.json())[c.getVintage()];
    if (!table) return { error: 'no table for ' + c.getVintage() };
    const toFsa = new Map();
    for (let i = 0; i < table.fips.length; i++) {
      const list = toFsa.get(table.fips[i]);
      if (list) list.push(table.fsa[i]);
      else toFsa.set(table.fips[i], [table.fsa[i]]);
    }
    const records = d.getYearType(year, type);
    const painted = new Set();
    for (const fips of records.keys()) {
      for (const fsa of (toFsa.get(fips) || [])) if (idx.has(fsa)) painted.add(fsa);
    }
    return { expected: painted.size, records: records.size };
  }, CROSSWALK.path);
  if (expected.error) {
    skip('every county the crosswalk reaches carries a climatology colour',
      'the crosswalk-joined oracle could not be computed: ' + expected.error);
  } else {
    check('every county the crosswalk reaches carries a climatology colour, and '
      + 'nothing else does (no stale official paint under the new legend)',
    sigClimo.colored === expected.expected && expected.expected > 2000,
    `${sigClimo.colored} painted, ${expected.expected} expected from `
      + `${expected.records} FIPS records`);
  }

  check('the year slider is DISABLED — a 1991–2020 climatology has one set of '
    + 'periods for every year, so a live slider would promise a distinction '
    + 'the data cannot make',
  climo.yearDisabled === true, 'year-range disabled=' + climo.yearDisabled);
  check('…and the note that says so is visible, in words — a disabled control '
    + 'with no explanation is a dead end',
  climo.noteShown && /climatolog|all years/i.test(climo.noteText || ''),
  JSON.stringify(climo.noteText));
  check(`the type select was repopulated with the climatology's own dictionary `
    + `(${CLIMO.types} seasons, not the official pasture types)`,
  climo.types.length === CLIMO.types, JSON.stringify(climo.types));
  check('the official default type mapped across to its season rather than '
    + `resetting (Native Pasture → ${JSON.stringify(CLIMO.fromDefaultType)})`,
  climo.type === CLIMO.fromDefaultType, 'selected ' + JSON.stringify(climo.type));
  check('the legend\'s text key says these numbers are computed from climate '
    + 'normals, not reported by FSA',
  climo.legend.key !== official.legend.key
    && /climatolog|climate normal|1991/i.test(climo.legend.key || ''),
  JSON.stringify((climo.legend.key || '').slice(0, 120)));
  check('the legend body did not change with the dataset — start/end/duration '
    + 'are the same three variables on either answer',
  climo.legend.wheel === official.legend.wheel
    && climo.legend.bar === official.legend.bar,
  JSON.stringify({ official: official.legend, climo: climo.legend }));
  s.clean('dataset toggle → nClimGrid');
  await s.shot('18b-ngp-nclimgrid');

  /* ── And back ───────────────────────────────────────────────────────────
     A toggle that cannot be undone is a trap. Back on the official dataset
     everything must be as it was — including the URL, which is the strictest
     of the lot: a param left behind at its default is a permanent smudge on
     every link shared afterwards. */
  const seq1 = await viewSeq(page);
  const clickedBack = await clickControl(page, OFFICIAL.sel);
  const bumpedBack = clickedBack && await awaitViewSeq(page, seq1);
  const back = await viewControls(page);
  const backSnap = await snapshot(page);
  const sigBack = await paintSignature(page, CONFIG.sourceId);
  check('the toggle back to FSA official completes on the same marker', bumpedBack,
    `data-ngp-view-seq stayed at ${seq1}`);
  check('?dataset is DROPPED at the default, not rewritten to ?dataset=fsa',
    !new URL(page.url()).searchParams.has('dataset'), page.url());
  check('and the whole round trip leaves the URL as clean as it booted — no '
    + '?view, no ?dataset, no ?type left over from the season dictionary',
  new URL(page.url()).search === '',
  'search is ' + JSON.stringify(new URL(page.url()).search));
  check('the official paint returns bit for bit (the toggle back is a restore, '
    + 'not a reload of something new)',
  sigBack.hash === sigOfficial.hash && sigBack.colored === sigOfficial.colored,
  `${sigOfficial.colored} @${sigOfficial.hash} → ${sigBack.colored} @${sigBack.hash}`);
  check('the year slider is live again and the climatology note is gone',
    back.yearDisabled === false && !back.noteShown,
    JSON.stringify({ disabled: back.yearDisabled, note: back.noteShown }));
  check('the official pasture types are back, on the type this run left there',
    back.types.length === official.types.length && back.type === official.type,
    `${back.types.length} options, selected ${JSON.stringify(back.type)}`);
  check('the app is on the official dataset by its own account',
    backSnap.state.dataset === OFFICIAL.id, JSON.stringify(backSnap.state));
  s.clean('dataset toggle → official');
  await s.shot('18c-ngp-official-restored');

  /* ── Two clicks, no waiting ─────────────────────────────────────────────
     Deliberate abuse, and the only reason it is here: a visitor who changes
     their mind mid-fetch must not leave an unhandled rejection behind. The
     app's rule is intent-recheck-after-await rather than abort (the vintage
     swap's pattern), so the second click's state has to win and the first
     click's resolution has to notice it was superseded and do nothing. Either
     way, the console gate below is what makes this a test — plus the assertion
     that the app came to rest where the LAST click asked, not where the
     slowest fetch did. */
  const seq2 = await viewSeq(page);
  await clickControl(page, CLIMO.sel);
  await clickControl(page, OFFICIAL.sel);
  await awaitViewSeq(page, seq2);
  await page.waitForTimeout(1200);          // let a superseded fetch land too
  await settleFrames(page);
  const settled = await viewControls(page);
  const settledSnap = await snapshot(page);
  const sigSettled = await paintSignature(page, CONFIG.sourceId);
  check('a double toggle with no waiting comes to rest where the LAST click '
    + 'asked (official), not where the slowest fetch did',
  settled.datasets.length === 1 && settled.datasets[0] === OFFICIAL.id
    && settledSnap.state.dataset === OFFICIAL.id,
  JSON.stringify({ pressed: settled.datasets, state: settledSnap.state.dataset }));
  check('…with the official paint, an enabled year slider and a clean URL — a '
    + 'superseded transition left nothing of itself behind',
  sigSettled.hash === sigOfficial.hash && settled.yearDisabled === false
    && new URL(page.url()).search === '',
  `@${sigSettled.hash} vs @${sigOfficial.hash}, disabled=`
    + `${settled.yearDisabled}, search ${JSON.stringify(new URL(page.url()).search)}`);
  check('no transition error survived the double toggle',
    settledSnap.markers.ngpViewError === undefined,
    'data-ngp-view-error is '
    + JSON.stringify(settledSnap.markers.ngpViewError || null));
  s.clean('rapid dataset toggle');

  await s.ctx.close();
}

/* ══════════════════════════════════════════════════════════════════════════
   8. THE DROUGHT MONITOR — the second interface, driven by the template.

   One body of data, three ways of counting counties, and a control the app has
   never had before: a week inside the year. Everything structural — the switch,
   the lazy fetch, the legend body, the card, the table, the poster, the state
   round trip — is the section template above, from the probe table entry alone.
   What is below is only what this view ADDS, and every one of those checks is
   about a claim a screenshot cannot make:

     · a range input that repaints the map without a fetch (so the transition
       marker must NOT move — a week scrub is not a view change);
     · three datasets that disagree about what a county is, where the
       disagreement is the POINT and has to be counted out loud rather than
       quietly dropped (Connecticut, on the NDMC-reported set);
     · a year domain that is re-authored on the way in and handed back on the
       way out, with a shared year outside the other view's range clamped and
       ANNOUNCED rather than silently moved.
   ══════════════════════════════════════════════════════════════════════════ */

/** The week control's selectors, flattened for the in-page probe: Playwright
    serialises evaluate() arguments as data, and the probe-table entry carries
    RegExps (which do not survive the trip). The patterns are applied HERE, in
    Node, against the strings the probe brings back. */
const WEEK = CONFIG.interfaces.usdm.week;
const WEEK_SELS = {
  sectionSel: WEEK.sectionSel, rangeSel: WEEK.rangeSel, outSel: WEEK.outSel,
  prevSel: WEEK.prevSel, nextSel: WEEK.nextSel,
  rangeId: WEEK.rangeSel.replace('#', ''),
};

/** Everything the week control, its URL param and its stored state say, in one
    round trip. `exists: false` is an answer, not a crash: the checks that
    depend on the control then skip with a reason instead of throwing a
    Playwright stack trace out of the middle of the section. */
const weekProbe = (page) => page.evaluate((s) => {
  const r = document.querySelector(s.rangeSel);
  const o = document.querySelector(s.outSel);
  const sec = document.querySelector(s.sectionSel);
  const prev = document.querySelector(s.prevSel);
  const next = document.querySelector(s.nextSel);
  const url = new URL(location.href);
  const label = (n) => (n
    ? (n.getAttribute('aria-label') || (n.textContent || '')).trim() : null);
  return {
    exists: !!r,
    hasPrev: !!prev,
    hasNext: !!next,
    value: r ? r.value : null,
    min: r ? r.min : null,
    max: r ? r.max : null,
    step: r ? r.step : null,
    disabled: r ? !!r.disabled : null,
    /** WCAG 1.3.1/4.1.2: a bare range is an unnamed control. Either form
        counts — an sr-only <label for> (what the app does for the year) or an
        aria-label. */
    named: r ? !!(r.getAttribute('aria-label')
      || document.querySelector(`label[for="${s.rangeId}"]`)) : null,
    outTag: o ? o.tagName.toLowerCase() : null,
    outFor: o ? o.getAttribute('for') : null,
    out: o ? (o.textContent || '').trim() : null,
    prevLabel: label(prev),
    nextLabel: label(next),
    sectionHidden: sec ? sec.hidden : null,
    weekParam: url.searchParams.get('week'),
    datasetParam: url.searchParams.get('dataset'),
    viewParam: url.searchParams.get('view'),
    seq: Number(document.documentElement.dataset.ngpViewSeq || 0),
    stored: (() => {
      try { return Object.keys(localStorage); } catch (e) { return []; }
    })(),
    storedDataset: (() => {
      try { return localStorage.getItem('sfsa-ngp-dataset-usdm'); }
      catch (e) { return 'unavailable'; }
    })(),
  };
}, WEEK_SELS);

/** "Jul 24, 2012 · week 30 of 52" → {n: 30, of: 52}. The <output> is the
    harness's canonical week number: `?week` is 1-based WITHIN THE YEAR, and
    reading the printed number keeps every assertion independent of whether the
    range input carries that number or an absolute week index. */
function weekNumber(out) {
  const m = CONFIG.interfaces.usdm.week.outWeek.exec(out || '');
  return m ? { n: Number(m[1]), of: Number(m[2]) } : null;
}

/**
 * Move the scrubber the way a pointer does, to the Nth week OF THE YEAR.
 *
 * `min` is week 1 of the selected year whichever units the input uses — 1 if it
 * counts weeks within the year, the year's first absolute index if it counts
 * along the whole record — so `min + (n - 1)` is week n either way. `max` (with
 * n = null) is the default: the last week the record holds for this year.
 *
 * Returns false if there is no scrubber to move, rather than throwing: a
 * missing control is a named failure of its own check, not a reason for the
 * sections after it to go unreported.
 */
const scrubWeek = (page, n) => page.evaluate(([s, k]) => {
  const r = document.querySelector(s.rangeSel);
  if (!r) return false;
  r.value = k === null ? r.max : String(Number(r.min) + (k - 1));
  r.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}, [WEEK_SELS, n]);

/** The year domain the ACTIVE decoder actually covers. The ceiling is never a
    literal in this file: the USDM record grows a week every Tuesday. */
const dataYears = (page) => page.evaluate(async () => {
  const app = await import(new URL('js/app.js', document.baseURI).href);
  const d = app.ngpContext().getData();
  const ys = (d && typeof d.years === 'function' ? d.years() : []) || [];
  return { min: ys[0] ?? null, max: ys[ys.length - 1] ?? null, n: ys.length };
});

/** A week scrub's repaint, waited out: the app throttles it to a frame (like
    the year slider) and debounces the announcement to ~350ms. */
const settleWeek = async (page) => {
  await page.waitForTimeout(600);
  await settleFrames(page);
};

/**
 * The drought monitor's own controls — step 6 of the section template.
 *
 * Lives here rather than in the probe table because every check below needs the
 * paint-signature, marker and live-region probes at the top of this file, and
 * tools/config.mjs is a data file that must not assert (its own header says so).
 * The selectors, formats, fixtures and oracles it reads are all in the entry.
 */
async function usdmExtraChecks({ page, check, skip, clean, shot, iface }) {
  const DS = iface.datasets;

  /* ── 8a. The week scrubber ──────────────────────────────────────────────── */
  section('▸ Drought monitor — the week scrubber');
  const w0 = await weekProbe(page);
  check('the drought monitor ships a week-within-year scrubber: a range input, '
    + 'an <output> bound to it, and a step button on either side',
  w0.exists && w0.outTag === 'output' && w0.outFor === WEEK_SELS.rangeId
    && w0.hasPrev && w0.hasNext,
  JSON.stringify({ range: w0.exists, out: w0.outTag, for: w0.outFor,
    prev: w0.hasPrev, next: w0.hasNext }));

  if (!w0.exists) {
    skip('the week scrubber drives the map', `${WEEK.rangeSel} is not in the page`);
  } else {
    check('the scrubber and its two step buttons are NAMED, not left as an '
      + 'unlabelled slider and two icons',
    w0.named && /previous week/i.test(w0.prevLabel || '')
      && /next week/i.test(w0.nextLabel || ''),
    JSON.stringify({ named: w0.named, prev: w0.prevLabel, next: w0.nextLabel }));
    check('the <output> reads as a DATE and a place in the year — "Jul 24, 2012 '
      + '· week 30 of 52" — because "week 30" is not a date and a date alone '
      + 'does not say how far through the year it is',
    WEEK.outFormat.test(w0.out || '')
      && /[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}/.test(w0.out || ''),
    JSON.stringify(w0.out));
    check('the scrubber opens on the LATEST week the record holds for this year, '
      + 'and a default says nothing in the URL',
    w0.value === w0.max && w0.weekParam === null,
    JSON.stringify({ value: w0.value, max: w0.max, week: w0.weekParam }));

    /* One scrub, and everything that has to move with it. */
    const sigBefore = await paintSignature(page, CONFIG.sourceId);
    const seqBefore = await viewSeq(page);
    await scrubWeek(page, 10);
    await settleWeek(page);
    const w1 = await weekProbe(page);
    const sigAfter = await paintSignature(page, CONFIG.sourceId);
    const n1 = weekNumber(w1.out);
    check('scrubbing repaints the choropleth (feature-state signature changed) '
      + '— the drought map is a different map every week',
    sigBefore.hash !== sigAfter.hash,
    `${sigBefore.colored} @${sigBefore.hash} → ${sigAfter.colored} @${sigAfter.hash}`);
    check('the <output> followed the thumb to week 10 of the selected year',
      !!n1 && n1.n === 10, JSON.stringify(w1.out));
    check('the week is mirrored into the URL as a 1-based week WITHIN THE YEAR '
      + '(?week=10), not as an index into the whole record',
    w1.weekParam === '10', page.url());
    check('a week scrub does NOT bump data-ngp-view-seq: that marker sequences '
      + 'fetch-involving transitions, and a scrub is a synchronous repaint',
    w1.seq === seqBefore, `seq ${seqBefore} → ${w1.seq}`);
    const said = await liveText(page);
    check('the live region names the week once the scrub comes to rest (the '
      + 'canvas has no text a screen reader can reach)',
    /week of/i.test(said)
      && said.includes((/[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}/.exec(w1.out) || [''])[0]),
    JSON.stringify(said.slice(0, 160)));
    check('the week is a SELECTION, not a preference: nothing in localStorage '
      + 'holds it (a returning visitor gets the latest week, not last month\'s)',
    !w1.stored.some((k) => /week/i.test(k)), JSON.stringify(w1.stored));

    /* The keyboard, on the focused range — WCAG 2.1.1 for a control whose
       whole job is to move one step at a time. */
    await page.locator(WEEK.rangeSel).focus();
    await page.keyboard.press('ArrowRight');
    await settleWeek(page);
    const right = weekNumber((await weekProbe(page)).out);
    await page.keyboard.press('ArrowLeft');
    await settleWeek(page);
    const left = weekNumber((await weekProbe(page)).out);
    check('ArrowRight on the focused scrubber steps one week forward and '
      + 'ArrowLeft steps back (10 → 11 → 10)',
    !!right && !!left && right.n === 11 && left.n === 10,
    JSON.stringify({ right: right && right.n, left: left && left.n }));

    /* The two step buttons: the same move for a thumb that cannot grab a
       12-pixel-wide week. Clicked softly (clickControl) — a missing step button
       is one named failure, not the end of the run. */
    await clickControl(page, WEEK.nextSel);
    await settleWeek(page);
    const nextW = await weekProbe(page);
    await clickControl(page, WEEK.prevSel);
    await settleWeek(page);
    const prevW = await weekProbe(page);
    const nextN = weekNumber(nextW.out);
    const prevN = weekNumber(prevW.out);
    check('Next week and Previous week move the same one week, and the URL '
      + 'follows both ways',
    !!nextN && !!prevN && nextN.n === 11 && prevN.n === 10
      && nextW.weekParam === '11' && prevW.weekParam === '10',
    JSON.stringify({ next: nextN && nextN.n, nextParam: nextW.weekParam,
      prev: prevN && prevN.n, prevParam: prevW.weekParam }));

    /* Back to the default, which must take the param with it. */
    await scrubWeek(page, null);
    await settleWeek(page);
    const home = await weekProbe(page);
    const homeN = weekNumber(home.out);
    check('scrubbing back to the latest week DROPS ?week — a param at its '
      + 'default is a permanent smudge on every link shared afterwards',
    home.weekParam === null && !!homeN && homeN.n === homeN.of,
    `week=${home.weekParam}, output ${JSON.stringify(home.out)}`);
    clean('week scrubber');
    await shot('19-usdm-week');
  }

  /* ── 8b. Three county keys for one drought map ───────────────────────────
     The three datasets are the same USDM, counted against three ideas of what
     a county is. Switching between them is a fetch, a re-join through the
     crosswalk and a recolor, so each one waits on the marker; and each one has
     to be HONEST about what it could not reach — which is the whole reason FSA
     LFP boundaries is the default and NDMC-reported is not. */
  section('▸ Drought monitor — three county keys, and what each one cannot reach');
  let prevSig = await paintSignature(page, CONFIG.sourceId);
  for (const ds of [DS.reported, DS.census, DS['fsa-lfp']]) {
    const seq = await viewSeq(page);
    const clicked = await clickControl(page, ds.sel);
    const bumped = clicked && await awaitViewSeq(page, seq);
    const vc = await viewControls(page);
    const snap = await snapshot(page);
    const sig = await paintSignature(page, CONFIG.sourceId);
    const probe = await weekProbe(page);
    check(`the ${JSON.stringify(ds.label)} toggle completes on data-ngp-view-seq `
      + '(fetch, crosswalk re-join, recolor, feature-state flush)',
    bumped, clicked ? `data-ngp-view-seq stayed at ${seq}`
      : `${ds.sel} was not clickable — the drought-monitor dataset seg is missing`);
    check(`${ds.label}: it is the one pressed button of the view's three, and no `
      + 'grazing-period dataset button is in play',
    vc.datasets.length === 1 && vc.datasets[0] === ds.id && vc.datasetBtns === 3,
    `${vc.datasetBtns} button(s) in play, pressed ${JSON.stringify(vc.datasets)}`);
    check(`${ds.label}: the app is on it by its own account, with no transition `
      + 'error left behind',
    snap.state.dataset === ds.id && snap.markers.ngpViewError === undefined,
    JSON.stringify({ dataset: snap.state.dataset,
      error: snap.markers.ngpViewError || null }));
    check(ds.isDefault
      ? `${ds.label} is the default, so ?dataset is DROPPED rather than rewritten`
      : `?dataset=${ds.id} appears — a non-default dataset is shareable state`,
    probe.datasetParam === (ds.isDefault ? null : ds.id), page.url());
    check(`${ds.label}: the choropleth repainted onto it — three county keys are `
      + 'three different maps, not one map relabelled',
    sig.hash !== prevSig.hash,
    `${prevSig.colored} @${prevSig.hash} → ${sig.colored} @${sig.hash}`);
    const expect = await iface.paintOracle(page);
    if (typeof expect === 'number') {
      check(`${ds.label}: every FSA county this week's classes reach carries a `
        + 'colour, and nothing else does',
      sig.colored === expect, `${sig.colored} painted, ${expect} expected`);
    } else {
      skip(`${ds.label}: painted count against the crosswalked data`, String(expect));
    }
    check(`${ds.label}: the choice is remembered for the next visit `
      + '(sfsa-ngp-dataset-usdm)',
    probe.storedDataset === ds.id,
    'stored ' + JSON.stringify(probe.storedDataset));

    /* The unmatched count — the reason the default is what it is. */
    const unmatched = await iface.unmatchedOracle(page);
    const said = await liveText(page);
    const claim = /(\d+)\s+reported areas could not be matched to an FSA county/i
      .exec(said);
    if (typeof unmatched !== 'number') {
      skip(`${ds.label}: the unmatched-area count`, String(unmatched));
    } else if (ds.id === 'reported') {
      check(`NDMC reported: the live region COUNTS the reported areas the FSA `
        + `crosswalk cannot reach (${unmatched} of them — Connecticut is keyed `
        + 'as its nine planning regions for the whole record, and no FSA county '
        + 'covers them), rather than dropping them silently',
      unmatched === DS.reported.unmatchedAtDefaultYear && !!claim
        && Number(claim[1]) === unmatched,
      `oracle says ${unmatched} (expected ${DS.reported.unmatchedAtDefaultYear}), `
        + `the live region says ${JSON.stringify(said.slice(0, 200))}`);
    } else if (ds.isDefault) {
      check('FSA LFP boundaries: nothing is left over to report — FSA\'s own LFP '
        + 'geometry is keyed the way this map is, which is why it is the default',
      unmatched === 0 && !claim,
      `oracle says ${unmatched}, live region `
        + JSON.stringify(said.slice(0, 200)));
    }
    clean(`usdm dataset → ${ds.id}`);
    await shot(`19b-usdm-${ds.id}`);
    prevSig = sig;
  }

  /* ── 8c. The shared year, re-authored ───────────────────────────────────
     The year is the visitor's, not the view's — but the two views do not cover
     the same years, and the USDM record starts eight years before FSA's first
     program year. So the slider's DOMAIN belongs to whichever view is on
     screen, and a year the next view has never heard of has to be moved and
     SAID rather than silently accepted. */
  section('▸ Drought monitor — the shared year, re-authored and clamped');
  {
    const dflt = DEFAULT_INTERFACE;
    const vc = await viewControls(page);
    const years = await dataYears(page);
    check(`the year slider is re-authored to the USDM record: min `
      + `${iface.yearDomain.min}, and a ceiling read from the payload rather `
      + 'than typed into a harness (the record grows every Tuesday)',
    vc.yearMin === String(iface.yearDomain.min)
      && years.min === iface.yearDomain.min
      && vc.yearMax === String(years.max) && vc.yearDisabled === false,
    JSON.stringify({ slider: [vc.yearMin, vc.yearMax], data: years,
      disabled: vc.yearDisabled }));

    /* A year only this view has, then a switch to the view that does not. */
    await slideYear(page, 2004);
    await settleVintage(page);
    const at2004 = await snapshot(page);
    check('2004 is reachable on the drought monitor — eight years before FSA '
      + 'published a grazing period',
    at2004.state.year === 2004 && at2004.vintage === 'dd17',
    JSON.stringify({ year: at2004.state.year, vintage: at2004.vintage }));

    const saidBefore = await liveText(page);
    const seq = await viewSeq(page);
    await clickControl(page, dflt.switchSel);
    await awaitViewSeq(page, seq);
    await settleVintage(page);
    const home = await viewControls(page);
    const homeSnap = await snapshot(page);
    const saidAfter = await liveText(page);
    check(`switching to ${dflt.label} CLAMPS the out-of-domain year to `
      + `${dflt.yearDomain.min}, the first program year FSA published, and puts `
      + 'the domain back with it',
    homeSnap.state.year === dflt.yearDomain.min
      && home.year === String(dflt.yearDomain.min)
      && home.yearMin === String(dflt.yearDomain.min),
    JSON.stringify({ year: homeSnap.state.year, slider: home.year,
      min: home.yearMin }));
    /* The clamp has to be SAID, and "said" cannot mean "the ordinary
       view-switch sentence happens to contain 2008" — every grazing-period
       announcement contains its year. So the live region has to have changed,
       to name the year the app moved to, AND to acknowledge the move; the
       vocabulary that counts as acknowledging it is the copy contract on the
       probe-table entry (yearDomain.clampSays), which is where a wording change
       is one line. */
    check('…and the clamp is ANNOUNCED rather than silent: the live region '
      + 'changed, names the year the app moved to, and says that it moved',
    saidAfter !== saidBefore && saidAfter.includes(String(dflt.yearDomain.min))
      && dflt.yearDomain.clampSays.test(saidAfter),
    `live region says ${JSON.stringify(saidAfter.slice(0, 220))} — it must name `
      + `${dflt.yearDomain.min} and match ${dflt.yearDomain.clampSays}`);

    const seqBack = await viewSeq(page);
    await clickControl(page, iface.switchSel);
    await awaitViewSeq(page, seqBack);
    const back = await viewControls(page);
    check('switching back re-authors the USDM domain again, and the clamped '
      + 'year stays clamped — the app moved the visitor once, not twice',
    back.yearMin === String(iface.yearDomain.min)
      && back.year === String(dflt.yearDomain.min),
    JSON.stringify({ min: back.yearMin, year: back.year }));
    clean('year domain re-author');
  }

  /* ── 8d. The week survives a round trip ─────────────────────────────────
     A year both views hold, so nothing is clamped and the only thing that can
     change is the week itself. */
  section('▸ Drought monitor — the week is remembered across a view switch');
  {
    const dflt = DEFAULT_INTERFACE;
    await slideYear(page, 2012);
    await settleVintage(page);
    await scrubWeek(page, 10);
    await settleWeek(page);
    const before = await weekProbe(page);
    const beforeN = weekNumber(before.out);

    const seq = await viewSeq(page);
    await clickControl(page, dflt.switchSel);
    await awaitViewSeq(page, seq);
    const away = await weekProbe(page);
    check('while the grazing periods are on screen the drought monitor\'s ?week '
      + 'is dropped from the URL — only the active view\'s params are emitted',
    before.weekParam === '10' && away.weekParam === null
      && away.viewParam === null,
    `?week was ${JSON.stringify(before.weekParam)} on the drought monitor and is `
      + `${JSON.stringify(away.weekParam)} here — ${page.url()}`);

    const seqBack = await viewSeq(page);
    await clickControl(page, iface.switchSel);
    await awaitViewSeq(page, seqBack);
    const again = await weekProbe(page);
    const againN = weekNumber(again.out);
    check('and switching back restores the week the visitor left it on, output '
      + 'and URL together (session memory, not a reset to the latest week)',
    !!beforeN && !!againN && againN.n === beforeN.n && again.weekParam === '10',
    JSON.stringify({ before: beforeN && beforeN.n, again: againN && againN.n,
      param: again.weekParam }));
    clean('week across a view switch');
  }
}

section('▸ View usdm — the drought monitor, end to end');
{
  const USDM = CONFIG.interfaces.usdm;
  /* A FRESH context, opened for downloads so the template's export step runs,
     and the boot resource list read BEFORE anything is switched — step 3's
     lazy-fetch proof is a comparison against it. */
  const s = await open({ downloads: true });
  check('the drought-monitor page reaches ngpReady on the boot payload', s.ready);
  s.clean('usdm section boot');
  const bootResources = await resourceNames(s.page);
  await verifyInterfaceSection(USDM, {
    session: s, bootResources, extraChecks: usdmExtraChecks,
  });
  await s.ctx.close();
}

/* ══════════════════════════════════════════════════════════════════════════
   9. DEEP LINK ?view=usdm&year=2012&week=30&county=30063 — on the §2 model.

   Every param of a shared drought-monitor link, honoured on LOAD rather than
   by replaying the interactions that would have produced it. The week is the
   interesting one: it is the app's only param that means nothing without the
   year beside it, and the app has to resolve "week 30 of 2012" against the
   payload's own Tuesday grid before it can paint anything.
   ══════════════════════════════════════════════════════════════════════════ */

section('▸ Deep link ?view=usdm&year=2012&week=30&county=30063');
{
  const USDM = CONFIG.interfaces.usdm;
  const E = USDM.deepLinkExpect;
  const s = await open({ query: USDM.deepLink });
  const { page } = s;
  check('the deep-linked drought-monitor page reaches ngpReady', s.ready);

  const snap = await snapshot(page);
  const vc = await viewControls(page);
  const w = await weekProbe(page);
  const n = weekNumber(w.out);
  /* The card's VALUES, one per <dd>, not the concatenated text of the whole
     list: `#card-rows`.textContent runs the terms and their values together
     ("Drought classNone — drought-free"), which leaves no word boundary in
     front of the class name a check wants to find. */
  const card = await page.evaluate(() => ({
    open: !document.getElementById('county-card').hidden,
    title: (document.getElementById('card-title').textContent || '').trim(),
    terms: Array.from(document.querySelectorAll('#card-rows dt'))
      .map((n) => (n.textContent || '').trim()),
    values: Array.from(document.querySelectorAll('#card-rows dd'))
      .map((n) => (n.textContent || '').trim()),
  }));

  check('?view=usdm boots straight onto the drought monitor: the marker, the '
    + 'pressed switcher button, and only its own drawer sections',
  snap.markers.ngpView === USDM.slug && snap.state.view === USDM.slug
    && vc.views.length === 1 && vc.views[0] === USDM.slug
    && vc.sections.every((sec) => (sec.view === USDM.slug) === !sec.hidden),
  JSON.stringify({ marker: snap.markers.ngpView, pressed: vc.views,
    sections: vc.sections }));
  check(`the year is ${E.year} on the USDM domain (min ${USDM.yearDomain.min}), `
    + `drawn on the ${E.vintage} boundaries that were in force for it`,
  vc.year === String(E.year) && vc.yearMin === String(USDM.yearDomain.min)
    && snap.vintage === E.vintage,
  JSON.stringify({ year: vc.year, min: vc.yearMin, vintage: snap.vintage }));
  check(`?week=${E.week} resolved against the payload's own Tuesday grid: `
    + `"${E.label} · week ${E.week} of ${E.weeks}" — ${E.year} holds ${E.weeks} `
    + 'Tuesdays, Jan 3 through Dec 25',
  !!n && n.n === E.week && n.of === E.weeks && (w.out || '').includes(E.label),
  JSON.stringify(w.out));
  check('the week param survives the boot it described (a shared week is still '
    + 'that week after the app has rewritten the URL)',
  w.weekParam === String(E.week), page.url());
  check('the default dataset stays out of a deep link — no ?dataset for FSA LFP '
    + 'boundaries',
  w.datasetParam === null, page.url());
  check('the card is open on the linked county, naming the week it is showing '
    + 'and reading out that week\'s drought class in words',
  card.open && card.title.includes(USDM.county.name)
    && card.values.some((v) => v.includes(E.label))
    && card.values.some((v) => /^(D[0-4]|None)\b|not in this week/i.test(v)),
  JSON.stringify({ title: card.title, terms: card.terms, values: card.values }));
  check('the swatches legend is the visible body, and neither continuous one is',
    vc.legend.swatches === true && vc.legend.wheel === false
      && vc.legend.bar === false, JSON.stringify(vc.legend));
  const painted = await paintSignature(page, CONFIG.sourceId);
  const expect = await USDM.paintOracle(page);
  if (typeof expect === 'number') {
    check('the choropleth painted for the deep-linked week, county for county',
      painted.colored === expect, `${painted.colored} painted, ${expect} expected`);
  } else {
    skip('the deep-linked week painted the counties its classes reach',
      String(expect));
  }
  s.clean('usdm deep link');
  await s.shot('20-usdm-deep-link');
  await s.ctx.close();
}

/* ══════════════════════════════════════════════════════════════════════════
   10. TWO VIEWS, TWO MEMORIES — an excursion changes nothing it did not touch.

   The app is now two bodies of data over one map, and the promise the switcher
   makes is that leaving a view does not disturb it: the grazing-period view's
   dataset, its season dictionary, its variable and its year are all still there
   when the visitor comes back, and the drought monitor's dataset and week are
   still there when they go the other way. What is SHARED — the county, the
   camera, the theme, the year — moves with the visitor by design.

   §8's template step 10 compares the per-view state objects. This section is
   the same claim asserted against the CONTROLS, from the most distinctive state
   the grazing-period view has: the climatology, which brings its own type
   dictionary and a disabled year slider with it.
   ══════════════════════════════════════════════════════════════════════════ */

section('▸ Two views, two memories — an NGP state survives a USDM excursion');
{
  const NGP = CONFIG.interfaces.ngp;
  const USDM = CONFIG.interfaces.usdm;
  const s = await open();
  const { page } = s;
  check('the state-memory page reaches ngpReady', s.ready);

  /* Put the grazing-period view somewhere no default could be mistaken for. */
  await slideYear(page, 2012);
  await settleVintage(page);
  await page.locator('#btn-var-start').click();
  await page.waitForTimeout(300);
  const seq0 = await viewSeq(page);
  await clickControl(page, NGP.datasets.nclimgrid.sel);
  await awaitViewSeq(page, seq0);
  const before = await viewControls(page);
  const beforeSnap = await snapshot(page);
  check('setup: grazing periods on the nClimGrid climatology, 2012, coloured by '
    + 'season start — a disabled year slider, its note, and a season dictionary',
  before.datasets[0] === 'nclimgrid' && before.yearDisabled === true
    && before.noteShown && beforeSnap.state.year === 2012
    && beforeSnap.state.variable === 'start',
  JSON.stringify({ dataset: before.datasets, disabled: before.yearDisabled,
    year: beforeSnap.state.year, variable: beforeSnap.state.variable }));

  const seq1 = await viewSeq(page);
  const wentOut = await clickControl(page, USDM.switchSel);
  const arrived = wentOut && await awaitViewSeq(page, seq1);
  const out = await viewControls(page);
  check('the drought monitor takes the map over', arrived,
    wentOut ? `data-ngp-view-seq stayed at ${seq1}` : 'the switcher was not clickable');
  check('it RE-ENABLES the year slider the climatology had disabled, and takes '
    + 'that note down with it — a weekly record has years',
  out.yearDisabled === false && !out.noteShown,
  JSON.stringify({ disabled: out.yearDisabled, note: out.noteShown }));

  /* Move the drought monitor's own two pieces of state. */
  const seq2 = await viewSeq(page);
  await clickControl(page, USDM.datasets.census.sel);
  await awaitViewSeq(page, seq2);
  await scrubWeek(page, 12);
  await settleWeek(page);
  const excursion = await weekProbe(page);

  /* And back. */
  const seq3 = await viewSeq(page);
  await clickControl(page, NGP.switchSel);
  await awaitViewSeq(page, seq3);
  const after = await viewControls(page);
  const afterSnap = await snapshot(page);
  check('the grazing-period view comes back exactly as it was left: the '
    + 'climatology dataset, its own season, the start variable, and the year '
    + 'slider disabled under its note again',
  after.datasets.length === 1 && after.datasets[0] === 'nclimgrid'
    && after.type === before.type && after.types.length === before.types.length
    && afterSnap.state.variable === 'start' && after.yearDisabled === true
    && after.noteShown,
  JSON.stringify({ dataset: after.datasets, type: after.type,
    types: after.types.length, variable: afterSnap.state.variable,
    disabled: after.yearDisabled, note: after.noteShown }));
  check('…and the shared year is untouched: an excursion that never moved the '
    + 'year did not move it',
  afterSnap.state.year === 2012, 'year is ' + afterSnap.state.year);
  check('the URL is the grazing-period view\'s again — no ?view, no ?week, and '
    + '?dataset back on the climatology it was reading',
  !new URL(page.url()).searchParams.has('view')
    && !new URL(page.url()).searchParams.has('week')
    && new URL(page.url()).searchParams.get('dataset') === 'nclimgrid',
  page.url());

  const seq4 = await viewSeq(page);
  await clickControl(page, USDM.switchSel);
  await awaitViewSeq(page, seq4);
  const returned = await weekProbe(page);
  const returnedN = weekNumber(returned.out);
  const excursionN = weekNumber(excursion.out);
  check('and the drought monitor remembers ITS two pieces of state — the Census '
    + 'county set and the week the visitor left it on',
  returned.datasetParam === 'census' && !!returnedN && !!excursionN
    && returnedN.n === excursionN.n && returned.weekParam === '12',
  JSON.stringify({ dataset: returned.datasetParam, week: returned.weekParam,
    output: returned.out }));
  s.clean('two views, two memories');
  await s.shot('21-two-views');
  await s.ctx.close();
}

/* ── Done ────────────────────────────────────────────────────────────────── */

await browser.close();
server.close();

const passed = results.filter((r) => r.ok === true).length;
console.log('\n' + '─'.repeat(72));
console.log(`  ${passed} passed · ${failures} failed · ${skips} skipped`);
if (failures) {
  console.log('\n  FAILED:');
  for (const r of results.filter((x) => x.ok === false)) {
    console.log(`    ✗ ${r.label}`);
    if (r.detail) console.log(`        ${r.detail}`);
  }
}
console.log(`\n  Screenshots: ${CONFIG.screenshotDir}`);
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
