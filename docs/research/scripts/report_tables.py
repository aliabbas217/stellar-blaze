"""Render the markdown tables used in the data-availability report from the CSV/JSON outputs of the other scripts.
Usage: python -I report_tables.py <analysis_out_dir> <pairs_out_dir> <forecast_probe_dir> > tables.md
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

EXPECT = 3336
CORE = ["OMAA", "OMAD", "OMAL", "OMDB", "OMDW", "OMFJ", "OMSJ", "OMRK"]
GH_KEY = {
    "OMAA": "OMAA Abu Dhabi Intl",
    "OMAD": "OMAD Al Bateen",
    "OMAL": "OMAL Al Ain Intl",
    "OMDB": "OMDB Dubai Intl",
    "OMDW": "OMDW Al Maktoum Intl",
    "OMFJ": "OMFJ Fujairah Intl",
    "OMSJ": "OMSJ Sharjah Intl",
    "OMRK": "41184 Ras Al Khaimah",
}
NAME = {
    "OMAA": "Abu Dhabi Intl",
    "OMAD": "Al Bateen",
    "OMAL": "Al Ain Intl",
    "OMDB": "Dubai Intl",
    "OMDW": "Al Maktoum Intl",
    "OMFJ": "Fujairah Intl",
    "OMSJ": "Sharjah Intl",
    "OMRK": "Ras Al Khaimah",
}


def pct(n: float) -> str:
    return f"{100 * n / EXPECT:.1f}%"


def md(df: pd.DataFrame) -> str:
    cols = list(df.columns)
    out = ["| " + " | ".join(cols) + " |", "|" + "|".join("---" for _ in cols) + "|"]
    for _, r in df.iterrows():
        out.append("| " + " | ".join(str(r[c]) for c in cols) + " |")
    return "\n".join(out)


def main(an: str, pairs: str, probe: str) -> None:
    an_dir, pr_dir, fp_dir = Path(an), Path(pairs), Path(probe)
    iem = pd.read_csv(an_dir / "obs_counts_iem.csv")
    gl = pd.read_csv(an_dir / "obs_counts_ghcnh_lenient.csv")
    gs = pd.read_csv(an_dir / "obs_counts_ghcnh_strict.csv")

    rows = []
    for st in CORE:
        for y in (2024, 2025, 2026):
            i = iem[(iem.station == st) & (iem.year == y)].iloc[0]
            gk = GH_KEY[st]
            lenient = gl[(gl.station == gk) & (gl.year == y)].iloc[0]
            s = gs[(gs.station == gk) & (gs.year == y)].iloc[0]
            rows.append(
                {
                    "Station": f"{st} {NAME[st]}",
                    "Summer": y,
                    "IEM T/Td/Wind (h of 3336)": f"{int(i.T_Td_Wind)} ({pct(i.T_Td_Wind)})",
                    "IEM day-hours (of 1251)": int(i.day_T_Td_Wind),
                    "IEM longest gap (h)": int(i.longest_core_gap_h),
                    "GHCNh lenient": f"{int(lenient.T_Td_Wind)} ({pct(lenient.T_Td_Wind)})",
                    "GHCNh strict-QC": f"{int(s.T_Td_Wind)} ({pct(s.T_Td_Wind)})",
                    "GHCNh stn-pressure (h)": int(lenient.P_station),
                    "IEM altimeter (h)": int(i.P_sealevel),
                }
            )
    print("### Table O1: core stations, joint valid T+Td+Wind hours per summer (15 May-30 Sep, 3336 h)\n")
    print(md(pd.DataFrame(rows)))

    print("\n### Table O2: non-core stations (GHCNh lenient joint T/Td/Wind hours; IEM in brackets where it has data)\n")
    rows = []
    for k in gl.station.unique():
        if k in GH_KEY.values():
            continue
        r = {"Station (GHCNh)": k}
        for y in (2024, 2025, 2026):
            g = gl[(gl.station == k) & (gl.year == y)].iloc[0]
            r[str(y)] = "no file" if g.file != "ok" else f"{int(g.T_Td_Wind)} ({int(g.obs_rows_year)} rows/yr)"
        rows.append(r)
    print(md(pd.DataFrame(rows)))

    print("\n### Table F1: archive probe, first non-null time (UTC) at OMAA grid, request window 2021-01-01..2026-11-10\n")
    res = json.loads((fp_dir / "probe_result.json").read_text())
    rows = []
    for m in res["A_prev_day1_first"]:
        a, h = res["A_prev_day1_first"][m], res["A_hist_first"][m]
        rows.append(
            {
                "Model": m,
                "PrevRuns day1 T": (a.get("temperature_2m_previous_day1") or "none")[:10],
                "PrevRuns day1 Td": (a.get("dew_point_2m_previous_day1") or "none")[:10],
                "PrevRuns day1 SW": (a.get("shortwave_radiation_previous_day1") or "none")[:10],
                "HistFcst T": (h.get("temperature_2m") or "none")[:10],
                "HistFcst Td": (h.get("dew_point_2m") or "none")[:10],
            }
        )
    print(md(pd.DataFrame(rows)))

    print("\n### Table F2: Previous Runs coverage in each summer at OMAA (non-null hours of 3336; T / Td / shortwave; leads 1,2,3,5,7 d)\n")
    rows = []
    for key, v in res["B_counts"].items():
        m, y = key.split("|")
        c = v["counts"]

        def lead(var: str, k: int, c: dict = c) -> int:
            return c[var if k == 0 else f"{var}_previous_day{k}"]

        r = {"Model": m, "Summer": y}
        for k in (1, 2, 3, 5, 7):
            r[f"d{k}"] = f"{lead('temperature_2m', k)}/{lead('dew_point_2m', k)}/{lead('shortwave_radiation', k)}"
        rows.append(r)
    print(md(pd.DataFrame(rows)))

    pc = pd.read_csv(pr_dir / "pair_counts.csv")
    for src in ("IEM", "GHCNh"):
        print(f"\n### Table P-{src}: matched joint (T+Td+Wind) hourly pairs, summed over the 8 core stations, obs={src}\n")
        sub = pc[pc.obs_src == src]
        t = sub.pivot_table(index=["model", "year"], columns="lead_d", values="pairs_joint", aggfunc="sum").astype(int)
        t.columns = [f"d{c}" for c in t.columns]
        print(md(t.reset_index()))
    print("\n### Table P-day: daytime (10-19 local) matched joint pairs, obs=IEM\n")
    sub = pc[pc.obs_src == "IEM"]
    t = sub.pivot_table(index=["model", "year"], columns="lead_d", values="pairs_joint_daytime", aggfunc="sum").astype(int)
    t.columns = [f"d{c}" for c in t.columns]
    print(md(t.reset_index()))

    be = pd.read_csv(pr_dir / "baseline_errors_pooled.csv")
    print("\n### Table E1: raw forecast error vs IEM obs pooled over 8 stations (all hours / daytime)\n")
    sel = be[be.lead_d.isin([1, 3, 7])].copy()
    sel = sel.round(2)
    sel["n"] = sel["n"].astype(int)
    print(md(sel))


if __name__ == "__main__":
    main(*sys.argv[1:4])
