# Licences and sources: Direction D "Real Earth" data

Built 2026-11-18 (UTC; 2026-11-19 local, Asia/Karachi) by `fetch.py` (stdlib + Pillow + numpy; no account, no API key, nothing installed). Both sources are
public and open. Each licence page below was opened and read on 2026-11-18/19.

## Page footer line (also `attribution` in `uae-geo.json`)

> Imagery: NASA Global Imagery Browse Services (GIBS), VIIRS NOAA-21. Terrain: SRTM and GMTED2010 courtesy of the U.S. Geological Survey, ETOPO1 NOAA, via AWS Terrain Tiles.

If the page has room for the full GIBS wording (the GIBS site asks for it "in their clients or when referencing it in
written or oral presentations"), use: *We acknowledge the use of imagery provided by services from NASA's Global
Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS).*

---

## 1. Imagery: NASA GIBS, VIIRS NOAA-21 corrected reflectance, true colour

| | |
|---|---|
| Used for | `uae-sat-gray.jpg` / `.webp`, the grayscale satellite texture draped on the terrain |
| Service | NASA GIBS (Global Imagery Browse Services), public WMTS, EPSG:4326 |
| Layer | `VIIRS_NOAA21_CorrectedReflectance_TrueColor`, tile matrix set `250m`, zoom 8 (512 px tiles, 1.125 deg each, 0.00220 deg/px) |
| URL | `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_NOAA21_CorrectedReflectance_TrueColor/default/{YYYY-MM-DD}/250m/{z}/{row}/{col}.jpg` |
| Scenes | 15 daily scenes, 2026-10-18 to 2026-11-15 every 2 days (30 tiles each) |
| Key / account | none (verified: every request is anonymous) |
| Fetched | 2026-11-18 UTC |

**Pages opened and read**
- `https://nasa-gibs.github.io/gibs-api-docs/` : "Data Use Guidance and Acknowledgements": "NASA promotes full and open sharing of data. We ask that users who make use of GIBS in their clients or when referencing it in written or oral presentations to add the following acknowledgment: We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS)."
- `https://nasa-gibs.github.io/gibs-api-docs/access-basics/` : "accessible through public standards-compliant web services"; no key or account mentioned; REST template `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/{LayerIdentifier}/default/{Time}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.{FormatExt}`.
- `https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-policy` (page dated Nov. 18, 2026): "data provided from a NASA-led mission are licensed as Creative Commons Zero (CC0)" unless a use restriction or licence is marked; "While there are no restrictions on the use of these data"; "NASA material may not be used to suggest or imply endorsement by NASA"; "NASA should be acknowledged as the source of the material where applicable."

- `https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/VIIRS_NOAA21_CorrectedReflectance_TrueColor.json` : layer provenance: "Corrected Reflectance (True Color)", NOAA-21 / VIIRS, built from the LANCE near-real-time products `VJ202IMG_NRT` (VIIRS/JPSS2 Imagery Resolution 375 m L1B swath) and `VJ203IMG_NRT`; no use restriction is stated in the metadata.

**Licence:** NASA EOSDIS Data Use Policy, CC0 for NASA-led mission data with no marked restriction. Native sensor resolution is 375 m (I-bands); GIBS serves it on a 250 m tile pyramid.
Licence URL: https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-policy

**Do not** imply NASA or NOAA endorse this product.

**Modifications (stated because some terms ask users to describe them):** the 15 scenes were converted to luminance, the
per-pixel 40th percentile was taken across dates (removes cloud, dust, sun glint, swath gaps), the result was cropped to
the bbox, downsampled to 1536 x 1216 px, passed through a gentle tone curve (percentile stretch, gamma 1.35, highlight
soft-knee, local-contrast lift over land) and a light unsharp mask. It is therefore a derived, processed composite, not a
single acquisition.

