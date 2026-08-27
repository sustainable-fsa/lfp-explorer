#!/usr/bin/env node
/* ============================================================================
   LFP Explorer · tools/a11y-audit.mjs
   Axe over the app in BOTH themes at TWO viewports and in every interaction
   state below. Serious/critical violations fail the run — the kit's rule
   (AGENTS.md §6: "the axe workflow failing on serious/critical is a hard stop,
   not a flake to re-run") applies to consumers too.

     node tools/a11y-audit.mjs [workspaceRoot]

   Two optional env filters slice the theme × viewport matrix, and only that —
   every combo that runs still walks every state:

     A11Y_THEME=light|high-contrast       one theme  (unset = both)
     A11Y_VIEWPORT=wide|narrow            one size   (unset = both)

   CI sets both, once per leg of a four-way matrix, so the 780 s axe pass runs
   as four parallel ~195 s ones. A value matching neither list exits 1 naming
   the valid values — never a silent zero-combo pass. See § The combo filter.

   Tooling is dev-only and lives in tools/package.json (the repo-root
   package.json stays gitignored, per the kit's zero-dependency inheritance):

     npm ci --prefix tools
     npx --prefix tools playwright install --with-deps chromium

   ── Adapted from sustainable-fsa/style tools/a11y-audit.mjs ────────────────
   Deltas from the kit's version, all forced by what this app IS:

     · THE WORKSPACE ROOT IS SERVED, not this repo. The app references nothing
       outside its own directory except absolute https URLs, so serving the
       repo alone would work — but the documented dev workflow is
       `python3 -m http.server 8000 -d <workspace>` with the app at
       /lfp-explorer/, and an audit that serves a different
       geometry than the humans do is an audit of a different page. Pass a
       different root as argv[1] if the checkout sits somewhere else.

     · ngpReady IS A GATE HERE. The kit's demo degrades to an error note when
       the boundary fetch or WebGL is missing and audits the rest of the page
       anyway; this app IS the map, and most of the states below cannot be
       reached before the data has landed. A run that never sees ngpReady is
       reported as a failure rather than as a thin pass. Note what the flag
       proves: the data loaded and the first choropleth paint ran. It is NOT
       evidence of painted tiles, and nothing in CI should read it that way.

     · A STATE LIST, not two states. The kit probes the combobox because its
       listbox does not exist until something is typed. Every floating surface
       in this app has the same property — the card, the two <dialog>s, the
       dropdown and (on the phone) the control drawer and its scrim are all
       absent, [hidden] or `visibility: hidden` at rest, so a rest-only audit
       covers the navbar and a WebGL rectangle. The states:

         rest           the page as it boots
         help           the help <dialog>, rendered from help.md
         search-matches the listbox with real option rows
         search-empty   a query that matches nothing — the listbox's only child
                        is then an info row, and while that row was
                        role="presentation" this was aria-required-children
                        (critical) in all four combos
         drawer-open    the control drawer open: the desktop fixture as it
                        boots, and on the phone the off-canvas overlay plus its
                        scrim, which exist only after a tap
         card           a county selected, the detail card open over the map
         usdm-view      the second interface: the drought monitor, with its own
                        drawer sections (a week scrubber, a three-way dataset seg
                        and the weekly-polygon toggle), a categorical swatches
                        legend where the other view has a colour ramp, and a card
                        whose picture is a 1,389-week heatmap instead of a span
                        chart. Audited with the POLYGON OVERLAY ON, which is the
                        app's only state where a translucent geometry is drawn
                        over the choropleth rather than beside it, and where a
                        third seg group shares the drawer with a range input.
                        None of that markup exists on the default view, so a run
                        that never switched would audit half the app
         elig-view      the third interface: LFP eligibility, whose drawer adds
                        a three-way dataset seg, a native <select> of fifteen
                        pasture types plus a sentinel, a two-way variable seg and
                        — only on the derived archive — a second <select> for the
                        aggregation convention. Its legend is a six-step
                        swatches list and its card's picture is a per-year bar
                        chart with a table twin. Audited on the DERIVED archive
                        for exactly one reason: it is the only state in the app
                        where two native selects and two seg groups share one
                        drawer, and a label association or a name that is only a
                        colour would show up there first
         disasters-view the fourth interface: the disaster designations, which
                        add NO drawer controls of their own (that map is one
                        slice of one archive) and whose card is the app's only one
                        built from a LIST rather than a chart — one entry per
                        declaration, each with a role chip that has to carry its
                        meaning in text and not only in a colour. Nothing else in
                        the app produces that markup
         disasters-table the same view's data table: eleven columns and one row
                        per county designation, which is structurally the widest
                        table the app builds. Entered as a PAIR with the state
                        above (that one leaves the view up, this one takes it
                        down), because the switch is the expensive half
         table          the data-table <dialog>, ~3,000 rows of markup — the
                        grazing periods' own, which is what it has always been

     · Violations are merged by rule id ACROSS states and each is reported with
       the states it fired in, so a rule that fires everywhere reads as one
       finding and a rule that only fires with the table open is obvious.

   The chromium GL flags are the kit's: a GitHub runner has no GPU, and without
   a software rasterizer MapLibre never gets a context, ngpReady never fires,
   and the run fails for a reason that has nothing to do with accessibility.

   ── What this file no longer owns ──────────────────────────────────────────
   The page path, the two themes, the two viewport sizes, the localStorage
   seeds, the ngpReady predicate and its timeout, the MIME table and the static
   server all live in tools/config.mjs, which tools/verify.mjs imports too.
   They were hand-duplicated between the two harnesses; nine shared facts in
   two places is eighteen chances for one of them to drift a version behind,
   and the failure mode is that both harnesses stay green while auditing two
   subtly different pages. The knobs that are genuinely this harness's — the
   settle window, the state list, the combo filter that lets CI fan the matrix
   out without either list moving — are still here.
   ========================================================================== */
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import {
  INIT_LS, INTERFACES, PAGE_PATH as PAGE, READY_MS, THEMES, VIEWPORTS,
  renderEvidence, serveWorkspace, workspaceRoot,
} from './config.mjs';

