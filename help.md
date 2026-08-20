## What this map shows

**Normal Grazing Periods (NGPs)** define the historical timeframe during which forage is typically available for livestock grazing under non-drought conditions. The USDA Farm Service Agency (FSA) uses them to determine eligibility and payment amounts under the [Livestock Forage Disaster Program (LFP)](https://www.fsa.usda.gov/resources/programs/livestock-forage-disaster-program-lfp): a county qualifies only when drought occurs *during* its normal grazing period for a given pasture type, and the period's length caps the payment. This map draws every period FSA reported from **2008 through 2026** — 244,890 records across 3,095 FSA counties and 16 pasture types — one county polygon per FSA service area, exactly as FSA reports it. For the program rules themselves, see [FSA Handbook 1-LFP, Amendment 4](https://www.fsa.usda.gov/Internet/FSA_File/1lfp_a4.pdf).

**Two datasets, one map.** Alongside FSA's official periods, the **Dataset** control offers the [nClimGrid climatology](https://sustainable-fsa.com/nclimgrid-normal-grazing-period/) — what grazing periods *would be* if the method in FSA Notice NAP-190 were applied to NOAA's 1991–2020 climate normals for every CONUS county. It is a counterfactual for comparison, not FSA's numbers: one set of periods for all years (so the year slider rests while it is shown), three season types (Full, Cool, and Warm Season) instead of FSA's sixteen forage types, and Census county geography rather than FSA service areas (see *Two county keys* below).

**What to show.** The *What to show* section at the top of the controls panel switches between the LFP data families this explorer hosts. Three are here, in the order the program reads them: **1 · Grazing periods**, the window in which a drought can count at all; **2 · Drought monitor**, the weekly drought classes that have to fall inside that window (see *The Drought Monitor* below); and **3 · LFP eligibility**, the determination those two produce — which counties qualified in a program year, and for how many monthly payments (see *LFP eligibility* below). The disaster designations behind the program are the remaining piece, and will appear in the same list as they land. Each family brings its own controls, legend, and county card; what you have selected — the county, the year, the map position, the theme — carries across when you switch.

## Using the map

**The controls panel.** Everything that changes what the map shows — county search, year, pasture type, color by, and the legend — is in one panel down the left side. On a wide screen the panel is open when you arrive and the map fills whatever is left of the window; the slim tab on the panel's right edge collapses it, and the map takes the space back. On a phone, or in a short window, the panel slides in over the map instead: open it with the **menu button** (☰) at the right of the top bar, and close it with that same button, by tapping the dimmed map, or with `Esc`.

**Choose what you see.** The **Dataset** control switches between FSA's official periods and the nClimGrid climatology; each remembers its own pasture-type selection, and where a selection has an obvious counterpart (Native Pasture ↔ Full Season) the map carries it across for you. The **year** slider steps through program years 2008–2026 (it is disabled on the climatology, which describes one normal period rather than individual years). The **pasture type** menu selects one of the 16 forage classifications FSA reports (Native Pasture, Improved Pasture, Long Season Small Grains, and so on), or one of the climatology's three seasons. **Color by** switches the variable painted on the counties: *Season Start*, *Season End*, or *Duration*.

**Read the legend.** The legend is the last section of the controls panel, and it always shows the scale in use. Season Start and Season End are days of the year, so they use a **cyclic month wheel**: a county's color is the position of its date around the calendar, read against the month labels on the ring. The palette wraps, so late December and early January are neighboring hues rather than opposite ends of a scale — which is what you want for dates, since a period beginning December 28 is not a world away from one beginning January 3. Winter forage types routinely start in the calendar year *before* their program year; those dates take their place on the wheel like any other. Duration is not cyclic, so it uses a plain **linear color bar**, dark to light, running 0 to 52 weeks.

**Look up a county.** Click any county, or type a name in the **search box** at the top of the controls panel, to open its detail card — docked against the right edge of the map on a wide screen, and a sheet at the bottom on a phone. The card is not limited to the year on the slider: it charts the county's grazing-period spans for the selected pasture type across all years 2008–2026, so you can see at a glance where the period has shifted, lengthened, or gone unreported, with the underlying dates in a table below.

**The projection.** The map is drawn in CONUS Albers Equal Area (EPSG:5070), with Alaska, Hawaii, and Puerto Rico repositioned as insets — the same equal-area projection every other Sustainable FSA figure uses, so county sizes here are comparable and match the project's printed maps.

**Change the theme.** The navbar toggle switches between the light theme and a high-contrast theme that strengthens outlines and text contrast.

**Share what you are looking at.** The address bar always reflects the current view — year, pasture type, color-by variable, selected county, and whether the controls panel is collapsed — so copying it or bookmarking it reproduces exactly what is on your screen. The **Share** button copies that link for you.

**Save an image.** The **PNG export** button downloads the current map as a branded image, legend and all, suitable for a slide or a report.

**Keyboard.**

| Key | Action |
|-----|--------|
| `Tab` / `Shift`+`Tab` | Move between controls |
| `Arrow` keys | Adjust the focused slider or menu |
| `Enter` / `Space` | Activate the focused control |
| `/` | Jump to the county search box, opening the controls panel first if it is closed |
| `Esc` | Close the open dialog, search list, controls panel, or county card — one layer per press, in that order (the panel only when it is overlaying the map, on a phone or a short window) |

Single-key shortcuts (`/`) can be turned off by adding `?kbd=off` to the map's URL — useful with speech input or other assistive tools that send keystrokes.

## What a blank county means

An uncolored county on the grazing-period view means one of two distinct things
(three, on the climatology). The drought monitor has its own two cases — see
*The Drought Monitor* below — and on the eligibility view a gray county means
one thing only: FSA made no qualifying determination for that county, year, and
pasture type. Not eligible is an answer, and the legend says so in words.

**No polygon.** The island territories are not drawn, because neither FSA boundary archive includes them. Their grazing periods are still in the data and in the downloadable files — they simply have no shape to paint.

**No reported grazing period** for that county, year, and pasture type. FSA did not publish a period for every county in every year. Ten FSA counties have a year missing inside their own span of reporting — 15 county-years in all, mostly 2009–2011, plus Shoshone County, ID in 2016. Every one is listed in [`qa-report.txt`](https://data.sustainable-fsa.com/fsa-normal-grazing-period/qa-report.txt).

**No climatological season**, on the nClimGrid dataset only. The reanalysis derives a season only where the NAP-190 rules define one for that county's climate — not every county has all three seasons, and Alaska, Hawaii, and the territories are outside the CONUS climate grid entirely.

**Which boundaries a year is drawn on.** County boundaries are fetched at run time from the FSA administrative boundary archives, and **the vintage follows the program year**: [`fsa-counties-dd17`](https://data.sustainable-fsa.com/fsa-counties-dd17/) for 2008–2014 and [`fsa-counties-dd22`](https://data.sustainable-fsa.com/fsa-counties-dd22/) for 2015 onward. FSA re-drew eight county footprints between the two handbook digests — Shoshone County, ID was split out of the Benewah and Kootenai offices; Sioux County, NE was consolidated into `31165`; King County, WA into `53033`; and Richmond City, VA was split out of Henrico. Each year is therefore drawn on the boundaries that were in force for it, and the two vintages are never mixed within a year. Drawing an early year on current boundaries would leave the territory of a since-split county blank even though its grazing period was reported, under the office that then administered it.

## The Drought Monitor

**What it is.** The [U.S. Drought Monitor](https://droughtmonitor.unl.edu/) (USDM) is a weekly national drought assessment — one map a week, drawn by a rotating author from dozens of indicators plus local expert input, sorting the country into **None** (normal or wet), **D0** *Abnormally Dry*, **D1** *Moderate*, **D2** *Severe*, **D3** *Extreme*, and **D4** *Exceptional* drought. Each map is valid for the Tuesday it names and published that Thursday. Maps have appeared every week since **January 4, 2000**, and this view holds all of them: 1,389 weeks as of August 2026, one continuous record you can scrub through.

**Why the map paints the worst class.** The drought classes matter to LFP because of one statutory phrase. A county qualifies when the Monitor rates it at the required intensity **in any area of the county** for the required number of consecutive weeks during that county's normal grazing period ([7 U.S.C. § 1531(d)(3)](https://www.law.cornell.edu/uscode/text/7/1531)). There is no minimum area, no county average, and no weighting by acres or animals: a single corner of a county at D4 is a D4 county as far as the program is concerned. So this map colors each county by **the worst drought class touching any part of it that week** — the rule the program applies, not a cartographic simplification of it. Eligibility turns on *runs* of such weeks rather than any single map, which is what the county card's full-record heatmap is for: one row per year, one cell per week, for the county you have selected.

**Pick a week.** On this view the **year** slider covers 2000 to the present and a second **week** slider steps through the weeks inside that year. The readout beneath it names the map's Tuesday and its place in the year — *Jul 24, 2012 · week 30 of 52* — and the **Previous week** and **Next week** buttons step one map at a time, as do the arrow keys when either slider has focus. The week is remembered for as long as your visit lasts, never longer: come back tomorrow and you arrive on the latest map. The address bar carries it as `?week=` (a week number *within* the year), so a shared link reproduces the exact map you were reading.

**Three ways to count a county.** The USDM is drawn without regard to political boundaries, so turning it into county numbers is an act of aggregation — and there is more than one defensible way to do it. The **Dataset** control offers three, all of them the same weekly maps underneath:

- **FSA LFP boundaries** *(the default)* — the county-by-week statistics FSA itself keeps, on FSA's own Livestock Forage Program boundaries, obtained under FOIA request **2025-FSA-08431-F** and archived at [usdm-counties-fsa-lfp](https://sustainable-fsa.com/usdm-counties-fsa-lfp/). These are the numbers the program runs on, and they are keyed to the geography this map draws — which is why they are what you see first.
- **NDMC reported** — NDMC's own published county statistics, retrieved from its [data service](https://droughtmonitor.unl.edu/DmData/DataDownload/WebServiceInfo.aspx) and archived at [usdm-counties-reported](https://sustainable-fsa.com/usdm-counties-reported/). One consequence of using them is visible on the map: NDMC keys Connecticut as its nine **planning regions** (09110–09190) for the entire record, and no FSA county covers those, so Connecticut is uncolored on this dataset. It is counted, not quietly dropped — the announcement under the map says how many reported areas could not be placed on an FSA county.
- **Census counties** — the weekly maps intersected with the Census county boundaries in force for each week, archived at [usdm-counties](https://sustainable-fsa.com/usdm-counties/). This is the only one of the three that is not complete by construction: a county that did not exist in a given week is genuinely absent from that week, which is the clearest illustration of the distinction below.

**Two kinds of uncolored county.** A **pale** county is *drought-free*: the Monitor covered it that week and found no drought anywhere in it (class **None**). A **gray** county is *not in that week's county set*: the dataset holds no row for it, because the county did not exist under that week's boundaries, because the source never carried it, or — on the NDMC-reported set — because its key cannot be matched to an FSA county at all. The first is an answer; the second is a gap. The legend names both, the county card says which one you are looking at in words, and the announcement to screen readers counts them separately.

**How these numbers reach FSA counties.** All three datasets are keyed to Census-style FIPS codes and this map always draws FSA service areas, so all three arrive through the crosswalk described under *Two county keys* below. A Census county's class is copied to every FSA county that covers it, and where one FSA office administers several Census counties the **worst** class among them wins — the same any-area logic, one level up. The county card lists each constituent county's own class, so the reduction never hides a disagreement.

**Credit where it is due.** The U.S. Drought Monitor is jointly produced by the National Drought Mitigation Center at the University of Nebraska-Lincoln, the United States Department of Agriculture, and the National Oceanic and Atmospheric Administration. Map data courtesy of NDMC. Aggregation and map courtesy of the Montana Climate Office. All analytical authorship of the weekly maps belongs to their named USDM authors; the county aggregations archived here are the Montana Climate Office's work, released under CC0, and — apart from FSA's own LFP boundary statistics — they are **not** an FSA product.

## LFP eligibility

**What it is.** This view is the determination itself: for each program year, pasture type, and county, whether a qualifying drought occurred and how many monthly payments it earned. A county qualifies when the Drought Monitor rates it at a qualifying intensity **in any area of the county**, for the required duration, *during* that county's normal grazing period for that pasture type ([7 U.S.C. § 1531(d)(3)](https://www.law.cornell.edu/uscode/text/7/1531)) — which is why the three views read in the order they do: the grazing period is the window, the Monitor supplies the drought, and eligibility is the answer. A drought that deepened through a season satisfies several tiers in turn, and each one is a separate record; the map paints the **best** of a county's records for the year — the one earning the most payment months — while the data table behind the **table** button lists every qualifying event, not only the best.

**The ladder has changed twice.** What a tier earns, and which tiers exist, depends on the program year:

| Monthly payments | 2008–2011 *(2008 Farm Bill)* | 2012–2025 *(2014 Farm Bill)* | 2026 onward *(P.L. 119-21)* |
|---|---|---|---|
| 1 | D2 for 8 consecutive weeks | D2 for 8 consecutive weeks | D2 for 4 consecutive weeks |
| 2 | D3 at any time | — | D2 for 7 of the previous 8 consecutive weeks |
| 3 | D3 for 4+ weeks, or D4 at any time | D3 at any time | D3 at any time |
| 4 | — | D3 for 4+ weeks, or D4 at any time | D3 for 4+ weeks, or D4 at any time |
| 5 | — | D4 for 4+ weeks | D4 for 4+ weeks |

Section 10401(b) of P.L. 119-21 (July 4, 2025) split the D2 tier, amending 7 U.S.C. 9081(c)(3)(D)(ii)(I); the 4-week and 4-*consecutive*-week distinctions are as written, since the D2 tiers require consecutive weeks and the D3 and D4 duration tiers do not. The tier codes these archives use are `D2`, `D3a`, `D3b`, `D4a`, and `D4b`, plus `D2a_2026` and `D2b_2026` in place of `D2` from 2026 — the `a` tiers trigger at any time, the `b` tiers require a duration. The county card names the tier and glosses it in words.

**Drought factor is not the payable amount.** The **drought factor** is what a tier earns under the ladder above. FSA then caps the award at the **Maximum Eligible Payment Months** implied by the length of the grazing period, and the payable figure — FSA's **payment factor** — is the smaller of the two. Ballard County, KY reached D4 for four or more weeks in 2012, a drought factor of 5, but its Native Pasture grazing period is four months long, so the payable figure was **4**. On FSA's own datasets the card shows all three numbers and the map paints the payable one. The derived dataset carries no cap at all (below), so what it shows is the uncapped drought factor, and its legend says so rather than letting it be read as a payment.

**From 2026, compare payment months and not drought factors.** From program year 2026 FSA reports a drought factor of 1 for *both* D2 sub-tiers, carrying the two-payment outcome of the longer window in the payment factor alone. These archives score `D2b_2026` as 2 instead, so any 2026 comparison against FSA's published tables should be made on payment months. The card says so on any year from 2026 on.

**2008–2011 is incomplete, and differently so in each archive.** In FSA's FOIA response for those four program years, 2,839 records carry no qualifying date: the response reported when the drought *began* rather than when a tier was satisfied, and for the duration tiers the satisfaction date cannot be recovered. FSA's weekly web tables for the same years are the mirror image — every one of their 14,064 records carries per-tier dates and no payment information whatsoever. So the first color on the ramp is a **slate** that is deliberately outside the month scale: coloring by payment months it means *eligible, but the record does not say how many*, and coloring by qualifying date it means *eligible on a date the record does not carry*. Neither is the same as not eligible, which stays gray.

**Three datasets.** The **Dataset** control offers three archives of the same question:

- **FSA official (FOIA)** *(the default)* — FSA's own determinations for program years 2008–2025, obtained under FOIA requests **2025-FSA-04690-F**, **2025-FSA-08422-F**, and **2026-FSA-02433-F** and archived at [fsa-lfp-eligibility](https://sustainable-fsa.com/fsa-lfp-eligibility/). This is the richest record for closed program years, and the only one of the three that carries payment months for 2008–2011. The archive also covers fire eligibility; these event records do not, so this view is drought only.
- **FSA weekly web** — the same determinations as FSA publishes them, week by week, on its LFP maps page, archived with every superseded weekly version at [fsa-lfp-eligibility-web](https://sustainable-fsa.com/fsa-lfp-eligibility-web/). It is the only one of the three that covers the **current** program year, and the only one with per-tier dates before 2012. It is last-seen-wins: a determination FSA later withdrew is still shown here.
- **Derived from USDM** — eligibility *recomputed* from the Drought Monitor and FSA's published grazing periods, under four county-aggregation conventions, archived at [fsa-lfp-eligibility-derived](https://sustainable-fsa.com/fsa-lfp-eligibility-derived/). It is **not** a record of FSA's determinations and is not the authority where the two differ; it exists to measure how much the answer depends on choices the statute leaves open. It carries no payment cap.

Because FSA's own determinations end at 2025, choosing that dataset while a later year is selected moves the year slider back to the last year it covers, and says so.

**Four ways to read "any area of the county".** The Monitor is drawn without regard to political boundaries, so it must be cut to county shapes before the rule can be applied — and the statute does not name the boundary file. The derived dataset therefore publishes all four defensible readings and lets you choose: **FSA LFP boundaries** (the default, and the geometry this map draws), **NDMC reported**, **Census 2020** held fixed, and **Census vintage-matched** to each week. They mostly agree — for Native Pasture in 2024 they name 630 counties between them and disagree about six — but where they disagree the gap runs to four monthly payments. Phillips County, AR in 2024 shows the milder version: the same D3 tier, satisfied on November 28, 2023 under the FSA and NDMC boundary conventions and six days later, December 4, under either Census one — the same eligibility, dated differently.

**Two county keys, twice over.** An LFP determination needs both keys: the grazing period is set per **FSA county**, and the drought triggers "in any area of the county" as a **Census county**. Census county Nye, NV (`32023`) is administered as two FSA offices, **Northwest Nye** (`32023`) and **Southeast Nye** (`32035`), each setting its own grazing period. For Native Pasture in 2012, Northwest Nye reached D3 for four or more weeks and earned **4** payment months, while Southeast Nye reached only D2 and earned **1** — from the same drought, over the same Census county. FSA determined it that way, and all four recomputed conventions agree. This map draws FSA offices, so both are painted, and each card names the Census county it sits in.

**Pick what to paint.** **Color by** offers **payment months** on the drought-factor ramp — one month for a brief severe drought up to five for a month of exceptional drought — and the **qualifying date** on the same cyclic month wheel the grazing periods use. The **pasture type** menu offers the fifteen types these determinations use, plus **All types (worst case)**: one map of whether a county was eligible under *anything*, which is a wider map than any single type — in 2024, 1,022 counties were eligible under some pasture type against 626 under Native Pasture.

## About the data

The data are USDA FSA's own, obtained under the Freedom of Information Act by R. Kyle Bocinsky (Montana Climate Office, University of Montana) in three requests: **2025-FSA-04691-F**, **2026-FSA-02435-F**, and **2026-FSA-03465-F**. All three requests and their responses are archived with the data. The published archive is built from two of them — 2025-FSA-04691-F (program years 2008–2025) and 2026-FSA-03465-F (2025–2026); 2026-FSA-02435-F is retained for provenance but contributes no county, program year, or pasture type the other two lack.

**What was changed.** Rows with no start or end date were dropped (about 33,000; no row had one date without the other). Pasture type names and FSA county names were standardized where FSA reported one thing under two spellings, and 371 rows that were then exact repeats were removed — no record differing in its dates is ever merged with another. Four known errors in the source were corrected, each scoped to the county, program year, and pasture type it applies to: start years reported one year early for Native Pasture in Piute and Sevier counties, UT (2010) and for Mississippi Annual Ryegrass (2013); a start year of 2006 in three South Dakota counties (2026); and an end year of 2027 in six West Virginia counties (2026), which described a 19-month period. **What was checked.** The build aborts unless every record is unique by program year, county, and pasture type; every period ends on or after it starts; no published field is missing; and every FSA county resolves against FSA's published county definitions. Softer flags — zero-length periods, gaps in a county's reporting, counties reported under two names — are published rather than silently fixed, in [`qa-report.txt`](https://data.sustainable-fsa.com/fsa-normal-grazing-period/qa-report.txt).

**Get the data.** The archive of record is published as [CSV](https://data.sustainable-fsa.com/fsa-normal-grazing-period/fsa-normal-grazing-period.csv) and [Parquet](https://data.sustainable-fsa.com/fsa-normal-grazing-period/fsa-normal-grazing-period.parquet) with identical records, one row per program year, FSA county, and pasture type. Processing code, FOIA correspondence, and this map's source are in the [GitHub repository](https://github.com/sustainable-fsa/fsa-normal-grazing-period).

**The nClimGrid climatology** is an independent reanalysis by the Montana Climate Office: NOAA's nClimGrid-daily 1991–2020 normals run through the grazing-period rules in FSA Notice NAP-190 (the 28 °F freeze-date rule for full and warm seasons, the 50 °F/90 °F rule for cool season, and DAFP's rounding conventions). The full method, a worked example, and the archive are at [nclimgrid-normal-grazing-period](https://sustainable-fsa.com/nclimgrid-normal-grazing-period/). It is released under CC0 and is **not** an FSA product.

## Two county keys

**FSA county codes are not FIPS codes.** They coincide for most counties, but FSA administers some Census counties as two or three separate service areas and elsewhere administers many Census counties from one — so 20 of the 3,095 FSA counties here carry a code matching no FIPS county they cover, and nine Census counties (Aroostook, ME; Custer, ID; Pottawattamie, IA; Otter Tail, Polk, and St. Louis, MN; Nye, NV; Lucas, OH; Galax, VA) are split across more than one FSA office, each setting its own grazing period. The boundary archives are the authority on the correspondence: [fsa-counties-dd17](https://data.sustainable-fsa.com/fsa-counties-dd17/) for program years 2008–2014, [fsa-counties-dd22](https://data.sustainable-fsa.com/fsa-counties-dd22/) for 2015 onward.

**How Census-keyed data reaches this map.** This map always draws FSA service areas. Datasets keyed to Census counties — the nClimGrid climatology and all three drought-monitor county sets — are joined through a crosswalk extracted from those same boundary archives: a Census county's value is copied to every FSA county that covers it, and where one FSA office administers several Census counties the map shows the longest period among them — the county card then lists each constituent Census county's own dates, so nothing is hidden by the reduction. The crosswalk itself ships with this app as [`assets/fsa-fips-crosswalk.json`](https://sustainable-fsa.com/lfp-explorer/assets/fsa-fips-crosswalk.json).

**The eligibility archives need no crosswalk.** They carry both keys already, because an LFP determination is made against both: the record names the FSA county whose grazing period set the window *and* the Census county whose drought triggered the tier. So the eligibility view paints FSA offices directly and reports the Census county on the card as provenance — and where one Census county is administered as several FSA offices, each office's own determination is drawn, never averaged (see *LFP eligibility* above).

## Citation

If you use this data in published work, please cite:

> USDA Farm Service Agency. *Normal Grazing Periods, 2008–2026*. Obtained under FOIA requests 2025-FSA-04691-F, 2026-FSA-02435-F, and 2026-FSA-03465-F; curated and archived by R. Kyle Bocinsky, Montana Climate Office, University of Montana. Sustainable FSA project. Accessed YYYY-MM-DD. <https://sustainable-fsa.com/fsa-normal-grazing-period/>
>
> DOI: <https://doi.org/10.5281/zenodo.15252842>

For the nClimGrid climatology dataset, cite its own archive: <https://sustainable-fsa.com/nclimgrid-normal-grazing-period/>.

For the drought monitor, cite the U.S. Drought Monitor itself (NDMC, USDA, and NOAA) together with the county aggregation you used: [usdm-counties-fsa-lfp](https://sustainable-fsa.com/usdm-counties-fsa-lfp/), [usdm-counties-reported](https://sustainable-fsa.com/usdm-counties-reported/), or [usdm-counties](https://sustainable-fsa.com/usdm-counties/). Each archive carries its own suggested citation and a machine-readable `CITATION.cff`.

For LFP eligibility, cite the archive you actually read — the three are not interchangeable:

> USDA Farm Service Agency. *Livestock Forage Disaster Program Eligibility, 2008–2025*. Obtained under FOIA requests 2025-FSA-04690-F, 2025-FSA-08422-F, and 2026-FSA-02433-F; curated and archived by R. Kyle Bocinsky, Montana Climate Office, University of Montana. Sustainable FSA project. Accessed YYYY-MM-DD. <https://sustainable-fsa.com/fsa-lfp-eligibility/>
>
> DOI: <https://doi.org/10.5281/zenodo.15491626>

For the weekly published tables, cite [fsa-lfp-eligibility-web](https://sustainable-fsa.com/fsa-lfp-eligibility-web/); for the recomputed eligibility, cite [fsa-lfp-eligibility-derived](https://sustainable-fsa.com/fsa-lfp-eligibility-derived/) and say which aggregation convention you used — and note that it is a reanalysis by the Montana Climate Office, released under CC0, and **not** a record of FSA's determinations. Each archive carries its own suggested citation and `CITATION.cff`.

## License

- **Raw FOIA data** (USDA): Public Domain (17 U.S.C. § 105)
- **Processed data**: released under [CC0](https://creativecommons.org/publicdomain/zero/1.0/)
- **Code**, including this map: © R. Kyle Bocinsky, released under the [MIT License](https://github.com/sustainable-fsa/lfp-explorer/blob/main/LICENSE)

## Disclaimer

This dataset is archived for research and educational use only. It may not reflect current USDA administrative boundaries or official LFP policy. Always consult your **local FSA office** for the latest program guidance. To find yours, use the [USDA Service Center Locator](https://offices.sc.egov.usda.gov/locator/app).

## Acknowledgments & contact

This work is part of the [*Enhancing Sustainable Disaster Relief in FSA Programs*](https://www.ars.usda.gov/research/project/?accnNo=444612) project, supported by the USDA Office of the Chief Economist, Office of Energy and Environmental Policy, and the USDA Climate Hubs. It was prepared by the [Montana Climate Office](https://climate.umt.edu), W.A. Franke College of Forestry & Conservation, University of Montana.

Questions, corrections, and requests: [kyle.bocinsky@umontana.edu](mailto:kyle.bocinsky@umontana.edu).
