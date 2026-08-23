# Audit checklist — LFP Explorer

Four automated gates and three manual passes. The gates are in CI
(`.github/workflows/audit.yaml`); the manual passes are here because nothing
below can be asserted from a headless browser — they are about where focus
goes, what a thumb can reach, and whether a picture says the same thing as the
number beside it.

Run the gates before the manual passes. A red gate makes the manual pass a
waste of an hour.

---

## Running the automated gates

One local static server serves all four, over the **workspace root** — the
parent of this repo — so the app sits at the subpath it deploys to. Serving
this repo at `/` would resolve every asset fine and audit a geometry no visitor
ever sees.

```sh
# once
npm ci --prefix tools
npx --prefix tools playwright install --with-deps chromium

# the dev server, from anywhere; leave it running
python3 -m http.server 8000 -d /path/to/sustainable-fsa
# → the app is at http://localhost:8000/lfp-explorer/
```

| # | Gate | Command | Fails on |
|---|------|---------|----------|
| 1 | Markup | `npx --prefix tools html-validate index.html` | any html-validate error |
| 2 | Accessibility | `node tools/a11y-audit.mjs` | any **serious/critical** axe violation, or `ngpReady` never firing |
| 3 | Behaviour | `node tools/verify.mjs` | any failed assertion, or **any console error** |
| 4 | Lighthouse | `npx --prefix tools lhci autorun --config=.lighthouserc.json` | accessibility < 1.0, best-practices < 0.95 (performance is warn-only) |

`--prefix tools` in gate 1, never `--yes`: a bare `npx --yes html-validate`
resolves from the working directory's `node_modules`, which does not exist at
the repo root (the root `package.json` is gitignored), so it would fetch
whatever is newest on the registry and the gate would drift under the repo
without a commit. `.github/workflows/audit.yaml` carries the same warning at
the step that runs it.

Gates 2 and 3 start their **own** ephemeral server on a random port and do not
use the one above; only Lighthouse needs the `:8000` server, because
`staticDistDir` serves a directory at the server root and cannot express a
subpath app. Both harnesses take the workspace root as `argv[1]` if the
checkout is not two levels below `tools/`. What they share about the app — the
page path, the two themes, the two viewports, the localStorage seeds, the
`ngpReady` predicate, the per-view probe table, the static server — lives in
`tools/config.mjs`; a shared number is changed there, once.

**The payloads have to be next to the checkout.** No data payload is committed
here — the app fetches each one by relative sibling path, and
`tools/payloads.txt` is the manifest CI stages from. (The FIPS↔FSA crosswalk in
`assets/` is the one committed table: a join key, served by the checkout
itself, and never staged.) Mirror any payload a sibling checkout does not
already provide, from the repo root:

```sh
while IFS= read -r p; do
  case "$p" in ''|\#*) continue ;; esac
  mkdir -p "../$(dirname "$p")"
  [ -f "../$p" ] || curl -fsSL "https://sustainable-fsa.com/$p" -o "../$p"
done < tools/payloads.txt
```

Gates 2 and 3 fetch the pinned style kit and both FSA county boundary archives
**live** from `sustainable-fsa.com`. That is deliberate — those origins are
part of the app's contract — and it means an outage there fails the run.

`tools/verify.mjs` writes a screenshot of every state it drives to
`verify-out/` (gitignored). On a failure they are the diagnosis.

### Reading the numbers honestly

- **`ngpReady` is a data hook, not a picture.** It is stamped after the payload
  is joined and the first choropleth paint has run. Nothing in CI proves a
  tile was rasterised; do not let a green run be read as "the map looked right".
- **Lighthouse performance is pessimistic locally.** `python3 -m http.server`
  sends no `content-encoding`, so the 5.1 MB payload crosses the wire whole.
  It gzips to **98 KB**, and GitHub Pages does gzip it. The local score
  (~0.31, LCP ~35 s) is therefore a floor, not the production number — which is
  exactly why performance is warn-only. **Both numbers are STALE and must be
  re-measured**: they predate the tiled county path, which cut the boundary
  bytes (453 KB brotli TopoJSON → ~348 KB of sidecar plus tiles) while raising
  the request count. Which way the score moved is not predictable from that and
  should not be guessed at in this file.
- **There are THREE contract origins now.** The kit comes from
  `sustainable-fsa.com`, the payloads from sibling checkouts, and the county
  geometry from `data.sustainable-fsa.com` — 21 tilesets and their sidecars.
  `check-boundaries.mjs` fetches all 21 sidecars live. An outage at any of the
  three fails the run, which is the correct signal, and a Pages deploy of the
  KIT while an audit is running has been seen to produce exactly one transient
  CORS failure on one theme/viewport combo. If a run fails with
  `No 'Access-Control-Allow-Origin' header` against a `/style/` URL, check
  whether something was deploying, and re-run before investigating.
