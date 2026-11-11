import sys
from pathlib import Path

import pandas as pd

d = Path(sys.argv[1])
pd.set_option("display.width", 250)
pd.set_option("display.max_columns", 50)
pd.set_option("display.max_rows", 500)
HEAD = ["OMAA", "OMDB", "OMAL", "OMFJ"]
C6 = ["OMAA", "OMDB", "OMDW", "OMAL", "OMFJ", "OMRK"]

ch = pd.read_csv(d / "chosen_rosters.csv")
print("== chosen rosters: seasonal_loso, headline stations (by year)")
x = ch[(ch.strategy == "seasonal_loso") & ch.station.isin(HEAD)].drop_duplicates(["library", "station", "year"])
print(x.pivot_table(index=["library", "station"], columns="year", values="roster", aggfunc="first").to_string())
print("\n== chosen rosters: monthly_loso 2025 (DAY and ALL), headline stations")
x = ch[(ch.strategy == "monthly_loso") & ch.station.isin(HEAD) & (ch.year == 2025)]
print(x.pivot_table(index=["library", "station"], columns="month", values="roster", aggfunc="first").to_string())

sw = pd.read_csv(d / "switches.csv")
print("\n== switches (mean over stations); changes_per_summer between consecutive decision units (weeks for weekly*, days for daily*)")
print(
    sw[sw.station.isin(C6)]
    .groupby(["library", "strategy"])[["changes_per_summer", "mean_abs_start_shift_min"]]
    .mean()
    .round(1)
    .loc[["DAY", "EVE", "ALL"]]
    .to_string()
)

lad = pd.read_csv(d / "ladder.csv")
lad["scale"] = 139 / lad.n_days
for c in ("E28", "E30", "E32"):
    lad[c] = lad[c] * lad.scale
lad["S"] = lad.E28 + lad.E30 + lad.E32
print("\n== paired differences vs seasonal_loso, per station-summer (negative = fewer dangerous worker-hours than fixed seasonal)")
rows = []
for lib in ("DAY", "EVE", "ALL"):
    for _set_name, sts in (("6clusters", C6),):
        x = lad[(lad.library == lib) & lad.station.isin(sts)]
        piv = x.pivot_table(index=["station", "year"], columns="strategy", values=["E28", "E30", "E32"])
        for strat in (
            "monthly_loso",
            "monthly_oracle",
            "weekly_clim_loso",
            "weekly_persist",
            "weekly_fc_raw",
            "weekly_fc_bc",
            "weekly_oracle",
            "daily_fc3_raw",
            "daily_fc1_raw",
            "daily_fc1_bc",
            "daily_persist",
            "daily_oracle",
        ):
            rec = {"lib": lib, "strategy": strat}
            for c in ("E30", "E32"):
                diff = piv[c][strat] - piv[c]["seasonal_loso"]
                rec[f"{c}_mean_diff"] = diff.mean()
                rec[f"{c}_pct_of_seasonal"] = 100 * diff.mean() / piv[c]["seasonal_loso"].mean()
                rec[f"{c}_n_better"] = int((diff < -0.5).sum())
                rec[f"{c}_n_worse"] = int((diff > 0.5).sum())
                rec[f"{c}_n"] = len(diff)
            rows.append(rec)
print(pd.DataFrame(rows).round(1).to_string(index=False))

fr = pd.read_csv(d / "frontier.csv")
print(
    "\n== frontier: mean exposure (6 clusters, 3 summers) vs allowed roster changes per summer;"
    " oracle vs clim_loso; E30, E32; baseline for reference"
)
fr = fr[fr.station.isin(C6)]
for lib in ("DAY", "EVE", "ALL"):
    f = fr[fr.library == lib]
    g = f.groupby(["mode", "k_allowed"])[["E30", "E32", "base_E30", "base_E32"]].mean()
    show = g.loc[(slice(None), [0, 1, 2, 3, 4, 6, 9, 14, 19]), :].round(0)
    print("library", lib)
    print(show.to_string())
