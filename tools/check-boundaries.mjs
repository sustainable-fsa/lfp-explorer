#!/usr/bin/env node
/* ============================================================================
   LFP Explorer · tools/check-boundaries.mjs
   The county-authority contract: does js/boundaries.js resolve a program year
   to the tileset the DATA says it should?

     node tools/check-boundaries.mjs

   No browser, no kit, no playwright. Node plus fetch.

   ── Why this is a separate gate from verify.mjs ─────────────────────────────
   verify.mjs drives the app: it proves the map painted, the ring drew, the card
   filled. It cannot prove the thing this file proves, which is that the
   POLICY is right — that program year 2011 belongs on the 2010 Census vintage
   and not the 2011 one. A map drawn on the wrong vintage looks perfect. Every
   county has a colour, every shape is a real county, nothing is missing, and
   the boundaries are simply from the wrong year. There is no pixel to inspect.

   So this gate asks the only authority that can answer: the published data.
   `usdm-counties.json` marks a county absent from a week's boundary vintage
   with a '.' sentinel, which makes its county set for any year OBSERVABLE — and
   that set has to be exactly the resolved tileset's set, modulo the territories
   the tilesets drop. Across 27 years that is a one-off-by-one detector no
   amount of reading the R source can replace.

   It also has to be a set comparison, not a count. census-counties-2014 and
   census-counties-2015 both hold 3,220 counties and are DIFFERENT SETS, so a
   resolver off by one year between them would pass any check that counted.

   ── The kit import is stubbed, and only the kit import ─────────────────────
   js/boundaries.js imports three names from the kit by full pinned https URL,
   which node's ESM loader cannot fetch. Rather than restate the module's logic
   here — which would test a copy and not the shipping code — the file is copied
   to a temp sibling with that ONE import line rewritten to a local stub, and
   everything else runs verbatim. `vintageForYear` is the kit's real four-line
   rule and `TILE_BASE` is a string; stubbing them costs nothing and stubbing
   `loadCountyIndex` is irrelevant, because this gate does its own fetching.
   ========================================================================== */
import { readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(HERE, '..'));

const USDM_COUNTIES = 'https://data.sustainable-fsa.com/usdm-counties/usdm-counties.json';

/* The six state FIPS `data-tiles` filters out: dummy-Albers places only CONUS,
   Alaska, Hawaii and Puerto Rico, so American Samoa (60), Guam (66), the
   Northern Marianas (69) and the US Virgin Islands (78) have nowhere to go.
   They are DATA WITH NO POLYGON, which the app reports rather than hides. */
const DROPPED_STATES = new Set(['60', '66', '69', '78', '14', '52']);

let pass = 0;
const failures = [];
function check(what, ok, detail = '') {
  if (ok) { pass += 1; console.log('  ok   ' + what); }
  else { failures.push(what + (detail ? ' — ' + detail : '')); console.log('  FAIL ' + what + (detail ? ' — ' + detail : '')); }
}

