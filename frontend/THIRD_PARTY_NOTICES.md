# Third-party notices (frontend)

This file lists third-party **data** that was fetched, processed and committed into the frontend. It does not list the
packages installed from `package.json` and `pnpm-lock.yaml`, which keep their own licences, and it does not list
fonts: `src/app/fonts.ts` loads them through `next/font` at build time. The ported backend source code has its own
file, [`../backend/THIRD_PARTY_NOTICES.md`](../backend/THIRD_PARTY_NOTICES.md). The full licence record for the files
below is [`public/data/LICENCES.md`](public/data/LICENCES.md) and the decision is
[ADR 0091](../docs/decisions/0091-imagery-terrain-and-map-data-licences-for-the-landing.md); the table repeats that
file and adds nothing to it.

The landing page (ADR 0090) uses no library and no font that was not already in use before it: `package.json` and
`src/app/fonts.ts` did not change in the change that added it.

## Landing map: imagery

| | |
|---|---|
| Source | NASA GIBS (Global Imagery Browse Services), layer `VIIRS_NOAA21_CorrectedReflectance_TrueColor`, public WMTS, no key, no account |
| Fetched | 2026-11-18 UTC; 15 daily scenes, 2026-10-18 to 2026-11-15 every 2 days |
| Used in | `public/data/uae-sat-gray.webp` |
| Licence, as `LICENCES.md` states it | NASA EOSDIS Data Use Policy, CC0 for NASA-led mission data with no marked restriction: https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-policy |
| Acknowledgement, as `LICENCES.md` states it | "We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS)." |
| Changes | Converted to luminance, the per-pixel 40th percentile across dates, cropped, downsampled to 1536 x 1216 px, tone-curved and lightly sharpened: a derived composite, not a single acquisition |
| Endorsement | None by NASA or NOAA may be implied |

## Landing map: terrain

| | |
|---|---|
| Source | AWS Open Data "Terrain Tiles" (Mapzen / Tilezen joerd), terrarium PNG, zoom 9: https://registry.opendata.aws/terrain-tiles/ |
| Fetched | 2026-11-18 UTC |
| Used in | `public/data/uae-dem.bin` |
| Underlying sources and licences, as `LICENCES.md` states them | SRTM (NASA/NGA, distributed by USGS): public domain, "SRTM data courtesy of the U.S. Geological Survey". GMTED2010 (USGS): "No restrictions, All GMTED2010 data products are publically available.", "GMTED2010 data courtesy of the U.S. Geological Survey". ETOPO1 (NOAA NCEI): public domain, "Not to be used for navigation." (sea floor only, clamped to 0 in the output). Licence page: https://github.com/tilezen/joerd/blob/master/docs/attribution.md |
| Attribution required for this region, as `LICENCES.md` quotes it | "United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey" and "Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration" |
| Changes | Heights decoded, sea and negative values clamped to 0, area-averaged onto a 128 x 101 grid, rounded to whole metres: a presentation grid, not suitable for navigation or engineering use |
| Endorsement | None by NOAA or USGS may be implied |

## The credit line the page prints

Under the map on the landing, from `public/data/uae-geo.json` (`attribution`):

> Imagery: NASA Global Imagery Browse Services (GIBS), VIIRS NOAA-21. Terrain: SRTM and GMTED2010 courtesy of the U.S. Geological Survey, ETOPO1 NOAA, via AWS Terrain Tiles.

Known gaps, recorded in ADR 0091: the full GIBS sentence and the modification statements are not printed on the
page, and the build script `LICENCES.md` names (`fetch.py`) is not committed.
