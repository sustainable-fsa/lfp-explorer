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

  /* NO SOURCE ID AND NO LAYER IDS. They used to be here, and on kit v0.4.0's
     tiled path a constant would be a lie: the map holds one layer stack per
     resident archive, the ids carry a slot suffix, and both move when the front
     does. Every probe below asks the handle — `handle.featureRef(id)`,
     `handle.layers.fill` — at the moment of use. A retired stack is transparent
     rather than hidden and therefore still answers queryRenderedFeatures, so a
     literal here would not fail loudly; it would quietly measure the archive the
     reader stopped looking at. */
};
/* ══════════════════════════════════════════════════════════════════════════ */

/** The pinned kit build, imported IN-PAGE by three probes below (a county
    centroid is the kit's arithmetic, not this file's). One constant so a
    version bump or a dev-state sweep has exactly one site to hit here —
    README § Developing against an unreleased kit lists this file alongside
    index.html and js/. It is passed INTO page.evaluate as an argument: a
    string built in-page from an outer-scope binding would not exist. */
const KIT_COUNTY_URL = 'https://sustainable-fsa.com/style/v0.4.1/county/county.js';

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
  /* THE LOCATION, not just the text. A console.error of an Error subclass with
     an empty message stringifies to the single word "Error", which is
     unactionable — it cost an hour to chase one of those, and the answer was in
     the source URL all along. `m.location()` is synchronous and free; expanding
     the args would need an async handler and could race the page closing. */
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = m.location() || {};
    const where = loc.url
      ? ` @${String(loc.url).replace(/^https?:\/\/[^/]+/, '')}:${loc.lineNumber ?? '?'}`
      : '';
    errors.push(m.text() + where);
  });
  /* TWO ENV KNOBS, BOTH INERT UNLESS SET, and both earned. A CI runner is
     several times slower than a developer's machine, so it interleaves things a
     local run never does — a pointer warming an archive while a click's swap is
     in flight, say. That is how kit v0.4.0 shipped a page error this suite could
     not reproduce locally:

       VERIFY_THROTTLE=4   CPU throttling, which is what a runner IS
       VERIFY_STACKS=1     the whole stack of a pageerror, not just its message

     `String(e).split('\n')[0]` is the right DEFAULT — one line per failure keeps
     the report readable — but it threw away the frame that named the culprit
     (`updatePaintArray`), and reconstructing it took a separate reduction. */
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).split('\n')[0]
    + (process.env.VERIFY_STACKS
      ? '\n      ' + String(e.stack || '').split('\n').slice(0, 6).join('\n      ')
      : '')));
  if (process.env.VERIFY_THROTTLE) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate',
      { rate: Number(process.env.VERIFY_THROTTLE) });
  }
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

  /* A DEEP-LINKED VIEW LANDS AFTER ngpReady, so waiting on that flag alone is a
     race — and it is a race this suite USED TO WIN by accident.
     `ngpReady` is stamped once, at the end of boot, and boot brings up the
     DEFAULT view; a `?view=` other than that is a transition the app starts
     afterwards (readInitialState parks it, boot's tail calls setView). It has to
     fetch a payload and, since the geometry follows the dataset, an archive.
     `CONFIG.settleMs` was covering that by being longer than the transition
     happened to take.

     It stopped covering it the moment the boundary swap became double-buffered:
     the swap now waits for the incoming archive to be DRAWABLE before it flips,
     which is the whole point, and on a cold CI runner against a cold CDN that is
     seconds rather than milliseconds. The result was four failures on
     `?view=usdm&…` describing a page still showing the grazing periods — the app
     working exactly as designed, measured too early.

     So wait for the app's own marker. `data-ngp-view` is written at the END of
     applyDataset(), after the boundary swap has landed (MARKERS § view), which
     makes it the one signal that means "the view the URL asked for is what is on
     screen". The authority table already worked this way with
     `settleBoundary()`; this is the same rule, in the one place every section
     inherits it. */
  const wantView = new URLSearchParams(String(query).replace(/^\?/, '')).get('view');
  if (requireReady && ready && wantView) {
    try {
      await page.waitForFunction(
        (v) => document.documentElement.dataset.ngpView === v,
        wantView, { timeout: CONFIG.switchMs });
      // And the pill down, so the next assertion is not reading a page mid-note.
      await page.waitForFunction(
        () => document.getElementById('app-note').hidden,
        null, { timeout: CONFIG.switchMs });
    } catch (err) {
      errors.push(`the deep-linked view "${wantView}" never landed: `
        + String(err).split('\n')[0]);
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
 * them fail as named checks with the nulls printed.
 *
 * THE IMPORT ITSELF CAN FAIL, which is the same failure one level earlier: the
 * app's entry module imports the pinned kit over the network, so a DNS blip
 * makes `js/app.js` unresolvable and this evaluate reject. Caught here for the
 * same reason as everything else — an empty snapshot fails the checks that read
 * it, where a rejection would end the run. */
const snapshot = (page) => page.evaluate(async () => {
  try {
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
  } catch (err) {
    return {
      state: {}, viewState: null, vintage: null, geometryCount: 0,
      center: [null, null], zoom: null,
      markers: { ...document.documentElement.dataset },
      error: String(err).split('\n')[0],
    };
  }
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
    /** The switcher AS A READER SEES IT: every button's slug and its words, in
        DOM order. The order and the numbered prefixes are what tell a visitor
        which of the four maps to read first, so they are data to be checked and
        not merely markup. */
    viewOrder: inPlay('[data-view-btn]').map((b) => ({
      slug: b.dataset.viewBtn, label: text(b),
    })),
    datasets: pressed('[data-dataset]').map((b) => b.dataset.dataset),
    datasetBtns: inPlay('[data-dataset]').length,
    /** Likewise the active view's dataset seg, in its own DOM order: the words
        on a dataset button are the only place a reader learns what the second
        answer to the same question IS. */
    datasetOrder: inPlay('[data-dataset]').map((b) => ({
      id: b.dataset.dataset, label: text(b),
    })),
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
 *
 * IT ASKS THE HANDLE FOR THE ADDRESS. `getFeatureState` on a VECTOR source
 * needs `sourceLayer`, and MapLibre does not throw without it — it fires an
 * error event and returns, so every county reads back `undefined` and this
 * function reports `colored: 0`. That is indistinguishable from "nothing is
 * painted yet", which is exactly how a harness bug hides as an app bug: the
 * first symptom of getting this wrong was twenty "the choropleth repainted"
 * failures against an app that was painting perfectly. `handle.featureRef(id)`
 * (kit v0.3.0) builds the right object for whichever source type the handle
 * owns, so this probe cannot be right on one path and silently wrong on the
 * other. Never hand-roll the ref here.
 */
const paintSignature = (page) => page.evaluate(async () => {
  // No map, no geometry, or no app module at all means nothing is painted,
  // which is a signature too — and one that fails every "the paint changed"
  // comparison rather than throwing the run away. The module can genuinely be
  // missing: `js/app.js` imports the pinned kit over the network, so a DNS blip
  // is enough to make the dynamic import below reject.
  try {
    const app = await import(new URL('js/app.js', document.baseURI).href);
    const c = app.ngpContext();
    const map = c.getMap();
    let colored = 0;
    let hash = 5381;
    if (!map || !c.getCounties()) return { colored: 0, hash: 0 };
    const handle = typeof c.getHandle === 'function' ? c.getHandle() : null;
    if (!handle || typeof handle.featureRef !== 'function') {
      return { colored: 0, hash: 0, error: 'no handle.featureRef to address the '
        + 'front stack with — there is no constant to fall back to' };
    }
    const ref = (id) => handle.featureRef(id);
    for (const id of c.getCounties().index.keys()) {
      const st = map.getFeatureState(ref(id));
      const color = (st && st.color) || '';
      if (color) colored++;
      for (let i = 0; i < color.length; i++) {
        hash = (Math.imul(hash, 33) ^ color.charCodeAt(i)) >>> 0;
      }
    }
    return { colored, hash };
  } catch (err) {
    return { colored: 0, hash: 0, error: String(err).split('\n')[0] };
  }
});

/** The paint color of one county, straight out of feature state. Null if there
    is no map to ask — see snapshot() on why a broken boot does not throw.
    Through handle.featureRef() for the reason spelled out on paintSignature. */
const colorOf = (page, id) => page.evaluate(async (i) => {
  const app = await import(new URL('js/app.js', document.baseURI).href);
  const c = app.ngpContext();
  const map = c.getMap();
  const handle = c.getHandle();
  const st = map && map.getFeatureState(handle.featureRef(i));
  return (st && st.color) || null;
}, id);

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

/** liveText, but patient. The app DEFERS announcements (~350 ms of rest) so a
    reader hears one composed sentence instead of a stutter of partials — which
    means any read taken right after a transition races that timer and can
    return the PREVIOUS view's sentence. Poll until `test(text)` accepts the
    region or ~1.8 s passes, and hand back whatever it holds then; the caller's
    check still judges the final text, so a genuinely missing announcement
    still fails with the real evidence. */
async function settledLiveText(page, test) {
  let said = await liveText(page);
  for (let i = 0; i < 15 && !test(said); i++) {
    await page.waitForTimeout(120);
    said = await liveText(page);
  }
  return said;
}

/**
 * A county-authority swap, waited out.
 *
 * WAITS ON THE MARKER, not on the transient pill. `data-ngp-boundary` carries
 * the tileset key that is actually on the map, so "the geometry the app intends
 * is the geometry it has" is a single string comparison — and since the swap
 * became double-buffered (kit v0.4.0) the app writes it AFTER the flip, which
 * makes it a stronger signal than it was: it now means "this authority is on
 * screen", not "this authority has been asked for".
 *
 * The pill is the wrong signal and cost a debugging hour to prove it: it is
 * shown by whoever starts a transition and cleared by whoever finishes one, so
 * a section that arrives with it already hidden waits for nothing and reads the
 * OLD geometry a moment later. That produced "dd22, 3104 polygons" — the right
 * vintage and the previous vintage's polygons — against an app that was
 * swapping correctly in both directions. The pill is still ASSERTED in the swap
 * section, because showing it is a real obligation; it is just not a clock.
 */
const settleVintage = async (page) => {
  await page.waitForFunction(() => {
    const el = document.documentElement.dataset;
    return el.ngpBoundary && document.getElementById('app-note').hidden;
  }, null, { timeout: CONFIG.switchMs }).catch(() => {});
  await page.waitForTimeout(500);
  await settleFrames(page);
};

/**
 * The same, but for a caller that knows which authority it is waiting FOR —
 * which is the only form that cannot race. Pass a tileset key.
 */
const settleBoundary = async (page, key) => {
  await page.waitForFunction(
    (k) => document.documentElement.dataset.ngpBoundary === k,
    key, { timeout: CONFIG.switchMs }).catch(() => {});
  await page.waitForTimeout(200);
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
  check('boot state is the documented default (grazing periods · FSA Official · '
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
  check('the defaults emit NEITHER ?view NOR ?dataset — the app boots on the view '
    + 'the registry NAMES as its default (the SECOND button in the switcher) and '
    + 'on that view\'s declared dataset, and says nothing about either',
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
     every dataset in the app except the default view's default one, plus every
     committed asset a view declares as its own (`lazyAssets` — the eligibility
     view's drought-factor ramp), so a fifth payload or a third ramp is covered
     here by the commit that adds it to config.mjs. A ramp belongs in this list
     for the same reason a payload does: the two the grazing periods need are on
     the boot path, and a third one loaded beside them would cost the LCP a
     round trip for a legend nobody has asked to see yet. */
  {
    const NGP = CONFIG.interfaces.ngp;
    const fetched = await resourceNames(page);
    const has = (needle) => fetched.filter((n) => n.includes(needle));
    const official = has(NGP.datasets.fsa.payload);
    const lazy = [...has(CROSSWALK.path.split('/').pop())];
    let lazyCount = 0;
    let lazyAssets = 0;
    for (const iface of Object.values(CONFIG.interfaces)) {
      /* A view with one archive has no `datasets` map — it names its payload on
         the entry (tools/config.mjs § the probe table's field list), and that
         payload is as lazy as any other. */
      const sets = iface.datasets ? Object.values(iface.datasets)
        : [{ id: iface.slug, isDefault: true, payload: iface.payload }];
      for (const ds of sets) {
        if (iface.isDefault && ds.isDefault) continue;
        lazyCount++;
        lazy.push(...has(ds.payload));
      }
      for (const asset of iface.lazyAssets || []) {
        lazyAssets++;
        lazy.push(...has(asset.split('/').pop()));
      }
    }
    check('the boot path fetched the FSA official grazing-period payload',
      official.length > 0, `${fetched.length} resources, none named `
      + JSON.stringify(NGP.datasets.fsa.payload));
    check(`…and NOTHING ELSE: all ${lazyCount} other datasets, the crosswalk and `
      + `${lazyAssets} view-scoped asset(s) stay lazy until something asks for `
      + 'them (the LCP guarantee)',
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
    const sigBefore = await paintSignature(page);
    const colorBefore = await colorOf(page, yearProbe.id);
    await slideYear(page, yearProbe.year);
    await page.waitForTimeout(400);
    await settleFrames(page);
    const sigAfter = await paintSignature(page);
    const colorAfter = await colorOf(page, yearProbe.id);
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
    const sigBefore = await paintSignature(page);
    await page.selectOption('#type-select', typeProbe.type);
    await page.waitForTimeout(400);
    await settleFrames(page);
    const sigAfter = await paintSignature(page);
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
    const painted = await paintSignature(page);
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

      /* ── The selection ring actually PAINTS ──────────────────────────────
         The kit outlines the selected county with two filter-driven line
         layers (`sfsa-county-selected` over its casing), and the card is only
         half the answer: a reader who cannot see WHICH county the readout
         describes has been told a name, not shown a place.

         This is measured with queryRenderedFeatures rather than by reading the
         filter back, because the filter was the bug. Through kit v0.2.0 both
         layers keyed on `['id']`, and while promoteId does put the 5-character
         FSA string in the feature-id slot for setFeatureState(), the tile
         encoder behind the FILTER path coerces a numeric-looking id to a
         NUMBER — '01001' becomes 1001, leading zero and all. Every FSA id is
         numeric-looking, so `['==', ['id'], '01001']` matched nothing and the
         ring never drew for any selection this app ever made, silently, while
         the choropleth join kept working. Kit v0.2.1 compares `['get', 'id']`,
         the property, which is never coerced.

         So: assert the paint, not the filter, and do it for a LEADING-ZERO id
         as well — that is the case no `['to-string', ['id']]` half-fix would
         have saved, and the one this app is full of. */
      const ring = (id) => page.evaluate(async (id) => {
        const app = await import(new URL('js/app.js', document.baseURI).href);
        const c = app.ngpContext();
        const map = c.getMap();
        // The FRONT stack's ids, asked for now. Kit v0.4.0 keeps more than one
        // archive on the map and suffixes the ids per stack, so the literals
        // that used to be here would query a retired stack half the time — and
        // a retired stack is transparent, not hidden, so it answers.
        const L = c.getHandle().layers;
        const n = (layer) => {
          try { return map.queryRenderedFeatures({ layers: [layer] }).length; }
          catch { return -1; }
        };
        return { id, ring: n(L.selected), casing: n(L.selectedCasing), fill: n(L.fill) };
      }, id);

      const litHere = await ring(CONFIG.county.id);
      check('the selected county is OUTLINED on the map, not just named in the '
        + 'card: both selection layers paint exactly one feature',
      litHere.ring === 1 && litHere.casing === 1,
      `ring=${litHere.ring}, casing=${litHere.casing} (fill=${litHere.fill}) `
        + `for ${CONFIG.county.id}`);

      // A leading-zero id from the live geometry — the coercion case.
      const zeroId = await page.evaluate(async () => {
        const app = await import(new URL('js/app.js', document.baseURI).href);
        for (const id of app.ngpContext().getCounties().index.keys()) {
          if (id.startsWith('0')) return id;
        }
        return null;
      });
      if (!zeroId) {
        skip('the ring paints for a LEADING-ZERO county id',
          'no id starting with 0 in this vintage');
      } else {
        await page.evaluate(async (id) => {
          const app = await import(new URL('js/app.js', document.baseURI).href);
          app.ngpContext().selectCounty(id);   // no fly — the map-click path
        }, zeroId);
        await page.waitForTimeout(700);
        const litZero = await ring(zeroId);
        check(`the ring paints for a LEADING-ZERO id too (${zeroId}) — the id `
          + 'shape a numeric feature-id filter can never match',
        litZero.ring === 1 && litZero.casing === 1,
        `ring=${litZero.ring}, casing=${litZero.casing} for ${zeroId}`);

        // …and it is the card that owns it: closing the readout takes the
        // outline with it, so the map never points at a county nothing
        // describes.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(700);
        const litClosed = await ring(zeroId);
        check('closing the card clears the ring — the outline lives exactly as '
          + 'long as the readout that explains it',
        litClosed.ring === 0 && litClosed.casing === 0
          && await page.evaluate(() => document.getElementById('county-card').hidden),
        `ring=${litClosed.ring}, casing=${litClosed.casing} after Escape`);

        // Restore the state the rest of this section left behind: the run's
        // canonical county, selected, card open, nothing pushed.
        await page.evaluate(async (id) => {
          const app = await import(new URL('js/app.js', document.baseURI).href);
          app.ngpContext().selectCounty(id);
        }, CONFIG.county.id);
        await page.waitForTimeout(500);
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
    // Named, so this cannot pass by arriving early: the wait is for the dd22
    // marker specifically, not for "some transition finished".
    await settleBoundary(page, 'fsa-counties-dd22');
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
    (await paintSignature(s.page)).colored > 2000);
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
    (await paintSignature(s.page)).colored > 2000);
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
  ['#btn-view-eligibility', 40],
  ['#btn-view-disasters', 40],
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

/** The eligibility view's own controls, measured in a THIRD pass for the same
    reason. Its source select is the exception that has to be reached rather
    than merely switched to: `#elig-source` is hidden unless the DERIVED dataset
    is active, so the pass that measures it toggles the dataset first — a select
    that only appears at 375px under one dataset is exactly the control that
    ends up 28px tall. */
const ELIG_TOUCH_CONTRACT = [
  ['#btn-elig-official', 40],
  ['#btn-elig-web', 40],
  ['#btn-elig-derived', 40],
  ['#elig-type-select', 40],
  ['#btn-elig-months', 40],
  ['#btn-elig-date', 40],
];
const ELIG_SOURCE_TOUCH_CONTRACT = [['#elig-source', 40]];

/* NO FOURTH CONTRACT. The disaster designations had one — two two-way segs, the
   densest seg stack in the drawer — until that map was narrowed to the single
   slice it is about (js/interfaces/disasters.js § ONE SLICE). It now has no
   controls of its own at all, so what a phone visitor has to be able to hit is
   the switcher button that reaches it, and that one is measured by id in
   TOUCH_CONTRACT above with the other three. */

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

  /* ── The third view's controls, on the phone ─────────────────────────────
     Same argument again, one control further: the eligibility view adds a
     three-way dataset seg, a native <select> for fifteen pasture types plus a
     sentinel, a two-way variable seg — and a SECOND select that does not exist
     until the derived dataset is chosen. A control a phone visitor can only
     reach after a toggle is a control whose touch size nobody has looked at, so
     this pass toggles and then measures. The drawer is already open from the
     drought-monitor pass above. */
  {
    const ELIG = CONFIG.interfaces.eligibility;
    const seq = await viewSeq(page);
    const clicked = await clickControl(page, ELIG.switchSel);
    const arrived = clicked && await awaitViewSeq(page, seq);
    const targets = await measureTargets(page, ELIG_TOUCH_CONTRACT);
    const undersizedElig = targets.filter((m) => m.w < m.min || m.h < m.min);
    const want = ELIG_TOUCH_CONTRACT.map(([sel]) => sel.replace('#', ''));
    const got = new Set(targets.map((m) => m.id));
    const missing = want.filter((id) => !got.has(id));
    console.log('    eligibility touch targets: '
      + targets.map((m) => `${m.id} ${m.w}×${m.h}`).join(', '));
    check('a phone visitor can reach LFP eligibility from the drawer, and its '
      + 'dataset seg, pasture-type select and variable seg all meet the touch '
      + 'sizes the kit promises — every one of them really on screen',
    arrived && undersizedElig.length === 0 && missing.length === 0,
    [clicked ? '' : `${ELIG.switchSel} was not clickable at 375px`,
      arrived ? '' : `data-ngp-view-seq stayed at ${seq}`,
      undersizedElig.map((m) => `${m.id} ${m.w}×${m.h} < ${m.min}`).join(', '),
      missing.length ? 'never measured: ' + missing.join(', ') : '']
      .filter(Boolean).join(' | '));

    const seqDs = await viewSeq(page);
    const toDerived = await clickControl(page, ELIG.datasets.derived.sel);
    const onDerived = toDerived && await awaitViewSeq(page, seqDs);
    const src = await measureTargets(page, ELIG_SOURCE_TOUCH_CONTRACT);
    const undersizedSrc = src.filter((m) => m.w < m.min || m.h < m.min);
    console.log('    eligibility source select: '
      + (src.map((m) => `${m.id} ${m.w}×${m.h}`).join(', ') || 'not on screen'));
    check('the aggregation select the derived dataset brings with it is on '
      + 'screen once that dataset is chosen, at a size a thumb can hit',
    onDerived && src.length === 1 && undersizedSrc.length === 0,
    [toDerived ? '' : `${ELIG.datasets.derived.sel} was not clickable at 375px`,
      onDerived ? '' : `data-ngp-view-seq stayed at ${seqDs}`,
      src.length ? '' : `${ELIG_SOURCE_TOUCH_CONTRACT[0][0]} has no client rects`,
      undersizedSrc.map((m) => `${m.id} ${m.w}×${m.h} < ${m.min}`).join(', ')]
      .filter(Boolean).join(' | '));
    check('the phone does not scroll sideways with the eligibility controls in '
      + 'the drawer',
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1),
    await page.evaluate(() => `scrollWidth ${document.documentElement.scrollWidth} > `
      + `innerWidth ${window.innerWidth}`));
    await s.shot('17d-compact-eligibility');
    s.clean('compact LFP eligibility');
  }

  /* ── The fourth view, on the phone ───────────────────────────────────────
     The last of the four, and the only one with NO controls of its own: it is
     one slice of one archive, so the shared year is the whole of its state and
     there is no seg stack here to measure (see the note where the other three
     contracts are defined). What still has to be true on a phone is that the
     view is reachable at all and that arriving on it does not push the drawer
     sideways. The drawer is still open from the eligibility pass above. */
  {
    const DIS = CONFIG.interfaces.disasters;
    const seq = await viewSeq(page);
    const clicked = await clickControl(page, DIS.switchSel);
    const arrived = clicked && await awaitViewSeq(page, seq);
    const own = await page.evaluate(() => Array.from(
      document.querySelectorAll('.sfsa-drawer-scroll [data-view="disasters"]'))
      .map((n) => n.id));
    check('a phone visitor can reach the disaster designations from the drawer — '
      + 'and finds no controls of its own there, because that map is one slice '
      + 'of one archive',
    arrived && own.length === 0,
    [clicked ? '' : `${DIS.switchSel} was not clickable at 375px`,
      arrived ? '' : `data-ngp-view-seq stayed at ${seq}`,
      own.length ? 'sections still in the drawer: ' + own.join(', ') : '']
      .filter(Boolean).join(' | '));
    check('the phone does not scroll sideways with the designations on screen',
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1),
    await page.evaluate(() => `scrollWidth ${document.documentElement.scrollWidth} > `
      + `innerWidth ${window.innerWidth}`));
    await s.shot('17e-compact-disasters');
    s.clean('compact disaster designations');
  }
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
 *   6  extraChecks     the view's own controls, each with its own clean(). It
 *                      is handed the whole session, not just the page: a control
 *                      whose claim is about the POSTER needs the download flag
 *                      and the download list, and those belong to the session
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
  /* A view may hold ONE archive and therefore have no dataset control at all —
     the disaster designations do — in which case the entry names its payload
     directly and there is no `?dataset` for this view to emit. Only step 3
     (the lazy-fetch proof) needs the distinction, and it needs one field. */
  const ds = iface.datasets
    ? (Object.values(iface.datasets).find((d) => d.isDefault)
      || Object.values(iface.datasets)[0])
    : { id: null, isDefault: true, payload: iface.payload };
  section(`▸ View ${iface.slug} — ${iface.label}`);

  /* 1 · Switch. */
  const sigBefore = await paintSignature(page);
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
  const sigAfter = await paintSignature(page);
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

  /* 6 · The view's own controls. The whole session goes in, not just the page:
     a control whose claim is about the POSTER (the drought monitor's polygon
     overlay is one — it has to appear in the export when it is on) needs the
     download flag and the download list, and those are the session's. Everything
     else takes what it always took. */
  if (typeof extraChecks === 'function') {
    await extraChecks({ page, check, skip, clean, shot, iface, session });
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

section('▸ View switcher + NGP datasets — FSA Official ↔ NAP-190 Derived');
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

  /* ── The switcher reads in the story's order ─────────────────────────────
     Four maps and a numbered prefix on each: the numbers tell a visitor which
     to read first, and they are the app's only statement of that. The DEFAULT
     view is deliberately not the first button — the story starts at the drought
     and the app boots on the grazing periods — so the order and the pressed
     button are two separate claims, and a run that only checked the second
     would pass on a switcher shuffled into any order at all. Both the sequence
     and the words come from the probe table (tools/config.mjs § order,
     switchLabel). */
  {
    const wanted = Object.values(CONFIG.interfaces)
      .slice()
      .sort((a, b) => a.order - b.order);
    const got = official.viewOrder;
    check('the switcher reads in the story\'s order, numbered — '
      + wanted.map((i) => i.switchLabel).join(' / '),
    got.length === wanted.length
      && wanted.every((i, n) => got[n] && got[n].slug === i.slug
        && got[n].label === i.switchLabel),
    JSON.stringify(got));
  }

  check(`the dataset seg offers both grazing-period datasets, named in the words `
    + `the drawer promises ("${OFFICIAL.label}" / "${CLIMO.label}"), with the `
    + 'default one pressed',
  official.datasetBtns === 2 && official.datasets.length === 1
    && official.datasets[0] === OFFICIAL.id
    && official.datasetOrder.length === 2
    && official.datasetOrder[0].label === OFFICIAL.label
    && official.datasetOrder[1].label === CLIMO.label,
  `${official.datasetBtns} button(s) ${JSON.stringify(official.datasetOrder)}, `
    + `pressed ${JSON.stringify(official.datasets)}`);
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
  const sigOfficial = await paintSignature(page);
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

  const sigClimo = await paintSignature(page);
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
  const sigBack = await paintSignature(page);
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
  const sigSettled = await paintSignature(page);
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
       ANNOUNCED rather than silently moved;
     · a SECOND BODY OF GEOMETRY over the first — the USDM's own weekly polygons,
       togglable and off by default — which has to follow the week, survive a
       change of county authority, stay under the county lines, reach the poster,
       and leave nothing behind when it is turned off.
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

/* ── The weekly-polygon overlay ───────────────────────────────────────────── */

/** The overlay's selectors and its APP-OWNED ids, flattened for the in-page
    probe — Playwright serialises evaluate() arguments as data, so the entry's
    RegExps (`markerIso`, the two copy clauses) do not survive the trip and are
    applied here in Node, against the strings the probe brings back.

    THE ONLY LAYER ID THIS FILE EVER NAMES. Everything else asks
    `handle.layers` at the moment of use, because the kit's tiled ids are
    slot-suffixed and MOVE when the front stack does (see the CONFIG block at
    the top). `ngp-usdm-overlay-fill` is the app's own — one layer, one stack of
    one, the same standing as a DOM id — and the reasoning is written out in
    tools/config.mjs beside the literal. */
const OVERLAY = CONFIG.interfaces.usdm.overlay;
const OVERLAY_SELS = {
  sectionSel: OVERLAY.sectionSel, offSel: OVERLAY.offSel, onSel: OVERLAY.onSel,
  param: OVERLAY.param, lsKey: OVERLAY.lsKey,
  sourceId: OVERLAY.sourceId, fillLayerId: OVERLAY.fillLayerId,
  outSel: WEEK.outSel, weekParam: WEEK.param,
  opacityWrapSel: OVERLAY.opacityWrapSel, opacityRangeSel: OVERLAY.opacityRangeSel,
  opacityOutSel: OVERLAY.opacityOutSel, opacityParam: OVERLAY.opacityParam,
  opacityLsKey: OVERLAY.opacityLsKey,
  opacityRangeId: OVERLAY.opacityRangeSel.replace('#', ''),
};

/**
 * Everything the overlay, its toggle, its URL param, its stored preference and
 * its place in the layer stack say — in one round trip.
 *
 * A MISSING LAYER IS AN ANSWER, not a stack trace. The overlay's layer does not
 * exist until the toggle is first turned on (and then it stays for the session,
 * hidden rather than removed), so "no layer, nothing painted" is a real and
 * asserted state of the app. And it is an answer this probe must not ASK
 * MapLibre about: `queryRenderedFeatures` on a layer the style does not hold
 * does not throw — it reports through the map's error event, which lands in
 * the console this harness collects (the sourceLayer lesson from the tiled
 * cutover, § What changed). So the query is gated on `getLayer()` and the
 * try/catch is only a belt for engines that do throw.
 *
 * `order` is the z-order question, and it is the one thing here that must be
 * read AT THE MOMENT OF USE: the anchor the overlay sits under is the county
 * LINE layer, whose id belongs to the kit's front stack and moves with it. So
 * the indices are resolved in-page from `handle.layers` and `map.getStyle()`
 * together, never from anything this file remembered.
 *
 * `fillOpacity` is read off the LAYER rather than off the slider, and that is
 * the point of it: the <output>, the URL and localStorage can all agree on a
 * number the map is not actually painted at. It is the paint property that a
 * reader sees.
 */
const overlayProbe = (page) => page.evaluate(async (s) => {
  const url = new URL(location.href);
  const q = (sel) => document.querySelector(sel);
  const pressed = (sel) => (q(sel) ? q(sel).getAttribute('aria-pressed') : null);
  const out = q(s.outSel);
  const sec = q(s.sectionSel);
  const wrap = q(s.opacityWrapSel);
  const range = q(s.opacityRangeSel);
  const opacityOut = q(s.opacityOutSel);
  const base = {
    hasSection: !!sec,
    sectionHidden: sec ? sec.hidden : null,
    hasOn: !!q(s.onSel),
    hasOff: !!q(s.offSel),
    on: pressed(s.onSel),
    off: pressed(s.offSel),
    /* The strength slider, which is narrower than the section it sits in: the
       wrap's `hidden` is the app saying whether there is anything to make
       stronger. `opacityNamed` asks the same WCAG 1.3.1/4.1.2 question the week
       scrubber's `named` does — a bare range is an unnamed control — and
       accepts either form, an sr-only <label for> or an aria-label. */
    hasOpacity: !!range,
    opacityWrapHidden: wrap ? wrap.hidden : null,
    opacityValue: range ? range.value : null,
    opacityStep: range ? range.step : null,
    opacityNamed: range ? !!(range.getAttribute('aria-label')
      || document.querySelector(`label[for="${s.opacityRangeId}"]`)) : null,
    opacityOut: opacityOut ? (opacityOut.textContent || '').trim() : null,
    opacityOutFor: opacityOut ? opacityOut.getAttribute('for') : null,
    opacityParam: url.searchParams.get(s.opacityParam),
    storedOpacity: (() => {
      try { return localStorage.getItem(s.opacityLsKey); }
      catch (e) { return 'unavailable'; }
    })(),
    fillOpacity: null,
    /** `dataset.ngpOverlay` is UNDEFINED when the attribute is absent, which is
        the grammar's "not drawn" (tools/config.mjs § MARKERS). Normalised to
        null so an assertion can say `=== null` and mean it. */
    marker: document.documentElement.dataset.ngpOverlay ?? null,
    param: url.searchParams.get(s.param),
    week: url.searchParams.get(s.weekParam),
    view: url.searchParams.get('view'),
    datasetParam: url.searchParams.get('dataset'),
    out: out ? (out.textContent || '').trim() : null,
    seq: Number(document.documentElement.dataset.ngpViewSeq || 0),
    boundary: document.documentElement.dataset.ngpBoundary || null,
    stored: (() => {
      try { return localStorage.getItem(s.lsKey); } catch (e) { return 'unavailable'; }
    })(),
    hasSource: false,
    hasLayer: false,
    painted: 0,
    order: null,
  };
  try {
    const app = await import(new URL('js/app.js', document.baseURI).href);
    const c = app.ngpContext();
    const map = c.getMap();
    if (!map) return base;
    base.hasSource = !!map.getSource(s.sourceId);
    base.hasLayer = !!map.getLayer(s.fillLayerId);
    if (base.hasLayer) {
      try {
        base.painted = map.queryRenderedFeatures({ layers: [s.fillLayerId] }).length;
      } catch (e) { base.painted = 0; }
      try {
        base.fillOpacity = map.getPaintProperty(s.fillLayerId, 'fill-opacity');
      } catch (e) { base.fillOpacity = 'unreadable'; }
    }
    const handle = typeof c.getHandle === 'function' ? c.getHandle() : null;
    const L = handle && handle.layers ? handle.layers : null;
    const ids = ((map.getStyle() || {}).layers || []).map((l) => l.id);
    if (L) {
      base.order = {
        fill: ids.indexOf(L.fill),
        overlay: ids.indexOf(s.fillLayerId),
        line: ids.indexOf(L.line),
        fillId: L.fill,
        lineId: L.line,
      };
    }
  } catch (e) { base.probeError = String(e).split('\n')[0]; }
  return base;
}, OVERLAY_SELS);

/** The <output>'s printed Tuesday, as the ISO the marker has to carry.
    "Jul 24, 2012 · week 30 of 52" → "2012-07-24". Built from the printed month
    NAME rather than by parsing the string as a Date: `new Date('Jul 24, 2012')`
    is local-midnight and a runner in a positive UTC offset turns it into the
    23rd, which would fail a correct app in one timezone and pass it in another. */
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function outIso(out) {
  const m = /([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})/.exec(out || '');
  if (!m) return null;
  const mo = MONTH_NAMES.indexOf(m[1]);
  if (mo < 0) return null;
  return `${m[3]}-${String(mo + 1).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
}

/**
 * Wait for the overlay to be SHOWING a week — the ISO form of the marker and
 * nothing else.
 *
 * THE ATTRIBUTE'S PRESENCE IS NOT ARRIVAL, and two of the four non-ISO values
 * are states a correct app passes through on the way in:
 *
 *   · `loading` — the source is emptied BEFORE the fetch starts, deliberately
 *     (last week's D4 blob over this week's choropleth is a map that lies), so
 *     the marker is up while nothing is drawn;
 *   · `missing` — on ENTRY to the drought monitor, `syncSections()` runs
 *     synchronously before the view's payload has landed, so the week's date is
 *     legitimately null for an instant and the module is told "on, no date". It
 *     is upgraded to the real ISO by the recolor that follows. A wait that
 *     treated an intermediate `missing` as a failure would be failing a correct
 *     app for being observed too early — the same mistake open() made about
 *     ngpReady and a deep-linked view.
 *
 * So: wait for the ISO, let the transients happen, and let the timeout be the
 * only judgement. Returns false rather than throwing; the caller turns that into
 * a named failure with its own evidence.
 */
const settleOverlay = async (page, ms = CONFIG.switchMs) => {
  const landed = await page.waitForFunction(() => {
    const v = document.documentElement.dataset.ngpOverlay;
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  }, null, { timeout: ms }).then(() => true).catch(() => false);
  await settleFrames(page);
  return landed;
};

/**
 * Move the strength slider the way a pointer does.
 *
 * Driven exactly as scrubWeek() drives the week — the value set and an `input`
 * event fired — because that is the event the app throttles to a frame, and a
 * `change` alone would test a path a dragging thumb never takes.
 *
 * Returns false if there is no slider to move, rather than throwing: the
 * control does not exist until the polygons are on, and a missing one is a
 * named failure of its own check.
 */
const dragOpacity = (page, pct) => page.evaluate(([s, v]) => {
  const r = document.querySelector(s.opacityRangeSel);
  if (!r) return false;
  r.value = String(v);
  r.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}, [OVERLAY_SELS, pct]);

/** One strength change, waited out. There is NOTHING to settle on but frames:
    the app throttles the slider to one rAF like the year and the week, and what
    a landed change does is a single setPaintProperty — no fetch, so no marker
    moves and no counter bumps. The 120 ms is the same "let the frame throttle
    have its frame" allowance settleWeek() makes, without its announcement
    debounce, because this control deliberately says nothing. */
const settleOpacity = async (page) => {
  await page.waitForTimeout(120);
  await settleFrames(page);
};

/** …and the other direction: the attribute gone entirely, which is the
    grammar's "not drawn". */
const settleOverlayGone = async (page, ms = 10000) => {
  const gone = await page.waitForFunction(
    () => document.documentElement.dataset.ngpOverlay === undefined,
    null, { timeout: ms }).then(() => true).catch(() => false);
  await settleFrames(page);
  return gone;
};

/** One poster, downloaded and read — the section template's step 9, minus its
    assertions, so a check that needs TWO posters to compare can have them.
    Null if no download appeared. */
async function poster(page, ms = 120000) {
  const pending = page.waitForEvent('download', { timeout: ms }).catch(() => null);
  await page.locator('#btn-export').click();
  const dl = await pending;
  if (!dl) return null;
  const p = await dl.path();
  return {
    name: dl.suggestedFilename(),
    bytes: p ? await readFile(p) : Buffer.alloc(0),
  };
}

/**
 * The drought monitor's own controls — step 6 of the section template.
 *
 * Lives here rather than in the probe table because every check below needs the
 * paint-signature, marker and live-region probes at the top of this file, and
 * tools/config.mjs is a data file that must not assert (its own header says so).
 * The selectors, formats, fixtures and oracles it reads are all in the entry.
 */
async function usdmExtraChecks({ page, check, skip, clean, shot, iface, session }) {
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
    const sigBefore = await paintSignature(page);
    const seqBefore = await viewSeq(page);
    await scrubWeek(page, 10);
    await settleWeek(page);
    const w1 = await weekProbe(page);
    const sigAfter = await paintSignature(page);
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
     LFP boundaries is the default and NDMC-reported is not.

     THE SEG'S ORDER IS PART OF THE CLAIM. The three run from the most general
     idea of a county to the most program-specific, which puts the default LAST,
     so the order is checked below beside the pressed button — an app that read
     its default off the first entry of a list would pass every other assertion
     in this section and open on the wrong county set. */
  section('▸ Drought monitor — three county keys, and what each one cannot reach');
  const wantOrder = Object.values(DS).map((d) => ({ id: d.id, label: d.label }));
  let prevSig = await paintSignature(page);
  for (const ds of [DS.census, DS.reported, DS['fsa-lfp']]) {
    const seq = await viewSeq(page);
    const clicked = await clickControl(page, ds.sel);
    const bumped = clicked && await awaitViewSeq(page, seq);
    const vc = await viewControls(page);
    const snap = await snapshot(page);
    const sig = await paintSignature(page);
    const probe = await weekProbe(page);
    check(`the ${JSON.stringify(ds.label)} toggle completes on data-ngp-view-seq `
      + '(fetch, crosswalk re-join, recolor, feature-state flush)',
    bumped, clicked ? `data-ngp-view-seq stayed at ${seq}`
      : `${ds.sel} was not clickable — the drought-monitor dataset seg is missing`);
    check(`${ds.label}: it is the one pressed button of the view's three — which `
      + `read ${wantOrder.map((d) => d.label).join(' / ')}, in that order, the `
      + 'default last — and no grazing-period dataset button is in play',
    vc.datasets.length === 1 && vc.datasets[0] === ds.id && vc.datasetBtns === 3
      && wantOrder.every((d, i) => vc.datasetOrder[i]
        && vc.datasetOrder[i].id === d.id
        && vc.datasetOrder[i].label === d.label),
    `${vc.datasetBtns} button(s) in play ${JSON.stringify(vc.datasetOrder)}, `
      + `pressed ${JSON.stringify(vc.datasets)}`);
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
    /* The sentence names the AUTHORITY now, not the crosswalk: each dataset is
       drawn on the polygons its own numbers were computed against, so the miss
       is "this archive reports a county the county set on screen does not
       have" rather than "the crosswalk could not reach it". */
    const claim = /(\d+)\s+reported areas? (?:is|are) not in /i.exec(said);
    if (typeof unmatched !== 'number') {
      skip(`${ds.label}: the unmatched-area count`, String(unmatched));
    } else if (ds.id === 'reported') {
      check(`NDMC reported: the live region COUNTS the reported areas its own `
        + `authority does not have (${unmatched} of them — NDMC keys Connecticut `
        + 'as its nine planning regions for the whole record, and the FSA LFP '
        + 'determination boundaries answer Connecticut as eight traditional '
        + 'counties), rather than dropping them silently',
      unmatched === DS.reported.unmatchedAtDefaultYear && !!claim
        && Number(claim[1]) === unmatched,
      `oracle says ${unmatched} (expected ${DS.reported.unmatchedAtDefaultYear}), `
        + `the live region says ${JSON.stringify(said.slice(0, 200))}`);
    } else if (ds.isDefault) {
      check('FSA LFP boundaries: nothing is left over to report — this archive '
        + 'and the polygons it is drawn on are the SAME county set, 3,221 ids '
        + 'either way with no symmetric difference, which is why it is the '
        + 'default and why nothing here is crosswalked',
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
    /* Same deferred-announcement race as the eligibility ceiling check: the
       app composes the clamp sentence after ~350 ms of rest. The vintage
       settle usually outlasts that, but "usually" is what flakes are made
       of — poll briefly rather than read once. */
    let saidAfter = await liveText(page);
    for (let i = 0; i < 15 && (saidAfter === saidBefore
      || !dflt.yearDomain.clampSays.test(saidAfter)); i++) {
      await page.waitForTimeout(120);
      saidAfter = await liveText(page);
    }
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

  /* ── 8e. The USDM's own weekly polygons, over the counties ───────────────
     The first thing this app draws that is not a county, and the first control
     that adds geometry rather than recolouring it. The choropleth is a
     REDUCTION — one class per county, taken from the polygons — and the overlay
     is the thing it was reduced from, so putting them on one map is the only
     way a reader can see what the reduction cost. It is published unclipped at
     about 1:2,000,000, which is why its edges run past the coastline; that is
     the map, and help.md says so rather than the app pretending the counties
     are its frame.

     WHAT NEEDS GATING HERE IS NOT "IT DREW". A translucent second geometry is
     the easiest thing in this app to get subtly, invisibly wrong, and every
     assertion below is one of those ways:

       · DRAWING THE WRONG WEEK. The overlay follows a scrubber that can be
         moved faster than a 0.7 MB file can arrive, and a fetch that lands late
         over a week the reader has already left is a map that lies about the
         date printed above it. Hence the marker (which stamps AFTER the source
         is loaded and two frames have passed, never when the fetch was asked
         for), the scrub, and the four-in-a-row thrash.
       · DRAWING IT IN THE WRONG PLACE IN THE STACK. Under the county fill it is
         invisible; over the county lines it swallows the boundaries, the hover
         halo and the selection ring — and the ids it must sit between belong to
         the KIT, are slot-suffixed, and MOVE when the front stack does. So the
         z-order is asserted twice: once as drawn, and once more across a change
         of county authority, which is exactly when a held id goes stale.
       · BORROWING A MARKER THAT MEANS SOMETHING ELSE. `data-ngp-view-seq`
         sequences fetch-involving VIEW transitions; a week is not one, and an
         overlay that bumped it would make every seq-based wait in this file
         return early on a scrub.
       · MOVING THE READOUT AND NOT THE MAP. The strength slider's whole job is
         one `setPaintProperty`, and every other thing it touches — the
         <output>, the URL, localStorage — can agree on a number the layer is
         not painted at. So the strength is asserted off `getPaintProperty`,
         never off the control.
       · PROMISING ON SCREEN AND NOT IN THE POSTER. A printed map that quietly
         dropped the overlay is a lie the reader cannot check.
       · LEAVING SOMETHING BEHIND. The layer stays resident when it is turned
         off — hidden, not destroyed, so the trip back is instant — which is
         precisely the arrangement in which "off" can still paint.

     EVERY WEEK DRIVEN HERE IS IN THE 2012 FIXTURE NEIGHBOURHOOD, never "the
     latest": the archive gains a Tuesday every Thursday, so a gate that drove
     the newest week would be asserting against a moving target. Week 30 of 2012
     is 2012-07-24 on the sidecar's own gapless grid, which is the same fixture
     the deep-link section already lands on (tools/config.mjs § overlay).

     AND IT PUTS THE APP BACK. The overlay ends OFF, its param elided, its
     marker gone, its strength back at the shipped default and its dataset
     returned to the default, so the section template's remaining steps — card,
     table, poster, state round trip — see the state 8d left them, whatever
     order these subsections are ever read in. */
  section('▸ Drought monitor — the USDM\'s own weekly polygons, over the map');
  {
    const O = iface.overlay;
    const dflt = DEFAULT_INTERFACE;
    const p0 = await overlayProbe(page);

    check('the drought monitor ships a weekly-polygon toggle and it is OFF: a '
      + 'second body of geometry over the choropleth is something a visitor asks '
      + 'for, so at rest there is no ?polygons in the URL, no settle marker, and '
      + 'nothing of it painted',
    p0.hasSection && p0.off === 'true' && p0.on === 'false'
      && p0.param === null && p0.marker === null && p0.painted === 0,
    JSON.stringify({ section: p0.hasSection, off: p0.off, on: p0.on,
      param: p0.param, marker: p0.marker, painted: p0.painted,
      layer: p0.hasLayer, url: page.url() }));

    if (!p0.hasOn) {
      skip('the weekly polygons draw, follow the week, survive an authority '
        + 'change and reach the poster',
      `${O.onSel} is not in the page — the drought monitor's polygon toggle is `
        + 'missing');
    } else {
      /* ── On. ─────────────────────────────────────────────────────────────── */
      const seqOff = await viewSeq(page);
      await clickControl(page, O.onSel);
      const landed = await settleOverlay(page);
      const p1 = await overlayProbe(page);
      const iso1 = outIso(p1.out);
      check('turning it ON draws the week that is on screen: the marker stamps '
        + 'that Tuesday — and stamps it only once the source is really loaded '
        + 'and two frames have passed, so it means "drawn" rather than "asked '
        + 'for" — and the polygons paint',
      landed && O.markerIso.test(p1.marker || '') && !!iso1 && p1.marker === iso1
        && p1.painted > 0,
      JSON.stringify({ landed, marker: p1.marker, fromOutput: iso1,
        painted: p1.painted, out: p1.out }));
      check('?polygons=on appears and both seg buttons flip with it — the '
        + 'overlay is shareable state, and aria-pressed is what the kit styles a '
        + 'seg button from, so there is no second source of truth to check',
      p1.param === 'on' && p1.on === 'true' && p1.off === 'false',
      JSON.stringify({ param: p1.param, on: p1.on, off: p1.off,
        url: page.url() }));
      check('turning it on does NOT bump data-ngp-view-seq: that marker '
        + 'sequences fetch-involving VIEW transitions, and the overlay has a '
        + 'settle signal of its own precisely so it never borrows one that means '
        + 'something else',
      p1.seq === seqOff, `seq ${seqOff} → ${p1.seq}`);
      check('the polygons go UNDER the county lines and OVER the county fill: '
        + 'the boundaries, the hover halo and the selection ring stay legible '
        + 'through a translucent drought map, and the two ids it sits between '
        + 'are read from handle.layers at this instant rather than remembered',
      !!p1.order && p1.order.fill >= 0 && p1.order.line >= 0
        && p1.order.overlay > p1.order.fill && p1.order.overlay < p1.order.line,
      JSON.stringify(p1.order));
      clean('usdm overlay on');
      await shot('19e-usdm-overlay');

      /* ── How strongly it is drawn. ───────────────────────────────────────
         A translucent layer has a second question after "is it on": how far
         through it can the reader see. There is no right answer — the drought's
         own shape and the county colour under it want different numbers — so
         the app hands it over, and what is gated here is that the number the
         reader sets is the number GL is painted at, not merely the number the
         readout prints. The slider is asserted to arrive WITH the polygons, on
         the `#elig-source-wrap` pattern: a strength control for a layer that is
         not drawn is a slider with nothing on the other end of it. */
      check('the strength slider appears WITH the polygons and not before them — '
        + 'it is hidden while they are off, visible the moment they are on, '
        + 'named for a screen reader rather than left as a bare range, and it '
        + `opens at the shipped ${O.opacityDefault}% with the paint property to `
        + 'match',
      p0.opacityWrapHidden === true && p1.opacityWrapHidden === false
        && p1.opacityNamed === true
        && p1.opacityOutFor === OVERLAY_SELS.opacityRangeId
        && p1.opacityValue === String(O.opacityDefault)
        && p1.opacityOut === `${O.opacityDefault}%`
        && p1.fillOpacity === O.opacityDefault / 100
        && p1.opacityParam === null,
      JSON.stringify({ hiddenWhileOff: p0.opacityWrapHidden,
        hiddenWhenOn: p1.opacityWrapHidden, named: p1.opacityNamed,
        outFor: p1.opacityOutFor, value: p1.opacityValue, out: p1.opacityOut,
        paint: p1.fillOpacity, param: p1.opacityParam, url: page.url() }));

      const dragged = await dragOpacity(page, 70);
      await settleOpacity(page);
      const up = await overlayProbe(page);
      check('dragging it to 70% reaches the LAYER: fill-opacity is 0.70 on the '
        + 'map itself, the readout says so, the URL carries ?opacity=70 and the '
        + 'preference is stored — a slider that moved only the number under the '
        + 'thumb would pass every check but the first one here',
      dragged && up.fillOpacity === 0.7 && up.opacityOut === '70%'
        && up.opacityValue === '70' && up.opacityParam === '70'
        && up.storedOpacity === '70' && up.painted > 0,
      JSON.stringify({ paint: up.fillOpacity, out: up.opacityOut,
        value: up.opacityValue, param: up.opacityParam,
        stored: up.storedOpacity, painted: up.painted, url: page.url() }));
      check('and it does not repaint the choropleth or move any marker: a '
        + 'translucency is not a fetch, not a view transition and not a new '
        + 'week, so data-ngp-view-seq stands still and the overlay stays '
        + 'stamped with the week it was already showing',
      up.seq === seqOff && up.marker === p1.marker,
      JSON.stringify({ seq: [seqOff, up.seq], marker: [p1.marker, up.marker] }));

      await dragOpacity(page, O.opacityDefault);
      await settleOpacity(page);
      const home = await overlayProbe(page);
      check(`dragging it back to ${O.opacityDefault}% DROPS ?opacity — a param `
        + 'sitting at its default is a permanent smudge on every link shared '
        + 'afterwards, and this one is elided exactly the way ?week and '
        + '?polygons are',
      home.opacityParam === null && home.fillOpacity === O.opacityDefault / 100
        && home.opacityOut === `${O.opacityDefault}%`,
      JSON.stringify({ param: home.opacityParam, paint: home.fillOpacity,
        out: home.opacityOut, url: page.url() }));
      clean('usdm overlay strength');

      /* ── It follows the week. ────────────────────────────────────────────── */
      await scrubWeek(page, 30);
      await settleWeek(page);
      const landed30 = await settleOverlay(page);
      const p2 = await overlayProbe(page);
      const iso2 = outIso(p2.out);
      check(`scrubbing to week 30 of 2012 moves the overlay with it: the marker `
        + `becomes ${O.deepLinkIso} — which is both the <output>'s own printed `
        + 'Tuesday re-derived AND the frozen fixture — the polygons still paint, '
        + 'the seq marker still has not moved, and the URL carries the week and '
        + 'the overlay together',
      landed30 && !!iso2 && p2.marker === iso2 && p2.marker === O.deepLinkIso
        && p2.painted > 0 && p2.seq === seqOff && p2.week === '30'
        && p2.param === 'on',
      JSON.stringify({ marker: p2.marker, fromOutput: iso2,
        fixture: O.deepLinkIso, painted: p2.painted, seq: p2.seq,
        week: p2.week, polygons: p2.param, out: p2.out }));
      clean('usdm overlay follows the week');

      /* ── Four scrubs in a row. ───────────────────────────────────────────
         Driven the way 8a drives the scrubber — the value set and an `input`
         event fired — with no settle between, so three fetches are abandoned
         mid-flight. What must come of that is one week drawn and NOTHING said:
         an aborted fetch is a cancellation, not a failure, and the clean()
         below is the assertion that the app knows the difference.

         The 120 ms is not a settle, it is the OPPOSITE of one: back-to-back
         evaluates can coalesce inside the scrub's own frame throttle, and three
         fetches that never started cannot be aborted — which would make this an
         expensive way to assert nothing. Long enough for each request to be in
         flight, far shorter than the 0.7 MB it is fetching. */
      const THRASH = [12, 20, 34, 41];
      for (const n of THRASH) {
        await scrubWeek(page, n);
        await page.waitForTimeout(120);
      }
      await settleWeek(page);
      const landedT = await settleOverlay(page);
      const p3 = await overlayProbe(page);
      const iso3 = outIso(p3.out);
      const nT = weekNumber(p3.out);
      check('four scrubs in a row and the overlay lands on the LAST of them, not '
        + 'on whichever abandoned fetch happened to answer first — a late arrival '
        + 'painted over a week the reader has already left is a map that lies '
        + 'about the date printed above it',
      landedT && !!iso3 && p3.marker === iso3 && p3.painted > 0
        && !!nT && nT.n === THRASH[THRASH.length - 1],
      JSON.stringify({ marker: p3.marker, fromOutput: iso3,
        week: nT && nT.n, wanted: THRASH[THRASH.length - 1],
        painted: p3.painted, drove: THRASH }));
      clean('usdm overlay week thrash');

      /* ── A change of county authority. ───────────────────────────────────── */
      const beforeSwap = p3.boundary;
      const seqSwap = await viewSeq(page);
      const swapped = await clickControl(page, DS.census.sel);
      await awaitViewSeq(page, seqSwap);
      // Not settleBoundary(key): the Census authority's answer moves with the
      // year (2012 → the 2011 vintage), so what is waited for is "no longer the
      // authority we were on", which needs no table.
      await page.waitForFunction(
        (was) => {
          const k = document.documentElement.dataset.ngpBoundary;
          return !!k && k !== was;
        }, beforeSwap, { timeout: CONFIG.switchMs }).catch(() => {});
      await settleVintage(page);
      const landedSwap = await settleOverlay(page);
      const p4 = await overlayProbe(page);
      check(`the overlay survives a change of county AUTHORITY and is re-anchored `
        + 'to the arriving stack: the kit keeps more than one archive resident, '
        + 'its layer ids carry a slot suffix and they MOVE when the front does, '
        + 'so an overlay that kept its old anchor would end up buried under a '
        + 'transparent retired stack or floating over the new county lines',
      swapped && landedSwap && !!p4.boundary && p4.boundary !== beforeSwap
        && !!p4.order && p4.order.fill >= 0 && p4.order.line >= 0
        && p4.order.overlay > p4.order.fill && p4.order.overlay < p4.order.line
        && p4.painted > 0 && O.markerIso.test(p4.marker || ''),
      JSON.stringify({ from: beforeSwap, to: p4.boundary, order: p4.order,
        painted: p4.painted, marker: p4.marker }));

      // Back to the default archive, so everything after this subsection sees
      // the dataset 8b left behind rather than the one this check borrowed.
      const seqRestore = await viewSeq(page);
      await clickControl(page, DS['fsa-lfp'].sel);
      await awaitViewSeq(page, seqRestore);
      await settleVintage(page);
      await settleOverlay(page);
      const p5 = await overlayProbe(page);
      check(`the overlay is a PREFERENCE of this view and is remembered as one `
        + `(${O.lsKey} === 'on'): a visitor who turned the drought polygons on `
        + 'comes back to them, and the key is namespaced per view like every '
        + 'other choice this app stores',
      p5.stored === 'on', 'stored ' + JSON.stringify(p5.stored));
      clean('usdm overlay across a boundary swap');

      /* ── It belongs to THIS view. ──────────────────────────────────────────
         The strength is taken OFF its default first, so that the round trip has
         something to lose: at 45 the param is elided, and "the param came back"
         would be indistinguishable from "the param was never there". */
      await dragOpacity(page, 70);
      await settleOpacity(page);
      const seqAway = await viewSeq(page);
      await clickControl(page, dflt.switchSel);
      await awaitViewSeq(page, seqAway);
      const gone = await settleOverlayGone(page);
      const away = await overlayProbe(page);
      check(`leaving the drought monitor takes the overlay with it: ?polygons is `
        + 'dropped (a param describing a control that is not on screen is a '
        + 'smudge on every link shared afterwards), the marker is gone entirely, '
        + `and nothing of the drought map is left painted over ${dflt.label}`,
      gone && away.param === null && away.marker === null && away.painted === 0,
      JSON.stringify({ param: away.param, marker: away.marker,
        painted: away.painted, layer: away.hasLayer, url: page.url() }));
      check('…and it takes the STRENGTH with it: ?opacity describes a slider '
        + 'that is not on screen — twice over, since the control it belongs to '
        + 'is gone too — so the param is dropped and the slider goes back into '
        + 'its wrap with the rest of the drought monitor\'s controls',
      away.opacityParam === null && away.opacityWrapHidden === true,
      JSON.stringify({ param: away.opacityParam,
        wrapHidden: away.opacityWrapHidden, url: page.url() }));

      const seqHome = await viewSeq(page);
      await clickControl(page, iface.switchSel);
      await awaitViewSeq(page, seqHome);
      const backLanded = await settleOverlay(page);
      const back = await overlayProbe(page);
      const isoBack = outIso(back.out);
      check('and coming back restores it — the layer was hidden, not destroyed, '
        + 'which is what makes the return instant — so the week the visitor left '
        + 'it on is drawn again and ?polygons=on is re-emitted',
      backLanded && O.markerIso.test(back.marker || '') && !!isoBack
        && back.marker === isoBack && back.param === 'on' && back.painted > 0,
      JSON.stringify({ marker: back.marker, fromOutput: isoBack,
        param: back.param, painted: back.painted }));
      check('…at the strength it was left at, on the PAINT and not merely in the '
        + 'readout: 70% is a way of READING this map rather than a place in it, '
        + 'so it is remembered per view exactly like the toggle above it and '
        + 'comes back in the URL with it',
      back.fillOpacity === 0.7 && back.opacityParam === '70'
        && back.opacityValue === '70' && back.opacityOut === '70%'
        && back.opacityWrapHidden === false,
      JSON.stringify({ paint: back.fillOpacity, param: back.opacityParam,
        value: back.opacityValue, out: back.opacityOut,
        wrapHidden: back.opacityWrapHidden, url: page.url() }));

      const said = await settledLiveText(page, (t) => O.liveClause.test(t));
      const vc = await viewControls(page);
      check('a reader who cannot see the canvas is TOLD there is a second map on '
        + 'it: the live region says the polygons are drawn over the counties, and '
        + 'the legend key says what they are — the USDM\'s own published weekly '
        + 'map, as published, rather than a smoothing of the county colours',
      O.liveClause.test(said) && O.legendClause.test(vc.legend.key || ''),
      `live region ${JSON.stringify(said.slice(0, 220))}, legend key `
        + `${JSON.stringify((vc.legend.key || '').slice(0, 260))} — they must `
        + `match ${O.liveClause} and ${O.legendClause}`);
      clean('usdm overlay across a view switch');

      /* Back to the shipped strength before the poster below, so what is
         exported — and everything after this subsection — is the picture the
         app comes up on rather than the one the round trip above borrowed. */
      await dragOpacity(page, O.opacityDefault);
      await settleOpacity(page);

      /* ── The poster. ─────────────────────────────────────────────────────── */
      let withOverlay = null;
      if (session && session.acceptsDownloads) {
        withOverlay = await poster(page);
        check('the poster is exported with the overlay on and is a real poster: '
          + 'named for the view it holds, PNG magic bytes, and over 100 KB rather '
          + 'than a blank canvas',
        !!withOverlay && withOverlay.bytes.length > 100 * 1024
          && withOverlay.bytes[0] === 0x89 && withOverlay.bytes[1] === 0x50
          && withOverlay.bytes[2] === 0x4e && withOverlay.bytes[3] === 0x47
          && iface.exportName.test(withOverlay.name || ''),
        withOverlay
          ? `${withOverlay.name}, ${Math.round(withOverlay.bytes.length / 1024)} KB`
          : 'no download appeared inside 120s');
        clean('usdm overlay export · polygons on');
      } else {
        skip('the poster carries the overlay when the overlay is on',
          'this session was not opened with downloads: true');
      }

      /* ── Off again — which is also this subsection putting the app back. ─── */
      await clickControl(page, O.offSel);
      const cleared = await settleOverlayGone(page);
      const off = await overlayProbe(page);
      check('turning it back OFF leaves nothing behind: the marker is gone, '
        + '?polygons is elided at its default, both buttons flipped back, and the '
        + 'layer — which stays RESIDENT for the trip back, hidden rather than '
        + 'removed — paints nothing at all',
      cleared && off.marker === null && off.param === null
        && off.off === 'true' && off.on === 'false' && off.painted === 0,
      JSON.stringify({ marker: off.marker, param: off.param, off: off.off,
        on: off.on, painted: off.painted, layer: off.hasLayer,
        url: page.url() }));
      check('…including the strength slider, which goes back into its wrap with '
        + `it — and ?opacity stays out of the URL, at ${O.opacityDefault}% and `
        + 'with nothing left to be strong',
      off.opacityWrapHidden === true && off.opacityParam === null
        && off.opacityValue === String(O.opacityDefault),
      JSON.stringify({ wrapHidden: off.opacityWrapHidden,
        param: off.opacityParam, value: off.opacityValue, url: page.url() }));

      if (withOverlay) {
        const without = await poster(page);
        check('…and the two posters are not the same picture: the same week, the '
          + 'same dataset, the same theme, exported once with the polygons and '
          + 'once without, differ byte for byte — a poster that silently lacked '
          + 'what the screen promised is a lie the reader cannot check',
        !!without && without.bytes.length > 0
          && !without.bytes.equals(withOverlay.bytes),
        without
          ? `${Math.round(withOverlay.bytes.length / 1024)} KB with the overlay, `
            + `${Math.round(without.bytes.length / 1024)} KB without`
          : 'no second download appeared inside 120s');
        clean('usdm overlay export · polygons off');
      }

      /* ── Two fresh boots, in their own contexts. ─────────────────────────
         Both have to BOOT on the drought monitor, and that is not incidental
         framing: the app reads a view's choices out of the URL and localStorage
         once, for the family it boots into. A page that started on the grazing
         periods and switched would take its overlay state from the in-memory
         view state instead — which is the path the round trip above already
         covers, and which would make both of these assert nothing. */
      const link = `?view=${iface.slug}&year=2012&week=30&polygons=on`;
      const deepSession = await open({ query: link });
      const deepLanded = await settleOverlay(deepSession.page);
      const deep = await overlayProbe(deepSession.page);
      check(`a shared link carries the overlay: ${link} boots straight onto the `
        + `polygons for ${O.deepLinkIso}, painted, with the toggle already `
        + 'pressed — following somebody\'s link is not supposed to end in turning '
        + 'the thing they were showing you back on',
      deepLanded && deep.marker === O.deepLinkIso && deep.painted > 0
        && deep.on === 'true' && deep.off === 'false' && deep.param === 'on'
        && deep.week === '30',
      JSON.stringify({ marker: deep.marker, painted: deep.painted,
        on: deep.on, off: deep.off, param: deep.param, week: deep.week,
        out: deep.out }));
      deepSession.clean('usdm overlay deep link');
      await deepSession.shot('19f-usdm-overlay-deep-link');
      await deepSession.ctx.close();

      /* Stored values the app does not offer — BOTH of the overlay's keys, the
         enumeration and the number, because they are validated by different
         code and a fallback that only half works is a page that boots with a
         NaN in a paint property. The clean() is half the assertion: an unusable
         PREFERENCE is a warning, not a tripwire — the app cannot stop a
         visitor's storage from holding anything at all — and a console.error
         here would gate CI on a condition no code change can prevent. */
      const junkSession = await open({
        query: `?view=${iface.slug}`,
        storage: { [O.lsKey]: 'banana', [O.opacityLsKey]: 'banana' },
      });
      const junk = await overlayProbe(junkSession.page);
      check(`a stored ${O.lsKey} of "banana" falls back to off rather than to on `
        + 'or to a crash: every remembered value is re-validated on read exactly '
        + 'like a URL param',
      junk.off === 'true' && junk.on === 'false' && junk.marker === null
        && junk.param === null && junk.painted === 0,
      JSON.stringify({ off: junk.off, on: junk.on, marker: junk.marker,
        param: junk.param, painted: junk.painted, stored: junk.stored,
        url: junkSession.page.url() }));
      check(`and a stored ${O.opacityLsKey} of "banana" falls back to `
        + `${O.opacityDefault}% rather than to a NaN — which is the failure `
        + 'worth naming here, because MapLibre takes a NaN opacity without '
        + 'complaint and the overlay simply stops being visible, with nothing '
        + 'in the console to say why. The slider reads the default and no '
        + '?opacity is minted from an unusable preference',
      junk.opacityValue === String(O.opacityDefault)
        && junk.opacityOut === `${O.opacityDefault}%`
        && junk.opacityParam === null,
      JSON.stringify({ value: junk.opacityValue, out: junk.opacityOut,
        param: junk.opacityParam, stored: junk.storedOpacity,
        url: junkSession.page.url() }));
      junkSession.clean('usdm overlay · unusable stored values');
      await junkSession.ctx.close();
    }
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
  const painted = await paintSignature(page);
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

/* ══════════════════════════════════════════════════════════════════════════
   11. LFP ELIGIBILITY — the third interface, driven by the same template.

   The program's answer, and the first view in this app whose subject is a
   DETERMINATION rather than a measurement. Everything structural is the section
   template again; what is below is what this view adds, and each of these is a
   claim a screenshot cannot make:

     · THREE ARCHIVES OF THE SAME QUESTION that disagree on purpose — what FSA
       determined (FOIA), what FSA published week by week, and what the
       statutory rule yields when it is recomputed from the Drought Monitor. The
       third one carries no payment months at all, so its legend has to say that
       the number on screen is not the payable amount.
     · A FOURTH CONTROL THAT ONLY SOMETIMES EXISTS: the derived archive holds
       four county aggregations side by side, and the select that picks between
       them must appear with that dataset, take its options from the payload,
       and take its URL param away again when the dataset changes.
     · TWO VARIABLES OVER ONE MAP, validated per view: `?variable=duration` is a
       grazing-period value and means nothing here, so it has to fall back
       rather than paint a blank map.
     · A DATASET WHOSE RECORD ENDS BEFORE THE APP'S DEFAULT YEAR. The FOIA
       archive stops at 2025, so arriving on it from any later year moves the
       visitor — and a move has to be said out loud, with the reason.
     · AN ERA WITH HOLES IN IT. 2008–2011 determinations carry payment months
       without dates in the FOIA archive and dates without payment months on the
       web, which is what the ramp's index-0 slate is for in each of the two
       variables.
   ══════════════════════════════════════════════════════════════════════════ */

const ELIG = CONFIG.interfaces.eligibility;

/** Flattened for the in-page probe: RegExps do not survive Playwright's
    serialisation, so only strings cross and every pattern is applied in Node. */
const ELIG_SELS = {
  sourceWrap: ELIG.source.wrapSel,
  sourceSel: ELIG.source.selectSel,
  typeSel: ELIG.type.selectSel,
  monthsSel: ELIG.variables.months.sel,
  dateSel: ELIG.variables.date.sel,
};

/**
 * Everything the eligibility drawer, its URL params and its stored state say,
 * in one round trip. `exists: false` on any control is an answer, not a crash —
 * the checks that need it then fail or skip by name instead of throwing a
 * Playwright stack trace out of the middle of the section.
 */
const eligProbe = (page) => page.evaluate((s) => {
  const el = (sel) => document.querySelector(sel);
  const wrap = el(s.sourceWrap);
  const src = el(s.sourceSel);
  const type = el(s.typeSel);
  const url = new URL(location.href);
  const shown = (n) => !!(n && !n.hidden && n.getClientRects().length > 0);
  const opts = (n) => (n ? Array.from(n.options).map((o) => ({
    value: o.value, label: (o.textContent || '').trim(),
  })) : []);
  const pressed = (sel) => {
    const b = el(sel);
    return b ? b.getAttribute('aria-pressed') : null;
  };
  const ls = (k) => {
    try { return localStorage.getItem(k); } catch (e) { return 'unavailable'; }
  };
  return {
    sourceWrapExists: !!wrap,
    /** A wrap that is `hidden` and a wrap the drawer has scrolled out of view
        are different things; on a phone the whole drawer can be
        `visibility: hidden`, so the `hidden` attribute is what is read and the
        client rect only confirms it when the drawer is up. */
    sourceWrapHidden: wrap ? wrap.hidden : null,
    sourceWrapShown: shown(wrap),
    sourceExists: !!src,
    sourceValue: src ? src.value : null,
    sourceOptions: opts(src),
    typeExists: !!type,
    typeValue: type ? type.value : null,
    typeLabel: type && type.selectedIndex >= 0
      ? (type.options[type.selectedIndex].textContent || '').trim() : null,
    typeOptions: opts(type),
    monthsPressed: pressed(s.monthsSel),
    datePressed: pressed(s.dateSel),
    params: {
      view: url.searchParams.get('view'),
      dataset: url.searchParams.get('dataset'),
      source: url.searchParams.get('source'),
      type: url.searchParams.get('type'),
      variable: url.searchParams.get('variable'),
      year: url.searchParams.get('year'),
      week: url.searchParams.get('week'),
    },
    stored: {
      dataset: ls('sfsa-ngp-dataset-eligibility'),
      source: ls('sfsa-ngp-source-eligibility'),
      type: ls('sfsa-ngp-type-eligibility'),
      variable: ls('sfsa-ngp-variable-eligibility'),
    },
    legendWheelHasDrawing: !!document.querySelector('#legend-wheel svg, #legend-wheel canvas'),
    swatchLabels: Array.from(
      document.querySelectorAll('#legend-swatches .sfsa-legend-item'))
      .map((n) => (n.textContent || '').trim()),
  };
}, ELIG_SELS);

/** The source dictionary the ACTIVE decoder shipped — so "the select offers
    these conventions and not those" can be checked against the payload rather
    than against the same literal the app read. All FOUR are in the payload; the
    app offers three of them. */
const decoderSources = (page) => page.evaluate(async () => {
  try {
    const app = await import(new URL('js/app.js', document.baseURI).href);
    const d = app.ngpContext().getData();
    return d && typeof d.sources === 'function' ? (d.sources() || []) : null;
  } catch (err) { return null; }
});

/**
 * What the app does with a `?source=` naming a convention it does not offer.
 *
 * Asked of the descriptor's OWN resolve() against the live payload — the very
 * call applySource() makes when a deep link is honoured (js/app.js §
 * applySource) — rather than by booting a second context for one string: the
 * derived archive is an 11 MB parse, and this is the same code path either way.
 * The warning it prints is a console.warn, which the clean() gate ignores by
 * design (it counts errors).
 *
 * @returns {Promise<{resolved: string, dflt: string, offered: string[]}|{error}>}
 */
const resolveSource = (page, raw) => page.evaluate(async (want) => {
  try {
    const app = await import(new URL('js/app.js', document.baseURI).href);
    const mod = await import(
      new URL('js/interfaces/eligibility.js', document.baseURI).href);
    const data = app.ngpContext().getData();
    const src = mod.ELIGIBILITY.source;
    return {
      resolved: src.resolve(data, want),
      dflt: src.defaultId(data),
      offered: src.options(data).map((o) => o.value),
    };
  } catch (err) { return { error: String(err).split('\n')[0] }; }
}, raw);

/**
 * Choose an option the way a pointer does: match it by value or by label
 * (slugified, so it does not matter which of the two the app puts in `value`),
 * set it, fire `change`. Returns the chosen value, or null if no option
 * matched — which the caller turns into a named failure.
 */
const selectOption = (page, sel, wanted) => page.evaluate(([s, want]) => {
  const slug = (t) => String(t).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const node = document.querySelector(s);
  if (!node) return null;
  const hit = Array.from(node.options).find((o) => o.value === want
    || slug(o.value) === slug(want) || slug(o.textContent || '') === slug(want));
  if (!hit) return null;
  node.value = hit.value;
  node.dispatchEvent(new Event('change', { bubbles: true }));
  return hit.value;
}, [sel, wanted]);

/** A histogram of what the choropleth is painting, keyed by colour string. The
    paint signature says THAT the map changed; this says which colours are on it
    and how many counties carry each, which is how a categorical claim ("the
    undated counties took the slate") is checked. */
const paintHistogram = (page) => page.evaluate(async () => {
  const out = {};
  try {
    const app = await import(new URL('js/app.js', document.baseURI).href);
    const c = app.ngpContext();
    const map = c.getMap();
    if (!map || !c.getCounties()) return out;
    // Through the handle — see paintSignature on why a hand-rolled ref reads
    // back undefined on a vector source without throwing, and why there is no
    // constant left to fall back to.
    const handle = c.getHandle();
    for (const id of c.getCounties().index.keys()) {
      const st = map.getFeatureState(handle.featureRef(id));
      const color = ((st && st.color) || '').toLowerCase();
      if (color) out[color] = (out[color] || 0) + 1;
    }
    return out;
  } catch (err) { return out; }
});

/** The committed ramp asset, fetched by the PAGE (so it is the same bytes the
    app read) rather than from disk. Null when it is not there yet. */
const dfRamp = (page, path) => page.evaluate(async (p) => {
  try {
    const res = await fetch(new URL(p, document.baseURI).href);
    if (!res.ok) return null;
    const json = await res.json();
    return Array.isArray(json) ? json.map((c) => String(c).toLowerCase()) : null;
  } catch (err) { return null; }
}, path);

/** A repaint that involves no fetch (a variable toggle, a type change, a source
    change) is throttled to a frame and announced at rest, like the year. */
const settleRepaint = async (page) => {
  await page.waitForTimeout(600);
  await settleFrames(page);
};

/** Did the live region say this number? Counts are announced with the locale's
    separators, so both forms are accepted. */
const saysCount = (said, n) => typeof n === 'number'
  && (said.includes(n.toLocaleString('en-US')) || said.includes(String(n)));

/**
 * The eligibility view's own controls — step 6 of the section template.
 *
 * Here rather than in the probe table for the documented reason: every check
 * below needs the paint-signature, marker, histogram and live-region probes in
 * this file, and tools/config.mjs must not assert. The selectors, fixtures and
 * measured counts all live in the entry.
 */
async function eligExtraChecks({ page, check, skip, clean, shot, iface }) {
  const DS = iface.datasets;
  /* The year the template arrived on — which is already the CLAMPED one if the
     visitor's shared year was later than the FOIA archive's last program year.
     Restored at the end, so the template's card, table and poster steps read a
     year this view actually has data for rather than whatever the last probe
     left behind. */
  const entryYear = (await snapshot(page)).state.year;

  /* ── 11a. Three archives of one determination ───────────────────────────
     Ending on the default, so the URL is clean again for the steps after this
     and the section's own round-trip claim means something.

     NO PER-TOGGLE REPAINT WITNESS HERE, and that is a measured decision rather
     than a gap. The two FSA archives are the same determinations by two routes,
     and on a CLOSED program year they agree — at 2025 Native Pasture both paint
     the identical 737 counties with the identical colours, which is exactly the
     claim each archive makes about the other. A "the map must change" check
     would therefore fail on a correct app, and passing it would need a year
     picked for disagreement rather than for being the year a visitor lands on.
     What IS asserted per toggle is the paint against that archive's own
     reduction (the oracle below), and what is asserted ONCE, after the loop, is
     that the recomputed archive paints a different map from FSA's own — the
     comparison the view exists to make. */
  section('▸ LFP eligibility — three archives of the same determination');
  const sigOf = {};
  for (const ds of [DS.web, DS.derived, DS.official]) {
    const seq = await viewSeq(page);
    const clicked = await clickControl(page, ds.sel);
    const bumped = clicked && await awaitViewSeq(page, seq);
    const vc = await viewControls(page);
    const snap = await snapshot(page);
    const sig = await paintSignature(page);
    const p = await eligProbe(page);
    check(`the ${JSON.stringify(ds.label)} toggle completes on data-ngp-view-seq `
      + `(fetch${ds.id === 'derived' ? ' of an 11 MB payload' : ''}, decode, `
      + 'reduce, recolor, feature-state flush)',
    bumped, clicked ? `data-ngp-view-seq stayed at ${seq}`
      : `${ds.sel} was not clickable — the eligibility dataset seg is missing`);
    check(`${ds.label}: it is the one pressed button of the view's three, and no `
      + 'other view\'s dataset button is in play',
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
    p.params.dataset === (ds.isDefault ? null : ds.id), page.url());
    const expect = await iface.paintOracle(page);
    if (typeof expect === 'number') {
      check(`${ds.label}: every county this year's determinations reach carries a `
        + 'colour, and nothing else does',
      sig.colored === expect, `${sig.colored} painted, ${expect} expected`);
    } else {
      skip(`${ds.label}: painted count against the data`, String(expect));
    }
    check(`${ds.label}: the choice is remembered for the next visit `
      + '(sfsa-ngp-dataset-eligibility)',
    p.stored.dataset === ds.id, 'stored ' + JSON.stringify(p.stored.dataset));

    /* The aggregation select belongs to ONE of the three, and the param that
       drives it must not outlive the dataset that has it. */
    check(ds.id === 'derived'
      ? 'Derived from USDM: the aggregation select comes with it, because only '
        + 'that archive holds four answers to choose between'
      : `${ds.label}: there is no aggregation to choose, so the select stays out `
        + 'of the drawer and ?source stays out of the URL',
    ds.id === 'derived'
      ? (p.sourceWrapHidden === false && p.sourceExists)
      : (p.sourceWrapHidden !== false && p.params.source === null),
    JSON.stringify({ wrapHidden: p.sourceWrapHidden, select: p.sourceExists,
      sourceParam: p.params.source }));

    /* What the numbers MEAN differs with the archive, and the legend key is
       where that is said. The derived archive carries the drought factor the
       ladder awards and no cap, so a reader must not take it for a payment. */
    const key = (vc.legend.key || '');
    if (ds.id === 'derived') {
      check('Derived from USDM: the legend says in words that these are '
        + 'recomputed drought factors and NOT FSA\'s payable months — an '
        + 'uncapped number shown as a payment would overstate every award',
      /no cap|uncapped|not .{0,30}payable|recomputed/i.test(key),
      JSON.stringify(key.slice(0, 220)));
      const said = await settledLiveText(page, (t) => /recompute/i.test(t));
      check('…and the announcement says the same thing, so a screen-reader '
        + 'visitor is not the only one who has to infer it',
      /recompute/i.test(said) && /not (?:an )?(?:official )?FSA|not FSA/i.test(said),
      JSON.stringify(said.slice(0, 220)));
    } else {
      check(`${ds.label}: the legend key describes payment months, which is what `
        + 'this archive actually carries',
      /month/i.test(key) && key.length > 40, JSON.stringify(key.slice(0, 220)));
      const eligible = await iface.eligibleOracle(page);
      const said = await settledLiveText(page, (t) => typeof eligible === 'number'
        && (saysCount(t, eligible) || saysCount(t, sig.colored)));
      if (typeof eligible !== 'number') {
        skip(`${ds.label}: the announced eligible-county count`, String(eligible));
      } else {
        check(`${ds.label}: the announcement counts the counties this year's `
          + `determinations reach (${eligible.toLocaleString('en-US')}) rather `
          + 'than leaving a canvas with no text a screen reader can read',
        saysCount(said, eligible) || saysCount(said, sig.colored),
        `live region says ${JSON.stringify(said.slice(0, 220))} — expected `
          + `${eligible} (reduction) or ${sig.colored} (painted)`);
      }
    }
    clean(`eligibility dataset → ${ds.id}`);
    await shot(`22-elig-${ds.id}`);
    sigOf[ds.id] = sig;
  }
  check('the recomputed archive paints a DIFFERENT map from FSA\'s own '
    + 'determination — which is the comparison this view exists to make, and '
    + 'the reason the derived numbers may not be read as payments',
  !!sigOf.derived && !!sigOf.official
    && sigOf.derived.hash !== sigOf.official.hash,
  Object.entries(sigOf)
    .map(([id, s]) => `${id} ${s.colored} @${s.hash}`).join(' | '));

  /* ── 11b. Defensible ways to read "any area of the county" ───────────────
     The derived archive recomputes eligibility under FOUR conventions rather
     than picking one, and this select is the only place in the app where a
     visitor chooses between two defensible readings of the same statutory
     phrase. The app OFFERS THREE of the four: the 2020 county set held fixed is
     a fourth answer to a question the other three already disagree about, so it
     stays in the data and out of the picker (js/interfaces/eligibility.js §
     OFFERED_SOURCES). So: the options are the app's three, checked against the
     payload's own dictionary; the fourth falls back like any value the app does
     not offer; each convention repaints; the default is elided; and the param is
     dropped the moment the dataset that owns it is gone. */
  section('▸ LFP eligibility — the ways to read "any area of the county"');
  {
    const seqD = await viewSeq(page);
    const toDerived = await clickControl(page, DS.derived.sel);
    const onDerived = toDerived && await awaitViewSeq(page, seqD);
    const p0 = await eligProbe(page);
    const shipped = await decoderSources(page);
    const wanted = iface.source.conventions.map((c) => c.id);
    check('setup: the derived archive is loaded and its aggregation select is '
      + 'in the drawer', onDerived && p0.sourceExists && p0.sourceWrapHidden === false,
    JSON.stringify({ onDerived, select: p0.sourceExists,
      wrapHidden: p0.sourceWrapHidden }));

    if (!p0.sourceExists) {
      skip('the aggregation select offers the conventions the app names',
        `${iface.source.selectSel} is not in the page`);
    } else {
      const slug = (t) => String(t).toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const offered = p0.sourceOptions.map((o) => slug(o.value));
      const gone = iface.source.removed;
      check(`the aggregation select offers exactly the ${wanted.length} `
        + 'conventions this app names, in that order and in those words '
        + `(${iface.source.conventions.map((c) => c.label).join(' · ')}), of the `
        + 'four the payload ships — every one of them present in the payload\'s '
        + `own dictionary, and the fourth (${gone.label}) not on the menu`,
      Array.isArray(shipped) && shipped.length === 4
        && shipped.includes(gone.id)
        && wanted.every((id) => shipped.includes(id))
        && offered.length === wanted.length
        && wanted.every((id, i) => offered[i] === slug(id))
        && iface.source.conventions.every((c, i) => p0.sourceOptions[i]
          && p0.sourceOptions[i].label === c.label)
        && !offered.includes(slug(gone.id)),
      JSON.stringify({ shipped, offered,
        labels: p0.sourceOptions.map((o) => o.label) }));

      /* The convention the app no longer offers, asked for by URL: it must land
         on the default rather than paint a map no control on screen accounts
         for — the same fallback every unknown value gets. */
      const fell = await resolveSource(page, gone.slug);
      check(`a ?source=${gone.slug} — the convention the archive still publishes `
        + 'and this app no longer offers — falls back to the default instead of '
        + 'being honoured, exactly like any other value the app does not offer',
      !fell.error && fell.resolved === iface.source.default
        && fell.dflt === iface.source.default,
      fell.error ? String(fell.error) : JSON.stringify(fell));
      check('every option is named in words a reader can tell apart, not by its '
        + 'archive slug',
      p0.sourceOptions.every((o) => o.label.length > 3 && !/^usdm-/.test(o.label)),
      JSON.stringify(p0.sourceOptions.map((o) => o.label)));
      check('it opens on the FSA-boundary convention — the same geometry this '
        + 'map draws, and the same default the drought monitor takes — and a '
        + 'default says nothing in the URL',
      slug(p0.sourceValue || '') === slug(iface.source.default)
        && p0.params.source === null,
      JSON.stringify({ value: p0.sourceValue, param: p0.params.source }));

      /* ONE AGGREGATE REPAINT WITNESS, not one per convention. The conventions
         agree about most of the country — measured at 2024 Native Pasture, the
         four name 630 counties between them and disagree about six — and two of
         them can easily agree EXACTLY on a given year and pasture type (the two
         Census conventions did, at 2025 Native Pasture, which is one reason only
         one of the two is on the menu). So "this convention repaints the map" is
         not a property any single one of them has; what the archive claims, and
         what is checked below, is that they are not one map relabelled. Each
         convention is still held to its own reduction, county for county, by the
         oracle. */
      const sigs = { [iface.source.default]: await paintSignature(page) };
      for (const conv of iface.source.conventions.slice(1)) {
        const chosen = await selectOption(page, iface.source.selectSel, conv.id);
        await settleRepaint(page);
        const p = await eligProbe(page);
        const next = await paintSignature(page);
        const expect = await iface.paintOracle(page);
        sigs[conv.id] = next;
        check(`${conv.label}: the select accepted it and the app is reading it`,
          chosen !== null && slug(p.sourceValue || '') === slug(conv.id),
          chosen === null ? `no option matched ${conv.id}`
            : `select value ${JSON.stringify(p.sourceValue)}`);
        check(`${conv.label}: ?source=${conv.slug} is in the URL — which `
          + 'aggregation produced a map is not a detail a shared link may drop',
        p.params.source !== null && slug(p.params.source) === slug(conv.slug),
        `?source=${JSON.stringify(p.params.source)} — ${page.url()}`);
        if (typeof expect === 'number') {
          check(`${conv.label}: the counties painted are the ones this `
            + 'aggregation makes eligible',
          next.colored === expect, `${next.colored} painted, ${expect} expected`);
        } else {
          skip(`${conv.label}: painted count against the data`, String(expect));
        }
        check(`${conv.label}: the choice is remembered for the next visit `
          + '(sfsa-ngp-source-eligibility)',
        p.stored.source !== null && p.stored.source !== 'unavailable'
          && slug(p.stored.source) === slug(conv.slug),
        'stored ' + JSON.stringify(p.stored.source));
      }
      {
        const hashes = new Set(Object.values(sigs).map((s) => s.hash));
        check(`the ${wanted.length} conventions on offer are NOT one map `
          + 'relabelled: reading the same statutory phrase these defensible ways '
          + 'gives at least two different maps, which is why the archive '
          + 'recomputes each of them instead of picking one',
        hashes.size >= 2,
        Object.entries(sigs)
          .map(([id, s]) => `${id} ${s.colored} @${s.hash}`).join(' | '));
      }

      /* Back to the default, and then out of the dataset that owns it. */
      await selectOption(page, iface.source.selectSel, iface.source.default);
      await settleRepaint(page);
      const home = await eligProbe(page);
      check('choosing the default convention again DROPS ?source — a param at '
        + 'its default is a permanent smudge on every link shared afterwards',
      home.params.source === null, page.url());

      const conv2 = iface.source.conventions[1];
      await selectOption(page, iface.source.selectSel, conv2.id);
      await settleRepaint(page);
      const seqOut = await viewSeq(page);
      await clickControl(page, DS.official.sel);
      await awaitViewSeq(page, seqOut);
      const away = await eligProbe(page);
      check('leaving the derived archive takes ?source with it, even when it was '
        + 'not at its default — an aggregation param on an FSA determination '
        + 'would describe a control that is not on screen',
      away.params.source === null && away.sourceWrapHidden !== false,
      JSON.stringify({ source: away.params.source,
        wrapHidden: away.sourceWrapHidden, url: page.url() }));

      const seqBack = await viewSeq(page);
      await clickControl(page, DS.derived.sel);
      await awaitViewSeq(page, seqBack);
      const back = await eligProbe(page);
      check('…and coming back restores the convention the visitor had chosen, '
        + 'param and select together (session memory, not a reset)',
      slug(back.sourceValue || '') === slug(conv2.id)
        && back.params.source !== null
        && slug(back.params.source) === slug(conv2.slug),
      JSON.stringify({ value: back.sourceValue, param: back.params.source }));

      /* Leave the section on the default archive at its default convention. */
      await selectOption(page, iface.source.selectSel, iface.source.default);
      await settleRepaint(page);
      const seqHome = await viewSeq(page);
      await clickControl(page, DS.official.sel);
      await awaitViewSeq(page, seqHome);
    }
    clean('eligibility aggregation select');
    await shot('22b-elig-source');
  }

  /* ── 11c. Two variables, two legend bodies ──────────────────────────────
     The same determination, painted twice: how much it pays, and when it
     qualified. The second one is the grazing periods' cyclic wheel, which is
     the point — a date is a date, whatever view is asking. */
  section('▸ LFP eligibility — payment months and qualifying date');
  {
    const months0 = await eligProbe(page);
    const vc0 = await viewControls(page);
    const sig0 = await paintSignature(page);
    check('it opens on payment months, with the swatches legend and no '
      + '?variable in the URL',
    months0.monthsPressed === 'true' && months0.datePressed === 'false'
      && vc0.legend.swatches === true && vc0.legend.wheel === false
      && vc0.legend.bar === false && months0.params.variable === null,
    JSON.stringify({ months: months0.monthsPressed, date: months0.datePressed,
      legend: vc0.legend, param: months0.params.variable }));
    check('the swatch rows name every step of the ramp in words, ending in the '
      + 'two categories that are not months at all — eligible with no month '
      + 'count, and not eligible this year',
    iface.legend.items.every((t, i) => (months0.swatchLabels[i] || '').includes(t))
      && (months0.swatchLabels[months0.swatchLabels.length - 1] || '')
        .includes(iface.legend.noData),
    JSON.stringify(months0.swatchLabels));

    const clickedDate = await clickControl(page, iface.variables.date.sel);
    await settleRepaint(page);
    const onDate = await eligProbe(page);
    const vcDate = await viewControls(page);
    const sigDate = await paintSignature(page);
    check('the qualifying date is painted on the cyclic month wheel — the same '
      + 'legend body the grazing periods use, because a date is a date',
    clickedDate && vcDate.legend.wheel === true && vcDate.legend.swatches === false
      && vcDate.legend.bar === false && onDate.legendWheelHasDrawing,
    JSON.stringify({ clicked: clickedDate, legend: vcDate.legend,
      drawing: onDate.legendWheelHasDrawing }));
    check('switching variable repaints the map (a determination\'s date and its '
      + 'payment months are two different pictures of one record)',
    sigDate.hash !== sig0.hash,
    `${sig0.colored} @${sig0.hash} → ${sigDate.colored} @${sigDate.hash}`);
    check('?variable=date appears, and the pressed button follows it',
      onDate.params.variable === 'date' && onDate.datePressed === 'true'
        && onDate.monthsPressed === 'false', page.url());
    check('the date legend\'s key says what the counties with no date on their '
      + 'record are doing there — most 2008–2011 determinations carry none',
    /does not carry|not recorded|undated|no date/i.test(vcDate.legend.key || ''),
    JSON.stringify((vcDate.legend.key || '').slice(0, 240)));
    check('the choice is remembered for the next visit '
      + '(sfsa-ngp-variable-eligibility)',
    onDate.stored.variable === 'date',
    'stored ' + JSON.stringify(onDate.stored.variable));

    await clickControl(page, iface.variables.months.sel);
    await settleRepaint(page);
    const backToMonths = await eligProbe(page);
    const sigBack = await paintSignature(page);
    check('going back to payment months drops ?variable and restores that paint '
      + 'bit for bit — the toggle is a restore, not a rebuild',
    backToMonths.params.variable === null && sigBack.hash === sig0.hash,
    `${sigBack.colored} @${sigBack.hash} vs ${sig0.colored} @${sig0.hash} — `
      + `?variable=${JSON.stringify(backToMonths.params.variable)}`);
    clean('eligibility variable toggle');
    await shot('22c-elig-date');
  }

  /* ── 11d. All types (worst case) ────────────────────────────────────────
     A sentinel, not a pasture type: the eligibility question a producer asks is
     usually about one forage type, but the question a reader asks of a map is
     "was this county eligible at all". Measured on the published payload at
     program year 2024: 1,022 counties are eligible under some type against 626
     under Native Pasture, and 449 counties' best determination differs. So this
     is a different map, and the counts have to move. */
  section('▸ LFP eligibility — all types (worst case)');
  {
    const before = await eligProbe(page);
    const sigOne = await paintSignature(page);
    const oneType = await iface.eligibleOracle(page);
    const chosen = await selectOption(page, iface.type.selectSel, iface.type.all.slug);
    await settleRepaint(page);
    const after = await eligProbe(page);
    const sigAll = await paintSignature(page);
    const allTypes = await iface.eligibleOracle(page);
    check('the pasture-type select offers the payload\'s fifteen types PLUS the '
      + 'all-types sentinel, and the sentinel is first',
    after.typeOptions.length === iface.type.count + 1
      && /all types/i.test(after.typeOptions[0].label),
    JSON.stringify({ n: after.typeOptions.length,
      first: after.typeOptions[0] || null }));
    check('choosing "all types (worst case)" repaints the map onto every '
      + 'determination a county has, which is a wider map than any one type',
    chosen !== null && sigAll.hash !== sigOne.hash
      && sigAll.colored > sigOne.colored,
    chosen === null ? `no option matched ${iface.type.all.slug}`
      : `${sigOne.colored} @${sigOne.hash} → ${sigAll.colored} @${sigAll.hash}`);
    if (typeof oneType === 'number' && typeof allTypes === 'number') {
      check('…and the reduction behind it really is the best across types, not '
        + 'one type relabelled',
      allTypes > oneType, `${oneType} counties under `
        + `${JSON.stringify(before.typeValue)} → ${allTypes} across all types`);
    } else {
      skip('the all-types reduction against the data',
        String(typeof oneType === 'number' ? allTypes : oneType));
    }
    check(`?type=${iface.type.all.slug} carries the sentinel — a link to the `
      + 'worst-case map has to reproduce the worst-case map',
    after.params.type !== null
      && after.params.type === iface.type.all.slug, page.url());

    await selectOption(page, iface.type.selectSel, iface.type.default);
    await settleRepaint(page);
    const home = await eligProbe(page);
    const sigHome = await paintSignature(page);
    check(`going back to ${iface.type.default} drops ?type at its default and `
      + 'restores that paint bit for bit',
    home.params.type === null && sigHome.hash === sigOne.hash,
    `${sigHome.colored} @${sigHome.hash} vs ${sigOne.colored} @${sigOne.hash} — `
      + `?type=${JSON.stringify(home.params.type)}`);
    clean('eligibility all types');
    await shot('22d-elig-all-types');
  }

  /* ── 11e. A record that ends before the app's default year ──────────────
     The FOIA archive's last program year is 2025 and the app's shared default
     year is 2026, so this is not a hypothetical: every arrival on this view
     from a default boot moves the visitor. The rule the app already follows for
     the drought monitor applies — clamp, and SAY SO — with one addition, because
     "2026 is outside this dataset" has a reason a reader deserves: FSA has not
     published those determinations yet. Both ceilings are read from the live
     decoder; the assertion is the inequality, not a literal, because the FOIA
     archive gains a program year every spring. */
  section('▸ LFP eligibility — the FOIA archive stops before the current year');
  {
    const seqWeb = await viewSeq(page);
    await clickControl(page, DS.web.sel);
    await awaitViewSeq(page, seqWeb);
    const webYears = await dataYears(page);
    const webVc = await viewControls(page);
    const webSnap = await snapshot(page);
    check('the weekly web archive re-authors the slider to its own record '
      + `(${iface.yearDomain.min}–${webYears.max}, read from the payload)`,
    webSnap.state.dataset === DS.web.id
      && webVc.yearMin === String(iface.yearDomain.min)
      && webVc.yearMax === String(webYears.max) && webVc.yearDisabled === false,
    JSON.stringify({ dataset: webSnap.state.dataset,
      slider: [webVc.yearMin, webVc.yearMax], data: webYears }));

    await slideYear(page, webYears.max);
    await settleVintage(page);
    const atLatest = await snapshot(page);
    check(`${webYears.max} is reachable on the weekly archive — it is the year `
      + 'FSA is publishing right now',
    atLatest.state.year === webYears.max,
    'state.year is ' + atLatest.state.year);

    const saidBefore = await liveText(page);
    const seqOff = await viewSeq(page);
    await clickControl(page, DS.official.sel);
    await awaitViewSeq(page, seqOff);
    const offYears = await dataYears(page);
    const offVc = await viewControls(page);
    const offSnap = await snapshot(page);
    /* The clamp announcement is DEFERRED by the app (deferAnnounce, ~350 ms
       of rest) so the reader hears one composed sentence instead of two in a
       row. Reading the region at seq-bump time races that timer — poll until
       the sentence lands or 1.8 s passes, and let the check judge whatever
       the region holds then. */
    let saidAfter = await liveText(page);
    for (let i = 0; i < 15 && (saidAfter === saidBefore
      || !iface.yearDomain.officialSays.test(saidAfter)); i++) {
      await page.waitForTimeout(120);
      saidAfter = await liveText(page);
    }
    check('switching to the FOIA archive CLAMPS the year to the last one it '
      + `covers (${offYears.max}), and re-authors the slider's ceiling with it`,
    typeof offYears.max === 'number' && offYears.max < webYears.max
      && offSnap.state.year === offYears.max
      && offVc.year === String(offYears.max)
      && offVc.yearMax === String(offYears.max),
    JSON.stringify({ webMax: webYears.max, officialMax: offYears.max,
      year: offSnap.state.year, slider: [offVc.yearMin, offVc.yearMax] }));
    check('…and the clamp is ANNOUNCED with its reason: the live region changed, '
      + 'names the year the app moved to, and says that FSA has not published '
      + 'the year the visitor asked for',
    saidAfter !== saidBefore && saidAfter.includes(String(offYears.max))
      && iface.yearDomain.clampSays.test(saidAfter)
      && iface.yearDomain.officialSays.test(saidAfter),
    `live region says ${JSON.stringify(saidAfter.slice(0, 240))} — it must name `
      + `${offYears.max} and match ${iface.yearDomain.officialSays}`);

    const seqBack2 = await viewSeq(page);
    await clickControl(page, DS.web.sel);
    await awaitViewSeq(page, seqBack2);
    const backVc = await viewControls(page);
    const backSnap = await snapshot(page);
    check('going back to the weekly archive re-authors the wider ceiling again, '
      + 'and the clamped year stays clamped — the app moved the visitor once, '
      + 'not twice',
    backSnap.state.dataset === DS.web.id
      && backVc.yearMax === String(webYears.max)
      && backSnap.state.year === offYears.max
      && offYears.max < webYears.max,
    JSON.stringify({ dataset: backSnap.state.dataset, max: backVc.yearMax,
      year: backSnap.state.year }));
    const seqOff2 = await viewSeq(page);
    await clickControl(page, DS.official.sel);
    await awaitViewSeq(page, seqOff2);
    clean('eligibility year ceiling');
  }

  /* ── 11f. The era with holes in it ──────────────────────────────────────
     2008–2011 is two different gaps in two archives, and the ramp's index-0
     slate is what both of them look like on the map. On the FOIA archive the
     era's determinations carry payment months but no qualifying date: the
     response reported when the drought BEGAN, not when a tier was satisfied,
     and for the duration tiers no satisfaction date is recoverable. So colour
     that era by date and the counties with nothing to place on the wheel take
     the slate — measured, 98 of the 247 counties with a 2010 Native Pasture
     determination — and the card has to say so in words rather than printing an
     empty row or an invented date. */
  section('▸ LFP eligibility — 2008–2011, when the record carries no date');
  {
    const U = iface.undated;
    await slideYear(page, U.year);
    await settleVintage(page);
    await clickControl(page, iface.variables.date.sel);
    await settleRepaint(page);
    const snap = await snapshot(page);
    const ramp = await dfRamp(page, iface.ramp.path);
    const hist = await paintHistogram(page);
    const dateless = await iface.datelessOracle(page);
    check(`setup: the FOIA archive at ${U.year}, coloured by qualifying date`,
      snap.state.year === U.year && snap.state.variable === 'date'
        && snap.state.dataset === U.dataset,
      JSON.stringify({ year: snap.state.year, variable: snap.state.variable,
        dataset: snap.state.dataset }));
    if (!Array.isArray(ramp)) {
      skip('the undated era takes the ramp\'s index-0 slate',
        `${iface.ramp.path} could not be read from the page`);
    } else {
      check(`the drought-factor ramp is the ${iface.ramp.steps} colours this `
        + 'view needs — five payment months and one categorical step for a '
        + 'determination with no month count',
      ramp.length === iface.ramp.steps
        && ramp.every((c) => /^#[0-9a-f]{6}$/.test(c)),
      JSON.stringify(ramp));
      const slate = ramp[0];
      const painted = hist[slate] || 0;
      if (typeof dateless !== 'number') {
        skip('the undated counties take the slate', String(dateless));
      } else {
        check('every county whose best determination carries no date takes the '
          + `ramp's index-0 slate (${slate}) and no other county does — a date `
          + 'the record does not have is not a date to invent',
        painted > 0 && painted === dateless,
        `${painted} counties painted ${slate}, ${dateless} dateless AND drawn `
          + `(${await iface.datelessAllOracle(page)} dateless in the reduction, `
          + `polygon or not); histogram ${JSON.stringify(hist)}`);
      }
    }

    /* And the card, on one of the counties that has no date to show. */
    let saidIt = null;
    for (const id of U.probeCounties) {
      /* eslint-disable no-await-in-loop */
      const ok = await page.evaluate(async (countyId) => {
        const app = await import(new URL('js/app.js', document.baseURI).href);
        app.ngpContext().selectCounty(countyId);
        return true;
      }, id).catch(() => false);
      if (!ok) continue;
      await page.waitForFunction(
        () => !document.getElementById('county-card').hidden,
        null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(300);
      const text = await page.evaluate(
        () => (document.getElementById('card-rows').textContent || '').trim());
      if (U.says.test(text)) { saidIt = { id, text }; break; }
      saidIt = saidIt || { id, text };
      /* eslint-enable no-await-in-loop */
    }
    check('the card SAYS the date is not on the record, in words, rather than '
      + 'leaving the row empty',
    !!saidIt && U.says.test(saidIt.text),
    saidIt ? `county ${saidIt.id} card reads ${JSON.stringify(saidIt.text.slice(0, 200))}`
      : 'none of the probe counties could be selected');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await shot('22e-elig-undated');
    clean('eligibility undated era');

    /* Put the view back where the template found it: the default variable, the
       year it arrived on (which is the clamped one), and the FOIA archive. */
    await clickControl(page, iface.variables.months.sel);
    await settleRepaint(page);
    await slideYear(page, entryYear);
    await settleVintage(page);
    const restored = await snapshot(page);
    check('setup: the view is back on payment months at the year the section '
      + 'arrived on, so the card, table and poster below read a real '
      + 'determination',
    restored.state.year === entryYear && restored.state.variable === 'months',
    JSON.stringify({ year: restored.state.year,
      variable: restored.state.variable, wanted: entryYear }));
  }
}

section('▸ View eligibility — LFP eligibility, end to end');
{
  /* A FRESH context, opened for downloads so the template's export step runs,
     and the boot resource list read BEFORE anything is switched. */
  const s = await open({ downloads: true });
  check('the eligibility page reaches ngpReady on the boot payload', s.ready);
  s.clean('eligibility section boot');
  const bootResources = await resourceNames(s.page);
  await verifyInterfaceSection(ELIG, {
    session: s, bootResources, extraChecks: eligExtraChecks,
  });
  await s.ctx.close();
}

/* ══════════════════════════════════════════════════════════════════════════
   12. DEEP LINK ?view=eligibility&year=2024&type=native-pasture&county=30063

   A determination, shared. Every param honoured on LOAD rather than by
   replaying the clicks that would have produced it — and the card is the point
   here: the whole ladder of one real determination, measured against the
   published payload rather than described.
   ══════════════════════════════════════════════════════════════════════════ */

section(`▸ Deep link ${ELIG.deepLink}`);
{
  const E = ELIG.deepLinkExpect;
  const s = await open({ query: ELIG.deepLink });
  const { page } = s;
  check('the deep-linked eligibility page reaches ngpReady', s.ready);

  const snap = await snapshot(page);
  const vc = await viewControls(page);
  const p = await eligProbe(page);
  const years = await dataYears(page);
  const card = await page.evaluate(() => ({
    open: !document.getElementById('county-card').hidden,
    title: (document.getElementById('card-title').textContent || '').trim(),
    terms: Array.from(document.querySelectorAll('#card-rows dt'))
      .map((n) => (n.textContent || '').trim()),
    values: Array.from(document.querySelectorAll('#card-rows dd'))
      .map((n) => (n.textContent || '').trim()),
    figure: !!document.querySelector('#card-content figure svg'),
    caption: (document.querySelector('#card-content figcaption')?.textContent || '').trim(),
    twinRows: document.querySelectorAll('#card-content details tbody tr').length,
  }));

  check('?view=eligibility boots straight onto the eligibility view: the marker, '
    + 'the pressed switcher button, and only its own drawer sections',
  snap.markers.ngpView === ELIG.slug && snap.state.view === ELIG.slug
    && vc.views.length === 1 && vc.views[0] === ELIG.slug
    && vc.sections.every((sec) => (sec.view === ELIG.slug) === !sec.hidden),
  JSON.stringify({ marker: snap.markers.ngpView, pressed: vc.views,
    sections: vc.sections }));
  check(`the year is ${E.year}, inside the FOIA archive's own domain `
    + `(${ELIG.yearDomain.min}–${years.max}), on the ${E.vintage} boundaries `
    + 'that were in force for it',
  vc.year === String(E.year) && vc.yearMin === String(ELIG.yearDomain.min)
    && snap.vintage === E.vintage && snap.state.year === E.year,
  JSON.stringify({ year: vc.year, domain: [vc.yearMin, vc.yearMax],
    vintage: snap.vintage }));
  check('the pasture-type slug resolved against the eligibility dictionary — a '
    + 'slug means whatever the ACTIVE view\'s dictionary says it means',
  snap.state.type === E.type, JSON.stringify(snap.state.type));
  check('the three defaults stay out of a deep link: no ?dataset for the FOIA '
    + 'archive, no ?variable for payment months, and no ?source at all (there '
    + 'is no aggregation to name on an FSA determination)',
  p.params.dataset === null && p.params.variable === null
    && p.params.source === null, page.url());
  check('the swatches legend is the visible body, and neither continuous one is',
    vc.legend.swatches === true && vc.legend.wheel === false
      && vc.legend.bar === false, JSON.stringify(vc.legend));
  check(`the card is open on the linked county and reads out the whole ladder of `
    + `one real determination — ${E.event}, qualifying ${E.date}, `
    + `${E.months} payment months against a cap of ${E.mepm}`,
  card.open && card.title.includes(ELIG.county.name)
    && card.values.some((v) => v.includes(E.event))
    && card.values.some((v) => v.includes(E.date))
    && card.values.some((v) => new RegExp(`\\b${E.months}\\b`).test(v)),
  JSON.stringify({ title: card.title, terms: card.terms, values: card.values }));
  check('the card\'s picture is drawn and carries its accessible twin — a bar '
    + 'per program year, and the same years in a table',
  card.figure && card.caption.length > 20 && card.twinRows > 5,
  JSON.stringify({ figure: card.figure, caption: card.caption.slice(0, 160),
    twinRows: card.twinRows }));
  const painted = await paintSignature(page);
  const expect = await ELIG.paintOracle(page);
  if (typeof expect === 'number') {
    check('the choropleth painted for the deep-linked year and type, county for '
      + 'county', painted.colored === expect,
    `${painted.colored} painted, ${expect} expected`);
  } else {
    skip('the deep-linked determination painted the counties it reaches',
      String(expect));
  }
  s.clean('eligibility deep link');
  await s.shot('23-elig-deep-link');
  await s.ctx.close();
}

/* ══════════════════════════════════════════════════════════════════════════
   13. ?variable= IS VALIDATED AGAINST THE ACTIVE VIEW'S REGISTRY.

   Two views now paint different variables of different data, and `?variable=`
   is one param. `duration` is a grazing period's length in weeks and means
   nothing to a determination; `months` is a payment count and means nothing to
   a grazing period. Neither may be accepted by the view that does not have it —
   an unrecognised variable that survives validation paints a blank map under a
   legend for a scale nobody selected — and neither may be REJECTED by the view
   that does, which is the half a one-way check would miss.

   The app warns on the console when it drops a value it cannot use; a warning
   is not an error, so the console-clean gate deliberately does not police it.
   What is asserted here is the observable fallback.

   The POSITIVE case for each view is asserted elsewhere, which is what keeps
   these two checks from passing on an app that simply ignores `?variable=`: §2's
   deep link boots the grazing periods on `?variable=start` and holds the wheel
   to it, and §11c drives eligibility onto `?variable=date` through its own seg
   button and back again.
   ══════════════════════════════════════════════════════════════════════════ */

section('▸ ?variable= belongs to the view that has it');
{
  const NGP = CONFIG.interfaces.ngp;
  const alien = ELIG.variables.alien;
  const s = await open({ query: `?view=${ELIG.slug}&variable=${alien}` });
  const snap = await snapshot(s.page);
  const vc = await viewControls(s.page);
  const p = await eligProbe(s.page);
  check(`?variable=${alien} on the eligibility view falls back to its own `
    + `default (${ELIG.variables.default}) instead of painting a scale this `
    + 'view does not have',
  snap.state.view === ELIG.slug
    && snap.state.variable === ELIG.variables.default
    && vc.legend.swatches === true && p.monthsPressed === 'true',
  JSON.stringify({ view: snap.state.view, variable: snap.state.variable,
    legend: vc.legend, pressed: p.monthsPressed }));
  check('…and the value it could not use is gone from the URL rather than left '
    + 'there to be shared again',
  !new URL(s.page.url()).searchParams.has('variable'), s.page.url());
  s.clean('alien variable on eligibility');
  await s.ctx.close();

  const s2 = await open({ query: '?variable=months' });
  const snap2 = await snapshot(s2.page);
  const vc2 = await viewControls(s2.page);
  check('and the same in reverse: ?variable=months on the grazing periods falls '
    + 'back to duration — that view keeps its own three variables, none of '
    + 'which is a payment count',
  snap2.state.view === NGP.slug && snap2.state.variable === 'duration'
    && vc2.legend.bar === true && vc2.legend.swatches === false,
  JSON.stringify({ view: snap2.state.view, variable: snap2.state.variable,
    legend: vc2.legend }));
  check('…and that value is gone from the URL too — a param the app could not '
    + 'use is not a param to keep',
  !new URL(s2.page.url()).searchParams.has('variable'), s2.page.url());
  s2.clean('alien variable on the grazing periods');
  await s2.ctx.close();
}

/* ══════════════════════════════════════════════════════════════════════════
   14. THE DISASTER DESIGNATIONS — the fourth interface, and the last.

   The broader declarations around the program — and, on this map, ONE slice of
   them: the Secretarial designations for drought, which is the corner of the
   archive the other three views are about. It is the only view in the app with
   one archive and no controls of its own: no dataset seg, no `?dataset`, and
   since the map was narrowed to its slice, no params at all. Everything
   structural is the section template again; what is below is what this view
   adds, and each of these is a claim a screenshot cannot make:

     · NO CONTROLS OF ITS OWN, which is now a fact to assert rather than a gap
       to overlook: no drawer section belonging to this view, no `?decl`/
       `?disaster` in the URL, and neither of the two preference keys those
       controls used to write.
     · THE ARCHIVE'S JUNK IS THE ARCHIVE'S TEXT. 72 of 3,306 county keys are the
       FSA portal's internal codes for tribal lands rather than FIPS codes. They
       reach no boundary, so they are counted out loud and left off the map — and
       they appear in the data table spelled exactly as the source spells them,
       because that table is the archive and not a cleanup of it.
     · A YEAR DICTIONARY WITH TWO NON-YEARS IN IT ("0" and "2011, 2012"), which
       must not become a slider position.
   ══════════════════════════════════════════════════════════════════════════ */

const DIS = CONFIG.interfaces.disasters;

/** Flattened for the in-page probe: RegExps do not survive Playwright's
    serialisation, so only strings cross and every pattern is applied in Node.
    What crosses now is the list of things that must NOT be there — the two
    retired sections, the two retired params and the two retired preference keys
    (tools/config.mjs § slice). */
const DIS_SELS = {
  retiredSections: DIS.slice.retiredSections,
  retiredParams: DIS.slice.retiredParams,
  retiredKeys: DIS.slice.retiredKeys,
};

/**
 * Everything the designation view says about itself in one round trip: which of
 * its own drawer sections are in the page (none), which params it emits (none
 * of its own), what it left in localStorage (nothing of its own) — plus the card
 * and the table, which on this view are the two places the archive's own text
 * has to survive.
 *
 * A missing element comes back as `null`/`false` rather than throwing: the
 * checks that need it then fail by name instead of ending the run.
 */
const disProbe = (page) => page.evaluate((s) => {
  const el = (q) => document.querySelector(q);
  const text = (n) => (n ? (n.textContent || '').trim() : null);
  const url = new URL(location.href);
  const ls = (k) => {
    try { return localStorage.getItem(k); } catch (e) { return 'unavailable'; }
  };
  const tbody = el('#table-modal-body tbody');
  return {
    /** Any drawer section still claiming this view, by id — the empty list is
        the assertion. */
    ownSections: Array.from(
      document.querySelectorAll('.sfsa-drawer-scroll [data-view="disasters"]'))
      .map((n) => n.id || '(unnamed)'),
    /** Any of the retired controls still in the document at all, hidden or not. */
    retiredSections: s.retiredSections.filter((q) => !!el(q)),
    /** Retired params that are nonetheless in the URL, and retired preference
        keys that something is nonetheless writing. */
    retiredParams: s.retiredParams.filter((k) => url.searchParams.has(k)),
    retiredKeys: s.retiredKeys.filter((k) => ls(k) !== null
      && ls(k) !== 'unavailable'),
    params: {
      view: url.searchParams.get('view'),
      decl: url.searchParams.get('decl'),
      disaster: url.searchParams.get('disaster'),
      dataset: url.searchParams.get('dataset'),
      year: url.searchParams.get('year'),
      county: url.searchParams.get('county'),
      week: url.searchParams.get('week'),
      type: url.searchParams.get('type'),
      variable: url.searchParams.get('variable'),
    },
    swatchLabels: Array.from(
      document.querySelectorAll('#legend-swatches .sfsa-legend-item'))
      .map((n) => text(n)),
    card: {
      open: !document.getElementById('county-card').hidden,
      title: text(document.getElementById('card-title')),
      terms: Array.from(document.querySelectorAll('#card-rows dt')).map(text),
      values: Array.from(document.querySelectorAll('#card-rows dd')).map(text),
      body: text(document.getElementById('card-content')),
      /* A list, not a chart: this view's per-declaration entries are semantic
         markup, which is its own accessible twin — so there is no <figure> to
         pair with a <figcaption>, and the thing to count is list items. */
      items: document.querySelectorAll('#card-content li').length,
      figures: document.querySelectorAll('#card-content figure').length,
    },
    table: {
      open: !!(document.getElementById('table-modal')
        && document.getElementById('table-modal').open),
      headers: Array.from(document.querySelectorAll('#table-modal-body thead th'))
        .map(text),
      rows: document.querySelectorAll('#table-modal-body tbody tr').length,
      caption: text(document.getElementById('table-modal-caption')),
      body: tbody ? (tbody.textContent || '') : '',
    },
  };
}, DIS_SELS);

/**
 * The disaster designations' own controls — step 6 of the section template.
 *
 * Here rather than in the probe table for the documented reason: every check
 * below needs the paint-signature, marker and live-region probes in this file,
 * and tools/config.mjs must not assert. Every selector, fixture and measured
 * count it reads is in that entry.
 *
 * It LEAVES THE VIEW AT THE FIXTURE YEAR, deliberately, because the template's
 * card, table and poster steps run after it: the app's shared default year is
 * 2026 and Missoula has no designation in 2026 at all, so a card opened there
 * would assert the empty half of the card. Every other piece of state is put
 * back at its default before this returns.
 */
async function disastersExtraChecks({ page, check, skip, clean, shot, iface }) {
  const F = iface.fixture;

  /* ── 14a. The switcher is complete, and this view has nothing to toggle ──
     Four views is the whole story the app set out to tell: the drought, the
     window it has to fall inside, the determination the two produce, and the
     declarations around it. And this one has NO CONTROLS OF ITS OWN — it is the
     Secretarial drought slice of its archive, and a slice is not a selection —
     so the absence is the assertion: no drawer section claiming this view, no
     dataset seg, no `?dataset`, neither of the two params its retired segs used
     to emit, and neither of the two preference keys they used to write. A
     control that does not exist must leave nothing behind that says it does. */
  section('▸ Disaster designations — the switcher is complete');
  {
    const vc = await viewControls(page);
    const p = await disProbe(page);
    const views = Object.keys(CONFIG.interfaces).length;
    check(`the view switcher offers all ${views} interfaces with this one pressed `
      + '— the four acts of the program, in the order the story reads them',
    vc.viewBtns === views && vc.views.length === 1
      && vc.views[0] === iface.slug,
    `${vc.viewBtns} button(s) in play, pressed ${JSON.stringify(vc.views)}`);
    check('this view has NO controls of its own beyond the shared year — it IS '
      + 'the Secretarial drought slice of its archive: no drawer section, no '
      + 'dataset seg, no ?dataset, and neither of the two params its retired '
      + 'segs used to emit',
    vc.datasetBtns === 0 && p.params.dataset === null
      && p.ownSections.length === 0 && p.retiredSections.length === 0
      && p.retiredParams.length === 0,
    JSON.stringify({ datasetBtns: vc.datasetBtns, dataset: p.params.dataset,
      sections: p.ownSections, retiredSections: p.retiredSections,
      retiredParams: p.retiredParams, url: page.url() }));
    check('…and it writes neither of the retired preference keys — a stored '
      + 'value for a control nobody can see would come back as a slice the next '
      + 'visitor did not choose',
    p.retiredKeys.length === 0,
    'still written: ' + JSON.stringify(p.retiredKeys));
    const key = vc.legend.key || '';
    check('the legend key names all three colours in words: named directly in a '
      + 'designation, a contiguous neighbour with the same access, and not '
      + 'designated at all',
    iface.legend.keySays.test(key) && iface.legend.keyAlsoSays.test(key)
      && iface.legend.keyNoDataSays.test(key),
    JSON.stringify(key.slice(0, 260)));
    check('each role chip carries its meaning and not just its name — a '
      + 'red/orange scheme has nothing left in grayscale',
    p.swatchLabels.length >= 3
      && p.swatchLabels.slice(0, 2).every((t) => (t || '').length > 10),
    JSON.stringify(p.swatchLabels));
    clean('disasters switcher and legend');
  }

  /* ── 14b. A year dictionary with two non-years in it ─────────────────────
     `years` ships 17 strings and two of them are not years: "0" (one
     Presidential declaration, 84 county rows) and "2011, 2012" (one Secretarial
     declaration, 10 rows). Whether the second contributes a 2011 to the domain
     is a judgement the payload does not settle, so what is asserted is what is
     not a judgement: the slider is exactly the decoder's own domain, its floor
     is a year rather than a zero, and the domain has no holes. */
  section('▸ Disaster designations — the archive\'s years, and its two non-years');
  {
    const vc = await viewControls(page);
    const years = await dataYears(page);
    const floors = [iface.yearDomain.min, iface.yearDomain.minIfJunkYearDropped];
    check('the year slider is re-authored to the designation record: the floor is '
      + `${floors.join(' or ')} (the two readings of the unparseable `
      + `"${iface.yearDomain.junkYears[1]}" string) and the ceiling is read from `
      + 'the payload rather than typed into a harness',
    vc.yearMin === String(years.min) && vc.yearMax === String(years.max)
      && floors.includes(years.min) && vc.yearDisabled === false,
    JSON.stringify({ slider: [vc.yearMin, vc.yearMax], data: years,
      accepted: floors }));
    check('and the two strings that are not years never become slider positions: '
      + 'the domain is contiguous, and its floor is a program year rather than '
      + `${JSON.stringify(iface.yearDomain.junkYears[0])}`,
    typeof years.min === 'number' && typeof years.max === 'number'
      && years.n === years.max - years.min + 1,
    JSON.stringify(years));

    const snap = await snapshot(page);
    check('arriving here does not move the visitor: the shared year is inside '
      + 'this archive\'s own domain — it is scraped weekly, so it covers the '
      + 'program year in progress — and the slider agrees with it',
    snap.state.year >= years.min && snap.state.year <= years.max
      && vc.year === String(snap.state.year),
    JSON.stringify({ year: snap.state.year, slider: vc.year, domain: years }));
    clean('disasters year domain');
  }

  /* ── 14c. The fixture year, and what the map owes the data ───────────────
     2026 is where a default boot lands and Missoula has no designation in it;
     2021 is the year every count below was measured against, and the year the
     template's card and table steps will read. */
  section('▸ Disaster designations — the designations of one program year');
  {
    await slideYear(page, F.year);
    await settleVintage(page);
    const snap = await snapshot(page);
    const p = await disProbe(page);
    const join = await iface.joinOracle(page);
    const fixtureSig = await paintSignature(page);
    /* The absence chip on this view NAMES THE YEAR ("No designation in 2021"),
       and the year is the only control it has: a chip left on the year the map
       booted at would be telling a reader the gray counties are gray for a
       reason that belongs to a different map. */
    const chip = p.swatchLabels[p.swatchLabels.length - 1] || '';
    check(`setup: ${F.year} on the ${F.vintage} boundaries that were in force `
      + 'for it, with the legend\'s absence chip naming that same year',
    snap.state.year === F.year && snap.vintage === F.vintage
      && chip.includes(String(F.year)),
    JSON.stringify({ year: snap.state.year, vintage: snap.vintage, chip }));
    if (join.error) {
      skip('the designations painted for the fixture year', String(join.error));
    } else {
      check(`the archive's own numbers reached the map: ${F.rows} county rows `
        + `under ${F.declarations} declarations, ${F.fips} FIPS keys, `
        + `${F.designated} FSA counties (${F.primary} Primary, ${F.contiguous} `
        + 'Contiguous) — recomputed here from the published payload rather than '
        + 'from the decoder that painted it',
      join.rows === F.rows && join.declarations === F.declarations
        && join.fips === F.fips && join.designated === F.designated
        && join.primary === F.primary && join.contiguous === F.contiguous,
      JSON.stringify({ rows: join.rows, declarations: join.declarations,
        fips: join.fips, designated: join.designated, primary: join.primary,
        contiguous: join.contiguous, expected: F }));
      check('every FSA county a designation reaches carries a colour, and no '
        + 'county without one does',
      fixtureSig.colored === join.painted,
      `${fixtureSig.colored} painted, ${join.painted} expected`);

      /* The live region: two counts and a denominator, because the canvas has no
         text and "some of the country is red" is not a reading. */
      const said = await settledLiveText(page,
        (t) => saysCount(t, join.primary) || saysCount(t, join.primaryPainted));
      const namesPrimary = saysCount(said, join.primary)
        || saysCount(said, join.primaryPainted);
      const namesContiguous = saysCount(said, join.contiguous)
        || saysCount(said, join.contiguousPainted);
      check('the announcement counts the counties named directly and the '
        + `neighbours separately (${join.primary} Primary, ${join.contiguous} `
        + 'Contiguous) — the roles are not the same access to the same programs, '
        + 'and a screen-reader visitor has only this sentence',
      namesPrimary && namesContiguous,
      `live region says ${JSON.stringify(said.slice(0, 240))} — expected `
        + `${join.primary}/${join.primaryPainted} primary and `
        + `${join.contiguous}/${join.contiguousPainted} contiguous`);

      /* The rows that reach no boundary at all — the archive's junk keys plus
         any real county the vintage's crosswalk cannot place. */
      const j = iface.junk;
      check(`the ${join.unmatched} county key(s) the crosswalk cannot reach are `
        + 'COUNTED out loud rather than dropped — at this year they are the FSA '
        + 'portal\'s own four-digit codes for tribal lands '
        + `(${j.fipsKeys.join(', ')}), which are not FIPS codes and match no `
        + 'county boundary',
      join.unmatched === j.rows && j.unmatchedSays.test(said)
        && (saysCount(said, join.unmatched) || saysCount(said, join.unmatchedRows)),
      `oracle says ${join.unmatched} key(s) / ${join.unmatchedRows} row(s) `
        + `${JSON.stringify(join.unmatchedSample)}; live region `
        + JSON.stringify(said.slice(0, 240)));
      check('…and they are off the MAP, not painted grey by accident: the painted '
        + 'count is the reachable counties and nothing else',
      join.painted <= join.designated
        && join.designated - join.unmatched <= join.geometry,
      JSON.stringify({ designated: join.designated, painted: join.painted,
        unmatched: join.unmatched, geometry: join.geometry }));
    }
    clean('disasters fixture year');
    await shot('25-disasters-fixture');
  }

  /* ── 14d. The archive's own text, verbatim ───────────────────────────────
     The data table on this view is not a cleaned view of the archive; it IS the
     archive, spelled the way the portal spells it. The two rows below are the
     whole junk population of the fixture slice: reservations the portal keys
     with a four-digit code and names in the county column. They are off the map
     (nothing can place them) and in the table (the archive says them), and a
     table that quietly dropped them would be the more comfortable lie. */
  section('▸ Disaster designations — the archive\'s own text, verbatim');
  {
    await page.locator('#btn-table').click();
    await page.waitForFunction(
      () => document.getElementById('table-modal').open
        && document.querySelectorAll('#table-modal-body tbody tr').length > 0,
      null, { timeout: CONFIG.switchMs }).catch(() => {});
    const p = await disProbe(page);
    const cols = iface.table.columns;
    check(`the table is a record per row, not a value: ${cols.length} columns — `
      + cols.join(', '),
    cols.every((c, i) => (p.table.headers[i] || '').toLowerCase()
      .includes(c.toLowerCase())),
    JSON.stringify(p.table.headers));
    const found = iface.junk.atFixture.filter((r) => p.table.body.includes(r.county)
      && p.table.body.includes(r.fips) && p.table.body.includes(r.state));
    check('the malformed county keys are in the table exactly as the archive '
      + `spells them — ${iface.junk.atFixture
        .map((r) => `${r.county} (${r.fips}, ${r.state})`).join(' and ')} — `
      + 'because this table is the source, and a designation nobody can map is '
      + 'still a designation somebody received',
    found.length === iface.junk.atFixture.length,
    `${found.length} of ${iface.junk.atFixture.length} found in `
      + `${p.table.rows} rows`);
    check('a date the source never reported prints as an em-dash rather than as '
      + 'an empty cell — 103,757 of these rows have no end date at all',
    p.table.body.includes(iface.table.nullDate),
    JSON.stringify(p.table.caption));
    check('the caption says which slice of the archive this is: the year, the '
      + 'instrument, the scope, and how many designations under how many '
      + 'declarations',
    /\b2021\b/.test(p.table.caption || '')
      && /secretarial/i.test(p.table.caption || '')
      && /drought/i.test(p.table.caption || '')
      && /declaration/i.test(p.table.caption || ''),
    JSON.stringify(p.table.caption));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('table-modal').open,
      null, { timeout: 5000 }).catch(() => {});
    clean('disasters verbatim table');
    await shot('25b-disasters-table');
  }
}

section('▸ View disasters — the disaster designations, end to end');
{
  /* A FRESH context, opened for downloads so the template's export step runs,
     and the boot resource list read BEFORE anything is switched. */
  const s = await open({ downloads: true });
  check('the designations page reaches ngpReady on the boot payload', s.ready);
  s.clean('disasters section boot');
  const bootResources = await resourceNames(s.page);
  await verifyInterfaceSection(DIS, {
    session: s, bootResources, extraChecks: disastersExtraChecks,
  });
  await s.ctx.close();
}

/* ══════════════════════════════════════════════════════════════════════════
   15. DEEP LINK ?view=disasters&year=2021&county=30063 (+ two retired params)

   A designation, shared. Every param honoured on LOAD rather than by replaying
   the clicks that would have produced it — and the card is the point here,
   because on this view the card is a LIST rather than a chart: one entry per
   declaration that touched the county that year, with the role in words beside
   the colour, and the dates as the archive has them (which for all six of these
   means an incident that was never given an end).

   The link also carries `?decl=presidential&disaster=all`, which is what a
   bookmark made before this map was narrowed to its one slice looks like. They
   must do NOTHING: no control reads them, and the boot's own pushState leaves
   them out of the address bar (tools/config.mjs § deepLink says why they are
   here).
   ══════════════════════════════════════════════════════════════════════════ */

section(`▸ Deep link ${DIS.deepLink}`);
{
  const E = DIS.deepLinkExpect;
  const C = DIS.fixture.county;
  const s = await open({ query: DIS.deepLink });
  const { page } = s;
  check('the deep-linked designations page reaches ngpReady', s.ready);

  const snap = await snapshot(page);
  const vc = await viewControls(page);
  const p = await disProbe(page);
  const years = await dataYears(page);

  check('?view=disasters boots straight onto the designations: the marker, the '
    + 'pressed switcher button, and only its own drawer sections',
  snap.markers.ngpView === DIS.slug && snap.state.view === DIS.slug
    && vc.views.length === 1 && vc.views[0] === DIS.slug
    && vc.sections.every((sec) => (sec.view === DIS.slug) === !sec.hidden),
  JSON.stringify({ marker: snap.markers.ngpView, pressed: vc.views,
    sections: vc.sections }));
  check(`the year is ${E.year}, inside the archive's own domain `
    + `(${years.min}–${years.max}), on the ${E.vintage} boundaries that were in `
    + 'force for it',
  vc.year === String(E.year) && snap.state.year === E.year
    && snap.vintage === E.vintage,
  JSON.stringify({ year: vc.year, domain: [vc.yearMin, vc.yearMax],
    vintage: snap.vintage }));
  check('the two RETIRED params this link carries are DROPPED rather than '
    + 'honoured — ?decl=presidential and ?disaster=all are gone from the address '
    + 'bar, and no ?dataset joined them (one archive), so the link a visitor '
    + 'copies next describes the map they are looking at',
  p.params.decl === null && p.params.disaster === null
    && p.params.dataset === null && p.retiredParams.length === 0, page.url());
  check('the swatches legend is the visible body, and neither continuous one is',
    vc.legend.swatches === true && vc.legend.wheel === false
      && vc.legend.bar === false, JSON.stringify(vc.legend));
  check(`the card is open on the linked county and says its role in WORDS — `
    + `${E.role}, because a county named directly in any designation is a `
    + 'Primary county however many neighbouring roles it also holds',
  p.card.open && (p.card.title || '').includes(DIS.county.name)
    && [...p.card.values, p.card.body || ''].some((v) => (v || '')
      .includes(E.role)),
  JSON.stringify({ title: p.card.title, terms: p.card.terms,
    values: p.card.values }));
  check(`the card reads out all ${C.designations} designations that touched the `
    + `county in ${E.year} — one entry per declaration `
    + `(${C.numbers.join(', ')}), not a count and not the best one`,
  C.numbers.every((n) => (p.card.body || '').includes(n))
    && p.card.items >= C.designations,
  JSON.stringify({ items: p.card.items, missing: C.numbers
    .filter((n) => !(p.card.body || '').includes(n)),
  body: (p.card.body || '').slice(0, 260) }));
  check('every entry carries its role as a word beside the colour — this county '
    + `is ${C.primary} Primary and ${C.contiguous} Contiguous in the same year, `
    + 'which a hue-only chip could not tell a reader',
  /Primary/.test(p.card.body || '') && /Contiguous/.test(p.card.body || ''),
  JSON.stringify((p.card.body || '').slice(0, 260)));
  check('an incident the archive never gave an end date is SAID to be open '
    + 'rather than left blank or invented — all six of these are',
  C.endSays.test(p.card.body || ''),
  JSON.stringify((p.card.body || '').slice(0, 300)));
  check('the card\'s list is its own accessible twin: semantic markup, so there '
    + 'is no canvas here to caption',
  p.card.items > 0 && p.card.figures === 0,
  JSON.stringify({ items: p.card.items, figures: p.card.figures }));
  const painted = await paintSignature(page);
  const expect = await DIS.paintOracle(page);
  if (typeof expect === 'number') {
    check('the choropleth painted for the deep-linked year and slice, county for '
      + 'county', painted.colored === expect,
    `${painted.colored} painted, ${expect} expected`);
  } else {
    skip('the deep-linked designations painted the counties they reach',
      String(expect));
  }
  s.clean('disasters deep link');
  await s.shot('26-disasters-deep-link');
  await s.ctx.close();
}

/* ══════════════════════════════════════════════════════════════════════════
   16. FOUR VIEWS, FOUR MEMORIES — an excursion changes nothing it did not
   touch, now across all four.

   §10 proved this for two. Three views was the first honest test of it — the
   eligibility view has four pieces of state of its own (archive, aggregation,
   pasture type, variable), and the MIDDLE of a multi-stop trip is where a
   "remember the last view" implementation passes a two-view test and loses the
   first view's state on the way home. Four is the whole switcher, and the fourth
   view adds the case the other three cannot make: it has NO state of its own at
   all — one archive, one slice, no params — so what it proves is the other half
   of the claim. The shared state (the county, the camera, the year) has to
   survive a stop there, and none of the other three views' five params may.
   ══════════════════════════════════════════════════════════════════════════ */

section('▸ Four views, four memories');
{
  const NGP = CONFIG.interfaces.ngp;
  const USDM = CONFIG.interfaces.usdm;
  const s = await open();
  const { page } = s;
  check('the four-view page reaches ngpReady', s.ready);

  /* 1 · Put the grazing periods somewhere no default could be mistaken for. */
  await slideYear(page, 2012);
  await settleVintage(page);
  await page.locator('#btn-var-start').click();
  await page.waitForTimeout(300);
  const seq0 = await viewSeq(page);
  await clickControl(page, NGP.datasets.nclimgrid.sel);
  await awaitViewSeq(page, seq0);
  const ngpBefore = await viewControls(page);
  const ngpSnapBefore = await snapshot(page);

  /* 2 · The drought monitor, on its own dataset and its own week. */
  const seq1 = await viewSeq(page);
  const toUsdm = await clickControl(page, USDM.switchSel);
  const onUsdm = toUsdm && await awaitViewSeq(page, seq1);
  const seq2 = await viewSeq(page);
  await clickControl(page, USDM.datasets.reported.sel);
  await awaitViewSeq(page, seq2);
  await scrubWeek(page, 8);
  await settleWeek(page);
  const usdmBefore = await weekProbe(page);

  /* 3 · Eligibility, on all four of its own pieces of state. */
  const seq3 = await viewSeq(page);
  const toElig = await clickControl(page, ELIG.switchSel);
  const onElig = toElig && await awaitViewSeq(page, seq3);
  const seq4 = await viewSeq(page);
  await clickControl(page, ELIG.datasets.derived.sel);
  await awaitViewSeq(page, seq4);
  const conv = ELIG.source.conventions[1];
  await selectOption(page, ELIG.source.selectSel, conv.id);
  await settleRepaint(page);
  await selectOption(page, ELIG.type.selectSel, ELIG.type.all.slug);
  await settleRepaint(page);
  await clickControl(page, ELIG.variables.date.sel);
  await settleRepaint(page);
  const eligBefore = await eligProbe(page);
  const eligSnapBefore = await snapshot(page);
  check('setup: the first three views are somewhere distinctive — the grazing '
    + 'periods on the climatology coloured by season start, the drought monitor '
    + 'on the NDMC-reported set at week 8, and eligibility on the derived '
    + `archive's ${conv.label} aggregation, all types, coloured by date`,
  onUsdm && onElig && ngpBefore.datasets[0] === 'nclimgrid'
    && eligSnapBefore.state.dataset === 'derived'
    && eligSnapBefore.state.variable === 'date'
    && eligBefore.params.source !== null,
  JSON.stringify({ onUsdm, onElig, ngp: ngpBefore.datasets,
    elig: eligBefore.params }));
  check('while eligibility is on screen the URL carries ITS params and nobody '
    + 'else\'s — no ?week from the drought monitor, and ?dataset naming the '
    + 'archive this view is reading',
  eligBefore.params.week === null && eligBefore.params.dataset === 'derived'
    && eligBefore.params.view === ELIG.slug, page.url());

  /* 4 · The designations, which have NOTHING of their own to set: one archive,
         one slice, no params. That is the case the other three cannot make —
         this is the stop where a pushState that emits whatever it last knew
         about shows up, because there is nothing here that could legitimately
         be in the URL besides the shared state. */
  const seqD = await viewSeq(page);
  const toDis = await clickControl(page, DIS.switchSel);
  const onDis = toDis && await awaitViewSeq(page, seqD);
  const disBefore = await disProbe(page);
  check('while the designations are on screen the URL carries NONE of the other '
    + 'three views\' five params — no ?dataset (there is one archive), no ?week, '
    + 'no ?source, no ?type, no ?variable — and none of its own either, because '
    + 'it has none',
  onDis && disBefore.params.dataset === null && disBefore.params.week === null
    && disBefore.params.type === null && disBefore.params.variable === null
    && !new URL(page.url()).searchParams.has('source')
    && disBefore.retiredParams.length === 0
    && disBefore.params.view === DIS.slug, page.url());

  /* 5 · Home the long way round: designations → drought monitor → grazing
         periods, then back out through eligibility to the designations. Each
         stop has to be the state its own visitor left, not the state the
         previous stop implies. */
  const seq5 = await viewSeq(page);
  await clickControl(page, USDM.switchSel);
  await awaitViewSeq(page, seq5);
  const usdmAgain = await weekProbe(page);
  check('the drought monitor comes back to the county set and the week it was '
    + 'left on, three stops later',
  usdmAgain.datasetParam === 'reported'
    && usdmAgain.weekParam === usdmBefore.weekParam
    && !!weekNumber(usdmBefore.out)
    && weekNumber(usdmAgain.out)?.n === weekNumber(usdmBefore.out)?.n,
  JSON.stringify({ dataset: usdmAgain.datasetParam,
    week: [usdmBefore.weekParam, usdmAgain.weekParam] }));

  const seq6 = await viewSeq(page);
  await clickControl(page, NGP.switchSel);
  await awaitViewSeq(page, seq6);
  const ngpAgain = await viewControls(page);
  const ngpSnapAgain = await snapshot(page);
  check('the grazing periods come back exactly as they were left — the '
    + 'climatology, its own season dictionary, the start variable and the '
    + 'disabled year slider under its note — after an excursion through three '
    + 'other views',
  ngpAgain.datasets[0] === 'nclimgrid' && ngpAgain.type === ngpBefore.type
    && ngpAgain.types.length === ngpBefore.types.length
    && ngpSnapAgain.state.variable === 'start'
    && ngpAgain.yearDisabled === true && ngpAgain.noteShown,
  JSON.stringify({ dataset: ngpAgain.datasets, type: ngpAgain.type,
    variable: ngpSnapAgain.state.variable, disabled: ngpAgain.yearDisabled }));
  check('…and the shared year is still the visitor\'s: 2012, set before any of '
    + 'this and inside every view\'s domain, was never moved',
  ngpSnapAgain.state.year === 2012 && ngpSnapBefore.state.year === 2012,
  `${ngpSnapBefore.state.year} → ${ngpSnapAgain.state.year}`);

  const seq7 = await viewSeq(page);
  await clickControl(page, ELIG.switchSel);
  await awaitViewSeq(page, seq7);
  const eligAgain = await eligProbe(page);
  const eligSnapAgain = await snapshot(page);
  check('and eligibility remembers all FOUR of its own pieces of state — the '
    + 'derived archive, the aggregation inside it, the all-types sentinel and '
    + 'the date variable',
  eligSnapAgain.state.dataset === 'derived'
    && eligAgain.params.source === eligBefore.params.source
    && eligAgain.params.type === ELIG.type.all.slug
    && eligSnapAgain.state.variable === 'date'
    && eligAgain.datePressed === 'true',
  JSON.stringify({ before: eligBefore.params, again: eligAgain.params,
    variable: eligSnapAgain.state.variable }));

  const seq8 = await viewSeq(page);
  await clickControl(page, DIS.switchSel);
  await awaitViewSeq(page, seq8);
  const disAgain = await disProbe(page);
  const disSnap = await snapshot(page);
  /* The designations have no state of their own to remember, so what a return
     here proves is the other half: the SHARED state came back intact and the
     view still carries nothing. Its own year domain starts at 2011 and the
     visitor's 2012 is inside it, so nothing may clamp on the way in either. A
     fabricated control to remember would be a check about the harness rather
     than about the app. */
  check('and the designations return with the shared state intact — the year the '
    + 'visitor set four stops ago, unclamped and mirrored — and still nothing of '
    + 'their own in the URL, because they have nothing of their own',
  disSnap.state.view === DIS.slug && disSnap.state.year === 2012
    && disAgain.params.year === '2012'
    && disAgain.retiredParams.length === 0
    && disAgain.params.dataset === null,
  JSON.stringify({ view: disSnap.state.view, year: disSnap.state.year,
    params: disAgain.params }));
  s.clean('four views, four memories');
  await s.shot('24-four-views');
  await s.ctx.close();
}

/* ══════════════════════════════════════════════════════════════════════════
   THE AUTHORITY TABLE — which polygons each dataset is actually drawn on.
   ══════════════════════════════════════════════════════════════════════════

   The gate this whole change exists for, and the one no screenshot can stand in
   for. A map drawn on the WRONG county authority looks perfect: every county has
   a colour, every shape is a real county, nothing is missing, and the boundaries
   are simply from the wrong archive or the wrong year. There is no pixel to
   inspect and no count to notice.

   So this drives the app through every row of the declared mapping and reads
   `data-ngp-boundary` — the tileset key the app writes once the geometry it
   names is really on screen, because the buffered swap resolves first.
   `tools/check-boundaries.mjs` proves the RESOLVER is right against the
   published data; this proves the app is using it.
   ══════════════════════════════════════════════════════════════════════════ */

section('▸ Every dataset draws the authority it declares');
{
  const s = await open();
  const { page } = s;
  check('the page reaches ngpReady', s.ready);

  const boundaryNow = () => page.evaluate(
    () => document.documentElement.dataset.ngpBoundary || null);

  /* row → [what to do, the tileset key it must land on].
     The census rows carry a YEAR because that authority's answer moves with it —
     which is the half of this that a fixed table could not express. */
  const ROWS = [
    ['grazing periods · FSA Official (boot)', null, 'fsa-counties-dd22'],
    ['grazing periods · a pre-2015 year', { year: 2012 }, 'fsa-counties-dd17'],
    ['drought · FSA LFP boundaries', { view: 'usdm' }, 'fsa-lfp-counties'],
    ['drought · NDMC reported', { view: 'usdm', dataset: 'reported' }, 'fsa-lfp-counties'],
    ['drought · Census counties, 2026', { view: 'usdm', dataset: 'census' }, 'census-counties-2025'],
    ['drought · Census counties, 2011 (the gap year: 2011 → the 2010 vintage)',
      { view: 'usdm', dataset: 'census', year: 2011 }, 'census-counties-2010'],
    ['drought · Census counties, 2023 (where Connecticut changes shape)',
      { view: 'usdm', dataset: 'census', year: 2023 }, 'census-counties-2022'],
    ['LFP eligibility', { view: 'eligibility' }, 'fsa-counties-dd22'],
    ['disaster designations', { view: 'disasters' }, 'fsa-counties-dd22'],
  ];

  check(`boot draws ${ROWS[0][2]}`, (await boundaryNow()) === ROWS[0][2],
    String(await boundaryNow()));

  for (const [label, nav, want] of ROWS.slice(1)) {
    const q = new URLSearchParams();
    if (nav.view) q.set('view', nav.view);
    if (nav.dataset) q.set('dataset', nav.dataset);
    if (nav.year) q.set('year', String(nav.year));
    const t = await open({ query: '?' + q.toString() });
    // A deep-linked view lands AFTER boot, so wait for the named key rather
    // than for "a transition finished" — see MARKERS.boundary.
    await settleBoundary(t.page, want);
    const got = await t.page.evaluate(
      () => document.documentElement.dataset.ngpBoundary || null);
    const n = await t.page.evaluate(async () => {
      const app = await import(new URL('js/app.js', document.baseURI).href);
      const c = app.ngpContext();
      return c.getCounties() ? c.getCounties().index.size : 0;
    });
    check(`${label} draws ${want}`, got === want, `drew ${got} (${n} polygons)`);
    t.clean(`authority · ${nav.view || 'ngp'}/${nav.dataset || 'default'}`);
    await t.ctx.close();
  }
  s.clean('authority table');
  await s.ctx.close();
}

/* ══════════════════════════════════════════════════════════════════════════
   A CHANGE OF AUTHORITY NEVER SHOWS A HOLE.
   ══════════════════════════════════════════════════════════════════════════

   The reader's complaint, and the reason kit v0.4.0 exists: switching dataset —
   or, on the Census authority, stepping the year — flashed. Twice for an
   archive that had not been fetched yet, once for one that had.

   Measured before the fix, on a switch from the 2025 Census counties to the FSA
   LFP determination boundaries: ~100 ms with every county grey (the
   feature-state wipe, repainted a frame later), then ~100 ms of the NEW
   dataset's numbers on the OLD authority's polygons, then ~400 ms of blank. The
   middle one is the one that matters most here — a map that is 97% right is the
   failure this app's whole boundary machinery exists to prevent, and it was
   arriving through the one call that was supposed to prevent it, because
   `setUrl()` clears its tiles when the new TileJSON RESOLVES rather than when it
   is called.

   FOUR WITNESSES PER RENDERED FRAME, and every one of them is exact — no colour
   classification, because "is this pixel the right shade" is the assertion that
   passed while the bug was shipping:

     1. PIXELS, for the blank. Sample points verified to be over painted
        counties before the swap starts; not one frame may turn any of them into
        the map background. Read inside a 'render' handler, which is the only
        place a live map's drawing buffer is readable — a live map has no
        preserveDrawingBuffer (ui/export.js sets it on its own throwaway map for
        exactly this reason), and a read between frames comes back BLACK, which
        would look like a blank and be a measurement bug.
     2. FEATURE STATE, for the grey. The probe county's colour must be present in
        every frame: the buffered swap leaves the outgoing stack's paint alone,
        so a frame with no colour on it is the wipe leaking.
     3. THE AUTHORITY PAIR, for the misregistration. `data-ngp-boundary` and the
        county count the app is describing must move TOGETHER — never a frame
        where the marker says one authority and the app is holding the other's
        index, which is what "assign the geometry, then start the swap" used to
        produce for as long as the swap took.
     4. CONNECTICUT, for what is actually drawn. The state is eight traditional
        counties on the FSA LFP set and nine PLANNING REGIONS on Census 2022+,
        and the two sets share no id — so the id rendered at a point in Hartford
        says which archive the reader is looking at, independently of what the
        app claims. It must agree with the marker in every frame.
   ══════════════════════════════════════════════════════════════════════════ */

section('▸ A change of authority never shows a hole');
{
  /**
   * Watch one transition frame by frame.
   *
   * @param {object} page
   * @param {(ctx: object) => void} actionName what to do, as a name the in-page
   *        probe understands — the action has to run INSIDE the page, after the
   *        render listener is installed, or the first frames are lost.
   * @param {any} arg the action's argument
   */
  const watch = (page, actionName, arg, probe) => page.evaluate(async ([action, a, probeId]) => {
    const app = await import(new URL('js/app.js', document.baseURI).href);
    const c = app.ngpContext();
    const map = c.getMap();
    const canvas = map.getCanvas();
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const px = new Uint8Array(4);

    const bgToken = getComputedStyle(document.documentElement)
      .getPropertyValue('--map-bg').trim();
    // The token as the renderer sees it: paint it into a 2D canvas and read it
    // back, rather than parsing hex or rgb() by hand here.
    const probe2d = document.createElement('canvas').getContext('2d');
    probe2d.fillStyle = bgToken;
    probe2d.fillRect(0, 0, 1, 1);
    const bg = Array.from(probe2d.getImageData(0, 0, 1, 1).data).slice(0, 3);

    const at = (fx, fy) => [Math.round(canvas.width * fx), Math.round(canvas.height * fy)];
    const POINTS = [[0.32, 0.42], [0.45, 0.52], [0.58, 0.46], [0.5, 0.66], [0.66, 0.6]]
      .map(([fx, fy]) => at(fx, fy));
    const read = (p) => {
      // readPixels' origin is the BOTTOM-left.
      gl.readPixels(p[0], canvas.height - p[1], 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return [px[0], px[1], px[2]];
    };
    const isBg = (v) => Math.abs(v[0] - bg[0]) < 6 && Math.abs(v[1] - bg[1]) < 6
      && Math.abs(v[2] - bg[2]) < 6;

    // A point in Connecticut, from whichever CT ids the authority on screen has.
    const ctIds = [...c.getCounties().index.keys()].filter((k) => k.startsWith('09'));
    const rec = ctIds.length ? c.getCounties().index.get(ctIds[0]) : null;
    const ctPoint = rec
      ? map.project([(rec.bbox[0] + rec.bbox[2]) / 2, (rec.bbox[1] + rec.bbox[3]) / 2])
      : null;

    const frame = () => {
      const handle = c.getHandle();
      const ct = ctPoint
        ? map.queryRenderedFeatures([ctPoint.x, ctPoint.y], { layers: [handle.layers.fill] })
        : [];
      // The COLOUR WITNESS is a fixed county the caller chose, not whatever
      // happens to be painted: it has to exist in both authorities, or the
      // frames after the flip would read back empty feature state and the
      // "never colourless" assertion would fail on a county that simply is not
      // in the arriving county set.
      const st = map.getFeatureState(handle.featureRef(probeId));
      const pixels = POINTS.map(read);
      return {
        pixels,
        bgHits: pixels.filter(isBg).length,
        colour: (st && st.color) || null,
        marker: document.documentElement.dataset.ngpBoundary || null,
        n: c.getCounties() ? c.getCounties().index.size : 0,
        ct: ct.length ? String(ct[0].properties.id) : null,
        geometry: handle.geometry ? handle.geometry() : null,
      };
    };

    // Establish the resting state INSIDE a render, and refuse to measure if the
    // sample points are not over painted counties — a probe over the ocean would
    // pass every assertion below and prove nothing.
    const restBefore = await new Promise((resolve) => {
      const once = () => { map.off('render', once); resolve(frame()); };
      map.on('render', once);
      map.triggerRepaint();
    });

    const frames = [];
    const onRender = () => { frames.push(frame()); };
    map.on('render', onRender);

    if (action === 'dataset') c.setDataset(a);
    else if (action === 'year') c.setYear(a);
    else if (action === 'view') c.setView(a);

    // Wait for the transition to land: the marker changes only after the flip.
    const t0 = performance.now();
    while (performance.now() - t0 < 25000) {
      await new Promise((r) => setTimeout(r, 100));
      if (document.documentElement.dataset.ngpBoundary !== restBefore.marker
          && map.areTilesLoaded()) break;
    }
    await new Promise((r) => setTimeout(r, 600));
    map.off('render', onRender);
    const restAfter = await new Promise((resolve) => {
      const once = () => { map.off('render', once); resolve(frame()); };
      map.on('render', once);
      map.triggerRepaint();
    });

    return { restBefore, restAfter, frames, probeId, ctPoint: ctPoint || null };
  }, [actionName, arg, probe]);

  /** Every frame's (marker, n) pair must be one of the two endpoints. */
  const pairs = (log) => {
    const key = (f) => f.marker + '/' + f.n;
    const ok = new Set([key(log.restBefore), key(log.restAfter)]);
    return log.frames.filter((f) => !ok.has(key(f)))
      .map((f) => f.marker + '/' + f.n);
  };

  /** Connecticut, cross-examined: the ids the marker's archive should have. */
  const ctDisagreements = (log) => log.frames.filter((f) => {
    if (!f.ct || !f.marker) return false;
    const planningRegion = /^09(1[1-9]0)$/.test(f.ct);
    if (/^census-counties-20(2[2-9])$/.test(f.marker)) return !planningRegion;
    if (f.marker === 'fsa-lfp-counties' || /^fsa-counties-/.test(f.marker)) {
      return planningRegion;
    }
    return false;      // an older Census vintage has traditional CT counties too
  }).map((f) => f.marker + ' drew ' + f.ct);

  const report = (log) => JSON.stringify({
    frames: log.frames.length,
    before: { marker: log.restBefore.marker, n: log.restBefore.n, ct: log.restBefore.ct },
    after: { marker: log.restAfter.marker, n: log.restAfter.n, ct: log.restAfter.ct },
    blankFrames: log.frames.filter((f) => f.bgHits > 0).length,
    colourlessFrames: log.frames.filter((f) => !f.colour).length,
  });

  /* ── (a) A DATASET SWITCH, cold: Census counties → FSA LFP boundaries. ──── */
  {
    const s = await open({ query: '?view=usdm&dataset=census' });
    check('the drought monitor boots on the Census counties', s.ready);
    await settleBoundary(s.page, 'census-counties-2025');
    const log = await watch(s.page, 'dataset', 'fsa-lfp', CONFIG.county.id);

    check('the probe is measuring something: painted counties under every sample '
      + 'point, a colour witness that both authorities have, and a different '
      + 'authority at the end',
    log.restBefore.bgHits === 0 && !!log.restBefore.colour && !!log.restAfter.colour
      && log.restBefore.marker === 'census-counties-2025'
      && log.restAfter.marker === 'fsa-lfp-counties' && log.frames.length >= 3,
    report(log));
    check('NOT ONE BLANK FRAME across a cold dataset switch — the ~400 ms of map '
      + 'background this release removes',
    log.frames.every((f) => f.bgHits === 0), report(log));
    check('NOT ONE COLOURLESS FRAME — the feature-state wipe never reaches the '
      + 'geometry the reader is looking at',
    log.frames.every((f) => !!f.colour), report(log));
    check('the authority marker and the county set the app describes move '
      + 'TOGETHER: no frame claims one authority while holding another\'s index',
    pairs(log).length === 0, JSON.stringify(pairs(log).slice(0, 4)));
    check('and Connecticut agrees with the marker in every frame — nine planning '
      + 'regions on Census 2022+, eight traditional counties on the LFP set',
    ctDisagreements(log).length === 0, JSON.stringify(ctDisagreements(log).slice(0, 4)));
    check('both archives stay resident afterwards, so going back is a repaint '
      + 'rather than a download',
    (log.restAfter.geometry || {}).resident
      && log.restAfter.geometry.resident.length === 2,
    JSON.stringify(log.restAfter.geometry));
    s.clean('cold dataset switch · no hole');
    await s.shot('25-authority-switch');
    await s.ctx.close();
  }

  /* ── (b) A YEAR STEP on the Census authority, which changes archive. ────── */
  {
    const s = await open({ query: '?view=usdm&dataset=census&year=2023' });
    await settleBoundary(s.page, 'census-counties-2022');
    // 2023 → 2020 crosses two published vintages and lands on census-2019.
    const log = await watch(s.page, 'year', 2020, CONFIG.county.id);

    check('a year step on the Census authority really does change archive',
      log.restBefore.marker === 'census-counties-2022'
      && log.restAfter.marker === 'census-counties-2019', report(log));
    check('NOT ONE BLANK FRAME across a year step either — this is the second '
      + 'flash the reader reported, and it is the same defect',
    log.frames.every((f) => f.bgHits === 0), report(log));
    check('NOT ONE COLOURLESS FRAME across a year step',
      log.frames.every((f) => !!f.colour), report(log));
    check('marker and index still move together',
      pairs(log).length === 0, JSON.stringify(pairs(log).slice(0, 4)));
    check('Connecticut is nine planning regions before the step and eight '
      + 'counties after it (vintage 2019 predates the change), and every frame '
      + 'agrees with its own marker',
    ctDisagreements(log).length === 0
      && /^09(1[1-9]0)$/.test(String(log.restBefore.ct))
      && !/^09(1[1-9]0)$/.test(String(log.restAfter.ct)),
    JSON.stringify({ before: log.restBefore.ct, after: log.restAfter.ct,
      bad: ctDisagreements(log).slice(0, 4) }));
    s.clean('year step across vintages · no hole');
    await s.ctx.close();
  }

  /* ── (c) WARM-ON-INTENT: hovering the button loads the archive. ─────────── */
  {
    const s = await open({ query: '?view=usdm&dataset=census' });
    await settleBoundary(s.page, 'census-counties-2025');
    const warmed = await s.page.evaluate(async () => {
      const app = await import(new URL('js/app.js', document.baseURI).href);
      const c = app.ngpContext();
      const before = c.getHandle().geometry();
      const btn = document.querySelector('.seg-btn[data-dataset="fsa-lfp"]');
      btn.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
      // Wait for THE ARCHIVE THIS BUTTON WOULD SHOW, by name. "more than one
      // resident" is already true at this point — boot draws the FSA composite
      // before the deep-linked drought view swaps off it, so that stack is
      // still there — and a probe that watched the COUNT would have answered
      // before the warm-up had done anything, which is how it read three
      // residents under a cap of two: the eviction had not run yet.
      const t0 = performance.now();
      const wanted = (g) => g.resident.some((k) => /fsa-lfp-counties\.pmtiles$/.test(k));
      while (performance.now() - t0 < 20000) {
        await new Promise((r) => setTimeout(r, 100));
        const g = c.getHandle().geometry();
        if (wanted(g)) {
          // One more beat, so the LRU trim that follows a warm-up is included:
          // the cap is a promise about memory and bandwidth, and a warm-up that
          // kept a third archive resident would be breaking it.
          await new Promise((r) => setTimeout(r, 400));
          return { before, after: c.getHandle().geometry(), hovered: btn.textContent.trim() };
        }
      }
      return { before, after: c.getHandle().geometry(), hovered: btn.textContent.trim() };
    });
    check('hovering a dataset button WARMS the archive it would switch to — the '
      + 'half-second before a click is about what an archive needs, and it is '
      + 'why the switch feels immediate rather than merely gapless',
    warmed.after.resident.some((k) => /fsa-lfp-counties\.pmtiles$/.test(k))
      && !warmed.before.resident.some((k) => /fsa-lfp-counties\.pmtiles$/.test(k))
      && warmed.after.front === warmed.before.front,
    JSON.stringify(warmed));
    check('...and it stays inside the resident cap: the archive hovered is the '
      + 'one kept, and something colder was retired for it',
    warmed.after.resident.length <= warmed.after.cap,
    JSON.stringify({ resident: warmed.after.resident, cap: warmed.after.cap }));
    s.clean('warm on intent');
    await s.ctx.close();
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   THE CROSSWALK LEFT THE DROUGHT VIEW — asserted by its absence.
   ══════════════════════════════════════════════════════════════════════════ */

section('▸ The crosswalk is not in the drought view\'s paint path');
{
  const s = await open({ query: '?view=usdm' });
  const { page } = s;
  await settleBoundary(page, 'fsa-lfp-counties');

  /* Two independent readings, because either alone could lie: the app's own
     handle on the crosswalk, and whether the browser ever asked for the file.
     Before this change all three drought datasets fetched it. */
  const state = await page.evaluate(async () => {
    const app = await import(new URL('js/app.js', document.baseURI).href);
    const c = app.ngpContext();
    const asked = performance.getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => /fsa-fips-crosswalk\.json/.test(n));
    return {
      crosswalk: typeof c.getCrosswalk === 'function' ? !!c.getCrosswalk() : null,
      asked: asked.length,
      boundary: document.documentElement.dataset.ngpBoundary,
    };
  });

  check('the drought monitor holds no crosswalk — its keys ARE its authority\'s ids',
    state.crosswalk === false, JSON.stringify(state));
  check('...and the page never even requested the crosswalk file',
    state.asked === 0, `${state.asked} request(s)`);

  /* The control: a view that still crosses key spaces must still fetch it, or
     the assertion above would pass for the wrong reason (a crosswalk that
     stopped working everywhere). */
  const d = await open({ query: '?view=disasters' });
  await settleBoundary(d.page, 'fsa-counties-dd22');
  const dis = await d.page.evaluate(async () => {
    const app = await import(new URL('js/app.js', document.baseURI).href);
    return {
      crosswalk: !!app.ngpContext().getCrosswalk(),
      asked: performance.getEntriesByType('resource')
        .filter((e) => /fsa-fips-crosswalk\.json/.test(e.name)).length,
    };
  });
  check('the disaster designations STILL crosswalk — FIPS-keyed with no boundary '
    + 'archive of their own, so the crosswalk did not stop working, it stopped '
    + 'being needed in one place',
  dis.crosswalk === true && dis.asked > 0, JSON.stringify(dis));
  d.clean('disasters crosswalk control');
  await d.ctx.close();

  s.clean('drought crosswalk absence');
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
