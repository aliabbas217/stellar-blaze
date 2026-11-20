# ADR 0091: Imagery, terrain and map data licences for the landing

- **Status:** Accepted by the architect (the owner informed in the controller's brief of 2026-11-20). This ADR records what `frontend/public/data/LICENCES.md` says and where the page shows it; it does not re-derive any legal conclusion.
- **Date:** 2026-11-20
- **Deciders:** the architect (Claude); Ali (owner) informed
- **Supersedes / superseded by:** none.
- **Evidence:** `frontend/public/data/LICENCES.md` (built 2026-11-18, read in full for this ADR; quoted below), `frontend/public/data/uae-geo.json` (`attribution`, `sources`), `frontend/src/features/judge/landing/field-server.ts` (`loadAttribution`), `ForecastStage.tsx` (`<p className="attr">`), `LandingView.tsx`; commit `8562946` (adds the files); [ADR 0090](0090-landing-is-seven-whole-screen-slides-over-real-imagery-and-terrain.md).

## Context
The landing's map (ADR 0090 decision 3) is built from two public datasets that the repo now holds in derived form under `frontend/public/data/`. Nothing is fetched from either provider at run time: the page serves its own copies (`uae-sat-gray.webp`, `uae-dem.bin`, `uae-geo.json`, `uae-poster.webp`). Both providers ask for credit, so the credit text, where it is shown and what is not shown need a record.

## Decision
1. **Each dataset's licence and attribution is the text in `LICENCES.md`.** Quoted, not paraphrased.

   **1. Imagery: NASA GIBS, `VIIRS_NOAA21_CorrectedReflectance_TrueColor`** (WMTS, EPSG:4326, tile matrix set `250m`, zoom 8; 15 daily scenes, 2026-10-18 to 2026-11-15 every 2 days; no key, no account; fetched 2026-11-18 UTC). Used for `uae-sat-gray.webp`, the grayscale satellite texture draped on the terrain.
   - Licence line of the file: "NASA EOSDIS Data Use Policy, CC0 for NASA-led mission data with no marked restriction." Licence URL: https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-policy
   - From the policy page as the file records it: "data provided from a NASA-led mission are licensed as Creative Commons Zero (CC0)" unless a use restriction or licence is marked; "While there are no restrictions on the use of these data"; "NASA material may not be used to suggest or imply endorsement by NASA"; "NASA should be acknowledged as the source of the material where applicable."
   - GIBS acknowledgement, as the file records it: "We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS)." The file adds that GIBS asks for it "in their clients or when referencing it in written or oral presentations".
   - The file's instruction: "**Do not** imply NASA or NOAA endorse this product."
   - Modifications, as the file states them: the 15 scenes were converted to luminance, the per-pixel 40th percentile was taken across dates, the result was cropped, downsampled to 1536 x 1216 px, tone-curved and lightly sharpened; "It is therefore a derived, processed composite, not a single acquisition."

   **2. Terrain: AWS Open Data "Terrain Tiles" (Mapzen / Tilezen joerd), terrarium PNG, zoom 9** (80 tiles; no key, no account; fetched 2026-11-18 UTC). Used for `uae-dem.bin`, the elevation of the slab mesh.
   - Licence URL: https://github.com/tilezen/joerd/blob/master/docs/attribution.md. The file quotes that page: "Attribution is required for many terrain tile data providers. Example language is provided below, but you are responsible for researching each project to follow their license terms."
   - Required attribution for this region, as the file quotes it: "United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey" and "Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration".
   - **SRTM** (NASA/NGA, distributed by USGS): public domain. "No domestic copyright will be asserted." USGS requests credit: "SRTM data courtesy of the U.S. Geological Survey".
   - **GMTED2010** (USGS): "No restrictions, All GMTED2010 data products are publically available."; acknowledgement "would be appreciated"; "GMTED2010 data courtesy of the U.S. Geological Survey". (The spelling "publically" is the file's quotation of the source.)
   - **ETOPO1** (NOAA NCEI): public domain; "Not to be used for navigation." Only the sea floor comes from ETOPO1 and it is clamped to 0 in the output, so none of its values appear.
   - Modifications, as the file states them: heights decoded, sea and negative values clamped to 0, area-averaged onto a 128 x 101 grid, rounded to whole metres; "This is a presentation grid and is **not** suitable for navigation or engineering use."

   **File-level statement of the file** ("Files and who may do what"): "Anything in this folder is derived from the two sources above, both of which allow reuse, including commercial, with the acknowledgements shown. No endorsement by NASA, NOAA or USGS may be implied." The forecast grid (`uae_ifs025_d1_wbgt_2026-09-03.json`) "is the app's own data and is not covered by this file"; this ADR does not cover it either.

2. **Where the credit is shown in the UI.** Under the map on the landing's chapter 01, as one line, in both the live scene and the still-poster state (it is a paragraph outside the canvas: `<p className="attr">` in `ForecastStage.tsx`). The text is the `attribution` member of `uae-geo.json`, read on the server (`loadAttribution`; a missing or empty value fails the build), and is the "Page footer line" of `LICENCES.md`, word for word:

   > Imagery: NASA Global Imagery Browse Services (GIBS), VIIRS NOAA-21. Terrain: SRTM and GMTED2010 courtesy of the U.S. Geological Survey, ETOPO1 NOAA, via AWS Terrain Tiles.

   The line is not translated (it is a credit text; it is not in the message catalogues). The page also prints "ECMWF IFS, day-1 forecast, {date}" as the forecast's source line and the caption "An illustration of one hot day, not the day we scored."

3. **What the page does not print**, so that nobody assumes it does: the full GIBS acknowledgement sentence (the file says: "If the page has room for the full GIBS wording ... use" it; the page prints the short line); the modification statements (they are in `LICENCES.md` and in the `note` members of `uae-geo.json`); the 3DEP clause (the file lists 3DEP in the required attribution but the page line names SRTM, GMTED2010 and ETOPO1; the file's own footer line is what the page prints). No wording on the page says or implies endorsement by NASA, NOAA or USGS.

4. **Gaps in the record, stated:** `LICENCES.md` says the files were built by `fetch.py`, which is not committed, so the build cannot be repeated from the repo; it names `uae-sat-gray.jpg`, of which only the `.webp` is committed (`uae-geo.json` records the JPEG at 181,933 B); the licence pages were "opened and read on 2026-11-18/19" by the author of that file and have not been re-read since; the `fetch.py` provenance and a re-read are the first things to redo before any claim stronger than the file's own text.

## Consequences
- **Cost of being wrong:** a provider's terms differ from the file's reading or a credit is judged too short; the cost is changing one string (`uae-geo.json`) and one paragraph, and, if the terms are stricter than the file says, removing the imagery or the terrain from the page.
- The credit lives in a data file beside the data, so a data refresh that replaces the files carries its credit with it.
- `THIRD_PARTY_NOTICES.md` for the frontend lists both datasets (`frontend/THIRD_PARTY_NOTICES.md`, new today; the existing `backend/THIRD_PARTY_NOTICES.md` is scoped to ported backend source and is untouched). The landing added no package and no font: `package.json` and `fonts.ts` did not change in S10.

## Revisit trigger
A provider changes its data-use or attribution wording; a reviewer or the owner asks for the full GIBS sentence or the modifications on the page; the imagery or terrain is re-fetched (re-read the licence pages, commit the fetch script); a third dataset is added to the map.

## Links
[ADR 0090](0090-landing-is-seven-whole-screen-slides-over-real-imagery-and-terrain.md) · [ADR 0037](0037-reverse-0014-cinematic-3d-landing.md) · [`frontend/public/data/LICENCES.md`](../../frontend/public/data/LICENCES.md) · [`frontend/THIRD_PARTY_NOTICES.md`](../../frontend/THIRD_PARTY_NOTICES.md)
