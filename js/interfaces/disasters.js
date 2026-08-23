/* ============================================================================
   LFP Explorer · js/interfaces/disasters.js
   Interface 4 · Disaster designations. The broader declarations around the
   Livestock Forage Program — USDA Secretarial disaster designations (2012–) and
   Presidential major-disaster declarations (2017–) — and every sentence the app
   says about them.

   ES module, no build step. Imports the `fsa-disasters/1` decoder and the
   crosswalk join; imports nothing from app.js (the module graph stays acyclic:
   app.js → registry → descriptors → decoders + color). It reads the kit's
   `--no-data` token through js/color.js for the legend's absence chip, exactly
   as the other categorical family does.

   ── Why this map exists, and how it differs from the three before it ───────
   The first three interfaces are the LFP determination itself: when livestock
   may graze, how dry it was, and what those two produced. A disaster
   DESIGNATION is the wider instrument around them — the thing a county
   committee, an extension agent or a producer actually hears about — and it is
   a different question with a different answer:

     Secretarial designations  the Secretary of Agriculture's own finding, on a
                               county, for a disaster type. It is what unlocks
                               FSA emergency loans (and, for drought, is the
                               administrative sibling of the LFP determination
                               the third interface paints). 2012 onward.
     Presidential declarations FEMA's instrument under the Stafford Act:
                               individual and public assistance, often
                               alongside the USDA programs. 2017 onward in this
                               archive.

   ── ONE SLICE, AND IT IS THE LFP ONE ──────────────────────────────────────
   This map is the SECRETARIAL DROUGHT designations and nothing else: the
   Secretary's own finding, for the disaster type the whole app is about. The
   archive holds far more — the Presidential declarations above, and 21 other
   disaster types from hurricanes to insufficient chill hours — and that is
   where it stays: in the archive's downloads, cited in help.md, not behind a
   control on a map that is here to sit beside three LFP maps.

   So this family declares no `choices` (js/app.js § Enumerated choices keeps
   the generic mechanism; nothing uses it today), emits no params of its own,
   and every leaf below reads the two constants under § The slice rather than a
   field of `sel`. The poster's filename still names the slice out loud —
   `fsa-disasters_<year>_secretarial_drought.png` — because a file that outlives
   this page must say which corner of the archive it came from.

   ── Primary and Contiguous ─────────────────────────────────────────────────
   A designation names PRIMARY counties — the ones the loss finding is about —
   and every county CONTIGUOUS to them qualifies for the same assistance. So
   the map has two categories and one precedence rule, applied twice:

     within a county   a county named Primary by any designation in the slice is
                       Primary, even where other designations reach it only as a
                       neighbour. MEASURED: 87 (declaration, county) pairs carry
                       both codes in the same declaration.
     across the join   these payloads are keyed by CENSUS FIPS and the map draws
                       FSA counties, so several Census counties can land on one
                       FSA office (js/decoders/crosswalk.js). Primary beats
                       Contiguous there too: if any part of the FSA county was
                       named, the FSA county was named.

   ── The archive's junk is on screen, in words ──────────────────────────────
   This archive mirrors the spreadsheets FSA publishes, irregularities included,
   and so does this interface (js/decoders/fsa-disasters.js § Junk is data):

     · two of the seventeen year strings are not years ("0", "2011, 2012"), so
       the 94 county rows behind them match no year on the slider and appear
       nowhere — not on the map, not in the table;
     · 72 of the 3,306 county keys are not county keys ("0", "0010", "400").
       They are kept, they fail the crosswalk, and the live region counts them
       with everything else it could not place;
     · state and county names arrive verbatim ("Acoma", "Oglala Sioux Tribe,
       Cheyenne River Sioux"), and the data table prints them as they are. That
       table is the archive's text, not a cleanup of it.
   ========================================================================== */

import { NO_DATA } from '../color.js';
import { toFsaMap } from '../decoders/crosswalk.js';
import { makeDisastersData } from '../decoders/fsa-disasters.js';

/* ── The archive ─────────────────────────────────────────────────────────────
   ONE dataset, so this family has no dataset toggle and never emits
   `?dataset=` — the id below is what app.js calls the default, and a default is
   elided (js/app.js § pushState). `expect` pins the epoch every date in the
   payload counts from: it is cheap to state and impossible to get right by
   accident, which is the whole job of an expectation. */
