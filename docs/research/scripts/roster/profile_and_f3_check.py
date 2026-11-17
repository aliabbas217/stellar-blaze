"""Hourly WBGT profile and the plan-F3 cross-check, from hourly_wbgt.parquet (build_wbgt.py).

1. Mean observed WBGT by local hour (UTC+4), June-August, per station.
2. Plan F3 cross-check: share of local label hours 06-18, 15 Jun-15 Sep 2025, with WBGT >= 28/30/32, observed vs IFS lead-1 forecast
   (raw and bias-corrected), plus lead-1 WBGT bias and MAE.
Usage: python -I -X utf8 profile_and_f3_check.py <hourly_wbgt.parquet>
"""

import sys

import pandas as pd

df = pd.read_parquet(sys.argv[1])
df["local"] = df["time_utc"] + pd.Timedelta(hours=4)
df["lh"] = df["local"].dt.hour
pd.set_option("display.width", 250)
pd.set_option("display.max_columns", 40)

jja = df[df["local"].dt.month.isin([6, 7, 8])]
print("== mean observed WBGT by local hour, June-August 2024-2026")
print(jja.groupby(["station", "lh"]).wbgt_obs.mean().unstack(0).round(1).to_string())

m = (df.local >= "2025-06-15") & (df.local < "2025-09-16") & df.lh.between(6, 18)
rows = []
for st in ["OMAA", "OMDB", "OMAL", "OMFJ"]:
    s = df[(df.station == st) & (df.year == 2025) & m]
    rows.append(
        {
            "station": st,
            "obs>=28": round(100 * (s.wbgt_obs >= 28).mean(), 1),
            "obs>=30": round(100 * (s.wbgt_obs >= 30).mean(), 1),
            "obs>=32": round(100 * (s.wbgt_obs >= 32).mean(), 1),
            "L1raw>=32": round(100 * (s.wbgt_L1 >= 32).mean(), 1),
            "L1bc>=32": round(100 * (s.wbgt_bc1 >= 32).mean(), 1),
            "L3raw>=32": round(100 * (s.wbgt_L3 >= 32).mean(), 1),
            "bias_L1": round((s.wbgt_L1 - s.wbgt_obs).mean(), 2),
            "MAE_L1": round((s.wbgt_L1 - s.wbgt_obs).abs().mean(), 2),
            "MAE_bc1": round((s.wbgt_bc1 - s.wbgt_obs).abs().mean(), 2),
            "n_hours": len(s),
        }
    )
print("\n== plan F3 cross-check, 15 Jun-15 Sep 2025, local label hours 06-18 (share of hours, %)")
print(pd.DataFrame(rows).to_string(index=False))
