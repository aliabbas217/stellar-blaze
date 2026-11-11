"""Count valid hourly observations per UAE station and summer from GHCNh (parquet) and IEM (METAR CSV).

Summer window = 15 May 00:00 UTC .. 30 Sep 23:00 UTC inclusive = 139 days = 3336 hourly bins.
Hour binning: each observation is assigned to the NEAREST UTC hour (METAR at HH:50-HH:59 -> next hour);
within a bin the observation closest to the hour wins, per variable.
Validity (GHCNh), two modes:
  strict  : value non-null AND QC code == '1' (passed all NOAA checks) AND physically plausible
  lenient : value non-null AND QC code in {'1', missing} (i.e. not flagged suspect/erroneous) AND plausible.
            Needed because NOAA has not yet applied QC to most 2026 rows (QC code is blank), so 'strict' gives 0 for 2026.
Validity (IEM): value non-null AND physically plausible (IEM has no QC flags).

Outputs (to <out_dir>): obs_counts_<source>.csv (long) plus per-hour tables saved as parquet for later matching.
Usage: python -I analyze_obs.py <ghcnh_dir> <iem_dir> <out_dir>
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

YEARS = (2024, 2025, 2026)
GH_NAMES = {
    "AEI0000OMAA": "OMAA Abu Dhabi Intl",
    "AEI0000OMAB": "OMAB Buhasa",
    "AEI0000OMAD": "OMAD Al Bateen",
    "AEI0000OMAH": "OMAH Al Hamra Aux",
    "AEI0000OMAJ": "OMAJ Jebel Dhanna",
    "AEI0000OMAL": "OMAL Al Ain Intl",
    "AEI0000OMAM": "OMAM Al Dhafra",
    "AEI0000OMAS": "OMAS Das Island",
    "AEI0000OMAW": "OMAW Sweihan",
    "AEI0000OMAZ": "OMAZ Zirku",
    "AEI0000OMDB": "OMDB Dubai Intl",
    "AEI0000OMDL": "OMDL Delma",
    "AEI0000OMDM": "OMDM Dubai Minhad AB",
    "AEI0000OMDW": "OMDW Al Maktoum Intl",
    "AEI0000OMFJ": "OMFJ Fujairah Intl",
    "AEI0000OMLW": "OMLW Liwa AB",
    "AEI0000OMQS": "OMQS Qusaiwera AB",
    "AEI0000OMSJ": "OMSJ Sharjah Intl",
    "AEI0000OMSN": "OMSN Sir Abu Nair",
    "AEM00040449": "40449 Ash Shariqah SW",
    "AEM00041226": "41226 Medina Zayed",
    "AEU041184-1": "41184 Ras Al Khaimah",
    "AEU041244-1": "41244 Buraimi (Oman)",
}
RANGES = {"t": (-10, 60), "td": (-30, 40), "ws": (0, 60), "psta": (850, 1100), "pslp": (950, 1100)}


def window(year: int) -> pd.DatetimeIndex:
    return pd.date_range(f"{year}-05-15 00:00", f"{year}-09-30 23:00", freq="h")


def to_hourly(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    """df has a UTC 'ts' column plus value columns already NaN-masked for invalid values.
    Returns one row per nearest-hour bin with the observation closest to the hour for each column."""
    df = df.copy()
    df["hr"] = df["ts"].dt.round("h")
    df["dist"] = (df["ts"] - df["hr"]).abs()
    out = {}
    for c in cols:
        sub = df.loc[df[c].notna(), ["hr", "dist", c]].sort_values(["hr", "dist"])
        sub = sub.drop_duplicates("hr")
        out[c] = sub.set_index("hr")[c]
    return pd.DataFrame(out)


def ghcnh_station_year(path: Path, mode: str) -> tuple[pd.DataFrame, dict]:
    df = pd.read_parquet(path)
    df["ts"] = pd.to_datetime(df["DATE"], utc=True).dt.tz_localize(None)
    n_raw = len(df)

    def valid(col: str, qc_col: str, lo: float, hi: float) -> pd.Series:
        v = df[col].astype(float)
        qc_ok = df[qc_col].eq("1") if mode == "strict" else (df[qc_col].eq("1") | df[qc_col].isna())
        ok = v.notna() & qc_ok & v.between(lo, hi)
        return v.where(ok)

    df["t"] = valid("temperature", "temperature_Quality_Code", *RANGES["t"])
    df["td"] = valid("dew_point_temperature", "dew_point_temperature_Quality_Code", *RANGES["td"])
    df["ws"] = valid("wind_speed", "wind_speed_Quality_Code", *RANGES["ws"])
    df["psta"] = valid("station_level_pressure", "station_level_pressure_Quality_Code", *RANGES["psta"])
    df["pslp"] = valid("sea_level_pressure", "sea_level_pressure_Quality_Code", *RANGES["pslp"])
    # raw non-null (no QC filter), for comparison
    df["t_raw"] = df["temperature"].astype(float).where(df["temperature"].notna())
    rt = df["temperature_Report_Type"].fillna("NA")
    meta = {
        "n_obs_rows": n_raw,
        "report_types": rt.value_counts().to_dict(),
        "lat": float(df["LATITUDE"].iloc[0]) if n_raw else np.nan,
        "lon": float(df["LONGITUDE"].iloc[0]) if n_raw else np.nan,
        "elev": float(df["ELEVATION"].iloc[0]) if n_raw else np.nan,
    }
    return to_hourly(df, ["t", "td", "ws", "psta", "pslp", "t_raw"]), meta


def count_window(h: pd.DataFrame, year: int) -> dict:
    idx = window(year)
    w = h.reindex(idx)
    n = len(idx)
    core = w[["t", "td", "ws"]].notna().all(axis=1)
    p_any = w["psta"].notna() | w["pslp"].notna()
    day = (idx.hour >= 6) & (idx.hour <= 14)  # 10:00-18:59 local (UTC+4)
    rec = {
        "hours_expected": n,
        "T": int(w["t"].notna().sum()),
        "Td": int(w["td"].notna().sum()),
        "Wind": int(w["ws"].notna().sum()),
        "P_station": int(w["psta"].notna().sum()),
        "P_sealevel": int(w["pslp"].notna().sum()),
        "T_Td_Wind": int(core.sum()),
        "T_Td_Wind_Pany": int((core & p_any).sum()),
        "day_hours_expected": int(day.sum()),
        "day_T_Td_Wind": int((core & day).sum()),
    }
    # longest gap of core-incomplete hours (hours)
    miss = (~core).to_numpy()
    longest = cur = 0
    end_i = -1
    for i, m in enumerate(miss):
        cur = cur + 1 if m else 0
        if cur > longest:
            longest, end_i = cur, i
    rec["longest_core_gap_h"] = longest
    rec["longest_gap_start_utc"] = str(idx[end_i - longest + 1]) if longest else ""
    return rec


def run_ghcnh(gh_dir: Path, out: Path, mode: str) -> pd.DataFrame:
    rows = []
    hourly_dir = out / f"hourly_ghcnh_{mode}"
    hourly_dir.mkdir(parents=True, exist_ok=True)
    for sid, name in GH_NAMES.items():
        for y in YEARS:
            p = gh_dir / f"GHCNh_{sid}_{y}.parquet"
            if not p.exists():
                rows.append({"source": "GHCNh", "station": name, "year": y, "file": "404/absent"})
                continue
            h, meta = ghcnh_station_year(p, mode)
            rec = {
                "source": "GHCNh",
                "station": name,
                "year": y,
                "file": "ok",
                **count_window(h, y),
                "obs_rows_year": meta["n_obs_rows"],
                "lat": meta["lat"],
                "lon": meta["lon"],
                "elev": meta["elev"],
                "report_types": ";".join(f"{k}:{v}" for k, v in meta["report_types"].items()),
            }
            rows.append(rec)
            h.loc[h.index.isin(window(y))].to_parquet(hourly_dir / f"{sid}_{y}.parquet")
    df = pd.DataFrame(rows)
    df.to_csv(out / f"obs_counts_ghcnh_{mode}.csv", index=False)
    return df


def run_iem(iem_dir: Path, out: Path) -> pd.DataFrame:
    rows = []
    hourly_dir = out / "hourly_iem"
    hourly_dir.mkdir(parents=True, exist_ok=True)
    stations = sorted({p.name.split("_")[0] for p in iem_dir.glob("*_20??.csv")})
    for sid in stations:
        for y in YEARS:
            p = iem_dir / f"{sid}_{y}.csv"
            if not p.exists():
                continue
            df = pd.read_csv(p, na_values=["", "M"], low_memory=False)
            if df.empty or "valid" not in df.columns:
                rows.append({"source": "IEM", "station": sid, "year": y, "file": "empty"})
                continue
            df["ts"] = pd.to_datetime(df["valid"], utc=True).dt.tz_localize(None)
            t = (pd.to_numeric(df["tmpf"], errors="coerce") - 32) * 5 / 9
            td = (pd.to_numeric(df["dwpf"], errors="coerce") - 32) * 5 / 9
            ws = pd.to_numeric(df["sknt"], errors="coerce") * 0.514444
            alti = pd.to_numeric(df["alti"], errors="coerce") * 33.8639  # hPa, altimeter setting (QNH-equivalent)
            mslp = pd.to_numeric(df["mslp"], errors="coerce")
            df["t"] = t.where(t.between(*RANGES["t"]))
            df["td"] = td.where(td.between(*RANGES["td"]))
            df["ws"] = ws.where(ws.between(*RANGES["ws"]))
            df["psta"] = np.nan  # METAR carries no station pressure
            df["pslp"] = alti.where(alti.between(*RANGES["pslp"])).fillna(mslp.where(mslp.between(*RANGES["pslp"])))
            h = to_hourly(df, ["t", "td", "ws", "psta", "pslp"])
            rec = {"source": "IEM", "station": sid, "year": y, "file": "ok", **count_window(h, y), "obs_rows_year": len(df)}
            rows.append(rec)
            h.loc[h.index.isin(window(y))].to_parquet(hourly_dir / f"{sid}_{y}.parquet")
    df = pd.DataFrame(rows)
    df.to_csv(out / "obs_counts_iem.csv", index=False)
    return df


if __name__ == "__main__":
    gh, iem, out = (Path(a) for a in sys.argv[1:4])
    out.mkdir(parents=True, exist_ok=True)
    pd.set_option("display.width", 250)
    pd.set_option("display.max_columns", 30)
    cols = [
        "station",
        "year",
        "file",
        "T",
        "Td",
        "Wind",
        "P_station",
        "P_sealevel",
        "T_Td_Wind",
        "T_Td_Wind_Pany",
        "day_T_Td_Wind",
        "longest_core_gap_h",
        "longest_gap_start_utc",
        "obs_rows_year",
    ]
    for mode in ("strict", "lenient"):
        g = run_ghcnh(gh, out, mode)
        print("GHCNh", mode)
        print(g[[c for c in cols if c in g.columns]].to_string(index=False))
    i = run_iem(iem, out)
    print(i[[c for c in cols if c in i.columns]].to_string(index=False))
