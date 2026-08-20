/* ============================================================================
   LFP Explorer · js/card-content.js
   The county card's second half: the picture, and the same numbers under it as
   a table.

   ES module, no build step. Imports the two registry readings and nothing else
   — everything it needs from the app arrives as the frozen context object
   app.js hands features at the seam (it never imports app.js back; that would
   make the graph cyclic).

   ── What this file owns, and what it does not ──────────────────────────────
   It owns the LIFECYCLE: when the card's body should be drawn, when a redraw
   would rebuild identical markup and can be skipped, that a reader who opened
   the table wants it to stay open, and how to notice a change the app fires no
   event for. All of that is the same for every data family.

   It draws NOTHING. What the body IS — a span chart of grazing periods, a
   weekly drought heatmap — belongs to the active interface's descriptor
   (`iface.cardBody(container, data, xw, sel, id)`), because only the family
   knows what its own picture means. Before PR 2 this file was the grazing
   period's chart; that chart now lives in js/interfaces/ngp-chart.js behind
   js/interfaces/ngp.js.

   ── The twin ───────────────────────────────────────────────────────────────
   Whatever a descriptor draws, it draws under the same rule: the picture is
   aria-hidden decoration inside a <figure> whose <figcaption> says what it
   shows, and the <details> table beside it is the same data, exactly, for
   anyone the picture does not serve (HOUSE-STYLE §5.2). Neither is a summary of
   the other. This file keeps the <details> open across redraws; the descriptor
   builds it.

   ── How this stays in sync with the map ────────────────────────────────────
   app.js fires onCountySelected on open and close, and nothing at all when the
   year, the pasture type or the week changes under an open card — but it does
   refill the card's <dl> through fillCard() on exactly those changes (and on a
   boundary vintage swap, and on a dataset toggle). So the refresh trigger here
   is a MutationObserver on #card-rows: it is the app's own "this card is now
   showing something else" signal, it cannot drift out of sync with the readout
   beside it, and it needs no second seam in app.js. refresh() is exported on
   the handle as well, for a caller that would rather be explicit.

   ── Two kinds of redraw ────────────────────────────────────────────────────
   A render key decides which one happens. When it changes, the descriptor
   rebuilds the body. When it does not, the descriptor's own update() — if it
   returned one — is called instead: that is how a scrubbed week moves a marker
   over a heatmap of twenty-seven years without rebuilding the twenty-seven
   years, every frame, under the reader's cursor.
   ========================================================================== */

import { interfaceOf, viewSelection } from './interfaces/registry.js';

/**
 * Wire the card's picture + table to the app.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.container  #card-content
 * @param {object} opts.ctx             app.js's ngpContext()
 * @returns {{render: (id: string|null) => void, refresh: () => void,
 *            element: HTMLElement}}
 */
export function initCardContent({ container, ctx } = {}) {
  if (!container || !ctx) {
    console.warn('[ngp/card] missing container or context — the card body is off.');
    return { render() {}, refresh() {}, element: container || null };
  }

  // Open/closed survives every re-render: a reader who opened the table does
  // not want it to snap shut because the year slider moved. Held here rather
  // than in a descriptor because it is a fact about the READER, not the data.
  let tableOpen = false;
  let currentId = null;
  let renderedKey = null;
  let bodyHandle = null;   // the descriptor's optional per-frame updater

  /** The selection every leaf is called with — the app's own, so this module
      and the map can never be describing different states. */
  function selection() {
    return (ctx.getSelection && ctx.getSelection()) || viewSelection(ctx);
  }

  /**
   * What makes one drawn body different from another: the county, the family,
   * the dataset, the year and the type — plus whatever else the active
   * interface says matters (cardKey). Anything NOT in this key is expected to
   * be handled by the body's own update().
   */
  function keyOf(iface, sel, id) {
    const extra = typeof iface.cardKey === 'function' ? iface.cardKey(sel) : '';
    return [id, sel.view || '', sel.dataset, sel.year, sel.type, extra].join('|');
  }

  /** Keep the reader's <details> state across a rebuild. The descriptor authors
      the element (it holds that family's own table); this only remembers
      whether it was open. */
  function adoptDetails() {
    const details = container.querySelector('details');
    if (!details) return;
    if (tableOpen && !details.open) details.open = true;
    details.addEventListener('toggle', () => { tableOpen = details.open; });
  }

  function clear() {
    currentId = null;
    renderedKey = null;
    bodyHandle = null;
    container.replaceChildren();
  }

  function render(id) {
    if (id == null) {
      clear();
      return;
    }
    currentId = String(id);

    const iface = interfaceOf(ctx);
    if (typeof iface.cardBody !== 'function') {
      // A family that has no picture to draw says so by not having one, and the
      // card is its <dl> readout alone.
      clear();
      currentId = String(id);
      return;
    }

    const sel = { ...selection(), view: ctx.getState().view };
    const key = keyOf(iface, sel, currentId);
    if (key === renderedKey) {
      // Same markup as last time. If the body kept an updater, the thing that
      // moved is something it draws inside itself (a week marker) — let it move
      // it, and do not yank focus out of an open <summary> to redraw the rest.
      if (bodyHandle && typeof bodyHandle.update === 'function') {
        bodyHandle.update(sel, currentId);
      }
      return;
    }
    renderedKey = key;

    const handle = iface.cardBody(container, ctx.getData(), ctx.getCrosswalk(),
      sel, currentId);
    bodyHandle = (typeof handle === 'function') ? { update: handle } : handle;
    adoptDetails();
  }

  function refresh() {
    if (currentId) render(currentId);
  }

  ctx.onCountySelected(render);

  // A view switch or a dataset toggle changes which descriptor owns this
  // container. The key would catch most of that by itself; this makes it
  // certain, and it is the signal that the body has to be rebuilt by someone
  // else's rules.
  if (ctx.onViewChange) {
    ctx.onViewChange(() => {
      renderedKey = null;
      bodyHandle = null;
      refresh();
    });
  }

  // The year/week/type refresh signal — see the header. #card-rows is app.js's
  // own readout for the SAME county and selection this module draws, so a
  // rewrite of it is exactly the moment this content is stale. Nothing here
  // writes to #card-rows, so the observer cannot re-trigger itself.
  const rows = document.getElementById('card-rows');
  if (rows && typeof MutationObserver === 'function') {
    new MutationObserver(refresh).observe(rows, { childList: true });
  } else {
    console.warn('[ngp/card] #card-rows not found — the card body will only '
      + 'update on selection changes.');
  }

  // The seam runs after a deep-linked ?county= has already been selected, so
  // the subscription above has missed its first event.
  const opening = ctx.getState().countyId;
  if (opening) render(opening);

  return { render, refresh, element: container };
}
