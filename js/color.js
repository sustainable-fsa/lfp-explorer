/* ============================================================================
   LFP Explorer · js/color.js
   The data palettes: one cyclic ramp for dates, one sequential ramp for
   duration, and the "no data" fill.

   ES module, no build step. Imports the kit's token resolver only.

   ── Why two ramps ──────────────────────────────────────────────────────────
   Season START and season END are days of the year — a genuinely CYCLIC
   quantity. A season beginning December 28 is three days from one beginning
   January 3, and a linear ramp would paint them at opposite ends of the scale.
   `assets/colors.json` is Crameri **romaO** sampled at 366 stops (HOUSE-STYLE
   §6 approves romaO for day-of-year), and it is rendered as a MONTH WHEEL, not
   a bar: the wheel is what tells the reader the ends meet.

   DURATION is not cyclic, so it gets a lightness-monotonic sequential ramp —
   Crameri **batlow** at 53 stops, one per whole week from 0 to 52. It survives
   grayscale and every CVD type, which a hue-only ramp does not.

   PAYMENT MONTHS are a third quantity, and a discrete one: one to five whole
   months, plus a sixth category for an event that qualified a county without a
   stated month count. `assets/colors-df.json` is that six-entry ramp — see
   loadDfRamp() for its derivation and every measured distance behind it. It is
   fetched LAZILY, with the interface that paints it, so the boot path stays two
   ramps wide.

   ── Two things that are deliberately NOT done here ─────────────────────────
   1. THE CYCLIC RAMP IS NOT ROTATED. `assets/colors.json` ships with its seam
      already placed at July 1 — index 0 is January 1, index 181 is July 1, and
      the discontinuity sits mid-summer where almost no grazing period begins
      or ends. Rotating it here (a "fix" that looks obvious from the array
      alone) would move the seam onto the busiest part of the calendar and
      break every legend that reads the same file. Index = yday − 1. Full stop.
   2. RAMPS ARE NOT THEMED. These are data colors, not chrome: they are the
      same in the light and high-contrast themes, exactly as shipped. The one
      color here that IS a token is the no-data fill — see NO_DATA().
   ========================================================================== */

import { fetchJSON, promiseCache } from 'https://sustainable-fsa.com/style/v0.2.0/core/core.js';
import { resolveToken } from 'https://sustainable-fsa.com/style/v0.2.0/map/map.js';

/* ── Constants ───────────────────────────────────────────────────────────── */

export const CYCLIC_URL = 'assets/colors.json';
export const DURATION_URL = 'assets/colors-duration.json';
export const DF_URL = 'assets/colors-df.json';

/** Day-of-year domain. 366 so a leap-year December 31 has its own stop. */
const YDAY_MIN = 1;
const YDAY_MAX = 366;

/** Duration domain, in whole weeks. 52 weeks ≈ a year of grazing. */
const WEEK_MIN = 0;
const WEEK_MAX = 52;

/** The payment-months ramp's shape: index 0 is the qualified-but-unstated
    category and 1–5 are the months themselves. Six entries, asserted on load —
    a five-entry file would silently paint every five-month county the same as a
    four-month one. */
const DF_MIN = 1;
const DF_MAX = 5;
const DF_STOPS = DF_MAX + 1;

/** Last-resort fill for a call made before loadRamps() resolves. Same value as
    the kit's --no-data light-theme token; not a second source of truth. */
const NO_DATA_FALLBACK = '#cccccc';

let cyclicRamp = null;    // 366 hex strings, index = yday − 1
let durationRamp = null;  // 53 hex strings, index = whole weeks
let dfRamp = null;        // 6 hex strings, index 0 = "months not stated", 1–5 months

/* ── Boot ────────────────────────────────────────────────────────────────── */

/**
 * Fetch both ramps. Idempotent.
 * @param {{cyclicUrl?: string, durationUrl?: string}} [opts]
 * @returns {Promise<{cyclic: string[], duration: string[]}>}
 */
