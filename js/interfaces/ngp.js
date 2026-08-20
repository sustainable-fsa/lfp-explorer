/* ============================================================================
   LFP Explorer · js/interfaces/ngp.js
   Interface 1 · Grazing periods. Two readings of the same question — when may
   livestock graze this county, and for how long — and every sentence the app
   says about either of them.

   ES module, no build step. Imports the color scales, the `fsa-ngp-web/1`
   decoder and the crosswalk join; imports nothing from app.js (the module
   graph stays acyclic: app.js → registry → descriptors → decoders + color).

   ── The two datasets ───────────────────────────────────────────────────────
     FSA official (FOIA)     what FSA actually published, county by county,
                             program year by program year, 2008–2026. Keyed by
                             FSA county code — the same key the polygons use.
     nClimGrid climatology   what NAP-190's own method yields when it is run on
                             1991–2020 climate normals instead of on a county
                             committee's determination. Keyed by Census FIPS,
                             with no program year at all.

   The second is a COUNTERFACTUAL, not a correction, and every string in this
   file that describes it says so. It answers "what would the method give
   here?", which is a different question from "what did FSA determine here?";
   reading it as the second is the one misuse this interface can invite, so the
   legend key, the subtitle and the credit all carry the provenance.

   ── Why the descriptor is functions and not a table ────────────────────────
   The declarative half (ids, labels, URLs, schemas, key spaces) is data. The
   other half is PROSE — the legend key, the tooltip, the card rows, the live
   region's sentence, the table's caption, the poster's subtitle — and prose
   with conditions in it belongs in a named function where it can be read as
   English, not in a mini-language of format strings. Each function below is
   the single place its wording lives, so the same words reach the sighted
   reader, the screen-reader user, the table and the PNG.

   ── The crosswalk rule, stated once ────────────────────────────────────────
   The climatology is FIPS-keyed and the map draws FSA counties, so its values
   are carried across by js/decoders/crosswalk.js. One Census county split
   between two FSA offices replicates onto both. Several Census counties
   administered by ONE FSA office collide, and reduceFips() picks the LONGEST
   period — a whole record, never a blend. A card that showed one constituent's
   start date beside another's end date would describe a county that does not
   exist; when a reduction happened, the card lists what was combined instead.
   ========================================================================== */

import { VARIABLES } from '../color.js';
import { makeNgpData } from '../decoders/ngp-web.js';
import { toFsaMap } from '../decoders/crosswalk.js';

/* ── Constants ───────────────────────────────────────────────────────────── */

/** The normals period the climatology is computed over. One constant because
    it appears in the legend key, the card, the live region, the table caption
    and the poster subtitle, and they must not drift apart. */
const ERA = '1991–2020';

/**
 * The two datasets, declaratively. `keySpace` and `expect` are the load-time
 * safety rails: both payloads declare the SAME schema string, so a swapped URL
 * is caught by year0 (2008 vs 2001) rather than by a reader noticing the map
 * is wrong (js/decoders/common.js § assertExpectations).
 *
 * `defaultType` is per dataset because the dictionaries are disjoint: FSA's
 * sixteen pasture types and the climatology's three seasons share no name.
 * The pair below is the TYPE_ALIASES pair, so a reader who toggles datasets
 * without touching the type select keeps looking at the same forage regime.
 */
const DATASETS = Object.freeze([
  Object.freeze({
    id: 'fsa',
    label: 'FSA official (FOIA)',
    url: '../fsa-normal-grazing-period/fsa-normal-grazing-period.json',
    schema: 'fsa-ngp-web/1',
    keySpace: 'fsa',
    expect: Object.freeze({ year0: 2008 }),
    defaultType: 'Native Pasture',
    decode: makeNgpData,
  }),
  Object.freeze({
    id: 'nclimgrid',
    label: 'nClimGrid climatology',
    url: '../nclimgrid-normal-grazing-period/nclimgrid-normal-grazing-period.json',
    schema: 'fsa-ngp-web/1',
    keySpace: 'fips',
    expect: Object.freeze({ year0: 2001 }),
    nominalYears: true,
    defaultType: 'Full Season',
    decode: makeNgpData,
  }),
]);

