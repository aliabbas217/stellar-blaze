"""Re-score the roster-feasibility result under legal + sleep gates (ADR 0011 check).

Templates: 8.0 h normal work (no overtime), no work 12:30-15:00, no contiguous work run > 5 h
(a single block > 5 h gets a 1 h unpaid break at its midpoint; for split days the gap is the break),
start 04:30-08:00, last end <= 19:30 (DAY) or <= 22:00 (EVE). Exposure is counted on work hours only.
Sleep opportunity (S1 of the sleep doc) = 24 - span - 2*commute - prep(0.75) - evening buffer(2.0).
Choice = seasonal leave-one-summer-out argmin of E28+E30+E32 among templates passing each gate.
Usage: python -I -X utf8 legal_sleep_templates.py <hourly_wbgt.parquet>
"""

from __future__ import annotations

import sys

import numpy as np
import pandas as pd

YEARS = (2024, 2025, 2026)
STATIONS = ["OMAA", "OMDB", "OMAL", "OMFJ", "OMDW", "OMRK"]
HEAD = ["OMAA", "OMDB", "OMAL", "OMFJ"]
THRS = (28.0, 30.0, 32.0)
N_DAYS, NH, TZ = 139, 36, 4
WORK = 8.0


def grid(lo: float, hi: float) -> np.ndarray:
    return np.arange(lo, hi + 1e-9, 0.5)


def build() -> list[dict]:
    out = []
    ban0 = 12.5  # midday ban 12:30-15:00; evening blocks start at or after 15:00
    # single block (morning only, before ban): 8 h work + 1 h break = 9 h span -> must end by 12:30 -> start <= 3:30: none in range
    # split: morning work m, evening work 8-m
    for s in grid(4.5, 8.0):
        for m in grid(0.0, 8.0):
            mspan = m + (1.0 if m > 5.0 else 0.0)
            if m > 0 and s + mspan > ban0 + 1e-9:
                continue
            ev = WORK - m
            espan = ev + (1.0 if ev > 5.0 else 0.0)
            for e in grid(15.0, 21.5):
                if ev == 0 and e > 15.0:
                    continue
                end = e + espan if ev > 0 else s + mspan
                if end > 22.0 + 1e-9:
                    continue
                if m == 0:
                    start = e
                    if s != 4.5:
                        continue  # evening-only: dedupe on s
                else:
                    start = s
                blocks = []
                if m > 0:
                    if m > 5.0:
                        h = m / 2
                        blocks += [(s, s + h), (s + h + 1.0, s + mspan)]
                    else:
                        blocks.append((s, s + m))
                if ev > 0:
                    if ev > 5.0:
                        h = ev / 2
                        blocks += [(e, e + h), (e + h + 1.0, e + espan)]
                    else:
                        blocks.append((e, e + ev))
                out.append(
                    {
                        "name": " + ".join(f"{a:05.2f}-{b:05.2f}" for a, b in blocks),
                        "blocks": tuple(blocks),
                        "start": start,
                        "end": end,
                        "span": end - start,
                        "lib": "DAY" if end <= 19.5 + 1e-9 else "EVE",
                    }
                )
    # dedupe
    seen, uniq = set(), []
    for r in out:
        if r["blocks"] not in seen:
            seen.add(r["blocks"])
            uniq.append(r)
    return uniq


def weights(rs: list[dict]) -> np.ndarray:
    w = np.zeros((len(rs), NH))
    for i, r in enumerate(rs):
        for a, b in r["blocks"]:
            for h in range(NH):
                w[i, h] += max(0.0, min(b, h + 0.5) - max(a, h - 0.5))
    return w


def day_matrix(df: pd.DataFrame, year: int) -> np.ndarray:
    s = df.loc[df.year == year].set_index("time_utc")["wbgt_obs"]
    s.index = s.index + pd.Timedelta(hours=TZ)
    start = pd.Timestamp(f"{year}-05-15 00:00")
    hours = (np.arange(N_DAYS)[:, None] * 24 + np.arange(NH)[None, :]).ravel()
    return s.reindex(start + pd.to_timedelta(hours, unit="h")).to_numpy().reshape(N_DAYS, NH)


