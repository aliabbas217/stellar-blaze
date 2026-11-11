"""Cross-check the two observation sources and characterise the 'truth' quality.

For each core station and summer:
  * hours where GHCNh(lenient) and IEM both have a valid T/Td/Wind and how much they differ (are they the same METAR?)
  * share of T values that are whole degrees (METAR resolution) vs tenths (SYNOP) in the IEM series
  * station distances and distinct Open-Meteo 0.25-degree cells
Usage: python -I compare_sources.py <analysis_out_dir>
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

CORE = {
    "OMAA": "AEI0000OMAA",
    "OMAD": "AEI0000OMAD",
    "OMAL": "AEI0000OMAL",
    "OMDB": "AEI0000OMDB",
    "OMDW": "AEI0000OMDW",
    "OMFJ": "AEI0000OMFJ",
    "OMSJ": "AEI0000OMSJ",
    "OMRK": "AEU041184-1",
}
COORD = {
    "OMAA": (24.4330, 54.6511),
    "OMAD": (24.4283, 54.4581),
    "OMAL": (24.2617, 55.6092),
    "OMDB": (25.2550, 55.3643),
    "OMDW": (24.8861, 55.1722),
    "OMFJ": (25.1122, 56.3240),
    "OMSJ": (25.3286, 55.5172),
    "OMRK": (25.6130, 55.9390),
}


def hav(a: tuple[float, float], b: tuple[float, float]) -> float:
    r = 6371.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dphi, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def main(out_dir: str) -> None:
    out = Path(out_dir)
    pd.set_option("display.width", 220)
    rows = []
    for st, gid in CORE.items():
        for y in (2024, 2025, 2026):
            gp = out / "hourly_ghcnh_lenient" / f"{gid}_{y}.parquet"
            ip = out / "hourly_iem" / f"{st}_{y}.parquet"
            if not (gp.exists() and ip.exists()):
                continue
            g, i = pd.read_parquet(gp), pd.read_parquet(ip)
            idx = g.index.union(i.index)
            g, i = g.reindex(idx), i.reindex(idx)
            both_t = g["t"].notna() & i["t"].notna()
            both_td = g["td"].notna() & i["td"].notna()
            both_ws = g["ws"].notna() & i["ws"].notna()
            only_g = (g["t"].notna() & i["t"].isna()).sum()
            only_i = (i["t"].notna() & g["t"].isna()).sum()
            dt_ = (g["t"] - i["t"])[both_t]
            dtd = (g["td"] - i["td"])[both_td]
            dws = (g["ws"] - i["ws"])[both_ws]
            tv = i["t"].dropna()
            frac_int = float((np.abs(tv - tv.round()) < 0.05).mean()) if len(tv) else np.nan
            rows.append(
                {
                    "station": st,
                    "year": y,
                    "both_T": int(both_t.sum()),
                    "only_ghcnh_T": int(only_g),
                    "only_iem_T": int(only_i),
                    "T_mean_diff": round(float(dt_.mean()), 3),
                    "T_mae_diff": round(float(dt_.abs().mean()), 3),
                    "T_p99_absdiff": round(float(dt_.abs().quantile(0.99)), 2),
                    "Td_mae_diff": round(float(dtd.abs().mean()), 3),
                    "Td_p99_absdiff": round(float(dtd.abs().quantile(0.99)), 2),
                    "Ws_mae_diff_ms": round(float(dws.abs().mean()), 3),
                    "iem_T_whole_degree_share": round(frac_int, 3),
                }
            )
    df = pd.DataFrame(rows)
    print(df.to_string(index=False))
    df.to_csv(out / "source_crosscheck.csv", index=False)

    print("\nStation pairwise distances (km):")
    ks = list(COORD)
    d = pd.DataFrame([[round(hav(COORD[a], COORD[b])) for b in ks] for a in ks], index=ks, columns=ks)
    print(d.to_string())
    print("\nNearest 0.25-degree grid cell (IFS 0.25 / AIFS 0.25 / GFS 0.25 native grid):")
    cells = {}
    for k, (la, lo) in COORD.items():
        cell = (round(la * 4) / 4, round(lo * 4) / 4)
        cells.setdefault(cell, []).append(k)
        print(" ", k, (la, lo), "->", cell)
    print("distinct 0.25-degree cells:", len(cells), cells)


if __name__ == "__main__":
    main(sys.argv[1])
