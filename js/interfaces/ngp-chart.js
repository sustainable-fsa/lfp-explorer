/* ============================================================================
   LFP Explorer · js/interfaces/ngp-chart.js
   The grazing-period card's picture: every year of one county's reported
   periods as a span chart, with the same numbers under it as a table.

   ES module, no build step, no imports at all — pure geometry plus DOM
   construction, which is what makes the four exported scale functions
   unit-testable head-on under node.

   This IS js/card-content.js's old body. What changed is ownership: the card's
   lifecycle (when to draw, what to skip, remembering that the reader opened the
   table) is generic and stayed in card-content.js; WHAT to draw is a fact about
   grazing periods and moved here, behind js/interfaces/ngp.js § cardBody. The
   drawing itself is unchanged — same viewBox, same class names, same
   `#card-table-details` id the app's CSS keys off.

   ── The twin ───────────────────────────────────────────────────────────────
   The chart is aria-hidden decoration inside a <figure> whose <figcaption>
   says what it shows; the <details> table under it is the same data, exactly,
   for anyone the picture does not serve — a screen reader, a printout, a
   reader who wants the date rather than the impression of the date
   (HOUSE-STYLE §5.2). Neither is a summary of the other.

   ── Program years cross calendar years ─────────────────────────────────────
   About a fifth of the records do. A winter forage type's PROGRAM year 2012
   period can start December 1, 2011 and end May 31, 2012, and a decoder Rec's
   `start_yday` is the day of year within the START's OWN calendar year — 335,
   which is meaningless as a position on a program-year axis. The chart's y
   axis is therefore the DAY OFFSET from the program year's own January 1
   (Jan 1 = 1), computed from the true UTC dates, and it goes negative for a
   period that began the year before. See programOffset().

   ── The climatology band ───────────────────────────────────────────────────
   When the nClimGrid climatology is already in hand, the same county's
   climatological season is drawn as one horizontal band BEHIND the bars: the
   reader can then see, in one picture, how FSA's determinations sit against
   what NAP-190's method yields from 1991–2020 normals. It is a reference, not
   a value — light fill, dashed outline, never on top of a bar — and it is
   included in the y domain so it cannot be clipped out of view.
   ========================================================================== */

/* ── Chart geometry ──────────────────────────────────────────────────────── */

const VB_W = 320;
const VB_H = 170;
const M = Object.freeze({ top: 8, right: 8, bottom: 22, left: 36 });

const PLOT_X = M.left;
const PLOT_Y = M.top;
const PLOT_W = VB_W - M.left - M.right;    // 276
const PLOT_H = VB_H - M.top - M.bottom;    // 140

const BAR_W = 9;
const MS_PER_DAY = 86400000;

/** Breathing room above the earliest start and below the latest end, in days. */
const DOMAIN_PAD = 14;

/** Hard stops on the y domain. A period that began four months before its
    program year or ended six months after is real data; a domain outside these
    is a corrupt record, and the chart clamps rather than collapsing every other
    bar into a hairline.

    Measured against the whole payload (the smoke test sweeps it): the earliest
    start is offset −121 and the latest end is +425, so no real bar is ever
    clipped by these stops. The one extreme county loses part of its 14-day
    cosmetic pad at the top, which is the trade this clamp exists to make. */
const DOMAIN_MIN = -130;
const DOMAIN_MAX = 550;

/** The domain used when a county has no reported period at all for this type:
    the program year itself, so the month gridlines still say what the axis is. */
const EMPTY_DOMAIN = Object.freeze({ lo: 1, hi: 366 });

const MONTHS = Object.freeze([
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]);

/** The months that keep their label when there is not room for all of them.
    Quarters, so the axis still reads as a year. */
const QUARTER_MONTHS = Object.freeze([0, 3, 6, 9]);

/** Minimum vertical room, in user units, for a labelled gridline. Below this
    the labels collide and the axis becomes a gray smear, so only the quarter
    months keep theirs. A season that only spans five months gets all five. */
const LABEL_ROOM = 13;

/** Superscript year markers for a gridline that is not in the program year
    itself: "Oct⁻¹" is October of the year before. */
const PRIOR_MARK = '⁻¹';
const NEXT_MARK = '⁺¹';

const SVG_NS = 'http://www.w3.org/2000/svg';

/* ── Pure geometry (unit-tested) ─────────────────────────────────────────── */