/** Default: the workspace root, two levels up from tools/ (tools/ → repo →
    workspace). Pass a different root as argv[1] if the checkout sits
    somewhere else. */
const root = workspaceRoot(process.argv[2]);

/** The shared sizes, with the names THIS harness prints. Every report row and
    every CI log line has said `narrow` for the phone since the first run; the
    numbers are shared with verify.mjs (where the same viewport is called
    `compact`), the labels are not. */
const AUDIT_VIEWPORTS = [
  { name: 'wide', ...VIEWPORTS.wide },
  { name: 'narrow', ...VIEWPORTS.compact },
];

/* ── The combo filter ──────────────────────────────────────────────────────
   CI runs this harness as FOUR PARALLEL LEGS, one theme × one viewport each
   (.github/workflows/audit.yaml, job `a11y`), because the four combos never
   touch each other's page and 780 s of them in series was most of a 25-minute
   workflow. Each leg still walks the WHOLE state list: the split is across the
   matrix, never across the states.

   UNSET means the full matrix, so `node tools/a11y-audit.mjs` locally is
   exactly the run it has always been. Setting one and not the other is a legal
   slice too — `A11Y_THEME=high-contrast` alone audits both viewports of it,
   which is the shape you want when chasing one theme's contrast finding.

   A VALUE THAT MATCHES NOTHING EXITS 1, naming the valid values. It must never
   be a silent zero-combo pass: a typo in the workflow matrix, or a rename of a
   theme in tools/config.mjs, would otherwise turn a leg into a green check
   that audited an empty list — and four green checks would say the app is
   accessible on the strength of no axe passes at all. The loud failure is what
   lets the workflow hand-enumerate the four combos safely. */
function pickCombos(list, envName, noun, nameOf) {
  const want = process.env[envName];
  if (want === undefined || want === '') return list;
  const hit = list.filter((item) => nameOf(item) === want);
  if (!hit.length) {
    console.error(`\n${envName}=${JSON.stringify(want)} matches no ${noun} this `
      + 'harness knows.');
    console.error(`  valid values: ${list.map(nameOf).join(', ')}`);
    console.error('  (leave it unset to audit all of them)');
    process.exit(1);
  }
  return hit;
}

const themes = pickCombos(THEMES, 'A11Y_THEME', 'theme', (t) => t);
const viewports = pickCombos(AUDIT_VIEWPORTS, 'A11Y_VIEWPORT', 'viewport', (v) => v.name);
if (themes.length * viewports.length < THEMES.length * AUDIT_VIEWPORTS.length) {
  console.log(`combo filter: ${themes.join('/')} × ${viewports.map((v) => v.name).join('/')} `
    + `— ${themes.length * viewports.length} of ${THEMES.length * AUDIT_VIEWPORTS.length} `
    + 'combos, every state in each');
}

