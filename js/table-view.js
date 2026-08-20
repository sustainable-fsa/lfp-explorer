/* ============================================================================
   FSA Normal Grazing Periods · js/table-view.js
   The on-demand data table: every county the map is currently painting, as
   markup, in a modal dialog.

   ES module, no build step. Imports ./data.js and the kit's core for the modal
   plumbing; the app arrives as the frozen context object app.js hands features
   at the seam.

   ── Why this exists ────────────────────────────────────────────────────────
   The choropleth is a WebGL canvas: to a screen reader it is a rectangle. The
   always-on half of the a11y twin is app.js's live-region summary; THIS is the
   other half — the escape hatch that lets anyone read the actual numbers, sort
   them with their own eyes, copy them into a spreadsheet (HOUSE-STYLE §5.2).
   It is not a summary of the map. It is the map's data.

   ── Why it is built on open, and only once per view ────────────────────────
   Three thousand rows is ~19,000 elements. Building them at boot would cost
   every visitor the price of a feature most will not open; rebuilding them on
   every year-slider frame would cost it hundreds of times. So the table is
   built when the dialog opens, and only if the (dataset, year, type) it was
   built for has changed since — reopening an unchanged view reuses the markup.
   The DATASET is part of that key because two datasets answer the same
   (year, type) with different rows; leaving it out would show a reader the
   previous dataset's numbers under the new dataset's caption.
   ========================================================================== */

import { initInfoModal } from 'https://sustainable-fsa.com/style/v0.2.0/core/core.js';
import { countyName, getYearType } from './data.js';
import { interfaceOf, viewSelection } from './interfaces/registry.js';

/** Above this, a rebuild is worth warning the user about — measured on the
    PREVIOUS build, because the only honest estimate of how long this device
    takes is how long it took this device last time. */
const SLOW_BUILD_MS = 120;

/** Frames to let the "Building the table…" pill actually paint before the
    build blocks the main thread. Two: one to flush style, one to composite. */
