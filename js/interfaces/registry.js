/* ============================================================================
   LFP Explorer · js/interfaces/registry.js
   The list of interfaces the app can show, in the order the switcher shows
   them, plus the two lookups every consumer of that list needs.

   ES module, no build step. No kit imports at all: this file is the manifest,
   plus the two small readings of the app context that every consumer of a
   descriptor needs (interfaceOf, viewSelection).

   ── What an "interface" is ─────────────────────────────────────────────────
   One data family from the chain used to administer the Livestock Forage
   Disaster Program, with its own datasets, its own controls, its own prose.
   The switcher at the top of the controls drawer picks one; everything shared
   (the selected county, the camera, the year, the theme, the drawer) survives
   the switch, so two readings of the same county can be compared in two
   clicks.

   The registry is the ONLY place that knows how many there are. `?view=` is
   validated against it, the switcher is authored against it, and the audit
   harness's probe table mirrors it — so adding an interface is a descriptor
   plus one line here, never a search for hardcoded slugs.

   Three are shipped: grazing periods, then the drought monitor, then LFP
   eligibility — the order the Livestock Forage Program is administered in
   (when may livestock graze here · how dry was it · what did that qualify the
   county for), which is also the order the story reads in. The rest (disaster
   designations) land as their own descriptors, in `order`, and the switcher
   grows by itself. Nothing here is a placeholder: an unshipped interface has no
   entry and therefore no disabled teaser button.
   ========================================================================== */

import { NGP } from './ngp.js';
import { USDM } from './usdm.js';
import { ELIGIBILITY } from './eligibility.js';

/**
 * Every shipped interface, in switcher order. Frozen: the app reads this list
 * at boot to build the switcher and to whitelist `?view=`, and a mutated
 * registry would mean a URL that validates differently than the buttons.
 *
 * @type {ReadonlyArray<object>}
 */
export const INTERFACES = Object.freeze([NGP, USDM, ELIGIBILITY]);

/** The interface a session with no `?view=` and no stored preference lands on.
    Its slug is NEVER emitted into the URL (clean-URL discipline, HOUSE-STYLE
    §4), so this value is also the one `pushState()` elides. */
export const DEFAULT_VIEW = INTERFACES[0].id;

/**
 * Slug → descriptor. The registry IS the whitelist: a `?view=` that does not
 * resolve here is ignored exactly like any other bad param, and a stored
 * `sfsa-ngp-view` written by a future version of this app that shipped an
 * interface this one does not have falls back to the default rather than
 * blanking the map.
 *
 * @param {string} slug
 * @returns {object|null}
 */
export function viewFromSlug(slug) {
  if (slug == null) return null;
  const want = String(slug).toLowerCase();
  for (const iface of INTERFACES) if (iface.id === want) return iface;
  return null;
}

/* ── Reading the app context ──────────────────────────────────────────────── */

/**
 * The active descriptor, from the app context — or the default, for a context
 * that predates the switcher (or a harness that builds one by hand).
 *
 * @param {object} ctx app.js's ngpContext()
 * @returns {object} an interface descriptor
 */
export function interfaceOf(ctx) {
  return (ctx && ctx.getInterface && ctx.getInterface()) || INTERFACES[0];
}

/**
 * Read the app context into the `sel` object every descriptor leaf takes:
 * {year, type, variable, dataset, vintage, week}. One implementation, because
 * the poster, the data table and the map must describe the SAME selection, and
 * three modules each assembling it from getState() is three chances to forget
 * the dataset — or, once a family had weeks, the week.
 *
 * The app's OWN selection() is the answer whenever the context offers it
 * (`getSelection`), and that is the normal case: it is the very object the
 * descriptor's other leaves are called with, so a poster and the map it was
 * captured from cannot describe two different states. The assembly below is the
 * fallback for a context that predates that accessor — or a harness that builds
 * one by hand — and it cannot know anything app.js derives, so a family whose
 * paint depends on such a field (the drought monitor's absolute week) will
 * render as nothing rather than as something wrong.
 *
 * `getViewState()` is read defensively: it may hand back the whole
 * per-interface map or just the active interface's slice, and a context without
 * it at all means the interface has only ever had one dataset.
 *
 * @param {object} ctx app.js's ngpContext()
 * @returns {{year: number, type: string, variable: string, dataset: string,
 *            vintage: string|null, week?: number|null}}
 */
export function viewSelection(ctx) {
  if (ctx && typeof ctx.getSelection === 'function') return ctx.getSelection();
  const state = ctx.getState();
  const iface = interfaceOf(ctx);
  const vs = (ctx.getViewState && ctx.getViewState()) || null;
  const slice = (vs && vs[iface.id]) || vs || null;
  return {
    year: state.year,
    type: state.type,
    variable: state.variable,
    dataset: (slice && slice.dataset) || iface.datasets[0].id,
    vintage: (ctx.getVintage && ctx.getVintage()) || null,
  };
}

/**
 * Types that mean the same thing in two different dictionaries.
 *
 * FSA names sixteen pasture types; the nClimGrid climatology names three
 * seasons, computed by NAP-190's method for the three forage regimes FSA's
 * types fall into. When the reader switches datasets, the app tries to keep
 * the selection they are looking at rather than snapping back to a default —
 * so `Native Pasture` becomes `Full Season` and back, and the two improved
 * pastures map onto their seasons.
 *
 * Pairs, not a Map, because the lookup runs in BOTH directions and a pair list
 * is the honest shape of a bidirectional correspondence (see aliasType()).
 *
 * Deliberately narrow: the other thirteen FSA types have no season
 * counterpart, and inventing one would be a claim about forage the data does
 * not make. Those selections fall through to the dataset's own default.
 *
 * @type {ReadonlyArray<readonly [string, string]>}
 */
export const TYPE_ALIASES = Object.freeze([
  Object.freeze(['Native Pasture', 'Full Season']),
  Object.freeze(['Warm Season Improved Pasture', 'Warm Season']),
  Object.freeze(['Cool Season Improved Pasture', 'Cool Season']),
]);

/**
 * The counterpart of a type name in the other dictionary, or null when it has
 * none. Bidirectional: either half of a pair finds the other.
 *
 * @param {string} type
 * @param {string[]} [candidates] when given, an alias is only returned if it
 *        is actually in that dictionary — the caller usually has the arriving
 *        dataset's `types()` in hand and a name that is not in it is no use.
 * @returns {string|null}
 */
export function aliasType(type, candidates) {
  if (type == null) return null;
  const want = String(type);
  const ok = candidates ? new Set(candidates) : null;
  for (const [a, b] of TYPE_ALIASES) {
    const other = want === a ? b : (want === b ? a : null);
    if (other && (!ok || ok.has(other))) return other;
  }
  return null;
}
