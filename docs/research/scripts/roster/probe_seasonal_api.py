"""Probe the Open-Meteo Seasonal (EC46/SEAS5) and Ensemble APIs: what is returned, how far back archived forecasts go.
Standard TLS verification. A handful of requests (free tier, tiny weighted cost). Usage: python -I -X utf8 probe_seasonal_api.py <out_dir>
"""

from __future__ import annotations

import sys
from pathlib import Path

import requests

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
LAT, LON = 24.433, 54.651
S = requests.Session()
S.headers["User-Agent"] = "stellar-roster-feasibility/1.0"


def call(name: str, url: str, params: dict) -> dict | None:
    r = S.get(url, params=params, timeout=90)
    (OUT / f"{name}.json").write_text(r.text, encoding="utf-8")
    print(f"--- {name}: HTTP {r.status_code}, {len(r.text)} bytes, URL {r.url[:200]}")
    if r.status_code != 200:
        print("   ", r.text[:300])
        return None
    return r.json()


def summarise(d: dict, block: str) -> None:
    b = d.get(block, {})
    keys = [k for k in b if k != "time"]
    base = [k for k in keys if "_member" not in k]
    members = {k.split("_member")[1] for k in keys if "_member" in k}
    t = b.get("time", [])
    print(f"    block {block}: {len(t)} steps {t[:1]}..{t[-1:]}; base vars {base}; n members {len(members)}")
    for k in base[:3]:
        vals = b[k]
        nn = sum(v is None for v in vals)
        print(f"    {k}: n={len(vals)} null={nn} first={vals[:3]} last={vals[-3:]}")


# 1. default seasonal call, daily T / Td / RH / wind / radiation, 46 days
d = call(
    "seasonal_daily46",
    "https://seasonal-api.open-meteo.com/v1/seasonal",
    {
        "latitude": LAT,
        "longitude": LON,
        "daily": "temperature_2m_mean,dew_point_2m_mean,relative_humidity_2m_mean,wind_speed_10m_mean,shortwave_radiation_sum",
        "forecast_days": 46,
        "timezone": "UTC",
    },
)
if d:
    print("    grid", d["latitude"], d["longitude"], "elev", d.get("elevation"))
    summarise(d, "daily")

# 2. 6-hourly T and Td (needed for WBGT), 46 days
d = call(
    "seasonal_6h46",
    "https://seasonal-api.open-meteo.com/v1/seasonal",
    {
        "latitude": LAT,
        "longitude": LON,
        "six_hourly": "temperature_2m,dew_point_2m,wind_speed_10m,shortwave_radiation",
        "forecast_days": 46,
        "timezone": "UTC",
    },
)
if d:
    summarise(d, "six_hourly")

# 3. archived forecasts: how far back does past_days go?
for pdays in (30, 92, 400):
    d = call(
        f"seasonal_past{pdays}",
        "https://seasonal-api.open-meteo.com/v1/seasonal",
        {
            "latitude": LAT,
            "longitude": LON,
            "daily": "temperature_2m_mean,dew_point_2m_mean",
            "past_days": pdays,
            "forecast_days": 46,
            "timezone": "UTC",
        },
    )
    if d:
        summarise(d, "daily")

# 4. explicit historical window (summer 2025) -- does the endpoint accept start_date/end_date?
d = call(
    "seasonal_hist_2025",
    "https://seasonal-api.open-meteo.com/v1/seasonal",
    {
        "latitude": LAT,
        "longitude": LON,
        "daily": "temperature_2m_mean,dew_point_2m_mean",
        "start_date": "2025-07-01",
        "end_date": "2025-08-15",
        "timezone": "UTC",
    },
)
if d:
    summarise(d, "daily")

# 5. ensemble API (GEFS 0.5 deg: 35 days; ECMWF IFS ENS 15 days): horizon actually returned
for model, days in (("gfs025", 35), ("gfs05", 35), ("ecmwf_ifs025", 16)):
    d = call(
        f"ensemble_{model}",
        "https://ensemble-api.open-meteo.com/v1/ensemble",
        {
            "latitude": LAT,
            "longitude": LON,
            "hourly": "temperature_2m,dew_point_2m",
            "models": model,
            "forecast_days": days,
            "timezone": "UTC",
        },
    )
    if d:
        summarise(d, "hourly")
