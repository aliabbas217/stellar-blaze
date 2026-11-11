"""Match archived forecasts (Open-Meteo Previous Runs, lead = previous_dayN) with station observations.

Counts matched (forecast, observation) hourly pairs per station x summer x model x lead, and measures the raw
forecast error so we know there is a signal to correct and how stable it is across summers.

Observation 'truth' hours come from analyze_obs.py output (nearest-UTC-hour binned):
  primary   = IEM METAR   (hourly_iem/)
  secondary = GHCNh lenient (hourly_ghcnh_lenient/)
Daytime = 06:00-14:59 UTC (10:00-18:59 UAE local), the working-hours window that matters for heat stress.
Wind: Open-Meteo returns km/h by default -> converted to m/s (checked against hourly_units in each JSON).
Usage: python -I match_pairs.py <analysis_out_dir> <forecast_station_dir> <result_dir>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

STN_GH = {
    "OMAA": "AEI0000OMAA",
    "OMAD": "AEI0000OMAD",
    "OMAL": "AEI0000OMAL",
    "OMDB": "AEI0000OMDB",
    "OMDW": "AEI0000OMDW",
    "OMFJ": "AEI0000OMFJ",
    "OMSJ": "AEI0000OMSJ",
    "OMRK": "AEU041184-1",
}
MODELS = ["ecmwf_ifs025", "ecmwf_aifs025_single", "gfs_seamless"]
YEARS = (2024, 2025, 2026)
LEADS = range(0, 8)
VARS = {"temperature_2m": "t", "dew_point_2m": "td", "wind_speed_10m": "ws"}


def load_forecast(path: Path) -> pd.DataFrame:
    d = json.loads(path.read_text())
    h = d["hourly"]
    idx = pd.to_datetime(h["time"])
    units = d["hourly_units"]
    cols = {}
    for v, short in VARS.items():
        for k in LEADS:
            name = v if k == 0 else f"{v}_previous_day{k}"
            arr = pd.Series(h[name], index=idx, dtype="float64")
            if short == "ws":
                assert units[name] == "km/h", units[name]
                arr = arr / 3.6
            cols[f"{short}_L{k}"] = arr
    df = pd.DataFrame(cols)
    df.attrs["grid"] = (d["latitude"], d["longitude"], d.get("elevation"))
    return df


def main(an: str, fc: str, res: str) -> None:
    an_dir, fc_dir, res_dir = Path(an), Path(fc), Path(res)
    res_dir.mkdir(parents=True, exist_ok=True)
    pd.set_option("display.width", 250)
    pd.set_option("display.max_columns", 40)
    count_rows, err_rows, series = [], [], {}
    for model in MODELS:
        for y in YEARS:
            for st, gid in STN_GH.items():
                fp = fc_dir / f"{model}_{st}_{y}.json"
                if not fp.exists():
                    continue
                f = load_forecast(fp)
                for src, op in (
                    ("IEM", an_dir / "hourly_iem" / f"{st}_{y}.parquet"),
                    ("GHCNh", an_dir / "hourly_ghcnh_lenient" / f"{gid}_{y}.parquet"),
                ):
                    if not op.exists():
                        continue
                    o = pd.read_parquet(op).reindex(f.index)
                    day = (f.index.hour >= 6) & (f.index.hour <= 14)
                    for k in LEADS:
                        ok = {s: f[f"{s}_L{k}"].notna() & o[s].notna() for s in ("t", "td", "ws")}
                        joint = ok["t"] & ok["td"] & ok["ws"]
                        count_rows.append(
                            {
                                "model": model,
                                "obs_src": src,
                                "station": st,
                                "year": y,
                                "lead_d": k,
                                "pairs_T": int(ok["t"].sum()),
                                "pairs_Td": int(ok["td"].sum()),
                                "pairs_Ws": int(ok["ws"].sum()),
                                "pairs_joint": int(joint.sum()),
                                "pairs_joint_daytime": int((joint & day).sum()),
                                "grid_lat": f.attrs["grid"][0],
                                "grid_lon": f.attrs["grid"][1],
                                "grid_elev": f.attrs["grid"][2],
                            }
                        )
                        if src == "IEM":
                            for s in ("t", "td", "ws"):
                                e = (f[f"{s}_L{k}"] - o[s])[ok[s]]
                                ed = e[day[ok[s].to_numpy()]]
                                err_rows.append(
                                    {
                                        "model": model,
                                        "station": st,
                                        "year": y,
                                        "lead_d": k,
                                        "var": s,
                                        "n": len(e),
                                        "bias": e.mean(),
                                        "mae": e.abs().mean(),
                                        "rmse": float(np.sqrt((e**2).mean())),
                                        "n_day": len(ed),
                                        "bias_day": ed.mean(),
                                        "mae_day": ed.abs().mean(),
                                    }
                                )
                            if k in (1, 3):
                                series[(model, st, y, k)] = pd.DataFrame(
                                    {"e_t": f[f"t_L{k}"] - o["t"], "e_td": f[f"td_L{k}"] - o["td"], "e_ws": f[f"ws_L{k}"] - o["ws"]}
                                )
    counts = pd.DataFrame(count_rows)
    errs = pd.DataFrame(err_rows)
    counts.to_csv(res_dir / "pair_counts.csv", index=False)
    errs.to_csv(res_dir / "baseline_errors.csv", index=False)

    # ---- totals: pairs per model x year x lead (sum over stations), IEM obs --------------------
    iem = counts[counts.obs_src == "IEM"]
    print("== Matched joint (T&Td&Wind) pairs, IEM truth, summed over the 8 core stations")
    tot = iem.pivot_table(index=["model", "year"], columns="lead_d", values="pairs_joint", aggfunc="sum")
    print(tot.to_string())
    print("\n== Daytime (10-19 local) joint pairs, IEM truth, summed over stations")
    print(iem.pivot_table(index=["model", "year"], columns="lead_d", values="pairs_joint_daytime", aggfunc="sum").to_string())
    print("\n== Same totals with GHCNh(lenient) truth, leads 1,3,7")
    gh = counts[counts.obs_src == "GHCNh"]
    print(
        gh[gh.lead_d.isin([1, 3, 7])]
        .pivot_table(index=["model", "year"], columns="lead_d", values="pairs_joint", aggfunc="sum")
        .to_string()
    )
    print("\n== Per station, ecmwf_ifs025, lead 1, IEM truth: joint pairs / daytime joint pairs")
    x = iem[(iem.model == "ecmwf_ifs025") & (iem.lead_d == 1)]
    print(x.pivot_table(index="station", columns="year", values=["pairs_joint", "pairs_joint_daytime"]).to_string())
    print("\n== Grid cells used (lat, lon, elevation) per station (ecmwf_ifs025):")
    g = counts[(counts.model == "ecmwf_ifs025") & (counts.lead_d == 1) & (counts.year == 2025) & (counts.obs_src == "IEM")][
        ["station", "grid_lat", "grid_lon", "grid_elev"]
    ]
    print(g.to_string(index=False))

    # ---- raw forecast error (signal to correct) -------------------------------------------------
    print("\n== Raw forecast error vs IEM obs, pooled over stations, all hours: bias / MAE / RMSE; daytime bias / MAE")
    pooled = errs.groupby(["model", "year", "lead_d", "var"]).apply(
        lambda d: pd.Series(
            {
                "n": d.n.sum(),
                "bias": np.average(d.bias, weights=d.n),
                "mae": np.average(d.mae, weights=d.n),
                "rmse": float(np.sqrt(np.average(d.rmse**2, weights=d.n))),
                "bias_day": np.average(d.bias_day, weights=d.n_day),
                "mae_day": np.average(d.mae_day, weights=d.n_day),
            }
        ),
        include_groups=False,
    )
    pooled.to_csv(res_dir / "baseline_errors_pooled.csv")
    sel = pooled.reset_index()
    sel = sel[sel.lead_d.isin([1, 3, 7])]
    print(sel.round(2).to_string(index=False))

    # ---- stability of station bias across summers (feasibility of leave-one-summer-out) ----------
    print("\n== Cross-summer stability of station-level DAYTIME bias, ecmwf_ifs025 lead 1 (bias per station per summer)")
    b = errs[(errs.model == "ecmwf_ifs025") & (errs.lead_d == 1)].pivot_table(index=["var", "station"], columns="year", values="bias_day")
    print(b.round(2).to_string())
    for var in ("t", "td", "ws"):
        bb = b.loc[var].dropna()
        cm = bb.corr()
        print(f"  {var}: correlation of station-bias vectors between summers:\n{cm.round(2).to_string()}")

    # ---- effective sample size from daily autocorrelation -----------------------------------------
    print("\n== Effective independent days from lag-1 autocorrelation of the daily-mean daytime error (ecmwf_ifs025, lead 1)")
    rows = []
    for (m, st, y, k), df in series.items():
        if m != "ecmwf_ifs025" or k != 1:
            continue
        for col in ("e_t", "e_td", "e_ws"):
            s = df[col][(df.index.hour >= 6) & (df.index.hour <= 14)]
            daily = s.groupby(s.index.date).mean().dropna()
            if len(daily) < 30:
                continue
            r1 = float(daily.autocorr(1))
            ess = len(daily) * (1 - r1) / (1 + r1) if r1 < 0.99 else np.nan
            rows.append({"station": st, "year": y, "var": col, "days": len(daily), "r1": r1, "ess_days": ess})
    ess = pd.DataFrame(rows)
    ess.to_csv(res_dir / "effective_sample_size.csv", index=False)
    print(ess.groupby("var").agg(days=("days", "sum"), mean_r1=("r1", "mean"), ess_days=("ess_days", "sum")).round(2).to_string())
    print("\nper-var mean lag-1 autocorr:", ess.groupby("var").r1.mean().round(2).to_dict())

    # ---- spatial error correlation between stations (justifies clustering for leave-one-station-out) ----
    print("\n== Correlation of daily-mean daytime raw error between stations (ecmwf_ifs025, lead 1, three summers pooled)")
    for col in ("e_t", "e_td", "e_ws"):
        per_station = {}
        for st in STN_GH:
            parts = []
            for y in YEARS:
                df = series.get(("ecmwf_ifs025", st, y, 1))
                if df is None:
                    continue
                s_ = df[col][(df.index.hour >= 6) & (df.index.hour <= 14)]
                daily = s_.groupby(s_.index.normalize()).mean()
                parts.append(daily - daily.mean())  # remove each station-summer's constant bias before correlating
            if parts:
                per_station[st] = pd.concat(parts)
        cm = pd.DataFrame(per_station).corr()
        cm.to_csv(res_dir / f"error_corr_{col}.csv")
        print(f"-- {col} (bias-removed)")
        print(cm.round(2).to_string())
        ev = np.linalg.eigvalsh(cm.fillna(0).to_numpy())
        print(
            "   effective number of independent stations (participation ratio of eigenvalues): "
            f"{ev.sum() ** 2 / (ev**2).sum():.2f} of {len(cm)}"
        )


if __name__ == "__main__":
    main(*sys.argv[1:4])
