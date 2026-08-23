/* ============================================================================
   LFP Explorer · js/export.js
   The branded PNG export, and the `?export=` convention that makes it
   headless-scriptable.

   ES module, no build step. The heavy lifting is the kit's ui/export.js — an
   off-screen MapLibre map captured at poster resolution, then the house chrome
   composed around it on a canvas. What lives here is the app's half: which
   colors to paint, what the poster says, and how to draw this app's three
   legend bodies with canvas primitives.

   ── The legend is drawn TWICE, on purpose ──────────────────────────────────
   Once in the DOM (js/legend-wheel.js, the kit's colorbar and swatches) and
   once here in canvas calls. Rasterising the live SVG would be shorter and is a
   trap: a foreignObject/SVG round trip taints the canvas in Safari and silently
   drops web fonts everywhere else, and `toBlob()` on a tainted canvas throws
   SecurityError — at which point the export fails for exactly the users who
   cannot be asked to screenshot instead. The wheel's ANGLE MATH is imported
   from js/legend-wheel.js rather than re-derived, and the swatch chips' colors
   and labels are the same descriptor leaf the DOM legend reads, so the two
   pictures cannot drift apart; only the drawing calls differ.

   ── Which painter runs is the descriptor's call ─────────────────────────────
   `iface.legend.kind(sel)` decides — wheel, bar or swatches — exactly as it
   does for the drawer. What each painter needs beyond that (the ramps, the
   chip labels, a required attribution) comes from the descriptor too, so a new
   data family adds a legend by declaring one, not by editing this file's
   branches.

   ── `?export=light` / `?export=high-contrast` ──────────────────────────────
   A URL param that forces a theme, waits for the fonts, runs the export, and
   stamps `documentElement.dataset.ngpExported = '1'` when the download has
   been triggered. A screenshot job can therefore load one URL, wait for that
   attribute, and collect the file — no browser automation of the button, no
   sleep-and-hope (HOUSE-STYLE §4). The forced theme is NOT persisted: an
   export job must not rewrite the visitor's own preference.
   ========================================================================== */

import { getTheme, setTheme, urlParams } from 'https://sustainable-fsa.com/style/v0.3.1/core/core.js';
import { captureCompositeMap, composeBranded } from 'https://sustainable-fsa.com/style/v0.3.1/ui/export.js';
import { addCountyLayers } from 'https://sustainable-fsa.com/style/v0.3.1/county/county.js';
import { resolveToken } from 'https://sustainable-fsa.com/style/v0.3.1/map/map.js';

import { activeNgpDataset, typeSlug } from './data.js';
import { NO_DATA, VARIABLES, ramps } from './color.js';
import { interfaceOf, viewSelection } from './interfaces/registry.js';
import {
  MONTH_LABELS, MONTH_STARTS, WHEEL_DAYS, monthMidAngle, wheelAngle, wheelPoint,
} from './legend-wheel.js';

/* ── Constants ───────────────────────────────────────────────────────────── */

/** The themes `?export=` will accept. Same whitelist as the kit's THEMES; a
    typo must fall through to "do nothing", never to a default export. */
const EXPORT_THEMES = Object.freeze(['light', 'high-contrast']);

/** The poster's headline, for a context whose descriptor does not name one.
    Every shipped interface does. */
const TITLE = 'FSA Normal Grazing Periods';

/* Fonts the legend painters use. The kit preloads exactly 900 34px / 500 22px
   / 400 16px Roboto before its own first fillText; a size it does not name is
   the same face and the same file, but the contract says load what you draw
   with, so these are loaded before composeBranded is called.

   FONT_FINE is the floor of the attribution's fit-shrink (see
   drawSwatchLegend): every size between it and FONT_BODY resolves to the same
   resident face, and loading both endpoints is what makes that true. */
const FONT_BODY = '400 16px Roboto';
const FONT_WHEEL = '400 11px Roboto';
const FONT_FINE = '400 12px Roboto';

/* Legend band geometry, in composeBranded's logical units. The band handed to
   drawLegend is 1504 × 96 at the default capture size. */