def main() -> None:
    df = pd.read_parquet(sys.argv[1])
    if df["time_utc"].dt.tz is not None:
        df["time_utc"] = df["time_utc"].dt.tz_convert(None)
    rs = build()
    base = {
        "name": "baseline 06:00-12:30+15:00-17:00",
        "blocks": ((6.0, 12.5), (15.0, 17.0)),
        "start": 6.0,
        "end": 17.0,
        "span": 11.0,
        "lib": "BASE",
    }
    allr = [base] + rs
    wt = weights(allr)
    hrs = wt.sum(axis=1)
    span = np.array([r["span"] for r in allr])
    start = np.array([r["start"] for r in allr])
    lib = np.array([r["lib"] for r in allr])
    print(f"templates: {len(rs)} (DAY {np.sum(lib == 'DAY')}, EVE {np.sum(lib == 'EVE')})")

    def sleep(c: float) -> np.ndarray:
        return 24.0 - span - 2 * c - 0.75 - 2.0

    gates = {
        "G0 legal only, DAY": (lib == "DAY"),
        "G0 legal only, DAY+EVE": np.isin(lib, ["DAY", "EVE"]),
        "G1 sleep>=7.5h @45min, DAY+EVE": np.isin(lib, ["DAY", "EVE"]) & (sleep(0.75) >= 7.5 - 1e-9),
        "G2 sleep>=7.0h @45min, DAY+EVE": np.isin(lib, ["DAY", "EVE"]) & (sleep(0.75) >= 7.0 - 1e-9),
        "G3 sleep>=7.5h @90min, DAY+EVE": np.isin(lib, ["DAY", "EVE"]) & (sleep(1.5) >= 7.5 - 1e-9),
        "G4 sleep>=7.5h @45min + start>=06:00": np.isin(lib, ["DAY", "EVE"]) & (sleep(0.75) >= 7.5 - 1e-9) & (start >= 6.0),
        "G5 sleep>=7.5h @45min + start>=05:00": np.isin(lib, ["DAY", "EVE"]) & (sleep(0.75) >= 7.5 - 1e-9) & (start >= 5.0),
    }
    print(f"baseline sleep opp: {sleep(0.75)[0]:.2f} h @45, {sleep(1.5)[0]:.2f} h @90; hours {hrs[0]}")
    rows = []
    for st in STATIONS:
        d = df[df.station == st]
        E = {}
        for thr in THRS:
            per = []
            for y in YEARS:
                wd = day_matrix(d, y)
                nan = np.isnan(wd)
                hot = np.where(nan, 0.0, (wd >= thr).astype(float))
                valid = (nan.astype(float) @ (wt > 0).astype(float).T) == 0
                e = hot @ wt.T
                dm = valid.all(axis=1)
                per.append(np.where(dm[:, None], e, 0.0).sum(axis=0))
            E[thr] = np.stack(per)  # [Y,R]
        sev = sum(E[t] for t in THRS)
        for gname, mask in gates.items():
            for yi, y in enumerate(YEARS):
                other = sev[[j for j in range(3) if j != yi]].sum(axis=0) / hrs
                cand = np.where(mask, other, np.inf)
                k = int(np.argmin(cand))
                rows.append(
                    {
                        "station": st,
                        "year": y,
                        "gate": gname,
                        "roster": allr[k]["name"],
                        "start": start[k],
                        "sleep45": sleep(0.75)[k],
                        "sleep90": sleep(1.5)[k],
                        "hours": hrs[k],
                        **{f"share{int(t)}": E[t][yi, k] / hrs[k] for t in THRS},
                        **{f"base_share{int(t)}": E[t][yi, 0] / hrs[0] for t in THRS},
                    }
                )
    res = pd.DataFrame(rows)
    for t in (28, 30, 32):
        res[f"avoided{t}"] = 1 - res[f"share{t}"] / res[f"base_share{t}"]
    pd.set_option("display.width", 250)
    pd.set_option("display.max_columns", 30)
    h = res[res.station.isin(HEAD)]
    print("\n4 headline stations x 3 summers, mean share avoided vs baseline (per worked hour):")
    print(h.groupby("gate")[["avoided28", "avoided30", "avoided32", "sleep45", "start"]].mean().round(3))
    print("\n6 clusters:")
    print(res.groupby("gate")[["avoided28", "avoided30", "avoided32"]].mean().round(3))
    print("\nmost common chosen roster per gate (headline):")
    print(h.groupby("gate")["roster"].agg(lambda s: s.value_counts().index[0] + f" ({s.value_counts().iloc[0]}/{len(s)})"))
    res.to_csv(sys.argv[2], index=False)

    # Frontier: best LOSO seasonal template vs sleep-opportunity gate, per commute (headline stations, DAY+EVE)
    fr = []
    sev_by_st = {}
    for st in HEAD:
        d = df[df.station == st]
        E = {}
        for thr in THRS:
            per = []
            for y in YEARS:
                wd = day_matrix(d, y)
                nan = np.isnan(wd)
                hot = np.where(nan, 0.0, (wd >= thr).astype(float))
                valid = (nan.astype(float) @ (wt > 0).astype(float).T) == 0
                dm = valid.all(axis=1)
                per.append(np.where(dm[:, None], hot @ wt.T, 0.0).sum(axis=0))
            E[thr] = np.stack(per)
        sev_by_st[st] = E
    for c in (0.5, 0.75, 1.0, 1.5):
        for g in np.arange(5.0, 9.01, 0.5):
            mask = np.isin(lib, ["DAY", "EVE"]) & (sleep(c) >= g - 1e-9)
            vals = {28: [], 30: [], 32: []}
            n_ok = int(mask.sum())
            for st in HEAD:
                E = sev_by_st[st]
                sev = sum(E[t] for t in THRS)
                for yi in range(3):
                    other = sev[[j for j in range(3) if j != yi]].sum(axis=0) / hrs
                    cand = np.where(mask, other, np.inf)
                    if not np.isfinite(cand).any():
                        continue
                    k = int(np.argmin(cand))
                    for t in (28, 30, 32):
                        vals[t].append(1 - (E[float(t)][yi, k] / hrs[k]) / (E[float(t)][yi, 0] / hrs[0]))
            fr.append(
                {
                    "commute_h": c,
                    "sleep_gate_h": g,
                    "n_templates": n_ok,
                    **{f"avoided{t}": (np.mean(v) if v else np.nan) for t, v in vals.items()},
                }
            )
    frd = pd.DataFrame(fr)
    print("\nFrontier (headline 4 x 3 summers, LOSO, share avoided vs baseline):")
    print(frd.round(3).to_string(index=False))
    frd.to_csv(sys.argv[2].replace(".csv", "_frontier.csv"), index=False)


if __name__ == "__main__":
    main()