/** Month + day, no year: a climatology's dates are a point in the calendar,
    and "May 15, 2001" would invite the reader to believe 2001 means something.
    timeZone: 'UTC' is not optional — every Date in this app is UTC midnight,
    and a local-time read of one is the previous day west of Greenwich
    (js/decoders/ngp-web.js § Dates are UTC, always). */
const MD_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', month: 'short', day: 'numeric',
});

/* ── Small shared readings of `sel` ──────────────────────────────────────── */

/** `sel` is the app's selection: {year, type, variable, dataset, vintage},
    plus an optional hasGeometry the card uses. Every function below reads it
    and none of them mutate it. */

function datasetById(id) {
  for (const ds of DATASETS) if (ds.id === id) return ds;
  return DATASETS[0];
}

/** True when the selection is the climatology. Asked of the DESCRIPTOR's own
    facts (nominalYears) rather than of the id string, so the prose follows the
    dataset's nature and not a spelling. */
function isClimatology(sel) {
  return !!datasetById(sel && sel.dataset).nominalYears;
}

function spec(sel) {
  return VARIABLES[sel && sel.variable] || VARIABLES.duration;
}

function weeks(n) {
  return n + (n === 1 ? ' week' : ' weeks');
}

/* ── Records ─────────────────────────────────────────────────────────────── */

/**
 * The one record a many-FIPS→one-FSA collision resolves to: the LONGEST
 * period, because the eligibility question this data serves ("could livestock
 * graze here?") is answered by the most permissive constituent, and because
 * the alternative — an average — would invent a season no county reported.
 *
 * Ties break by earliest start, then by lowest county id, so the reduction is
 * deterministic: the same payload and the same vintage always paint the same
 * color, in any browser, in any session.
 *
 * Returns ONE of the records it was handed. It never builds a new one: a card
 * showing one constituent's start beside another's end would describe a county
 * that does not exist.
 *
 * @param {object[]} records constituent records, at least one
 * @returns {object} one of them
 */
export function reduceFips(records) {
  let best = records[0];
  for (let i = 1; i < records.length; i++) {
    const rec = records[i];
    if (rec.duration_weeks > best.duration_weeks) { best = rec; continue; }
    if (rec.duration_weeks < best.duration_weeks) continue;
    if (+rec.start < +best.start) { best = rec; continue; }
    if (+rec.start > +best.start) continue;
    // Ids are 5-character STRINGS; lexicographic order IS numeric order for
    // five digits, and there is no parse anywhere near a county key.
    if (String(rec.id) < String(best.id)) best = rec;
  }
  return best;
}

/**
 * The record behind one FSA county, whichever key space the data is in.
 *
 * On the climatology this walks the FSA id's own constituents rather than the
 * whole crosswalked map: `xw.toFips(v, fsaId)` and `xw.toFsa(v, fipsId)` are
 * built from one pair list, so the constituent set is exactly the bucket
 * colorsFor() would have reduced — the card and the paint cannot disagree.
 *
 * @returns {object|null}
 */
function recordFor(data, xw, sel, id) {
  if (!data) return null;
  const recs = data.getYearType(sel.year, sel.type);
  if (data.keySpace !== 'fips') return recs.get(String(id)) || null;
  if (!xw) return null;
  const found = [];
  for (const fipsId of xw.toFips(sel.vintage, id)) {
    const rec = recs.get(fipsId);
    if (rec) found.push(rec);
  }
  return found.length ? reduceFips(found) : null;
}

/* ── Paint ───────────────────────────────────────────────────────────────── */

/**
 * The Map<fsaId, cssColor> the choropleth is painted from, plus the honest
 * remainder.
 *
 * `unmatchedFips` is data the crosswalk could not place on this vintage's
 * geometry. The app folds it into the live region's "have data but no county
 * boundary to draw" count, because silently dropping rows is how a broken
 * join becomes invisible.
 *
 * A FIPS-keyed dataset with no crosswalk yet paints NOTHING and says every
 * county is unmatched. That is the honest failure: the alternative — treating
 * FIPS ids as FSA ids — is a map that is 97% right and therefore wrong in a
 * way nobody sees.
 *
 * @param {object} data the active decoder instance
 * @param {object|null} xw a loadCrosswalk() instance, or null
 * @param {{year: number, type: string, variable: string, dataset: string,
 *          vintage: string}} sel
 * @returns {{colors: Map<string, string>, unmatchedFips: string[]}}
 */
