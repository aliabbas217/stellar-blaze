"""Probe Open-Meteo Previous Runs + Historical Forecast archives at Abu Dhabi (OMAA grid).

Two measurements, all by downloading and counting (nothing quoted):
  A. first date with a non-null value, per model x variable, for the `_previous_day1` lead
     (Previous Runs API) and for the stitched series (Historical Forecast API).
  B. per model x summer (15 May - 30 Sep) x variable x lead (0..7): count of non-null hourly values
     out of the 3336 expected (139 days x 24 h, UTC).

Usage: python -I probe_forecast_archive.py <out_dir>
Rate-limit etiquette: sleeps between calls; retries on 429 with back-off. TLS verification on.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import requests

LAT, LON = 24.433, 54.651  # OMAA
PREV = "https://previous-runs-api.open-meteo.com/v1/forecast"
HIST = "https://historical-forecast-api.open-meteo.com/v1/forecast"
MODELS = [
    "ecmwf_ifs025",
    "ecmwf_ifs",
    "ecmwf_aifs025_single",
    "gfs_seamless",
    "gfs_global",
    "ncep_aigfs025",
    "icon_global",
    "gem_global",
    "ukmo_global_deterministic_10km",
]
VARS = ["temperature_2m", "dew_point_2m", "wind_speed_10m", "shortwave_radiation", "direct_radiation", "surface_pressure"]
SUMMERS = {2024: ("2024-05-15", "2024-09-30"), 2025: ("2025-05-15", "2025-09-30"), 2026: ("2026-05-15", "2026-09-30")}
S = requests.Session()
S.headers["User-Agent"] = "research-data-availability-check/1.0"


def get(url: str, params: dict) -> dict:
    for attempt in range(6):
        r = S.get(url, params=params, timeout=180)
        if r.status_code == 200:
            return r.json()
        if r.status_code == 429:
            wait = 30 * (attempt + 1)
            print(f"  429, sleeping {wait}s")
            time.sleep(wait)
            continue
        return {"error": True, "status": r.status_code, "reason": r.text[:300]}
    return {"error": True, "status": 429, "reason": "rate limited after retries"}


def first_nonnull(times: list[str], vals: list) -> str | None:
    for t, v in zip(times, vals, strict=True):
        if v is not None:
            return t
    return None


def main(out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    result: dict = {"A_prev_day1_first": {}, "A_hist_first": {}, "B_counts": {}}

    # ---- A: first non-null date, 2021-01-01 .. 2026-11-10, previous_day1 (Previous Runs) -------
    for m in MODELS:
        p = {
            "latitude": LAT,
            "longitude": LON,
            "models": m,
            "timezone": "UTC",
            "start_date": "2021-01-01",
            "end_date": "2026-11-10",
            "hourly": ",".join(f"{v}_previous_day1" for v in ("temperature_2m", "dew_point_2m", "shortwave_radiation", "wind_speed_10m")),
        }
        d = get(PREV, p)
        if d.get("error"):
            result["A_prev_day1_first"][m] = d
            print(m, "prev err", d)
        else:
            h = d["hourly"]
            result["A_prev_day1_first"][m] = {k: first_nonnull(h["time"], v) for k, v in h.items() if k != "time"}
            print(m, "prev first", result["A_prev_day1_first"][m])
        time.sleep(8)
        p2 = dict(p)
        p2["hourly"] = "temperature_2m,dew_point_2m,shortwave_radiation,wind_speed_10m"
        d = get(HIST, p2)
        if d.get("error"):
            result["A_hist_first"][m] = d
            print(m, "hist err", d)
        else:
            h = d["hourly"]
            result["A_hist_first"][m] = {k: first_nonnull(h["time"], v) for k, v in h.items() if k != "time"}
            print(m, "hist first", result["A_hist_first"][m])
        time.sleep(8)
        (out / "A_progress.json").write_text(json.dumps(result, indent=1))

    # ---- B: per model x summer counts for leads 0..7 ----------------------------------------
    for m in MODELS:
        for y, (a, b) in SUMMERS.items():
            names = []
            for v in VARS:
                names.append(v)  # day0
                names += [f"{v}_previous_day{k}" for k in range(1, 8)]
            p = {
                "latitude": LAT,
                "longitude": LON,
                "models": m,
                "timezone": "UTC",
                "start_date": a,
                "end_date": b,
                "hourly": ",".join(names),
            }
            d = get(PREV, p)
            key = f"{m}|{y}"
            if d.get("error"):
                result["B_counts"][key] = d
                print(key, "err", d.get("status"), str(d.get("reason"))[:120])
            else:
                h = d["hourly"]
                n = len(h["time"])
                counts = {k: sum(1 for x in v if x is not None) for k, v in h.items() if k != "time"}
                result["B_counts"][key] = {"n_hours": n, "counts": counts}
                (out / f"B_{m}_{y}.json").write_text(json.dumps(d))
                print(key, "n_hours", n, {k: c for k, c in counts.items() if k.startswith("temperature_2m")})
            time.sleep(8)
            (out / "B_progress.json").write_text(json.dumps(result, indent=1))
    (out / "probe_result.json").write_text(json.dumps(result, indent=1))


if __name__ == "__main__":
    main(sys.argv[1])
