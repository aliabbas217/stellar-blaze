"""Fetch Open-Meteo ARCHIVE radiation + surface pressure at the 8 UAE METAR stations, summers 2024-2026.

Why: IEM METAR (the truth source, ADR 0005) has no radiation and no station pressure; Liljegren WBGT needs both.
Source: archive-api.open-meteo.com, model ecmwf_ifs (IFS HRES 9 km analysis-based archive; the audited script
`future-health-challenge/scripts/audit_wbgt.py` showed Open-Meteo's default series equals ecmwf_ifs at Abu Dhabi points).
A sensitivity pull with models=era5 is made for two stations to size the radiation-source effect.
Variables: shortwave_radiation, direct_radiation (mean over the PRECEDING hour), surface_pressure (instantaneous). UTC.
Cost on the free tier: 3 variables x 139 days is about 3 weighted calls per request; 30 requests = about 90 calls.
Usage: python -I fetch_radiation.py <out_dir>
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import requests

ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
STATIONS = {  # lat, lon (NOAA GHCNh station list; same as fetch_forecast_stations.py)
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
VARS = "shortwave_radiation,direct_radiation,surface_pressure"
JOBS = [("ecmwf_ifs", list(STATIONS)), ("era5", ["OMAA", "OMDB"])]


def main(out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    s = requests.Session()
    s.headers["User-Agent"] = "stellar-roster-feasibility/1.0"
    for model, stations in JOBS:
        for y, (a, b) in SUMMERS.items():
            for st in stations:
                dest = out / f"archive_{model}_{st}_{y}.json"
                if dest.exists():
                    continue
                lat, lon = STATIONS[st]
                params = {
                    "latitude": lat,
                    "longitude": lon,
                    "models": model,
                    "timezone": "UTC",
                    "start_date": a,
                    "end_date": b,
                    "hourly": VARS,
                }
                for _attempt in range(6):
                    try:
                        r = s.get(ARCHIVE, params=params, timeout=120)
                    except requests.RequestException as exc:
                        print(f"  net error {type(exc).__name__}, retry")
                        time.sleep(15)
                        continue
                    if r.status_code == 200:
                        dest.write_text(r.text, encoding="utf-8")
                        print(f"OK {model} {st} {y} {len(r.text)} bytes")
                        break
                    if r.status_code == 429:
                        print(f"  429 {model} {st} {y}: {r.text[:120]} -> sleep 90 s")
                        time.sleep(90)
                        continue
                    print(f"ERR {r.status_code} {model} {st} {y}: {r.text[:200]}")
                    break
                time.sleep(3)


if __name__ == "__main__":
    main(sys.argv[1])