const WHEEL_R_OUTER = 29;
const WHEEL_R_INNER = 17;
const WHEEL_R_LABEL = 41;
const CHIP = 22;                 // the "no data" swatch, square

const BAR_W = 420;
const BAR_H = 22;

/* Swatch legend geometry. The chips run in one row across the top of the band;
   a required attribution takes the two lines under them, right-aligned. */
const SWATCH = 20;               // a class chip, square
const SWATCH_GAP = 26;           // between one chip's label and the next chip
const SWATCH_LABEL_PAD = 9;      // chip to its own label
const ATTR_MIN_PX = 12;          // the fit-shrink floor (FONT_FINE)

/** The app context, captured at init — features never import app.js back. */
let appCtx = null;

/* ── What is being exported ──────────────────────────────────────────────────
   Everything that varies between interfaces and datasets — the filename stem,
   the subtitle, the credit, the legend's no-data label, and which counties get
   which color — is read off the INTERFACE DESCRIPTOR at click time, never
   captured at init. A reader who toggles datasets and then exports gets the
   dataset they are looking at.

   Both accessors (js/interfaces/registry.js) fall back: an older context — or a
   harness that builds one by hand — yields the default descriptor, its default
   dataset and the facade's active instance, which is exactly today's behaviour.
   The official poster's bytes do not move. */

/* ── Filename ────────────────────────────────────────────────────────────── */

/**
 * The download name for one selection: the descriptor's, in full.
 *
 * A poster's name is a fact about its family's controls — grazing periods are
 * told apart by pasture type and color-by variable, a drought map by its week —
 * so `iface.export.filename(sel)` owns the whole string. The two-argument form
 * below is the fallback for a descriptor that only names its stem, which is the
 * shape PR 1 shipped: `<stem>_<type-slug>_<variable>.png`, byte for byte the
 * scheme posters already in circulation are named by.
 *
 * @param {object} iface the interface descriptor
 * @param {object} sel the selection
 * @returns {string}
 */
export function exportFilename(iface, sel) {
  const ex = iface.export || {};
  if (typeof ex.filename === 'function') return ex.filename(sel);
  const part = typeof ex.filenamePart === 'function' ? ex.filenamePart(sel) : 'export';
  return part + '_' + typeSlug(sel.type) + '_' + sel.variable + '.png';
}

/* ── Legend painters ─────────────────────────────────────────────────────── */

function tokens() {
  return {
    text: resolveToken('--text-primary', '#1f2937'),
    muted: resolveToken('--text-muted', '#4b5563'),
    border: resolveToken('--ctrl-border', '#6b7280'),
  };
}

/** The "no data" chip, drawn wherever it is asked for. Outlined, because a
    light gray square on a white poster is otherwise not a square at all, and
    always labelled — color is never the only channel (HOUSE-STYLE §6). The
    label is the descriptor's, because what "no data" MEANS is dataset-specific:
    FSA reported no period, or the method yields no season here. */
function drawNoDataChip(ctx2d, x, midY, c, label) {
  ctx2d.fillStyle = NO_DATA();
  ctx2d.fillRect(x, midY - CHIP / 2, CHIP, CHIP);
  ctx2d.strokeStyle = c.border;
  ctx2d.lineWidth = 1;
  ctx2d.strokeRect(x + 0.5, midY - CHIP / 2 + 0.5, CHIP - 1, CHIP - 1);
  ctx2d.font = FONT_BODY;
  ctx2d.textBaseline = 'middle';
  ctx2d.fillStyle = c.text;
  ctx2d.fillText(label, x + CHIP + 12, midY);
}

