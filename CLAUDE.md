# LFP Explorer

A zero-build, single-page MapLibre GL app: `index.html` + ES modules under
`js/`, served by GitHub Pages from this repo's root. `js/app.js` is the core
(state, URL, map, controls drawer, legend, county card); `js/data.js` and
`js/color.js` are the app's data and scales; `legend-wheel.js`,
`card-content.js`, `table-view.js` and `export.js` hang off the documented seam
at the bottom of `app.js`. Help-modal copy is the sidecar `help.md`. Quality
gates live in `tools/` (`verify.mjs`, `a11y-audit.mjs`, html-validate, LHCI) and
run in CI on every push.

## House style

This app consumes the Sustainable FSA style kit, pinned by full versioned URL
in index.html (https://sustainable-fsa.com/style/v0.2.0/…). Design tokens,
a11y mandates, and interaction conventions: see HOUSE-STYLE.md in
https://github.com/sustainable-fsa/style — tokens only (no raw hexes),
--accent is fill-only, aria-pressed drives toggle styling, canvas data needs a
live region plus the sr summary / on-demand table twin, and county joins use
5-character FSA string ids (never FIPS, never parseInt). To change shared
styling, change the kit and bump the pinned version here; never patch a local
copy.

Specifics that bite in this repo:

- **`css/app.css` is app layout only.** The kit owns every component. Any rule
  that touches a kit or vendor selector must be tagged `/* kit-override: <why>
  */` — the file header counts them, so keep that count truthful. If a second
  app wants the same override, it belongs in the kit instead.
- **localStorage is namespaced `sfsa-ngp-*`** (`year`, `type`, `variable`,
  `drawer`, `seen-intro`), all collected in `LS` in `js/app.js` and every one
  re-validated on read exactly like a URL param. The single exception is
  `sfsa-theme`, which is shared org-wide on this origin and written only by the
  kit's `initThemeToggle`.
- **The URL is the primary state**, read once at boot with precedence
  URL > localStorage > default. A view entirely at defaults must emit **no query
  string at all**; `?kbd=off` is the WCAG 2.1.4 opt-out for the `/` shortcut and
  is never persisted.
- **Kit URLs are pinned and consistent.** Mixing versions is forbidden: two
  `core.js` URLs are two module instances and therefore two `viewport`
  pub-subs. Sweeping them for local kit development is all-or-nothing across
  `index.html` and every file in `js/` — recipe and the prod-ward return trip
  are in README § Developing against an unreleased kit.
- **Do not edit the inline anti-flash `<script>` in `index.html`.** Its
  `sha256` is pinned in the page's CSP `<meta>`, the recompute recipe is
  commented above the block, and the failure mode is silent (the theme still
  renders; the flash just comes back).
- **`#county-card`'s interior is a contract.** `fillCard()` in `js/app.js` and
  the `MutationObserver` on `#card-rows` in `js/card-content.js` are written
  against those ids. The kit's `dock-right` / bottom-sheet geometries are
  CSS-only for exactly that reason.
