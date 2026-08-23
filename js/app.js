/* ============================================================================
   LFP Explorer · js/app.js
   The application core: state, URL, map, the controls drawer, legend, county
   card.

   ES module, no build step. Everything shared comes from the Sustainable FSA
   house-style kit; everything app-specific comes from ./data.js and ./color.js.
   Two vendored globals must already exist when this module runs
   (window.maplibregl, window.topojson) — index.html loads them as classic
   scripts, which is why an ES module here is always second.

   ── Interfaces ─────────────────────────────────────────────────────────────
   This file paints no dataset of its own. Each data family the app can show is
   an INTERFACE DESCRIPTOR (js/interfaces/*.js, collected in
   js/interfaces/registry.js): a declarative core (id, label, datasets[]) plus
   the function-valued leaves that own everything only that family can know —
   colorsFor(), legend.kind()/legend.key(), tooltip(), cardRows(),
   liveSentence(), table.caption(), export.*. app.js owns the machinery around
   them: which view and dataset are active, the fetch, the controls, the map,
   and the readiness markers. Adding a family is a descriptor plus a drawer
   section, not surgery here — which is the whole point of the split.

   ── State model ────────────────────────────────────────────────────────────
   The URL is the primary state (HOUSE-STYLE §4). Read once at boot with
   precedence URL > localStorage(sfsa-ngp-*) > defaults, every value validated
   against a whitelist — a stored value gets exactly the same suspicion as a
   URL one, because another version of this app (or another app on the origin)
   may have written it. State is mirrored back on every mutation and on map
   moveend, and a view that is entirely at defaults emits a CLEAN url with no
   query string at all.

     ?view   interface slug (usdm | ngp | eligibility | disasters — switcher
             order; `ngp` is the DEFAULT and is therefore never emitted)
     ?dataset the active view's own dataset id (ngp: fsa | nclimgrid;
             usdm: census | reported | fsa-lfp; eligibility: official | web |
             derived; disasters: one archive, so this view never emits it)
     ?year   2000–2026, narrowed to the ACTIVE view's own domain
     ?week   1-based week WITHIN ?year, on a view that has weeks (usdm)
     ?type   pasture-type slug — read against the ACTIVE DATASET's dictionary
     ?source which county aggregation a dataset that publishes several is read
             at (eligibility's derived archive; dropped on every other dataset)
     ?variable the ACTIVE VIEW's own colour-by (ngp: start|end|duration;
             eligibility: months|date)   ?kbd    off (disables the / shortcut)
     ?county 5-character FSA id   ?export (N-W4)
     ?lng ?lat ?zoom  camera (all three or none)
     ?theme  light | high-contrast
     ?drawer closed — desktop only, and only when closed (the drawer defaults
             open, and on compact it is an overlay that always boots closed, so
             a compact session never emits it)

   ?view and ?dataset are elided at their defaults — the interface the registry
   NAMES as the default, and the dataset that interface's own list marks as one
   (js/interfaces/registry.js § DEFAULT_VIEW, defaultDatasetOf). Neither is
   positional: both segs are ordered for the reader, and the switcher opens on
   the drought monitor while the app boots on the grazing periods. So every URL
   minted before the app grew past one dataset still means exactly what it
   meant, and a reordered seg cannot change what a clean URL means. ?type is
   NOT elided on a non-default dataset: "full-season" is a real choice inside
   the climatology's own three-season dictionary, and dropping it would make
   the link mean "whatever that dataset defaults to next year". ?week is elided
   at ITS default, which is the last week of the selected year — the freshest
   map that year has, and for the current year the freshest there is.

   Only the ACTIVE view's params are emitted: a drought-monitor link carries no
   ?type, and a grazing-period link carries no ?week. Both are still remembered
   for the session, so switching back is a return rather than a reset.

   ?lng AND ?lat ARE NOT LONGITUDE AND LATITUDE. The composite is projected
   into EPSG:5070 (CONUS Albers) in the browser before MapLibre ever sees it —
   js/projection.js, which rescales Albers metres into a fixed 10 × 6.075 box of
   dummy degrees around (0, 0) — so the camera params are positions in THAT
   space. They are stable across sessions and across the 2015 vintage line
   (the rescale is hardcoded, not fitted per load), so a shared link still
   reproduces exactly the view it was copied from; what they are not is
   portable across the projection change itself. Camera deep links minted
   against the pre-Albers map land somewhere arbitrary and the app re-frames.
   ?county, ?year, ?week, ?type, ?variable, ?theme, ?kbd and ?drawer are
   unaffected.

   ── What this file does NOT do ─────────────────────────────────────────────
   The month-wheel legend, the county card's span chart, the on-demand data
   table and the branded PNG export are N-W4's, and they are wired through the
   documented seam at the bottom of this file — see `===== N-W4 FEATURES =====`.
   ========================================================================== */

/* ── Kit imports ─────────────────────────────────────────────────────────────
   Pinned at v0.2.1, like every kit reference in index.html and js/. Any bump
   or dev-state sweep is ALL-OR-NOTHING across all of them: two different
   core.js URLs are two module instances, and therefore two independent
   `viewport` pub-subs — the drawer would then be listening to a different
   viewport than the card. Recipe: README § Developing against an unreleased
   kit. */
import {
  createLiveRegion, getTheme, initThemeToggle, lsGet, lsSet, reducedMotion,
  replaceUrlState, showToast, urlParams, viewport,
} from 'https://sustainable-fsa.com/style/v0.4.0/core/core.js';
import {
  addFitControl, addNavigation, cameraParamsIfDefault, createCompositeMap,
  fitDefault, installZoomFloor,
} from 'https://sustainable-fsa.com/style/v0.4.0/map/map.js';
import {
  addCountyLayers, countyCentroid, initCountyTooltip, searchItems,
} from 'https://sustainable-fsa.com/style/v0.4.0/county/county.js';
import { initSearchBox } from 'https://sustainable-fsa.com/style/v0.4.0/ui/search.js';
import { initDetailCard } from 'https://sustainable-fsa.com/style/v0.4.0/ui/card.js';
import { initDrawer } from 'https://sustainable-fsa.com/style/v0.4.0/ui/drawer.js';
import { colorbar, swatches } from 'https://sustainable-fsa.com/style/v0.4.0/ui/legend.js';
import { initHelpModal } from 'https://sustainable-fsa.com/style/v0.4.0/ui/help.js';

/* js/data.js is the GRAZING-PERIOD family's facade, not the app's data layer
   (see § Live state): the search index, the county gazetteer and the type
   dictionary are read from it because they are FSA's own, and every other
   family reads its own instance through `activeData`. */
import {
  activeNgpDataset, allCountyIds, countyName, initData, setActiveNgpDataset,
  typeFromSlug, typeSlug, types,
} from './data.js';
import { NO_DATA, VARIABLES, loadRamps, ramps } from './color.js';
import { PROJECTED_BOUNDS } from './projection.js';
/* Which polygons a selection is allowed to be drawn on. The ONLY module that
   knows; app.js resolves a declaration and never a tileset name (§ Geometry). */
import {
  AUTHORITIES, boundaryFor, fsaVintageFor, loadBoundary, needsCrosswalk,
  prefetchBoundary,
} from './boundaries.js';
import {
  DEFAULT_VIEW, INTERFACES, aliasType, defaultDatasetOf, viewFromSlug,
} from './interfaces/registry.js';
import { loadDataset } from './decoders/common.js';
import { loadCrosswalk } from './decoders/crosswalk.js';

/* ── Constants ───────────────────────────────────────────────────────────── */

/** The WIDEST program-year bounds any interface answers for — the union of the
    registry's declared domains, and therefore the whitelist a `?year=` param is
    read against before anything knows which family will show it.

    Each interface's own narrower domain (`iface.years`) is what the slider is
    authored to, and the shared year is clamped into it when a family comes on
    screen — see applyYearDomain(). Grazing periods start in 2008; the drought
    monitor starts in 2000; they share this slider. */
const YEAR_MIN = INTERFACES.reduce((lo, i) => Math.min(lo, i.years.min), Infinity);
const YEAR_MAX = INTERFACES.reduce((hi, i) => Math.max(hi, i.years.max), -Infinity);

const DEFAULTS = Object.freeze({
  // The registry is ORDERED (the story's own order) and names its own default,
  // so the slug is not repeated here to drift out of date.
  view: DEFAULT_VIEW,
  // The latest year any family carries — and, deliberately, the same number for
  // every family, so `?year=` is elided at the default whichever one is on
  // screen and a shared link from either says the same thing about time.
  year: YEAR_MAX,
  type: 'Native Pasture',
  variable: 'duration',
});

/** localStorage keys. Everything app-owned is `sfsa-ngp-*` (kit AGENTS.md);
    the theme is the kit's own `sfsa-theme`, deliberately shared org-wide, and
    this app never writes it directly — initThemeToggle does.

    The namespace is `sfsa-ngp-*` for every interface, not just grazing periods:
    renaming it would orphan the preferences of everyone who has ever used this
    app. Two of the keys are per-interface / per-dataset and are built by the
    two functions below, so they stay collected here rather than being spelled
    out at their call sites. */
const LS = Object.freeze({
  view: 'sfsa-ngp-view',
  /** The remembered dataset of ONE interface. Per-interface so a stored value
      cannot leak across views, where the same id means something else. */
  dataset: (view) => 'sfsa-ngp-dataset-' + view,
  year: 'sfsa-ngp-year',
  /** `sfsa-ngp-type` keeps its original meaning — the OFFICIAL payload's
      pasture type — and every other dataset gets a key of its own, because one
      slug means different things to different dictionaries. A family whose
      datasets SHARE one dictionary (`typeScope: 'view'`) stores one type for
      the whole interface instead, under its view slug. */
  type: 'sfsa-ngp-type',
  typeFor: (scope) => 'sfsa-ngp-type-' + scope,
  /** Likewise the colour-by: `sfsa-ngp-variable` is the grazing periods' (it has
      always held one of their three), and a family with a registry of its own
      gets a key of its own — `duration` means nothing to a family that paints
      payment months, and a stored value gets the same suspicion as a URL one. */
  variable: 'sfsa-ngp-variable',
  variableFor: (view) => 'sfsa-ngp-variable-' + view,
  /** Which reading of a dataset that publishes several — per interface, for the
      same reason as the dataset key. */
  source: (view) => 'sfsa-ngp-source-' + view,
  /** One of a family's own enumerated choices (§ Enumerated choices), per
      interface and per choice — `sfsa-ngp-<choice>-<view>`, which means nothing
      to any other view. No shipped family declares a choice today, so nothing
      writes one; the disaster designations did until that map was narrowed to
      the single slice it is about, and the two keys it wrote
      (`sfsa-ngp-decl-disasters`, `sfsa-ngp-disaster-disasters`) are now read by
      nobody. A stale one in a returning visitor's storage is inert: every value
      here is re-validated against the family's own list on read, and a family
      with no list has nothing to validate. */
  choice: (view, id) => 'sfsa-ngp-' + id + '-' + view,
  drawer: 'sfsa-ngp-drawer',
  seenIntro: 'sfsa-ngp-seen-intro',
});

/** A well-formed FSA county key: five digits, leading zeros intact. County ids
    are STRINGS from end to end — no parse, no arithmetic, ever. */
const FSA_ID_RE = /^[0-9]{5}$/;

/** How long the year slider must rest before a boundary swap starts. Dragging
    2016 → 2010 crosses the FSA line once rather than six times — and on the
    Census authority it crosses FOUR annual vintages, which is the case that
    turns this from a nicety into the thing that keeps a drag cheap. */
const BOUNDARY_DEBOUNCE_MS = 250;

/** How long a scrubbed control must rest before the live region says what it
    landed on. A dragged week slider repaints every frame — announcing every
    frame would queue fifty sentences a screen reader then reads out one after
    another, long after the thumb has stopped. The repaint is immediate either
    way; only the SENTENCE waits. */
const LIVE_REST_MS = 350;

/* ── Element handles ─────────────────────────────────────────────────────── */

const $ = (sel) => document.querySelector(sel);

const els = {
  main: $('#main'),
  mapFrame: $('#map-frame'),
  map: $('#map'),
  note: $('#app-note'),
  drawer: $('#drawer'),
  drawerTab: $('#drawer-tab'),
  drawerScrim: $('#drawer-scrim'),
  btnDrawer: $('#btn-drawer'),
  year: $('#year-range'),
  yearOut: $('#year-out'),
  yearNote: $('#year-note'),
  week: $('#week-range'),
  weekOut: $('#week-out'),
  weekPrev: $('#btn-week-prev'),
  weekNext: $('#btn-week-next'),
  type: $('#type-select'),
  /* The eligibility family's own three controls. Its type select is separate
     because its options carry a sentinel ("All types") that is in no payload's
     dictionary, and the shared select's checks are the grazing periods'. */
  eligType: $('#elig-type-select'),
  eligSource: $('#elig-source'),
  eligSourceWrap: $('#elig-source-wrap'),
  segs: Array.from(document.querySelectorAll('.seg-btn[data-variable]')),
  viewBtns: Array.from(document.querySelectorAll('.seg-btn[data-view-btn]')),
  datasetBtns: Array.from(document.querySelectorAll('.seg-btn[data-dataset]')),
  /* Every button of every family's enumerated choices, in one list: each
     carries the choice's id and the value it selects (§ Enumerated choices). */
  choiceBtns: Array.from(document.querySelectorAll('.seg-btn[data-choice]')),
  search: $('#county-search'),
  results: $('#county-results'),
  btnTable: $('#btn-table'),
  btnExport: $('#btn-export'),
  btnShare: $('#btn-share'),
  btnTheme: $('#btn-theme'),
  btnInfo: $('#btn-info'),
  legendWheel: $('#legend-wheel'),
  legendBar: $('#legend-bar'),
  legendSwatches: $('#legend-swatches'),
  legendKey: $('#legend-key'),
  card: $('#county-card'),
  cardTitle: $('#card-title'),
  cardClose: $('#card-close'),
  cardRows: $('#card-rows'),
  cardContent: $('#card-content'),
  tooltip: $('#tooltip'),
  infoModal: $('#info-modal'),
  tableModal: $('#table-modal'),
};

/** Controls that mean nothing until the data has loaded. Disabled through boot
    and re-enabled together; the theme, help and drawer buttons are deliberately
    not in this list, because they work with or without data — an empty drawer
    you cannot open is worse than an empty drawer.

    The interface switcher and the dataset toggles are NOT in this list either,
    and for a sharper reason: switching away from a family or a dataset whose
    payload failed to load is the user's way out of the failure. A control that
    disables itself on error strands them there. */
const dataControls = [
  els.year, els.type, els.eligType, els.eligSource, ...els.segs, els.search,
  els.week, els.weekPrev, els.weekNext, ...els.choiceBtns,
  els.btnTable, els.btnExport, els.btnShare,
];

/* ── Live state ──────────────────────────────────────────────────────────── */

/** What every interface shares: which family is on screen, where in time and
    space we are, which county is open, and the theme. A switch between
    interfaces changes NONE of this — comparing two datasets on the same county
    in the same year is the app's reason to exist. */
const state = {
  view: DEFAULTS.view,
  year: DEFAULTS.year,
  type: DEFAULTS.type,
  variable: DEFAULTS.variable,
  countyId: null,
  theme: getTheme(),
};

/**
 * What each interface remembers for itself, so switching away and back is a
 * return rather than a reset.
 *
 * `type` and `nclimgridType` are two named fields rather than one map because
 * they mean different things: `type` is a name from the OFFICIAL payload's
 * sixteen-entry dictionary (and the one `sfsa-ngp-type` has always stored),
 * `nclimgridType` is one of the climatology's three seasons, seeded from the
 * official name through the registry's TYPE_ALIASES the first time the toggle
 * is pressed. `variable` is written here and read by the second interface,
 * which has a colour-by list of its own.
 */
