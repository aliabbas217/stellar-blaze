import sys
from pathlib import Path

import numpy as np
import pandas as pd

d = Path(sys.argv[1])
pd.set_option("display.width", 250)
pd.set_option("display.max_columns", 50)
pd.set_option("display.max_rows", 500)
C6 = ["OMAA", "OMDB", "OMDW", "OMAL", "OMFJ", "OMRK"]

ff = pd.read_csv(d / "freeform.csv")
ff = ff[ff.station.isin(C6)]
print(
    "== freeform (17 half-hour slots, any pattern): fixed (LOSO slots) vs daily hindsight; mean over 6 clusters x 3 summers, per 139 days"
)
g = ff.groupby("library")[["fixed_E28", "fixed_E30", "fixed_E32", "daily_E28", "daily_E30", "daily_E32"]].mean().round(0)
for t in (28, 30, 32):
    g[f"daily_gain_E{t}_%"] = (100 * (1 - g[f"daily_E{t}"] / g[f"fixed_E{t}"])).round(1)
print(g)
print(ff[ff.station == "OMAA"][["library", "year", "fixed_slots"]].drop_duplicates(["library", "year"]).to_string(index=False))

rg = pd.read_csv(d / "weekly_regret.csv")
print("\n== weekly regret of holding seasonal_loso vs weekly best (severity hours/week and % of that week's severity)")
for lib in ("DAY", "EVE"):
    x = rg[rg.library == lib]
    print(
        lib,
        "n weeks",
        len(x),
        "median rel regret %",
        round(x.rel_regret_pct.median(), 2),
        "mean",
        round(x.rel_regret_pct.mean(), 2),
        "p90",
        round(x.rel_regret_pct.quantile(0.9), 2),
        "p99",
        round(x.rel_regret_pct.quantile(0.99), 2),
        "max",
        round(x.rel_regret_pct.max(), 2),
        "share weeks regret<=2%",
        round(100 * (x.rel_regret_pct <= 2).mean(), 1),
        "share <=5%",
        round(100 * (x.rel_regret_pct <= 5).mean(), 1),
        "mean regret sev-h/week",
        round(x.regret.mean(), 2),
        "mean sev-h/week",
        round(x.sev_seasonal.mean(), 1),
    )

wb = pd.read_csv(d / "weekly_best_rosters.csv")
print("\n== weekly best roster (oracle): distribution of morning start/end and evening start")
for lib in ("DAY", "EVE"):
    x = wb[wb.library == lib]
    print(lib, "morning_start value counts:", x.morning_start.value_counts(normalize=True).round(3).to_dict())
    print(lib, "morning_end value counts:", x.morning_end.value_counts(normalize=True).sort_index().round(3).to_dict())
    print(lib, "evening_start value counts:", x.evening_start.value_counts(normalize=True).sort_index().round(3).to_dict())
    # week-to-week change of morning_end
    ch = []
    for (_st, _y), gg in x.groupby(["station", "year"]):
        gg = gg.sort_values("week")
        ch.append((gg.morning_end.diff().abs() > 0).mean())
    print(
        lib,
        "share of week transitions where morning end changes:",
        round(float(np.nanmean(ch)), 3),
        "; where morning START changes:",
        round(
            float(np.nanmean([(gg.sort_values("week").morning_start.diff().abs() > 0).mean() for _, gg in x.groupby(["station", "year"])])),
            3,
        ),
    )

ds = pd.read_csv(d / "diurnal_stability.csv")
print("\n== diurnal stability: summer vs summer profile")
x = ds[ds.kind.str.contains("vs") & ~ds.kind.str.startswith("week")]
print(x.groupby("kind")[["max_abs_diff_C", "mean_abs_diff_C", "spearman"]].mean().round(2))
print(x[x.station.isin(C6)].groupby("station")[["max_abs_diff_C", "mean_abs_diff_C", "spearman"]].mean().round(2))
w = ds[ds.kind == "week_vs_other_summers"]
w = w[w.station.isin(C6)]
print(
    "week profile Spearman vs other-summers profile: median",
    round(w.spearman.median(), 3),
    "p10",
    round(w.spearman.quantile(0.1), 3),
    "min",
    round(w.spearman.min(), 3),
)
print(
    "share of weeks whose coolest hour equals other-summers coolest hour:",
    round(100 * (w.coolest_hour_week == w.coolest_hour_other).mean(), 1),
    "; within 1 h:",
    round(100 * ((w.coolest_hour_week - w.coolest_hour_other).abs() <= 1).mean(), 1),
)
print(w.groupby("station")[["first_hour_ge30_week"]].agg(["mean", "std"]).round(2))
fe = pd.read_csv(d / "first_hour_ge30.csv")
print("\n== time of first WBGT>=30 after 05:00 (local): variance decomposition")
print(fe.round(1).to_string(index=False))
