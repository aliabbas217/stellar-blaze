"""Build hourly WBGT series for the 8 UAE METAR stations, summers 2024-2026, from (a) observations and (b) archived forecasts.

Truth WBGT  = Liljegren(IEM-METAR T, Td, wind ; Open-Meteo ARCHIVE (ecmwf_ifs) radiation + surface pressure at the station cell)
Forecast WBGT at lead k = Liljegren(IFS 0.25 deg previous_day<k> T, Td, wind ; the SAME archive radiation + pressure)
    -> "same-radiation" convention of ADR 0005 / data doc section 7 item 9: the comparison isolates T/Td/wind error.
Bias-corrected forecast = forecast T, Td, wind plus a per-station, per-lead, per-local-hour additive bias learned on the OTHER two
    summers (leave-one-summer-out). This is the "simple bias correction" baseline of ADR 0007, a conservative stand-in for the ML corrector.

Method follows the audited `future-health-challenge/scripts/audit_wbgt.py` (thermofeel 2.3.0 Liljegren; solar geometry NOAA low-precision
series,
cos zenith = mean of max(cos z, 0) over the PRECEDING hour because Open-Meteo radiation is the preceding-hour mean) and ADR 0006 guards
(non-finite inputs -> NaN; result outside [T-30, T+10] C -> NaN).

Gap handling: observation gaps of at most 3 consecutive hours are linearly interpolated (T, Td, wind); longer gaps stay NaN.
RH from T and Td with the Magnus form (Alduchov & Eskridge 1996 constants), clipped to [1, 100] %.

Usage: python -I -X utf8 build_wbgt.py <analysis_out_dir> <forecast_station_dir> <archive_dir> <out_dir>
  <analysis_out_dir>   has hourly_iem/<STN>_<year>.parquet (from docs/research/scripts/analyze_obs.py)
  <forecast_station_dir> has <model>_<STN>_<year>.json (docs/research/scripts/fetch_forecast_stations.py)
  <archive_dir>        has archive_<model>_<STN>_<year>.json (fetch_radiation.py)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from numpy.typing import NDArray
from thermofeel.thermofeel import calculate_wbgt_liljegren

STATIONS = ["OMAA", "OMAD", "OMAL", "OMDB", "OMDW", "OMFJ", "OMSJ", "OMRK"]
YEARS = (2024, 2025, 2026)
LEADS = range(1, 8)
MAX_FILL_H = 3
F64 = NDArray[np.float64]


def cos_zenith(lat_deg: float, lon_deg: float, utc: NDArray[np.datetime64]) -> F64:
    """Cosine of the solar zenith angle (NOAA/Meeus low-precision series); ported verbatim from audit_wbgt.py."""
    t = utc.astype("datetime64[s]")
    epoch = np.datetime64("1970-01-01T00:00:00", "s")
    secs = (t - epoch).astype(np.float64)
    jd = secs / 86400.0 + 2440587.5
    jc = (jd - 2451545.0) / 36525.0
    gml = np.mod(280.46646 + jc * (36000.76983 + jc * 0.0003032), 360.0)
    gma = 357.52911 + jc * (35999.05029 - 0.0001537 * jc)
    ecc = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc)
    m = np.radians(gma)
    eq_ctr = (
        np.sin(m) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) + np.sin(2 * m) * (0.019993 - 0.000101 * jc) + np.sin(3 * m) * 0.000289
    )
    true_long = gml + eq_ctr
    omega = np.radians(125.04 - 1934.136 * jc)
    app_long = np.radians(true_long - 0.00569 - 0.00478 * np.sin(omega))
    mean_obl = 23.0 + (26.0 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60.0) / 60.0
    obl = np.radians(mean_obl + 0.00256 * np.cos(omega))
    decl = np.arcsin(np.sin(obl) * np.sin(app_long))
    y = np.tan(obl / 2.0) ** 2
    g = np.radians(gml)
    eq_time_min = 4.0 * np.degrees(
        y * np.sin(2 * g)
        - 2 * ecc * np.sin(m)
        + 4 * ecc * y * np.sin(m) * np.cos(2 * g)
        - 0.5 * y**2 * np.sin(4 * g)
        - 1.25 * ecc**2 * np.sin(2 * m)
    )
    minutes_utc = np.mod(secs, 86400.0) / 60.0
    tst = np.mod(minutes_utc + eq_time_min + 4.0 * lon_deg, 1440.0)
    ha = np.radians(tst / 4.0 - 180.0)
    lat = np.radians(lat_deg)
    return np.sin(lat) * np.sin(decl) + np.cos(lat) * np.cos(decl) * np.cos(ha)  # type: ignore[no-any-return]


def mean_cos_zenith_prev_hour(lat: float, lon: float, utc: NDArray[np.datetime64]) -> F64:
    """Mean of max(cos zenith, 0) over the 60 min before each label (5-min sampling); ported from audit_wbgt.py."""
    offs = np.arange(-57.5, 0.0, 5.0)
    acc = np.zeros(utc.shape, dtype=np.float64)
    for o in offs:
        acc += np.clip(cos_zenith(lat, lon, utc + np.timedelta64(round(o * 60), "s")), 0.0, None)
    return acc / len(offs)


def rh_from_t_td(t: F64, td: F64) -> F64:
    a, b = 17.625, 243.04
    es_td = np.exp(a * td / (b + td))
    es_t = np.exp(a * t / (b + t))
    return np.clip(100.0 * es_td / es_t, 1.0, 100.0)  # type: ignore[no-any-return]


def wbgt(t: F64, td: F64, ws: F64, p: F64, ssrd: F64, fdir: F64, cz: F64) -> F64:
    """Liljegren WBGT in degC with ADR 0006 guards. NaN where any input is non-finite or the result is implausible."""
    ok = np.isfinite(t) & np.isfinite(td) & np.isfinite(ws) & np.isfinite(p) & np.isfinite(ssrd) & np.isfinite(fdir) & np.isfinite(cz)
    out = np.full(t.shape, np.nan)
    if ok.any():
        rh = rh_from_t_td(t[ok], td[ok])
        w = np.asarray(calculate_wbgt_liljegren(t[ok] + 273.15, rh, p[ok], ws[ok], ssrd[ok], fdir[ok], cz[ok]), dtype=np.float64) - 273.15
        bad = ~np.isfinite(w) | (w < t[ok] - 30.0) | (w > t[ok] + 10.0)
        w[bad] = np.nan
        out[ok] = w
    return out


def load_archive(path: Path) -> tuple[pd.DataFrame, float, float]:
    d = json.loads(path.read_text(encoding="utf-8"))
    h = d["hourly"]
    idx = pd.to_datetime(h["time"])
    df = pd.DataFrame(
        {k: pd.Series(h[k], index=idx, dtype="float64") for k in ("shortwave_radiation", "direct_radiation", "surface_pressure")}
    )
    return df, float(d["latitude"]), float(d["longitude"])


def read_json(path: Path) -> dict:
    """fetch_forecast_stations.py wrote with the Windows locale codec (gbk here); fall back when utf-8 fails."""
    raw = path.read_bytes()
    try:
        return json.loads(raw.decode("utf-8"))  # type: ignore[no-any-return]
    except UnicodeDecodeError:
        return json.loads(raw.decode("gbk"))  # type: ignore[no-any-return]


def load_forecast(path: Path) -> pd.DataFrame:
    d = read_json(path)
    h = d["hourly"]
    idx = pd.to_datetime(h["time"])
    units = d["hourly_units"]
    cols = {}
    for v, short in (("temperature_2m", "t"), ("dew_point_2m", "td"), ("wind_speed_10m", "ws")):
        for k in LEADS:
            name = f"{v}_previous_day{k}"
            arr = pd.Series(h[name], index=idx, dtype="float64")
            if short == "ws":
                assert units[name] == "km/h", units[name]
                arr = arr / 3.6
            cols[f"{short}_L{k}"] = arr
    return pd.DataFrame(cols)


def main(an: str, fc: str, ar: str, out: str) -> None:
    an_dir, fc_dir, ar_dir, out_dir = Path(an), Path(fc), Path(ar), Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)
    frames: dict[tuple[str, int], pd.DataFrame] = {}
    meta = []
    for st in STATIONS:
        for y in YEARS:
            idx = pd.date_range(f"{y}-05-15 00:00", f"{y}-09-30 23:00", freq="h")
            o = pd.read_parquet(an_dir / "hourly_iem" / f"{st}_{y}.parquet").reindex(idx)[["t", "td", "ws"]]
            n_raw = int(o.notna().all(axis=1).sum())
            o = o.interpolate(limit=MAX_FILL_H, limit_area="inside")
            n_fill = int(o.notna().all(axis=1).sum())
            arch, glat, glon = load_archive(ar_dir / f"archive_ecmwf_ifs_{st}_{y}.json")
            arch = arch.reindex(idx)
            f = load_forecast(fc_dir / f"ecmwf_ifs025_{st}_{y}.json").reindex(idx)
            ssrd = arch["shortwave_radiation"].to_numpy()
            direct = arch["direct_radiation"].to_numpy()
            fdir = np.clip(np.divide(direct, ssrd, out=np.zeros_like(direct), where=ssrd > 1e-6), 0.0, 0.9)
            p = arch["surface_pressure"].to_numpy()
            cz = mean_cos_zenith_prev_hour(glat, glon, idx.to_numpy())
            df = pd.DataFrame(index=idx)
            df["t"], df["td"], df["ws"] = o["t"].to_numpy(), o["td"].to_numpy(), o["ws"].to_numpy()
            df["p"], df["ssrd"], df["fdir"], df["cz"] = p, ssrd, fdir, cz
            df["wbgt_obs"] = wbgt(df["t"].to_numpy(), df["td"].to_numpy(), df["ws"].to_numpy(), p, ssrd, fdir, cz)
            for k in LEADS:
                for v in ("t", "td", "ws"):
                    df[f"{v}_L{k}"] = f[f"{v}_L{k}"].to_numpy()
                df[f"wbgt_L{k}"] = wbgt(df[f"t_L{k}"].to_numpy(), df[f"td_L{k}"].to_numpy(), df[f"ws_L{k}"].to_numpy(), p, ssrd, fdir, cz)
            frames[(st, y)] = df
            meta.append(
                {
                    "station": st,
                    "year": y,
                    "grid_lat": glat,
                    "grid_lon": glon,
                    "obs_joint_hours_raw": n_raw,
                    "obs_joint_hours_filled": n_fill,
                    "wbgt_obs_valid": int(df["wbgt_obs"].notna().sum()),
                }
            )
            print(f"{st} {y}: obs joint {n_raw} -> {n_fill} after <=3h fill; WBGT valid {meta[-1]['wbgt_obs_valid']}/{len(idx)}")

    # Leave-one-summer-out additive bias correction of the forecast T/Td/wind, per station x lead x local hour.
    for st in STATIONS:
        for y in YEARS:
            others = [yy for yy in YEARS if yy != y]
            tgt = frames[(st, y)]
            local_hour = ((tgt.index.hour + 4) % 24).to_numpy()
            for k in LEADS:
                for v in ("t", "td", "ws"):
                    err = pd.concat([(frames[(st, yy)][f"{v}_L{k}"] - frames[(st, yy)][v]) for yy in others])
                    lh = ((err.index.hour + 4) % 24).to_numpy()
                    bias_by_hour = pd.Series(err.to_numpy()).groupby(lh).mean()
                    corr = tgt[f"{v}_L{k}"].to_numpy() - bias_by_hour.reindex(local_hour).to_numpy()
                    if v == "ws":
                        corr = np.maximum(corr, 0.0)
                    tgt[f"{v}_bc{k}"] = corr
                tgt[f"wbgt_bc{k}"] = wbgt(
                    tgt[f"t_bc{k}"].to_numpy(),
                    tgt[f"td_bc{k}"].to_numpy(),
                    tgt[f"ws_bc{k}"].to_numpy(),
                    tgt["p"].to_numpy(),
                    tgt["ssrd"].to_numpy(),
                    tgt["fdir"].to_numpy(),
                    tgt["cz"].to_numpy(),
                )

    long = []
    for (st, y), df in frames.items():
        keep = df[["t", "td", "ws", "p", "ssrd", "wbgt_obs"] + [f"wbgt_L{k}" for k in LEADS] + [f"wbgt_bc{k}" for k in LEADS]].copy()
        keep.insert(0, "year", y)
        keep.insert(0, "station", st)
        keep.index.name = "time_utc"
        long.append(keep.reset_index())
    allf = pd.concat(long, ignore_index=True)
    allf.to_parquet(out_dir / "hourly_wbgt.parquet")
    pd.DataFrame(meta).to_csv(out_dir / "wbgt_build_meta.csv", index=False)
    print("wrote", out_dir / "hourly_wbgt.parquet", allf.shape)


if __name__ == "__main__":
    main(*sys.argv[1:5])