/**
 * Day offset of a UTC date from January 1 of `year`, with January 1 = 1.
 * Negative for a date in the previous calendar year, > 366 for the next.
 *
 * Deliberately arithmetic on the true UTC timestamps rather than on
 * `start_yday`: a period starting December 1, 2011 in program year 2012 has
 * start_yday 335 and offset −30, and only the second one can be drawn.
 *
 * @param {Date|number} date
 * @param {number} year program year
 * @returns {number} whole days
 */
export function programOffset(date, year) {
  const t = (date instanceof Date) ? date.getTime() : Number(date);
  return Math.round((t - Date.UTC(year, 0, 1)) / MS_PER_DAY) + 1;
}

/**
 * The y domain for a county's series: every span, padded, clamped.
 *
 * @param {Array<{year: number, start: Date, end: Date}>} series
 * @param {{lo: number, hi: number}|null} [band] the climatology reference band,
 *        folded in so a season that sits outside every reported period is
 *        still visible rather than clipped off the top of the plot.
 * @returns {{lo: number, hi: number}} day offsets
 */
export function spanDomain(series, band) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const rec of series) {
    const s = programOffset(rec.start, rec.year);
    const e = programOffset(rec.end, rec.year);
    if (s < lo) lo = s;
    if (e > hi) hi = e;
  }
  if (band && Number.isFinite(band.lo) && Number.isFinite(band.hi)) {
    if (band.lo < lo) lo = band.lo;
    if (band.hi > hi) hi = band.hi;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { ...EMPTY_DOMAIN };
  lo = Math.max(DOMAIN_MIN, lo - DOMAIN_PAD);
  hi = Math.min(DOMAIN_MAX, hi + DOMAIN_PAD);
  // A single-day period would otherwise divide by zero downstream.
  if (hi - lo < 1) hi = lo + 1;
  return { lo, hi };
}

/**
 * Day offset → y pixel, top of the plot at `lo` (early in the year) and the
 * bottom at `hi`.
 *
 * @param {{lo: number, hi: number}} domain
 * @returns {(offset: number) => number}
 */
export function makeYScale(domain) {
  const span = domain.hi - domain.lo;
  return (offset) => PLOT_Y + ((offset - domain.lo) / span) * PLOT_H;
}

/**
 * Every month start inside the domain — including months of the calendar years
 * either side of the program year, marked as such: "Oct⁻¹" is the October
 * before the program year began.
 *
 * @param {{lo: number, hi: number}} domain
 * @param {number} year program year (its calendar is the one that is exact;
 *        the neighbours are off by at most a leap day, which is a sub-pixel
 *        error on a 140-unit axis)
 * @returns {Array<{offset: number, month: number, shift: number, label: string}>}
 */
export function monthTicks(domain, year) {
  const out = [];
  for (const shift of [-1, 0, 1]) {
    for (let m = 0; m < 12; m++) {
      const offset = programOffset(Date.UTC(year + shift, m, 1), year);
      if (offset < domain.lo || offset > domain.hi) continue;
      out.push({
        offset,
        month: m,
        shift,
        label: MONTHS[m] + (shift < 0 ? PRIOR_MARK : shift > 0 ? NEXT_MARK : ''),
      });
    }
  }
  return out;
}

/**
 * Which of those ticks get their label drawn. A five-month season has room for
 * every month; a domain that spans a year and a half does not, and falls back
 * to the quarters.
 *
 * @param {Array<{month: number}>} ticks from monthTicks()
 * @param {number} [plotHeight]
 * @returns {(tick: {month: number}) => boolean}
 */
export function labelFilter(ticks, plotHeight = PLOT_H) {
  if (ticks.length && plotHeight / ticks.length >= LABEL_ROOM) return () => true;
  return (tick) => QUARTER_MONTHS.includes(tick.month);
}

/* ── Small DOM helpers ───────────────────────────────────────────────────── */

function svg(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  for (const key in attrs) el.setAttribute(key, String(attrs[key]));
  return el;
}

function el(name, attrs, text) {
  const node = document.createElement(name);
  if (attrs) for (const key in attrs) node.setAttribute(key, String(attrs[key]));
  if (text != null) node.textContent = text;
  return node;
}

const round = (n) => Math.round(n * 100) / 100;

/* ── The span chart ──────────────────────────────────────────────────────── */