function colorsFor(data, xw, sel) {
  const s = spec(sel);
  const colors = new Map();
  const recs = data ? data.getYearType(sel.year, sel.type) : new Map();

  if (!data || data.keySpace !== 'fips') {
    for (const [id, rec] of recs) colors.set(id, s.scale(rec[s.field]));
    return { colors, unmatchedFips: [] };
  }

  if (!xw) {
    console.warn('[ngp/iface] the ' + sel.dataset + ' dataset is FIPS-keyed and '
      + 'the FSA ⇄ FIPS crosswalk is not loaded — nothing can be painted.');
    return { colors, unmatchedFips: Array.from(recs.keys()) };
  }

  const { byFsa, unmatchedFips } = toFsaMap(xw, sel.vintage, recs, reduceFips);
  for (const [id, rec] of byFsa) colors.set(id, s.scale(rec[s.field]));
  return { colors, unmatchedFips };
}

/* ── Legend ──────────────────────────────────────────────────────────────── */

/** Which legend body this selection wants. The cyclic ramp is a month WHEEL
    because the ends meet; duration is a bar because it does not. */
function legendKind(sel) {
  return spec(sel).cyclic ? 'wheel' : 'bar';
}

/** The label on the no-data chip — in the drawer legend, in the colorbar and
    on the poster. "Gray" is never the only channel: the absence has a name.
    On the climatology the absence is a different fact (the method yields no
    season here), so it gets different words. */
function legendNoDataLabel(sel) {
  return isClimatology(sel) ? 'No climatological season' : 'No reported grazing period';
}

/**
 * Plain-language meaning of the active ramp. This is the redundancy channel
 * that makes the map legible in grayscale, to a CVD reader, and to a screen
 * reader — it is not decoration, and it is never optional. On the climatology
 * it also carries the provenance clause, because a reader who arrives at a
 * shared link needs to know these are not FSA's numbers.
 */
function legendKey(sel) {
  const climate = isClimatology(sel);
  const gray = climate
    ? 'Counties with no climatological season are gray.'
    : 'Counties with no reported period are gray.';
  const provenance = climate
    ? ' These periods are computed from ' + ERA + ' climate normals, not '
      + 'reported by FSA.'
    : '';

  if (!spec(sel).cyclic) {
    return 'Dark counties graze for a few weeks; light counties graze most of '
      + 'the year. ' + gray + provenance;
  }
  const which = sel.variable === 'start' ? 'begins' : 'ends';
  return 'Color is the point in the calendar where the grazing period ' + which
    + ', read against the months around the wheel. The scale wraps, so late '
    + 'December and early January are neighboring colors. ' + gray + provenance;
}

/* ── Tooltip ─────────────────────────────────────────────────────────────── */

/**
 * The tooltip's value line: the same number the card shows, for the active
 * variable. The tooltip is aria-hidden decoration — this content reaches
 * assistive technology through the live region and the card.
 *
 * On the climatology the date labels drop the year, for the reason MD_FMT
 * gives, and the no-data line names the absence as a climatological one.
 *
 * @returns {string}
 */
function tooltip(data, xw, sel, id) {
  const rec = recordFor(data, xw, sel, id);
  const climate = isClimatology(sel);
  if (!rec) {
    return climate
      ? 'No climatological season'
      : 'No data for ' + sel.type + ' in ' + sel.year;
  }
  if (sel.variable === 'start') {
    return 'Starts ' + (climate ? MD_FMT.format(rec.start) : rec.startLabel);
  }
  if (sel.variable === 'end') {
    return 'Ends ' + (climate ? MD_FMT.format(rec.end) : rec.endLabel);
  }
  return weeks(rec.duration_weeks);
}

/* ── The county card ─────────────────────────────────────────────────────── */

/**
 * The card's rows for one county at the CURRENT selection, as {term, value,
 * isNote} — the app turns each into a <dt>/<dd> pair, so the #card-rows
 * MutationObserver contract is untouched.
 *
 * Every case is stated in WORDS rather than implied by an empty box: a
 * reported period, a county with no period this year, a county whose value was
 * combined from several Census counties, and a county that is in the data but
 * has no polygon in either boundary archive.
 *
 * The boundary note is emitted only when the caller says `hasGeometry: false`.
 * app.js is the only module that knows the loaded vintage's polygon index; if
 * it appends that row itself it simply leaves the flag off, and nothing here
 * duplicates it.
 *
 * @returns {Array<{term: string, value: string, isNote?: boolean}>}
 */
