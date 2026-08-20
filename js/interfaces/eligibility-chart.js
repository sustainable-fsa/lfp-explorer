/* ============================================================================
   LFP Explorer · js/interfaces/eligibility-chart.js
   The eligibility card's picture: every program year of one county's LFP
   determinations as a bar of payment months, with the same numbers under it as
   a table.

   ES module, no build step, no imports at all — pure geometry plus DOM
   construction, which is what makes the scale functions unit-testable head-on
   under node. The COLORS arrive as an argument (the caller resolves them
   through js/color.js's dfColor), so this file has no palette of its own and
   nothing to keep in sync with the legend.

   Sibling of js/interfaces/ngp-chart.js, and deliberately its cousin: same
   viewBox, same `.card-table` twin, same `#card-table-details` id the app's CSS
   and the audit harness key off, same rule that the CURRENT year is called out
   twice (a fill AND an outline AND a bolder label) because a color alone is not
   a distinction (WCAG 1.4.1).

   ── What a bar means ───────────────────────────────────────────────────────
   The height is PAYMENT MONTHS — one to five — on the archives that carry FSA's
   payable figure, and the recomputed DROUGHT FACTOR on the derived one, which
   applies no grazing-period cap. The caller says which in the caption; this
   file draws whatever number it is handed.

   Three cases are not a height at all, and each is drawn as itself:

     no qualifying event   a × on the baseline, the same mark the grazing-period
                           chart uses for a year FSA reported nothing
     months not stated     a HALF-HEIGHT bar in the ramp's index-0 slate. The
                           county qualified and the record does not say for how
                           many months (most 2008–2011 determinations), so it
                           can be neither a zero nor a five. The slate is off
                           the ramp's ladder — lighter than the darkest month
                           and nearly unsaturated — so it cannot be read off the
                           legend as a month count.
     a tier with no room   the tier code (D2, D3b …) is lettered above every bar
                           the slot can hold a label in; the y domain runs to
                           5.5 months so even a five-month bar has headroom.
   ========================================================================== */

/* ── Chart geometry ──────────────────────────────────────────────────────── */

const VB_W = 320;
const VB_H = 170;
const M = Object.freeze({ top: 8, right: 8, bottom: 22, left: 22 });

const PLOT_X = M.left;
const PLOT_Y = M.top;
const PLOT_W = VB_W - M.left - M.right;    // 290
const PLOT_H = VB_H - M.top - M.bottom;    // 140

/** The y domain, in months. Five is the whole ladder; the extra half month is
    headroom for the tier code above a full-height bar. */
const MONTHS_MAX = 5;
const Y_TOP = 5.5;

const BAR_W = 11;

/** A bar for an event whose month count the record does not carry. Half the
    ladder, in the slate — present, and deliberately not a number. */
const UNSTATED_HEIGHT = MONTHS_MAX / 2;

/** Narrower than this and a three-character tier code collides with its
    neighbour, so the codes come off and the table twin carries them. */
const CODE_ROOM = 11;

const SVG_NS = 'http://www.w3.org/2000/svg';

/* ── Pure geometry (unit-tested) ─────────────────────────────────────────── */

/**
 * Months → y pixel. Zero months is the baseline; Y_TOP is the top of the plot.
 *
 * @returns {(months: number) => number}
 */
export function makeYScale() {
  return (months) => PLOT_Y + PLOT_H - (months / Y_TOP) * PLOT_H;
}

/**
 * The bar for one year: its top, its height, and what it stands for.
 *
 * Separated from the drawing so the three cases are readable as three cases.
 * A null `months` is the qualified-but-unstated bar; anything outside 1–5 is
 * clamped, because a payload that ever carried a six would otherwise draw off
 * the top of the plot rather than at the top of it.
 *
 * @param {number|null} months
 * @returns {{y: number, height: number, unstated: boolean}}
 */
export function barFor(months) {
  const y = makeYScale();
  const unstated = months == null;
  const value = unstated ? UNSTATED_HEIGHT
    : Math.min(MONTHS_MAX, Math.max(0, months));
  const top = y(value);
  return { y: top, height: Math.max(1.5, PLOT_Y + PLOT_H - top), unstated };
}