const viewState = {
  ngp: {
    dataset: 'fsa',
    type: DEFAULTS.type,
    variable: DEFAULTS.variable,
    nclimgridType: null,
  },
  /**
   * The drought monitor: which of the three county sets is painted, and which
   * week within the shared year.
   *
   * `week` is 1-based WITHIN the year and null until the payload can say how
   * many weeks that year has (applyWeek). It is remembered for the session —
   * an excursion to the grazing periods and back returns to the week the reader
   * left — and it is NEVER persisted: a week is a selection, like the selected
   * county, and a returning visitor wants the latest map rather than the one
   * they happened to be reading last month.
   */
  usdm: {
    dataset: 'fsa-lfp',
    week: null,
  },
  /**
   * LFP eligibility: which of the three archives is painted, which pasture type
   * (ONE field, because all three share the fifteen-name dictionary — the
   * descriptor says so with `typeScope: 'view'`), which of its two colour-by
   * variables, and — for the derived archive alone — which aggregation
   * convention it is read at.
   *
   * `source` is null until a payload can say which conventions exist; it is
   * remembered across a toggle to another archive and back, and it is only ever
   * emitted into the URL while the archive that has conventions is the one on
   * screen.
   */
  eligibility: {
    dataset: 'official',
    type: DEFAULTS.type,
    variable: 'months',
    source: null,
  },
  /**
   * Disaster designations: one archive, read at one slice — the Secretarial
   * drought designations, which is what that map IS (js/interfaces/
   * disasters.js § ONE SLICE). So there is nothing here to remember but the
   * dataset, and nothing of this family's in the URL at all.
   *
   * `dataset` is here because every family has one and app.js finds the payload
   * through it; this family's is the only entry in its list, which is also why
   * `?dataset=` is never emitted on this view.
   */
  disasters: {
    dataset: 'fsa-disasters',
  },
};

let params = urlParams();
let kbdEnabled = true;
let pendingTypeSlug = null;     // held until the type dictionary exists
let pendingDatasetId = null;    // held until the default dataset has painted
let pendingViewId = null;       // held until the DEFAULT view has painted
let pendingWeekParam = null;    // held until the week domain exists
let pendingSourceSlug = null;   // held until the aggregation dictionary exists
let pendingYear = null;         // held when the boot view cannot show it
let pendingDrawerParam = null;  // 'open' | 'closed' | null, held until initDrawer

/** The active family's program-year range: which years the slider offers, and
    the whitelist setYear() enforces. Re-authored from the payload every time a
    family comes on screen (applyYearDomain); seeded from the boot view's
    declared domain in readInitialState, because `?year=` is read before any
    payload exists. */
let yearDomain = { min: YEAR_MIN, max: YEAR_MAX };

/* The decoded dataset on screen. It is held HERE, and mirrored into js/data.js
   (setActiveNgpDataset) for the grazing-period family only — that facade is
   `fsa-ngp-web/1`'s, by name and by surface: getYearType, getCountySeries,
   types. A drought-monitor instance answers none of those, so binding it there
   would break every consumer of the facade to serve one that does not want it.
   Every descriptor leaf is handed `activeData` explicitly instead, and the
   facade keeps meaning exactly what it has always meant.

   The crosswalk sits beside it, fetched only when a dataset needs it. */
let activeData = null;        // the instance the ACTIVE view is painting from
let crosswalk = null;         // FSA ⇄ FIPS, fetched only when a dataset needs it
let viewSeq = 1;              // monotonic; every fetch-involving switch bumps it

let map = null;
let mapLoaded = null;         // resolves on the map's own 'load' event
let fitOpts = null;
let counties = null;          // the loaded authority's index — see loadBoundary()
let boundary = null;          // the BoundaryRef `counties` came from
let boundarySeq = 0;          // monotonic; the in-flight race guard
let handle = null;            // addCountyLayers() handle
let zoomFloor = null;
let cardPushed = false;       // the card is a column, not an overlay — see revealSelectedCounty()
/* NO `vintage` GLOBAL. It used to be one, written from three places, and the
   fourth writer would have been the next bug — but more importantly the word
   now means two different things and only one of them is a global fact. The FSA
   program-year vintage is a pure function of state.year (fsaVintageFor), and
   what is DRAWN is `boundary`, which follows the dataset as well as the year.
   On the drought monitor the two are unrelated: a map on the 2011 Census
   counties still has an FSA vintage, because that is what indexes the
   crosswalk, and it is dd17. Conflating them would index the crosswalk with
   '2011' and match nothing. */
let boundaryTimer = null;
let searchCtl = null;
let drawerCtl = null;
let cardCtl = null;
let tableCtl = null;          // initTableView handle — invalidated on any switch
let bar = null;               // kit colorbar handle for #legend-bar
let chips = null;             // kit swatches handle for #legend-swatches
let live = null;
let booted = false;

/* ── The status pill ─────────────────────────────────────────────────────── */

/**
 * Show the pill over the map. role="status" on the element means every message
 * here is also announced, so this is the app's one channel for "what is
 * happening" — keep the wording a sentence, not a code.
 *
 * @param {string} text
 * @param {{tone?: 'info'|'error', retry?: (() => void)|null}} [opts]
 */
function note(text, { tone = 'info', retry = null } = {}) {
  els.note.replaceChildren();
  const span = document.createElement('span');
  span.textContent = text;
  els.note.appendChild(span);
  if (retry) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nav-btn';
    btn.textContent = 'Retry';
    btn.addEventListener('click', () => { clearNote(); retry(); });
    els.note.appendChild(btn);
  }
  els.note.dataset.tone = tone;
  els.note.hidden = false;
}

function clearNote() {
  els.note.hidden = true;
  els.note.replaceChildren();
  delete els.note.dataset.tone;
}

/** A failure the user can do something about: pill + Retry + a toast, because
    the pill sits over the map and a user looking at the navbar can miss it. */
function failNote(text, retry) {
  note(text, { tone: 'error', retry });
  showToast(text, 5000);
}

/* ── The active interface ────────────────────────────────────────────────────
   The handful of accessors every other function in this file reads the world
   through. They are functions rather than captured references because the
   answer changes mid-session (a view switch, a dataset toggle) and a stale
   descriptor would paint one family's data with another's scale. */

/** The descriptor for the family on screen. */
function currentInterface() {
  return viewFromSlug(state.view);
}

/** The active interface's own remembered state (dataset, types, variable). */
function activeViewState() {
  return viewState[state.view];
}

/** The dataset descriptor on screen: url, schema, keySpace, expectations. */
function activeDataset() {
  const vs = activeViewState();
  return currentInterface().datasets.find((d) => d.id === vs.dataset);
}

/** The id of the dataset a view shows when nothing has asked for another one —
    the one it DECLARES (never merely the first in its list), which is also the
    one whose absence from the URL means it. */
function defaultDatasetId(view) {
  return defaultDatasetOf(viewFromSlug(view)).id;
}

/**
 * The colour-by choices of ONE interface — its own registry, not the app's.
 *
 * js/color.js's VARIABLES are the grazing-period family's three (start, end,
 * duration). A family that paints another quantity declares its own, and
 * `?variable=`, the stored preference and the segmented buttons are all read
 * against whichever family is on screen. That is why an alien value cannot
 * survive a view switch: `duration` means nothing to the eligibility map and
 * `date` means nothing to the grazing-period one, and each falls back to its own
 * default with a warning rather than blanking a map.
 *
 * @param {object} iface an interface descriptor
 * @returns {object} name → {label, cyclic, …}
 */
function variablesOf(iface) {
  return (iface && iface.variables) || VARIABLES;
}

/** Which variable a family shows when nothing has asked for another one. */
function defaultVariableOf(iface) {
  return (iface && iface.defaultVariable) || DEFAULTS.variable;
}

/** Is this a variable THIS family can paint? */
function knownVariable(iface, name) {
  return !!name && Object.prototype.hasOwnProperty.call(variablesOf(iface), name);
}

/** Where one interface's remembered colour-by lives. The DEFAULT interface keeps
    the historical `sfsa-ngp-variable` (it is the one that has always written it,
    whatever position it now holds in the switcher); every other one gets a key
    of its own, because one name means different things to two registries. */
function variableLsKey(view) {
  return view === DEFAULTS.view ? LS.variable : LS.variableFor(view);
}

/**
 * Is this instance one js/data.js's facade can speak for?
 *
 * The facade IS the `fsa-ngp-web/1` surface, and it is asked of the INSTANCE
 * rather than of the view slug: the question is what it can do, not what it is
 * called. The four names below are the WHOLE test and every one of them is
 * load-bearing — `getYearType` and `types` are not enough, because the
 * eligibility decoder answers both of those about a completely different
 * quantity and answers `countyName`/`typeFromSlug` not at all. Binding one of
 * those to the facade would leave the county gazetteer (which everything from
 * the search box to the card title reads) pointing at a payload that has no
 * names in it.
 */
function isNgpShaped(instance) {
  return !!instance && typeof instance.getYearType === 'function'
    && typeof instance.types === 'function'
    && typeof instance.typeFromSlug === 'function'
    && typeof instance.countyName === 'function';
}

/**
 * The county authority a dataset declares, validated.
 *
 * A dataset with no declaration is a CONTRACT VIOLATION, not a case to default
 * quietly through: drawing an archive's numbers on the wrong county set is the
 * exact failure this machinery exists to prevent, and it looks perfect on
 * screen. So it is announced through console.error — which the audit harnesses
 * DO collect, unlike console.warn — and the map still draws on the authority
 * the program is administered on, so a reader is not left with a blank page
 * while the gate goes red.
 *
 * @param {object|null} ds a dataset descriptor entry
 * @returns {string} an id in js/boundaries.js § AUTHORITIES
 */
function authorityIdOf(ds) {
  const id = ds && ds.boundary;
  if (id && AUTHORITIES[id]) return id;
  console.error('[ngp] dataset ' + JSON.stringify(ds && ds.id) + ' declares no '
    + 'county authority (or an unknown one, ' + JSON.stringify(id) + '). Every '
    + 'dataset must name one in js/interfaces/*.js § DATASETS — see '
    + 'js/boundaries.js. Drawing "fsa".');
  return 'fsa';
}

/**
 * The `sel` argument every descriptor leaf takes: everything needed to paint or
 * describe the current view, in one plain object. Rebuilt per call — it is a
 * snapshot, never a live handle, so a leaf cannot mutate the app's state.
 *
 * @returns {{year: number, type: string, variable: string, dataset: string,
 *            source: string|null, vintage: string|null, authority: string,
 *            boundary: object|null, week: number|null, universe: number}}
 */
function selection() {
  const vs = activeViewState();
  const iface = currentInterface();
  const sel = {
    year: state.year,
    type: state.type,
    variable: state.variable,
    dataset: vs.dataset,
    // Which reading of a dataset that publishes several — null for every
    // dataset that publishes one, so a leaf can tell "the only answer" from
    // "the answer they chose".
    source: iface.controls.source ? (vs.source || null) : null,
    // THE FSA PROGRAM-YEAR VINTAGE, and only that. It is what indexes the
    // crosswalk (js/decoders/crosswalk.js is built per FSA vintage), and it is
    // now INDEPENDENT of what is drawn: a drought map on the 2011 Census
    // counties has no FSA vintage in play at all, and a leaf that reached for
    // the DRAWN authority's vintage here would index the crosswalk with '2011'
    // and match nothing. What is drawn is `boundary`, below.
    vintage: fsaVintageFor(state.year),
    // Absolute index into a weekly payload's series, for the families that have
    // one; null for the families that do not, so a leaf can tell "no week" from
    // "week zero" (which is a real week — 2000-01-04).
    week: iface.controls.week ? absoluteWeek() : null,
    // How many counties the GEOMETRY on screen has. The denominator for a
    // family whose live-region sentence is about the map rather than about its
    // own payload: an archive naming 2,829 counties out of the 3,095 a reader
    // is looking at must not report "1,208 of 2,829" as if the rest had been
    // asked. Zero before the boundaries land.
    universe: counties ? counties.index.size : 0,
    // WHICH COUNTY AUTHORITY this dataset's numbers were computed against, and
    // the one published tileset that answers for it at this year. Two fields
    // because two questions: `authority` is what the DATA says, `boundary` is
    // where it lands. Resolved here so every descriptor leaf reads the same
    // answer the map is drawing (js/boundaries.js).
    authority: authorityIdOf(activeDataset()),
  };
  sel.boundary = boundaryFor(sel);
  // Whatever enumerated choices the active family declares, by name — so a
  // descriptor leaf reads its own slice off `sel` exactly the way it reads
  // `sel.year`. Every shipped family declares none today and therefore carries
  // none (§ Enumerated choices).
  for (const choice of choicesOf(iface)) {
    sel[choice.id] = choiceValue(iface, choice.id);
  }
  return sel;
}

/**
 * The remembered pasture type for one dataset of the active view.
 *
 * Two shapes, and the DESCRIPTOR says which: a family whose datasets have
 * disjoint dictionaries remembers one type per dataset (grazing periods — FSA's
 * sixteen pasture types against the climatology's three seasons), and a family
 * whose datasets share one dictionary remembers one type for the whole
 * interface (`typeScope: 'view'` — the three eligibility archives are the same
 * fifteen names three times).
 */
function rememberedType(datasetId) {
  const vs = activeViewState();
  if (currentInterface().typeScope === 'view') return vs.type;
  return datasetId === 'nclimgrid' ? vs.nclimgridType : vs.type;
}

function rememberType(datasetId, name) {
  const vs = activeViewState();
  if (currentInterface().typeScope === 'view') vs.type = name;
  else if (datasetId === 'nclimgrid') vs.nclimgridType = name;
  else vs.type = name;
}

/* ── URL + persistence ───────────────────────────────────────────────────── */

/**
 * Read the boot state: URL param > localStorage > default, each validated.
 *
 * Three values cannot be finished here. The pasture type's dictionary of valid
 * names arrives with the payload, so its slug is parked in `pendingTypeSlug`
 * and resolved in applyPendingType() (or, for a dataset that is not the boot
 * one, in resolveTypeFor()); a non-default dataset is parked in
 * `pendingDatasetId` and applied as a toggle once the default has painted, so
 * boot still fetches exactly one payload; and the drawer's open/closed state
 * belongs to a controller that does not exist until wireControls(), so it is
 * parked in `pendingDrawerParam` and handed over as initDrawer's `startOpen`.
 */
