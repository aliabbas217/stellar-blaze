"""Summarise probe_result.json from probe_forecast_archive.py into markdown-friendly tables.
Usage: python -I summarize_forecast_probe.py <probe_dir>
"""

import json
import sys
from pathlib import Path

d = Path(sys.argv[1])
res = json.loads((d / "probe_result.json").read_text())
print("== A: first non-null time (UTC), 2021-01-01..2026-11-10 request window")
for k in ("A_prev_day1_first", "A_hist_first"):
    print(k)
    for m, v in res[k].items():
        print(" ", m, v if not v.get("error") else v)
print("== B: non-null counts / 3336, per model-summer-variable for lead 0 (day0) and previous_day 1,2,3,5,7")
VARS = ["temperature_2m", "dew_point_2m", "wind_speed_10m", "shortwave_radiation", "direct_radiation", "surface_pressure"]
for key, v in res["B_counts"].items():
    if v.get("error"):
        print(key, "ERROR", v.get("status"), str(v.get("reason"))[:100])
        continue
    c = v["counts"]
    line = []
    for var in VARS:
        leads = [c.get(var if k == 0 else f"{var}_previous_day{k}") for k in (0, 1, 2, 3, 5, 7)]
        line.append(f"{var[:9]}:{leads}")
    print(key, " ".join(line))