function cardRows(data, xw, sel, id) {
  const rows = [];
  const climate = isClimatology(sel);
  const rec = recordFor(data, xw, sel, id);

  rows.push({ term: 'FSA county code', value: String(id) });
  rows.push(climate
    ? { term: 'Season (climatology)', value: sel.type }
    : { term: 'Pasture type', value: sel.type });

  if (rec) {
    rows.push({
      term: 'Season start',
      value: climate ? MD_FMT.format(rec.start) : rec.startLabel,
    });
    rows.push({
      term: 'Season end',
      value: climate ? MD_FMT.format(rec.end) : rec.endLabel,
    });
    rows.push({ term: 'Duration', value: weeks(rec.duration_weeks) });
  } else if (climate) {
    rows.push({
      term: 'Grazing period',
      value: 'No climatological season for this county.',
      isNote: true,
    });
  } else {
    rows.push({
      term: sel.year + ' grazing period',
      value: 'No data for ' + sel.type + ' in ' + sel.year + '.',
      isNote: true,
    });
  }

  // What was combined, and out of what. Only where there is something to
  // reconcile: naming one constituent would be noise, and the reader of a
  // five-county FSA office needs to see that the number on the map is one of
  // five — with the other four's own dates, so the choice is auditable.
  if (climate && xw && data) {
    const constituents = xw.toFips(sel.vintage, id);
    if (constituents.length > 1) {
      const recs = data.getYearType(sel.year, sel.type);
      const withSeason = constituents.filter((fipsId) => recs.has(fipsId));
      if (rec) {
        const parts = constituents.map((fipsId) => {
          const nm = data.countyName(fipsId);
          const own = recs.get(fipsId);
          const dates = own
            ? MD_FMT.format(own.start) + ' – ' + MD_FMT.format(own.end)
            : 'no season';
          // The name only when the payload has one: "02020 (02020)" reads as a
          // bug, and a FIPS county absent from the climatology has no name in
          // it to print.
          const label = nm ? nm.county + ' (' + fipsId + ')' : fipsId;
          return label + ' ' + dates;
        });
        rows.push({
          term: 'Combined from',
          value: parts.join('; ') + '. The longest period is shown.',
          isNote: true,
        });
      } else if (!withSeason.length) {
        // Twenty-three lines of "no season" say nothing the sentence above did
        // not. What the reader still needs is the scale of the office.
        rows.push({
          term: 'Combined from',
          value: 'This FSA office administers ' + constituents.length
            + ' Census counties; none of them has a climatological season.',
          isNote: true,
        });
      }
    }
  }

  if (sel.hasGeometry === false) {
    rows.push({
      term: 'Boundary',
      value: 'No boundary available to display — this county is not in the '
        + (sel.vintage || 'current') + ' FSA boundary archive.',
      isNote: true,
    });
  }

  return rows;
}

/* ── The live region ─────────────────────────────────────────────────────── */

/**
 * The always-on half of the a11y twin: a short summary of what the canvas is
 * showing right now (HOUSE-STYLE §5.2). The on-demand table is the other half.
 *
 * `missingGeometry` counts counties whose data cannot be drawn — no polygon in
 * this vintage, or (on the climatology) no crosswalk entry at all. Reporting
 * it keeps the sentence honest: "3,061 of 3,095" with nothing else said would
 * quietly imply the rest have no data.
 *
 * @param {object} sel
 * @param {number} shown counties actually painted
 * @param {number} total counties in the data
 * @param {number} missingGeometry counties with data and nowhere to draw it
 * @returns {string}
 */
function liveSentence(sel, shown, total, missingGeometry) {
  const label = spec(sel).label.toLowerCase();
  const head = isClimatology(sel)
    ? ERA + ' climatology, ' + sel.type
    : sel.year + ' ' + sel.type;
  let msg = head + ': ' + Number(shown).toLocaleString('en-US') + ' of '
    + Number(total).toLocaleString('en-US') + ' counties shown, colored by '
    + label + '.';
  if (missingGeometry > 0) {
    msg += ' ' + Number(missingGeometry).toLocaleString('en-US')
      + ' more have data but no county boundary to draw.';
  }
  return msg;
}