function readInitialState() {
  params = urlParams();

  // ?kbd=off is an accessibility opt-out (WCAG 2.1.4) and is NOT persisted:
  // it rides the URL so a user who needs it can bookmark it.
  kbdEnabled = params.get('kbd') !== 'off';

  // The view first: the registry IS the whitelist, and every whitelist below
  // is the chosen view's own, so the order is not optional.
  //
  // A non-default view is PARKED rather than adopted, exactly like a non-default
  // dataset: boot draws the default family from the one payload it fetches, and
  // the requested family then arrives as an ordinary switch at the end of
  // loadAndRender — the same code path, including its failure handling, that a
  // click on the switcher runs.
  const rawView = String(params.get('view') ?? lsGet(LS.view) ?? '').toLowerCase();
  const iface = viewFromSlug(rawView) || viewFromSlug(state.view);
  if (iface.id !== state.view) pendingViewId = iface.id;   // the descriptor's id

  const rawDataset = String(params.get('dataset') ?? lsGet(LS.dataset(iface.id)) ?? '')
    .toLowerCase();
  if (iface.datasets.some((d) => d.id === rawDataset)
      && rawDataset !== defaultDatasetId(iface.id)) {
    // For the BOOT view this is a toggle to run once the default has painted;
    // for a parked view it is simply what that family will come up showing.
    if (pendingViewId) viewState[iface.id].dataset = rawDataset;
    else pendingDatasetId = rawDataset;
  }

  const rawYear = params.get('year') ?? lsGet(LS.year);
  // Number() on a PROGRAM YEAR, never on a county id. Validated against the
  // REQUESTED family's domain: 2004 is a real year of the drought record and no
  // year at all for grazing periods, so which one is asked for decides.
  const year = Number(rawYear);
  if (Number.isInteger(year) && year >= iface.years.min && year <= iface.years.max) {
    state.year = year;
  }

  // The slider the boot render authors is the BOOT view's. When the requested
  // year is outside it, the boot render clamps and the parked view adopts the
  // real one when its payload lands (applyYearDomain).
  yearDomain = { ...currentInterface().years };
  if (state.year < yearDomain.min || state.year > yearDomain.max) {
    pendingYear = state.year;
    state.year = Math.min(yearDomain.max, Math.max(yearDomain.min, state.year));
  }

  // 1-based week WITHIN the selected year, for a family that has weeks. Its
  // upper bound is the year's own length in the payload, so like `?type=` the
  // raw value is parked until the data can say (applyWeek).
  const rawWeek = params.get('week');
  pendingWeekParam = rawWeek == null ? null : String(rawWeek);

  // The colour-by is read against the REQUESTED family's own registry: `date`
  // is a real choice on the eligibility map and no choice at all on the grazing
  // periods, so which family is being asked for decides what the value means.
  // A parked family's choice goes into ITS remembered state and is adopted when
  // the switch lands (adoptVariable); the boot family's is the live one.
  const rawVar = (params.get('variable')
    ?? lsGet(variableLsKey(iface.id)) ?? '').toLowerCase();
  if (knownVariable(iface, rawVar)) {
    if (pendingViewId) viewState[iface.id].variable = rawVar;
    else state.variable = rawVar;
  } else if (rawVar) {
    console.warn('[ngp] ' + JSON.stringify(rawVar) + ' is not a colour-by '
      + iface.label + ' offers — falling back to '
      + JSON.stringify(defaultVariableOf(iface)) + '.');
  }

  // The family's own enumerated choices. Static lists, so unlike a type slug or
  // a week these need no payload and are resolved here — for the family being
  // ASKED FOR, whose remembered state a parked switch will then come up on.
  readChoices(iface);

  // A type slug means whatever the ACTIVE DATASET's dictionary says it means,
  // so it is read from that dataset's own stored key and resolved against that
  // dataset's own list — never against the one that happens to boot first.
  const wantDataset = pendingViewId
    ? viewState[iface.id].dataset
    : (pendingDatasetId || defaultDatasetId(state.view));
  const rawType = params.get('type') ?? lsGet(typeLsKeyFor(iface, wantDataset));
  pendingTypeSlug = rawType == null ? null : String(rawType).toLowerCase();

  // Which reading of a dataset that publishes several. Parked like the type
  // slug: the dictionary of conventions arrives with the payload, and only the
  // family that HAS one can consume this.
  const rawSource = iface.controls.source
    ? (params.get('source') ?? lsGet(LS.source(iface.id))) : null;
  pendingSourceSlug = rawSource == null ? null : String(rawSource).toLowerCase();

  // A selection is not a preference: it comes from the URL only.
  const rawCounty = params.get('county');
  if (rawCounty != null && FSA_ID_RE.test(rawCounty)) state.countyId = rawCounty;

  // Whitelisted like every other param; anything else (including the absent
  // case) leaves the drawer to its own default — stored preference, then open.
  const rawDrawer = String(params.get('drawer') ?? '').toLowerCase();
  pendingDrawerParam = (rawDrawer === 'open' || rawDrawer === 'closed') ? rawDrawer : null;

  state.theme = getTheme();   // already validated + stamped by the anti-flash boot

  // The active family's own memory starts where the shared state does; from
  // here setVariable/setType write to both.
  activeViewState().variable = state.variable;
}

/**
 * Where one dataset's remembered type lives.
 *
 * The first dataset of the first view keeps the historical `sfsa-ngp-type`;
 * every other DATASET of a per-dataset family gets a key of its own; and a
 * family whose datasets share one dictionary (`typeScope: 'view'`) gets one key
 * for the whole interface. Written as a function of the interface rather than of
 * `state.view` so readInitialState can ask it about a family that is not on
 * screen yet.
 */
function typeLsKeyFor(iface, datasetId) {
  if (iface.typeScope === 'view') return LS.typeFor(iface.id);
  if (iface.id !== DEFAULTS.view) return LS.typeFor(iface.id + '-' + datasetId);
  return datasetId === defaultDatasetId(iface.id) ? LS.type : LS.typeFor(datasetId);
}

/** The active family's key, for the call sites that are already on screen. */
function typeLsKey(datasetId) {
  return typeLsKeyFor(currentInterface(), datasetId);
}

/** Resolve `pendingTypeSlug` against the real dictionary. Anything unknown —
    a hand-edited URL, a type retired from the payload, a stale stored value —
    falls back to the default rather than blanking the map. */
function applyPendingType() {
  if (pendingTypeSlug) {
    const resolved = typeFromSlug(pendingTypeSlug);
    if (resolved) state.type = resolved;
    else console.warn('[ngp] unknown pasture type ' + JSON.stringify(pendingTypeSlug)
      + ' — falling back to ' + JSON.stringify(DEFAULTS.type));
  }
  pendingTypeSlug = null;
  rememberType(activeViewState().dataset, state.type);
}

/**
 * Mirror the whole view into the query string.
 *
 * Named for what it means to the app (push this state into the URL); it uses
 * the kit's replaceUrlState, i.e. history.replaceState, ON PURPOSE. This is
 * also called on every map `moveend`, and a real history.pushState there would
 * turn one pan across the country into forty back-button steps. The house
 * convention is one history entry per page visit, with the URL always current.
 */
function pushState() {
  const p = {};
  // The two scoping params come first because they scope every one below them —
  // and both are elided at their defaults, so an all-defaults view of the first
  // interface emits the same clean URL it always has. Only the ACTIVE view's
  // params are ever emitted: switching away drops the other family's.
  if (state.view !== DEFAULTS.view) p.view = state.view;
  const iface = currentInterface();
  const vs = activeViewState();
  if (vs.dataset !== defaultDatasetId(state.view)) p.dataset = vs.dataset;
  if (state.year !== DEFAULTS.year) p.year = String(state.year);
  // `type` and `variable` belong to a family that HAS those controls. They are
  // shared state (a switch away and back returns to them), but a drought map
  // carrying ?type=cool-season would describe a control that is not on screen
  // and mean nothing to anyone who opened the link.
  if (iface.controls.type && state.type !== DEFAULTS.type) p.type = typeSlug(state.type);
  // Elided at THIS family's default, not at the app's: `months` is the
  // eligibility map's default and `duration` the grazing periods', and a view
  // sitting on its own default emits no param either way.
  if (iface.controls.variable && state.variable !== defaultVariableOf(iface)) {
    p.variable = state.variable;
  }
  // Only while the dataset that HAS conventions is the one on screen: a link
  // carrying ?source= for an archive with one aggregation would describe a
  // control that is not there. The choice is still remembered for the session.
  if (iface.controls.source && activeData && activeDataset().hasSources) {
    const src = vs.source;
    if (src && src !== iface.source.defaultId(activeData)) p.source = src;
  }
  if (iface.controls.week) {
    // 1-based within the selected year, elided at its default (the year's last
    // week — which for the current year is the last week the record holds).
    const week = weekParam();
    if (week) p.week = week;
  }
  // The active family's own enumerated choices, each elided at its own default
  // and none of them emitted while another family is on screen — a param for a
  // control the reader cannot see would describe a different map. No shipped
  // family declares one, so this loop emits nothing (§ Enumerated choices).
  for (const choice of choicesOf(iface)) {
    const value = choiceValue(iface, choice.id);
    if (value !== choice.default) p[choice.id] = value;
  }
  if (state.countyId) p.county = state.countyId;
  // Camera params are emitted only when the camera has been moved off the
  // default fit, so an untouched view keeps a clean URL.
  if (map) Object.assign(p, cameraParamsIfDefault(map, { bounds: PROJECTED_BOUNDS, fitOpts }));
  if (state.theme !== 'light') p.theme = state.theme;
  if (!kbdEnabled) p.kbd = 'off';
  // The drawer is part of the VIEW on desktop, where closing it genuinely
  // changes what the map looks like and is worth carrying in a shared link.
  // Emitted only when closed (open is the default, so a default view stays
  // clean) and never on compact, where the drawer is a transient overlay that
  // force-closes on every entry into compact — a `closed` there would describe
  // the viewport, not the view.
  if (drawerCtl && !viewport.isCompact() && !drawerCtl.isOpen()) p.drawer = 'closed';
  replaceUrlState(p);
}

function persist() {
  const iface = currentInterface();
  const vs = activeViewState();
  lsSet(LS.year, String(state.year));
  // Per dataset: two dictionaries do not share names, and a season slug stored
  // under `sfsa-ngp-type` would read as an unknown pasture type on the next
  // boot and quietly fall back to the default. A family with no type control at
  // all writes nothing here — the type on screen is the OTHER family's, and
  // storing it against this one's dataset key would be a lie about both.
  if (iface.controls.type) lsSet(typeLsKey(vs.dataset), typeSlug(state.type));
  if (iface.controls.variable) lsSet(variableLsKey(state.view), state.variable);
  // The aggregation IS a preference — unlike the week, it is a way of reading
  // the data rather than a place in it, and a reader who chose the NDMC-reported
  // convention last month meant it.
  if (iface.controls.source && vs.source) lsSet(LS.source(state.view), vs.source);
  // A choice is a way of READING the archive rather than a place in it — like
  // the aggregation above and unlike the week — so it is a preference worth
  // remembering: a reader who came here for Presidential declarations meant it.
  for (const choice of choicesOf(iface)) {
    lsSet(LS.choice(state.view, choice.id), choiceValue(iface, choice.id));
  }
  lsSet(LS.view, state.view);
  lsSet(LS.dataset(state.view), vs.dataset);
  // The WEEK is deliberately absent: it is a selection, not a preference — the
  // same reason `?county=` is never stored. It rides the URL and the session's
  // per-view memory, and a new session opens on the latest week.
}

/* ── Painting ────────────────────────────────────────────────────────────── */

/**
 * Repaint the choropleth for the current selection.
 *
 * The colors are the active interface's to decide — a descriptor's colorsFor()
 * knows its own key space, and a FIPS-keyed dataset joins through the crosswalk
 * on its way here. What this function owns is the paint call and the honesty of
 * the sentence that follows it.
 *
 * The kit coalesces the actual feature-state writes to one flush per animation
 * frame, so calling this from a dragged slider is cheap on the GL side; the
 * cost here is one Map of ~3,000 colors, and the decoder memoizes the lookup
 * behind it.
 */
/**
 * The colours the current selection wants, and nothing else — no paint, no
 * announcement, no card refill.
 *
 * For the buffered boundary swap, which has to hand the arriving geometry its
 * choropleth before it is ever shown (§ swapBoundary). `selection()` already
 * resolves `boundary` to the INCOMING authority, because it derives it from the
 * year and the dataset rather than from what is drawn — so this is the picture
 * for the polygons that are about to arrive, computed on the polygons they were
 * computed against.
 *
 * Guarded rather than trusted: a descriptor leaf that throws here would take the
 * swap down with it and leave the reader on the old authority with a failure
 * note, when the honest degradation is "flip with the last colours, and let the
 * recolour after the flip throw where the harness can see it".
 *
 * @returns {Map<string, string>|null}
 */
function colorsNow() {
  if (!activeData) return null;
  try {
    return currentInterface().colorsFor(activeData, crosswalk, selection()).colors;
  } catch (err) {
    console.error('[ngp] could not compute the colours for the arriving county '
      + 'authority; flipping to it with the previous ones', err);
    return null;
  }
}

function recolor() {
  const data = activeData;
  if (!handle || !data) return;
  const { colors, unmatchedFips, stats } = currentInterface()
    .colorsFor(data, crosswalk, selection());

  // Ids with data but nothing to draw them on are REPORTED, not swallowed, and
  // there are two kinds: an FSA id with no polygon in this vintage (the island
  // territories are in neither boundary archive) and a FIPS id the crosswalk
  // cannot land on any FSA county. A summary that hides either is a summary
  // that lies.
  const unmatched = handle.recolor(colors);
  const missingFips = unmatchedFips ? unmatchedFips.length : 0;
  announceRender(colors.size - unmatched.length, unmatched.length + missingFips, stats);

  // The card is a readout of the same selection as the map.
  if (state.countyId) fillCard(state.countyId);
}

/**
 * The always-on half of the a11y twin: a short summary of what the canvas is
 * showing right now (HOUSE-STYLE §5.2), in the active interface's own words.
 * The on-demand table is the other half.
 *
 * `stats` is whatever the descriptor's own colorsFor() counted on its way
 * through the data — the numbers a join produces and nothing outside it can
 * recover (how many counties were classed, how many were absent, how many
 * source rows landed nowhere). Handed straight back to the descriptor that
 * produced it; this file never reads it.
 *
 * A one-shot `noticeText` rides in front of the sentence when the app has just
 * done something to the reader's selection on their behalf — clamping a year
 * into the arriving family's domain. It is announced ONCE, with the render it
 * belongs to, because a second announcement in the same breath is one the
 * screen reader drops.
 */
function announceRender(shown, missing, stats) {
  if (!live) return;
  const total = activeData ? activeData.allCountyIds().length : 0;
  let sentence = currentInterface()
    .liveSentence(selection(), shown, total, missing, stats);
  if (notice) sentence = notice + ' ' + sentence;
  if (liveResting) {
    // A scrub or a transition is in flight: hold the newest sentence and say it
    // when things stop moving. Held, not dropped — the reader still gets a
    // summary of where they landed, and the notice is still on the front of it,
    // because `notice` is cleared only where it is actually SPOKEN. A dataset
    // switch recolors twice (the clamp, then the arriving payload) and the
    // second sentence must not quietly drop the first one's explanation.
    liveHeld = sentence;
    return;
  }
  live.announce(sentence);
  notice = null;
}

/** Set by the one place that changes a shared selection without being asked to
    (clampYear). Consumed by the next announceRender. */
let notice = null;

/* The scrub-quiet state for the live region. See LIVE_REST_MS. */
let liveResting = false;
let liveHeld = null;
let liveTimer = null;

/**
 * Hold the live region until the control being scrubbed has rested.
 *
 * Called by the control, not by announceRender: only the control knows that
 * what is happening is one continuous gesture rather than a sequence of
 * separate answers.
 */
function deferAnnounce() {
  liveResting = true;
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    liveResting = false;
    if (liveHeld && live) {
      live.announce(liveHeld);
      notice = null;   // spoken at last — see announceRender
    }
    liveHeld = null;
  }, LIVE_REST_MS);
}

/* ── Legend ──────────────────────────────────────────────────────────────────
   The legend is the last section of the controls drawer, not a collapsible
   floating panel any more, so there is no collapse state to own here — only
   which of the three bodies (wheel, bar or swatches) is showing, and that
   answer belongs to the active interface's descriptor.

   The prose key is the redundancy channel that makes the map legible in
   grayscale, to a CVD reader, and to a screen reader. It is not decoration and
   it is never optional — which is why it lives with the data it describes
   (descriptor.legend.key) rather than in a switch statement here. */

/** Show the one legend body the active interface's scale calls for — the cyclic
    wheel, the linear colorbar, or the discrete swatches — and refresh the text
    key. Exactly one is ever unhidden: two visible bodies would be two legends
    for one map. */
function syncLegend() {
  const legend = currentInterface().legend;
  const sel = selection();
  const kind = legend.kind(sel);
  els.legendWheel.hidden = kind !== 'wheel';
  els.legendBar.hidden = kind !== 'bar';
  els.legendSwatches.hidden = kind !== 'swatches';
  els.legendKey.textContent = legend.key(sel);
  if (kind === 'swatches' && typeof legend.items === 'function') {
    // Built on FIRST USE, not at boot: the categories are the descriptor's, and
    // at boot there may not be a descriptor with any. The kit's swatches()
    // replaces the container's contents, so building it late costs nothing.
    const items = legend.items(sel);
    const noData = { color: NO_DATA(), label: legend.noDataLabel(sel) };
    if (!chips) chips = swatches(els.legendSwatches, items, { noData });
    else chips.update(items, { noData });
  }
  if (bar && kind === 'bar') {
    // The chip's LABEL is the descriptor's (the absence means something
    // different in each dataset); its color is the theme's, resolved live.
    bar.update(undefined, {
      noData: { color: NO_DATA(), label: legend.noDataLabel(sel) },
    });
  }
  notifyLegend();   // N-W4 seam: the wheel repaints for the new variable
}

function buildLegend() {
  bar = colorbar(els.legendBar, ramps().duration, {
    ticks: [
      { at: 0, label: '0 wk' },
      { at: 0.5, label: '26 wk' },
      { at: 1, label: '52 wk' },
    ],
    noData: {
      color: NO_DATA(),
      label: currentInterface().legend.noDataLabel(selection()),
    },
  });
  syncLegend();
}

/* ── The county card ─────────────────────────────────────────────────────── */

function addRow(dl, term, value, isNote) {
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  dd.textContent = value;
  if (isNote) dd.className = 'card-note';
  dl.append(dt, dd);
}