/* ── Load the shipping module, with only its kit import stubbed ──────────── */
const STUB = join(ROOT, 'js', '__boundaries-gate-stub.mjs');
const COPY = join(ROOT, 'js', '__boundaries-gate.mjs');
let boundaries;
try {
  await writeFile(STUB, `
export const TILE_BASE = 'https://data.sustainable-fsa.com/data-tiles/tiles/';
export const VINTAGE_SWITCH_YEAR = 2015;
// The kit's own rule, verbatim (county/county.js § Vintage).
export function vintageForYear(year) {
  if (year === 'dd17' || year === 'dd22') return year;
  const y = (typeof year === 'number') ? year : Number(String(year).trim());
  return y < VINTAGE_SWITCH_YEAR ? 'dd17' : 'dd22';
}
export async function loadCountyIndex() {
  throw new Error('this gate does its own fetching');
}
`);
  const src = await readFile(join(ROOT, 'js', 'boundaries.js'), 'utf8');
  // BOTH FORMS of the kit import: the pinned production URL, and the
  // root-absolute path the dev-ward sweep leaves behind (README § Developing
  // against an unreleased kit). This gate is the one that can run in either
  // state — it stubs the kit rather than fetching it — and a regex that only
  // knew the pinned form made it the one gate a kit-development branch could
  // not run, which is exactly when the vintage resolvers are being edited.
  const stubbed = src.replace(
    /import \{[^}]*\} from '(?:https:\/\/sustainable-fsa\.com\/style\/[^']*|\/style)\/county\/county\.js';/,
    "import { TILE_BASE, loadCountyIndex, vintageForYear } from './__boundaries-gate-stub.mjs';");
  if (stubbed === src) {
    throw new Error('the kit import line in js/boundaries.js did not match the '
      + 'pattern this gate rewrites — update the regex above, do not delete the check');
  }
  await writeFile(COPY, stubbed);
  boundaries = await import('file://' + COPY);

  /* ── 1. The catalogue ──────────────────────────────────────────────────── */
  const { AUTHORITIES, AUTHORITY_IDS, CENSUS_VINTAGES, TILE_BASE,
    boundaryRef, censusVintageFor, fsaVintageFor, needsCrosswalk } = boundaries;

  check('three authorities are declared, and only three',
    AUTHORITY_IDS.length === 3 && AUTHORITY_IDS.every((k) => AUTHORITIES[k]),
    AUTHORITY_IDS.join(', '));
  check('their key spaces are the two the app joins in',
    AUTHORITIES.fsa.keySpace === 'fsa' && AUTHORITIES['fsa-lfp'].keySpace === 'fips'
    && AUTHORITIES.census.keySpace === 'fips');
  check('CENSUS_VINTAGES is ascending, gapped at 2001-2008, and ends at 2025',
    CENSUS_VINTAGES.every((v, i) => i === 0 || v > CENSUS_VINTAGES[i - 1])
    && !CENSUS_VINTAGES.includes(2004) && CENSUS_VINTAGES.includes(2000)
    && CENSUS_VINTAGES[CENSUS_VINTAGES.length - 1] === 2025,
    JSON.stringify(CENSUS_VINTAGES));
  check('an unknown authority throws rather than defaulting to one',
    (() => { try { boundaryRef('nope', 2020); return false; } catch { return true; } })());

  /* ── 2. The two axes are independent ───────────────────────────────────── */
  check('the FSA axis flips at 2015 and nowhere else',
    fsaVintageFor(2014) === 'dd17' && fsaVintageFor(2015) === 'dd22'
    && fsaVintageFor(2008) === 'dd17' && fsaVintageFor(2026) === 'dd22');
  const CENSUS_TABLE = [
    [2000, 2000], [2001, 2000], [2009, 2000], [2010, 2009], [2011, 2010],
    [2012, 2011], [2013, 2012], [2014, 2013], [2015, 2014], [2016, 2015],
    [2020, 2019], [2021, 2020], [2022, 2021], [2023, 2022], [2025, 2024],
    [2026, 2025],
  ];
  const wrong = CENSUS_TABLE.filter(([y, want]) => censusVintageFor(y) !== want);
  check('the Census axis resolves every named boundary year correctly '
    + '(2010→2009 across the gap, 2023→2022 where Connecticut changes shape)',
    wrong.length === 0,
    wrong.map(([y, w]) => `${y} wanted ${w} got ${censusVintageFor(y)}`).join('; '));
  check('the two axes really are independent: a Census-authority year still has '
    + 'an FSA vintage, and they disagree',
    boundaryRef('census', 2011).key === 'census-counties-2010'
    && fsaVintageFor(2011) === 'dd17');

  /* ── 3. The crosswalk rule ─────────────────────────────────────────────── */
  const fsaRef = boundaryRef('fsa', 2020);
  const censusRef = boundaryRef('census', 2020);
  const lfpRef = boundaryRef('fsa-lfp', 2020);
  check('a crosswalk is needed exactly when the key spaces differ',
    needsCrosswalk('fsa', fsaRef) === false
    && needsCrosswalk('fips', censusRef) === false
    && needsCrosswalk('fips', lfpRef) === false
    && needsCrosswalk('fips', fsaRef) === true
    && needsCrosswalk('fsa', censusRef) === true);
  check('refs are frozen and interned, so the app can diff them by key',
    Object.isFrozen(fsaRef) && boundaryRef('fsa', 2020) === fsaRef
    && boundaryRef('fsa', 2019) === fsaRef);
  check('a ref names its tileset, its sidecar URL and its own vintage label',
    fsaRef.key === 'fsa-counties-dd22' && fsaRef.vintage === 'dd22'
    && fsaRef.indexUrl === TILE_BASE + 'fsa-counties-dd22-index.json'
    && lfpRef.vintage === null && censusRef.vintage === '2019',
    JSON.stringify({ fsa: fsaRef.key, census: censusRef.key, lfp: lfpRef.key }));

  /* ── 4. Every tileset the app can name is really published, and valid ──── */
  const keys = new Set();
  for (let y = 2000; y <= 2026; y++) {
    for (const id of AUTHORITY_IDS) keys.add(boundaryRef(id, y).key);
  }
  const sidecars = new Map();
  const bad = [];
  await Promise.all([...keys].map(async (key) => {
    const res = await fetch(TILE_BASE + key + '-index.json');
    if (!res.ok) { bad.push(`${key}: HTTP ${res.status}`); return; }
    const j = await res.json();
    sidecars.set(key, j);
    const arrays = ['counties', 'county_names', 'state_names', 'x0', 'y0', 'x1', 'y1'];
    if (j.schema !== 'sfsa-county-index/1') bad.push(`${key}: schema ${j.schema}`);
    if (j.space !== 'sfsa-albers-usa/1') bad.push(`${key}: space ${j.space}`);
    if (arrays.some((a) => !Array.isArray(j[a]) || j[a].length !== j.n)) bad.push(`${key}: ragged arrays`);
    if (!j.counties.every((c) => typeof c === 'string' && /^[0-9]{5}$/.test(c))) bad.push(`${key}: bad ids`);
    if (new Set(j.counties).size !== j.n) bad.push(`${key}: duplicate ids`);
    if (j.tiles.url !== key + '.pmtiles') bad.push(`${key}: tiles.url ${j.tiles.url}`);
  }));
  check(`every tileset the app can name is published and schema-valid (${keys.size} of them)`,
    bad.length === 0, bad.slice(0, 4).join(' | '));

  /* ── 5. THE ONE THAT MATTERS: the data agrees with the resolver ────────── */
  const res = await fetch(USDM_COUNTIES);
  if (!res.ok) throw new Error(`usdm-counties.json: HTTP ${res.status}`);
  const payload = await res.json();
  const week0 = new Date(payload.week0 + 'T00:00:00Z');
  const yearOfWeek = (i) => new Date(week0.getTime() + i * 7 * 86400000).getUTCFullYear();
  const firstWeekOf = new Map();
  for (let i = 0; i < payload.weeks; i += 1) {
    const y = yearOfWeek(i);
    if (!firstWeekOf.has(y)) firstWeekOf.set(y, i);
  }

  const mismatches = [];
  let yearsChecked = 0;
  for (const [year, wi] of [...firstWeekOf].sort((a, b) => a[0] - b[0])) {
    const ref = boundaryRef('census', year);
    const tile = new Set(sidecars.get(ref.key).counties);
    const present = new Set();
    const droppedByTiles = new Set();
    payload.counties.forEach((id, j) => {
      if (payload.series[j][wi] === '.') return;
      if (DROPPED_STATES.has(id.slice(0, 2))) { droppedByTiles.add(id); return; }
      present.add(id);
    });
    const dataOnly = [...present].filter((id) => !tile.has(id));
    const tileOnly = [...tile].filter((id) => !present.has(id));
    yearsChecked += 1;
    if (dataOnly.length || tileOnly.length) {
      mismatches.push(`${year}→${ref.key}: ${dataOnly.length} data-only, `
        + `${tileOnly.length} polygon-only`);
    }
  }
  check(`the Census resolver agrees with the published data for all ${yearsChecked} `
    + 'years: the counties reporting in year Y are EXACTLY the resolved '
    + 'vintage\'s county set (territories aside)',
    mismatches.length === 0, mismatches.slice(0, 5).join(' | '));

  /* ── 6. Connecticut, because it is the sharpest case ───────────────────── */
  const ct2022 = new Set(sidecars.get(boundaryRef('census', 2022).key).counties);
  const ct2023 = new Set(sidecars.get(boundaryRef('census', 2023).key).counties);
  check('Connecticut changes shape at program year 2023: eight traditional '
    + 'counties before, nine planning regions after',
    ct2022.has('09001') && !ct2022.has('09110')
    && !ct2023.has('09001') && ct2023.has('09110'),
    `2022 has 09001=${ct2022.has('09001')} 09110=${ct2022.has('09110')}; `
    + `2023 has 09001=${ct2023.has('09001')} 09110=${ct2023.has('09110')}`);

  /* ── 7. The identity joins really are identities ───────────────────────── */
  const lfpSet = new Set(sidecars.get('fsa-lfp-counties').counties);
  const c2020 = new Set(sidecars.get('census-counties-2020').counties);
  check('fsa-lfp-counties and census-counties-2020 are the SAME id set with '
    + 'different geometry — the app\'s sharpest high-zoom comparison',
    lfpSet.size === c2020.size && [...lfpSet].every((id) => c2020.has(id)),
    `${lfpSet.size} vs ${c2020.size}`);

  for (const [name, url, ref, wantUnmatched] of [
    ['usdm-counties-fsa-lfp', 'https://data.sustainable-fsa.com/usdm-counties-fsa-lfp/usdm-counties-fsa-lfp.json', 'fsa-lfp-counties', 0],
    ['usdm-counties-reported', 'https://data.sustainable-fsa.com/usdm-counties-reported/usdm-counties-reported.json', 'fsa-lfp-counties', 9],
  ]) {
    const r = await fetch(url);
    const p = await r.json();
    const tile = new Set(sidecars.get(ref).counties);
    const unmatched = p.counties.filter((id) => !tile.has(id));
    check(`${name} on ${ref}: exactly ${wantUnmatched} of its `
      + `${p.counties.length} keys reach no polygon`,
      unmatched.length === wantUnmatched,
      `${unmatched.length} unmatched: ${unmatched.slice(0, 10).join(', ')}`);
  }

  /* ── 8. EVERY DATASET, AGAINST THE AUTHORITY IT DECLARES ─────────────────
     The contract assertion. The nine rows of the authority table are not a
     comment in a plan document — they are `boundary:` declarations in
     js/interfaces/*.js, and this reads them out of the source and checks each
     one against the payload it names and the tileset it resolves to.

     Read by regex rather than by import because the descriptors import the kit
     by full https URL, which node's loader cannot fetch. A regex over source is
     a blunt instrument, but the thing it has to catch is blunt too: a dataset
     that declares no authority at all, or declares one the catalogue does not
     have. verify.mjs walks the real INTERFACES registry in-page for the rest. */
  const declared = [];
  for (const rel of ['usdm', 'ngp', 'eligibility', 'disasters']) {
    const src = await readFile(join(ROOT, 'js', 'interfaces', rel + '.js'), 'utf8');
    // Each dataset entry: an id, a url, a keySpace and (now) a boundary. Taken
    // in source order within one Object.freeze({...}) block.
    const blocks = src.split(/Object\.freeze\(\{/).slice(1);
    for (const b of blocks) {
      const id = /\bid:\s*'([^']+)'/.exec(b);
      const url = /\burl:\s*'([^']+)'/.exec(b);
      const keySpace = /\bkeySpace:\s*'([^']+)'/.exec(b);
      const boundary = /\bboundary:\s*'([^']+)'/.exec(b);
      if (!id || !url || !keySpace) continue;      // not a dataset entry
      declared.push({
        view: rel, id: id[1], url: url[1], keySpace: keySpace[1],
        boundary: boundary ? boundary[1] : null,
      });
    }
  }

  check('every dataset in every interface declares a county authority',
    declared.length === 9 && declared.every((d) => d.boundary),
    declared.filter((d) => !d.boundary).map((d) => d.view + '/' + d.id).join(', ')
      || `found ${declared.length} datasets, expected 9`);
  check('and every declared authority is one the catalogue has',
    declared.every((d) => AUTHORITY_IDS.includes(d.boundary)),
    declared.filter((d) => !AUTHORITY_IDS.includes(d.boundary))
      .map((d) => d.view + '/' + d.id + '→' + d.boundary).join(', '));

  const MAPPING = {
    'usdm/census': 'census', 'usdm/reported': 'fsa-lfp', 'usdm/fsa-lfp': 'fsa-lfp',
    'ngp/fsa': 'fsa', 'ngp/nclimgrid': 'fsa',
    'eligibility/official': 'fsa', 'eligibility/web': 'fsa', 'eligibility/derived': 'fsa',
    'disasters/fsa-disasters': 'fsa',
  };
  const off = declared.filter((d) => MAPPING[d.view + '/' + d.id] !== d.boundary);
  check('the declared mapping is the one the owner approved, row for row',
    off.length === 0 && declared.length === Object.keys(MAPPING).length,
    off.map((d) => `${d.view}/${d.id} declares ${d.boundary}, expected `
      + MAPPING[d.view + '/' + d.id]).join('; '));

  /* And the join each declaration implies, measured against the real payload.
     A dataset whose keySpace matches its authority's must join by identity; one
     that does not must be crosswalked, and this gate does not re-implement the
     crosswalk — it only asserts which of the two situations each row is in. */
  const DEFAULT_YEAR = 2024;
  const joins = [];
  for (const d of declared) {
    const ref = boundaryRef(d.boundary, DEFAULT_YEAR);
    const crosswalked = needsCrosswalk(d.keySpace, ref);
    let unmatched = null;
    if (!crosswalked) {
      // Identity join: the payload's own keys must be this tileset's ids.
      const raw = await readFile(join(ROOT, '..', d.url.replace(/^\.\.\//, '')), 'utf8');
      const payload = JSON.parse(raw);
      const ids = payload.counties;
      if (Array.isArray(ids)) {
        const tile = new Set(sidecars.get(ref.key).counties);
        unmatched = ids.filter((id) => !tile.has(id)).length;
      }
    }
    joins.push({ row: d.view + '/' + d.id, key: ref.key, crosswalked, unmatched });
  }

  /* MEASURED, and frozen as a regression baseline rather than asserted to be
     zero — because zero is the wrong expectation and believing it would have
     hidden the interesting part.

     An identity join means the payload's keys and the tileset's ids are the
     same KIND of thing. It does not mean every key has a polygon: these
     archives span nineteen program years and their county DICTIONARIES are the
     union over everything they ever reported, so a retired FSA office or a
     county that only exists in another vintage is legitimately keyed and
     legitimately undrawable. The app has always reported those out loud rather
     than hiding them (handle.recolor()'s unmatched return), and these numbers
     are what it reports.

     What each is, checked id by id:
       ngp/fsa               8   all dropped territories (14, 52, 60, 69)
       eligibility/official 11   3 dropped territories + 8 retired FSA offices
       eligibility/web      14   the same, plus 3 more offices the weekly
                                 snapshots reached that the FOIA record did not
       eligibility/derived   0   a clean identity against dd22
       usdm/fsa-lfp          0   THE headline: an exact identity, 3,221 = 3,221
       usdm/reported         9   Connecticut's nine planning regions

     usdm/census is deliberately absent from this table. Its dictionary is the
     union over EIGHTEEN vintages (3,251 ids), so measuring it against any one
     of them is meaningless — against census-counties-2023 it reports 29
     unmatched, of which eight are Connecticut's TRADITIONAL counties, which
     that vintage correctly does not have. The per-year '.'-sentinel check in
     section 5 is the real gate for it, and it is exact. */
  const EXPECTED_UNDRAWABLE = {
    'usdm/fsa-lfp': 0,
    'usdm/reported': 9,
    'ngp/fsa': 8,
    'eligibility/official': 11,
    'eligibility/web': 14,
    'eligibility/derived': 0,
  };
  const badJoin = joins.filter((j) => {
    if (j.crosswalked) return false;                 // not this gate's business
    if (!(j.row in EXPECTED_UNDRAWABLE)) return j.row !== 'usdm/census';
    return j.unmatched !== EXPECTED_UNDRAWABLE[j.row];
  });
  check('every identity join reports exactly the keys with no polygon that it '
    + 'should — no more (a broken join) and no fewer (a swallowed miss)',
    badJoin.length === 0,
    badJoin.map((j) => `${j.row} on ${j.key}: ${j.unmatched} undrawable, expected `
      + EXPECTED_UNDRAWABLE[j.row]).join('; '));

  const wantCrosswalked = new Set(['ngp/nclimgrid', 'disasters/fsa-disasters']);
  const cw = new Set(joins.filter((j) => j.crosswalked).map((j) => j.row));
  check('exactly two datasets still need the crosswalk — the two FIPS-keyed '
    + 'payloads with no boundary archive of their own',
    cw.size === wantCrosswalked.size && [...wantCrosswalked].every((r) => cw.has(r)),
    [...cw].join(', '));

  /* ── 9. THE USDM WEEKLY POLYGONS ─────────────────────────────────────────
     The other geometry the app draws, and the only one that is not a county
     set: the Drought Monitor's OWN weekly map, published as one TopoJSON per
     Tuesday beside the county tilesets.

     It belongs in this gate rather than in verify.mjs for the same reason
     everything above does — it is a claim about the PUBLISHED DATA, and the
     browser cannot make it. verify.mjs proves the overlay draws the week the
     scrubber says; nothing it can see would notice the producer renaming the
     object key, dropping a Tuesday out of the middle of the grid, or shipping a
     class code the paint expression has no branch for. Each of those draws a
     perfectly convincing map: an unmatched `usdm_class` falls through the
     `match` to transparent, so a sixth class would simply not be there, and a
     missing week resolves to a URL that 404s behind a marker most readers never
     look at.

     THE WHOLE THING IS DRIVEN OFF THE SIDECAR'S OWN FIELDS, never off a
     filename this file composed: `url` is a bare `{date}` template resolved
     RELATIVE to the sidecar's directory, which is what lets the producer rename
     or content-hash without a consumer change. Composing an archive filename
     from a key is exactly the mistake the county tiles' `tiles.url` rule exists
     to prevent, and it would be the same mistake here.

     The NEWEST date is the one fetched, deliberately: it is the file that has
     never been read before, and the only one whose shape a producer change can
     have broken since the last run. */
  const USDM_INDEX = 'https://data.sustainable-fsa.com/data-tiles/usdm/usdm-index.json';
  {
    const ir = await fetch(USDM_INDEX);
    const ix = ir.ok ? await ir.json() : null;
    check('the USDM weekly index is published, and declares the schema, space, '
      + 'object key and {date} template js/usdm-overlay.js reads it by',
      !!ix && ix.schema === 'sfsa-usdm-index/1'
      && ix.space === 'sfsa-albers-usa/1' && ix.object === 'usdm'
      && typeof ix.url === 'string' && ix.url.includes('{date}')
      && Array.isArray(ix.dates) && ix.dates.length > 0,
      ix ? JSON.stringify({ schema: ix.schema, space: ix.space, object: ix.object,
        url: ix.url, dates: Array.isArray(ix.dates) ? ix.dates.length : null })
        : `HTTP ${ir.status}`);

    if (ix && Array.isArray(ix.dates) && ix.dates.length) {
      /* The grid itself. A gap is the failure mode with no symptom: `?week=N` is
         1-based WITHIN A YEAR, so a missing Tuesday silently renumbers every
         week after it and a shared link starts meaning a different map. */
      const d = ix.dates;
      const iso = d.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
      const asc = d.every((s, i) => i === 0 || s > d[i - 1]);
      const steps = d.filter((s, i) => i > 0
        && Date.parse(s + 'T00:00:00Z') - Date.parse(d[i - 1] + 'T00:00:00Z')
          !== 7 * 86400000);
      const tuesdays = d.every((s) => new Date(s + 'T00:00:00Z').getUTCDay() === 2);
      check(`the index is a gapless weekly grid: n === dates.length (${ix.n}), `
        + 'strictly ascending ISO dates, every one a Tuesday, every step exactly '
        + 'seven days',
        ix.n === d.length && iso && asc && tuesdays && steps.length === 0,
        JSON.stringify({ n: ix.n, dates: d.length, iso, asc, tuesdays,
          badSteps: steps.slice(0, 3), first: d[0], last: d[d.length - 1] }));

      const newest = d[d.length - 1];
      // ONE STRING, and it is the sidecar's: template in, URL out, resolved
      // against the sidecar's own directory.
      const weekUrl = new URL(ix.url.replace('{date}', newest), USDM_INDEX).href;
      const wr = await fetch(weekUrl);
      const topo = wr.ok ? await wr.json().catch(() => null) : null;
      check(`the newest week resolves through the sidecar's own template and is `
        + `served (${newest})`, wr.ok && !!topo,
        `${weekUrl} — HTTP ${wr.status}${wr.ok && !topo ? ', but did not parse as JSON' : ''}`);

      if (topo) {
        const g = topo.objects && topo.objects.usdm;
        const geoms = (g && Array.isArray(g.geometries)) ? g.geometries : [];
        check('it is a TopoJSON Topology whose one object is `usdm`, and every '
          + 'geometry in it is a MultiPolygon carrying exactly {date, usdm_class} '
          + 'and no id',
          topo.type === 'Topology' && !!g && geoms.length > 0
          && geoms.every((x) => x.type === 'MultiPolygon' && !('id' in x)
            && x.properties && x.properties.date === newest
            && Object.keys(x.properties).sort().join(',') === 'date,usdm_class'),
          JSON.stringify({ type: topo.type, objects: Object.keys(topo.objects || {}),
            geometries: geoms.length,
            types: [...new Set(geoms.map((x) => x.type))],
            props: [...new Set(geoms.flatMap((x) => Object.keys(x.properties || {})))] }));

        /* THE CLASSES ARE THE PAINT. js/usdm-overlay.js matches D0–D4 and falls
           through to transparent, so a sixth code would not draw at all and a
           duplicate would mean the classes overlap — which they do not: the
           producer publishes three to five NON-OVERLAPPING severity bands, never
           indexed by position. */
        const CLASSES = ['D0', 'D1', 'D2', 'D3', 'D4'];
        const seen = geoms.map((x) => x.properties && x.properties.usdm_class);
        check('every geometry\'s usdm_class is one of D0–D4, each appears at most '
          + 'once (the bands are non-overlapping), and there are between three '
          + 'and five of them',
          seen.length >= 3 && seen.length <= 5
          && seen.every((c) => CLASSES.includes(c))
          && new Set(seen).size === seen.length,
          JSON.stringify(seen));
      }
    }
  }

} finally {
  await rm(COPY, { force: true });
  await rm(STUB, { force: true });
}

console.log(`\n${pass} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.log('  · ' + f);
  process.exit(1);
}
