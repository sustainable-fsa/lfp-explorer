/* ============================================================================
   LFP Explorer · js/table-view.js
   The on-demand data table: every county the map is currently painting, as
   markup, in a modal dialog.

   ES module, no build step. Imports the kit's core for the modal plumbing and
   the two registry readings; the app arrives as the frozen context object
   app.js hands features at the seam.

   ── Why this exists ────────────────────────────────────────────────────────
   The choropleth is a WebGL canvas: to a screen reader it is a rectangle. The
   always-on half of the a11y twin is app.js's live-region summary; THIS is the
   other half — the escape hatch that lets anyone read the actual numbers, sort
   them with their own eyes, copy them into a spreadsheet (HOUSE-STYLE §5.2).
   It is not a summary of the map. It is the map's data.

   ── What this file owns, and what it does not ──────────────────────────────
   It owns the DIALOG and the TABLE's accessibility: the sr-only <caption>, one
   `scope="col"` per header, a `<th scope="row">` per row, county codes in
   `<code>`, and the scrolling body's role/name/tabindex (WCAG 2.1.1). None of
   that depends on what the columns mean.

   The columns and the rows are the active interface's
   (`iface.table.columns(sel)` / `.rows(data, xw, sel, names)`): a drought class
   is not a start date, and a family that answers in FIPS must be allowed to say
   "FIPS code" in its own header. Rows come back as flat objects keyed by the
   columns' `key`, and three column flags carry the a11y intent — `rowHeader`,
   `code`, `num` — so this file never has to guess which column is the name and
   which is a number.

   ── Why it is built on open, and only once per view ────────────────────────
   Three thousand rows is ~19,000 elements. Building them at boot would cost
   every visitor the price of a feature most will not open; rebuilding them on
   every year-slider frame would cost it hundreds of times. So the table is
   built when the dialog opens, and only if the selection it was built for has
   changed since — reopening an unchanged view reuses the markup. What counts as
   "changed" is the interface's own answer (`table.cacheKey`), because only it
   knows whether a week, a year or a pasture type is part of its identity.
   ========================================================================== */

import { initInfoModal } from 'https://sustainable-fsa.com/style/v0.3.1/core/core.js';
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
 * @param {Array<object>} rows from the interface's table.rows()
 * @param {Array<object>} columns from the interface's table.columns()
 * @param {string} caption the sentence that names this table
 * @returns {DocumentFragment}
 */
function buildTable(rows, columns, caption) {
  const frag = document.createDocumentFragment();
  const table = el('table', { class: 'data-table' });

  // The visible caption is the modal's subtitle (one line, in the header), so
  // the table's own <caption> is sr-only — the table still needs a name of its
  // own for anyone navigating by table rather than reading the dialog.
  table.appendChild(el('caption', { class: 'sr-only' }, caption));

  const thead = el('thead');
  const hrow = el('tr');
  for (const col of columns) {
    hrow.appendChild(el('th', { scope: 'col' }, col.label));
  }
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const row of rows) {
    const tr = el('tr');
    for (const col of columns) {
      const value = row[col.key] == null ? '' : String(row[col.key]);
      if (col.rowHeader) {
        tr.appendChild(el('th', { scope: 'row' }, value));
        continue;
      }
      if (col.code) {
        const cell = el('td');
        // A <code> because it IS a code: five characters, leading zeros load
        // bearing, never a number (kit AGENTS.md §10).
        cell.appendChild(el('code', null, value));
        tr.appendChild(cell);
        continue;
      }
      tr.appendChild(el('td', col.num ? { class: 'num' } : null, value));
    }
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

  function selection() {
    return (ctx.getSelection && ctx.getSelection()) || viewSelection(ctx);
  }

  /** The interface's own answer to "is this the same table I already built?" */
  function keyOf(iface, sel) {
    return typeof iface.table.cacheKey === 'function'
      ? iface.table.cacheKey(sel)
      : sel.dataset + '|' + sel.year + '|' + sel.type;
  }

  /**
   * Name one county id, geometry gazetteer first.
   *
   * Handed to the interface's rows() because a family whose PAYLOAD is keyed by
   * FIPS but whose ROWS are FSA counties (the drought monitor, after the
   * crosswalk join) has no gazetteer of its own for the ids it is reporting —
   * the polygons do. A family answering in its own key space ignores this and
   * uses its payload's names, which is the only correct choice there.
   */
  function names(id) {
    const counties = ctx.getCounties && ctx.getCounties();
    return (counties && counties.names.get(String(id))) || null;
  }

  function build() {
    const iface = interfaceOf(ctx);
    const sel = selection();
    // Rows come from the ACTIVE dataset, through the ACTIVE interface — the
    // table is the map's data, not a summary of it. The caption is the
    // descriptor's too, so the dialog subtitle, the sr-only <caption> and the
    // scroll region's name all name the same thing the legend and the live
    // region do.
    const columns = iface.table.columns(sel);
    const rows = iface.table.rows(ctx.getData(), ctx.getCrosswalk(), sel, names);
    const caption = iface.table.caption(sel, rows.length);

    const started = (typeof performance === 'object') ? performance.now() : 0;
    bodyEl.replaceChildren(buildTable(rows, columns, caption));
    lastBuildMs = started ? performance.now() - started : 0;

    // The body scrolls (css/app.css §10), and a scrollable region has to be
    // reachable and announced as one: without a tabindex a keyboard user can
    // reach the table's links (there are none) but never the scroll itself
    // (WCAG 2.1.1), and without a name a screen reader calls it "region".
    bodyEl.tabIndex = 0;
    bodyEl.setAttribute('role', 'region');
    bodyEl.setAttribute('aria-label', caption);

    if (captionEl) captionEl.textContent = caption;
    builtFor = keyOf(iface, sel);
    return caption;
  }

  async function open() {
    let caption = captionEl ? captionEl.textContent : '';

    if (builtFor !== keyOf(interfaceOf(ctx), selection())) {
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