/**
 * Fill the card for one county at the current selection.
 *
 * The ROWS are the active interface's (descriptor.cardRows): what a reported
 * period, a missing one, or a crosswalked reduction should say is a fact about
 * the dataset, not about this file. The mechanics stay here unchanged —
 * replaceChildren() then one <dt>/<dd> pair per row — because card-content.js
 * watches #card-rows for exactly that mutation to know the readout moved.
 *
 * Two things this file still owns, because the descriptor cannot know them:
 * the county's NAME (the geometry's own gazetteer first, so a crosswalked
 * dataset that has never heard of an FSA id still names it) and whether there
 * is a polygon to draw it on at all — `hasGeometry` rides `sel` for that, and
 * the descriptor turns it into the row that says so.
 */
function fillCard(id) {
  const nm = nameOf(id);
  els.cardTitle.textContent = nm ? nm.county + ', ' + nm.state : id;

  const sel = { ...selection(), hasGeometry: !!(counties && counties.index.has(id)) };
  const dl = els.cardRows;
  dl.replaceChildren();
  for (const row of currentInterface().cardRows(activeData, crosswalk, sel, id)) {
    addRow(dl, row.term, row.value, row.isNote);
  }

  // The card's PICTURE is the descriptor's too, and js/card-content.js draws it
  // off the #card-rows rewrite above — which is why nothing here has to tell it
  // that the readout moved.
}

/**
 * Keep the selected county out from under the detail surface.
 *
 * Desktop: a camera pan cannot do this — at the default framing the viewport
 * already spans the whole composite and the maxBounds cage clamps any pan
 * after its one degree of slack (measured before the Albers change, when the
 * cage pad was the proportionally identical 6° of a 58°-wide box: 91px of the
 * 243 needed). So the card PUSHES
 * instead: `.card-pushes` narrows the #map canvas by the dock's width,
 * `map.resize()` reflows it, and then
 *   · at the default framing, an explicit fitDefault() re-frames the whole
 *     composite into the strip beside the card (narrowing LOWERS the fit
 *     zoom, so the kit's zoom floor sees nothing "below" and will not do
 *     this by itself);
 *   · zoomed in, the framing is the user's — only the residual overlap is
 *     panned away, which works there because a zoomed camera has cage slack.
 * The push is one-way while the card is open (once pushed, nothing can be
 * obscured, so it never un-pushes mid-selection and the map never jitters);
 * closing the card removes the class and resizes, and the kit zoom floor's
 * own resize handler springs the camera back to the full-width fit when the
 * user was at the floor (map.js § "a sidebar toggle IS the user asking to
 * re-fit"). Counties already in the clear move nothing and no push happens.
 *
 * Compact: the bottom sheet keeps the mesonet-style best-effort pan (ported
 * from revealSelectedDot); at the fit floor the cage limits it, but a phone
 * selection is a tap on a visible county, so the obscured case is rare.
 *
 * Card geometry is read from the LAYOUT box (offsetWidth/offsetHeight), which
 * the dock-in transform animation does not touch, so this is stable even when
 * it runs the frame the card opens.
 */
function revealSelectedCounty() {
  if (!map || !counties || !state.countyId || !cardCtl || !cardCtl.isOpen()) return;
  const feature = counties.index.get(state.countyId);
  if (!feature) return;
  const center = countyCentroid(feature);
  if (!center) return;

  const MARGIN = 32;
  const p = map.project(center);            // px, relative to the #map canvas

  if (viewport.isCompact()) {
    // The sheet is fixed to the viewport bottom; express its top edge in map
    // coordinates and pan up by the overlap — but never push the county out
    // the top instead.
    const mapRect = els.map.getBoundingClientRect();
    const sheetTop = (window.innerHeight - els.card.offsetHeight) - mapRect.top;
    let dy = p.y > sheetTop - MARGIN ? p.y - (sheetTop - MARGIN) : 0;
    dy = Math.min(dy, Math.max(0, p.y - MARGIN));
    if (dy) map.panBy([0, dy], { duration: reducedMotion() ? 0 : 350 });
    return;
  }

  if (!cardPushed) {
    const cardLeft = els.map.clientWidth - els.card.offsetWidth;
    if (p.x <= cardLeft - MARGIN) return;   // in the clear — stay an overlay
    // Read the floor BEFORE narrowing: both numbers are pre-push.
    const floor = zoomFloor && zoomFloor.fitZoom();
    const atFloor = Number.isFinite(floor) && map.getZoom() <= floor + 0.05;
    cardPushed = true;
    els.mapFrame.classList.add('card-pushes');
    map.resize();
    if (atFloor) {
      fitDefault(map, { bounds: PROJECTED_BOUNDS, fitOpts });
      if (zoomFloor) zoomFloor.refresh();
      return;
    }
  }
  // Pushed (now or already) with a user framing: the county may sit in the
  // strip the canvas just gave up — pan the residual back on-canvas.
  const q = map.project(center);
  const over = q.x - (els.map.clientWidth - MARGIN);
  if (over > 0) map.panBy([over, 0], { duration: reducedMotion() ? 0 : 350 });
}

/**
 * Open a county: select it on the map, fill the card, and optionally fly to it.
 *
 * @param {string} id 5-character FSA county id
 * @param {{fly?: boolean}} [opts]
 */
function selectCounty(id, { fly = false } = {}) {
  if (!FSA_ID_RE.test(String(id))) return;
  state.countyId = String(id);

  if (handle) handle.setSelected(state.countyId);
  fillCard(state.countyId);
  if (cardCtl) cardCtl.open();

  const feature = counties && counties.index.get(state.countyId);
  if (fly && feature) {
    const center = countyCentroid(feature);
    if (center) {
      // The county lands CENTRED, not offset for the docked card. Offsetting
      // the flight is the obvious polish and MapLibre's `padding` is the
      // obvious way to do it — but transform padding is STICKY: it outlives the
      // flight, the card's close, and every later fitBounds, so the fit control
      // would afterwards re-frame the whole country into the left two-thirds of
      // an empty map. Centred is already clear of the dock (the frame's centre
      // sits well left of the card), so the flight needs no reveal; the
      // non-flying paths get revealSelectedCounty() below instead.
      // 7.5, not the 5 this was before Albers: every zoom in this app shifted
      // when the rendered space did. The composite used to span 58.31° of
      // longitude and now spans exactly 10 dummy degrees (js/projection.js),
      // which is log2(58.31 / 10) ≈ 2.54 zoom levels tighter — so the old
      // "at least county-legible" floor of 5 is 5 + 2.54 ≈ 7.5 here.
      const camera = { center, zoom: Math.max(map.getZoom(), 7.5) };
      // Reduced motion means no ANIMATION, not no navigation: the county still
      // comes into view, it just arrives without the flight. Read live, per
      // WCAG 2.3.3 — the user can flip the OS setting mid-session.
      if (reducedMotion()) map.jumpTo(camera);
      else map.flyTo({ ...camera, speed: 1.2 });
    }
  } else {
    // A map click or a re-render selection must not leave the county hidden
    // under the surface that describes it. rAF: the card was unhidden this
    // task; measure it after layout has caught up.
    requestAnimationFrame(revealSelectedCounty);
  }

  notifyCountySelected(state.countyId);
  pushState();
}

/* ── Search ──────────────────────────────────────────────────────────────── */

/**
 * Name one county id, in the vocabulary of what is on screen.
 *
 * PAYLOAD FIRST, then the drawn authority, then FSA's own gazetteer. The payload
 * is first because the numbers in the card are its numbers and the reader should
 * see the county named the way the dataset names it — and because it is the only
 * precedence under which every surface of one card AGREES. That matters now:
 * the LFP determination boundaries carry the LSAD form ("Autauga County",
 * "Bethel Census Area") while every other authority carries the bare form, so
 * without one seam the card TITLE would read "Autauga County, Alabama" while a
 * card ROW read "Autauga, Alabama" — the same county, two names, an inch apart.
 *
 * Neither form is normalized, and neither should be: stripping a trailing type
 * word turns "Carson City" into "Carson", and appending one turns "Bethel
 * Census Area" into "Bethel Census Area County". They are the archives' own
 * strings, and the label changing when the reader switches authority is
 * information — it is the archive saying this is a different county set.
 *
 * @param {string} id a 5-character county id
 * @returns {{county: string, state: string}|null}
 */
function nameOf(id) {
  const key = String(id);
  const own = (activeData && typeof activeData.countyName === 'function')
    ? activeData.countyName(key) : null;
  if (own && own.county) return own;
  const geo = counties && counties.names.get(key);
  if (geo && geo.county) return geo;
  return countyName(key);
}

/**
 * Rows for the combobox: every county the DRAWN AUTHORITY has, plus every id
 * that is in the ACTIVE DATASET and has no polygon on it. A search that
 * silently omits the island territories tells the user they do not exist — and
 * one that offers FSA county codes on a map of Census counties tells them
 * something worse.
 */
function buildSearchItems() {
  const extras = [];
  const ids = (activeData && typeof activeData.allCountyIds === 'function')
    ? activeData.allCountyIds() : allCountyIds();
  for (const id of ids) {
    if (counties.index.has(id)) continue;
    const nm = nameOf(id);
    extras.push({ id, label: nm ? nm.county + ', ' + nm.state : id, code: id });
  }
  return searchItems(counties, extras);
}

/* ── Controls ────────────────────────────────────────────────────────────── */

function setControlsEnabled(on) {
  for (const el of dataControls) if (el) el.disabled = !on;
  // The year slider has a second reason to stay disabled that has nothing to do
  // with the load: a climatology dataset has no years to slide through.
  if (on) syncYearControl();
}

/**
 * The year slider only means something for a dataset with years in it. A
 * climatology is ONE set of periods standing for every program year, so the
 * slider is disabled and the note beside it says why — a thumb that moves and
 * changes nothing is worse than a thumb that does not move.
 *
 * `state.year` is deliberately left alone: switching back to a real time series
 * has to land on the year the user left, not on a default.
 */
function syncYearControl() {
  const nominal = !!activeDataset().nominalYears;
  els.year.disabled = nominal;
  els.yearNote.hidden = !nominal;
}

/**
 * Re-author the year slider's range from the payload that has just arrived, and
 * pull the shared year into it.
 *
 * The slider's range is authored in the HTML and the payload is the authority —
 * that much is unchanged from the day the app had one dataset. What is new is
 * that the answer MOVES: grazing periods run 2008–2026 and the drought monitor
 * runs 2000–2026, they share one slider, and the year is shared state that
 * survives the switch between them. So the domain follows the data, and a year
 * outside it CLAMPS to the nearest end rather than snapping to a default — the
 * reader asked for 2004, and 2008 is the closest this family can answer.
 *
 * A nominal-year dataset (a climatology) re-authors nothing: its payload
 * carries one year, which is not a domain, and its slider is disabled anyway.
 *
 * @param {object} instance the arrived decoder instance
 */
function applyYearDomain(instance) {
  if (!instance || typeof instance.years !== 'function') return;
  if (activeDataset().nominalYears) return;

  const list = instance.years();
  if (!list.length) return;
  const first = list[0];
  const last = list[list.length - 1];
  if (first < YEAR_MIN || last > YEAR_MAX) {
    console.warn('[ngp] the ' + activeDataset().id + ' payload carries ' + first
      + '–' + last + ', outside this app\'s ' + YEAR_MIN + '–' + YEAR_MAX
      + ' whitelist; ?year= outside that range will not be honoured.');
  }
  yearDomain = { min: first, max: last };
  els.year.min = String(first);
  els.year.max = String(last);

  // A year the SHARED slider could not hold at boot, because the family that
  // booted does not cover it. This one might: `?view=usdm&year=2004` boots on
  // grazing periods at 2008 and lands here on 2004.
  if (pendingYear != null) {
    const want = pendingYear;
    pendingYear = null;
    if (want >= first && want <= last) {
      setYear(want);
      return;
    }
  }
  clampYear();
}

/**
 * Why the year moved, in one sentence.
 *
 * The generic form is true of every family: the reader asked for a year this one
 * does not cover. A family with a SPECIFIC reason may say it instead
 * (`iface.clampNotice`) — "FSA has not published 2026 determinations" is
 * something a reader can act on, and "2026 is outside 2008–2025" is not. A
 * descriptor that returns nothing gets the generic sentence, which is also what
 * every family without the leaf gets.
 *
 * @param {number} from the year the reader asked for
 * @param {number} to the year they are getting
 * @returns {string}
 */
function clampSentence(from, to) {
  const iface = currentInterface();
  if (typeof iface.clampNotice === 'function') {
    const said = iface.clampNotice(from, to, selection());
    if (said) return said;
  }
  return from + ' is outside ' + iface.label + '\'s ' + yearDomain.min + '–'
    + yearDomain.max + ' range; showing ' + to + '.';
}

/**
 * Bring the shared year inside the active domain, saying so when it moves.
 *
 * Announced, not silent: the reader is looking at 2004 and about to be shown
 * 2008, and a map that changed year without a word is a map they will misread.
 * The sentence rides in front of the next render summary (announceRender), so
 * it is one announcement rather than two racing ones.
 */
function clampYear() {
  const want = Math.min(yearDomain.max, Math.max(yearDomain.min, state.year));
  if (want === state.year) return;
  notice = clampSentence(state.year, want);
  if (!booted) {
    // Boot: there is no layer handle to repaint, no card to refill and no URL
    // to rewrite from a half-read view. Set the year and let loadAndRender's
    // own sequence carry it — including the boundary, which it re-checks
    // against what it fetched. Nothing to write here any more: the drawn
    // authority is derived from the year and the dataset, not stored.
    state.year = want;
    els.year.value = String(want);
    els.yearOut.textContent = String(want);
    return;
  }
  // Hold the live region across the rest of this transition. Clamping happens
  // in the middle of a dataset switch, which recolors twice — once for the new
  // year here, once for the arriving payload — and only the LAST sentence is
  // heard. Holding it means the reader gets one announcement, and it is the one
  // that explains why the year moved.
  deferAnnounce();
  // Through setYear, so the boundary vintage, the URL, the stored preference
  // and the <output> all follow exactly as they do for a dragged thumb.
  setYear(want);
}

function setYear(next) {
  const year = Number(next);
  if (!Number.isInteger(year) || year < yearDomain.min || year > yearDomain.max) return;
  if (year === state.year) return;
  state.year = year;
  els.year.value = String(year);
  els.yearOut.textContent = String(year);
  // Before the URL and before the paint: a week is a position INSIDE the year,
  // so the year moving can shorten it (52 weeks against 53), and both the link
  // and the map have to describe the week that is actually selected.
  if (currentInterface().controls.week) syncWeekControl();
  persist();
  pushState();
  // The legend is re-asked on a YEAR change too, not only on a switch: a
  // family's no-data chip may name the year it is about ("No designation in
  // 2021" — js/interfaces/disasters.js § legendNoDataLabel), and a chip a year
  // behind the map is a legend that lies about the gray counties a reader is
  // looking at. It matters most where the year is the view's ONLY control, which
  // the disaster designations now are. Cheap and idempotent: the legend BODY
  // never changes with the year, only its words.
  syncLegend();

  // The drawn authority may follow the year on EITHER of its two axes — FSA's
  // 2015 split, or the Census annual vintage — and on most datasets it does not
  // move at all. ensureBoundary() answers all three cases from one comparison;
  // when it has nothing to do, the paint is ours.
  if (!ensureBoundary()) recolor();
}

/**
 * Bring the county authority the current selection DEMANDS onto the map.
 *
 * ONE FUNNEL, five callers. What is drawn now moves on a year change (the FSA
 * line at 2015; eighteen annual Census vintages), a dataset toggle, an
 * aggregation change and a view switch — four controls that used to have
 * nothing to do with geometry between them.
 *
 * DIFFING THE RESOLVED KEY rather than any of those inputs is what makes that
 * safe, and it is the whole design: 2016 → 2018 on the FSA authority resolves
 * to the same tileset twice and does nothing, and so does a toggle between the
 * two drought datasets that share fsa-lfp-counties. The common case is no work.
 *
 * @param {{immediate?: boolean}} [opts] immediate for a CLICK — a dataset,
 *        aggregation or view change is one decision, and making the reader wait
 *        250 ms for it would be a bug. Debounced for a SCRUB, because a year
 *        slider dragged 2016 → 2010 crosses four Census vintages and means one.
 * @returns {boolean} true when a swap was needed and is now under way. A caller
 *        that would otherwise paint uses this to decide whether the paint is
 *        its own job or the swap's.
 */
