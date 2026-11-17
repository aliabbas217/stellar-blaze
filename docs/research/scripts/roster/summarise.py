"""Summarise roster_ladder.py CSVs into the tables used in the report (stdout markdown-ish)."""

import sys
from pathlib import Path

import pandas as pd

d = Path(sys.argv[1])
pd.set_option("display.width", 250)
pd.set_option("display.max_columns", 50)
pd.set_option("display.max_rows", 500)
HEAD = ["OMAA", "OMDB", "OMAL", "OMFJ"]
C6 = ["OMAA", "OMDB", "OMDW", "OMAL", "OMFJ", "OMRK"]

nr = pd.read_csv(d / "named_rosters.csv")
for _c in ("E28_h", "E30_h", "E32_h"):
    nr[_c] = nr[_c] * 139 / nr.days_used  # per 139 days (days_used = common valid days, 137-138 when the night roster is included)
print("== Named rosters, mean over 3 summers, per summer exposure worker-hours (139 days) and share of scheduled hours")
g = (
    nr[nr.station.isin(HEAD)]
    .groupby(["station", "roster"])
    .agg(
        sched=("sched_hours_per_day", "first"),
        E28=("E28_h", "mean"),
        E30=("E30_h", "mean"),
        E32=("E32_h", "mean"),
        s28=("share28_pct", "mean"),
        s30=("share30_pct", "mean"),
        s32=("share32_pct", "mean"),
    )
    .round(1)
)
print(g)
print("\n== Named rosters, mean over 4 headline stations x 3 summers")
g2 = (
    nr[nr.station.isin(HEAD)]
    .groupby("roster")
    .agg(
        sched=("sched_hours_per_day", "first"),
        E28=("E28_h", "mean"),
        E30=("E30_h", "mean"),
        E32=("E32_h", "mean"),
        s28=("share28_pct", "mean"),
        s30=("share30_pct", "mean"),
        s32=("share32_pct", "mean"),
    )
    .round(1)
)
print(g2)
g3 = (
    nr[nr.station.isin(C6)]
    .groupby("roster")
    .agg(
        sched=("sched_hours_per_day", "first"),
        E28=("E28_h", "mean"),
        E30=("E30_h", "mean"),
        E32=("E32_h", "mean"),
        s28=("share28_pct", "mean"),
        s30=("share30_pct", "mean"),
        s32=("share32_pct", "mean"),
    )
    .round(1)
)
print("\n== same, 6 clusters")
print(g3)

lad = pd.read_csv(d / "ladder.csv")
order = [
    "fixed_baseline",
    "seasonal_loso",
    "seasonal_oracle",
    "monthly_loso",
    "monthly_oracle",
    "weekly_clim_loso",
    "weekly_persist",
    "weekly_fc_raw",
    "weekly_fc_bc",
    "weekly_oracle",
    "daily_persist",
    "daily_fc3_raw",
    "daily_fc3_bc",
    "daily_fc1_raw",
    "daily_fc1_bc",
    "daily_oracle",
]
for lib in ("DAY", "EVE", "ALL"):
    for label, sts in (("4 headline", HEAD), ("6 clusters", C6), ("all 8", None)):
        x = lad[(lad.library == lib)]
        if sts:
            x = x[x.station.isin(sts)]
        # per station-summer values, normalised per 139 days using valid days: scale to per-139-days
        x = x.assign(scale=139 / x.n_days)
        for c in ("E28", "E30", "E32"):
            x[c] = x[c] * x.scale
        agg = x.groupby("strategy")[["E28", "E30", "E32"]].mean().reindex(order)
        base = agg.loc["fixed_baseline"]
        out = agg.round(0).copy()
        for c in ("E28", "E30", "E32"):
            out[f"{c}_avoid%"] = (100 * (1 - agg[c] / base[c])).round(1)
        orc = agg.loc["daily_oracle"]
        out["capt_of_daily_oracle_E30%"] = (100 * (base["E30"] - agg["E30"]) / (base["E30"] - orc["E30"])).round(0)
        print(
            f"\n== Ladder, library {lib}, {label} (mean per station-summer, worker-hours per 139 days; avoid% vs 06:00-12:30+15:00-17:00)"
        )
        print(out)