- **axe trips this page's own CSP.** axe-core applies `style` attributes to the
  nodes it measures and the page ships `style-src` with no `'unsafe-inline'`,
  so each axe pass logs two "Applying inline style violates…" errors.
  `a11y-audit.mjs` filters them by pattern and says so in a comment. They are
  the auditor's, not the app's: `verify.mjs` never loads axe and is
  console-clean end to end.

---

## Manual pass 1 — keyboard only

Unplug the mouse. Do the whole pass **twice**, once per theme
(`?theme=light`, `?theme=high-contrast`), because a focus ring that vanishes
against high-contrast surfaces is a different bug from one that was never
drawn.

### Tab order

- [ ] The **first** Tab from the address bar reveals **Skip to map**, and it is
      visible, not a 1×1 sliver.
- [ ] Enter on it moves focus to `#main` and the next Tab lands **inside** the
      map region, not back at the top of the navbar.
- [ ] Without the skip link, the order runs: logo link → table → export →
      share → theme → help (`?`) → county search → year slider → pasture type
      select → Start / End / Duration → the drawer's edge tab → map. (The
      controls live in the drawer, which sits after the navbar in the DOM; on
      a phone the ☰ button appears in the navbar and a **closed** drawer's
      controls are out of the tab order entirely — `visibility: hidden`, not
      just off-canvas.) Nothing is reached twice, nothing is skipped, and
      focus never jumps backwards.
- [ ] Tab **out** of the last navbar control reaches the footer links and then
      leaves the page. Focus is never trapped in the navbar.
- [ ] Every one of those stops has a **visible focus ring** in both themes,
      including the range thumb and the `<select>`.
- [ ] The drawer's edge tab is reachable and its ring is visible where the
      drawer meets the map — in both drawer states (the closed tab hugs the
      window edge).

### Controls

- [ ] The year slider moves with ← / → and Home / End, the `<output>` under the
      thumb tracks every step, and the map recolours.
- [ ] Holding ← from 2016 down past 2015 swaps the boundaries **once**, not six
      times: one "Switching to pre-2015 county boundaries…" pill, then it
      clears.
- [ ] The pasture-type `<select>` opens and commits with the keyboard alone.
- [ ] Start / End / Duration are reachable with Tab and activate with Space and
      Enter; `aria-pressed` follows, and the legend body swaps with it.

### The `/` shortcut and its opt-out

- [ ] `/` from anywhere on the page focuses the county search — opening the
      controls drawer first if it is closed, at any size, so the shortcut
      never focuses an invisible field.
- [ ] `/` typed **inside** the search field types a slash — the shortcut stands
      down inside a text input.
- [ ] With `?kbd=off`, `/` does nothing anywhere (WCAG 2.1.4).
- [ ] `?kbd=off` survives an interaction: move the year slider and confirm
      `kbd=off` is still in the address bar afterwards.
- [ ] The **Share** button's copied URL **drops** `kbd` — it is the sharer's
      input preference, not part of the view.

### Escape layering

- [ ] With a county card open, type into the search until the dropdown shows
      options. The **first** Escape closes the dropdown only; the card is still
      there. The **second** closes the card. One Escape never closes both.
- [ ] Escape with the card open and the dropdown shut closes the card and
      returns focus to whatever opened it (the search input, or the map).
- [ ] Escape while the help or table dialog is open closes **only** the dialog.
      The card underneath survives.
- [ ] On desktop, Escape never closes the drawer — it is a fixture there, not
      a layer. (The compact overlay drawer *is* a layer; see manual pass 2.)

### Modal focus

- [ ] Opening help (`?`) moves focus into the dialog.
- [ ] Tab cycles **inside** the dialog and never reaches the navbar behind it.
- [ ] Escape and the × both return focus to the `?` button that opened it.
- [ ] The same three, for the data-table dialog and its own opener.
- [ ] Inside the table dialog, Tab reaches the scrolling table body itself
      (it is `tabindex="0"`, `role="region"`), and the arrow keys scroll it.

---

## Manual pass 2 — 375 px phone

Use a real device or a device-emulation mode with **touch** enabled — a 375 px
desktop window still reports a fine pointer, and every touch-sizing rule the
kit ships behind `@media (hover: none)` stays inert in it.

- [ ] **No horizontal scroll** anywhere: at boot, with the card open, and with
      the drawer overlay open.
