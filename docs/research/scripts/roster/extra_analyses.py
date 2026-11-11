"""Extra analyses supporting the roster-feasibility note.

1. freeform  : relaxes the roster-template structure. Per day, pick the 17 half-hour slots (8.5 h) with the lowest WBGT severity inside an
               allowed
               window (DAY 04:30-19:30, EVE to 22:00, ALL = EVE plus night slots up to 04:30), no work in the 12:30-15:00 ban.
               'fixed' = the same 17 slots every day (best on the other two summers);
               'daily' = hindsight per day (upper bound on ANY daily adaptation).
2. regret    : per-week regret of holding the seasonal (LOSO) roster versus the weekly best roster, and where the weekly best roster sits.
3. diurnal   : how stable the diurnal WBGT pattern is: summer-to-summer profile differences, week-to-season rank correlation, and a variance
               decomposition of the daily time when WBGT first reaches 30 degC (between-week vs within-week).
Usage: python -I -X utf8 extra_analyses.py <hourly_wbgt.parquet> <out_dir>
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from roster_ladder import (  # noqa: E402
    CLUSTER6,
    N_DAYS,
    NH,
    STATIONS,
    THRS,
    YEARS,
    Roster,
    Station,
    build_libraries,
    day_matrix,
    run_ladder,
)

SLOT = 0.5
N_SLOTS = 17  # 8.5 h


def slot_matrix(wd: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Half-hour slot WBGT [D, 2*NH] by linear interpolation of the hourly labels at the slot mid-points; slot starts x = 0, 0.5, ..."""
    starts = np.arange(0, NH, SLOT)
    mids = starts + SLOT / 2
    out = np.full((wd.shape[0], len(starts)), np.nan)
    hrs = np.arange(NH)
    for d in range(wd.shape[0]):
        row = wd[d]
        lo = np.floor(mids).astype(int)
        hi = np.minimum(lo + 1, NH - 1)
        frac = mids - lo
        v = row[lo] * (1 - frac) + row[hi] * frac
        out[d] = v
    _ = hrs
    return starts, out


def allowed_slots(starts: np.ndarray, lib: str) -> np.ndarray:
    end = starts + SLOT
    ban = (starts < 15.0) & (end > 12.5)
    if lib == "DAY":
        ok = (starts >= 4.5) & (end <= 19.5)
    elif lib == "EVE":
        ok = (starts >= 4.5) & (end <= 22.0)
    else:
        ok = ((starts >= 4.5) & (end <= 22.0)) | ((starts >= 19.0) & (end <= 28.5))
    return ok & ~ban


def slot_sev(w: np.ndarray) -> np.ndarray:
    return sum((w >= t).astype(float) for t in THRS)


def freeform(df: pd.DataFrame, out: Path) -> None:
    rows = []
    for lib in ("DAY", "EVE", "ALL"):
        for st in STATIONS:
            d = df[df.station == st]
            per_year = {}
            for y in YEARS:
                starts, sw = slot_matrix(day_matrix(d, "wbgt_obs", y))
                per_year[y] = sw
            ok = allowed_slots(starts, lib)
            idx = np.nonzero(ok)[0]
            for y in YEARS:
                sw = per_year[y]
                valid = ~np.isnan(sw[:, idx]).any(axis=1)  # day usable if every allowed slot has a value
                sev = slot_sev(sw[:, idx])
                score = sev + 1e-3 * sw[:, idx]  # tie-break toward cooler slots
                # daily oracle: 17 lowest-score slots per day
                order = np.argsort(score, axis=1)[:, :N_SLOTS]
                res_daily = dict.fromkeys(THRS, 0.0)
                for t in THRS:
                    hot = (sw[:, idx] >= t).astype(float) * SLOT
                    res_daily[t] = float(np.take_along_axis(hot, order, axis=1)[valid].sum())
                # fixed: best 17 slots by mean score on the OTHER years (LOSO)
                tot = np.zeros(len(idx))
                cnt = 0
                for yo in YEARS:
                    if yo == y:
                        continue
                    sw_o = per_year[yo][:, idx]
                    vo = ~np.isnan(sw_o).any(axis=1)
                    tot += (slot_sev(sw_o) + 1e-3 * sw_o)[vo].sum(axis=0)
                    cnt += int(vo.sum())
                fixed_idx = np.argsort(tot)[:N_SLOTS]
                res_fixed = {}
                for t in THRS:
                    hot = (sw[:, idx] >= t).astype(float) * SLOT
                    res_fixed[t] = float(hot[valid][:, fixed_idx].sum())
                scale = 139 / valid.sum()
                rows.append(
                    {
                        "library": lib,
                        "station": st,
                        "year": y,
                        "n_days": int(valid.sum()),
                        **{f"fixed_E{int(t)}": res_fixed[t] * scale for t in THRS},
                        **{f"daily_E{int(t)}": res_daily[t] * scale for t in THRS},
                        "fixed_slots": ",".join(f"{starts[idx][i]:.1f}" for i in sorted(fixed_idx)),
                    }
                )
    pd.DataFrame(rows).to_csv(out / "freeform.csv", index=False)