/** After ngpReady: the font swap, the legend, the map's first frames. */
const SETTLE_MS = 1500;

/** How long a VIEW SWITCH or dataset toggle may take before the state is called
    unreachable: another interface's payload — 4.5 MB for a weekly USDM set, 11
    MB for the derived eligibility archive — plus (for a FIPS-keyed one) the
    FIPS↔FSA crosswalk, plus the decode, the re-join and the recolor, on a runner
    with no GPU. Generous for the same reason READY_MS is: the failure it catches
    is "never", not "slow". Verify.mjs owns the same number under its own name
    (CONFIG.switchMs); this harness does not import it, because a settle window
    is a harness's own opinion. */
const SWITCH_MS = 45000;

const server = serveWorkspace(root);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  // A GitHub runner has no GPU. Without a software rasterizer MapLibre fails
  // to get a WebGL context and ngpReady never fires.
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
  ],
});

/**
 * Select a county through the app's own API rather than by clicking a polygon.
 *
 * app.js is the page's entry point and exports ngpContext(); a dynamic import
 * of the SAME url hits the module registry and returns the instance the page is
 * running, not a second copy. Clicking the canvas instead would make this state
 * depend on where a projection happens to put a shape at 375px.
 *
 * The import is a real module fetch, so it is `script-src 'self'` — allowed by
 * the page's meta CSP. Nothing here builds a function from a string: there is
 * no 'unsafe-eval', and `new Function` inside the page would be blocked.
 */
function selectCounty(page, id) {
  return page.evaluate(async (countyId) => {
    const mod = await import(new URL('js/app.js', document.baseURI).href);
    mod.ngpContext().selectCounty(countyId);
  }, id);
}

/** Wait out CSS transitions before handing the page to axe. The kit gives
    `.nav-btn` (and everything else) a 0.2 s `all` transition; a heavy
    main-thread stretch — the 11 MB derived decode is one — can freeze a
    button's aria-pressed background flip mid-blend, and axe then measures a
    color that matches no token and fails contrast on a picture no visitor
    ever settles on. Bounded, and forgiving: a page that keeps an animation
    running forever (none does today) still gets audited after 3 s. */
function settleTransitions(page) {
  return page.waitForFunction(
    () => document.getAnimations().every((a) => a.playState !== 'running'),
    null, { timeout: 3000 }).catch(() => {});
}

/** The year slider, moved the way a pointer moves it. One state needs it: the
    designations view's card is a list of the declarations that touched a county
    in the SELECTED year, and the probe county has none in the year a default
    boot lands on — so auditing it there would audit an empty list. */
const setYear = (page, year) => page.evaluate((y) => {
  const el = document.getElementById('year-range');
  if (!el) return null;
  const was = el.value;
  el.value = String(y);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return was;
}, year);

/** The year that state borrowed, so it can be handed back — the states after it
    are the ones that have always been audited at the boot year. */
let borrowedYear = null;

/* ── The states ───────────────────────────────────────────────────────────
   Each `enter` leaves the page in the state; each `exit` puts it back. They
   run in order inside one page, so the exits matter: a card left open under
   the table dialog would make the last state a compound of two, and on the
   phone a drawer left open would put its scrim over everything after it.

   A state that cannot be reached is reported as `:unavailable` and the axe
   pass still runs — the probe is extra reach, not the gate. */