**Considered and rejected:** `Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual` (31.25 m, named in the brief).
Its GIBS time dimension is 1983-85, 1988-90 and 1998-2000 only. A 2000 image has no Palm Jumeirah, Palm Jebel Ali, The World,
Saadiyat or Yas development, so it would misdraw today's coast. `HLS_*` 30 m layers exist for 2022-2026 but are per-swath
daily granules (no global cloud-free mosaic), so they were not used. `BlueMarble_NextGeneration` is a 2004 500 m composite and
would have the same age problem at lower resolution.

---

## 2. Terrain: AWS Open Data "Terrain Tiles" (Mapzen / Tilezen joerd), terrarium PNG

| | |
|---|---|
| Used for | `uae-dem.bin`, real elevation for the slab mesh |
| Dataset | `s3://elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, zoom 9 (about 280 m per pixel at 24.5 N), 80 tiles |
| URL | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` |
| Encoding | height (m) = R*256 + G + B/256 - 32768 |
| Key / account | none (anonymous HTTPS GET) |
| Fetched | 2026-11-18 UTC |

**Pages opened and read**
- `https://github.com/tilezen/joerd/blob/master/docs/attribution.md` (raw markdown read in full): "Attribution is required for many terrain tile data providers. Example language is provided below, but you are responsible for researching each project to follow their license terms." Required attribution line for this region: "United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey" and "Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration".
- `https://github.com/tilezen/joerd/blob/master/docs/data-sources.md`: SRTM is used on land from zoom 7, GMTED2010 only at coarse zooms (and as gap-fill), ETOPO1 for ocean bathymetry at all zooms. Tile headers in this bbox list `srtm/...`, `gmted/...`, `etopo1/...` (checked with HTTP HEAD on 5 tiles).
- `https://registry.opendata.aws/terrain-tiles/`: "A global dataset providing bare-earth terrain heights, tiled for easy usage and provided on S3." Licence field points to the joerd attribution page; no-sign-request access (`aws s3 ls --no-sign-request s3://elevation-tiles-prod/`). Citation: "Terrain Tiles was accessed on `DATE` from https://registry.opendata.aws/terrain-tiles."

**Underlying licences (from the attribution page)**
- **SRTM** (NASA/NGA, distributed by USGS): public domain. "No domestic copyright will be asserted." Copyright is asserted only for products distributed outside the United States, with the notice "(c) COPYRIGHT (year of production) BY THE UNITED STATES GOVERNMENT. NO COPYRIGHT CLAIMED UNDER TITLE 17 U.S.C." USGS requests credit: "SRTM data courtesy of the U.S. Geological Survey".
- **GMTED2010** (USGS): "No restrictions, All GMTED2010 data products are publically available."; acknowledgement "would be appreciated"; users who modify the data should describe the modifications (done below); "GMTED2010 data courtesy of the U.S. Geological Survey".
- **ETOPO1** (NOAA NCEI): public domain; "Not to be used for navigation." Formal credit: "DOC/NOAA/NESDIS/NCEI > National Centers for Environmental Information, NESDIS, NOAA, U.S. Department of Commerce". Only the sea floor comes from ETOPO1 and it is clamped to 0 here, so none of its values appear in the output.

**Licence URL:** https://github.com/tilezen/joerd/blob/master/docs/attribution.md

**Modifications:** heights decoded from terrarium PNG, sea and negative values clamped to 0 before averaging, area-averaged
(box filter) onto a 128 x 101 lon/lat grid, rounded to whole metres. The averaging smooths peaks (see `uae-geo.json`
`dem.note`). This is a presentation grid and is **not** suitable for navigation or engineering use.

**Not used:** Copernicus DEM / direct SRTM downloads. AWS Terrain Tiles is anonymous and already meets the brief, so no second source was needed.

---

## Files and who may do what
- Anything in this folder is derived from the two sources above, both of which allow reuse, including commercial, with the
  acknowledgements shown. No endorsement by NASA, NOAA or USGS may be implied.
- The forecast grid itself (`uae_ifs025_d1_wbgt_2026-09-03.json`) is the app's own data and is not covered by this file.