/** Duration: the same 53 stops the map is painted from, as a bar. */
function drawDurationLegend(ctx2d, rect, noDataLabel) {
  const c = tokens();
  const ramp = ramps().duration;
  const barX = rect.x;
  const barY = rect.y + 14;
  const cell = BAR_W / ramp.length;

  for (let i = 0; i < ramp.length; i++) {
    ctx2d.fillStyle = ramp[i];
    // +0.6 so neighbouring cells overlap rather than leaving a seam of surface
    // between them after rounding.
    ctx2d.fillRect(barX + i * cell, barY, cell + 0.6, BAR_H);
  }
  ctx2d.strokeStyle = c.border;
  ctx2d.lineWidth = 1;
  ctx2d.strokeRect(barX + 0.5, barY + 0.5, BAR_W - 1, BAR_H - 1);

  ctx2d.font = FONT_BODY;
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'top';
  ctx2d.fillStyle = c.muted;
  for (const week of [0, 10, 20, 30, 40, 50]) {
    const x = barX + (week + 0.5) * cell;
    ctx2d.fillStyle = c.border;
    ctx2d.fillRect(x - 0.5, barY + BAR_H, 1, 5);
    ctx2d.fillStyle = c.muted;
    ctx2d.fillText(week + ' wk', x, barY + BAR_H + 9);
  }
  ctx2d.textAlign = 'left';

  drawNoDataChip(ctx2d, barX + BAR_W + 64, barY + BAR_H / 2, c, noDataLabel);
}

/**
 * A cyclic scale: the month wheel, in canvas arcs, from the same angle math the
 * DOM wheel uses.
 *
 * The two lines of prose beside it are the descriptor's when it has an opinion
 * (`iface.export.legendLines`), because the WHEEL is shared and the sentence is
 * not: the same ring reads a grazing period's start date on one family and the
 * day a drought tier was satisfied on another. Without an opinion it falls back
 * to the grazing periods' own wording, which is what shipped and what posters
 * already in circulation say.
 */
function drawWheelLegend(ctx2d, rect, variable, noDataLabel, ownLines) {
  const c = tokens();
  const ramp = ramps().cyclic;
  const cx = rect.x + WHEEL_R_LABEL + 8;
  const cy = rect.y + rect.height / 2;
  // A whisker of overlap on each wedge; without it the anti-aliased edges leave
  // 366 hairlines of background showing through the ring.
  const overlap = (Math.PI * 2 / WHEEL_DAYS) * 0.12;

  for (let i = 0; i < ramp.length; i++) {
    const a0 = wheelAngle(i);
    const a1 = wheelAngle(i + 1) + overlap;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, WHEEL_R_OUTER, a0, a1);
    ctx2d.arc(cx, cy, WHEEL_R_INNER, a1, a0, true);
    ctx2d.closePath();
    ctx2d.fillStyle = ramp[i];
    ctx2d.fill();
  }

  // Month separators, in the poster's own ground color so they read as gaps.
  ctx2d.strokeStyle = resolveToken('--bg-surface', '#ffffff');
  ctx2d.lineWidth = 1;
  for (const start of MONTH_STARTS) {
    const a = wheelAngle(start);
    const p0 = wheelPoint(cx, cy, WHEEL_R_INNER, a);
    const p1 = wheelPoint(cx, cy, WHEEL_R_OUTER, a);
    ctx2d.beginPath();
    ctx2d.moveTo(p0.x, p0.y);
    ctx2d.lineTo(p1.x, p1.y);
    ctx2d.stroke();
  }

  ctx2d.font = FONT_WHEEL;
  ctx2d.fillStyle = c.muted;
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'middle';
  for (let m = 0; m < 12; m++) {
    const p = wheelPoint(cx, cy, WHEEL_R_LABEL, monthMidAngle(m));
    ctx2d.fillText(MONTH_LABELS[m], p.x, p.y);
  }
  ctx2d.textAlign = 'left';

  const which = variable === 'start' ? 'begins' : 'ends';
  const lines = (Array.isArray(ownLines) && ownLines.length === 2) ? ownLines : [
    'Color is the point in the calendar where the grazing period ' + which
      + ', read against the months around the wheel.',
    'The scale wraps, so late December and early January are neighboring colors.',
  ];
  const textX = cx + WHEEL_R_LABEL + 28;
  ctx2d.font = FONT_BODY;
  ctx2d.fillStyle = c.text;
  ctx2d.textBaseline = 'middle';
  ctx2d.fillText(lines[0], textX, cy - 12);
  ctx2d.fillStyle = c.muted;
  ctx2d.fillText(lines[1], textX, cy + 12);

  const widest = Math.max(...lines.map((s) => ctx2d.measureText(s).width));
  drawNoDataChip(ctx2d, textX + widest + 48, cy, c, noDataLabel);
}