function ensureBoundary() {
  const want = selection().boundary;
  if (boundary && boundary.key === want.key) return false;
  clearTimeout(boundaryTimer);
  note('Switching to ' + want.label + '…');
  boundaryTimer = setTimeout(() => { swapBoundary(want).catch(() => {}); },
    BOUNDARY_DEBOUNCE_MS);
  return true;
}

/**
 * The same, awaited and undebounced — for a caller that must not paint until the
 * right polygons are underneath.
 *
 * A separate function rather than an option on ensureBoundary() because the two
 * differ in RETURN TYPE, and a function that sometimes returns a boolean and
 * sometimes a promise is a function every caller has to read twice. Callers
 * here are the decisions — a dataset toggle, a view switch — never a scrub.
 *
 * @returns {Promise<boolean>} whether a swap LANDED — and therefore whether it
 *        has already painted, refilled the card and announced. False covers
 *        both "no swap was needed" and "the swap did not land" (it lost a race,
 *        or it failed and left its own note), and in every one of those cases
 *        the paint is the caller's again. Same contract as ensureBoundary()'s,
 *        so both read `if (!…) recolor();`.
 */
async function ensureBoundaryNow() {
  const want = selection().boundary;
  if (boundary && boundary.key === want.key) return false;
  clearTimeout(boundaryTimer);
  note('Switching to ' + want.label + '…');
  return swapBoundary(want);
}

/**
 * Load one authority and put it on the map. Never call this directly — go
 * through ensureBoundary(), which is where the no-op case and the debounce are.
 *
 * TWO AWAITS, AND THE SECOND ONE IS THE POINT. The sidecar has to arrive, and
 * then the GEOMETRY has to arrive: since kit v0.4.0 the swap is double-buffered,
 * so `handle.swapVintage()` builds the incoming archive's own layers, paints
 * them with the colours handed to it while they are invisible, and resolves only
 * once it has flipped to them. Everything below the second await is therefore
 * describing what is ALREADY on screen — including `data-ngp-boundary`, which
 * says which authority a reader is looking at and used to be written a few
 * hundred milliseconds before it was true.
 *
 * WHY THE COLOURS TRAVEL WITH THE SWAP. The kit wipes feature state on the way
 * through (state is keyed by id and would otherwise survive onto a county that
 * changed shape), and a wipe whose repaint lands one frame later is a frame of
 * every county grey. Passing them fuses the two into one task. It also means the
 * arriving polygons are never painted with the OUTGOING dataset's numbers, and
 * the outgoing polygons are never painted with the arriving dataset's — which,
 * before v0.4.0, was a real ~100 ms window on every dataset switch, because
 * `setUrl()` clears its tiles when the new TileJSON resolves rather than when it
 * is called.
 *
 * @param {object} want a BoundaryRef
 * @returns {Promise<boolean>} whether it landed
 */
async function swapBoundary(want) {
  const seq = ++boundarySeq;
  try {
    // Already in the map's space, and loadBoundary() has ASSERTED that against
    // js/projection.js's own constants before returning it. There is no
    // client-side projection step on this path — the producer applied the very
    // transform projection.js documents, and its gate proves it to 1e-9.
    const next = await loadBoundary(want);

    // TWO GUARDS, not one, because there are two ways to lose this race.
    // The SEQUENCE kills a load that lost outright — dataset A → B → A hands
    // back A's index after B's, and B is what the reader asked for. The KEY
    // re-derivation is the old swapVintage guard generalised: the reader may
    // have dragged back across a vintage line while this was in flight, in
    // which case the answer is already on screen and this one is history.
    if (seq !== boundarySeq) return false;
    if (selection().boundary.key !== want.key) return false;

    const flip = await handle.swapVintage(next, { colors: colorsNow() });

    // BOTH GUARDS AGAIN. The geometry warm-up is the long part of this function
    // — a cold archive is a TileJSON resolution plus a screenful of tiles — and
    // a reader can drag the year twice inside it. The kit has its own race guard
    // and reports `superseded`; this one is the app's, and it is what stops the
    // card, the search index and the live region being re-authored for an
    // authority that lost.
    if (seq !== boundarySeq) return false;
    if (selection().boundary.key !== want.key) return false;
    if (!flip.flipped && !flip.reused) return false;

    boundary = want;
    counties = next;
    document.documentElement.dataset.ngpBoundary = want.key;

    // The handle drops a selection whose polygon is gone; the DATA for that
    // county is still real, so the card stays open and now says WHICH authority
    // is missing it.
    if (state.countyId) {
      if (next.index.has(state.countyId)) handle.setSelected(state.countyId);
      fillCard(state.countyId);
    }
    if (searchCtl) searchCtl.refresh(buildSearchItems());
    recolor();
    clearNote();
    return true;
  } catch (err) {
    if (seq !== boundarySeq) return false;
    console.error('[ngp] boundary swap failed', err);
    failNote('Could not load ' + want.label + '.', () => {
      swapBoundary(want).catch(() => {});
    });
    return false;
  }
}

/* ── Warming the geometry a click away ───────────────────────────────────────
   A blank-free swap is not yet an IMMEDIATE one: the archive still has to be
   fetched, and on a cold one that is a TileJSON resolution (a pmtiles header and
   two directory range reads) plus a screenful of tiles — measured locally at
   around a second, and the reader spends it looking at the map they are leaving
   with a pill that says what is coming.

   So the app tells the kit what is one click away, and the signal is INTENT: a
   pointer arriving at the button that would cause the swap, or focus landing on
   it. That is roughly half a second before the click, which is roughly what the
   archive needs, and it costs nothing at all for a reader who does not switch.

   Bounded on purpose. `handle.warmGeometry()` counts against the kit's `buffers`
   cap (two, counting what is on screen), so warming a third archive retires the
   coldest — the LAST thing hovered is the thing that stays warm, which is the
   right answer for a hover. And a failure is swallowed: a warm-up that did not
   happen costs a slower swap and nothing else, so it must never reach the reader
   as an error. */

/** The last key warming was asked for, so re-entering a button — pointerenter
    then focus, or a pointer crossing it twice — is one warm-up, not three. */
let warmedKey = null;

/**
 * Warm one authority's geometry, best-effort.
 *
 * @param {object|null} ref a BoundaryRef, or null for "nothing to warm"
 */
function warmBoundary(ref) {
  if (!ref || !handle || !handle.tiled) return;
  // Already on screen, already warming, or already warmed: nothing to do.
  if (boundary && ref.key === boundary.key) return;
  if (warmedKey === ref.key) return;
  warmedKey = ref.key;
  loadBoundary(ref)
    .then((c) => handle.warmGeometry(c))
    .catch(() => { warmedKey = null; });
}

/**
 * The geometry a dataset button WOULD land on, warmed.
 *
 * Best-effort in one more way than the note above admits: the year can CLAMP
 * into the arriving family's domain (applyYearDomain), and a clamp across a
 * vintage line means the archive warmed here is not the one the click needs. The
 * cost of being wrong is one unused fetch, and the common case — a dataset
 * toggle inside one family, at a year both families cover — is right.
 *
 * @param {string} datasetId a `data-dataset` attribute value
 */
function warmForDataset(datasetId) {
  if (!datasetId) return;
  for (const iface of INTERFACES) {
    const ds = iface.datasets.find((d) => d.id === datasetId);
    if (!ds) continue;
    warmBoundary(boundaryFor({ authority: authorityIdOf(ds), year: state.year }));
    return;
  }
}

/**
 * The geometry a view button would land on: that family's remembered dataset, or
 * its default.
 *
 * @param {string} viewId a `data-view-btn` attribute value
 */
function warmForView(viewId) {
  const iface = viewFromSlug(String(viewId ?? '').toLowerCase());
  if (!iface || iface.id === state.view) return;
  // Every view's entry in `viewState` declares a dataset, and it is the one a
  // switch would bring up — remembered from earlier in the session if the reader
  // has been there, its declared default if not.
  warmForDataset(viewState[iface.id].dataset);
}

/**
 * The year slider's intent, which is only actionable on ONE authority.
 *
 * FSA's axis has exactly two values, so "the other one" is a single archive and
 * warming it is what makes the first drag across 2015 free. The Census axis has
 * eighteen, one per year, and a slider that has not moved yet says nothing about
 * direction — so there is nothing honest to warm there, and a year step on the
 * drought monitor pays the warm-up it always did (blank-free now, but not
 * instant).
 */
function warmForYearControl() {
  if (!boundary || boundary.authority !== 'fsa') return;
  const other = fsaVintageFor(state.year) === 'dd17' ? 2026 : 2012;
  warmBoundary(boundaryFor({ authority: 'fsa', year: other }));
}

/* ── The week scrubber ───────────────────────────────────────────────────────
   A family whose data is WEEKLY needs a second time control, and it is a
   control inside the year rather than beside it: the year slider picks 2012 and
   this picks one of that year's 52 or 53 Tuesdays. Two reasons it is not one
   1,389-step slider over the whole record: a thumb one pixel wide would be
   unusable, and the year is SHARED STATE — the reader who arrived from the
   grazing-period map in 2012 should still be in 2012.

   What the app stores is therefore the week WITHIN the year (1-based), and what
   the data is read at is the absolute index into the payload's series. The two
   conversions are weekBounds() and absoluteWeek(), and everything else below is
   in the app's own units.

   The default is the year's LAST week — for the current year, the last week the
   record holds — so an untouched view shows the most recent map there is, and
   `?week=` is elided there like every other default. */

/** The active instance IF it carries weeks. Asked of the instance, not of the
    view: what makes a week scrubbable is a decoder that can answer weekRange(). */
function weekData() {
  return activeData && typeof activeData.weekRange === 'function' ? activeData : null;
}

/** The selected year's slice of the record: absolute first and last week index,
    and how many weeks that is. Null when the active data has no weeks, or the
    year is outside what it carries. */
function weekBounds() {
  const data = weekData();
  if (!data) return null;
  const range = data.weekRange(state.year);
  if (!range) return null;
  return { j0: range[0], j1: range[1], count: range[1] - range[0] + 1 };
}

/** The selected week as an absolute index into the payload's series — what
    every descriptor leaf reads. Null for a family without weeks. */
function absoluteWeek() {
  const b = weekBounds();
  if (!b) return null;
  const week = activeViewState().week;
  return b.j0 + (week == null ? b.count : week) - 1;
}

/** `?week=`, or null at its default. */
function weekParam() {
  const b = weekBounds();
  if (!b) return null;
  const week = activeViewState().week;
  if (week == null || week === b.count) return null;
  return String(week);
}

/**
 * Re-author the week control for the year and dataset now on screen, clamping
 * the remembered week into the year's own length.
 *
 * A week is a POSITION IN THE YEAR, so it survives a year change rather than
 * resetting: 2012's week 30 is late July, and so is 2013's. A year with 52
 * weeks clamps a remembered 53 to 52 — which is still its last week, so a
 * reader who never touched this control keeps seeing the year's latest map.
 */
function syncWeekControl() {
  const b = weekBounds();
  if (!b || !els.week) return;
  const vs = activeViewState();
  vs.week = vs.week == null ? b.count : Math.min(Math.max(1, vs.week), b.count);
  // Written only when they change: re-authoring min/max on a slider mid-drag
  // is how a dragged thumb starts jumping.
  if (els.week.min !== '1') els.week.min = '1';
  if (els.week.max !== String(b.count)) els.week.max = String(b.count);
  els.week.value = String(vs.week);
  syncWeekOut();
}

/** The readout under the thumb, and whether stepping is possible from here.
    Separate from syncWeekControl because this is the half that runs on every
    frame of a drag. */
function syncWeekOut() {
  const data = weekData();
  const b = weekBounds();
  if (!data || !b || !els.weekOut) return;
  const j = b.j0 + activeViewState().week - 1;
  els.weekOut.textContent = data.weekLabel(j) + ' · week '
    + activeViewState().week + ' of ' + b.count;
  // The steppers walk the RECORD, not the year, so they stop only at its ends.
  if (els.weekPrev) els.weekPrev.disabled = j <= 0;
  if (els.weekNext) els.weekNext.disabled = j >= data.latestWeek();
}

/**
 * Show another week of the selected year.
 *
 * @param {number|string} next 1-based week within the year
 */
function setWeek(next) {
  const b = weekBounds();
  if (!b) return;
  const week = Number(next);
  if (!Number.isInteger(week) || week < 1 || week > b.count) return;
  const vs = activeViewState();
  if (vs.week === week) return;
  vs.week = week;
  syncWeekOut();
  pushState();
  recolor();
}

/**
 * Step one week through the RECORD, crossing the year boundary when it has to.
 *
 * "Previous week" means the week before this one, and at week 1 of 2013 that is
 * week 52 of 2012 — so the year slider follows. Stopping dead at each year's
 * edge would make the two controls fight each other; the buttons disable only
 * at the two ends of the record, where there is genuinely no next week.
 *
 * @param {number} delta −1 | +1
 */
function stepWeek(delta) {
  const data = weekData();
  const b = weekBounds();
  if (!data || !b) return;
  const j = absoluteWeek() + delta;
  if (j < 0 || j > data.latestWeek()) return;
  const pos = data.weekOfYear(j);
  if (!pos) return;
  if (pos.year === state.year) {
    setWeek(pos.index);
    return;
  }
  // Set the week FIRST: setYear re-authors this control for the year it lands
  // on, and it must clamp the week the reader is going to, not the one they
  // are leaving.
  activeViewState().week = pos.index;
  setYear(pos.year);
}

/**
 * Resolve a parked `?week=` against the payload that has just arrived.
 *
 * Only the URL param needs the descriptor: it is the one value that was read
 * before anything knew how many weeks the year has. A remembered week (the
 * reader was here earlier in the session) and the default are both clamps, and
 * syncWeekControl does those.
 */
function applyWeek(instance) {
  const parked = pendingWeekParam;
  pendingWeekParam = null;
  const resolved = currentInterface().applyPending(instance, {
    week: parked, year: state.year,
  });
  if (Number.isInteger(resolved)) activeViewState().week = resolved;
  syncWeekControl();
}

function setType(next) {
  if (next === state.type) return;
  state.type = next;
  const control = typeControl();
  if (control) control.value = next;
  // Remembered against the dataset it belongs to, so a toggle away and back
  // returns to this choice rather than re-seeding from the other dictionary.
  rememberType(activeViewState().dataset, next);
  persist();
  pushState();
  recolor();
}

function setVariable(next) {
  // Against the ACTIVE family's registry: a click can only come from a button in
  // that family's own drawer section, but a stale deep link or a stored value
  // can carry anything.
  if (!knownVariable(currentInterface(), next)) return;
  state.variable = next;
  // Remembered only by a family that HAS a colour-by control. Writing it into a
  // family that does not would put a field in its remembered state that means
  // nothing there — and the state a switch restores is compared field for field.
  if (currentInterface().controls.variable) activeViewState().variable = next;
  syncVariableButtons();
  persist();
  pushState();
  syncLegend();
  recolor();
}

/**
 * Exactly ONE colour-by button in the page reads as pressed — the active
 * family's active variable.
 *
 * Every family's buttons are in the markup at all times (`syncSections()` hides
 * the sections that are not the active family's), and a pressed button inside a
 * hidden section is still a pressed button to anything reading the
 * accessibility tree. So the other families' are cleared rather than left as
 * they were — the same rule syncDatasetButtons() follows, for the same reason.
 *
 * aria-pressed IS the styling source of truth (HOUSE-STYLE §5.7): the CSS keys
 * off it, so the accessible state cannot drift from the visual one.
 */
function syncVariableButtons() {
  const iface = currentInterface();
  for (const btn of els.segs) {
    const name = btn.dataset.variable;
    btn.setAttribute('aria-pressed',
      String(knownVariable(iface, name) && name === state.variable));
  }
}

/**
 * Bring the shared colour-by into the arriving family's own registry.
 *
 * The variable is shared state like the year — a reader who was looking at dates
 * should still be looking at dates — but unlike the year it cannot be clamped:
 * `duration` is not a lesser `months`, it is a different question. So each
 * family remembers its own choice, and coming on screen means adopting it. No
 * payload is needed for this (a registry is static), so it happens in the switch
 * itself and the URL is right from the first frame.
 */
