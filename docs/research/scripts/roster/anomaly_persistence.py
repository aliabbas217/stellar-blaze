"""How much of the summer WBGT variability is week-scale (potentially forecastable beyond day 7) versus day-scale?

Daily index: mean observed WBGT over local 08:00-17:59 (labels 8..17). Anomaly = index minus the leave-one-summer-out climatology
(mean of the other two summers for the same calendar day, then 15-day centred moving average). Reported per station (6 clusters):
  sd of daily anomaly; share of its variance that is between 7-day blocks; lag-k autocorrelation of the daily anomaly (k = 1..7, 14, 21, 28)
  and of the weekly-mean anomaly (lag 1, 2, 3, 4 weeks), the latter being what a "climatology + persistence" weekly forecast could use.
  Also the skill (1 - MSE/MSE_clim) of the persistence forecast "this week's anomaly persists, damped by the pooled lag-k
  autocorrelation" for k = 1..4 weeks.
Usage: python -I -X utf8 anomaly_persistence.py <hourly_wbgt.parquet> <out_csv>
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from roster_ladder import CLUSTER6, N_DAYS, YEARS, day_matrix  # noqa: E402


def smooth(x: np.ndarray, w: int = 15) -> np.ndarray:
    k = np.ones(w) / w
    pad = w // 2
    xp = np.pad(x, (pad, pad), mode="edge")
    return np.convolve(xp, k, mode="valid")


def acf(x: np.ndarray, lag: int) -> float:
    a, b = x[:-lag], x[lag:]
    m = ~np.isnan(a) & ~np.isnan(b)
    if m.sum() < 5:
        return float("nan")
    return float(np.corrcoef(a[m], b[m])[0, 1])


def main(parquet: str, out_csv: str) -> None:
    df = pd.read_parquet(parquet)
    rows = []
    for st in CLUSTER6:
        d = df[df.station == st]
        idx = np.full((len(YEARS), N_DAYS), np.nan)
        for yi, y in enumerate(YEARS):
            wd = day_matrix(d, "wbgt_obs", y)
            sel = wd[:, 8:18]
            ok = ~np.isnan(sel).any(axis=1)
            idx[yi] = np.where(ok, sel.mean(axis=1), np.nan)
        anom = np.full_like(idx, np.nan)
        for yi in range(len(YEARS)):
            others = np.nanmean(np.delete(idx, yi, axis=0), axis=0)
            clim = smooth(np.where(np.isnan(others), np.nanmean(others), others))
            anom[yi] = idx[yi] - clim
        sd = float(np.nanstd(anom))
        # variance share between 7-day blocks
        blocks = np.tile(np.arange(N_DAYS) // 7, (len(YEARS), 1))
        flat_a, flat_b = anom.ravel(), (blocks + 100 * np.arange(len(YEARS))[:, None]).ravel()
        s = pd.DataFrame({"a": flat_a, "b": flat_b}).dropna()
        gm = s.groupby("b").a.transform("mean")
        share_between = 100 * (1 - ((s.a - gm) ** 2).sum() / ((s.a - s.a.mean()) ** 2).sum())
        rec = {"station": st, "sd_daily_anom_C": sd, "share_var_between_7d_blocks_pct": share_between}
        for lag in (1, 2, 3, 5, 7, 14, 21, 28):
            rec[f"acf_day_lag{lag}"] = float(np.nanmean([acf(anom[yi], lag) for yi in range(len(YEARS))]))
        wk = np.array([[np.nanmean(anom[yi, g * 7 : (g + 1) * 7]) for g in range(19)] for yi in range(len(YEARS))])  # 19 full weeks
        for lag in (1, 2, 3, 4):
            rec[f"acf_week_lag{lag}"] = float(np.nanmean([acf(wk[yi], lag) for yi in range(len(YEARS))]))
            # skill of damped persistence forecast (pooled over years; coefficient = pooled lag-k acf, in-sample)
            a = np.concatenate([wk[yi, :-lag] for yi in range(len(YEARS))])
            b = np.concatenate([wk[yi, lag:] for yi in range(len(YEARS))])
            m = ~np.isnan(a) & ~np.isnan(b)
            beta = float((a[m] * b[m]).sum() / (a[m] ** 2).sum())
            mse_p = float(((b[m] - beta * a[m]) ** 2).mean())
            mse_c = float((b[m] ** 2).mean())
            rec[f"skill_week_lag{lag}_pct"] = 100 * (1 - mse_p / mse_c)
        rows.append(rec)
    out = pd.DataFrame(rows)
    out.to_csv(out_csv, index=False)
    pd.set_option("display.width", 250)
    pd.set_option("display.max_columns", 40)
    print(out.round(2).to_string(index=False))
    print(out.drop(columns="station").mean().round(2).to_string())


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
