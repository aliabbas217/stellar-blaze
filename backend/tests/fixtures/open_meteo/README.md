# Open-Meteo Previous Runs fixture

## `ifs025_OMAA_2025-07-01_02.json`

The response of the Open-Meteo Previous Runs API for the grid cell nearest Abu Dhabi Intl (OMAA), ECMWF IFS 0.25
degree, valid hours 2025-07-01 00:00 to 2025-07-02 23:00 UTC: 48 hours, six variables at lead 0 (the same-day run) and
leads 1 to 7 days (48 series), 16 KB. The grid cell the API chose is 24.5 N, 54.75 E, elevation 16.0 m.

- URL (the request `OpenMeteoPreviousRunsSource` builds for these dates, the 48 `hourly` names in variable order, then
  lead order):
  `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=24.4330&longitude=54.6511&models=ecmwf_ifs025&timezone=UTC&start_date=2025-07-01&end_date=2025-07-02&hourly=temperature_2m,temperature_2m_previous_day1,...,temperature_2m_previous_day7,dew_point_2m,...,wind_speed_10m,...,shortwave_radiation,...,direct_radiation,...,surface_pressure,...,surface_pressure_previous_day7`
  (the `...` stand for the lead 1 to 6 names of the variable, spelled out in the recorded request).
- Accessed: 2026-11-11 (about 12:50 UTC, one request, HTTP 200, 16,193 bytes, default TLS verification).
- License: Open-Meteo free tier, data CC BY 4.0 (https://open-meteo.com/en/licence; attribution is required where the
  data is displayed). The free API is for non-commercial use (https://open-meteo.com/en/terms); the licensing
  question for production is open (research note 2026-11-11-data-availability.md, section 4).
- Trimming: none, the response is stored as served (single line, UTF-8; the units are `°C`, `km/h`, `W/m²`, `hPa`),
  except for the newline at the end of the file that the repository's `end-of-file-fixer` hook adds.
- Content worth knowing: no value is null in this window; wind is in km/h (the default), which the adapter divides by
  3.6; the two radiation series are the mean over the hour that ends at the valid time (ADR 0006, and the research
  script `docs/research/scripts/roster/fetch_radiation.py`: "mean over the PRECEDING hour"; surface pressure is
  instantaneous), which the adapter keeps as served. In this response the shortwave radiation is 0.0 at 01:00 UTC,
  6.0 at 02:00 and 106.0 at 03:00 (sunrise at OMAA is about 01:40 UTC), consistent with that convention.
