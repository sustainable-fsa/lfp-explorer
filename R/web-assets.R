## ---------------------------------------------------------------------------
## Browser assets for the web map.
##
## Two producers, both sourceable and exercisable on their own — no AWS
## credentials, no S3 client, no FOIA workbooks:
##
##   build_color_ramps() the two color ramps the map colors with
##   build_df_ramp()     the payment-months ramp the LFP eligibility map colors
##                       with
##   build_crosswalk()   the FSA <-> FIPS county crosswalk the FIPS-keyed
##                       payloads are joined onto the FSA geometry with
##
## build_color_ramps() and build_df_ramp() are pure functions of nothing at all.
## build_crosswalk() is NOT: it reads the two sibling boundary archives' geoparquet
## (../fsa-counties-dd17, ../fsa-counties-dd22), so it only runs in a checkout
## of the whole sustainable-fsa workspace. That is deliberate — those parquets
## are the same files the boundary TopoJSON is built from, so a crosswalk built
## from them cannot drift from the polygons it keys. Its OUTPUT is committed,
## so nobody needs the siblings to run the app.
##
## The map's data payloads are NOT built here. The `fsa-ngp-web/1` JSON the
## front end reads is generated and committed by each archive repo's own
## processing script on every archive update
## (sustainable-fsa/fsa-normal-grazing-period -> `fsa-normal-grazing-period.json`
## at that repo's root; likewise nclimgrid-normal-grazing-period), and the app
## fetches it at runtime from that repo's GitHub Pages. This repo ships no copy
## of any of them, and there is no manual refresh step to run here.
##
## Everything is namespace-qualified; sourcing this file attaches no packages.
## ---------------------------------------------------------------------------


## The two color ramps the map colors with, as JSON arrays of hex strings.
##
## Both are scientific (perceptually uniform) palettes from Crameri's collection:
##
##   colors.json          romaO, cyclic, 366 entries in day-of-year order. Rotated
##                        so the seam falls at 01 July rather than 01 January —
##                        grazing seasons straddle the new year, and a discontinuity
##                        mid-season would read as a real break in the data.
##   colors-duration.json batlowK, sequential, 53 entries for 0-52 weeks. Matches the
##                        duration map in README.Rmd.
##
## Ported unchanged from the retired dashboard; the ramps are a published contract
## and must stay byte-for-byte what they were.
build_color_ramps <- function(dir = "assets") {

  dir.create(dir, recursive = TRUE, showWarnings = FALSE)

  ## yday cyclic palette
  dates <- seq(lubridate::as_date("1999-07-01"), lubridate::as_date("2000-06-30"), "1 day")
  color_shift <- 250
  colors <- as.character(khroma::color("romaO", reverse = TRUE)(366))
  colors <- colors[c((color_shift + 1):366, 1:color_shift)]

  yday_pal <-
    tibble::tibble(date = dates,
                   color = colors,
                   yday = lubridate::yday(dates)) |>
    dplyr::arrange(yday)

  jsonlite::write_json(yday_pal$color, file.path(dir, "colors.json"), auto_unbox = TRUE)

  ## duration sequential palette (weeks), matching README.Rmd's static map
  duration_max <- 52
  duration_colors <- as.character(khroma::color("batlowK")(duration_max + 1))
  jsonlite::write_json(duration_colors, file.path(dir, "colors-duration.json"),
                       auto_unbox = TRUE)

  invisible(file.path(dir, c("colors.json", "colors-duration.json")))
}