/* ── The data table ──────────────────────────────────────────────────────── */

/** The sentence that names the table — the dialog's visible subtitle, the
    table's own sr-only <caption>, and the scroll region's accessible name, all
    from here so they cannot drift. */
function tableCaption(sel, nRows) {
  const n = Number(nRows) || 0;
  const count = n.toLocaleString('en-US');
  if (isClimatology(sel)) {
    return sel.type + ', ' + ERA + ' climatology — ' + count
      + (n === 1 ? ' county' : ' counties');
  }
  return sel.type + ', ' + sel.year + ' — ' + count
    + (n === 1 ? ' county reporting' : ' counties reporting');
}

/* ── The poster ──────────────────────────────────────────────────────────── */

/** Everything before `_<type-slug>_<variable>.png` in the download name. The
    official scheme is unchanged from the day it shipped — posters already in
    circulation are named this way and the name is how they sort. The
    climatology carries no year, because it has none. */
function exportFilenamePart(sel) {
  return isClimatology(sel) ? 'fsa-ngp-nclimgrid' : 'fsa-ngp_' + sel.year;
}

/** The poster's one-line subtitle, under the title. */
function exportSubtitle(sel) {
  const head = isClimatology(sel) ? ERA + ' climatology' : String(sel.year);
  return sel.type + ' · ' + head + ' · ' + spec(sel).label;
}

/** The credit line along the poster's foot. A poster outlives the page it came
    from, so provenance travels with the pixels — and on the climatology that
    provenance is the whole point: these are NOAA normals run through NAP-190's
    method, not FSA determinations. */
function exportCredit(sel) {
  if (isClimatology(sel)) {
    return 'NOAA nClimGrid normals · NAP-190 method · Montana Climate Office '
      + '· sustainable-fsa.com/lfp-explorer';
  }
  return 'Sustainable FSA · USDA FSA data via FOIA · DOI 10.5281/zenodo.15252842 '
    + '· Montana Climate Office · sustainable-fsa.com/lfp-explorer';
}

/* ── Pending state ───────────────────────────────────────────────────────── */

/**
 * Resolve a parked `?type=` slug against a dictionary that has only just
 * arrived. Anything unknown — a hand-edited URL, a type retired from the
 * payload, a stale stored value, or a slug from the OTHER dataset's dictionary
 * — falls back to this dataset's default rather than blanking the map.
 *
 * @param {object} data the arrived decoder instance
 * @param {string|{typeSlug?: string, type?: string}|null} pending the parked
 *        slug, bare or in the app's pending bag (which will grow a key per
 *        dictionary-dependent param as the other interfaces land)
 * @returns {string|null} a type name from `data.types()`
 */
function applyPending(data, pending) {
  if (!data) return null;
  const slug = typeof pending === 'string'
    ? pending
    : (pending && (pending.typeSlug || pending.type)) || null;

  const ds = DATASETS.find((d) => d.keySpace === data.keySpace
    && !!d.nominalYears === !!data.nominalYears) || DATASETS[0];
  const have = data.types();
  const fallback = have.includes(ds.defaultType) ? ds.defaultType : (have[0] || null);

  if (!slug) return fallback;
  const hit = data.typeFromSlug(slug);
  if (hit) return hit;
  console.warn('[ngp/iface] unknown pasture type ' + JSON.stringify(slug)
    + ' — falling back to ' + JSON.stringify(fallback) + '.');
  return fallback;
}

/* ── The descriptor ──────────────────────────────────────────────────────── */

/**
 * Interface 1. Frozen, like every descriptor: the app reads it on every
 * repaint and a mutated leaf would mean the legend and the paint disagreed.
 */
export const NGP = Object.freeze({
  id: 'ngp',
  label: 'Grazing periods',
  order: 1,
  datasets: DATASETS,
  variables: VARIABLES,
  reduceFips,
  colorsFor,
  legend: Object.freeze({
    kind: legendKind,
    key: legendKey,
    noDataLabel: legendNoDataLabel,
  }),
  tooltip,
  cardRows,
  liveSentence,
  table: Object.freeze({ caption: tableCaption }),
  export: Object.freeze({
    filenamePart: exportFilenamePart,
    subtitle: exportSubtitle,
    credit: exportCredit,
  }),
  applyPending,
});
