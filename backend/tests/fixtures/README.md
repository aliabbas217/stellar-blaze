# Test fixtures

Recorded upstream responses and reference data, kept small so unit tests never need the network. Each section names
where a file came from, when it was fetched, under which terms, and how it was reduced, so it can be re-recorded.

## `iem/OMAA_2025-07-01_03.csv`

Hourly METAR observations of Abu Dhabi Intl (OMAA) from the Iowa Environmental Mesonet ASOS/METAR archive, 2025-07-01
00:00 to 2025-07-02 23:00 UTC (58 reports, 2.3 KB).

- URL (the request `IemMetarSource` builds for the window 2025-07-01 to 2025-07-03):
  `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=OMAA&data=tmpf&data=dwpf&data=sknt&year1=2025&month1=7&day1=1&year2=2025&month2=7&day2=3&tz=Etc%2FUTC&format=onlycomma&latlon=no&elev=no&missing=empty&trace=T&direct=no&report_type=3&report_type=4`
- Accessed: 2026-11-11.
- License: IEM's terms state "The materials found on this website are in the public domain and may be used freely by
  anyone for any lawful purpose. Attributing the Iowa Environmental Mesonet of Iowa State University would be
  appreciated." The METARs themselves originate with the UAE aviation weather service.
- Trimming: none, the response is stored as served. The end date of an IEM request is exclusive, so the last report is
  2025-07-02 23:00.

## `ghcnh/GHCNh_AEI0000OMAA_2025_0701-0703.parquet`

NOAA GHCNh (Global Historical Climatology Network hourly, v1.1.0) observations of station AEI0000OMAA (Abu Dhabi
Intl), 2025-07-01 00:00:00 to 2025-07-02 23:00:00 UTC (58 rows, all 329 columns, 128 KB).

- URL:
  `https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/access/by-year/2025/parquet/GHCNh_AEI0000OMAA_2025.parquet`
  (491,669 bytes at access; `etag: "b10d7470f4945ecd0e0ffdfc3e4f2801"`, `last-modified: Fri, 23 Oct 2026 05:10:35 GMT`).
- Accessed: 2026-11-11.
- License: NOAA National Centers for Environmental Information, GHCNh v1.1.0. Neither the product page nor the v1.1.0
  documentation states a license or use constraint (research note 2026-11-11-data-availability.md, section 4); NOAA
  is a US-government provider and cites the product by name and version.
- Trimming: the by-year file was downloaded to a scratch directory outside the repository and read with Polars; the
  `DATE` column is a `String` of the form `2025-07-01T00:00:00` (UTC, no offset suffix), parsed with
  `%Y-%m-%dT%H:%M:%S`; the rows with 2025-07-01 00:00:00 <= `DATE` < 2025-07-03 00:00:00 were kept, with every column
  and no value changed, and written with `DataFrame.write_parquet(compression="zstd")`.
- Content worth knowing: the dew point at 2025-07-01T12:00:00 and 14:00:00 carries quality code `2` (suspect) and the
  rows are kept; blank quality codes are real nulls in this parquet (not empty strings); no numeric sentinel for a
  missing value occurs in the five station-years inspected (OMAA 2025 and 2026, OMDB 2025, OMFJ 2024, OMRK 2025).

## `risk/personal_level_vectors.json`

Reference vectors for the personal level (ADR 0049): 46 exceedance cases (`exceedance_3q`) and 14 band cases
(`band_level`), `format_version` 1. They are generated, not recorded: the Python implementation in
`stellar_blaze.domain.risk.personal` is the source and the frontend's `personal.ts` (F2) must reproduce every vector,
so the file is the parity contract between the two. F2 consumes it as a test fixture.

- Generate: `uv run python -m stellar_blaze.domain.risk.personal --write-vectors <path>` (from `backend/`; the committed
  file is `tests/fixtures/risk/personal_level_vectors.json`). `test_vectors_file_matches_functions` in `tests/unit/risk/test_personal_parity.py` fails if the
  committed file differs from what the generator writes.
- Format: documented in the `stellar_blaze.domain.risk.personal` module docstring (`format_version` is bumped when the
  shape changes).
- Re-generate only with the code change that moves a vector, and say so in the commit.
