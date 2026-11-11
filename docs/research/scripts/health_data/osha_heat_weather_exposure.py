"""Exploratory: do OSHA SIR heat hospitalisations rise with daily maximum temperature around nine US airport stations?

Events: heat rows (OIICS 531x) in the station's state within 40 km of the airport. Days: May to September 2015-2025 (to 2025-09-30).
Rate = events per 1,000 days; RR = rate ratio against the coolest bin; the interval is a crude log-Poisson interval (ignores
over-dispersion and day clustering, so it is too narrow). No denominators (workers on site), no acclimatisation, airport weather only.
Usage: python -I -X utf8 osha_heat_weather_exposure.py <SIR csv> <dir with <STATION>.csv from fetch_iem_daily_us.py> [weekdays]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

STATIONS = {
    "HOU": (29.645, -95.279, "TEXAS"),
    "DAL": (32.847, -96.852, "TEXAS"),
    "SAT": (29.534, -98.470, "TEXAS"),
    "AUS": (30.194, -97.670, "TEXAS"),
    "MCO": (28.429, -81.316, "FLORIDA"),
    "JAX": (30.494, -81.688, "FLORIDA"),
    "TPA": (27.975, -82.533, "FLORIDA"),
    "ATL": (33.640, -84.427, "GEORGIA"),
    "MCI": (39.297, -94.714, "MISSOURI"),
}
RADIUS_KM = 40


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p = math.pi / 180
    a = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(a))


def rate_table(frame: pd.DataFrame, column: str, edges: list[float], labels: list[str]) -> None:
    binned = pd.cut(frame[column], bins=edges, labels=labels, right=False)
    grouped = frame.groupby(binned, observed=True).agg(days=("n", "size"), events=("n", "sum"))
    grouped["per1000d"] = 1000 * grouped["events"] / grouped["days"]
    grouped["RR"] = grouped["per1000d"] / grouped["per1000d"].iloc[0]
    spread = 1.96 * np.sqrt(1 / grouped["events"].clip(lower=1) + 1 / grouped["events"].iloc[0])
    grouped["RR_lo"] = grouped["RR"] * np.exp(-spread)
    grouped["RR_hi"] = grouped["RR"] * np.exp(spread)
    print(grouped.round(2).to_string())


def main(sir_csv: str, wx_dir: str, mode: str = "all") -> None:
    sir = pd.read_csv(sir_csv, encoding="latin-1", low_memory=False)
    heat = sir[sir["Event"].astype(str).str.startswith("531")].copy()
    heat["d"] = pd.to_datetime(heat["EventDate"], errors="coerce").dt.normalize()
    heat = heat.dropna(subset=["Latitude", "Longitude", "d"])

    frames = []
    print("station | events within radius | event-days | days | median Tmax percentile of event days")
    for station, (lat, lon, state) in STATIONS.items():
        path = Path(wx_dir) / f"{station}.csv"
        if not path.exists() or path.stat().st_size < 100_000:
            print(station, "missing")
            continue
        wx = pd.read_csv(path)
        wx["d"] = pd.to_datetime(wx["day"])
        for col in ("max_temp_f", "max_feel"):
            wx[col] = pd.to_numeric(wx[col], errors="coerce")
        wx = wx[wx["d"].dt.month.between(5, 9) & (wx["d"] <= "2025-09-30")].dropna(subset=["max_temp_f", "max_feel"]).copy()
        near = heat[heat["State"] == state].copy()
        near["km"] = [haversine_km(lat, lon, a, b) for a, b in zip(near["Latitude"], near["Longitude"], strict=True)]
        near = near[near["km"] <= RADIUS_KM]
        wx["n"] = wx["d"].map(near.groupby("d").size()).fillna(0).astype(int)
        if mode == "weekdays":
            wx = wx[wx["d"].dt.dayofweek < 5].copy()
        ranks = wx["max_temp_f"].rank(pct=True)
        pct = np.repeat(ranks[wx["n"] > 0].to_numpy(), wx.loc[wx["n"] > 0, "n"].to_numpy())
        print(station, len(near), int((wx["n"] > 0).sum()), len(wx), round(float(np.median(pct)), 3) if len(pct) else float("nan"))
        frames.append(wx)

    pooled = pd.concat(frames)
    print(
        "POOLED events", int(pooled["n"].sum()), "| days", len(pooled), "| per 1000 days", round(1000 * pooled["n"].sum() / len(pooled), 1)
    )
    print("-- by daily maximum temperature (F)")
    rate_table(pooled, "max_temp_f", [0, 90, 95, 100, 150], ["<90", "90-94", "95-99", ">=100"])
    print("-- by daily maximum apparent temperature (IEM max_feel, F)")
    rate_table(pooled, "max_feel", [0, 95, 100, 105, 110, 300], ["<95", "95-99", "100-104", "105-109", ">=110"])


if __name__ == "__main__":
    main(*sys.argv[1:4])