function twoFrames() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') { resolve(); return; }
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function el(name, attrs, text) {
  const node = document.createElement(name);
  if (attrs) for (const key in attrs) node.setAttribute(key, String(attrs[key]));
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Every row the table shows, sorted the way a reader scans it: state, then
 * county. Exported for the smoke test; pure but for the data module.
 *
 * @param {number} year
 * @param {string} type
 * @returns {Array<{id: string, county: string, state: string, rec: object}>}
 */
export function tableRows(year, type) {
  const recs = getYearType(year, type);
  const rows = [];
  for (const [id, rec] of recs) {
    const nm = countyName(id);
    rows.push({
      id,
      county: nm ? nm.county : id,
      state: nm ? nm.state : '',
      rec,
    });
  }
  rows.sort((a, b) => a.state.localeCompare(b.state, 'en')
    || a.county.localeCompare(b.county, 'en')
    // Two counties can share a name inside a state (they do not today); the id
    // is the tiebreak so the order is total and the table is stable.
    || a.id.localeCompare(b.id, 'en'));
  return rows;
}

/* The columns of a grazing-period table. Still a constant, not a descriptor
   leaf: PR 1 has one interface, and every dataset in it answers with the same
   six fields. When a second interface arrives (a drought class is not a start
   date) these move onto the descriptor beside its caption. The code column's
   label is resolved per dataset at build time: the climatology's rows are in
   its own key space (Census FIPS), and captioning them "FSA code" would be a
   false claim about eight states' worth of leading-zero identifiers. */
const COLUMNS = Object.freeze([
  'County', 'State', 'FSA code', 'Start', 'End', 'Duration (weeks)',
]);

/**
 * @param {Array<object>} rows from tableRows()
 * @param {string} caption the sentence that names this table
 * @param {string} codeLabel header for the county-code column — 'FSA code' or
 *   'FIPS code', following the active dataset's key space
 * @returns {DocumentFragment}
 */
function buildTable(rows, caption, codeLabel) {
  const frag = document.createDocumentFragment();
  const table = el('table', { class: 'data-table' });

  // The visible caption is the modal's subtitle (one line, in the header), so
  // the table's own <caption> is sr-only — the table still needs a name of its
  // own for anyone navigating by table rather than reading the dialog.
  table.appendChild(el('caption', { class: 'sr-only' }, caption));

  const thead = el('thead');
  const hrow = el('tr');
  for (const label of COLUMNS) {
    hrow.appendChild(el('th', { scope: 'col' }, label === 'FSA code' ? codeLabel : label));
  }
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const row of rows) {
    const tr = el('tr');
    tr.appendChild(el('th', { scope: 'row' }, row.county));
    tr.appendChild(el('td', null, row.state));
    const code = el('td');
    // A <code> because it IS a code: five characters, leading zeros load
    // bearing, never a number (kit AGENTS.md §10).
    code.appendChild(el('code', null, row.id));
    tr.appendChild(code);
    tr.appendChild(el('td', null, row.rec.startLabel));
    tr.appendChild(el('td', null, row.rec.endLabel));
    tr.appendChild(el('td', { class: 'num' }, String(row.rec.duration_weeks)));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  frag.appendChild(table);
  return frag;
}

/**
 * Wire the "View data as a table" button to the table dialog.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.button      #btn-table
 * @param {HTMLDialogElement} opts.dialog #table-modal
 * @param {HTMLElement} opts.captionEl   #table-modal-caption
 * @param {HTMLElement} opts.bodyEl      #table-modal-body
 * @param {object} opts.ctx              app.js's ngpContext()
 * @returns {{open: () => Promise<void>, close: () => void,
 *            invalidate: () => void}}
 */
export function initTableView({ button, dialog, captionEl, bodyEl, ctx } = {}) {
  if (!button || !dialog || !bodyEl || !ctx) {
    console.warn('[ngp/table] missing button, dialog, body or context — the '
      + 'data table is off.');
    return { async open() {}, close() {}, invalidate() {} };
  }

  // No `trigger:` — the button is wired below so the table is BUILT before the
  // dialog opens. Everything else about the modal (backdrop click, the close
  // button, native Esc, focus back to the opener) stays the kit's.
  const modal = initInfoModal({ dialog });

  let builtFor = null;      // the selection key the current markup was built for
  let lastBuildMs = 0;

  /** What makes one built table different from another: the dataset, the
      program year and the type. */
  function keyOf(sel) {
    return sel.dataset + '|' + sel.year + '|' + sel.type;
  }

  function build() {
    const sel = viewSelection(ctx);
    // Rows come from the ACTIVE dataset, in its own key space — the table is
    // the map's data, not a summary of it. The caption is the descriptor's, so
    // the dialog subtitle, the sr-only <caption> and the scroll region's name
    // all name the same thing the legend and the live region do.
    const rows = tableRows(sel.year, sel.type);
    const caption = interfaceOf(ctx).table.caption(sel, rows.length);
    const codeLabel = ctx.getData().keySpace === 'fips' ? 'FIPS code' : 'FSA code';

    const started = (typeof performance === 'object') ? performance.now() : 0;
    bodyEl.replaceChildren(buildTable(rows, caption, codeLabel));
    lastBuildMs = started ? performance.now() - started : 0;

    // The body scrolls (css/app.css §10), and a scrollable region has to be
    // reachable and announced as one: without a tabindex a keyboard user can
    // reach the table's links (there are none) but never the scroll itself
    // (WCAG 2.1.1), and without a name a screen reader calls it "region".
    bodyEl.tabIndex = 0;
    bodyEl.setAttribute('role', 'region');
    bodyEl.setAttribute('aria-label', caption);

    if (captionEl) captionEl.textContent = caption;
    builtFor = keyOf(sel);
    return caption;
  }

  async function open() {
    let caption = captionEl ? captionEl.textContent : '';

    if (builtFor !== keyOf(viewSelection(ctx))) {
      // Only warn when this device has already proved it is slow enough to
      // need warning: a pill that appears and vanishes inside one frame is
      // worse than no pill.
      const slow = lastBuildMs > SLOW_BUILD_MS;
      if (slow) {
        ctx.note('Building the data table…');
        await twoFrames();
      }
      caption = build();
      if (slow) ctx.clearNote();
    }

    modal.open();
    ctx.announce(caption + '. Data table opened.');
  }

  button.addEventListener('click', () => {
    open().catch((err) => {
      console.error('[ngp/table] could not build the data table', err);
      ctx.toast('Could not build the data table.', 5000);
    });
  });

  return {
    open,
    close: modal.close,
    /** Force the next open to rebuild. app.js calls it after a dataset or
        interface switch: the selection key would often catch that by itself,
        but not always (two datasets can share a type name), and a stale table
        under a fresh caption is the one failure this modal must not have. */
    invalidate() { builtFor = null; },
  };
}