/**
 * @param {Array<object>} series decoder Recs, ascending by year
 * @param {number[]} yearList every program year in the data
 * @param {number} currentYear the year the map is showing
 * @param {{lo: number, hi: number, label: string}|null} [band] the climatology
 *        reference band, in day offsets
 * @returns {SVGElement}
 */
export function buildChart(series, yearList, currentYear, band) {
  const domain = spanDomain(series, band);
  const y = makeYScale(domain);
  const slot = PLOT_W / yearList.length;
  const barW = Math.min(BAR_W, Math.max(2, slot - 2));
  const byYear = new Map(series.map((rec) => [rec.year, rec]));

  const root = svg('svg', {
    viewBox: '0 0 ' + VB_W + ' ' + VB_H,
    'aria-hidden': 'true',
    focusable: 'false',
  });

  /* Month gridlines + their labels. */
  const grid = svg('g', { stroke: 'var(--border)', 'stroke-width': 0.75 });
  const gridLabels = svg('g', {
    fill: 'var(--text-dim)', 'font-size': 8, 'text-anchor': 'end',
    stroke: 'none',
  });
  const ticks = monthTicks(domain, currentYear);
  const labelled = labelFilter(ticks);
  for (const tick of ticks) {
    const yy = round(y(tick.offset));
    grid.appendChild(svg('line', { x1: PLOT_X, y1: yy, x2: PLOT_X + PLOT_W, y2: yy }));
    if (!labelled(tick)) continue;
    // +2.8 is the optical center of an 8-unit cap height on this baseline;
    // dominant-baseline is unreliable enough across engines to be worth the
    // literal.
    const text = svg('text', { x: PLOT_X - 5, y: yy + 2.8 });
    text.textContent = tick.label;
    gridLabels.appendChild(text);
  }
  root.appendChild(grid);

  /* The climatology band, FIRST so every bar is drawn over it: it is the
     reference the bars are read against, not a value competing with them. The
     dashed outline is the second channel — a fill this light is easy to miss
     as a fill, and the figcaption names it in words. */
  if (band) {
    const top = y(band.lo);
    const bottom = y(band.hi);
    root.appendChild(svg('rect', {
      x: PLOT_X,
      y: round(top),
      width: PLOT_W,
      height: round(Math.max(1.5, bottom - top)),
      fill: 'var(--bg-raised)',
      stroke: 'var(--border)',
      'stroke-width': 0.75,
      'stroke-dasharray': '3 2',
    }));
  }

  /* One bar per year, and an × for the years FSA reported nothing. */
  const bars = svg('g', {});
  const gaps = svg('g', {
    fill: 'var(--text-dim)', 'font-size': 8, 'text-anchor': 'middle',
  });
  yearList.forEach((yr, i) => {
    const cx = PLOT_X + (i + 0.5) * slot;
    const rec = byYear.get(yr);
    if (!rec) {
      const mark = svg('text', { x: round(cx), y: PLOT_Y + PLOT_H - 3 });
      mark.textContent = '×';
      gaps.appendChild(mark);
      return;
    }
    const top = y(programOffset(rec.start, rec.year));
    const bottom = y(programOffset(rec.end, rec.year));
    const isCurrent = yr === currentYear;
    const rect = svg('rect', {
      x: round(cx - barW / 2),
      y: round(top),
      width: round(barW),
      // A one-day period still has to be visible.
      height: round(Math.max(1.5, bottom - top)),
      rx: 1.5,
      fill: isCurrent ? 'var(--accent)' : 'var(--sage-dark)',
    });
    if (isCurrent) {
      // The current year is called out twice — a different fill AND an outline
      // — because fill alone is a color-only distinction (WCAG 1.4.1).
      rect.setAttribute('stroke', 'var(--accent-line)');
      rect.setAttribute('stroke-width', '1.5');
    }
    bars.appendChild(rect);
  });
  root.appendChild(bars);
  root.appendChild(gaps);
  root.appendChild(gridLabels);

  /* Baseline + year labels: every fourth year, plus the current one, and the
     fixed label steps aside when the two would collide. */
  root.appendChild(svg('line', {
    x1: PLOT_X, y1: PLOT_Y + PLOT_H, x2: PLOT_X + PLOT_W, y2: PLOT_Y + PLOT_H,
    stroke: 'var(--border)', 'stroke-width': 1,
  }));
  const currentIdx = yearList.indexOf(currentYear);
  const currentX = currentIdx < 0 ? null : PLOT_X + (currentIdx + 0.5) * slot;
  const yearLabels = svg('g', { 'font-size': 8, 'text-anchor': 'middle' });
  yearList.forEach((yr, i) => {
    const isCurrent = yr === currentYear;
    if (!isCurrent && (i % 4 !== 0)) return;
    const cx = PLOT_X + (i + 0.5) * slot;
    if (!isCurrent && currentX != null && Math.abs(cx - currentX) < 14) return;
    const text = svg('text', {
      x: round(cx),
      y: VB_H - 6,
      fill: isCurrent ? 'var(--accent-line)' : 'var(--text-dim)',
      'font-weight': isCurrent ? 700 : 400,
    });
    text.textContent = String(yr);
    yearLabels.appendChild(text);
  });
  root.appendChild(yearLabels);

  return root;
}