function adoptVariable(iface) {
  if (!iface.controls.variable) {
    syncVariableButtons();
    return;
  }
  const vs = viewState[iface.id];
  const want = knownVariable(iface, vs.variable)
    ? vs.variable : defaultVariableOf(iface);
  state.variable = want;
  vs.variable = want;
  syncVariableButtons();
}

/** The `<select>` the ACTIVE family's pasture types live in. A family with a
    dictionary the shared select cannot hold (a sentinel that is in no payload)
    names its own; everyone else uses the shared one. */
function typeControl() {
  const id = currentInterface().typeSelectId;
  return id ? document.getElementById(id) : els.type;
}

/** The options the active family's type select should offer, as {value, label}.
    A family with no opinion gets its dictionary, one name per option — which is
    exactly what the grazing periods have always shown. */
function typeOptionsFor(iface, instance) {
  if (typeof iface.typeOptions === 'function') return iface.typeOptions(instance);
  const names = (instance && typeof instance.types === 'function')
    ? instance.types() : types();
  return names.map((t) => ({ value: t, label: t }));
}

function populateTypeSelect() {
  const control = typeControl();
  if (!control) return;
  const frag = document.createDocumentFragment();
  for (const opt of typeOptionsFor(currentInterface(), activeData)) {
    const node = document.createElement('option');
    node.value = opt.value;
    node.textContent = opt.label;
    frag.appendChild(node);
  }
  control.replaceChildren(frag);
  control.value = state.type;
}

/* ── The aggregation picker ──────────────────────────────────────────────────
   One archive in the app answers the same question several times over, under
   different defensible readings of "any area of the county" (js/interfaces/
   eligibility.js § SOURCE_LABELS — the payload carries four and the picker
   offers three of them). That is a fact about ONE dataset, not about its
   interface, so the control appears and disappears with the dataset — which
   makes it the one [data-view] control whose visibility is narrower than its
   section's. The OPTIONS are the descriptor's to decide; this file only asks. */

/** Show the picker only while the dataset that has conventions is on screen. */
function syncSourceControl() {
  if (!els.eligSourceWrap) return;
  const iface = currentInterface();
  els.eligSourceWrap.hidden = !(iface.controls.source && activeDataset().hasSources);
}

/** Fill it from the payload's own dictionary, in the payload's own order. */
function populateSourceSelect(instance) {
  const iface = currentInterface();
  if (!els.eligSource || !iface.source) return;
  const frag = document.createDocumentFragment();
  for (const opt of iface.source.options(instance)) {
    const node = document.createElement('option');
    node.value = opt.value;
    node.textContent = opt.label;
    frag.appendChild(node);
  }
  els.eligSource.replaceChildren(frag);
  const chosen = activeViewState().source;
  if (chosen) els.eligSource.value = chosen;
}

/**
 * Read the same archive at another convention.
 *
 * A synchronous repaint: the payload holds every convention, so nothing is
 * fetched and nothing waits. It does NOT bump `data-ngp-view-seq` — that counter
 * means "a transition that involved a fetch has landed" (tools/config.mjs §
 * MARKERS), and a week scrub does not bump it either.
 *
 * STILL SYNCHRONOUS, and not by oversight. Every convention this picker offers
 * recomputed the ladder against a different county set, so it is tempting to
 * make the polygons follow — but the determination it reports is an FSA-county
 * fact either way, and this payload is keyed that way (its `counties` array is
 * FSA codes, with ids no FIPS-keyed tileset has). The dataset therefore declares
 * one authority regardless of source, ensureBoundary() would be a no-op here,
 * and the geometry does not move. What changes is the numbers.
 *
 * @param {string} next an aggregation id from the payload's dictionary
 */
function setSource(next) {
  const iface = currentInterface();
  const vs = activeViewState();
  if (!iface.controls.source || !activeData) return;
  const known = iface.source.options(activeData).some((o) => o.value === next);
  if (!known || next === vs.source) return;
  vs.source = next;
  if (els.eligSource) els.eligSource.value = next;
  persist();
  pushState();
  recolor();          // paints, refills the card, and announces the convention
  if (tableCtl) tableCtl.invalidate();
}

/**
 * Resolve a parked `?source=` against the dictionary that has just arrived, or
 * fall back to what this session was already reading — and then to the
 * descriptor's default.
 */
function applySource(instance) {
  const iface = currentInterface();
  const vs = activeViewState();
  if (!iface.controls.source || !iface.source) return;
  if (!activeDataset().hasSources) return;
  const parked = pendingSourceSlug;
  pendingSourceSlug = null;
  vs.source = iface.source.resolve(instance, parked ?? vs.source);
  populateSourceSelect(instance);
}

/* ── Enumerated choices ──────────────────────────────────────────────────────
   A family may slice its ONE dataset in ways that are neither a dataset nor a
   colour-by: several states of one table, none of them a different file and
   none of them a different quantity.

   NO SHIPPED FAMILY DECLARES ONE TODAY. The disaster designations did — read as
   Secretarial or Presidential, for drought alone or for all 22 disaster types —
   until that map was narrowed to the one slice it is about (js/interfaces/
   disasters.js § ONE SLICE). The mechanism stays because it is the shape that
   question has whenever it comes back, and because everything below is generic:
   `choicesOf()` answers with an empty list, and every function is a no-op over
   it. Nothing here is reachable from the page as it stands.

   A family DECLARES its choices — `descriptor.choices`, a frozen list of
   `{id, values[], default}` — and everything here is generic. The button group,
   the URL param, the stored preference and the remembered per-view state all
   key off `id`, and the rules are the ones every other control in this file
   follows: validated against the family's own whitelist on the way in, elided
   at its default on the way out, remembered per interface so switching away and
   back is a return rather than a reset.

   Two things a choice is deliberately NOT. It is not a dataset: nothing is
   fetched, so a change is a synchronous repaint and does NOT bump
   `data-ngp-view-seq` — that counter means "a transition that involved a fetch
   has landed" (tools/config.mjs § MARKERS), and a week scrub does not bump it
   either. And it is not a payload-driven select like the aggregation picker
   above: the values are static, so a choice param needs no parking and is
   resolved at boot like any other whitelisted param. */

/** The choices one family declares, or none. */
function choicesOf(iface) {
  return (iface && iface.choices) || [];
}

/**
 * The active value of one choice — re-validated on every read, because the
 * value in `viewState` may have come from localStorage or a URL and a stored
 * value gets exactly the same suspicion as a URL one.
 *
 * @param {object} iface the interface whose choice it is
 * @param {string} id the choice id
 * @returns {string|null} the value, its default, or null when this family has
 *          no such choice
 */
function choiceValue(iface, id) {
  const choice = choicesOf(iface).find((c) => c.id === id);
  if (!choice) return null;
  const slice = viewState[iface.id];
  const held = slice ? slice[id] : null;
  return choice.values.includes(held) ? held : choice.default;
}

/**
 * Read one family's choices at boot: URL param > stored preference > default,
 * each validated against that family's own list. Written as a function of the
 * INTERFACE so readInitialState can ask it about a family that is not on screen
 * yet.
 */
function readChoices(iface) {
  const slice = viewState[iface.id];
  if (!slice) return;
  for (const choice of choicesOf(iface)) {
    const raw = String(params.get(choice.id)
      ?? lsGet(LS.choice(iface.id, choice.id)) ?? '').toLowerCase();
    if (choice.values.includes(raw)) slice[choice.id] = raw;
    else if (raw) {
      console.warn('[ngp] ' + JSON.stringify(raw) + ' is not a ' + choice.id
        + ' ' + iface.label + ' offers — falling back to '
        + JSON.stringify(choice.default) + '.');
    }
  }
}

/**
 * Show the same data another way.
 *
 * A synchronous repaint: one payload holds every slice, so nothing is fetched
 * and nothing waits — which is why this does not touch the transition counter
 * (see the section header).
 *
 * @param {string} id a choice id of the active family
 * @param {string} next one of that choice's values
 */
function setChoice(id, next) {
  const iface = currentInterface();
  const choice = choicesOf(iface).find((c) => c.id === id);
  if (!choice || !choice.values.includes(next)) return;
  const vs = activeViewState();
  if (choiceValue(iface, id) === next) return;
  vs[id] = next;
  syncChoiceButtons();
  persist();
  pushState();
  recolor();      // paints, refills the card, and announces through the descriptor
  // The legend body and its key belong to the descriptor, and a descriptor is
  // allowed to describe its slices differently — so the legend is re-asked
  // rather than assumed unchanged.
  syncLegend();
  if (tableCtl) tableCtl.invalidate();
}

/** Exactly ONE button per choice group reads as pressed — the active family's
    active value. Every family's buttons are in the markup at all times
    (`syncSections()` hides the sections that are not the active family's), and a
    pressed button inside a hidden section is still a pressed button to anything
    reading the accessibility tree, so the others are cleared rather than left as
    they were. aria-pressed IS the styling source of truth (HOUSE-STYLE §5.7). */
function syncChoiceButtons() {
  const iface = currentInterface();
  for (const btn of els.choiceBtns) {
    const id = btn.getAttribute('data-choice');
    const value = btn.getAttribute('data-value');
    const mine = choicesOf(iface)
      .some((c) => c.id === id && c.values.includes(value));
    btn.setAttribute('aria-pressed',
      String(mine && choiceValue(iface, id) === value));
  }
}

/* ── Views and datasets ──────────────────────────────────────────────────────
   Switching what the map shows is one mechanism used two ways: a VIEW switch
   changes the data family (and with it which drawer sections apply), a DATASET
   toggle changes which reading of that family is painted. Both keep the shared
   state — camera, county, year, theme — because comparing two datasets on the
   same county in the same year is the app's reason to exist.

   Both are lazy: a payload is fetched the first time it is asked for and never
   at boot, so the default view pays for exactly one file. Both re-check INTENT
   after their await rather than aborting a request that is already in flight —
   the swapVintage() pattern, and for the same reason: the second press is the
   user changing their mind, not a race to cancel. */

/** Hide every drawer section that belongs to another family. Sections with no
    `data-view` — search, year, legend — are shared and never touched. */
function syncSections() {
  for (const section of document.querySelectorAll('.sfsa-drawer-section[data-view]')) {
    section.hidden = section.dataset.view !== state.view;
  }
  // One control inside those sections is narrower than its section: the
  // aggregation picker belongs to a single DATASET of a single family.
  syncSourceControl();
  // The map's accessible name follows the active family too — index.html
  // authors the NGP boot value, and every switch restates it from the
  // descriptor so a screen reader is never told a drought map is a
  // grazing-period map.
  els.map.setAttribute('aria-label', currentInterface().mapLabel);
}

/** aria-pressed IS the styling source of truth for both segmented groups
    (HOUSE-STYLE §5.7), so the accessible state cannot drift from the visual. */
function syncViewButtons() {
  for (const btn of els.viewBtns) {
    btn.setAttribute('aria-pressed',
      String(btn.getAttribute('data-view-btn') === state.view));
  }
}

/** Exactly ONE dataset button in the page reads as pressed — the active
    family's active dataset. The other families' buttons are in hidden sections,
    but a pressed button in a hidden section is still a pressed button to
    anything reading the accessibility tree (and to the audit harness, which
    counts them), so they are cleared rather than left as they were. */
function syncDatasetButtons() {
  const ids = new Set(currentInterface().datasets.map((d) => d.id));
  const active = activeViewState().dataset;
  for (const btn of els.datasetBtns) {
    const id = btn.getAttribute('data-dataset');
    btn.setAttribute('aria-pressed', String(ids.has(id) && id === active));
  }
}

/**
 * Bump the transition counter, after the paint it describes has actually
 * reached GL. The kit coalesces feature-state writes to one flush per animation
 * frame, so a counter incremented in the same task as recolor() would tell a
 * harness "done" while the old colors were still on screen.
 */
async function bumpViewSeq() {
  await new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') { resolve(); return; }
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
  viewSeq += 1;
  document.documentElement.dataset.ngpViewSeq = String(viewSeq);
}

/**
 * Switch the data family on screen.
 *
 * What it does NOT do is reset the shared state or re-fit the camera: the
 * county, the camera, the year and the theme are the VISITOR's, not the
 * family's, and comparing two readings of the same county in the same year is
 * the app's reason to exist. The year is the one that can fail to survive —
 * two families do not cover the same span — and it is clamped and announced
 * rather than silently moved (applyYearDomain → clampYear).
 *
 * Everything the arriving family owns is settled by applyDataset() once its
 * payload is really in hand: its year domain, its type dictionary, its week,
 * its legend body, its card and its table.
 *
 * @param {string} next an interface slug
 */
function setView(next) {
  const iface = viewFromSlug(String(next ?? '').toLowerCase());
  if (!iface) return;              // not a shipped family — a stale link, ignore
  if (iface.id === state.view) return;

  // The outgoing family's own selections, so switching back is a return rather
  // than a reset. The type only when it HAS one — otherwise the name on screen
  // belongs to some other family and storing it here would corrupt both.
  if (currentInterface().controls.type) {
    rememberType(activeViewState().dataset, state.type);
  }
  state.view = iface.id;
  syncSections();
  syncViewButtons();
  syncDatasetButtons();
  syncChoiceButtons();
  // The colour-by is the arriving family's own choice, and it needs no payload
  // to settle — so the buttons and the URL below are right from this frame.
  adoptVariable(iface);
  syncYearControl();
  // The URL follows the intent immediately; localStorage follows the RESULT
  // (applyDataset persists once the payload is really on screen), so a family
  // whose payload is missing does not become the stored preference.
  pushState();
  // The family's own dataset — remembered from earlier in the session, or its
  // default — is what has to be on screen now.
  applyDataset(activeDataset()).catch((err) => {
    console.error('[ngp] view switch failed', err);
  });
}

/**
 * Toggle which dataset of the active family is painted.
 *
 * Synchronous up to the point where a payload might have to be fetched: the
 * INTENT is recorded, mirrored into the buttons and the URL, and only then
 * awaited. That order is what makes a double press behave — the second call
 * passes its own guard and its own intent is the one applyDataset() honours.
 *
 * @param {string} next a dataset id of the active interface
 */
function setDataset(next) {
  const iface = currentInterface();
  const ds = iface.datasets.find((d) => d.id === next);
  const vs = activeViewState();
  if (!ds || ds.id === vs.dataset) return;

  if (iface.controls.type) rememberType(vs.dataset, state.type);   // toggling back restores it
  vs.dataset = ds.id;
  syncDatasetButtons();
  pushState();
  applyDataset(ds).catch((err) => {
    console.error('[ngp] dataset toggle failed', err);
  });
}

/**
 * Fetch (or take from cache) one dataset and bring it on screen.
 *
 * The fetch is idempotent — decoders/common.js keys its promise cache by URL —
 * so this is a network round trip once and a repaint every time after.
 *
 * On failure the map is repainted to NOTHING rather than left as it was: the
 * legend key already describes the dataset the user asked for, and stale paint
 * under the wrong key is a map that lies. An empty payload is the kit's own
 * documented way to say that (county.js § recolor: an id absent from the map
 * falls through to --no-data), and the Retry button re-enters here.
 *
 * @param {object} ds a dataset descriptor from the active interface
 */