const DATASETS = Object.freeze([
  Object.freeze({
    id: 'fsa-disasters',
    label: 'USDA disaster designations',
    url: '../fsa-disasters/fsa-disasters.json',
    schema: 'fsa-disasters/1',
    keySpace: 'fips',
    /** FIPS-keyed portal data with no boundary archive of its own, drawn on
        the FSA counties the program is administered on — crosswalked, exactly
        as before. Unchanged by this work. */
    boundary: 'fsa',
    expect: Object.freeze({ epoch: '1970-01-01' }),
    decode: makeDisastersData,
  }),
]);

/* ── The palette ─────────────────────────────────────────────────────────────
   The archive's OWN two colors, lifted from the map in its README (fsa-disasters
   § "Quick Start: Visualize the 2025 Secretarial Disaster Designations for
   Drought", scale_fill_manual: Primary "#DC0005", Contiguous "#FD9A09"). This
   app is the browser twin of that figure and it must be the same picture: a
   reader who has the R map in one window and this in the other is comparing
   two renderings of one archive, not two colour schemes.

   The LABELS carry the meaning for everyone the colours do not reach, which is
   what legend.items() is for — a two-hue categorical scheme has nothing left in
   grayscale (HOUSE-STYLE §6). Like every data colour in this app, these are NOT
   themed. */
const ROLE_COLORS = Object.freeze({
  Primary: '#DC0005',
  Contiguous: '#FD9A09',
});

const PRIMARY = 'Primary';
const CONTIGUOUS = 'Contiguous';

/** One formatter for the module — constructing an Intl.DateTimeFormat is the
    expensive half of formatting, and the poster's date must read exactly like
    the card's. timeZone 'UTC' is not optional: every date in this archive is a
    UTC midnight (js/decoders/fsa-disasters.js § Dates). */
const LABEL_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
});

/* ── The slice ────────────────────────────────────────────────────────────────
   The two constants this whole interface IS: the declaration type, spelled the
   way the payload's own dictionary spells it, and the disaster-type filter. They
   were a pair of segmented controls — a `choices` declaration and two `?decl=`/
   `?disaster=` params — until the map was narrowed to the one slice it is about
   (see the header). Kept as NAMED constants rather than inlined, because every
   decoder call below takes them as arguments and
   `inst.getYear(sel.year, 'Secretarial', true)` says less at the call site than
   the names do — and because if the other instruments ever come back, this is
   where they come back to. */

/** The instrument: the Secretary of Agriculture's own designation. */
const DECL_NAME = 'Secretarial';

/** The same, as the poster's filename spells it. */
const DECL_SLUG = 'secretarial';

/** Drought only — the decoder's `droughtOnly` argument, and the one disaster
    type this app is about. */
const DROUGHT_ONLY = true;

/* ── Small shared readings of `sel` ──────────────────────────────────────────
   `sel` is the app's selection: {year, type, variable, dataset, vintage,
   universe}, plus an optional hasGeometry the card uses. Every function below
   reads it and none of them mutate it. Nothing here reads a slice off it: the
   slice is the two constants above, so a context built by hand
   (js/interfaces/registry.js § viewSelection) describes the same map as the
   app's own selection does. */