const STATES = [
  {
    name: 'rest',
    async enter() { /* as booted */ },
    async exit() {},
  },
  {
    name: 'help',
    async enter(page) {
      await page.locator('#btn-info').click();
      await page.waitForFunction(() => document.getElementById('info-modal').open,
        null, { timeout: 5000 });
      // help.md is a separate fetch; auditing the offline fallback paragraph
      // instead of the real help would audit four sentences and call it a page.
      await page.waitForFunction(
        () => !!document.querySelector('#info-modal [data-help-content] table'),
        null, { timeout: 10000 });
    },
    async exit(page) {
      await page.evaluate(() => document.getElementById('info-modal').close());
    },
  },
  {
    name: 'search-matches',
    async enter(page) {
      await openSearch(page);
      await page.locator('#county-search').fill('a');
      await page.waitForSelector('#county-results [role="option"]:not([aria-disabled="true"])',
        { timeout: 5000 });
    },
    async exit(page) { await clearSearch(page); },
  },
  {
    name: 'search-empty',
    async enter(page) {
      await openSearch(page);
      await page.locator('#county-search').fill('zzzzzzzz');
      await page.waitForSelector('#county-results [role="option"][aria-disabled="true"]',
        { timeout: 5000 });
    },
    async exit(page) { await clearSearch(page); },
  },
  {
    name: 'drawer-open',
    // On `wide` this is the boot layout — the drawer is a fixture there, so the
    // enter is a no-op and the pass re-audits it in the state list's own terms.
    // On `narrow` it is the only pass that ever sees the off-canvas overlay and
    // its scrim: at rest both are out of the way (`.is-closed` hides the drawer
    // with `visibility`, the scrim is `[hidden]`), and axe cannot report on a
    // surface that is not there. The two things to watch are the toggles' names
    // and whether anything focusable ended up inside the scrim.
    async enter(page) { await openDrawer(page); },
    async exit(page) { await closeDrawerIfOverlay(page); },
  },
  {
    name: 'card',
    // Reached with the drawer CLOSED on narrow: the states above all restore it,
    // which is what makes the Escape exit below hit the sheet. See
    // closeDrawerIfOverlay().
    async enter(page) {
      // Missoula County, MT — a county with data in every year and a polygon in
      // both vintages, so this state is the same state on every run.
      await selectCounty(page, '30063');
      await page.waitForFunction(() => !document.getElementById('county-card').hidden,
        null, { timeout: 5000 });
      await page.waitForSelector('#card-content .span-figure svg', { timeout: 5000 });
    },
    // Escape, not a click on #card-close: at 375px that button is not
    // hit-testable (tools/verify.mjs owns that assertion — see the compact
    // section there), and an audit that hung for 30s on a known layout defect
    // would be reporting it in the wrong place and in the wrong way.
    async exit(page) {
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.getElementById('county-card').hidden,
        null, { timeout: 5000 });
    },
  },
  {
    name: 'usdm-view',
    /* The drought monitor, with a county open on it. Reached the way a visitor
       reaches it — through the drawer, which on `narrow` means opening the
       overlay first and putting it back before the card, exactly as the `card`
       state does (see closeDrawerIfOverlay).

       Waited on by the app's own view marker rather than by a timeout: the
       switch fetches a payload and the crosswalk, re-joins and recolors, and an
       axe pass taken mid-transition would audit a page with the new legend over
       the old paint.

       AND WITH THE WEEKLY POLYGONS ON, which is a different page for axe rather
       than a prettier one. The overlay adds a third seg group to a drawer that
       already carries a dataset seg and a range input (so the group's own
       labelling, and the pressed/unpressed contrast of one more pair of
       buttons, are only auditable here), it puts a translucent second geometry
       over the canvas — the one surface in the app where a colour is drawn over
       another colour rather than beside it — and it adds a sentence to the live
       region and a clause to the legend key. None of that markup or copy exists
       in any other state. It is toggled on AFTER the card, so this state is the
       compound a reader actually reaches, and toggled back off in exit(). */
    async enter(page) {
      await openDrawer(page);
      await page.locator(INTERFACES.usdm.switchSel).click({ timeout: 5000 });
      await page.waitForFunction(
        (slug) => document.documentElement.dataset.ngpView === slug,
        INTERFACES.usdm.slug, { timeout: SWITCH_MS });
      await closeDrawerIfOverlay(page);
      await selectCounty(page, INTERFACES.usdm.county.id);
      await page.waitForFunction(() => !document.getElementById('county-card').hidden,
        null, { timeout: 5000 });
      // The card's picture on this view is the full-record weekly heatmap; its
      // <figcaption> and table twin are what axe has to see.
      await page.waitForSelector('#card-content figure svg', { timeout: 10000 });
      /* The overlay's own settle marker, and only in its ISO form: `loading` is
         a real state that lasts as long as a 0.7 MB weekly file takes on a cold
         CDN, and an axe pass taken there would audit an empty source under a
         legend that says the polygons are drawn. The predicate is written out
         in full here for the same reason every other one is — it runs in-page,
         so it cannot close over a pattern from tools/config.mjs (see MARKERS
         § overlay, which is where the grammar is documented). */
      await openDrawer(page);
      await page.locator(INTERFACES.usdm.overlay.onSel).click({ timeout: 5000 });
      await page.waitForFunction(() => {
        const v = document.documentElement.dataset.ngpOverlay;
        return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
      }, null, { timeout: SWITCH_MS });
      await closeDrawerIfOverlay(page);
      await settleTransitions(page);
    },
    /* Escape for the card (not #card-close — at 375px that button is not
       hit-testable, and tools/verify.mjs owns that finding), the overlay back
       off, then back to the default view so the `table` state below is the
       grazing-period table it has always been.

       THE OVERLAY IS PUT BACK EXPLICITLY, not left to the view switch: it is a
       remembered preference of this view rather than a transient, so leaving it
       on would carry `polygons=on` in localStorage and in the URL past the state
       that asked for it — and the states in this list share one page. */
    async exit(page) {
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.getElementById('county-card').hidden,
        null, { timeout: 5000 }).catch(() => {});
      await openDrawer(page);
      await page.locator(INTERFACES.usdm.overlay.offSel).click({ timeout: 5000 })
        .catch(() => {});
      await page.waitForFunction(
        () => document.documentElement.dataset.ngpOverlay === undefined,
        null, { timeout: 10000 }).catch(() => {});
      await page.locator(INTERFACES.ngp.switchSel).click({ timeout: 5000 });
      await page.waitForFunction(
        (slug) => document.documentElement.dataset.ngpView === slug,
        INTERFACES.ngp.slug, { timeout: SWITCH_MS });
      await closeDrawerIfOverlay(page);
    },
  },
  {
    name: 'elig-view',
    /* LFP eligibility, on the derived archive, with a county open on it.
       Reached the way a visitor reaches it — through the drawer, which on
       `narrow` means opening the overlay first and putting it back before the
       card, exactly as the two states above do.

       THE DATASET TOGGLE IS PART OF THE STATE, not decoration: the aggregation
       select exists only on the derived archive, so a pass that stayed on the
       default one would never audit the drawer's second <select> — the state
       this app has never had before. Both switches wait on the app's own view
       marker rather than on a timeout: each fetches a payload (the derived one
       is 11 MB) and recolors, and an axe pass taken mid-transition would audit a
       page with a new legend over an old paint.

       ARRIVING HERE MOVES THE YEAR. The FOIA archive's record ends before the
       app's default year, so the app clamps and announces on the way in; that
       is a state worth auditing too, and it is why this state is entered from
       the default view rather than from a deep link that hides the move. */
    async enter(page) {
      await openDrawer(page);
      await page.locator(INTERFACES.eligibility.switchSel).click({ timeout: 5000 });
      await page.waitForFunction(
        (slug) => document.documentElement.dataset.ngpView === slug,
        INTERFACES.eligibility.slug, { timeout: SWITCH_MS });
      const seq = await page.evaluate(
        () => Number(document.documentElement.dataset.ngpViewSeq || 0));
      await page.locator(INTERFACES.eligibility.datasets.derived.sel)
        .click({ timeout: 5000 });
      await page.waitForFunction(
        (before) => Number(document.documentElement.dataset.ngpViewSeq || 0) > before,
        seq, { timeout: SWITCH_MS });
      await page.waitForSelector(INTERFACES.eligibility.source.selectSel,
        { state: 'attached', timeout: 5000 });
      await closeDrawerIfOverlay(page);
      await selectCounty(page, INTERFACES.eligibility.county.id);
      await page.waitForFunction(() => !document.getElementById('county-card').hidden,
        null, { timeout: 5000 });
      // The card's picture here is the per-year payment-months bar chart; its
      // <figcaption> and table twin are what axe has to see.
      await page.waitForSelector('#card-content figure svg', { timeout: 10000 });
      await settleTransitions(page);
    },
    /* Escape for the card (not #card-close — at 375px that button is not
       hit-testable, and tools/verify.mjs owns that finding), then back to the
       default view so the `table` state below is the grazing-period table it has
       always been. */
    async exit(page) {
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.getElementById('county-card').hidden,
        null, { timeout: 5000 }).catch(() => {});
      await openDrawer(page);
      await page.locator(INTERFACES.ngp.switchSel).click({ timeout: 5000 });
      await page.waitForFunction(
        (slug) => document.documentElement.dataset.ngpView === slug,
        INTERFACES.ngp.slug, { timeout: SWITCH_MS });
      await closeDrawerIfOverlay(page);
    },
  },
  {
    name: 'disasters-view',
    /* The disaster designations, with a county open on them. Reached through the
       drawer like the two views above, and then MOVED IN TIME: this view's card
       is a list of the declarations that touched the selected county in the
       selected year, and Missoula — the county every other state here uses, so
       that a reader comparing two reports is comparing two reports of the same
       county — has none at all in the year a default boot lands on. Auditing it
       there would audit an empty list and call the state covered. The year comes
       from the gates' own fixture (tools/config.mjs), and the state below hands
       it back.

       This state does NOT return to the default view on the way out: the state
       after it audits this view's data table, and the switch is the expensive
       half of both. */
    async enter(page) {
      await openDrawer(page);
      await page.locator(INTERFACES.disasters.switchSel).click({ timeout: 5000 });
      await page.waitForFunction(
        (slug) => document.documentElement.dataset.ngpView === slug,
        INTERFACES.disasters.slug, { timeout: SWITCH_MS });
      borrowedYear = await setYear(page, INTERFACES.disasters.fixture.year);
      await page.waitForTimeout(700);
      await closeDrawerIfOverlay(page);
      await selectCounty(page, INTERFACES.disasters.county.id);
      await page.waitForFunction(() => !document.getElementById('county-card').hidden,
        null, { timeout: 5000 });
      /* No canvas to wait for here — the card's body is semantic markup, which
         is its own accessible twin — so what has to be on screen before axe
         looks is a body with real content in it. */
      await page.waitForFunction(() => {
        const c = document.getElementById('card-content');
        return !!c && !c.hidden && (c.textContent || '').trim().length > 40;
      }, null, { timeout: 10000 });
      await settleTransitions(page);
    },
    /* Escape for the card (not #card-close — at 375px that button is not
       hit-testable, and tools/verify.mjs owns that finding). The view stays up. */
    async exit(page) {
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.getElementById('county-card').hidden,
        null, { timeout: 5000 }).catch(() => {});
    },
  },
  {
    name: 'disasters-table',
    /* The same view's table: eleven columns, one row per county designation, and
       the archive's own irregular spellings inside them. Structurally the widest
       table the app builds, and the only one whose cells include values nobody
       cleaned.

       The switch is repeated only IF NEEDED, so that a run in which the state
       above could not be reached still audits this one rather than auditing the
       grazing-period table twice. */
    async enter(page) {
      const here = await page.evaluate(
        (slug) => document.documentElement.dataset.ngpView === slug,
        INTERFACES.disasters.slug);
      if (!here) {
        await openDrawer(page);
        await page.locator(INTERFACES.disasters.switchSel).click({ timeout: 5000 });
        await page.waitForFunction(
          (slug) => document.documentElement.dataset.ngpView === slug,
          INTERFACES.disasters.slug, { timeout: SWITCH_MS });
        if (borrowedYear === null) {
          borrowedYear = await setYear(page, INTERFACES.disasters.fixture.year);
          await page.waitForTimeout(700);
        }
        await closeDrawerIfOverlay(page);
      }
      await page.locator('#btn-table').click();
      await page.waitForFunction(
        () => document.getElementById('table-modal').open
          && document.querySelectorAll('#table-modal-body tbody tr').length > 100,
        null, { timeout: 30000 });
      await settleTransitions(page);
    },
    /* Close the table, give the year back, and return to the default view — so
       the `table` state below is the grazing-period table at the boot year that
       it has always been. */
    async exit(page) {
      await page.evaluate(() => document.getElementById('table-modal').close());
      await openDrawer(page);
      await page.locator(INTERFACES.ngp.switchSel).click({ timeout: 5000 });
      await page.waitForFunction(
        (slug) => document.documentElement.dataset.ngpView === slug,
        INTERFACES.ngp.slug, { timeout: SWITCH_MS });
      if (borrowedYear !== null) {
        await setYear(page, borrowedYear);
        borrowedYear = null;
        await page.waitForTimeout(700);
      }
      await closeDrawerIfOverlay(page);
    },
  },
  {
    name: 'table',
    async enter(page) {
      await page.locator('#btn-table').click();
      await page.waitForFunction(
        () => document.getElementById('table-modal').open
          && document.querySelectorAll('#table-modal-body tbody tr').length > 100,
        null, { timeout: 20000 });
    },
    async exit(page) {
      await page.evaluate(() => document.getElementById('table-modal').close());
    },
  },
];