async function applyDataset(ds) {
  const wanted = ds.id;
  const iface = currentInterface();
  // A dataset that knows it is a big download says so in its own words: the
  // derived eligibility archive is 11 MB, and four seconds of a pill that says
  // "Loading Derived from USDM…" reads as a hung app.
  note(ds.loadingNote || ('Loading ' + ds.label + '…'));

  // START THE GEOMETRY NOW, alongside the payload. They are independent fetches
  // from two origins, and they were SERIAL: the payload was awaited below, and
  // only then did ensureBoundaryNow() go looking for the archive. Measured on a
  // cold switch to the FSA LFP drought dataset, 1,177 ms to the flip, of which
  // roughly 400 ms was geometry that could have been in flight the whole time —
  // overlapping them makes a cold switch about as slow as its slower half
  // instead of as slow as both.
  //
  // Best-effort, and deliberately not awaited: the real load is
  // ensureBoundaryNow()'s below, which is where the ordering guarantee lives.
  // The one way this can be wrong is a year that CLAMPS into the arriving
  // family's domain across a vintage line, which warms an archive the click
  // does not need; the cost of that is one unused fetch (§ warmForDataset).
  warmForDataset(ds.id);

  let instance;
  try {
    const [inst, xw] = await Promise.all([
      loadDataset(ds),
      // The JOIN decides, not the key space. A crosswalk is needed exactly
      // when the dataset's keys and its authority's ids are different kinds of
      // thing (js/boundaries.js § needsCrosswalk) — so the three FIPS-keyed
      // drought datasets, now drawn on FIPS-keyed authorities, never fetch it,
      // while the two FIPS-keyed payloads with no boundary archive of their own
      // still do. Once per session either way.
      needsCrosswalk(ds.keySpace, boundaryFor(selection())) ? loadCrosswalk() : null,
      // An interface may need an asset of its own before it can paint (the
      // eligibility map's payment-months ramp). Fetched HERE rather than at
      // boot, so the boot path stays one payload and two ramps wide, and
      // awaited with the payload so the first paint has everything.
      typeof iface.ensureAssets === 'function' ? iface.ensureAssets() : null,
    ]);
    // The user may have toggled again while this was in flight; the last press
    // wins, and this one is now history.
    if (activeViewState().dataset !== wanted) return;
    instance = inst;
    if (xw) crosswalk = xw;
  } catch (err) {
    console.error('[ngp] ' + ds.id + ' failed to load', err);
    if (activeViewState().dataset !== wanted) return;
    document.documentElement.dataset.ngpViewError = '1';
    if (handle) handle.recolor(new Map());
    syncLegend();
    failNote('Could not load ' + ds.label + '.',
      () => { applyDataset(ds).catch(() => {}); });
    return;
  }

  activeData = instance;
  // The grazing-period facade re-points too, when what arrived is one of its
  // own: js/data.js is `fsa-ngp-web/1`'s surface (see § Live state), and the
  // audit harness reads the app's numbers through it.
  if (isNgpShaped(instance)) setActiveNgpDataset(instance);

  // The year domain is the PAYLOAD's, so it is re-authored here rather than at
  // boot — a family that starts in 2000 and one that starts in 2008 share this
  // slider, and the shared year is clamped into whichever is on screen.
  applyYearDomain(instance);

  if (iface.controls.type) {
    state.type = resolveTypeFor(ds, instance);
    rememberType(ds.id, state.type);
    populateTypeSelect();
  }
  if (iface.controls.week) applyWeek(instance);
  // Before the paint: which convention is being read decides what is painted.
  applySource(instance);
  syncSourceControl();
  syncYearControl();

  // AND BEFORE THE PAINT, the geometry. This is the whole reason the boundary is
  // settled here rather than beside the payload fetch above: painting a
  // dataset's numbers on the PREVIOUS dataset's polygons, even for one frame, is
  // the 97%-right map this machinery exists to prevent. `immediate`, because a
  // dataset toggle is one decision and not a scrub.
  //
  // swapBoundary() paints, refills the card and ANNOUNCES for itself, so the
  // recolor below is skipped when it landed — exactly the shape setYear() uses.
  //
  // It was an unconditional second recolor until the swap became awaited, and
  // then it was a bug rather than a harmless duplicate. The live region holds a
  // sentence for LIVE_REST_MS and speaks the last one (§ deferAnnounce), which
  // is what fuses a clamp's explanation to the summary it belongs to. Two
  // recolors used to land inside one rest window, so the reader heard one
  // sentence; with the geometry awaited, the first landed ~a second earlier, the
  // notice was spoken with it and cleared, and the second overwrote the live
  // region with a summary that no longer said why the year had moved.
  const drawn = await ensureBoundaryNow();

  persist();
  pushState();

  if (!drawn) recolor();   // paints, refills the card, and announces
  syncLegend();
  if (tableCtl) tableCtl.invalidate();
  clearNote();
  delete document.documentElement.dataset.ngpViewError;
  document.documentElement.dataset.ngpView = state.view;
  notifyViewChange();
  await bumpViewSeq();
}

/**
 * Which type this dataset should show, in the order that respects what the user
 * asked for most recently:
 *
 *   1. a parked `?type=` (or stored) slug, resolved against THIS dataset's own
 *      dictionary — the descriptor owns that resolution, because one slug can
 *      mean different things to two dictionaries;
 *   2. the type this dataset was last showing in this session;
 *   3. the type the outgoing dataset was showing, if this dictionary has that
 *      name too (preserve-if-present);
 *   4. its equivalent under the registry's TYPE_ALIASES — "Native Pasture" and
 *      "Full Season" are the same forage regime under two naming conventions;
 *   5. whatever the descriptor calls this dataset's default.
 *
 * Every candidate is checked against the dictionary that actually arrived: a
 * type can be retired from a payload between two sessions, and a map blanked by
 * a stale preference looks like a broken app.
 */
function resolveTypeFor(ds, instance) {
  const iface = currentInterface();
  // The OPTIONS, not the dictionary: a family may offer a selection the payload
  // has no name for ("All types (worst case)"), and it is as real a choice as
  // any of the fifteen.
  const known = new Set(typeOptionsFor(iface, instance).map((o) => o.value));
  const parked = pendingTypeSlug;
  pendingTypeSlug = null;

  if (parked) {
    // The descriptor resolves the slug against the dictionary that arrived (and
    // warns for itself when it cannot); it answers with this dataset's default
    // rather than null, so an unknown slug still lands somewhere paintable.
    const asked = iface.applyPending(instance, parked);
    if (known.has(asked)) return asked;
  }

  const remembered = rememberedType(ds.id);
  if (known.has(remembered)) return remembered;
  if (known.has(state.type)) return state.type;
  const alias = aliasType(state.type, instance.types());
  if (alias) return alias;
  return iface.applyPending(instance, null);
}

async function share() {
  const url = new URL(location.href);
  // ?kbd is the SHARER's input preference, not part of the view.
  url.searchParams.delete('kbd');
  try {
    if (!navigator.clipboard) throw new Error('no clipboard API');
    await navigator.clipboard.writeText(url.href);
    showToast('Link copied — it reproduces exactly this view.');
  } catch (err) {
    console.warn('[ngp] clipboard write failed', err);
    showToast('Could not copy automatically — the address bar holds this exact view.', 5000);
  }
}

/* ── The controls drawer ─────────────────────────────────────────────────── */

/**
 * Let the map catch up with a drawer slide. Desktop only — the caller checks.
 *
 * On desktop the drawer is a flex sibling of #map-frame, so opening or closing
 * it changes the canvas width, and MapLibre only learns about a container
 * resize when it is told. The kit slides the drawer over `--transition` (0.2s);
 * resizing on the first frame would paint a letterboxed canvas for the rest of
 * the animation, so the resize waits for the slide to finish. Under reduced
 * motion there is no slide to wait for and the resize is immediate.
 *
 * Resizing is deliberately NOT the kit's job: initDrawer knows nothing about
 * what is next to it, and `onToggle` is the documented seam for exactly this.
 */
function settleMapAfterDrawer() {
  if (!map) return;
  const settle = () => {
    map.resize();
    // The zoom floor is derived from cameraForBounds against the CURRENT
    // container: a wider map can be zoomed out further before the composite
    // framing breaks, so a stale floor would either clamp too early or let the
    // user zoom past the layout.
    if (zoomFloor) zoomFloor.refresh();
  };
  if (reducedMotion()) settle();
  else setTimeout(settle, 240);
}

/** `/` focuses the county search. A single-character shortcut, so it needs an
    opt-out (WCAG 2.1.4): ?kbd=off disables it entirely, and the param rides
    every URL rewrite so it survives a session. */
function onDocumentKeyDown(e) {
  if (!kbdEnabled || e.key !== '/') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && t.closest && t.closest('input, select, textarea, [contenteditable]')) return;
  e.preventDefault();
  // The search box lives in the drawer now, and a closed drawer is
  // `visibility: hidden` — its input is out of the tab order and cannot take
  // focus at all. So open first, without letting initDrawer move focus, then
  // put the caret where the user asked for it.
  if (drawerCtl && !drawerCtl.isOpen()) drawerCtl.open({ focus: false });
  els.search.focus();
}

function wireControls() {
  // FIRST, and deliberately: initDrawer registers a document-level `keydown`
  // handler, and the Escape ladder is REGISTRATION-ORDER based. One Escape must
  // dismiss one layer, outermost first — modal dialog, then the search
  // dropdown, then (on compact) the drawer overlay, then the card/sheet. The
  // drawer therefore has to register before initDetailCard, which happens in
  // loadAndRender(). Move this call below that one and a single Escape on a
  // phone closes both the sheet and the drawer. (ui/card.js's own header states
  // the other half of the contract: anything listening for Escape under a card
  // must stand down on `event.defaultPrevented`.)
  drawerCtl = initDrawer({
    drawer: els.drawer,
    tab: els.drawerTab,
    toggle: els.btnDrawer,
    scrim: els.drawerScrim,
    // Desktop-only persistence; the kit never stores a compact state.
    storageKey: LS.drawer,
    // undefined = "no URL opinion, use the stored preference or the default".
    startOpen: pendingDrawerParam == null ? undefined : pendingDrawerParam === 'open',
    onToggle: (open, { compact }) => {
      // Compact is an overlay: the map never changes size, so there is nothing
      // to resize and nothing to put in the URL.
      if (!compact) settleMapAfterDrawer();
      // `booted` is the boot-complete marker: readInitialState() has run, the
      // camera is framed and the card is wired, so the URL can be rewritten
      // from live state. Before that, initDrawer applying its initial state
      // would push a query string built from a half-read view.
      if (booted) pushState();
    },
  });

  // The slider fires `input` on every pixel of a drag; throttle to one repaint
  // per frame. The <output> updates immediately either way, so the number
  // under the thumb never lags the thumb.
  let yearRaf = 0;
  els.year.addEventListener('input', () => {
    els.yearOut.textContent = els.year.value;
    if (yearRaf) return;
    yearRaf = requestAnimationFrame(() => {
      yearRaf = 0;
      setYear(els.year.value);
    });
  });

  // The week scrubber, on the same rAF throttle as the year — one repaint per
  // frame, the <output> updated immediately so the date under the thumb never
  // lags the thumb, and the live region held until the gesture rests.
  let weekRaf = 0;
  if (els.week) {
    els.week.addEventListener('input', () => {
      deferAnnounce();
      if (weekRaf) return;
      weekRaf = requestAnimationFrame(() => {
        weekRaf = 0;
        setWeek(els.week.value);
      });
    });
  }
  if (els.weekPrev) els.weekPrev.addEventListener('click', () => stepWeek(-1));
  if (els.weekNext) els.weekNext.addEventListener('click', () => stepWeek(1));

  els.type.addEventListener('change', () => setType(els.type.value));
  // The eligibility family's own select — same handler, different dictionary
  // (and one option the shared select could never resolve).
  if (els.eligType) {
    els.eligType.addEventListener('change', () => setType(els.eligType.value));
  }
  if (els.eligSource) {
    els.eligSource.addEventListener('change', () => setSource(els.eligSource.value));
  }

  for (const btn of els.segs) {
    btn.addEventListener('click', () => setVariable(btn.dataset.variable));
  }

  // Both switchers get the same pair of handlers: the click, and the INTENT
  // that precedes it (§ Warming the geometry a click away). `focus` rather than
  // `focusin` because these are buttons, and pointerenter rather than
  // mouseenter so a stylus or a hovering trackpad counts too. Touch has no
  // hover at all, which is why the kit keeps the outgoing archive resident —
  // the second flip is instant for everyone.
  for (const btn of els.viewBtns) {
    const view = btn.getAttribute('data-view-btn');
    btn.addEventListener('click', () => setView(view));
    btn.addEventListener('pointerenter', () => warmForView(view));
    btn.addEventListener('focus', () => warmForView(view));
  }

  for (const btn of els.datasetBtns) {
    const id = btn.getAttribute('data-dataset');
    btn.addEventListener('click', () => setDataset(id));
    btn.addEventListener('pointerenter', () => warmForDataset(id));
    btn.addEventListener('focus', () => warmForDataset(id));
  }

  for (const ev of ['pointerenter', 'focus']) {
    els.year.addEventListener(ev, warmForYearControl);
  }

  for (const btn of els.choiceBtns) {
    btn.addEventListener('click', () => setChoice(btn.getAttribute('data-choice'),
      btn.getAttribute('data-value')));
  }

  els.btnShare.addEventListener('click', share);

  initThemeToggle({
    button: els.btnTheme,
    onChange: (theme) => {
      state.theme = theme;
      // GL paints cannot read CSS custom properties: a theme flip that only
      // swaps data-theme leaves the whole map painted in the old palette.
      if (handle) handle.applyThemePaints();
      syncLegend();          // the no-data chip is a token too
      pushState();
    },
  });

  document.addEventListener('keydown', onDocumentKeyDown);
}

/* ── Boot ────────────────────────────────────────────────────────────────── */

async function boot() {
  // The two vendored globals are a hard requirement, and the failure mode
  // without this check is a blank cream rectangle plus a ReferenceError five
  // frames deep in a callback.
  if (!window.maplibregl || !window.topojson) {
    note('This map could not start: the MapLibre GL and topojson-client '
      + 'libraries did not load.', { tone: 'error', retry: () => location.reload() });
    return;
  }

  readInitialState();
  els.year.value = String(state.year);
  els.yearOut.textContent = String(state.year);
  syncVariableButtons();
  // The drawer reflects the family and dataset that are about to PAINT, which
  // for a deep-linked non-default dataset is still the default one: the toggle
  // lands after the first payload is on screen (see the end of loadAndRender).
  syncSections();
  syncViewButtons();
  syncDatasetButtons();
  syncChoiceButtons();

  live = createLiveRegion();

  const created = createCompositeMap({
    // The ELEMENT, not a selector: MapLibre resolves a string container with
    // document.getElementById, so '#map' throws "Container '#map' not found."
    container: els.map,
    bounds: PROJECTED_BOUNDS,
    // The kit's default cage pad is 6°, sized for a composite that spanned 58.4°
    // of longitude — a tenth of the box. PROJECTED_BOUNDS spans 10 dummy
    // degrees, so 1° is that same tenth. Left at 6 the user could fling the
    // composite most of a screen-width off the canvas.
    maxBoundsPadDeg: 1,
    params,
  });
  map = created.map;
  fitOpts = created.fitOpts;

  /* THE ZOOM CEILING, and it is arithmetic rather than taste.
     The county tilesets are lossless at their maxzoom — z15, tile extent 8192,
     unsimplified — which puts their coordinate quantum at
       360 / 2^15 / 8192 dummy degrees = 1.34e-6 = 0.72 m on the ground,
     finer than the archives' own ~6.5 m quantization. Screen scale at display
     zoom z is 2^(z-15) times the z15 tile's, so 0.72 m first fills one CSS pixel
     at z = 19 exactly. Past that the geometry stairsteps: the reader is zooming
     into the quantization, not into the county.
     MapLibre's default is 22, which is three doublings of visible faceting on
     the one thing this app asks a reader to look closely at. Set after
     creation because createCompositeMap does not forward it. */
  map.setMaxZoom(19);

  // Zoom + fit go TOP-LEFT, which is the corner nothing else claims: the county
  // card docks against the whole RIGHT edge of #map-frame on desktop and
  // becomes a bottom sheet on compact, and the attribution owns bottom-right
  // (css/app.css §5 pads it clear of the dock). The fit control fuses into the
  // navigation group in whichever corner it is told.
  addNavigation(map, { position: 'top-left' });
  addFitControl(map, {
    bounds: PROJECTED_BOUNDS,
    fitOpts,
    position: 'top-left',
    onBeforeFit: () => { if (cardCtl && cardCtl.isOpen()) cardCtl.close(); },
  });
  // PROJECTED_BOUNDS, not counties.bounds, for the fit control, the zoom floor
  // AND the clean-URL default check — deliberately one framing for the whole
  // session. It is the projection module's own hardcoded extent (the two
  // vintages measure identically there), and a per-vintage framing would make
  // "the default camera" mean something different either side of 2015, so the
  // same URL would be clean in one year and carry ?lng&lat&zoom in another.
  zoomFloor = installZoomFloor(map, { bounds: PROJECTED_BOUNDS, fitOpts });

  mapLoaded = new Promise((resolve) => map.once('load', resolve));
  map.on('moveend', () => { if (booted) pushState(); });

  wireControls();

  // Wired BEFORE the data load, deliberately: "About this map" is exactly what
  // someone reaches for when the map failed to load, and help.md is a separate
  // fetch that has nothing to do with the payload.
  initHelpModal({
    dialog: els.infoModal,
    trigger: els.btnInfo,
    url: 'help.md',
    // No fallbackHTML: index.html already ships the offline paragraph inside
    // [data-help-content], and help.js leaves existing markup alone when the
    // fetch fails.
    firstVisitKey: LS.seenIntro,
    // Someone sent to a specific view does not need the tour.
    suppressAutoOpen: ['year', 'type', 'variable', 'county', 'lng', 'export']
      .some((k) => params.has(k)),
  });

  await loadAndRender();
}