/* ── The table twin ──────────────────────────────────────────────────────── */

/**
 * @param {Array<object>} series decoder Recs
 * @param {number[]} yearList every program year in the data
 * @param {string} place "Missoula, Montana"
 * @param {{startLabel: string, endLabel: string, weeks: number,
 *          term: string}|null} [clim] the climatology row — one FIXED row under
 *        the years, because a climatology has no year to sort among them
 * @returns {HTMLTableElement}
 */
export function buildTable(series, yearList, place, clim) {
  const byYear = new Map(series.map((rec) => [rec.year, rec]));

  const table = el('table', { class: 'card-table' });
  const caption = el('caption', { class: 'sr-only' },
    'Reported grazing periods by program year for ' + place + '.');
  table.appendChild(caption);

  const thead = el('thead');
  const hrow = el('tr');
  for (const label of ['Year', 'Start', 'End', 'Duration']) {
    hrow.appendChild(el('th', { scope: 'col' }, label));
  }
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const yr of yearList) {
    const row = el('tr');
    row.appendChild(el('th', { scope: 'row' }, String(yr)));
    const rec = byYear.get(yr);
    if (rec) {
      row.appendChild(el('td', null, rec.startLabel));
      row.appendChild(el('td', null, rec.endLabel));
      row.appendChild(el('td', null, rec.duration_weeks + ' wk'));
    } else {
      // One cell, not three empty ones: "no data" is a single fact about the
      // year, and three blanks read as three missing values.
      row.appendChild(el('td', { colspan: '3', class: 'card-table-empty' }, 'No data'));
    }
    tbody.appendChild(row);
  }
  if (clim) {
    // The band, in numbers. Last, and labelled rather than dated, so it never
    // reads as one of the program years above it.
    const row = el('tr');
    row.appendChild(el('th', { scope: 'row' }, clim.term));
    row.appendChild(el('td', null, clim.startLabel));
    row.appendChild(el('td', null, clim.endLabel));
    row.appendChild(el('td', null, clim.weeks + ' wk'));
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  return table;
}

/* ── The figure ──────────────────────────────────────────────────────────── */

/**
 * The whole card body for one county: the chart, its caption, and the
 * <details> table twin. The container's contents are replaced.
 *
 * The class names and the `#card-table-details` id are a CONTRACT with
 * css/app.css §9 and with the audit harness, which waits on
 * `#card-content .span-figure svg` — keep them.
 *
 * @param {HTMLElement} container #card-content
 * @param {object} opts
 * @param {Array<object>} opts.series decoder Recs for this county and type
 * @param {number[]} opts.yearList every program year in the data
 * @param {number} opts.year the program year the map is showing
 * @param {string} opts.place "Missoula, Montana"
 * @param {string} opts.caption the figcaption sentence
 * @param {{lo: number, hi: number}|null} [opts.band]
 * @param {object|null} [opts.clim] the table's climatology row
 */
export function renderSpanFigure(container, {
  series, yearList, year, place, caption, band = null, clim = null,
}) {
  const figure = el('figure', { class: 'span-figure' });
  figure.appendChild(buildChart(series, yearList, year, band));
  figure.appendChild(el('figcaption', { class: 'sr-only' }, caption));

  const details = el('details', { id: 'card-table-details' });
  details.appendChild(el('summary', null, 'Show all years as a table'));
  details.appendChild(buildTable(series, yearList, place, clim));

  container.replaceChildren(figure, details);
}