export async function loadRamps({ cyclicUrl = CYCLIC_URL, durationUrl = DURATION_URL } = {}) {
  if (cyclicRamp && durationRamp) return ramps();

  const [cyclic, duration] = await Promise.all([
    fetchJSON(cyclicUrl),
    fetchJSON(durationUrl),
  ]);

  if (!Array.isArray(cyclic) || cyclic.length !== YDAY_MAX) {
    throw new Error('[ngp/color] ' + cyclicUrl + ': expected ' + YDAY_MAX
      + ' colors, got ' + (Array.isArray(cyclic) ? cyclic.length : typeof cyclic));
  }
  if (!Array.isArray(duration) || duration.length !== WEEK_MAX + 1) {
    throw new Error('[ngp/color] ' + durationUrl + ': expected ' + (WEEK_MAX + 1)
      + ' colors, got ' + (Array.isArray(duration) ? duration.length : typeof duration));
  }

  cyclicRamp = cyclic;
  durationRamp = duration;
  return ramps();
}

/**
 * The loaded ramps, for a legend that has to draw every stop.
 * @returns {{cyclic: string[], duration: string[]}} copies — mutating the
 *          module's arrays would repaint the map from under the legend.
 */
export function ramps() {
  return {
    cyclic: cyclicRamp ? cyclicRamp.slice() : [],
    duration: durationRamp ? durationRamp.slice() : [],
  };
}

/* ── The payment-months ramp ─────────────────────────────────────────────────
   Fetched with the LFP eligibility interface rather than at boot: the boot path
   is one payload and two ramps wide, and tools/verify.mjs asserts it (§ lazy
   boot). promiseCache'd by URL, so two callers racing the first paint share one
   fetch and a failure evicts itself — the same contract js/decoders/common.js
   loads payloads under, and the reason the app's Retry button works.

   ── Where the six colors come from ─────────────────────────────────────────
   Anchored to the palette the derived-eligibility archive publishes its own
   maps with (#E0E436 → #DF9114 → #DD2313 → #850014 → #3B003C, itself an FSA map
   PDF's ladder), then RE-SPACED so the ordering survives being read: the
   anchors carry the right hues and nothing else — their lightness steps are
   uneven and their top two collapse into one color under deuteranopia.

   The five month steps hold their anchors' hues (only step 1 is rotated, +12°
   toward yellow-green) and take as much of the anchors' chroma as sRGB holds at
   the re-spaced lightness. Measured, in CIELAB / ΔE2000, with the CVD
   simulations at severity 1.0 (Machado, Oliveira & Fernandes 2009):

     idx  hex       L*     what it means
      0   #5F6C7D   45.1   eligible, months not stated (categorical, not ordinal)
      1   #BEEA44   87.1   1 month
      2   #E4951A   68.1   2 months
      3   #EB331E   52.0   3 months
      4   #880516   27.9   4 months
      5   #3B003C   11.0   5 months

     · L* falls monotonically 1→5; neighbour ΔL* = 19.0, 16.1, 24.1, 16.9
       (floor 12).
     · Order survives all three simulations and grayscale; neighbour ΔE00 ≥
       17.3 (protanopia), 11.2 (deuteranopia), 16.5 (tritanopia), and the
       relative luminances fall 0.702 > 0.381 > 0.201 > 0.054 > 0.013.
     · Step 1 vs the USDM's D0 yellow #ffff00 — the two appear in adjacent
       exports — ΔE00 12.1; vs the drought monitor's drought-free #f0ead8, 24.6.
     · Every step vs --no-data: ΔE00 ≥ 28.8 (light #cccccc) and ≥ 28.6
       (high-contrast #d9d9d9); vs the map grounds ≥ 28.2 (#faf7f2) and ≥ 29.7
       (#ffffff).
     · Every step vs the index-0 slate: ΔE00 ≥ 33.0, and the slate is 34.2 L*
       LIGHTER than step 5 — so it cannot read as a sixth month on the dark end
       of the ladder. Its chroma is 11.1 against 41–87 for the months, which is
       the second channel saying "this is a category, not a quantity".

   Built by build_df_ramp() in R/web-assets.R, which carries the same derivation
   and re-checks the lightness ladder before it writes. */
const _dfRamp = promiseCache();

