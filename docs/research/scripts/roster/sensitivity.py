"""Sensitivity of the exposure numbers to (1) the radiation source (IFS archive vs ERA5) and (2) METAR whole-degree rounding.

For OMAA and OMDB (all three summers) recompute obs-WBGT with ERA5 radiation + pressure and report worker-hours at >=28/30/32 for the
baseline roster and for the DAY-library best seasonal roster (04:30-10:00 + 16:30-19:30), plus the share of 06-18 local hours >= 32.
Rounding test: add U(-0.5, 0.5) degC noise to T and Td (so it ADDS to the unknown existing rounding error: an upper bound), 20 draws.
Usage: python -I -X utf8 sensitivity.py <analysis_out_dir> <archive_dir> <out_csv>
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_wbgt import load_archive, mean_cos_zenith_prev_hour, wbgt  # noqa: E402
from roster_ladder import THRS, YEARS, Roster, day_matrix, exposure, weights  # noqa: E402

ROSTERS = [
    Roster("baseline 06:00-12:30 + 15:00-17:00", ((6.0, 12.5), (15.0, 17.0)), "x"),
    Roster("best DAY 04:30-10:00 + 16:30-19:30", ((4.5, 10.0), (16.5, 19.5)), "x"),
    Roster("night 23:00-07:30", ((23.0, 31.5),), "x"),
]
WT = weights(ROSTERS)


def series(an: Path, ar: Path, st: str, y: int, model: str, noise: float, rng: np.random.Generator) -> pd.DataFrame:
    idx = pd.date_range(f"{y}-05-15 00:00", f"{y}-09-30 23:00", freq="h")
    o = pd.read_parquet(an / "hourly_iem" / f"{st}_{y}.parquet").reindex(idx)[["t", "td", "ws"]].interpolate(limit=3, limit_area="inside")
    arch, glat, glon = load_archive(ar / f"archive_{model}_{st}_{y}.json")
    arch = arch.reindex(idx)
    ssrd, direct = arch["shortwave_radiation"].to_numpy(), arch["direct_radiation"].to_numpy()
    fdir = np.clip(np.divide(direct, ssrd, out=np.zeros_like(direct), where=ssrd > 1e-6), 0.0, 0.9)
    cz = mean_cos_zenith_prev_hour(glat, glon, idx.to_numpy())
    t, td = o["t"].to_numpy(), o["td"].to_numpy()
    if noise:
        t = t + rng.uniform(-noise, noise, t.shape)
        td = td + rng.uniform(-noise, noise, td.shape)
    w = wbgt(t, td, o["ws"].to_numpy(), arch["surface_pressure"].to_numpy(), ssrd, fdir, cz)
    return pd.DataFrame({"time_utc": idx, "year": y, "wbgt_obs": w})


def summarise(df: pd.DataFrame) -> dict[str, float]:
    out: dict[str, float] = {}
    res = {f"{r.name}|E{int(t)}": [] for r in ROSTERS for t in THRS}
    share = []
    for y in YEARS:
        wd = day_matrix(df, "wbgt_obs", y)
        valid_all = np.ones((wd.shape[0], len(ROSTERS)), dtype=bool)
        es = {}
        for t in THRS:
            e, v = exposure(wd, WT, t)
            es[t] = e
            valid_all &= v
        dm = valid_all.all(axis=1)
        for ri, r in enumerate(ROSTERS):
            for t in THRS:
                res[f"{r.name}|E{int(t)}"].append(es[t][dm, ri].sum() * 139 / dm.sum())
        d = df[df.year == y].copy()
        loc = d.time_utc + pd.Timedelta(hours=4)
        m = (loc >= f"{y}-06-15") & (loc < f"{y}-09-16") & loc.dt.hour.between(6, 18)
        share.append(100 * (d.wbgt_obs[m] >= 32).mean())
    for k, v in res.items():
        out[k] = float(np.mean(v))
    out["share_ge32_pct_0615_0915_06_18"] = float(np.mean(share))
    return out


def main(an: str, ar: str, out_csv: str) -> None:
    an_d, ar_d = Path(an), Path(ar)
    rng = np.random.default_rng(0)
    rows = []
    for st in ("OMAA", "OMDB"):
        for label, model, noise, n in (
            ("IFS archive radiation (primary)", "ecmwf_ifs", 0.0, 1),
            ("ERA5 radiation", "era5", 0.0, 1),
            ("IFS + U(-0.5,0.5) noise on T,Td", "ecmwf_ifs", 0.5, 20),
        ):
            recs = []
            for _ in range(n):
                df = pd.concat([series(an_d, ar_d, st, y, model, noise, rng).assign(station=st) for y in YEARS])
                recs.append(summarise(df))
            r = pd.DataFrame(recs)
            mean, sd = r.mean(), r.std(ddof=0) if n > 1 else r.mean() * 0
            for k in r.columns:
                rows.append({"station": st, "variant": label, "metric": k, "mean": mean[k], "sd": sd[k]})
    out = pd.DataFrame(rows)
    out.to_csv(out_csv, index=False)
    pd.set_option("display.width", 250)
    pd.set_option("display.max_rows", 200)
    p = out.pivot_table(index=["station", "metric"], columns="variant", values="mean").round(1)
    print(p.to_string())
    print(out[out.variant.str.contains("noise")].pivot_table(index=["station", "metric"], values="sd").round(1).to_string())


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
