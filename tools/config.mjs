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

   WHAT `INTERFACES` IS FOR: the probe table. The app is one page over four
   views ("interfaces", in the plan's language), each with its own datasets,
   legend body, export filename scheme and deep link. Every harness fact about
   a view lives in one entry here, so adding a view to the gates is adding a
   literal — not editing assertions scattered through 1,700 lines. All four are
   here now (`ngp`, `usdm`, `eligibility`, `disasters`), and the shape survived
   every one of the three additions: what a new view needed was its own entry
   plus one call to the section template, and what it never needed was a new
   assertion in a place a reader would not look for it. The fourth cost the
   template two lines, both because it is the first view with ONE archive and
   therefore no dataset control at all (see `payload` below).

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
  /** `data-ngp-boundary` — the tileset key of the county authority ACTUALLY on
      the map ('fsa-counties-dd22', 'census-counties-2011', …). Written in the
      same statement that assigns the geometry, so it cannot describe an
      intention rather than a fact.

      THIS IS THE SETTLE SIGNAL for anything that changes what is drawn, and the
      transient pill is not. The pill is shown by whoever starts a transition and
      cleared by whoever finishes one, so a wait that keys on it can return
      immediately in a section that arrived with it already hidden — and then
      read the PREVIOUS authority's geometry. That produced a real "dd22, 3104
      polygons" failure: the right vintage, the previous vintage's polygons,
      against an app that was swapping correctly in both directions. Wait on
      this, and prefer waiting for a NAMED key (settleBoundary) over waiting for
      "something changed". */
  boundary: 'ngpBoundary',
  /** `data-ngp-overlay` — the USDM weekly-polygon overlay's settle signal, and
      the ONLY one it has. It is not the pill (shown by whoever starts a
      transition, cleared by whoever finishes one) and it is deliberately not
      `viewSeq`: a week is not a view transition, and no overlay code path
      touches that marker at all.

      THE GRAMMAR, which is the whole of what a harness may wait on:

        (absent)      the overlay is not drawn — toggled off, or the active view
                      is not the drought monitor
        `loading`     on; the target week's fetch or decode is in flight, and the
                      source has ALREADY been emptied (last week's D4 blob over
                      this week's choropleth is a map that lies)
        `YYYY-MM-DD`  on; THAT week is attached and flushed to GL. Stamped only
                      after the map fires `sourcedata` with `isSourceLoaded` for
                      the overlay's source and a double rAF has passed — the same
                      after-the-paint reasoning as viewSeq above
        `missing`     on; the week the app landed on is not a date the sidecar
                      publishes. Weekly publishing skew, which self-heals, so it
                      WARNS rather than gating
        `error`       on; the promised weekly file, or the sidecar itself, could
                      not be fetched or decoded

      A wait for "the overlay is showing week W" is therefore a wait for the ISO
      form and nothing else — `loading` is a real state that may last a second on
      a cold CDN, and treating its presence as arrival would read the empty
      source. */
  overlay: 'ngpOverlay',
});