## The payment-months ramp, as `assets/colors-df.json`: six hex strings, index 0
## for "eligible, months not stated" and 1-5 for the months themselves.
##
## NOT a Crameri palette, and deliberately: the derived-eligibility archive
## publishes its own maps with a ladder taken from an FSA map PDF
## (#E0E436 -> #DF9114 -> #DD2313 -> #850014 -> #3B003C), and a reader who has
## seen those maps must recognise this one. So the ANCHORS' hues are kept and
## everything else about them is fixed: their lightness steps are uneven, and
## their top two collapse into a single color under deuteranopia.
##
## What this function does, therefore, is RE-SPACE them. Each anchor is moved to
## a target CIE L*, keeping its own hue (only step 1 is rotated, +12 degrees
## toward yellow-green, which is what puts it clear of the US Drought Monitor's
## D0 yellow -- the two palettes appear in adjacent exports), and taking as much
## of the anchor's chroma as sRGB will hold at that lightness. The clip is a
## binary search because polarLAB -> sRGB has no closed-form gamut boundary.
##
## Index 0 is a LITERAL, not a derivation: it is not a step on the ladder at all
## but a category beside it -- an event that qualified a county without a stated
## month count (most 2008-2011 determinations). Mid-lightness so it cannot read
## as either end of the ramp, and nearly unsaturated (C* 11 against 41-87) so
## the eye reads it as a different KIND of answer.
##
## Every measured distance behind these six colors -- the L* ladder, the three
## CVD simulations, the grayscale ordering, and the separations from the
## no-data fill, the two map grounds and the USDM's own palette -- is documented
## in js/color.js, where the ramp is read. Those measurements are the acceptance
## test; the checks below are the ones this file can make for itself.
build_df_ramp <- function(dir = "assets") {

  dir.create(dir, recursive = TRUE, showWarnings = FALSE)

  ## The FSA ladder's own colors, and where each one is moved to.
  anchors  <- c("#E0E436", "#DF9114", "#DD2313", "#850014", "#3B003C")
  target_l <- c(87.1,      68.1,      52.0,      27.9,      11.0)
  rotate   <- c(12,        0,         0,         0,         0)

  ## Eligible, months not stated. See above.
  slate <- "#5F6C7D"

  polar <- function(hex) as(colorspace::hex2RGB(hex), "polarLAB")@coords

  respace <- function(hex, L, dh) {
    p <- polar(hex)
    chroma <- p[1, "C"]
    hue <- (p[1, "H"] + dh) %% 360
    ## The requested chroma, if sRGB holds it at this lightness.
    exact <- colorspace::hex(colorspace::polarLAB(L, chroma, hue), fixup = FALSE)
    if (!is.na(exact)) return(exact)
    ## Otherwise the most saturated in-gamut color on the same hue leaf.
    lo <- 0
    hi <- chroma
    best <- NA_character_
    for (i in 1:40) {
      mid <- (lo + hi) / 2
      got <- colorspace::hex(colorspace::polarLAB(L, mid, hue), fixup = FALSE)
      if (!is.na(got)) { best <- got; lo <- mid } else hi <- mid
    }
    if (is.na(best)) {
      stop("build_df_ramp(): no in-gamut color for L* ", L, " on hue ", hue,
           call. = FALSE)
    }
    best
  }

  months <- toupper(mapply(respace, anchors, target_l, rotate, USE.NAMES = FALSE))
  ramp <- c(toupper(slate), months)

  ## Shape: exactly six #RRGGBB strings. A five-entry file would paint every
  ## five-month county the same as a four-month one, and the front end's own
  ## length assert would be the only thing to notice.
  stopifnot(
    length(ramp) == 6L,
    all(grepl("^#[0-9A-F]{6}$", ramp))
  )

  ## Criterion 1, re-measured from what was actually written: L* falls
  ## monotonically across the five month steps, by at least 12 at every step.
  ## Below that the ramp stops being readable in grayscale, which is the whole
  ## reason the anchors were re-spaced.
  lightness <- vapply(months, function(h) polar(h)[1, "L"], numeric(1))
  steps <- -diff(lightness)
  if (any(steps < 12)) {
    stop("build_df_ramp(): neighbouring lightness steps are ",
         paste(sprintf("%.1f", steps), collapse = ", "),
         "; every one must be at least 12 L*.", call. = FALSE)
  }

  ## Written as ONE line, like the other ramps: it is machine input.
  out <- file.path(dir, "colors-df.json")
  jsonlite::write_json(ramp, out, auto_unbox = TRUE)

  invisible(out)
}