function count(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function plural(n, one, many) {
  return count(n) + ' ' + (Number(n) === 1 ? one : many);
}

/* ── The instance this interface has seen ────────────────────────────────────
   Two leaves need the payload and are not handed it: the poster's subtitle
   needs the freshest approval date in view, and the table's caption needs how
   many declarations its rows came from. Both are facts only the decoder can
   answer, so the instance is noted on the way past in colorsFor(), which every
   paint goes through — the same arrangement js/interfaces/usdm.js uses, and for
   the same reason. One archive, so one slot rather than a map. */
let seen = null;

function remember(data) {
  if (data && typeof data.getYear === 'function') seen = data;
}

/** The instance to answer from: the one handed in, or the one the last paint
    noted. Called with nothing by the two leaves that are handed nothing. */
function instanceFor(data) {
  return (data && typeof data.getYear === 'function') ? data : seen;
}

/* ── Records ─────────────────────────────────────────────────────────────── */

/**
 * The designation code of one county, from its rows. Primary beats Contiguous
 * — the within-county half of the rule stated in the header.
 *
 * @param {{primary: object[], contiguous: object[]}|undefined} entry
 * @returns {string|null} 'Primary' | 'Contiguous' | null (not designated)
 */
function roleOf(entry) {
  if (!entry) return null;
  if (entry.primary.length) return PRIMARY;
  if (entry.contiguous.length) return CONTIGUOUS;
  return null;
}

/**
 * The join half of the rule: several Census counties on one FSA office reduce to
 * the more severe of their codes.
 *
 * @param {string[]} roles at least one
 * @returns {string}
 */
export function reduceFips(roles) {
  for (const role of roles) if (role === PRIMARY) return PRIMARY;
  return CONTIGUOUS;
}

/**
 * One FSA county's whole reading of the current slice: its reduced code, the
 * Census counties it is made of, and the declarations that touch it.
 *
 * The declarations are GROUPED, not listed row by row: one declaration can name
 * a county under several disaster types (the archive's histogram runs to
 * twelve), and a card that showed the same declaration number three times would
 * be describing one designation as three. The disaster types are joined instead,
 * verbatim.
 *
 * @returns {{role: string|null, parts: Array<object>, entries: Array<object>}}
 */
function countyView(data, xw, sel, id) {
  const out = { role: null, parts: [], entries: [] };
  const inst = instanceFor(data);
  if (!inst || !xw) return out;

  const year = sel.year;
  const byDecl = new Map();

  for (const fipsId of xw.toFips(sel.vintage, id)) {
    const rows = inst.countyRowsFor(fipsId, year, DECL_NAME, DROUGHT_ONLY);
    let partRole = null;
    let partName = '';
    for (const row of rows) {
      if (!partName) partName = row.county;
      if (row.role === PRIMARY) partRole = PRIMARY;
      else if (!partRole) partRole = CONTIGUOUS;
      const key = row.decl.index;
      let entry = byDecl.get(key);
      if (!entry) {
        entry = { decl: row.decl, role: row.role, disasterTypes: [] };
        byDecl.set(key, entry);
      }
      if (row.role === PRIMARY) entry.role = PRIMARY;
      if (!entry.disasterTypes.includes(row.disasterType)) {
        entry.disasterTypes.push(row.disasterType);
      }
    }
    out.parts.push({ id: fipsId, name: partName, role: partRole });
    if (partRole === PRIMARY) out.role = PRIMARY;
    else if (partRole === CONTIGUOUS && out.role == null) out.role = CONTIGUOUS;
  }

  /* Newest approval first, and an approval the archive does not report sorts
     LAST rather than first — a designation whose date is a spreadsheet zero is
     not the freshest thing on the list. */
  out.entries = Array.from(byDecl.values()).sort((a, b) => {
    const at = a.decl.approvalReported ? +a.decl.approval : -Infinity;
    const bt = b.decl.approvalReported ? +b.decl.approval : -Infinity;
    if (at !== bt) return bt - at;
    return a.decl.number.localeCompare(b.decl.number, 'en');
  });
  return out;
}

/* ── Paint ───────────────────────────────────────────────────────────────── */

/**
 * The Map<fsaId, cssColor> the choropleth is painted from, the FIPS keys that
 * landed nowhere, and the counts only this join can produce.
 *
 * `stats` goes straight back to liveSentence(): how many FSA counties are
 * Primary, how many Contiguous, how many county ROWS the crosswalk could not
 * place (the archive's 72 malformed keys and the genuinely retired ones, counted
 * together), and how many declarations and rows the slice holds.
 *
 * @param {object} data the active decoder instance
 * @param {object|null} xw a loadCrosswalk() instance, or null
 * @param {object} sel
 * @returns {{colors: Map<string, string>, unmatchedFips: string[], stats: object}}
 */
function colorsFor(data, xw, sel) {
  remember(data);
  const colors = new Map();
  const stats = {
    primary: 0,
    contiguous: 0,
    painted: 0,
    rows: 0,
    declarations: 0,
    unmatchedKeys: 0,
    unmatchedRows: 0,
    universe: Number(sel && sel.universe) || 0,
  };
  if (!data || typeof data.getYear !== 'function') {
    return { colors, unmatchedFips: [], stats };
  }

  const byFips = data.getYear(sel.year, DECL_NAME, DROUGHT_ONLY);
  const meta = data.sliceMeta(sel.year, DECL_NAME, DROUGHT_ONLY);
  stats.rows = meta.rows;
  stats.declarations = meta.declarations;

  if (!xw) {
    // The honest failure: treating Census keys as FSA keys would paint a map
    // that is 97% right and therefore wrong in a way nobody sees.
    console.warn('[dis/iface] this archive is FIPS-keyed and the FSA ⇄ FIPS '
      + 'crosswalk is not loaded — nothing can be painted.');
    return { colors, unmatchedFips: Array.from(byFips.keys()), stats };
  }

  /* Code per Census county first (Primary beats Contiguous within the county),
     then the crosswalk join with the same rule again. Two steps rather than one
     because they are two different reductions of the same precedence, and
     collapsing them would hide which one a surprising colour came from. */
  const roles = new Map();
  for (const [fipsId, entry] of byFips) {
    const role = roleOf(entry);
    if (role) roles.set(fipsId, role);
  }
  const { byFsa, unmatchedFips } = toFsaMap(xw, sel.vintage, roles, reduceFips);

  for (const [fsaId, role] of byFsa) {
    colors.set(fsaId, ROLE_COLORS[role] || NO_DATA());
    if (role === PRIMARY) stats.primary += 1; else stats.contiguous += 1;
  }
  stats.painted = colors.size;

  // COUNTY ROWS, not keys: the sentence says "county rows could not be matched",
  // and a malformed key naming four counties is four designations nobody can
  // put on the map.
  stats.unmatchedKeys = unmatchedFips.length;
  for (const fipsId of unmatchedFips) {
    const entry = byFips.get(fipsId);
    if (entry) stats.unmatchedRows += entry.primary.length + entry.contiguous.length;
  }

  return { colors, unmatchedFips, stats };
}

/* ── Legend ──────────────────────────────────────────────────────────────── */

/** Two named categories and an absence: chips, never a bar — Primary and
    Contiguous are not two ends of a scale. */
function legendKind() {
  return 'swatches';
}

/** The chips, Primary first, each named in words. The names ARE the legend: two
    hues have nothing left in grayscale, and the poster is the one place a reader
    cannot hover to find out (HOUSE-STYLE §6). */
function legendItems() {
  return [
    { color: ROLE_COLORS.Primary, label: 'Primary — named in the designation' },
    {
      color: ROLE_COLORS.Contiguous,
      label: 'Contiguous — neighboring county, same access',
    },
  ];
}

/** What the absence of colour means here — and it is not "no data": the county
    is in the archive, it simply was not designated that year. */
function legendNoDataLabel(sel) {
  return 'No designation in ' + (sel && sel.year ? sel.year : 'this year');
}

/**
 * What the colours mean, in a sentence — the redundancy channel that makes this
 * map legible in grayscale, to a CVD reader and to a screen reader, and the
 * place the contiguity rule is stated, because a reader who takes orange for
 * "less drought" has misread every neighbouring county on the map.
 */
function legendKey() {
  return 'Red counties were named directly in a disaster designation this year; '
    + 'orange counties qualify as their contiguous neighbors, with the same '
    + 'access to emergency loans. Gray counties were not designated.';
}

/* ── Tooltip ─────────────────────────────────────────────────────────────── */

/**
 * The tooltip's value line — the same words the card uses. The tooltip is
 * aria-hidden decoration; this content reaches assistive technology through the
 * live region and the card.
 *
 * The two roles are described asymmetrically on purpose. A Primary county was
 * NAMED, and how many times is a fact about it worth reading at a glance; a
 * Contiguous county was not named at all — it qualifies through a neighbour, and
 * counting its neighbours' designations would invite a reading of severity that
 * the contiguity rule does not support.
 */
function tooltip(data, xw, sel, id) {
  const view = countyView(data, xw, sel, id);
  if (!view.role) return legendNoDataLabel(sel);
  if (view.role === PRIMARY) {
    // The designations that NAMED this county, not every one that reaches it:
    // the number has to be the one the colour is about.
    let named = 0;
    for (const entry of view.entries) if (entry.role === PRIMARY) named += 1;
    return PRIMARY + ' — '
      + plural(named, 'drought designation', 'drought designations');
  }
  return CONTIGUOUS + ' (drought)';
}

/* ── The county card ─────────────────────────────────────────────────────── */

/** 'Primary — named directly in a designation' etc. The gloss is what makes a
    one-word code mean something to a reader who has not read the statute. */
function rolePhrase(role) {
  if (role === PRIMARY) return PRIMARY + ' — named directly in a designation';
  if (role === CONTIGUOUS) {
    return CONTIGUOUS + ' — a neighboring county was named, and this county has '
      + 'the same access to assistance';
  }
  return 'Not designated';
}

/**
 * The card's rows for one county in the selected year, declaration type and
 * scope.
 *
 * Every case is stated in WORDS rather than implied by an empty box: the
 * designation code and what it means, how many designations there were and how
 * they split, what was combined when one FSA office administers several Census
 * counties, and the absence of a designation as the fact it is.
 *
 * @returns {Array<{term: string, value: string, isNote?: boolean}>}
 */
function cardRows(data, xw, sel, id) {
  const rows = [];
  const view = countyView(data, xw, sel, id);

  rows.push({ term: 'FSA county code', value: String(id) });

  if (!view.role) {
    rows.push({
      term: sel.year + ' designations',
      value: 'Not designated: this archive records no ' + DECL_NAME
        + ' drought designation naming this county or a neighbor in '
        + sel.year + '.',
      isNote: true,
    });
    if (sel.hasGeometry === false) rows.push(boundaryNote(sel));
    return rows;
  }

  rows.push({ term: 'Designation code', value: rolePhrase(view.role) });

  /* The COUNT is of declarations, not of county rows: one declaration can name
     a county under several disaster types, and the list under this readout has
     one entry per declaration. The split names how many of them reached this
     county directly. */
  let primary = 0;
  for (const entry of view.entries) if (entry.role === PRIMARY) primary += 1;
  const total = view.entries.length;
  rows.push({
    term: 'Designations in ' + sel.year,
    value: count(total) + ' (' + count(primary) + ' Primary, '
      + count(total - primary) + ' Contiguous)',
  });

  /* What was combined, and out of what. Several Census counties on one FSA
     office is the case where the colour on the map is a reduction, and the
     reader of a five-county office needs to see which part of it was named. */
  if (view.parts.length > 1) {
    const parts = view.parts.map((part) => {
      const label = part.name ? part.name + ' (' + part.id + ')' : part.id;
      return label + ' ' + (part.role ? part.role.toLowerCase() : 'not designated');
    });
    const mixed = view.parts.some((part) => part.role !== view.parts[0].role);
    rows.push({
      term: 'Combined from',
      value: parts.join('; ') + '.'
        + (mixed ? ' The stronger designation is shown.' : ''),
      isNote: true,
    });
  }

  if (sel.hasGeometry === false) rows.push(boundaryNote(sel));
  return rows;
}

function boundaryNote(sel) {
  return {
    term: 'Boundary',
    value: 'No boundary available to display — this county is not in the '
      + (sel.vintage || 'current') + ' FSA boundary archive.',
    isNote: true,
  };
}

/* ── The card's second half: the designations themselves ─────────────────────
   A LIST, not a chart. What this archive holds for one county in one year is
   TEXT — a declaration number, a disaster type nobody normalised, a description
   somebody typed, three dates two of which are often missing — and there is no
   picture of that which is not a worse version of reading it.

   Which is also why there is no figure/twin pair here (HOUSE-STYLE §5.2): the
   twin exists because a canvas is a rectangle to a screen reader, and semantic
   markup is already the accessible form. A <ul> of <li>s IS the data. */

/** The caption's id, so the list beside it can be named by it rather than by a
    second copy of the same sentence. One card is open at a time, so one of these
    exists in the document at a time. */
const CAPTION_ID = 'decl-caption';

function htmlEl(name, attrs, text) {
  const node = document.createElement(name);
  if (attrs) for (const key in attrs) node.setAttribute(key, String(attrs[key]));
  if (text != null) node.textContent = text;
  return node;
}

/** "Approved Jan 15, 2025" — or the reason there is no date to print. An
    approval of zero or less is a spreadsheet's blank (js/decoders/
    fsa-disasters.js § Dates), and printing "Dec 30, 1899" would be the app
    repeating an artifact as a fact. */
function approvalPhrase(decl) {
  if (decl.approvalReported && decl.labels.approval) {
    return 'Approved ' + decl.labels.approval;
  }
  return 'Approval date not reported';
}

/**
 * "incident May 1, 2024 – ongoing or not reported".
 *
 * The archive's end dates are absent on 2,146 of its 3,907 declarations, and
 * absent means one of two things it does not distinguish: the incident is still
 * running, or nobody filled the cell in. So the app says both rather than
 * choosing — and never prints an open range as if it had been closed.
 */
function incidentPhrase(decl) {
  const begin = decl.labels.begin;
  const end = decl.labels.end;
  if (begin && end) return 'incident ' + begin + ' – ' + end;
  if (begin) return 'incident ' + begin + ' – ongoing or not reported';
  if (end) return 'incident through ' + end;
  return 'incident dates not reported';
}

/**
 * The card's list: one entry per declaration touching this county this year,
 * newest approval first.
 *
 * @returns {null} nothing here changes without the render key changing
 */
function cardBody(container, data, xw, sel, id) {
  remember(data);
  const view = countyView(data, xw, sel, id);
  if (!view.entries.length) {
    // The card's <dl> above has already said, in words, that there is no
    // designation. A second empty box under it would say it worse.
    container.replaceChildren();
    return null;
  }

  /* The list is a TAB STOP, and it is the only element in this card body that
     is: on compact the card is a bottom sheet whose body scrolls, and a
     scrollable region a keyboard can neither reach nor scroll is a WCAG 2.1.1
     failure (axe: scrollable-region-focusable, which every other view's card
     satisfies through the <summary> of its table twin — this one has no
     <details> to lean on). Focusing the list lets the arrow keys scroll its
     scrollable ancestor, and the caption above it is its accessible name, so
     the stop announces what it is rather than "list". */
  const list = htmlEl('ul', {
    class: 'decl-list',
    tabindex: '0',
    'aria-labelledby': CAPTION_ID,
  });
  for (const entry of view.entries) {
    const decl = entry.decl;
    const item = htmlEl('li', { class: 'decl-item' });

    const head = htmlEl('p', { class: 'decl-head' });
    /* The swatch is a second channel for the chip beside it, never the only
       one: the WORD is right there. Its fill is a DATA colour and so is set
       here rather than in css/app.css, like every other data colour in this
       app. */
    const chip = htmlEl('span', { class: 'decl-role' });
    const swatch = htmlEl('span', { class: 'decl-swatch', 'aria-hidden': 'true' });
    swatch.style.background = ROLE_COLORS[entry.role] || NO_DATA();
    chip.append(swatch, document.createTextNode(entry.role));
    head.append(htmlEl('code', null, decl.number));
    head.append(document.createTextNode(' · ' + decl.type
      + (Number.isInteger(decl.amendment) && decl.amendment !== 0
        ? ' · Amendment ' + decl.amendment : '')
      + ' · ' + entry.disasterTypes.join(', ') + ' '));
    head.append(chip);
    item.appendChild(head);

    /* The description is the archive's own text, and it is often the only place
       the actual event is named ("Blizzard, Excessive Snow, Excessive Rain,
       Freeze, Flooding, Flash Flooding, and High Winds"). Verbatim. */
    item.appendChild(htmlEl('p', { class: 'decl-desc' }, decl.description));
    item.appendChild(htmlEl('p', { class: 'decl-dates' },
      approvalPhrase(decl) + ' · ' + incidentPhrase(decl)));
    list.appendChild(item);
  }

  const caption = htmlEl('p', { class: 'decl-caption', id: CAPTION_ID },
    plural(view.entries.length,
      DECL_NAME + ' drought designation in ' + sel.year,
      DECL_NAME + ' drought designations in ' + sel.year)
    + ', newest approval first.');

  container.replaceChildren(caption, list);
  return null;
}

/* NO cardKey(). This family used to add the declaration type and the scope to
   the card's render key, because either one changed the list entirely and
   neither was in the app's own key. Both are constants now, so the app's key —
   county, view, dataset, year, type — is the whole of what can change here, and
   an extra leaf that always answered the same string would be a hook for a
   reader to wonder about (js/card-content.js § keyOf treats it as optional). */

/* ── The live region ─────────────────────────────────────────────────────── */

/**
 * The always-on half of the a11y twin: what the canvas is showing, in a
 * sentence. The on-demand table is the other half.
 *
 * The denominator is the MAP's county count (`sel.universe`), not the archive's:
 * the question a reader has is "how many of the counties I am looking at are
 * coloured", and an archive that names 1,500 of the 3,095 counties on screen
 * must not report "1,500 of 1,500".
 *
 * @param {object} sel
 * @param {number} shown counties actually painted (the app's own count)
 * @param {number} total keys in the payload — not used: those are Census
 *        counties and this sentence is about FSA ones
 * @param {number} missingGeometry counties with data and nowhere to draw it
 * @param {object} [stats] from colorsFor()
 * @returns {string}
 */
function liveSentence(sel, shown, total, missingGeometry, stats) {
  const head = sel.year + ' ' + DECL_NAME + ' drought designations';
  if (!stats || !stats.universe) return head + ': nothing to show yet.';

  // A year the Secretary designated no county for drought in. Said as the fact
  // it is: the map is empty because the record is, not because it failed.
  if (!stats.rows) return head + ': none in this archive.';

  let msg = head + ': ' + count(stats.primary) + ' primary and '
    + count(stats.contiguous) + ' contiguous counties of '
    + count(stats.universe) + ' shown.';
  if (stats.unmatchedRows > 0) {
    // The archive's malformed county keys and the genuinely retired ones,
    // counted together and always: a designation nobody can put on a map is
    // still a designation.
    msg += ' ' + plural(stats.unmatchedRows,
      'county row could not be matched to a county boundary.',
      'county rows could not be matched to a county boundary.');
  }
  if (missingGeometry > stats.unmatchedKeys) {
    msg += ' ' + count(missingGeometry - stats.unmatchedKeys)
      + ' more have a designation but no county boundary to draw.';
  }
  return msg;
}

/* ── The data table ──────────────────────────────────────────────────────── */

/**
 * EVERY county row of the slice, not the reduction the map paints — and in the
 * archive's own words.
 *
 * That is the point of this table: the map can only show one code per county,
 * and the record's own grain is one row per county per disaster type per
 * declaration. It is also where the archive's irregularities become visible
 * rather than merely counted: a state called "Acoma", a county key of "0010", a
 * county named for a tribe rather than a county. None of it is cleaned here.
 */
function tableColumns() {
  return [
    { label: 'County', key: 'county', rowHeader: true },
    { label: 'State', key: 'state' },
    // The archive's key, verbatim — five digits for most rows and something
    // else for 72 of its 3,306 keys.
    { label: 'FIPS', key: 'fips', code: true },
    { label: 'Role', key: 'role' },
    { label: 'Declaration', key: 'declaration', code: true },
    { label: 'Type', key: 'type' },
    { label: 'Disaster', key: 'disaster' },
    { label: 'Description', key: 'description' },
    { label: 'Approved', key: 'approved' },
    { label: 'Begin', key: 'begin' },
    { label: 'End', key: 'end' },
  ];
}

/**
 * @param {object} data the active decoder instance
 * @param {object|null} xw the crosswalk (unused: these rows are the archive's
 *        own, in its own key space — the join is the MAP's business)
 * @param {object} sel
 */
function tableRows(data, xw, sel) {
  const rows = [];
  const inst = instanceFor(data);
  if (!inst) return rows;
  const dash = '—';

  for (const [fipsId, entry] of inst.getYear(sel.year, DECL_NAME, DROUGHT_ONLY)) {
    for (const row of entry.primary.concat(entry.contiguous)) {
      const decl = row.decl;
      rows.push({
        fips: fipsId,
        county: row.county,
        state: row.state,
        role: row.role,
        declaration: decl.number
          + (Number.isInteger(decl.amendment) && decl.amendment !== 0
            ? ' A' + decl.amendment : ''),
        type: decl.type,
        disaster: row.disasterType,
        description: decl.description,
        // Em-dash text, never a blank cell: "the record does not say" is a
        // value, and an empty cell reads as a bug.
        approved: decl.approvalReported ? decl.labels.approval : dash,
        begin: decl.labels.begin || dash,
        end: decl.labels.end || dash,
      });
    }
  }

  rows.sort((a, b) => a.state.localeCompare(b.state, 'en')
    || a.county.localeCompare(b.county, 'en')
    || a.fips.localeCompare(b.fips, 'en')
    || a.declaration.localeCompare(b.declaration, 'en')
    || a.disaster.localeCompare(b.disaster, 'en'));
  return rows;
}

/** The sentence that names the table — the dialog's subtitle, the table's own
    sr-only <caption>, and the scroll region's accessible name. It counts ROWS
    and DECLARATIONS, because the row count is neither the county count nor the
    declaration count here and a reader who assumes it is has misread the
    table. */
function tableCaption(sel, nRows) {
  const inst = instanceFor();
  const n = Number(nRows) || 0;
  const head = sel.year + ' — ' + DECL_NAME + ', drought — '
    + plural(n, 'county designation', 'county designations');
  if (!inst) return head + '.';
  const meta = inst.sliceMeta(sel.year, DECL_NAME, DROUGHT_ONLY);
  return head + ' under '
    + plural(meta.declarations, 'declaration', 'declarations') + '.';
}

/** What makes one built table different from another: the declaration type, the
    scope and the year. Not the county or the camera. */
function tableCacheKey(sel) {
  return DECL_SLUG + '|drought|' + sel.year;
}

/* ── The poster ──────────────────────────────────────────────────────────── */

function exportTitle() {
  return 'USDA Disaster Designations';
}

/** `fsa-disasters_<year>_secretarial_drought.png`. The year is the only thing
    that tells two of these posters apart — this family has no pasture type and
    no colour-by — and the slice is spelled out anyway, because a poster outlives
    the page it came from and "fsa-disasters_2021" would not say which corner of
    a 22-disaster-type archive it holds. */
function exportFilename(sel) {
  return ['fsa-disasters', String(sel.year), DECL_SLUG, 'drought']
    .join('_') + '.png';
}

/**
 * The archive README's own subtitle, in the app's voice: what the map holds,
 * and how fresh it is.
 *
 * "approved through …" is not decoration. A program year is designated
 * continuously — the 2026 map gains counties every month — so a poster of it
 * without the date it was true on is a poster that will be wrong within weeks
 * and will not say so. The clause is dropped only when the archive reports no
 * approval date at all for the slice, which is the honest silence.
 */
function exportSubtitle(sel) {
  const head = sel.year + ' ' + DECL_NAME + ' designations for drought';
  const inst = instanceFor();
  const latest = inst
    ? inst.latestApproval(sel.year, DECL_NAME, DROUGHT_ONLY) : null;
  if (!latest) return head;
  return head + ' · approved through ' + LABEL_FMT.format(latest);
}

/** The credit line along the poster's foot. A poster outlives the page it came
    from, so the provenance travels with the pixels — and here that provenance is
    a weekly scrape of a federal portal, which is the reason the archive exists
    at all. */
function exportCredit() {
  return 'Sustainable FSA · USDA Disaster Designation portal archive · Montana '
    + 'Climate Office · sustainable-fsa.com/lfp-explorer';
}

/* ── Pending state ───────────────────────────────────────────────────────────
   There is nothing to park, and now nothing to resolve either: this family has
   one dataset, one instrument and one disaster type, none of which needs a
   dictionary from a payload before it can be validated — unlike a pasture type
   or a week. Hence no applyPending() leaf: app.js only calls one for the
   controls a family declares (js/app.js § applyDataset). */

/**
 * What to say when the shared year has to move to come on screen here.
 *
 * The specific case is worth the words: the archive's earliest designations sit
 * under the year string "2011, 2012", which is not a year and cannot be put on
 * a slider, so 2011 is a year this map genuinely cannot show even though the
 * app validates it.
 *
 * @returns {string|null} null to accept the app's own wording
 */
function clampNotice(from, to) {
  if (from === 2011 && to === 2012) {
    return 'Showing ' + to + ' — the archive dates its earliest designations '
      + '"2011, 2012", which is not a year this map can place.';
  }
  return null;
}

/* ── The descriptor ──────────────────────────────────────────────────────── */

/**
 * Interface 4, and the last: with it the switcher tells the whole story — where
 * it was dry, when that dryness had to fall to count, what the two of them
 * qualified the county for, and the wider designations around it. Frozen, like
 * every descriptor: the app reads it on every repaint and a mutated leaf would
 * mean the legend and the paint disagreed.
 */
export const DISASTERS = Object.freeze({
  id: 'disasters',
  label: 'Disaster designations',
  /** See ngp.js — the map's accessible name follows the active family. */
  mapLabel: 'Choropleth map of USDA disaster designations by county',
  order: 4,
  datasets: DATASETS,
  /** The widest year this map will validate. The archive's own floor is 2012
      (the fifteen four-digit strings in its year dictionary); 2011 is accepted
      here because the archive HAS 2011 designations — it simply dates them
      "2011, 2012" — and applyYearDomain() then re-authors the slider from the
      payload and clamps, with clampNotice() saying why. */
  years: Object.freeze({ min: 2011, max: 2026 }),
  /** No pasture type, no colour-by (one quantity, two categories), no week —
      and, since this map is the one slice named in the header, no `choices`
      either. The shared year is the whole of its state. */
  controls: Object.freeze({ type: false, variable: false, week: false }),
  reduceFips,
  colorsFor,
  legend: Object.freeze({
    kind: legendKind,
    key: legendKey,
    items: legendItems,
    noDataLabel: legendNoDataLabel,
  }),
  tooltip,
  cardRows,
  cardBody,
  liveSentence,
  table: Object.freeze({
    columns: tableColumns,
    rows: tableRows,
    caption: tableCaption,
    cacheKey: tableCacheKey,
  }),
  export: Object.freeze({
    title: exportTitle,
    filename: exportFilename,
    subtitle: exportSubtitle,
    credit: exportCredit,
  }),
  clampNotice,
});