/* ── Small DOM helpers ───────────────────────────────────────────────────── */

function svg(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const key in attrs) node.setAttribute(key, String(attrs[key]));
  return node;
}

function el(name, attrs, text) {
  const node = document.createElement(name);
  if (attrs) for (const key in attrs) node.setAttribute(key, String(attrs[key]));
  if (text != null) node.textContent = text;
  return node;
}

const round = (n) => Math.round(n * 100) / 100;

/* ── The bar chart ───────────────────────────────────────────────────────── */

/**
 * @param {object} opts
 * @param {Map<number, object>} opts.byYear year → the best Rec of that year
 * @param {number[]} opts.yearList every program year the archive covers
 * @param {number} opts.year the year the map is showing
 * @param {(months: number|null) => string} opts.color the ramp, as a function
 * @returns {SVGElement}
 */
export function buildChart({ byYear, yearList, year, color }) {
  const y = makeYScale();
  const slot = PLOT_W / yearList.length;
  const barW = Math.min(BAR_W, Math.max(2, slot - 2));
  const lettered = slot >= CODE_ROOM;

  const root = svg('svg', {
    viewBox: '0 0 ' + VB_W + ' ' + VB_H,
    'aria-hidden': 'true',
    focusable: 'false',
  });

  /* One gridline per whole month, labelled — the axis IS the legend for the
     bar heights, and without it a bar is only a comparison. */
  const grid = svg('g', { stroke: 'var(--border)', 'stroke-width': 0.75 });
  const gridLabels = svg('g', {
    fill: 'var(--text-dim)', 'font-size': 8, 'text-anchor': 'end', stroke: 'none',
  });
  for (let m = 1; m <= MONTHS_MAX; m++) {
    const yy = round(y(m));
    grid.appendChild(svg('line', { x1: PLOT_X, y1: yy, x2: PLOT_X + PLOT_W, y2: yy }));
    // +2.8 is the optical centre of an 8-unit cap height on this baseline;
    // dominant-baseline is unreliable enough across engines to be worth the
    // literal (js/interfaces/ngp-chart.js says the same).
    const text = svg('text', { x: PLOT_X - 5, y: yy + 2.8 });
    text.textContent = String(m);
    gridLabels.appendChild(text);
  }
  root.appendChild(grid);

  const bars = svg('g', {});
  const gaps = svg('g', {
    fill: 'var(--text-dim)', 'font-size': 8, 'text-anchor': 'middle',
  });
  const codes = svg('g', {
    fill: 'var(--text-dim)', 'font-size': 5.5, 'text-anchor': 'middle',
  });

  yearList.forEach((yr, i) => {
    const cx = PLOT_X + (i + 0.5) * slot;
    const rec = byYear.get(yr);
    if (!rec) {
      // No qualifying event: the same × the grazing-period chart uses for a
      // year with no reported period. An absent bar and a zero-height bar would
      // look alike, and only one of them is true.
      const mark = svg('text', { x: round(cx), y: PLOT_Y + PLOT_H - 3 });
      mark.textContent = '×';
      gaps.appendChild(mark);
      return;
    }
    const bar = barFor(rec.months);
    const isCurrent = yr === year;
    const rect = svg('rect', {
      x: round(cx - barW / 2),
      y: round(bar.y),
      width: round(barW),
      height: round(bar.height),
      rx: 1.5,
      fill: color(rec.months),
    });
    if (isCurrent) {
      // Called out twice: the outline here and the bolder, accented year label
      // below — a fill alone is a color-only distinction.
      rect.setAttribute('stroke', 'var(--accent-line)');
      rect.setAttribute('stroke-width', '1.5');
    }
    bars.appendChild(rect);
    if (lettered && rec.event) {
      const code = svg('text', {
        x: round(cx),
        y: round(bar.y - 2),
        'font-weight': isCurrent ? 700 : 400,
        fill: isCurrent ? 'var(--accent-line)' : 'var(--text-dim)',
      });
      code.textContent = String(rec.event).replace('_2026', '');
      codes.appendChild(code);
    }
  });
  root.appendChild(bars);
  root.appendChild(gaps);
  root.appendChild(codes);
  root.appendChild(gridLabels);

  /* Baseline + year labels: every fourth year, plus the current one, and the
     fixed label steps aside when the two would collide. */
  root.appendChild(svg('line', {
    x1: PLOT_X, y1: PLOT_Y + PLOT_H, x2: PLOT_X + PLOT_W, y2: PLOT_Y + PLOT_H,
    stroke: 'var(--border)', 'stroke-width': 1,
  }));
  const currentIdx = yearList.indexOf(year);
  const currentX = currentIdx < 0 ? null : PLOT_X + (currentIdx + 0.5) * slot;
  const yearLabels = svg('g', { 'font-size': 8, 'text-anchor': 'middle' });
  yearList.forEach((yr, i) => {
    const isCurrent = yr === year;
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
 * The same years, in words and numbers, for everyone the picture does not serve
 * (HOUSE-STYLE §5.2). Not a summary of the chart: the chart is one bar per
 * year, and this is one row per year with every field behind it.
 *
 * @param {object} opts
 * @param {Map<number, object>} opts.byYear
 * @param {number[]} opts.yearList
 * @param {Array<{label: string, cell: (rec: object) => string}>} opts.columns
 *        the columns AFTER the year, which differ between the archives: the two
 *        FSA ones can show the cap and the payable figure, the derived one
 *        shows which aggregation produced the row instead.
 * @param {string} opts.caption the sr-only table caption
 * @param {string} opts.emptyLabel what a year with no qualifying event says
 * @returns {HTMLTableElement}
 */
export function buildTable({ byYear, yearList, columns, caption, emptyLabel }) {
  const table = el('table', { class: 'card-table' });
  table.appendChild(el('caption', { class: 'sr-only' }, caption));

  const thead = el('thead');
  const hrow = el('tr');
  hrow.appendChild(el('th', { scope: 'col' }, 'Year'));
  for (const col of columns) hrow.appendChild(el('th', { scope: 'col' }, col.label));
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const yr of yearList) {
    const row = el('tr');
    row.appendChild(el('th', { scope: 'row' }, String(yr)));
    const rec = byYear.get(yr);
    if (rec) {
      for (const col of columns) row.appendChild(el('td', null, col.cell(rec)));
    } else {
      // One cell, not five empty ones: "not eligible" is a single fact about
      // the year, and five blanks read as five missing values.
      row.appendChild(el('td',
        { colspan: String(columns.length), class: 'card-table-empty' }, emptyLabel));
    }
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  return table;
}

/* ── The figure ──────────────────────────────────────────────────────────── */

/**
 * The whole card body for one county: the chart, its caption, an optional
 * cross-dataset sentence, and the <details> table twin. The container's
 * contents are replaced.
 *
 * The class names and the `#card-table-details` id are a CONTRACT with
 * css/app.css §9 and with the audit harness, which waits on
 * `#card-content figure svg` — keep them.
 *
 * @param {HTMLElement} container #card-content
 * @param {object} opts see buildChart/buildTable, plus:
 * @param {string} opts.caption the figcaption sentence
 * @param {string|null} [opts.compare] one sentence comparing another archive's
 *        answer for the same county, year and type — drawn as visible prose,
 *        because it is the whole reason three archives are on one map
 * @param {string} opts.summaryLabel the <details> summary's text
 */
export function renderEligibilityFigure(container, {
  byYear, yearList, year, color, columns, caption, tableCaption, emptyLabel,
  compare = null, summaryLabel,
}) {
  const figure = el('figure', { class: 'elig-figure' });
  figure.appendChild(buildChart({ byYear, yearList, year, color }));
  figure.appendChild(el('figcaption', { class: 'sr-only' }, caption));

  const children = [figure];
  if (compare) children.push(el('p', { class: 'card-compare' }, compare));

  const details = el('details', { id: 'card-table-details' });
  details.appendChild(el('summary', null, summaryLabel));
  details.appendChild(buildTable({
    byYear, yearList, columns, caption: tableCaption, emptyLabel,
  }));
  children.push(details);

  container.replaceChildren(...children);
}