- [ ] **The drawer boots closed** and the navbar shows the ☰ button. Tapping ☰
      slides the drawer over the map with a scrim behind it; the scrim dims
      the map (and an open sheet) but never the navbar. Scrim tap, Escape, and
      ☰ again all close it — and with the sheet open underneath, the first
      Escape closes only the drawer, the second the sheet.
- [ ] Every control is at least 40 × 40 (44 × 44 for the card and modal ×) —
      measured **with the drawer open**, since that is where the year slider,
      type select, colour-by buttons and search now live.
- [ ] **The county card docks as a bottom sheet**: flush to the bottom edge,
      rounded on top only, no more than 45 dvh tall, with the map still the
      larger half of the screen.
- [ ] The card's × can be **tapped**.
- [ ] With the sheet open, the bottom-right MapLibre controls and any toast lift
      clear of it — they read `--sheet-h`, which JS stamps at the sheet's real
      height.
- [ ] Closing the sheet drops `--sheet-h` back to 0 and the controls return.
- [ ] Pinch-zoom **on the map** zooms the map and does not scroll the page.
- [ ] A vertical drag **outside** the map (navbar, footer, inside the card body)
      scrolls that surface, not the map.
- [ ] Search lives in the drawer: tapping ☰ and then the field focuses it, and
      picking a result closes the drawer so the map (and the sheet) are what
      the user sees next.