/**
 * A categorical scale: one labelled chip per class, then the no-data chip, then
 * — for a dataset whose licence or its producer requires one — the attribution,
 * right-aligned on the two lines under the chips.
 *
 * The labels are drawn, always. A hue-only categorical scheme has nothing left
 * in grayscale, so the words ARE the legend (HOUSE-STYLE §6); a poster is the
 * one place the reader cannot hover to find out.
 */
function drawSwatchLegend(ctx2d, rect, items, noDataLabel, attribution) {
  const c = tokens();
  const rowY = rect.y + SWATCH / 2 + 2;

  ctx2d.font = FONT_BODY;
  ctx2d.textBaseline = 'middle';
  ctx2d.textAlign = 'left';

  let x = rect.x;
  for (const item of items) {
    ctx2d.fillStyle = item.color;
    ctx2d.fillRect(x, rowY - SWATCH / 2, SWATCH, SWATCH);
    // EVERY chip is outlined, not just the no-data one: the palest class of a
    // categorical scheme is nearly the poster's own ground (a drought-free
    // county is deliberately a warm off-white), and an unoutlined pale square is
    // not a square at all. Outlining only that one would make it read as the
    // "absent" chip, which is precisely the confusion the palette avoids.
    ctx2d.strokeStyle = c.border;
    ctx2d.lineWidth = 1;
    ctx2d.strokeRect(x + 0.5, rowY - SWATCH / 2 + 0.5, SWATCH - 1, SWATCH - 1);
    ctx2d.fillStyle = c.text;
    ctx2d.fillText(item.label, x + SWATCH + SWATCH_LABEL_PAD, rowY);
    x += SWATCH + SWATCH_LABEL_PAD + ctx2d.measureText(item.label).width + SWATCH_GAP;
  }
  drawNoDataChip(ctx2d, x, rowY, c, noDataLabel);

  if (!attribution || !attribution.length) return;
  ctx2d.textAlign = 'right';
  const right = rect.x + rect.width;
  attribution.forEach((line, i) => {
    // Fit-shrink: the required NDMC sentence is longer than the band at 16px,
    // and it is quoted VERBATIM — so the TYPE gives way, never the words. Every
    // size between the floor and 16px is the same resident face (see FONT_FINE),
    // so no further font load is needed here.
    ctx2d.font = FONT_BODY;
    const width = ctx2d.measureText(line).width;
    if (width > rect.width) {
      const size = Math.max(ATTR_MIN_PX, Math.floor(16 * (rect.width / width)));
      ctx2d.font = '400 ' + size + 'px Roboto';
    }
    ctx2d.fillStyle = i === 0 ? c.text : c.muted;
    ctx2d.fillText(line, right, rect.y + 44 + i * 21);
  });
  ctx2d.textAlign = 'left';
}

/**
 * The drawLegend callback for the active selection. Which body to draw is the
 * descriptor's call (`legend.kind`), so the poster and the drawer can never
 * disagree about whether this variable is cyclic — or categorical.
 *
 * @param {object} iface the interface descriptor
 * @param {object} sel the selection from selectionOf()
 * @returns {(ctx2d: CanvasRenderingContext2D, rect: object) => void}
 */
function legendPainter(iface, sel) {
  const legend = iface.legend || {};
  const kind = legend.kind
    ? legend.kind(sel)
    : ((VARIABLES[sel.variable] && VARIABLES[sel.variable].cyclic) ? 'wheel' : 'bar');
  const noDataLabel = legend.noDataLabel
    ? legend.noDataLabel(sel)
    : 'No reported grazing period';
  const items = (kind === 'swatches' && typeof legend.items === 'function')
    ? legend.items(sel) : null;
  const attribution = (iface.export && typeof iface.export.attribution === 'function')
    ? iface.export.attribution(sel) : null;
  const lines = (iface.export && typeof iface.export.legendLines === 'function')
    ? iface.export.legendLines(sel) : null;

  return (ctx2d, rect) => {
    if (kind === 'swatches' && items && items.length) {
      drawSwatchLegend(ctx2d, rect, items, noDataLabel, attribution);
    } else if (kind === 'wheel') {
      drawWheelLegend(ctx2d, rect, sel.variable, noDataLabel, lines);
    } else {
      drawDurationLegend(ctx2d, rect, noDataLabel);
    }
  };
}

