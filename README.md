# LFP Explorer

The seed of the **Sustainable FSA Explorer** — a single-page web application
visualizing the data assembled by the [Sustainable FSA
project](https://sustainable-fsa.com). Its first module is the interactive map
of USDA Farm Service Agency **Normal Grazing Periods** (2008–2026, all FSA
counties and pasture types), which previously lived in the
[fsa-normal-grazing-period](https://github.com/sustainable-fsa/fsa-normal-grazing-period)
archive repo.

**Live app:** <https://sustainable-fsa.com/lfp-explorer/>

## Architecture

- A hand-written, zero-build MapLibre GL app (`index.html` + ES modules under
  `js/`), served by GitHub Pages from this repo's root (Jekyll disabled).
- Chrome, tokens, and map machinery come from the shared house-style kit
  [sustainable-fsa/style](https://github.com/sustainable-fsa/style), consumed
  same-origin by pinned version path
  (`https://sustainable-fsa.com/style/v0.2.0/…` for the versioned surface;
  `…/style/vendor/…` and `…/style/assets/…` are deliberately unversioned).
  The kit owns the two side surfaces this app is built around: the left
  controls drawer (`.sfsa-drawer` + `ui/drawer.js`) and the right-docked county
  card (`.sfsa-card.dock-right` + `ui/card.js`).
- County boundaries are fetched at runtime from the boundary archives'
  own Pages (`fsa-counties-dd17` for program years ≤ 2014, `fsa-counties-dd22`
  for ≥ 2015).
- Help-modal copy lives in the sidecar [`help.md`](help.md).

## Data

`fsa-normal-grazing-period.json` (schema `fsa-ngp-web/1`, CC0) is a
browser-optimized columnar build of the grazing-period archive — 244,890
records, ~5 MB raw, ~100 KB gzipped over the wire. **This repo ships no copy
of it.** The archive repo's own processing script builds and commits it on
every archive update, and the app fetches it at runtime by the relative path
`../fsa-normal-grazing-period/fsa-normal-grazing-period.json` — which in
production resolves to the archive's same-origin Pages copy at
<https://sustainable-fsa.com/fsa-normal-grazing-period/fsa-normal-grazing-period.json>,
gzipped by Pages. (The `data.sustainable-fsa.com` mirror is cross-origin and
serves the file uncompressed, so the app does not use it.)

[`R/web-assets.R`](R/web-assets.R) is therefore down to one job — the two
color ramps in `assets/`, which are a frozen published contract:

```r
source("R/web-assets.R"); build_color_ramps()
```

## Development

```sh
# Serve the workspace root so paths mirror production:
python3 -m http.server 8000 -d /path/to/sustainable-fsa
# → http://localhost:8000/lfp-explorer/
```

Because the workspace root is what gets served, local dev (and
`tools/verify.mjs`, which serves the same root itself) needs a sibling
`fsa-normal-grazing-period` checkout with the committed JSON present — `git
pull` it if the app boots with no data. The same relative path reaches it.

### Developing against an unreleased kit

Released kit versions are immutable snapshots, so a change that needs new kit
surface has to be proven against the local `style` checkout **before** the kit
is released. Because the workspace root is what gets served, root-absolute
paths reach the sibling checkout — so the recipe is a two-way URL sweep on a
working branch:

```sh
# Dev-ward — point every kit reference at the local style/ checkout.
# NEVER push this state.
sed -i '' -e 's|https://sustainable-fsa\.com/style/v0\.1\.0/|/style/|g' \
          -e 's|https://sustainable-fsa\.com/style/vendor/|/style/vendor/|g' \
          -e 's|https://sustainable-fsa\.com/style/assets/|/style/assets/|g' \
          index.html js/*.js

# Prod-ward — re-pin after the kit release: versioned surface, then the
# deliberately unversioned vendor and brand-asset surfaces.
for d in theme core map county ui; do
  sed -i '' "s|/style/$d/|https://sustainable-fsa.com/style/v0.2.0/$d/|g" index.html js/*.js
done
for d in vendor assets; do
  sed -i '' "s|/style/$d/|https://sustainable-fsa.com/style/$d/|g" index.html js/*.js
done
grep -rn "'/style/\|\"/style/" index.html js/   # must come back empty
```

Two rules make this safe rather than clever:

- **The sweep is all-or-nothing** across `index.html` and every file in `js/`.
  Two different `core.js` URLs are two module instances, and therefore two
  independent `viewport` pub-subs — the drawer would end up listening to a
  different viewport than the county card.
- **Root-absolute is `'self'`** under this page's CSP, so the sweep needs no
  CSP edit. It must not touch the inline anti-flash `<script>`, whose `sha256`
  is pinned in that CSP (it contains no kit URLs, so a URL sweep never does).

CI fetches the kit from production, so a kit change lands in this order: kit
released and served by Pages → prod-ward sweep here → push.

## Audits

`tools/` carries the quality gates (axe, behavioural verify, Lighthouse), run
locally and by `.github/workflows/audit.yaml` on every push and PR:

```sh
npm ci --prefix tools && npx --prefix tools playwright install chromium
npx --prefix tools html-validate index.html
node tools/a11y-audit.mjs
node tools/verify.mjs
npx --prefix tools lhci autorun
```

## License and provenance

Code is MIT (see [LICENSE](LICENSE)). The underlying grazing-period data are
US public domain (raw FOIA material) and CC0 (processed); see the
[archive repo](https://github.com/sustainable-fsa/fsa-normal-grazing-period)
and the in-app **About this map** for citation, FOIA request numbers, and the
standard disclaimer — for current program information, always consult your
local FSA office.

---

Part of *Enhancing Sustainable Disaster Relief in FSA Programs*, supported by
the USDA Office of the Chief Economist, Office of Energy and Environmental
Policy, and the USDA Climate Hubs. Built and maintained by the [Montana
Climate Office](https://climate.umt.edu), University of Montana.