/* ── Reaching the drawer ──────────────────────────────────────────────────
   The app's data controls — search, year, pasture type, colour-by, legend —
   all live in the left drawer now. On `wide` that drawer is a fixture: it is
   open at boot and the app never closes it, so a state that wants a control
   just uses it. On `narrow` it boots closed as an off-canvas overlay behind a
   scrim, and the navbar hamburger is the only way in.

   `#btn-drawer` is the discriminator these helpers key off: the kit gives
   `.sfsa-drawer-toggle` `display: none` above the compact breakpoint, so "the
   hamburger is visible" IS "this viewport treats the drawer as an overlay" —
   no viewport arithmetic duplicated from the CSS. */

/** True while the drawer carries the kit's closed class. */
const drawerClosed = (page) => page.evaluate(
  () => document.getElementById('drawer').classList.contains('is-closed'));

/** Open the drawer with whichever toggle this viewport actually shows. */
async function openDrawer(page) {
  if (!(await drawerClosed(page))) return;
  const hamburger = page.locator('#btn-drawer');
  const toggle = (await hamburger.isVisible()) ? hamburger : page.locator('#drawer-tab');
  await toggle.click({ timeout: 3000 });
  await page.waitForFunction(
    () => !document.getElementById('drawer').classList.contains('is-closed'),
    null, { timeout: 3000 });
  // The slide is 0.2s and the scrim fades with it; axe should measure the
  // surface where it lands, not halfway there.
  await page.waitForTimeout(400);
}

