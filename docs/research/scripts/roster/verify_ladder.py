"""Independent re-computation (plain pandas, no shared code with roster_ladder.py) of a few ladder numbers for cross-checking.

Checks: (1) baseline roster exposure for OMAA/OMDB 2025 by direct hour-by-hour accumulation; (2) best DAY-library seasonal roster
(in-sample, severity objective) by brute force over a hand-rolled roster list; (3) compares to ladder.csv / named_rosters.csv.
"""

import sys

import numpy as np
import pandas as pd

hourly = pd.read_parquet(sys.argv[1])
lad = pd.read_csv(sys.argv[2] + "/ladder.csv")
nr = pd.read_csv(sys.argv[2] + "/named_rosters.csv")

hourly["local"] = hourly.time_utc + pd.Timedelta(hours=4)


def exposure_direct(st: str, yr: int, blocks, thr: float) -> tuple[float, int]:
    """Sum over days of overlap-weighted count of hours with WBGT >= thr; independent loop implementation."""
    d = hourly[(hourly.station == st) & (hourly.year == yr)].set_index("local").wbgt_obs
    tot, ndays = 0.0, 0
    for day in pd.date_range(f"{yr}-05-15", f"{yr}-09-30"):
        e, ok = 0.0, True
        for a, b in blocks:
            # label h at local time day+h hours covers [h-0.5, h+0.5)
            for h in range(int(np.floor(a)), int(np.ceil(b)) + 1):
                w = max(0.0, min(b, h + 0.5) - max(a, h - 0.5))
                if w <= 0:
                    continue
                ts = day + pd.Timedelta(hours=h)
                v = d.get(ts, np.nan)
                if np.isnan(v):
                    ok = False
                    break
                e += w * (v >= thr)
            if not ok:
                break
        if ok:
            tot += e
            ndays += 1
    return tot, ndays


base = [(6.0, 12.5), (15.0, 17.0)]
for st in ("OMAA", "OMDB"):
    for thr in (28.0, 30.0, 32.0):
        e, n = exposure_direct(st, 2025, base, thr)
        row = nr[(nr.station == st) & (nr.year == 2025) & nr.roster.str.startswith("N1")].iloc[0]
        print(
            f"{st} 2025 baseline E{int(thr)}: direct {e:.1f} over {n} days | "
            f"named_rosters.csv {row[f'E{int(thr)}_h']:.1f} ({row.days_used} days)"
        )

# brute force best DAY roster (in-sample) for OMAA 2025, severity objective, using the direct function
best = None
cands = []
for s in np.arange(4.5, 8.01, 0.5):
    for lm in np.arange(4.5, 8.01, 0.5):
        if s + lm > 12.5 + 1e-9:
            continue
        le = 8.5 - lm
        for e0 in np.arange(15.0, 20.51, 0.5):
            if e0 + le <= 19.5 + 1e-9:
                cands.append(((float(s), float(s + lm)), (float(e0), float(e0 + le))))
print("DAY candidates (brute force):", len(cands))
res = []
for c in cands:
    sev = sum(exposure_direct("OMAA", 2025, list(c), t)[0] for t in (28.0, 30.0, 32.0))
    res.append((sev, c))
res.sort()
print("best 3 by direct brute force, OMAA 2025 in-sample severity:", res[:3])
x = lad[(lad.library == "DAY") & (lad.station == "OMAA") & (lad.year == 2025) & (lad.strategy == "seasonal_oracle")].iloc[0]
print("ladder.csv seasonal_oracle OMAA 2025 DAY: E28/E30/E32 =", x.E28, x.E30, x.E32, "sum", x.E28 + x.E30 + x.E32, "n_days", x.n_days)
