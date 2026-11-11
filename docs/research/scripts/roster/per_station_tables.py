"""Per-station and per-summer view of the ladder (avoided % vs the 06:00-12:30 + 15:00-17:00 baseline, same 8.5 productive hours)."""

import sys

import pandas as pd

lad = pd.read_csv(sys.argv[1] + "/ladder.csv")
lad["scale"] = 139 / lad.n_days
for c in ("E28", "E30", "E32"):
    lad[c] = lad[c] * lad.scale
pd.set_option("display.width", 250)
S = ["seasonal_loso", "monthly_loso", "weekly_oracle", "daily_fc1_raw", "daily_oracle"]
for lib in ("DAY", "EVE", "ALL"):
    x = lad[lad.library == lib]
    base = x[x.strategy == "fixed_baseline"].set_index(["station", "year"])
    rows = []
    for st in ["OMAA", "OMAD", "OMAL", "OMDB", "OMDW", "OMFJ", "OMSJ", "OMRK"]:
        rec = {"station": st, "base_E30": base.loc[st].E30.mean(), "base_E32": base.loc[st].E32.mean()}
        for s in S:
            y = x[(x.strategy == s) & (x.station == st)].set_index("year")
            b = base.loc[st]
            rec[f"{s}_E30av%"] = 100 * (1 - y.E30.mean() / b.E30.mean())
            rec[f"{s}_E32av%"] = 100 * (1 - y.E32.mean() / b.E32.mean())
        rows.append(rec)
    print(f"== {lib}: per station (mean of 3 summers)")
    print(pd.DataFrame(rows).round(1).to_string(index=False))
    rows = []
    for yr in (2024, 2025, 2026):
        for s in ["seasonal_loso", "daily_oracle"]:
            y = x[(x.strategy == s) & (x.year == yr) & x.station.isin(["OMAA", "OMDB", "OMAL", "OMFJ"])]
            b = base.xs(yr, level="year").loc[["OMAA", "OMDB", "OMAL", "OMFJ"]]
            rows.append(
                {
                    "year": yr,
                    "strategy": s,
                    "base_E30": b.E30.mean(),
                    "E30av%": 100 * (1 - y.E30.mean() / b.E30.mean()),
                    "E32av%": 100 * (1 - y.E32.mean() / b.E32.mean()),
                }
            )
    print(f"== {lib}: per summer, 4 headline stations")
    print(pd.DataFrame(rows).round(1).to_string(index=False))