/* ── The export ──────────────────────────────────────────────────────────── */

/** The same Map<fsaId, color> app.js paints the live map with, rebuilt here so
    the off-screen map is colored from the data rather than from the GL state of
    a map that is about to be thrown away. Through the descriptor, so a
    FIPS-keyed dataset reaches the poster over the same crosswalk join the
    screen used — a poster painted with unjoined keys would be a map of the
    counties whose two codes happen to match. */
function colorsFor(ctx, iface, sel) {
  const data = (ctx.getData && ctx.getData()) || activeNgpDataset();
  const xw = (ctx.getCrosswalk && ctx.getCrosswalk()) || null;
  return iface.colorsFor(data, xw, sel).colors;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Late enough that the browser has certainly started reading the blob, and
  // early enough that a poster-sized PNG is not held for the session.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Capture, compose, and download the current view as a branded PNG.
 *
 * @param {object} [ctx] app.js's ngpContext(); defaults to the one initExport
 *        was given.
 * @returns {Promise<string>} the filename written
 */
export async function runExport(ctx = appCtx) {
  if (!ctx) throw new Error('[ngp/export] runExport() before initExport().');

  const counties = ctx.getCounties();
  if (!counties) throw new Error('[ngp/export] the county boundaries are not loaded.');

  const iface = interfaceOf(ctx);
  const sel = viewSelection(ctx);
  const colors = colorsFor(ctx, iface, sel);
  const filename = exportFilename(iface, sel);

  // Load every face the legend painters draw with BEFORE composeBranded: a
  // canvas does not wait for a font the way the DOM does, and a missed load is
  // silent — the glyphs are simply the system sans, forever.
  if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
    await Promise.all([FONT_BODY, FONT_WHEEL, FONT_FINE]
      .map((f) => document.fonts.load(f).catch(() => {})));
  }

  const { canvas, dispose, timedOut } = await captureCompositeMap({
    bounds: ctx.getBounds(),
    /* The kit's 20 s default was sized for a GeoJSON composite that settles in
       under a second. This one draws from VECTOR TILES, so "idle" is waiting on
       range requests — cached from the live map in the common case, but the
       protocol still re-parses every tile for a fresh map, and a cold cache on a
       slow connection is a real 20 s. A poster that shipped half-drawn would
       look like a poster. */
    idleTimeoutMs: 30000,
    build: async (offscreen) => {
      /* LISTEN TO THE THROWAWAY MAP. MapLibre's Evented.fire falls back to
         console.error only when NOTHING is listening, so a map nobody listens to
         reports its problems to the console and to nobody who can act on them.
         This app creates this map; owning its errors is part of that.

         What actually arrives here is a cancelled request. The composite is
         captured and then the map is removed, and a range request still in
         flight at that moment rejects — sometimes as `TypeError: Failed to
         fetch` rather than an AbortError, which is the shape MapLibre cannot
         recognise as a cancellation (kit v0.3.1 normalises the cases where the
         abort controller is the cause; this is not one of them).

         A WARN, not silence, and deliberately not an error: the poster's own
         validity is asserted separately — tools/verify.mjs checks the PNG magic
         bytes and that it is over 100 KB — so a tile failure that actually
         mattered would show up as a blank or truncated poster and fail THAT,
         which is the assertion with teeth. Swallowing this without saying so
         would be the wrong trade; failing a console-clean gate on a request
         nobody wanted any more is the other wrong trade. */
      offscreen.on('error', (e) => {
        const err = e && e.error;
        console.warn('[ngp/export] the offscreen map reported an error, which is '
          + 'usually a range request cancelled as the map was torn down: '
          + ((err && (err.message || err.name)) || String(e)));
      });

      // The off-screen map is a throwaway with its own sources and layers:
      // rebuild the composite on it, then let the rAF-coalesced recolor land
      // before the capture waits for idle.
      const offHandle = addCountyLayers(offscreen, counties);
      offHandle.recolor(colors);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
  });

  /* A timeout is not an error — the canvas is real and the poster is a picture
     of what had drawn. But an incomplete map with a confident title is worse
     than a slow download, and the kit reports this rather than throwing
     precisely because only the caller knows which. Here it is a hard stop: the
     poster is a citable artifact that outlives the tab, and half a choropleth
     over a full legend is a claim about the country that is simply false. */
  if (timedOut) {
    dispose();
    throw new Error('[ngp/export] the offscreen map never finished drawing, so '
      + 'the poster would show a partial composite. Try again — the county tiles '
      + 'are cached after the first attempt.');
  }

  try {
    const blob = await composeBranded(canvas, {
      // The title is the FAMILY's, not the app's: one page shows several, and a
      // drought map headed "FSA Normal Grazing Periods" would be a lie that
      // outlives the tab it came from.
      title: (iface.export && typeof iface.export.title === 'function')
        ? iface.export.title(sel) : TITLE,
      subtitle: iface.export.subtitle(sel),
      credit: iface.export.credit(sel),
      drawLegend: legendPainter(iface, sel),
      theme: getTheme(),
    });
    download(blob, filename);
  } finally {
    dispose();
  }

  return filename;
}

/* ── Wiring ──────────────────────────────────────────────────────────────── */

/**
 * Wire the Export button, and honour `?export=` if it is present.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.button #btn-export
 * @param {object} opts.ctx         app.js's ngpContext()
 * @param {URLSearchParams} [opts.params] defaults to the live query string
 * @returns {{run: () => Promise<string>}}
 */
export function initExport({ button, ctx, params = urlParams() } = {}) {
  if (!ctx) {
    console.warn('[ngp/export] no context — PNG export is off.');
    return { run: () => Promise.reject(new Error('no context')) };
  }
  appCtx = ctx;

  async function run() {
    if (button) button.disabled = true;
    ctx.note('Building the PNG export…');
    try {
      const filename = await runExport(ctx);
      ctx.clearNote();
      ctx.toast('Export written: ' + filename);
      ctx.announce('Branded PNG export downloaded.');
      return filename;
    } catch (err) {
      console.error('[ngp/export] export failed', err);
      ctx.clearNote();
      ctx.toast('The PNG export failed. ' + (err && err.message ? err.message : ''), 5000);
      throw err;
    } finally {
      if (button) button.disabled = false;
    }
  }

  if (button) button.addEventListener('click', () => { run().catch(() => {}); });

  const mode = params.get('export');
  if (mode == null) return { run };

  if (!EXPORT_THEMES.includes(mode)) {
    console.warn('[ngp] ignoring ?export=' + JSON.stringify(mode)
      + ' — expected one of ' + EXPORT_THEMES.join(', ') + '.');
    return { run };
  }

  // The headless path. initExport() is called from the seam at the END of the
  // boot sequence, after documentElement.dataset.ngpReady is stamped, so the
  // map is drawn and the data is joined by the time this runs.
  (async () => {
    // persist:false — a screenshot job must not rewrite the visitor's theme.
    setTheme(mode, { persist: false });
    // GL paints do not follow a data-theme swap; the on-screen map has to be
    // repainted too, or a job that ALSO screenshots the page gets a
    // high-contrast poster over a light-theme map.
    const handle = ctx.getHandle();
    if (handle) handle.applyThemePaints();

    try {
      if (typeof document !== 'undefined' && document.fonts) await document.fonts.ready;
      await run();
      // The completion signal the screenshot job waits on.
      document.documentElement.dataset.ngpExported = '1';
    } catch {
      // Stamp the failure too — run() has already logged and toasted it. A job
      // that only ever waits for success hangs until its own timeout on a
      // broken build, which reads as "slow" when it means "broken".
      document.documentElement.dataset.ngpExportError = '1';
    }
  })();

  return { run };
}