/**
 * The retryable half of boot: fetch, join, draw, and hand the controls over.
 *
 * Split from boot() because the Retry button has to be able to re-run it. Only
 * the map itself is created in boot(), and creating a second map in the same
 * container is a hard error — so a failure here rewinds to exactly this point
 * and no further. Every fetch behind it is idempotent (the kit's boundary cache
 * evicts rejected promises, initData/loadRamps no-op once loaded).
 */
async function loadAndRender() {
  if (booted) return;   // success happens once; Retry only re-runs a FAILED attempt
  setControlsEnabled(false);
  els.main.setAttribute('aria-busy', 'true');
  note('Loading county boundaries and grazing periods…');

  let payloads;
  // Declared out here because the boot fetch is inside the try and the assign
  // below is outside it.
  let bootRef = null;
  try {
    // initData() decodes the FIRST dataset of the default interface and binds it
    // as the facade's active instance — the one fetch boot makes, exactly as
    // before the app grew a dataset toggle.
    // The BOOT view's own authority, resolved from its own default dataset —
    // which for the grazing periods is the FSA composite, the same geometry the
    // TopoJSON path fetched. A deep-linked non-default view or dataset arrives
    // at the END of this function as an ordinary switch and brings its own
    // authority with it, so boot still fetches exactly one.
    bootRef = boundaryFor(selection());
    payloads = await Promise.all([loadBoundary(bootRef), initData(), loadRamps()]);
  } catch (err) {
    console.error('[ngp] boot failed', err);
    els.main.removeAttribute('aria-busy');
    failNote('Could not load the map data. Check your connection and try again.',
      loadAndRender);
    return;
  }
  // ALREADY in the map's space — the tiles and the sidecar's bounding boxes
  // were built there, and loadBoundary() asserted it against
  // js/projection.js's own constants before handing this over. There is no
  // client-side projection step on this path, and a call to one would be a
  // double application that flings the composite into the next hemisphere.
  counties = payloads[0];
  boundary = bootRef;
  document.documentElement.dataset.ngpBoundary = bootRef.key;
  activeData = activeNgpDataset();

  // A slug parked for a dataset — or a FAMILY — that is not the one booting is
  // not this dictionary's to resolve: the switch at the end of this function
  // consumes it against the dictionary it was written against. `?view=
  // eligibility&type=all-types` is the case that makes the second half of that
  // sentence load-bearing: resolved here it would be an unknown pasture type,
  // warned about, and thrown away before the family that has it comes up.
  if (!pendingDatasetId && !pendingViewId) applyPendingType();
  populateTypeSelect();

  // The slider's range is authored in the HTML; the payload is the authority.
  applyYearDomain(activeData);
  // applyYearDomain may have CLAMPED the year — including across a boundary
  // line — so the authority is re-checked against whatever the year became.
  // The handle does not exist yet, so this cannot go through ensureBoundary();
  // it is the one place that loads a boundary by hand, and the one place where
  // doing so is safe.
  const clamped = boundaryFor(selection());
  if (clamped.key !== boundary.key) {
    counties = await loadBoundary(clamped);
    boundary = clamped;
    document.documentElement.dataset.ngpBoundary = clamped.key;
  }

  await mapLoaded;
  zoomFloor.refresh();   // cameraForBounds needs a laid-out container

  handle = addCountyLayers(map, counties);
  buildLegend();
  recolor();

  searchCtl = initSearchBox({
    input: els.search,
    dropdown: els.results,
    items: buildSearchItems(),
    renderRow(item, i, li) {
      const name = document.createElement('span');
      name.textContent = item.label;
      const code = document.createElement('span');
      code.className = 'option-sub';
      code.textContent = item.code;
      li.append(name, code);
    },
    onSelect: (item) => {
      els.search.value = item.label;
      // On compact the drawer is an overlay ON TOP of the map: picking a result
      // means the user is done with it and wants to see the county. Focus is
      // NOT restored to the opener — selectCounty() opens the card immediately
      // after, and the card is where the answer is.
      if (viewport.isCompact() && drawerCtl && drawerCtl.isOpen()) {
        drawerCtl.close({ restoreFocus: false });
      }
      selectCounty(item.id, { fly: true });
    },
    announce: live.announce,
  });

  // NOTE ON ESCAPE ORDER: initDetailCard registers a document keydown handler
  // and the ladder is registration-order based, so initDrawer (in
  // wireControls(), which boot() calls before this function) must already have
  // registered. One Escape then closes one layer: dropdown, then the compact
  // drawer overlay, then this card.
  cardCtl = initDetailCard({
    card: els.card,
    closeBtn: els.cardClose,
    onClose: () => {
      state.countyId = null;
      if (handle) handle.setSelected(null);
      // Give the canvas its width back. The synchronous resize matters: the
      // fit control closes the card via onBeforeFit, so its fit must compute
      // against the restored width. The kit zoom floor's own resize handler
      // then springs a floor-level camera back to the full-width fit.
      if (cardPushed) {
        cardPushed = false;
        els.mapFrame.classList.remove('card-pushes');
        if (map) map.resize();
        if (zoomFloor) zoomFloor.refresh();
      }
      notifyCountySelected(null);
      pushState();
    },
  });

  initCountyTooltip(map, handle, {
    element: els.tooltip,
    render(feature, id) {
      const nm = nameOf(id);
      return {
        name: nm ? nm.county + ', ' + nm.state : id,
        sub: id,
        // The value line is the active interface's: the same number the card
        // shows, in the same words, for whatever it is painting.
        val: currentInterface().tooltip(activeData, crosswalk, selection(), id),
      };
    },
    onClick: (id) => selectCounty(id),
  });

  setControlsEnabled(true);
  els.main.removeAttribute('aria-busy');
  clearNote();
  booted = true;
  pushState();
  // A boot marker for the export/screenshot jobs and the audit harness: the
  // map is drawn, the data is joined, and the controls are live. Stamped ONCE,
  // ever — it means "this app booted", not "this app is idle".
  document.documentElement.dataset.ngpReady = '1';
  // The interface markers are the moving half of the same contract: which
  // family is on screen, and a counter a harness can wait on across any
  // transition that involves a fetch. Both are CSP-safe function predicates on
  // the other side (no eval, no polling a global).
  document.documentElement.dataset.ngpView = state.view;
  document.documentElement.dataset.ngpViewSeq = String(viewSeq);

  if (state.countyId) {
    // A deep link that also carries a camera has already framed the view — do
    // not fly away from the framing the sharer chose.
    selectCounty(state.countyId, { fly: !params.has('lng') });
  }

  initTableSeam();
  initExportSeam();

  // A stored or deep-linked non-default view or dataset arrives LAST, as an
  // ordinary switch: boot fetches exactly one payload (the LCP guarantee
  // tools/verify.mjs asserts against the browser's own resource timing), and the
  // switch then runs the very code path a click runs — including its failure
  // handling, which a second boot-time fetch would have had to reimplement.
  //
  // The view goes first and the dataset is its own business: a parked view
  // already carries the requested dataset in its remembered state
  // (readInitialState), so setView brings up both in one transition.
  if (pendingViewId) {
    const wanted = pendingViewId;
    pendingViewId = null;
    setView(wanted);
  } else if (pendingDatasetId) {
    const wanted = pendingDatasetId;
    pendingDatasetId = null;
    setDataset(wanted);
  }

  // Warm the OTHER FSA vintage while the browser is idle, so the first slide
  // across 2015 does not stall. Deliberately not the eighteen Census vintages:
  // a reader who never opens the drought monitor must not pay for them, and the
  // sidecar that matters there is fetched when that view is asked for.
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  idle(() => {
    prefetchBoundary(boundaryFor({
      authority: 'fsa', year: fsaVintageFor(state.year) === 'dd17' ? 2026 : 2012,
    }));
  });
}

/* ============================================================================
   ===== N-W4 FEATURES ========================================================

   Everything below is the seam for the second front-end pass. Nothing here
   implements a feature; it is the set of hooks those features plug into, live
   and tested, so wiring them is an import plus a call rather than surgery on
   this file.

   FILES N-W4 ADDS
     js/legend-wheel.js  the cyclic month-wheel legend  → renders into #legend-wheel
     js/card-content.js  the card body's lifecycle       → renders into #card-content
                         (WHAT it draws is the active interface's cardBody:
                          the grazing-period span chart, the drought heatmap)
     js/table-view.js    the on-demand data table        → renders into #table-modal-body
     js/export.js        branded PNG export              → wraps the kit's ui/export.js

   THE CONTEXT OBJECT
     `ngpContext()` hands a feature everything it needs WITHOUT importing this
     module back (app.js is the entry point; a feature importing it would make
     the module graph cyclic). Call it inside the feature's init.

   DATA + COLOR
     Import ./data.js and ./color.js directly — both are module-level
     singletons, already initialised by the time any hook below can fire, so a
     feature calls getCountySeries()/cyclicColor() without going through here.

   THE SUBSCRIPTIONS
     onCountySelected(fn)  fn(id | null) on every open AND on close
     onLegendChange(fn)    fn({variable, cyclic, ramps}) whenever the legend
                           body should be repainted (variable or theme change)
     onViewChange(fn)      fn({view, dataset, iface}) after a view switch or a
                           dataset toggle has landed — the signal that what the
                           map is showing is a different dataset, not a
                           different slice of the same one
     All three return an unsubscribe function and fire nothing retroactively;
     call the feature's own render once after subscribing if it needs a first
     paint.

   WIRING — LANDED. All four modules exist and are wired in the two functions
   at the bottom of this block, which loadAndRender() already calls by name:

     initTableSeam()   the three in-page features (wheel, card content, table)
     initExportSeam()  the PNG export and the `?export=` hook

   Each feature subscribes for itself and renders once if it has already missed
   its first event (a deep-linked ?county= is selected before the seam runs).
   ========================================================================== */

/* The feature modules. `import` is a top-level declaration and is hoisted, so
   these sit with the code they serve rather than at the head of a file that
   otherwise has nothing to do with them. */
import { initLegendWheel } from './legend-wheel.js';
import { initCardContent } from './card-content.js';
import { initTableView } from './table-view.js';
import { initExport } from './export.js';

const countySubs = new Set();
const legendSubs = new Set();
const viewSubs = new Set();

/**
 * Subscribe to county selection. Fires with the 5-character FSA id on open and
 * with null on close.
 * @param {(id: string|null) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onCountySelected(fn) {
  countySubs.add(fn);
  return () => countySubs.delete(fn);
}

/**
 * Subscribe to legend-affecting changes: the color-by variable and the theme.
 * @param {(info: {variable: string, cyclic: boolean, label: string,
 *                 ramps: {cyclic: string[], duration: string[]},
 *                 noData: string}) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onLegendChange(fn) {
  legendSubs.add(fn);
  return () => legendSubs.delete(fn);
}

/**
 * Subscribe to "the map is showing a different dataset now": a view switch or a
 * dataset toggle, fired once the new payload is painted. Not fired for a year,
 * type or variable change — those are the same dataset, and the features that
 * care about them already watch #card-rows or re-read state on open.
 *
 * @param {(info: {view: string, dataset: string, iface: object}) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onViewChange(fn) {
  viewSubs.add(fn);
  return () => viewSubs.delete(fn);
}

function notifyCountySelected(id) {
  for (const fn of countySubs) {
    try { fn(id); } catch (err) { console.error('[ngp] county subscriber failed', err); }
  }
}

function notifyLegend() {
  if (!legendSubs.size) return;
  // The ACTIVE family's registry: the wheel is drawn for any cyclic variable,
  // and `date` is one of those on a family js/color.js has never heard of.
  const spec = variablesOf(currentInterface())[state.variable] || {};
  const info = {
    variable: state.variable,
    cyclic: !!spec.cyclic,
    label: spec.label || '',
    ramps: ramps(),
    noData: NO_DATA(),
  };
  for (const fn of legendSubs) {
    try { fn(info); } catch (err) { console.error('[ngp] legend subscriber failed', err); }
  }
}

function notifyViewChange() {
  if (!viewSubs.size) return;
  const info = {
    view: state.view,
    dataset: activeViewState().dataset,
    iface: currentInterface(),
  };
  for (const fn of viewSubs) {
    try { fn(info); } catch (err) { console.error('[ngp] view subscriber failed', err); }
  }
}

/**
 * Everything a feature module needs, as one frozen snapshot of accessors. The
 * getters are functions, not values, because `map`, `handle` and `counties`
 * are all replaced during a session (vintage swap) and a captured reference
 * would go stale.
 *
 * @returns {object}
 */
export function ngpContext() {
  return Object.freeze({
    // Live state — a copy, so a feature cannot mutate the app's state object.
    getState: () => ({ ...state }),
    // The FSA program-year axis — what indexes the crosswalk. NOT what is
    // drawn; for that see getBoundary().
    getVintage: () => fsaVintageFor(state.year),
    /** The BoundaryRef currently on the map, or null before boot lands. */
    getBoundary: () => boundary,
    // The active interface and what it is showing. getSelection() is the same
    // `sel` object the descriptor's own leaves are called with, assembled once
    // here so a feature never has to reassemble it (and never gets it wrong).
    getInterface: currentInterface,
    getViewState: () => ({ ...activeViewState() }),
    getSelection: selection,
    getData: () => activeData,
    getCrosswalk: () => crosswalk,
    // Map internals.
    getMap: () => map,
    getHandle: () => handle,
    getCounties: () => counties,
    getBounds: () => PROJECTED_BOUNDS,
    getFitOpts: () => fitOpts,
    // App actions.
    selectCounty,
    setYear,
    setType,
    setVariable,
    setView,
    setDataset,
    announce: (text) => { if (live) live.announce(text); },
    toast: showToast,
    note,
    clearNote,
    // Subscriptions.
    onCountySelected,
    onLegendChange,
    onViewChange,
    // Elements the features own.
    els: {
      legendWheel: els.legendWheel,
      legendSwatches: els.legendSwatches,
      cardContent: els.cardContent,
      tableModal: els.tableModal,
    },
  });
}

/**
 * The three in-page features: the month wheel, the card's span chart + table
 * twin, and the on-demand data table.
 *
 * Still named initTableSeam because loadAndRender() above calls it by that
 * name and this block is the only part of the file the feature pass touches —
 * the name is the seam, not the contents. It runs at the very end of the boot
 * sequence, in the same task as buildLegend() and the first recolor(), so the
 * wheel replaces its placeholder before anything is painted.
 */
function initTableSeam() {
  const ctx = ngpContext();

  // Build-once: the wheel is the same picture for `start` and `end` (one
  // cyclic ramp) and data ramps do not theme-swap, so update() is a no-op the
  // subscription keeps honest. app.js still owns whether the wheel is SHOWN.
  const wheel = initLegendWheel({ container: els.legendWheel, ramps: ramps() });
  onLegendChange((info) => wheel.update(info));

  // Subscribes to onCountySelected itself, and watches #card-rows for the
  // year/type changes this file fires no event for — see card-content.js.
  initCardContent({ container: els.cardContent, ctx });

  // The handle is kept: a dataset toggle changes what the table should hold
  // without changing the (year, type) it was built for, so the switch has to
  // tell it the markup is stale (invalidate()).
  tableCtl = initTableView({
    button: els.btnTable,
    dialog: els.tableModal,
    captionEl: $('#table-modal-caption'),
    bodyEl: $('#table-modal-body'),
    ctx,
  });
}

/**
 * The branded PNG export, plus the `?export=` convention: a URL param that
 * forces a theme and triggers the export path so poster generation stays
 * headless-scriptable (HOUSE-STYLE §4). `params` is this module's already-read
 * query string, handed over rather than re-parsed.
 */
function initExportSeam() {
  initExport({ button: els.btnExport, ctx: ngpContext(), params });
}

/* ── Go ──────────────────────────────────────────────────────────────────── */

boot().catch((err) => {
  console.error('[ngp] unhandled boot failure', err);
  failNote('Something went wrong starting this map.', () => location.reload());
});