/**
 * Fetch the payment-months ramp. Idempotent, and safe to call from several
 * places at once.
 *
 * @param {string} [url]
 * @returns {Promise<string[]>} the six stops
 */
export function loadDfRamp(url = DF_URL) {
  return _dfRamp.cached(url, async () => {
    const ramp = await fetchJSON(url);
    if (!Array.isArray(ramp) || ramp.length !== DF_STOPS) {
      throw new Error('[ngp/color] ' + url + ': expected ' + DF_STOPS
        + ' colors, got ' + (Array.isArray(ramp) ? ramp.length : typeof ramp));
    }
    dfRamp = ramp;
    return ramp.slice();
  });
}

/**
 * The loaded payment-months ramp, for a legend that draws every chip.
 * @returns {string[]} a copy — mutating the module's array would repaint the
 *          map from under the legend. Empty before loadDfRamp() resolves.
 */
export function dfRamps() {
  return dfRamp ? dfRamp.slice() : [];
}

/* ── Scales ──────────────────────────────────────────────────────────────── */

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

/**
 * Day of year → cyclic color.
 * @param {number} yday 1–366 (clamped; a non-finite value returns the no-data
 *        fill rather than a wrong-but-plausible color)
 * @returns {string} CSS color
 */
export function cyclicColor(yday) {
  if (!cyclicRamp || !Number.isFinite(yday)) return NO_DATA();
  // index = yday − 1. The seam is already where it belongs; do not rotate.
  return cyclicRamp[clamp(Math.round(yday), YDAY_MIN, YDAY_MAX) - 1];
}

/**
 * Whole weeks → sequential color. Dark is short, light is long.
 * @param {number} weeks 0–52 (rounded, then clamped)
 * @returns {string} CSS color
 */
export function durationColor(weeks) {
  if (!durationRamp || !Number.isFinite(weeks)) return NO_DATA();
  return durationRamp[clamp(Math.round(weeks), WEEK_MIN, WEEK_MAX)];
}

/**
 * Payment months → discrete color. Light is one month, dark is five.
 *
 * A NULL month count is not a missing value: the event qualified the county and
 * the record does not say for how many months (the 2008–2011 determinations).
 * It gets index 0 — the slate, which is deliberately off the ladder rather than
 * at either end of it. Only a call made before the ramp is loaded, or one made
 * about a county with no qualifying event at all, falls through to the no-data
 * fill.
 *
 * @param {number|null} months 1–5 (rounded, then clamped), or null for
 *        "qualified, months not stated"
 * @returns {string} CSS color
 */
export function dfColor(months) {
  if (!dfRamp) return NO_DATA();
  if (months == null) return dfRamp[0];
  if (!Number.isFinite(months)) return NO_DATA();
  return dfRamp[clamp(Math.round(months), DF_MIN, DF_MAX)];
}

/**
 * The "no data" fill, resolved from the kit's --no-data token AT CALL TIME.
 *
 * A function, not a constant, on purpose: the high-contrast theme lightens the
 * token, and a value captured at module load would leave every legend chip and
 * every export painted in the palette the page happened to boot with. Call it
 * where you need the color; never cache the result across a theme change.
 *
 * @returns {string} CSS color
 */
export function NO_DATA() {
  return resolveToken('--no-data', NO_DATA_FALLBACK);
}

/* ── The variables the map can paint ─────────────────────────────────────── */

/**
 * The three "color by" choices, keyed by the value that appears in `?variable=`
 * and on the segmented buttons' data-variable. `field` names the property to
 * read off a data.js Rec; `scale` turns that number into a color; `label` is
 * the human name used in the legend, the live region, and the export title.
 *
 * @type {Readonly<Record<string, {field: string, scale: (v: number) => string,
 *                                label: string, cyclic: boolean}>>}
 */
export const VARIABLES = Object.freeze({
  start: {
    field: 'start_yday',
    scale: cyclicColor,
    label: 'Season Start',
    cyclic: true,
  },
  end: {
    field: 'end_yday',
    scale: cyclicColor,
    label: 'Season End',
    cyclic: true,
  },
  duration: {
    field: 'duration_weeks',
    scale: durationColor,
    label: 'Grazing Period Duration',
    cyclic: false,
  },
});