/**
 * Put the compact overlay back, and leave the desktop fixture alone.
 *
 * Every caller needs both halves of that: on `narrow` a drawer left open would
 * carry its scrim across the map into the next state (auditing a compound of
 * two states and calling it one), and it would also steal the `card` state's
 * Escape — the drawer is registered above the card, so the exit there would
 * close the drawer and time out waiting for the sheet.
 */
async function closeDrawerIfOverlay(page) {
  const hamburger = page.locator('#btn-drawer');
  if (!(await hamburger.isVisible())) return;      // wide: it is a fixture
  if (await drawerClosed(page)) return;
  await hamburger.click({ timeout: 3000 });
  await page.waitForFunction(
    () => document.getElementById('drawer').classList.contains('is-closed'),
    null, { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
}

/** The search input is inside the drawer, so reaching it means opening it. */
async function openSearch(page) {
  const input = page.locator('#county-search');
  if (!(await input.isVisible())) {
    await openDrawer(page);
    await input.waitFor({ state: 'visible', timeout: 3000 });
  }
}

async function clearSearch(page) {
  await page.locator('#county-search').fill('');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('county-results').hidden,
    null, { timeout: 3000 }).catch(() => {});
  // That Escape closed the dropdown, which consumed it — the drawer under it is
  // still open on `narrow`. Put it back, or the next state inherits an overlay.
  await closeDrawerIfOverlay(page);
}

/* ── Run ──────────────────────────────────────────────────────────────────── */

const rows = [];
let failed = false;

for (const theme of themes) {
  for (const vp of viewports) {
    const label = `${theme} · ${vp.name} ${vp.width}×${vp.height}`;
    // @axe-core/playwright requires a page created from an explicit context.
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
    });
    // The theme goes in through localStorage, where the anti-flash boot looks
    // second (after ?theme=). Seeding it audits the returning-visitor path, and
    // it runs before first paint, so nothing flashes.
    await context.addInitScript((kv) => {
      for (const [k, v] of Object.entries(kv)) {
        try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ }
      }
    }, { ...INIT_LS, 'sfsa-theme': theme });

    const page = await context.newPage();
    const consoleErrors = [];
    /* AXE'S OWN CSP NOISE, filtered out on purpose.
       axe-core applies `style` ATTRIBUTES to the nodes it measures, and this
       page ships a meta CSP with no 'unsafe-inline' in style-src — so every
       axe pass logs two "Applying inline style violates…" errors that belong
       to the auditor, not to the app. Verified by running the same page with
       and without an axe pass: 0 errors before, 2 after, none from any app
       interaction. Counting them here would put a permanent phantom in the
       console column and train the next reader to ignore it.
       Console-clean is a GATE in tools/verify.mjs, which never loads axe and
       therefore never has to filter anything. */
    const isAxeCspNoise = (t) => /Applying inline style violates/.test(t);
    const record = (t) => { if (!isAxeCspNoise(t)) consoleErrors.push(t); };
    page.on('pageerror', (e) => record(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') record(m.text()); });

    await page.goto(base + PAGE, { waitUntil: 'domcontentloaded' });

    let ready = true;
    try {
      // The predicate is the shared FUNCTION from tools/config.mjs, never a
      // string: a string is eval'd in-page and the meta CSP has no
      // 'unsafe-eval'.
      await page.waitForFunction(renderEvidence, null, { timeout: READY_MS });
    } catch {
      ready = false;
      failed = true;
      console.error(`\n[${label}] ngpReady NEVER FIRED after ${READY_MS / 1000}s — `
        + 'the data did not load or the map did not paint. The states below are '
        + 'audited against whatever is on screen, which is not the app.');
    }
    await page.waitForTimeout(SETTLE_MS);

    const appliedTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    if (appliedTheme !== theme) {
      failed = true;
      console.error(`[${label}] theme did not apply: <html data-theme="${appliedTheme}">`);
    }

    // One axe pass per state, merged by rule id so the counts stay comparable
    // to a single-pass run and a rule firing in several states is reported once,
    // naming all of them.
    const seen = new Map();
    const reached = [];
    for (const state of STATES) {
      let ok = true;
      try {
        await state.enter(page);
      } catch (err) {
        ok = false;
        console.error(`  [${label}] state ${state.name} unreachable: `
          + String(err).split('\n')[0]);
      }
      reached.push(state.name + (ok ? '' : ':unavailable'));

      const results = await new AxeBuilder({ page }).analyze();
      for (const v of results.violations) {
        const rec = seen.get(v.id) || { v, states: [] };
        // Keep the pass with the most nodes: the fuller failure is more useful.
        if (v.nodes.length > rec.v.nodes.length) rec.v = v;
        rec.states.push(state.name);
        seen.set(v.id, rec);
      }

      try {
        await state.exit(page);
      } catch (err) {
        console.error(`  [${label}] state ${state.name} would not exit: `
          + String(err).split('\n')[0]);
      }
    }

    const found = [...seen.values()];
    const bad = found.filter((r) => r.v.impact === 'serious' || r.v.impact === 'critical');
    const meh = found.filter((r) => r.v.impact !== 'serious' && r.v.impact !== 'critical');

    if (bad.length) {
      failed = true;
      console.error(`\n[${label}] ${bad.length} SERIOUS/CRITICAL violation(s):`);
      for (const { v, states } of bad) {
        console.error(`  ${v.id} (${v.impact}) [states: ${states.join(', ')}]: ${v.help}`);
        console.error(`    ${v.helpUrl}`);
        for (const n of v.nodes.slice(0, 5)) {
          console.error(`    → ${n.target.join(' ')}`);
          if (n.failureSummary) console.error(`      ${n.failureSummary.split('\n').join(' ')}`);
        }
        if (v.nodes.length > 5) console.error(`    → …and ${v.nodes.length - 5} more node(s)`);
      }
    } else {
      console.log(`\n[${label}] OK — 0 serious/critical`);
    }
    for (const { v, states } of meh) {
      console.log(`  advisory ${v.id} (${v.impact}) [states: ${states.join(', ')}]: `
        + `${v.help} [${v.nodes.length} node(s)]`);
      for (const n of v.nodes.slice(0, 3)) console.log(`    → ${n.target.join(' ')}`);
    }
    if (consoleErrors.length) {
      // Not the gate here — tools/verify.mjs is where console-clean IS a gate —
      // but a console error during an axe run is worth reading in the log.
      console.log(`  console: ${consoleErrors.length} error(s) — ${consoleErrors[0]}`);
    }

    rows.push({
      label, serious: bad.length, advisories: meh.length,
      ready, states: reached.join('+'), consoleErrors: consoleErrors.length,
    });
    await context.close();
  }
}

await browser.close();
server.close();

console.log('\n  theme · viewport                serious/critical  advisories  ngpReady  console');
for (const r of rows) {
  console.log(`  ${r.label.padEnd(30)}${String(r.serious).padStart(10)}`
    + `${String(r.advisories).padStart(14)}  ${String(r.ready).padEnd(8)}  ${r.consoleErrors}`);
}
console.log('\n  states audited (per combo):');
for (const r of rows) console.log(`  ${r.label.padEnd(30)}  ${r.states}`);
console.log(rows.every((r) => r.ready)
  ? '  ngpReady in every combo: the payload joined and the choropleth painted.'
  : '  ngpReady MISSING in at least one combo — see above. This is a failure, not '
    + 'a degradation: most of the states above are unreachable without it.');

process.exit(failed ? 1 : 0);