- [ ] Export and Share have shed their text labels but keep their accessible
      names (VoiceOver / TalkBack announces "Export map as PNG", "Copy a link to
      this view").
- [ ] The funder acknowledgement in the footer is visually clipped but still
      read by a screen reader.
- [ ] On a notched device, nothing sits under the notch or the home indicator:
      the sheet, the drawer and the footer all respect `env(safe-area-inset-*)`.
      (`viewport-fit=cover` is set in `index.html`; without it every safe-area
      padding silently resolves to 0.)

---

## Manual pass 3 — the features, in a real browser

These are the ones a headless assertion can prove *ran* but not that they are
*right*.

### County boundaries — the whole point of the tiled path

Automation proves the right tileset was fetched and the right number of
counties painted. It cannot prove the boundary is where the archive says it is,
or that it is smooth, and both are the reason this work happened.

- [ ] **Lossless at high zoom.** Pick a county with a complicated shoreline —
      Plaquemines, LA or Dorchester, MD — and zoom to the ceiling (19; the map
      will not go further, by design). The boundary must read as a *coastline*,
      not as a chain of straight segments. The old TopoJSON was simplified and
      visibly faceted here.
- [ ] **The authorities really differ.** On **1 · Drought monitor**, zoom to
      that same coast at z14–15 and switch **Dataset** between *Census
      counties* and *FSA LFP boundaries*. Those two name exactly the same 3,221
      counties, so nothing should move except the boundary itself — the LFP set
      is unclipped and not edge-matched, so it will run out into the water where
      the Census set stops at the shoreline. **The camera must not move.**
- [ ] **The annual vintage moves, and Connecticut proves it.** On *Census
      counties*, drag the year across 2022 → 2023. Connecticut must change from
      eight counties to **nine planning regions**. Then 2010 → 2011, which
      crosses from the 2009 vintage to the 2010 one. The map must not flash,
      tear, or leave a stale colour behind, and the transient pill must name the
      county set it is switching to.
- [ ] **A county with no polygon still reads honestly.** On *NDMC reported*,
      Connecticut is uncoloured — nine planning regions with nowhere to draw
      them. The summary beneath the map must say so in words, and the county
      card for a Connecticut county must name the authority that is missing it.

### Month wheel

- [ ] In **Start** and in **End**, the legend is the month wheel and the ramp's
      seam — **July 1** — sits at 12 o'clock: July's wedge *begins* at the top
      and runs clockwise, June's ends there. Because labels sit at wedge
      midpoints, you should read `Jun` just left of top and `Jul` just right of
      it, never a single month centred on 12 o'clock.
      (`wheelAngle(JUL1_INDEX)` is exactly −π/2; the label ring must agree with
      the colour ring.)
- [ ] Month labels run clockwise Jul → Aug → … → Jun and none collides with its
      neighbour.
- [ ] In **Duration** the wheel is gone and the colourbar is there instead, with
      its 0 / 26 / 52 wk ticks and the outlined "no reported grazing period"
      chip.
- [ ] The text key under the legend changes with the variable and says the
      scale **wraps** in the two cyclic modes.

### Card chart vs tooltip — the cross-calendar case

Open `?county=28001&type=annual-ryegrass&year=2012` (Adams County,
Mississippi — a winter forage whose 2012 program year runs **Dec 1, 2011 →
May 31, 2012**, 26 weeks).

- [ ] The card readout says `Dec 1, 2011` / `May 31, 2012` / `26 weeks`.
- [ ] Hovering that county on the map shows a tooltip with the **same** number
      as the card for the active variable — start date in Start mode, end date
      in End mode, `26 weeks` in Duration.
- [ ] The span chart's y axis carries a **`Dec⁻¹`** gridline, and the 2012 bar
      starts **above** the `Jan` line. A chart that draws this bar starting in
      December *of 2012* is reading `start_yday` instead of the program-day
      offset.
- [ ] The 2012 bar is the accented one, and it is called out by **outline as
      well as fill** — not colour alone.
- [ ] Years FSA reported nothing are `×` marks on the baseline, not gaps that
      read as zero.

### `<details>` survives a year drag

- [ ] With the card open, expand **Show all years as a table**, then drag the
      year slider across several years. The table stays **open** the whole way,
      and focus is not yanked out of the `<summary>`.
- [ ] The table's rows update with the pasture type but its open/closed state
      does not reset.

### Data table

- [ ] Open the table dialog and scroll: the header row **stays put** at the top
      of the scrolling body.
- [ ] The subtitle line names the pasture type and the year, and the count
      matches the number of rows.
- [ ] Leading zeros are intact in the FSA code column — `01001`, never `1001`.

### PNG export

Run in **both** themes, from the button and from `?export=`.

- [ ] The poster carries the title, the `type · year · variable` subtitle, and
      the credit line with the DOI.
- [ ] The map in the poster is the composite (CONUS + AK + HI + PR), coloured
      the same as the screen.
- [ ] The legend band is drawn: the **wheel** in Start/End (with the same
      Jul-at-top geometry as the DOM wheel) and the **bar** in Duration, each
      with the outlined no-data chip.
- [ ] Every glyph is **Roboto** — not a system sans. A canvas does not wait for
      a webfont the way the DOM does, and the failure is silent.
- [ ] In high contrast the poster's own ground, text and borders follow the
      theme; the data colours do **not** change (they are data, not chrome).
- [ ] The filename is `fsa-ngp_<year>_<type-slug>_<variable>.png`.
- [ ] `?export=…` **does not rewrite the stored theme**: set high contrast, load
      `?export=light`, then open the plain URL in a new tab — it must still come
      up high contrast. (Asserted in `verify.mjs` too; worth an eyeball because
      the failure is permanent for the visitor.)

---

## Known defects

*(none currently open)*

## Resolved defects

### NGP-1 — the county card was not a bottom sheet at ≤ 640 px, and its close button could not be tapped

**Status: resolved.** First fixed by scoping the desktop inset override to
`@media (min-width: 641px) and (min-height: 561px)`; then made moot when the
drawer restructure removed the app-side inset entirely — the kit's
`.sfsa-card.dock-right` (desktop) and compact bottom-sheet rules now own the
card's placement, and `tools/verify.mjs` asserts both geometries. Kept as a
record of the failure mode: an app-side **ID** rule outside a media query
silently outranks the kit's class-level responsive overrides.

**Where** `css/app.css` §6, the `#county-card` rule (`top: .75rem;
right: .75rem; max-height: min(70dvh, 640px, 100% - 1.5rem)`).

**Why** That rule is an **ID** selector outside any media query, so it outranks
the kit's compact override (`@media (max-width: 640px), (max-height: 560px) {
.sfsa-card { top: auto; left: 0; right: 0; bottom: 0; max-height: 45dvh } }`),
which is a **class**. `top` and `max-height` therefore keep their desktop
values on a phone while `left: 0` and `bottom: 0` still apply, and the card
lands anchored to the **top** of the viewport instead of docked to the bottom.

**Symptom at 375 × 720** The card occupies y 12 → 516 of a 720 px viewport. The
navbar is 169 px tall and paints over it, so the card's whole head — the county
name, the FSA code, and the × — is buried. `document.elementFromPoint()` at the
× returns `header.sfsa-navbar`. Escape still closes the card, so a keyboard user
escapes and a touch user does not. `--sheet-h` is stamped at 504 px on top of
that, which lifts the legend panel and any toast up behind the navbar too.

**Repro** `python3 -m http.server 8000 -d <workspace>`, then at a 375 × 720
touch viewport open
`http://localhost:8000/lfp-explorer/?county=30063` and try to tap
the ×.

**Caught by** `tools/verify.mjs` → "Compact 375×720 (touch)", two assertions.
Not caught by axe (occlusion is not an axe rule) and not by Lighthouse.

**Severity** High — it is the only close route a touch user has.