def regret(df: pd.DataFrame, out: Path) -> None:
    day, eve, allr = build_libraries()
    rows, wrows = [], []
    base = Roster("base", ((6.0, 12.5), (15.0, 17.0)), "day")
    for lib_name, lib in (("DAY", day), ("EVE", eve)):
        bi = next(i for i, r in enumerate(lib) if r.blocks == base.blocks)
        for st in CLUSTER6:
            stn = Station(df, st, lib)
            ch = run_ladder(stn, bi)
            sev = np.where(stn.dmask[:, :, None], np.nan_to_num(stn.sev), 0.0)
            for yi, y in enumerate(YEARS):
                for g in range(int(stn.wk.max()) + 1):
                    sel = stn.wk[yi] == g
                    if not stn.dmask[yi][sel].any():
                        continue
                    s_all = sev[yi][sel].sum(axis=0)
                    r_best = int(ch["weekly_oracle"][yi][sel][0])
                    r_seas = int(ch["seasonal_loso"][yi][sel][0])
                    rows.append(
                        {
                            "library": lib_name,
                            "station": st,
                            "year": y,
                            "week": g,
                            "sev_best": s_all[r_best],
                            "sev_seasonal": s_all[r_seas],
                            "regret": s_all[r_seas] - s_all[r_best],
                            "rel_regret_pct": 100 * (s_all[r_seas] - s_all[r_best]) / max(s_all[r_seas], 1e-9),
                        }
                    )
                    b = lib[r_best].blocks
                    wrows.append(
                        {
                            "library": lib_name,
                            "station": st,
                            "year": y,
                            "week": g,
                            "morning_start": b[0][0],
                            "morning_end": b[0][1],
                            "evening_start": b[1][0] if len(b) > 1 else np.nan,
                            "evening_end": b[1][1] if len(b) > 1 else np.nan,
                        }
                    )
    pd.DataFrame(rows).to_csv(out / "weekly_regret.csv", index=False)
    pd.DataFrame(wrows).to_csv(out / "weekly_best_rosters.csv", index=False)


def diurnal(df: pd.DataFrame, out: Path) -> None:
    rows, prof_rows, fe_rows = [], [], []
    for st in STATIONS:
        d = df[df.station == st]
        profs = {}
        for y in YEARS:
            wd = day_matrix(d, "wbgt_obs", y)[:, :24]  # local hours 0..23 of each day
            profs[y] = np.nanmean(wd, axis=0)
            for h in range(24):
                prof_rows.append({"station": st, "year": y, "hour": h, "mean_wbgt": profs[y][h]})
        # summer-to-summer profile differences
        for a in range(3):
            for b in range(a + 1, 3):
                diff = np.abs(profs[YEARS[a]] - profs[YEARS[b]])
                rho = pd.Series(profs[YEARS[a]]).corr(pd.Series(profs[YEARS[b]]), method="spearman")
                rows.append(
                    {
                        "station": st,
                        "kind": f"{YEARS[a]}vs{YEARS[b]}",
                        "max_abs_diff_C": diff.max(),
                        "mean_abs_diff_C": diff.mean(),
                        "spearman": rho,
                    }
                )
        # weekly profile vs the other summers' seasonal profile
        for y in YEARS:
            others = np.nanmean([profs[yo] for yo in YEARS if yo != y], axis=0)
            wd = day_matrix(d, "wbgt_obs", y)[:, :24]
            for g in range(20):
                sel = slice(g * 7, min((g + 1) * 7, N_DAYS))
                wp = np.nanmean(wd[sel], axis=0)
                rho = pd.Series(wp).corr(pd.Series(others), method="spearman")
                rows.append(
                    {
                        "station": st,
                        "kind": "week_vs_other_summers",
                        "year": y,
                        "week": g,
                        "spearman": rho,
                        "coolest_hour_week": int(np.nanargmin(wp)),
                        "coolest_hour_other": int(np.nanargmin(others)),
                        "first_hour_ge30_week": float(next((h for h in range(24) if h >= 5 and wp[h] >= 30.0), np.nan)),
                        "first_hour_ge30_other": float(next((h for h in range(24) if h >= 5 and others[h] >= 30.0), np.nan)),
                    }
                )
        # daily time of first >=30 after 05:00 (using hourly labels, linear interpolation between labels)
        recs = []
        for y in YEARS:
            wd = day_matrix(d, "wbgt_obs", y)
            for dd in range(N_DAYS):
                row = wd[dd, :24]
                t_first = np.nan
                if not np.isnan(row[5:15]).any():
                    for h in range(5, 14):
                        if row[h] < 30.0 <= row[h + 1]:
                            t_first = h + (30.0 - row[h]) / (row[h + 1] - row[h])
                            break
                        if row[h] >= 30.0 and h == 5:
                            t_first = 5.0
                            break
                recs.append({"year": y, "day": dd, "week": dd // 7, "t30": t_first})
        r = pd.DataFrame(recs).dropna()
        r["grp"] = r.year.astype(str) + "_" + r.week.astype(str)
        grand = r.t30.mean()
        ss_tot = ((r.t30 - grand) ** 2).sum()
        gmean = r.groupby("grp").t30.transform("mean")
        ss_within = ((r.t30 - gmean) ** 2).sum()
        fe_rows.append(
            {
                "station": st,
                "n_days": len(r),
                "mean_t30_h": grand,
                "sd_total_min": 60 * np.sqrt(ss_tot / len(r)),
                "sd_within_week_min": 60 * np.sqrt(ss_within / len(r)),
                "share_var_between_weeks_pct": 100 * (1 - ss_within / ss_tot),
            }
        )
    pd.DataFrame(rows).to_csv(out / "diurnal_stability.csv", index=False)
    pd.DataFrame(prof_rows).to_csv(out / "diurnal_profiles.csv", index=False)
    pd.DataFrame(fe_rows).to_csv(out / "first_hour_ge30.csv", index=False)


def main(parquet: str, out: str) -> None:
    out_dir = Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)
    df = pd.read_parquet(parquet)
    freeform(df, out_dir)
    print("freeform done")
    regret(df, out_dir)
    print("regret done")
    diurnal(df, out_dir)
    print("diurnal done")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
