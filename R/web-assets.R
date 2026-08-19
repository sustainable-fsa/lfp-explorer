## ---------------------------------------------------------------------------
## Browser assets for the web map.
##
## One producer, a pure function of nothing at all, so it can be sourced and
## exercised on its own — no AWS credentials, no S3 client, no FOIA workbooks:
##
##   build_color_ramps() the two color ramps the map colors with
##
## The map's data payload is NOT built here. The `fsa-ngp-web/1` JSON the front
## end reads is generated and committed by the archive repo's own processing
## script on every archive update
## (sustainable-fsa/fsa-normal-grazing-period → `fsa-normal-grazing-period.json`
## at that repo's root), and the app fetches it at runtime from that repo's
## GitHub Pages. This repo ships no copy of it, and there is no manual refresh
## step to run here.
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
