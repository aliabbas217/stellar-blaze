"""Pull archived forecasts (Open-Meteo Previous Runs API) at each core UAE station for each summer.

For each station x model x summer (15 May - 30 Sep, UTC hourly): temperature_2m, dew_point_2m, wind_speed_10m
at leads previous_day1..7 (value predicted 1..7 days before valid time) plus day0.
Saved raw as JSON; matched-pair counting happens in match_pairs.py.
Rate limits (free tier): <10,000 calls/day, 5,000/hour, 600/min; each request here costs ~25 calls
(139 days x 24 variables / (14 days x 10 variables)). Sleeps + 429 back-off built in.
Usage: python -I fetch_forecast_stations.py <out_dir>
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import requests

PREV = "https://previous-runs-api.open-meteo.com/v1/forecast"
STATIONS = {  # lat, lon from NOAA GHCNh station list (OMRK from ISD history)
    "OMAA": (24.4330, 54.6511),
    "OMAD": (24.4283, 54.4581),
    "OMAL": (24.2617, 55.6092),
    "OMDB": (25.2550, 55.3643),
    "OMDW": (24.8861, 55.1722),
    "OMFJ": (25.1122, 56.3240),
    "OMSJ": (25.3286, 55.5172),
    "OMRK": (25.6130, 55.9390),
}
SUMMERS = {2024: ("2024-05-15", "2024-09-30"), 2025: ("2025-05-15", "2025-09-30"), 2026: ("2026-05-15", "2026-09-30")}
# (model, summers that have data per the archive probe)
JOBS = [
    ("ecmwf_ifs025", (2024, 2025, 2026)),
    ("ecmwf_aifs025_single", (2025, 2026)),
    ("gfs_seamless", (2024, 2025, 2026)),
]
BASE_VARS = ["temperature_2m", "dew_point_2m", "wind_speed_10m"]


def main(out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    s = requests.Session()
    s.headers["User-Agent"] = "research-data-availability-check/1.0"
    names = []
    for v in BASE_VARS:
        names.append(v)
        names += [f"{v}_previous_day{k}" for k in range(1, 8)]
    for model, years in JOBS:
        for y in years:
            a, b = SUMMERS[y]
            for st, (lat, lon) in STATIONS.items():
                dest = out / f"{model}_{st}_{y}.json"
                if dest.exists():
                    continue
                params = {
                    "latitude": lat,
                    "longitude": lon,
                    "models": model,
                    "timezone": "UTC",
                    "start_date": a,
                    "end_date": b,
                    "hourly": ",".join(names),
                }
                for _attempt in range(8):
                    try:
                        r = s.get(PREV, params=params, timeout=180)
                    except requests.RequestException as exc:
                        print(f"  net error {type(exc).__name__}, retry")
                        time.sleep(15)
                        continue
                    if r.status_code == 200:
                        dest.write_text(r.text)
                        print(f"OK {model} {st} {y}")
                        break
                    if r.status_code == 429:
                        print(f"  429 {model} {st} {y}: sleeping 120s ({r.text[:100]})")
                        time.sleep(120)
                        continue
                    print(f"ERR {r.status_code} {model} {st} {y}: {r.text[:200]}")
                    break
                time.sleep(8)


if __name__ == "__main__":
    main(sys.argv[1])
