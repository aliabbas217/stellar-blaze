"""Second probe: which historical windows of the Open-Meteo seasonal endpoint hold non-null values (is there any back-test archive)?
Usage: python -I -X utf8 probe_seasonal_api2.py <out_dir>
"""

from __future__ import annotations

import sys
from pathlib import Path

import requests

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
S = requests.Session()
S.headers["User-Agent"] = "stellar-roster-feasibility/1.0"
LAT, LON = 24.433, 54.651
URL = "https://seasonal-api.open-meteo.com/v1/seasonal"


def nonnull(d: dict, var: str) -> tuple[int, int, str, str]:
    b = d["daily"]
    t = b["time"]
    v = b[var]
    idx = [i for i, x in enumerate(v) if x is not None]
    return len(v), len(idx), (t[idx[0]] if idx else ""), (t[idx[-1]] if idx else "")


for name, params in {
    "w_2025_09": {"start_date": "2025-09-01", "end_date": "2025-12-31"},
    "w_2026_06_08": {"start_date": "2026-06-01", "end_date": "2026-08-31"},
    "w_2026_09_10": {"start_date": "2026-09-01", "end_date": "2026-10-31"},
    "w_2026_01_03": {"start_date": "2026-01-01", "end_date": "2026-03-31"},
}.items():
    r = S.get(
        URL,
        params={"latitude": LAT, "longitude": LON, "daily": "temperature_2m_mean,dew_point_2m_mean", "timezone": "UTC", **params},
        timeout=90,
    )
    print(name, r.status_code, r.url[-110:])
    if r.status_code != 200:
        print("   ", r.text[:250])
        continue
    d = r.json()
    (OUT / f"{name}.json").write_text(r.text, encoding="utf-8")
    print("   steps, non-null, first non-null, last non-null:", nonnull(d, "temperature_2m_mean"))
    members = [k for k in d["daily"] if "_member" in k and k.startswith("temperature_2m_mean")]
    print("   members in response:", len(members), "; member01 non-null:", nonnull(d, members[0]) if members else None)

# the six-hourly error text, for the record
r = S.get(
    URL,
    params={"latitude": LAT, "longitude": LON, "six_hourly": "temperature_2m,dew_point_2m", "forecast_days": 10, "timezone": "UTC"},
    timeout=90,
)
print("six_hourly attempt:", r.status_code, r.text[:300])