/* ══════════════════════════════════════════════════════════════════════════
   THE PROBE TABLE — one entry per view ("interface")
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Everything the gates know about a view. All four are here.
 *
 * Fields:
 *   slug        `?view=` value. The default view emits NO param at all.
 *   label       prose for check labels, not markup.
 *   isDefault   true for exactly one entry — and NOT the same fact as `order`
 *               below: the switcher is ordered for the reader (the story starts
 *               at the drought monitor) and the app boots on the grazing
 *               periods, so the elided `?view=` is the SECOND button's.
 *   order       the button's place in the switcher, 1-based, and `switchLabel`
 *               the words on it — the numbered prefix included, because the
 *               number is how the drawer tells a reader what order to read the
 *               four maps in. One check reads the switcher in DOM order and
 *               compares it against these two fields.
 *   switchSel   the view switcher's seg button (`aria-pressed` drives its
 *               styling, so aria-pressed is also what a harness reads).
 *   sectionSel  the switcher section itself, first child of the drawer scroll.
 *   county      a county with data and a polygon in BOTH boundary vintages, so
 *               no assertion depends on which side of 2015 the year sits.
 *   datasets    keyed by dataset id; exactly one `isDefault`. Per entry:
 *               `sel` (its seg button), `label` (the words ON that button —
 *               checked against the DOM, not just interpolated into a check's
 *               own prose), `payload` (the basename the
 *               lazy-boot resource assertion looks for), `keySpace`
 *               ('fsa' → direct join; 'fips' → through the crosswalk), plus
 *               whatever that dataset makes true about the controls
 *               (`nominalYears` disables the year slider and unhides its
 *               note; `types` is how many options its dictionary offers).
 *               ABSENT on a view with one archive and therefore no dataset
 *               control: `disasters` names its `payload` (and `payloadUrl`)
 *               directly instead, and emits no `?dataset` at all. The two
 *               places that walk datasets — the section template's lazy-fetch
 *               step and the boot path's lazy list — read the entry itself
 *               when the map is missing, which is the whole adaptation.
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
 *   overlay     (the drought monitor only) the weekly-polygon overlay: its
 *               drawer section and two seg buttons, the param and preference key
 *               the generic choice machinery gives it, the APP-OWNED source and
 *               layer ids, the shape of its settle marker, the frozen week its
 *               deep link must land on, the two copy clauses the live region
 *               and the legend key owe a reader while it is on, and the strength
 *               slider that appears with it (the `opacity*` entries).
 *   unmatchedOracle async (page) → how many source areas this view's join
 *               cannot reach, for the count the live region must say out loud.
 *   lazyAssets  committed repo assets this view loads WITH the view rather than
 *               at boot (a second colour ramp). The lazy-boot assertion adds
 *               them to the list of things the boot path must not have fetched.
 *   fixture     the (year, county) the gates drive this view to, with what the
 *               published payload says is there — measured, and the reason the
 *               choice was made. A view whose default year happens to hold no
 *               record for the probe county would otherwise assert the empty
 *               half of a card.
 *   junk        source values a view is required to reproduce VERBATIM rather
 *               than clean up, with the rows to find them in.
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
    /** The view a session with no `?view=` lands on — SECOND in the switcher
        since the story was put in its reading order, which is why these two
        fields are separate facts. */
    isDefault: true,
    order: 2,
    switchLabel: '2 · Grazing periods',
    switchSel: '#btn-view-ngp',
    sectionSel: '#view-seg',
    county: Object.freeze({ id: '30063', name: 'Missoula' }),
    datasets: Object.freeze({
      fsa: Object.freeze({
        id: 'fsa',
        isDefault: true,
        label: 'FSA Official (FOIA)',
        sel: '#btn-ngp-official',
        payload: 'fsa-normal-grazing-period.json',
        keySpace: 'fsa',
      }),
      nclimgrid: Object.freeze({
        id: 'nclimgrid',
        isDefault: false,
        label: 'NAP-190 Derived (nClimGrid)',
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
    /** FIRST in the switcher and not the default view: the story starts with
        the drought, and the app still boots on the grazing periods. */
    isDefault: false,
    order: 1,
    switchLabel: '1 · Drought monitor',
    switchSel: '#btn-view-usdm',
    sectionSel: '#view-seg',
    /** The same county as the default view, deliberately: a state-memory round
        trip can only prove the SELECTION is the visitor's rather than the
        view's if both views can show it. Missoula is in all three USDM county
        sets and in both boundary vintages. */
    county: Object.freeze({ id: '30063', name: 'Missoula' }),

    /* Three answers to one question, and the difference between them is a
       fact about how the USDM is keyed rather than a modelling choice. All
       three are FIPS-keyed, so all three arrive through the crosswalk.

       IN THE SEG'S OWN ORDER, from the most general idea of a county to the
       most program-specific — which puts the DEFAULT last. The app reads that
       default off the descriptor's `default` flag rather than off a position
       (js/interfaces/registry.js § defaultDatasetOf), and so does everything
       here: `isDefault` below, never `Object.values(...)[0]`. */
    datasets: Object.freeze({
      census: Object.freeze({
        id: 'census',
        isDefault: false,
        label: 'Census counties',
        sel: '#btn-usdm-census',
        payload: 'usdm-counties.json',
        keySpace: 'fips',
        /** The county authority it is DRAWN on — js/boundaries.js resolves the
            annual vintage, so the key here is a template the harness fills. */
        boundary: 'census-counties-{censusVintage}',
        /** Vintage-matched TIGER, so it is the one NON-rectangular set: a
            county absent from a week is a real '.' in the series, and the
            harness's absent-county copy is checked against this one. */
        rectangular: false,
        /** MEASURED: the thirteen territory FIPS the tilesets drop (American
            Samoa, Guam, the Northern Marianas, the US Virgin Islands). They
            report from 2012 onward and are '.' before it, so on an early year
            this is legitimately ZERO — which is why the harness computes it
            from the payload and this literal is only what the live region is
            checked to be talking about. Crosswalked onto the FSA composite it
            used to be 159. */
        unmatchedAtDefaultYear: 13,
      }),
      reported: Object.freeze({
        id: 'reported',
        isDefault: false,
        label: 'NDMC reported',
        sel: '#btn-usdm-reported',
        payload: 'usdm-counties-reported.json',
        keySpace: 'fips',
        rectangular: true,
        boundary: 'fsa-lfp-counties',
        /** MEASURED, and the reason this dataset is not the default: NDMC keys
            Connecticut as the nine planning regions 09110–09190 for the whole
            record, and the FSA LFP determination boundaries answer Connecticut
            as its eight traditional counties. So exactly nine reported areas
            reach no polygon — and eight polygons stay uncoloured — and the app
            must COUNT them out loud rather than drop them. The harness computes
            the number from the payload; this literal is what the live region is
            checked to be talking about.

            NINE NOW ON EVERY YEAR, which it was not before. Crosswalked onto
            the FSA composite this was 9 on a dd22 year and 11 on a dd17 one
            (Alaska's 02063 and 02066 post-date that vintage), out of 140
            unreachable in total. Drawn on its own polygons the vintage axis
            drops out of the question entirely. */
        unmatchedAtDefaultYear: 9,
      }),
      'fsa-lfp': Object.freeze({
        id: 'fsa-lfp',
        isDefault: true,
        label: 'FSA LFP boundaries',
        sel: '#btn-usdm-fsa-lfp',
        payload: 'usdm-counties-fsa-lfp.json',
        keySpace: 'fips',
        boundary: 'fsa-lfp-counties',
        /** FSA's own FOIA'd LFP boundary statistics: rectangular (every county
            in every week) and CT-clean, which is why it is the default — last
            button in the seg, and still the one `?dataset=` is elided at.
            MEASURED: drawn on its own polygons this is an EXACT identity —
            3,221 payload keys, 3,221 tileset ids, zero unmatched either way.
            Through the FSA crosswalk it used to lose 131 counties. */
        rectangular: true,
        unmatchedAtDefaultYear: 0,
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

    /** THE WEEKLY POLYGONS, drawn over the choropleth — the only control in the
        app that adds a second body of geometry rather than recolouring the
        first. Off by default, so `?polygons` is elided at rest, and remembered
        per view by the generic choice machinery (hence `lsKey`, which is the
        LS.choice template filled in, not a key of its own invention).
        `sectionSel` is the drawer section the switcher must hide with the rest
        of the drought monitor's controls when another view is on screen.

        THE IDS HERE ARE THE APP'S OWN, AND THAT IS WHY THEY MAY BE LITERALS.
        This harness holds no KIT layer id anywhere, deliberately (see the CONFIG
        block in tools/verify.mjs): from kit v0.4.0 the tiled path keeps more
        than one archive resident, the county layer ids carry a stack-slot suffix
        (`sfsa-county-fill#0`), and they MOVE when the front does — while a
        retired stack stays transparent rather than hidden and therefore still
        answers `queryRenderedFeatures`, so a stale literal would not fail
        loudly, it would quietly measure the archive the reader stopped looking
        at. `ngp-usdm-overlay` and `ngp-usdm-overlay-fill` are not that kind of
        id: js/usdm-overlay.js creates exactly one of each, they never move
        between stacks, and they have the same standing as a DOM id in
        index.html — frozen contract with the app, changed here in the commit
        that changes it there. What is still asked for at the moment of use is
        the ANCHOR the overlay sits under, which IS the kit's; that is why the
        z-order assertion reads `handle.layers` in-page and takes nothing but
        the app's own id from this file.

        `deepLinkIso` is the FROZEN fixture, and it has to be frozen: the archive
        gains a date every Thursday, so a gate that drove "the latest week" would
        be asserting against a moving target. Week 30 of 2012 is the Tuesday
        2012-07-24 on the sidecar's own gapless weekly grid — 2012 holds 52
        Tuesdays, Jan 3 through Dec 25 — which is the same fixture `deepLink`
        above already lands on.

        `liveClause` and `legendClause` are COPY CONTRACTS, in the pattern of
        `yearDomain.clampSays`: what a reader who cannot see the map must be told
        while a second geometry is drawn over the first. The wording is the
        app's; these patterns only insist that it is said.

        THE `opacity*` ENTRIES ARE THE STRENGTH SLIDER, which appears with the
        polygons and not before them — `opacityWrapSel` is the wrap whose
        `hidden` says so, and it is narrower than `sectionSel` on purpose, the
        way `#elig-source-wrap` is narrower than the eligibility section. The
        param is emitted only while the overlay is actually drawn and elided at
        `opacityDefault`, so a drought-monitor URL at rest still carries neither.
        `opacityDefault` is a PERCENTAGE, which is the reader's unit and the
        <output>'s; the paint property it drives is the same number over 100,
        which is what an assertion reading `getPaintProperty` has to compare
        against.

        `fuse` IS THE FUSED WEEK CUTOVER'S WITNESS PAIR, and every value in it
        was MEASURED rather than chosen (2026-08-27):

          · the two weeks are adjacent Tuesdays on the sidecar's own gapless
            grid — week 30 and week 31 of 2012, 2012-07-24 and 2012-07-31.
            `fromIso` is deliberately the same frozen fixture `deepLinkIso` and
            `deepLink` already land on;
          · they are a usable pair: read straight out of
            usdm-counties-fsa-lfp.json (week0 2000-01-04, indices 655 and 656),
            415 of the archive's 3,221 counties change drought class between
            them;
          · `countyId` 20153 is Rawlins County, Kansas — D3 in the first week and
            D4 in the second, which is `fromColor` #e60000 to `toColor` #730000
            in js/interfaces/usdm.js's CLASS_COLORS. A big, rectangular plains
            county, so the bbox centroid the kit computes lands inside it, and
            the two weekly TopoJSONs (5 features each, D0–D4, 833 and 942 arcs,
            738 KB and 785 KB raw / 249 KB and 264 KB over the wire) both cover
            that centroid with exactly one polygon — which is what lets ONE
            point on the map answer for both halves of the picture;
          · `leadTicks` is a sampling rail, not a design constant, and § 8e's
            check says exactly what it bounds. */
    overlay: Object.freeze({
      sectionSel: '#usdm-polygons-seg',
      offSel: '#btn-polygons-off',
      onSel: '#btn-polygons-on',
      param: 'polygons',
      lsKey: 'sfsa-ngp-polygons-usdm',
      sourceId: 'ngp-usdm-overlay',
      fillLayerId: 'ngp-usdm-overlay-fill',
      opacityWrapSel: '#usdm-opacity-wrap',
      opacityRangeSel: '#opacity-range',
      opacityOutSel: '#opacity-out',
      opacityParam: 'opacity',
      opacityLsKey: 'sfsa-ngp-opacity-usdm',
      opacityDefault: 45,
      markerIso: /^\d{4}-\d{2}-\d{2}$/,
      deepLinkIso: '2012-07-24',
      indexUrl: 'https://data.sustainable-fsa.com/data-tiles/usdm/usdm-index.json',
      liveClause: /USDM drought polygons are drawn over the counties/,
      legendClause: /USDM's own weekly map, drawn as published/,
      fuse: Object.freeze({
        fromWeek: 30,
        toWeek: 31,
        fromIso: '2012-07-24',
        toIso: '2012-07-31',
        countyId: '20153',
        countyName: 'Rawlins County, Kansas',
        fromColor: '#e60000',
        toColor: '#730000',
        leadTicks: 5,
      }),
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

  eligibility: Object.freeze({
    slug: 'eligibility',
    label: 'LFP eligibility',
    isDefault: false,
    order: 3,
    switchLabel: '3 · LFP eligibility',
    switchSel: '#btn-view-eligibility',
    sectionSel: '#view-seg',

    /** MISSOULA AGAIN, and this time the choice needed checking rather than
        asserting. The rule for this field is a county with data in every
        boundary vintage; the rule for a THIRD view is also that the
        three-interface state-memory round trip can only prove the selection is
        the visitor's if all three views can show the same county.
        `30063` clears both, but its eligibility record is thin and that is a
        fact about the county, not a defect: FSA determined Missoula eligible in
        six program years only — 2015, 2016, 2021, 2023, 2024 and 2025 — 11
        Native Pasture events, 33 across all pasture types (measured against the
        published payload 2026-08-20). It has NO 2012 determination, which is
        why the deep link below is a 2024 one and not the 2012 the frozen
        contract sketched: a deep link whose card reads "not eligible" would
        assert the empty half of the card and nothing about a determination.

        A card on an ineligible county-year is still a state worth auditing —
        the section template lands on one at the app's clamped default year
        whenever the type has no determination — and the descriptor owes it the
        no-data facts in words. It is simply not what a DEEP LINK should be
        pointed at. */
    county: Object.freeze({ id: '30063', name: 'Missoula' }),

    /* THREE ANSWERS, and here the three disagree about more than county keys:
       what FSA determined (FOIA), what FSA published week by week (web), and
       what the statute's own rule yields when it is recomputed from the Drought
       Monitor (derived). All three are FSA-keyed — `counties` is a dictionary
       of 5-character FSA ids and the parallel `fips` column indexes a SEPARATE
       Census dictionary, so nothing here goes through the crosswalk. The fips
       key is card provenance, not a join.

       `events`/`sources` counts are measured, not assumed: the official archive
       really does carry only five event codes, because the D2 split that
       P.L. 119-21 introduced applies to program year 2026 and the FOIA response
       stops at 2025. */
    datasets: Object.freeze({
      official: Object.freeze({
        id: 'official',
        isDefault: true,
        label: 'FSA official (FOIA)',
        sel: '#btn-elig-official',
        payload: 'fsa-lfp-eligibility-events.json',
        keySpace: 'fsa',
        /** 105,719 events, 2,829 FSA counties, 5 event codes (D2 D3a D3b D4a
            D4b), program years 2008–2025 — and it is the only one of the three
            with a ceiling BELOW the app's shared default year, which is what
            makes the clamp below a real path rather than a hypothetical. */
        events: 5,
        hasPayments: true,
        /** MEASURED: 2,839 rows carry no qualifying date at all, every one of
            them in 2008–2011 (2008: 465, 2009: 322, 2010: 271, 2011: 1,781).
            The era's FOIA response reported when the drought BEGAN, not when a
            tier was satisfied, so for the duration tiers no satisfaction date
            is recoverable. Payment months, by contrast, are complete here: not
            one of the 105,719 rows is missing `pf`. */
        undatedRows: 2839,
      }),
      web: Object.freeze({
        id: 'web',
        isDefault: false,
        label: 'FSA weekly web',
        sel: '#btn-elig-web',
        payload: 'fsa-lfp-eligibility-web-events.json',
        keySpace: 'fsa',
        /** 135,253 events, 2,904 FSA counties, 7 event codes (the five above
            plus D2a_2026 and D2b_2026), program years 2008–2026. */
        events: 7,
        hasPayments: true,
        /** MEASURED, and the exact mirror image of the official archive's gap:
            every one of the 14,064 rows in 2008–2011 carries a qualifying DATE
            and no payment months at all (`pf` and `mepm` both null). So the
            ramp's index-0 chip — "eligible, months not stated" — is a WEB
            phenomenon before 2012, and the undated slate is an OFFICIAL one.
            Two different holes in the same four program years. */
        monthlessRows: 14064,
      }),
      derived: Object.freeze({
        id: 'derived',
        isDefault: false,
        label: 'Derived from USDM',
        sel: '#btn-elig-derived',
        payload: 'fsa-lfp-eligibility-derived.json',
        keySpace: 'fsa',
        events: 7,
        /** NO `mepm`, NO `pf`: this archive carries the drought factor the
            ladder awards and stops there, because the cap follows from the
            grazing period alone. `df` here is therefore NOT the payable
            amount, and the legend has to say so.
            452,114 rows — one per county × year × type × EVENT × source — in an
            11 MB payload, four times the size of either FSA one because it
            holds all four aggregations side by side. It is the slowest
            transition in the app; the switch waits on the app's own marker
            with CONFIG.switchMs (30s) rather than on a timeout. */
        hasPayments: false,
        rows: 452114,
        approxBytes: 11 * 1024 * 1024,
      }),
    }),

    /** THE FOURTH CONTROL — visible only on `derived`, because only that
        payload has a `sources` dictionary to choose from. The conventions are
        defensible readings of "any area of the county", and the archive
        publishes FOUR of them rather than picking one; the app OFFERS THREE and
        defaults to the same FSA-boundary convention the drought monitor
        defaults to, for the same reason (it is the geometry this map draws).

        `conventions` is what the select must offer, in the order it must offer
        them. `removed` is the fourth — the 2020 county set held fixed, still in
        the payload and still in the archive's downloads, deliberately not on
        this map — and it is here so the fallback can be checked: a `?source=`
        naming it must land on the default with a warning, exactly like any
        other value the app does not offer.

        `slug` is what `?source=` carries; the default is elided, and the param
        is DROPPED — not remembered in the URL — the moment the dataset stops
        being `derived`, because it would describe a control that is not on
        screen (the same rule pushState() applies to ?type and ?week). */
    source: Object.freeze({
      wrapSel: '#elig-source-wrap',
      selectSel: '#elig-source',
      param: 'source',
      default: 'usdm-counties-fsa-lfp',
      conventions: Object.freeze([
        Object.freeze({ id: 'usdm-counties-fsa-lfp', slug: 'usdm-counties-fsa-lfp', label: 'FSA LFP boundaries' }),
        Object.freeze({ id: 'usdm-counties-reported', slug: 'usdm-counties-reported', label: 'NDMC reported' }),
        Object.freeze({ id: 'usdm-counties', slug: 'usdm-counties', label: 'Census Counties' }),
      ]),
      removed: Object.freeze({
        id: 'usdm-counties-census-2020', slug: 'usdm-counties-census-2020',
        label: 'Census 2020',
      }),
      /** The payload's own order, which is what the decoder's `sources()` hands
          back and what `source[]` indexes — all FOUR of them, because the data
          is unchanged. Alphabetical, and neither the UI's order nor the UI's
          list: the select presents the three it offers most-relevant-first. */
      payloadOrder: Object.freeze(['usdm-counties', 'usdm-counties-census-2020',
        'usdm-counties-fsa-lfp', 'usdm-counties-reported']),
    }),

    /** The pasture-type control in this view's own terms. The dictionary is the
        payload's 15 types, and the first option is a SENTINEL rather than a
        type: "all types (worst case)" paints each county's best determination
        across every type it has one for, which is a different map — measured at
        program year 2024, 1,022 counties are eligible under some type against
        626 under Native Pasture, and 449 counties' best differs. */
    type: Object.freeze({
      selectSel: '#elig-type-select',
      default: 'Native Pasture',
      defaultSlug: 'native-pasture',
      count: 15,
      all: Object.freeze({ slug: 'all-types', label: 'All types (worst case)' }),
    }),

    /** TWO VARIABLES, and this view's own registry rather than color.js's:
        `months` is the payment months on the new drought-factor ramp, `date` is
        the qualifying date on the same cyclic wheel the grazing periods use.
        `?variable=` is validated against the ACTIVE view's registry, so
        `duration` (a grazing-period variable) is not a value here and falls
        back to the default with a console warning. */
    variables: Object.freeze({
      default: 'months',
      months: Object.freeze({ sel: '#btn-elig-months', kind: 'swatches' }),
      date: Object.freeze({ sel: '#btn-elig-date', kind: 'wheel' }),
      segSel: '#elig-variable-seg',
      /** A variable belonging to the OTHER view, used to assert the fallback in
          both directions. */
      alien: 'duration',
    }),

    /** Two legend bodies, one per variable — so `kinds`, like the grazing
        periods, rather than the drought monitor's single `kind`.

        `items` are the SUBSTRINGS each swatch row must contain, in order, with
        the no-data chip last. Substrings and not the full copy on purpose: the
        claim being gated is that every step of a colour ramp is also named in
        words (colour is never the only channel), not that a designer never
        rewrites a chip's punctuation. The index-0 chip is the categorical one —
        eligible, with no month count on the record — and it must not read as a
        sixth month. */
    legend: Object.freeze({
      kinds: Object.freeze({ months: 'swatches', date: 'wheel' }),
      items: Object.freeze(['1 month', '2 months', '3 months', '4 months',
        '5 months', 'months not stated']),
      noData: 'Not eligible this year',
    }),

    /** 2008 is the first LFP program year and the floor of all three payloads.
        THE CEILINGS ARE NOT LITERALS, and here that is load-bearing rather than
        tidy: the web and derived archives already carry 2026, the FOIA archive
        stops at 2025, and the whole point of the clamp is that ONE dataset's
        ceiling is lower than the app's shared default year. Both numbers are
        read from the live decoder, and the assertion is the inequality.

        `clampSays` is inherited from the grazing periods' copy contract (a
        clamp has to be said out loud, not merely happen); `officialSays` is
        this view's extra: the announcement must also say WHY 2026 is not
        available, which is that FSA has not published those determinations. */
    yearDomain: Object.freeze({
      min: 2008,
      clampSays: /adjust|clamp|moved|nearest|closest|earliest|latest|instead|outside|out of|does not (?:cover|go|reach|have)|only (?:goes|covers|reaches)|has not|not (?:yet )?published|no (?:\d{4} )?determinations/i,
      officialSays: /(?:has not|have not|not yet|no)\s+(?:\w+\s+){0,3}publish/i,
    }),

    /** The dataset id is in the filename because two datasets can produce the
        same year, type and variable and mean different things; the source slug
        is there only when there is a source to name (derived), which is what
        the optional group encodes. */
    exportName: /^fsa-lfp-eligibility_(official|web|derived)(_[a-z0-9-]+)?_\d{4}_[a-z0-9-]+_(months|date)\.png$/,

    /** 2024 rather than 2012 — see `county` above. Every param here is one the
        view must honour on load, and `?type=native-pasture` is deliberately a
        DEFAULT: the app is expected to resolve it against the eligibility
        dictionary and then drop it from the URL again. */
    deepLink: '?view=eligibility&year=2024&type=native-pasture&county=30063',

    /** What that link must produce, measured against the published official
        payload (2026-08-20). Missoula's 2024 Native Pasture determination has
        four events — D2 (Jul 9), D3a (Jul 16), D4a (Jul 23) and D4b (Aug 19) —
        and the best of them under the one comparator this app uses is D4b.
        Payment months are 5 and the cap did not bind (max eligible 5), so this
        card shows the whole ladder cleanly: drought factor 5, cap 5, payable 5.
        `months` is what the paint reads; `df`/`mepm` are the two rows beside it
        that a derived-dataset card cannot show. */
    deepLinkExpect: Object.freeze({
      year: 2024, vintage: 'dd22', type: 'Native Pasture',
      event: 'D4b', date: 'Aug 19, 2024', months: 5, df: 5, mepm: 5,
      events: 4,
    }),

    /** THE UNDATED ERA, as a fixture. On the official archive at program year
        2010, 247 FSA counties have a Native Pasture determination and 98 of
        them — measured — have no qualifying date on their best event. Colour
        the map by date and those 98 have nothing to place on the wheel, so they
        take the ramp's index-0 slate and the card says so in words. The
        counties named are three of the 98, any of which the probe may open. */
    undated: Object.freeze({
      dataset: 'official', year: 2010, variable: 'date',
      type: 'Native Pasture', counties: 247, undatedBest: 98,
      probeCounties: Object.freeze(['04015', '05027', '06035']),
      says: /not recorded|no(?:t)? (?:date|qualifying date)|undated|does not carry/i,
    }),

    /** The drought-factor ramp: six steps, loaded WITH this view rather than at
        boot (indexes 1–5 are the payment months, index 0 the categorical
        "eligible, months not stated" slate). Named here so the lazy-boot
        assertion can hold it to that, and so the undated probe can read the
        slate's hex from the asset instead of hard-coding a colour the app owns. */
    ramp: Object.freeze({ path: 'assets/colors-df.json', steps: 6 }),
    lazyAssets: Object.freeze(['assets/colors-df.json']),

    /** Row for row, EVERY qualifying event for the dataset, source, year and
        type on screen — not the per-county reduction the map paints, which is
        what `paintOracle` counts. Neither is a number typed here: at program
        year 2024 on Native Pasture the official archive holds 1,134 events in
        626 counties, at 2025 it holds 1,385 in 738, and the derived archive's
        conventions disagree with each other (3,821–3,833 events at 2012).
        The oracle reads whichever of those the app is actually showing.

        Under the all-types sentinel there is no single-type answer to give, so
        the oracle returns a REASON and the harness names the skip — the
        string/number convention documented in the field list above. */
    tableOracle: async (page) => oracle(await eligJoin(page), 'events'),
    paintOracle: async (page) => oracle(await eligJoin(page), 'painted'),
    /** The four counts the live region and the undated probe read: how many FSA
        counties the year's determinations reach at all (`eligible` — the
        reduction's own size, polygon or not), how many of those reached four or
        more payment months, how many carry a determination with NO month count
        (the web archive's 2008–2011 gap), and how many carry one with no
        qualifying DATE (the official archive's). The last two are different
        sets in different datasets, and each is what the ramp's index-0 slate
        means under one of the two variables. */
    eligibleOracle: async (page) => oracle(await eligJoin(page), 'eligible'),
    fourOracle: async (page) => oracle(await eligJoin(page), 'four'),
    slateOracle: async (page) => oracle(await eligJoin(page), 'slate'),
    /** Dateless counties that are also DRAWN — the count a colour histogram can
        be compared against. `dateless` alone includes counties the composite has
        no polygon for, and the difference between the two numbers is a boundary
        archive's coverage rather than anything about the paint. */
    datelessOracle: async (page) => oracle(await eligJoin(page), 'datelessPainted'),
    datelessAllOracle: async (page) => oracle(await eligJoin(page), 'dateless'),

    /** The three dataset toggles, the source select, the two variables, the
        all-types sentinel, the 2026 clamp, the undated era and the
        three-interface round trip are asserted in tools/verify.mjs § the LFP
        eligibility view's own controls — they need that file's paint-signature,
        marker and live-region probes, and this file must not assert. Every
        selector, fixture and measured count they read is in this entry. */
    extraChecks: null,
  }),

  disasters: Object.freeze({
    slug: 'disasters',
    label: 'Disaster designations',
    isDefault: false,
    order: 4,
    switchLabel: '4 · Disaster designations',
    switchSel: '#btn-view-disasters',
    sectionSel: '#view-seg',

    /** MISSOULA A FOURTH TIME, and for the fourth view the round-trip argument
        is the whole point: a four-stop excursion can only prove the SELECTION is
        the visitor's if every view can show the same county. Its designation
        record is a real one — measured against the published payload
        (2026-08-20), FSA designated Missoula for drought in nine program years,
        and at the fixture year below it carries six Secretarial drought
        designations, one of them Primary. */
    county: Object.freeze({ id: '30063', name: 'Missoula' }),

    /** ONE ARCHIVE, so no dataset control and no `?dataset` — the first view in
        the app with nothing to toggle between. `payload` is the basename the
        lazy-boot and lazy-fetch assertions look for; `payloadUrl` is the
        relative path the app itself fetches, and the oracle below re-reads it
        so its counts come from the archive rather than from the decoder that
        painted them.

        3,907 declaration amendments and 184,815 county rows: 2,959 Secretarial
        declarations (136,366 county rows) and 948 Presidential ones (48,449).
        FIPS-keyed, so every row arrives through the crosswalk. */
    payload: 'fsa-disasters.json',
    payloadUrl: '../fsa-disasters/fsa-disasters.json',
    keySpace: 'fips',

    /** ONE SLICE, AND NO CONTROLS AT ALL. This view is the SECRETARIAL DROUGHT
        designations — the LFP corner of the archive — and that is not a
        selection a visitor makes: the shared year is the whole of its state.
        It had two two-way segs (`#dis-decltype-seg`, `#dis-scope-seg`) with
        `?decl=` and `?disaster=` behind them until the map was narrowed to what
        it is about; the Presidential declarations and the other 21 disaster
        types are in the archive's downloads, which help.md cites. What the gates
        assert now is the ABSENCE: no drawer section of its own, no dataset seg,
        neither param in the URL, and neither retired preference key written.

        The two slugs below are the slice, and they are frozen here for one
        reason: the poster's filename still names it out loud
        (`fsa-disasters_<year>_secretarial_drought.png`, `exportName` above), and
        the oracle recomputes that same slice from the payload. */
    slice: Object.freeze({
      declType: 'Secretarial',
      droughtOnly: true,
      retiredParams: Object.freeze(['decl', 'disaster']),
      retiredKeys: Object.freeze(['sfsa-ngp-decl-disasters',
        'sfsa-ngp-disaster-disasters']),
      retiredSections: Object.freeze(['#dis-decltype-seg', '#dis-scope-seg']),
    }),

    /** Two roles, two colours, and the legend has to name both in words: the
        scheme is hue-only (the archive's own red/orange), so in grayscale the
        labels are the legend. `noData` is the phrase without its year — the app
        appends the selected one, which is the point of the chip. */
    legend: Object.freeze({
      kind: 'swatches',
      items: Object.freeze(['Primary', 'Contiguous']),
      noData: 'No designation in',
      /** The COPY CONTRACT for the key: a reader must be told that red is
          named-in-the-designation, that orange is a neighbour with the same
          access, and that grey is neither. The wording is the app's. */
      keySays: /named|primary/i,
      keyAlsoSays: /contiguous|neighbo/i,
      keyNoDataSays: /not designated|no designation/i,
    }),

    /** THE YEAR DICTIONARY IS 17 STRINGS AND TWO OF THEM ARE NOT YEARS: `"0"`
        (Presidential #4657, 84 county rows) and `"2011, 2012"` (Secretarial
        #S3229, 10 rows). Whether the second one contributes a 2011 to the
        domain is a judgement the payload does not settle — reading it as a range
        gives a 2011 floor, dropping it as unparseable gives 2012 — so the
        harness insists on the two things that are NOT judgements: the slider's
        domain is exactly what the decoder hands back, and its floor is one of
        those two answers rather than `0`. `max` is never a literal: the archive
        gains a program year every autumn. */
    yearDomain: Object.freeze({
      min: 2011,
      minIfJunkYearDropped: 2012,
      junkYears: Object.freeze(['0', '2011, 2012']),
      junkYearRows: 94,
    }),

    /** The slice is spelled out in the name even though it is now the only one
        this view can produce: a poster outlives the page, and the archive it
        came from holds two instruments and 22 disaster types. */
    exportName: /^fsa-disasters_\d{4}_secretarial_drought\.png$/,

    /** THE FIXTURE YEAR, chosen from the data rather than assumed — and 2021
        rather than the app's default 2026 for two independent reasons.
        MEASURED at 2021 on this view's one slice (Secretarial × drought):
        2,802 county rows under 148 declarations, 1,164 distinct FIPS keys
        reaching 1,168 FSA counties (918 Primary, 250 Contiguous), latest
        approval 2022-05-25.
          · Missoula has six designations there (five Contiguous and one
            Primary, #S5071), so the card and its list are a real record. It has
            NONE in 2026, and a deep link whose card reads "no designation" would
            assert the empty half of the card.
          · It is the only year whose Secretarial drought slice — the whole of
            what this view shows, so nothing has to be toggled to reach it —
            carries malformed county keys (see `junk`), which is what makes the
            verbatim and unmatched-count checks assertions about the state a
            visitor actually lands in. */
    fixture: Object.freeze({
      year: 2021,
      vintage: 'dd22',
      rows: 2802,
      declarations: 148,
      fips: 1164,
      designated: 1168,
      primary: 918,
      contiguous: 250,
      latestApproval: '2022-05-25',
      /** Missoula's own six, by declaration number, in approval order. The
          county's role is Primary because Primary beats Contiguous — within a
          county's rows and across the crosswalk alike. */
      county: Object.freeze({
        id: '30063',
        role: 'Primary',
        designations: 6,
        primary: 1,
        contiguous: 5,
        numbers: Object.freeze(['S5000', 'S5022', 'S5029', 'S5039', 'S5071',
          'S5085']),
        /** Every one of the six has a null `decl_end` — 103,757 of the archive's
            184,815 rows do — so this card is also the fixture for the copy that
            has to stand in for a date that was never reported. */
        endSays: /ongoing|not reported/i,
      }),
    }),

    /** VALUES VERBATIM, IRREGULARITIES INCLUDED — the archive's own policy
        (fsa-disasters README § the JSON payload), and therefore this app's. 72
        of the 3,306 FIPS keys are not five digits: they are the FSA portal's
        internal codes for tribal lands ("2810", "0010", "400", …), and 249
        county rows carry one. They match no crosswalk row, so they are excluded
        from the MAP and counted out loud — and they appear in the data table
        exactly as the archive spells them, because that table is the archive's
        text and not a cleanup of it.

        The two below are the whole of that population at the fixture year on
        this view's one slice. Each is a reservation the portal keys with a
        four-digit code and names in the county column; the state column is
        ordinary. (The other flavour of junk — a state column reading "Acoma" —
        lives on the Presidential side of the archive, which this map does not
        draw at all; it is described in help.md rather than gated here.) */
    junk: Object.freeze({
      rows: 2,
      fipsKeys: Object.freeze(['2810', '2715']),
      atFixture: Object.freeze([
        Object.freeze({ fips: '2810', county: 'Pine Ridge',
          state: 'South Dakota', role: 'Primary', declaration: 'S5094' }),
        Object.freeze({ fips: '2715', county: 'Pauma and Yuima',
          state: 'California', role: 'Primary', declaration: 'S5131' }),
      ]),
      /** The live region's own sentence about them. The number may honestly be
          either the count of KEYS or the count of ROWS (they are both 2 here and
          11 vs 22 on the Presidential slice), so the check accepts either and
          this pattern is what makes it a sentence about matching rather than a
          number that happens to appear. */
      unmatchedSays: /could not be matched|unmatched|no (?:county )?boundary/i,
    }),

    /** The data table's columns, in order — eleven of them, because a
        designation is not a value but a record: who named the county, under
        which declaration, for what, and over which three dates. Named here so
        the check can hold the table to the archive's own shape rather than to a
        count of <th> elements. */
    table: Object.freeze({
      columns: Object.freeze(['County', 'State', 'FIPS', 'Role', 'Declaration',
        'Type', 'Disaster', 'Description', 'Approved', 'Begin', 'End']),
      /** 103,757 of the 184,815 rows carry no end date at all. A blank cell
          would read as a value nobody entered; an em-dash reads as a date the
          source does not have. */
      nullDate: '—',
    }),

    /** THREE PARAMS THIS VIEW HONOURS, AND TWO IT MUST NOT. `decl` and
        `disaster` are the retired segs' params, and they ride along here
        deliberately: they are exactly the shape of a link somebody bookmarked
        before the map was narrowed to its one slice, and what has to happen to
        them is nothing — read by nobody, and gone from the address bar by the
        time the boot's own pushState has run (js/app.js § pushState builds the
        query from scratch). A check with no such link in front of it would be
        asserting that two absent params are absent. */
    deepLink: '?view=disasters&year=2021&county=30063'
      + '&decl=presidential&disaster=all',
    /** What that link must produce, all of it measured above. The two retired
        params produce nothing at all — see `slice.retiredParams`. */
    deepLinkExpect: Object.freeze({
      year: 2021, vintage: 'dd22',
      role: 'Primary', designations: 6,
      number: 'S5071', approval: 'Sep 3, 2021',
    }),

    /** Row for row, the county designations the table owes — every Secretarial
        drought row of the selected year, junk keys included, which is a LARGER
        number than the map's because several declarations reach one county and
        because some rows reach no county at all. `paintOracle` is the other one:
        the FSA counties the crosswalk reaches that the composite can draw. */
    tableOracle: async (page) => oracle(await disastersJoin(page), 'rows'),
    paintOracle: async (page) => oracle(await disastersJoin(page), 'painted'),
    /** The three counts the live region has to say out loud: how many counties
        were named directly, how many qualify as neighbours, and how many source
        rows reached no boundary at all. */
    primaryOracle: async (page) => oracle(await disastersJoin(page), 'primary'),
    contiguousOracle: async (page) => oracle(await disastersJoin(page), 'contiguous'),
    unmatchedOracle: async (page) => oracle(await disastersJoin(page), 'unmatched'),
    unmatchedRowsOracle: async (page) => oracle(await disastersJoin(page), 'unmatchedRows'),
    /** Everything at once, for the checks that compare several counts from one
        state of the app (and so must not re-read it four times). */
    joinOracle: async (page) => disastersJoin(page),

    /** The absence of controls, the fixture year's counts, the verbatim junk in
        the table, the unmatched count and the four-interface round trip are
        asserted in tools/verify.mjs § the disaster designations — they need that
        file's paint-signature, marker and live-region probes, and this file must
        not assert. Every selector, fixture and measured count they read is in
        this entry. */
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
      /* NO CROSSWALK REQUIRED, and its ABSENCE is now part of what this oracle
         proves. All three drought archives are drawn on the polygons their own
         numbers were computed against (js/boundaries.js), so their keys are the
         authority's ids and there is nothing to join. This function used to
         re-implement the crosswalk reduce; it now counts an identity, which
         makes it a STRONGER oracle than before — it no longer shares any code
         path with the descriptor it is checking. */
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

      /* The identity: a class code IS a colour for that polygon. `unmatched` is
         what the archive reports that the drawn authority does not have — the
         nine Connecticut planning regions on the reported set, the thirteen
         dropped territories on the Census set, and nothing at all on the LFP
         set, where the two id sets are identical. */
      const classed = new Map();
      const unmatched = [];
      for (const [id, code] of data.classesFor(j)) {
        if (code < 0) continue;               // '.' — not reported this week
        classed.set(id, code);
        if (!idx.has(id)) unmatched.push(id);
      }
      let painted = 0;
      for (const id of classed.keys()) if (idx.has(id)) painted++;
      return {
        j, week: m ? Number(m[1]) : null, weeks: m ? Number(m[2]) : null,
        classed: classed.size, painted, unmatched: unmatched.length,
        unmatchedSample: unmatched.slice(0, 5),
        geometry: idx.size, dataset: sel.dataset, year: sel.year,
        vintage: sel.vintage,
        // The DRAWN authority, which is the fact this oracle is really about.
        boundary: (typeof c.getBoundary === 'function' && c.getBoundary())
          ? c.getBoundary().key : null,
        crosswalkLoaded: !!xw,
      };
    } catch (err) {
      return {
        error: 'the join threw inside the app: ' + String(err).split('\n')[0],
      };
    }
  });
}

/**
 * The LFP eligibility reduction, counted independently of the descriptor that
 * painted it — the oracle behind `tableOracle` and `paintOracle`.
 *
 * These payloads are FSA-keyed, so there is no crosswalk to re-implement and
 * nothing to re-join: what this probe does instead is ask the live decoder for
 * the (year, type, source) slice the app says is on screen and count it two
 * ways. `painted` is the per-county reduction intersected with the geometry the
 * map holds — the number of counties that may carry a colour. `events` is every
 * qualifying event in that slice — the number of ROWS the table owes, which is a
 * different and larger number, because a county whose drought deepened through
 * the season reached several tiers and each one is a record.
 *
 * WHICH SLICE: the app's own selection, plus the source the view state names
 * (only `derived` has sources; the other two payloads have no such dictionary
 * and the decoder takes no index for them). The source is matched by name and
 * then by slug, so it does not matter whether the app carries the archive's own
 * id or a URL slug of it.
 *
 * NO SINGLE-TYPE ANSWER UNDER THE SENTINEL: "all types (worst case)" is not a
 * member of the payload's dictionary, and the reduction it produces is one
 * record per county drawn from up to fifteen types. `events` is therefore null
 * there, which the oracle turns into a named skip rather than a comparison
 * against a number that would mean something else.
 *
 * @param {import('playwright').Page} page
 * @param {string} defaultSource the documented default convention, used only
 *   when the app is on `derived` and exposes no source of its own.
 * @returns {Promise<object>} counts, or `{error}` if the view is not up yet.
 */
function eligJoin(page, defaultSource = 'usdm-counties-fsa-lfp') {
  // A THROW IS AN ANSWER — see usdmJoin above for why every branch here comes
  // back as data, including the failures.
  return page.evaluate(async (fallbackSource) => {
    try {
      const app = await import(new URL('js/app.js', document.baseURI).href);
      const c = app.ngpContext();
      const data = typeof c.getData === 'function' ? c.getData() : null;
      if (!data) return { error: 'the app has no active decoder' };
      if (typeof data.getYearType !== 'function' || typeof data.events !== 'function') {
        return { error: 'the active decoder is not an eligibility one (no events dictionary)' };
      }
      const sel = typeof c.getSelection === 'function' ? c.getSelection() : {};
      const vs = typeof c.getViewState === 'function' ? c.getViewState() : {};
      const idx = c.getCounties() ? c.getCounties().index : new Map();
      const slug = (s) => String(s).toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      const sources = typeof data.sources === 'function' ? (data.sources() || []) : [];
      let sourceIdx;
      if (sources.length) {
        const want = sel.source ?? vs.source ?? fallbackSource;
        sourceIdx = sources.findIndex((s) => s === want || slug(s) === slug(want));
        if (sourceIdx < 0) {
          return { error: `the source ${JSON.stringify(want)} is not one of `
            + JSON.stringify(sources) };
        }
      }

      const types = typeof data.types === 'function' ? (data.types() || []) : [];
      const single = types.includes(sel.type);
      let m;
      try { m = data.getYearType(sel.year, sel.type, sourceIdx); }
      catch (err) {
        return { error: 'the reduction threw: ' + String(err).split('\n')[0] };
      }
      if (!m || typeof m.forEach !== 'function') {
        return { error: 'getYearType did not hand back a Map' };
      }

      let painted = 0; let events = 0; let slate = 0; let four = 0;
      let eligible = 0; let dateless = 0; let datelessPainted = 0;
      for (const [id, rec] of m) {
        eligible++;
        const drawn = idx.has(id);
        if (drawn) painted++;
        if (rec && Array.isArray(rec.events)) events += rec.events.length;
        const best = rec && rec.best;
        if (best) {
          if (best.months === null || best.months === undefined) slate++;
          else if (best.months >= 4) four++;
          if (best.date === null || best.date === undefined) {
            dateless++;
            if (drawn) datelessPainted++;
          }
        }
      }
      return {
        eligible, painted, slate, four, dateless, datelessPainted,
        events: single ? events : null,
        singleType: single, type: sel.type ?? null, year: sel.year ?? null,
        dataset: sel.dataset ?? vs.dataset ?? null,
        source: sources.length ? sources[sourceIdx] : null,
        geometry: idx.size,
      };
    } catch (err) {
      return {
        error: 'the reduction threw inside the app: ' + String(err).split('\n')[0],
      };
    }
  }, defaultSource);
}

/**
 * The disaster designations for the year, declaration type and scope on screen,
 * joined onto the FSA composite — the oracle behind every count this view is
 * checked against.
 *
 * THIS ONE READS THE ARCHIVE, not the decoder. The other two oracles ask the
 * live decoder for a slice and re-implement only the reduce; here the whole
 * thing is recomputed from the published payload — fetched by the PAGE, so it is
 * the same bytes and the same relative URL the app resolved — through the app's
 * own crosswalk and geometry index. That is a stronger independence than the
 * other two have (a decoder that indexed the wrong year would agree with itself
 * but not with this), and it costs one 4 MB parse from localhost per call.
 *
 * WHICH SLICE: the one this view IS — Secretarial, drought — taken from the
 * entry's own `slice` and not from the page, because there is nothing on the
 * page to take it from any more. That is a weaker independence than reading two
 * `aria-pressed` attributes was (this oracle can no longer catch a view that
 * quietly painted the wrong instrument), and it is the honest one: the app's
 * only statement of the slice is now its own source, and an oracle that guessed
 * would be checking a guess. What still holds the app to the slice is the
 * poster's filename (`exportName`) and every count below.
 *
 * THE ONE RULE IT RE-IMPLEMENTS is the reduce: Primary beats Contiguous, within
 * a county's rows and again across the FIPS→FSA crosswalk, because a county
 * named directly in any designation is a Primary county however many
 * neighbouring roles it also holds.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<object>} counts, or `{error}` if the view is not up yet.
 */
function disastersJoin(page) {
  const E = INTERFACES.disasters;
  const sels = {
    url: E.payloadUrl,
    declType: E.slice.declType,
    droughtOnly: E.slice.droughtOnly,
  };
  // A THROW IS AN ANSWER — see usdmJoin above for why every branch here comes
  // back as data, including the failures.
  return page.evaluate(async (s) => {
    try {
      const app = await import(new URL('js/app.js', document.baseURI).href);
      const c = app.ngpContext();
      const xw = typeof c.getCrosswalk === 'function' ? c.getCrosswalk() : null;
      if (!xw) return { error: 'the crosswalk has not been fetched' };
      const sel = typeof c.getSelection === 'function' ? c.getSelection() : {};
      const idx = c.getCounties() ? c.getCounties().index : new Map();
      const vintage = (typeof c.getVintage === 'function' ? c.getVintage() : null)
        || sel.vintage;
      if (!vintage) {
        return { error: 'the app does not say which boundary vintage is drawn' };
      }
      const year = sel.year;
      const declType = s.declType;
      const droughtOnly = s.droughtOnly;

      const res = await fetch(new URL(s.url, document.baseURI).href);
      if (!res.ok) return { error: `the payload answered HTTP ${res.status}` };
      const P = await res.json();
      const yi = P.years.indexOf(String(year));
      if (yi < 0) {
        return { error: `the payload's year dictionary has no `
          + `${JSON.stringify(String(year))}` };
      }
      const dt = P.decl_types.indexOf(declType);
      if (dt < 0) return { error: `the payload has no ${declType} declarations` };
      /* /DROUGHT/i, the archive README's own convention — one exact code today,
         matched as a pattern because the dictionary is 22 uncleaned strings. */
      const drought = new Set();
      const re = new RegExp('DROUGHT', 'i');
      P.disaster_types.forEach((t, i) => { if (re.test(t)) drought.add(i); });

      const byFips = new Map();
      const decls = new Set();
      let rows = 0;
      let junkRows = 0;
      for (let i = 0; i < P.n; i++) {
        const d = P.decl[i];
        if (P.decl_year[d] !== yi || P.decl_type[d] !== dt) continue;
        if (droughtOnly && !drought.has(P.disaster_type[i])) continue;
        rows++;
        decls.add(d);
        const f = P.fips_codes[P.fips[i]];
        if (!/^\d{5}$/.test(f)) junkRows++;
        const rec = byFips.get(f) || { primary: 0, contiguous: 0 };
        if (P.code[i] === 0) rec.primary++; else rec.contiguous++;
        byFips.set(f, rec);
      }

      const byFsa = new Map();
      const unmatchedKeys = [];
      let unmatchedRows = 0;
      for (const [f, rec] of byFips) {
        const fsa = xw.toFsa(vintage, f);
        if (!fsa || !fsa.length) {
          unmatchedKeys.push(f);
          unmatchedRows += rec.primary + rec.contiguous;
          continue;
        }
        const role = rec.primary > 0 ? 'primary' : 'contiguous';
        for (const id of fsa) {
          byFsa.set(id, byFsa.get(id) === 'primary' ? 'primary' : role);
        }
      }
      let primary = 0; let contiguous = 0;
      let painted = 0; let primaryPainted = 0; let contiguousPainted = 0;
      for (const [id, role] of byFsa) {
        if (role === 'primary') primary++; else contiguous++;
        if (idx.has(id)) {
          painted++;
          if (role === 'primary') primaryPainted++; else contiguousPainted++;
        }
      }
      let latest = null;
      for (const d of decls) {
        const a = P.decl_approval[d];
        if (a === null || a <= 0) continue;   // the 1899-12-30 spreadsheet zero
        if (latest === null || a > latest) latest = a;
      }
      return {
        year, declType, droughtOnly, vintage,
        rows, declarations: decls.size, fips: byFips.size,
        designated: byFsa.size, primary, contiguous,
        painted, primaryPainted, contiguousPainted,
        unmatched: unmatchedKeys.length, unmatchedRows,
        unmatchedSample: unmatchedKeys.slice(0, 6), junkRows,
        latestApproval: latest === null ? null
          : new Date(Date.UTC(1970, 0, 1) + latest * 86400000)
            .toISOString().slice(0, 10),
        geometry: idx.size,
      };
    } catch (err) {
      return {
        error: 'the join threw inside the app: ' + String(err).split('\n')[0],
      };
    }
  }, sels);
}

/** An oracle's answer, or the reason there isn't one — the string/number
    convention documented in the probe table's field list. A null field is a
    reason too: it means the app is in a state the oracle deliberately does not
    speak for (the all-types sentinel), not that the count is zero. */
function oracle(join, field) {
  if (join.error) return join.error;
  if (join[field] === null || join[field] === undefined) {
    return `no ${field} oracle for ${JSON.stringify(join.type)} — this count is `
      + 'defined for one pasture type at a time';
  }
  return join[field];
}

/** The default view — the one whose slug is never emitted. */
export const DEFAULT_INTERFACE = Object.values(INTERFACES)
  .find((i) => i.isDefault) || null;

/**
 * The FIPS↔FSA crosswalk: a committed repo asset, not a staged payload.
 *
 * FIPS-keyed payloads — the nClimGrid climatology, all three USDM county sets
 * and the disaster designations — are joined onto the FSA composite through this
 * table, per vintage:
 * dd17 and dd22 do not hold the same county footprints, so a vintage swap
 * re-joins. The eligibility archives are deliberately NOT among them; they
 * carry both keys already (an LFP determination is made against both), so that
 * view paints FSA ids directly and reports the Census county as provenance. The
 * pair counts are the contract's: a legitimate archive rebuild that moves them
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