## The FSA <-> FIPS county crosswalk, as `assets/fsa-fips-crosswalk.json`
## (schema `fsa-fips-crosswalk/1`).
##
## FSA administers its programs on its own county geography, and several of the
## payloads this app draws (the nClimGrid climatology, the drought monitor, the
## disaster designations) are keyed by Census FIPS instead. Most codes are the
## same string in both systems, which is exactly what makes the difference
## dangerous: a join that is 97% right looks right. The two disagreements that
## matter are one FIPS county split across two FSA offices (the value
## replicates onto both polygons) and one FSA office administering many FIPS
## counties (the values collide, and the front end reduces them per dataset --
## see js/decoders/crosswalk.js).
##
## Source of truth: `FSA_STCOU` x `FIPS_C` from the two boundary archives'
## geoparquet -- the same files their TopoJSON is built from. The tables differ
## between vintages (dd17 has 3,247 pairs, dd22 3,245), so BOTH ship and the
## front end joins per the vintage on screen.
##
## Shape, deliberately: two parallel arrays of 5-character strings per vintage,
## sorted by (FSA, FIPS). Smaller over the wire than an object of arrays, both
## directions cost one indexing pass in the browser, and the sort makes a diff
## of the artifact readable when a boundary vintage is corrected. Written as
## ONE line: it is machine input, and a 6,500-element pretty-print is 130 KB of
## reviewer noise.
build_crosswalk <- function(dir = "assets",
                            sources = c(dd17 = "../fsa-counties-dd17/fsa-counties-dd17.parquet",
                                        dd22 = "../fsa-counties-dd22/fsa-counties-dd22.parquet"),
                            expected = c(dd17 = 3247L, dd22 = 3245L)) {

  dir.create(dir, recursive = TRUE, showWarnings = FALSE)

  missing <- sources[!file.exists(sources)]
  if (length(missing)) {
    stop("build_crosswalk() needs the sibling boundary archives; not found: ",
         paste(missing, collapse = ", "),
         call. = FALSE)
  }

  vintages <-
    lapply(sources, function(path) {

      pairs <-
        arrow::open_dataset(path) |>
        dplyr::select(fsa = FSA_STCOU, fips = FIPS_C) |>
        dplyr::collect() |>
        dplyr::mutate(fsa = as.character(fsa), fips = as.character(fips)) |>
        dplyr::distinct()

      ## Both keys are five digits, everywhere, always. A four-character code
      ## here would be a dropped leading zero -- eight whole states -- and the
      ## front end would join it to nothing without complaining.
      stopifnot(
        !anyNA(pairs$fsa), !anyNA(pairs$fips),
        all(grepl("^[0-9]{5}$", pairs$fsa)),
        all(grepl("^[0-9]{5}$", pairs$fips))
      )

      ## method = "radix" sorts in C order rather than the session's collation
      ## locale: the artifact must be byte-identical wherever it is rebuilt.
      pairs <- pairs[order(pairs$fsa, pairs$fips, method = "radix"), ]

      list(n = jsonlite::unbox(nrow(pairs)), fsa = pairs$fsa, fips = pairs$fips)
    })

  ## The counts are a contract with the front end's integrity check, so a
  ## boundary correction upstream has to be acknowledged here rather than
  ## silently changing the artifact.
  got <- vapply(vintages, function(v) as.integer(v$n), integer(1))
  if (!is.null(expected)) {
    for (v in names(expected)) {
      if (!identical(got[[v]], expected[[v]])) {
        stop("build_crosswalk(): ", v, " has ", got[[v]], " distinct (FSA, FIPS) ",
             "pairs, expected ", expected[[v]],
             ". If the boundary archive changed, update `expected` and say so ",
             "in the commit.", call. = FALSE)
      }
    }
  }

  payload <-
    c(list(schema = jsonlite::unbox("fsa-fips-crosswalk/1"),
           license = jsonlite::unbox("CC0-1.0"),
           source = jsonlite::unbox("fsa-counties-dd17/dd22 geoparquet, FSA_STCOU × FIPS_C")),
      vintages)

  out <- file.path(dir, "fsa-fips-crosswalk.json")
  writeLines(jsonlite::toJSON(payload, digits = NA), out)

  invisible(out)
}
