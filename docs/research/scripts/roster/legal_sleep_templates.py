"""Seasonal roster frontier under UAE hours law, a clock-time sleep model and a do-no-harm guard (ADR 0011, v2).

v2 (2026-11-11) replaces v1 after the adversarial review (`docs/research/2026-11-11-planner-adversarial-review.md`, C1-C3, I2, I4).
v1 numbers (16.1% / 17.2% "avoided" under a span-only sleep model, vs a non-compliant baseline) are SUPERSEDED.

Templates (0.5 h grid, summer 15 May-30 Sep, ban 12:30-15:00 applied all summer as in Feasibility):
* 8.0 h work (normal hours, no overtime), no work 12:30-15:00.
* Morning and evening attendance blocks; each block may hold one internal 1 h break at any position.
* No work run longer than 5 h (Art. 18).
* At least 1 h of break per day that is NOT ban time (protective reading of Art. 18, switch
  `art18_ban_gap_counts_as_break = false`): credit = internal breaks + the part of the gap between blocks outside 12:30-15:00.
* Every non-empty block holds >= 2 h of work (no 1 h afternoon blocks; review M2).
* First start 04:30-08:00, last end <= 22:00.
Baselines: B0 common practice 06:00-12:30 + 15:00-17:00 (8.5 h, 6.5 h run: NOT compliant); B1 legal default 06:00-11:00 + 15:00-18:00.
Sleep (clock time): wake = start - commute - 0.75 h prep; bed = max(end + commute + 2 h evening buffer, bedtime floor);
sleep opportunity = wake + 24 - bed. Buffer, prep and floor are [I] assumptions.
Pick: leave-one-summer-out, minimise E28+E30+E32 per worked hour on the other two summers among templates that pass the gates
AND are no worse than B1 at every threshold on that climatology (do-no-harm guard, review C3). If none passes: "no change" = stay on B1.
Usage: python -I -X utf8 legal_sleep_templates.py <hourly_wbgt.parquet> <out_dir>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

YEARS = (2024, 2025, 2026)
STATIONS = ["OMAA", "OMDB", "OMAL", "OMFJ", "OMDW", "OMRK"]
HEAD = ["OMAA", "OMDB", "OMAL", "OMFJ"]
THRS = (28.0, 30.0, 32.0)
N_DAYS, NH, TZ = 139, 36, 4
WORK, BAN0, BAN1 = 8.0, 12.5, 15.0
PREP, BUFFER, GATE = 0.75, 2.0, 7.5


def grid(lo: float, hi: float) -> np.ndarray:
    return np.arange(lo, hi + 1e-9, 0.5)


def block_variants(start: float, work: float) -> list[tuple[tuple[float, float], ...]]:
    """Runs for a block starting at `start` with `work` hours: no break, or one 1 h break after k hours."""
    out = [((start, start + work),)]
    for k in grid(0.5, work - 0.5):
        out.append(((start, start + k), (start + k + 1.0, start + work + 1.0)))
    return out


def overlap(a: float, b: float, lo: float, hi: float) -> float:
    return max(0.0, min(b, hi) - max(a, lo))


def legal(runs: tuple[tuple[float, float], ...], ban_counts: bool = False) -> bool:
    if any(b - a > 5.0 + 1e-9 for a, b in runs):
        return False
    if any(overlap(a, b, BAN0, BAN1) > 1e-9 for a, b in runs):
        return False
    credit = 0.0
    for (_, b0), (a1, _) in zip(runs, runs[1:], strict=False):
        credit += (a1 - b0) - (0.0 if ban_counts else overlap(b0, a1, BAN0, BAN1))
    return credit >= 1.0 - 1e-9


def build() -> list[dict]:
    seen: set[tuple[tuple[float, float], ...]] = set()
    out: list[dict] = []
    for s in grid(4.5, 8.0):
        for m in [0.0, *grid(2.0, WORK)]:
            mvars = block_variants(s, m) if m > 0 else [()]
            for mv in mvars:
                if mv and mv[-1][1] > BAN0 + 1e-9:
                    continue
                ev = WORK - m
                if 0 < ev < 2.0:
                    continue
                for e in grid(15.0, 21.0) if ev > 0 else [None]:
                    evars = block_variants(e, ev) if ev > 0 else [()]
                    for evr in evars:
                        runs = tuple(mv) + tuple(evr)
                        if not runs or runs[-1][1] > 22.0 + 1e-9 or runs[0][0] < 4.5 - 1e-9 or runs[0][0] > 8.0 + 1e-9:
                            continue
                        if runs in seen or not legal(runs):
                            continue
                        seen.add(runs)
                        out.append({"runs": runs, "start": runs[0][0], "end": runs[-1][1]})
    return out


def clock(x: float) -> str:
    return f"{int(x) % 24:02d}:{int(round((x - int(x)) * 60)):02d}"


def name(runs: tuple[tuple[float, float], ...]) -> str:
    return " + ".join(f"{clock(a)}-{clock(b)}" for a, b in runs)


def weights(rs: list[dict]) -> np.ndarray:
    w = np.zeros((len(rs), NH))
    for i, r in enumerate(rs):
        for a, b in r["runs"]:
            for h in range(NH):
                w[i, h] += overlap(a, b, h - 0.5, h + 0.5)
    return w


def day_matrix(df: pd.DataFrame, year: int) -> np.ndarray:
    s = df.loc[df.year == year].set_index("time_utc")["wbgt_obs"]
    s.index = s.index + pd.Timedelta(hours=TZ)
    start = pd.Timestamp(f"{year}-05-15 00:00")
    hours = (np.arange(N_DAYS)[:, None] * 24 + np.arange(NH)[None, :]).ravel()
    return s.reindex(start + pd.to_timedelta(hours, unit="h")).to_numpy().reshape(N_DAYS, NH)


def sleep_clock(start: np.ndarray, end: np.ndarray, c: float, floor: float) -> np.ndarray:
    wake = start - c - PREP
    bed = np.maximum(end + c + BUFFER, floor)
    return wake + 24.0 - bed


def sleep_span(start: np.ndarray, end: np.ndarray, c: float) -> np.ndarray:  # v1 model, kept only to show what it credited
    return 24.0 - (end - start) - 2 * c - PREP - BUFFER


def exposures(df: pd.DataFrame, wt: np.ndarray) -> dict[str, dict[float, np.ndarray]]:
    out = {}
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
                dm = valid.all(axis=1)
                per.append(np.where(dm[:, None], hot @ wt.T, 0.0).sum(axis=0))
            E[thr] = np.stack(per)  # [Y, R]
        out[st] = E
    return out


def pick(E: dict[float, np.ndarray], hrs: np.ndarray, mask: np.ndarray, yi: int, ref: int, guard: bool) -> int | None:
    others = [j for j in range(3) if j != yi]
    per_h = {t: E[t][others].sum(axis=0) / hrs for t in THRS}
    ok = mask.copy()
    if guard:
        for t in THRS:
            ok &= per_h[t] <= per_h[t][ref] + 1e-9
    sev = sum(per_h[t] for t in THRS)
    cand = np.where(ok, sev, np.inf)
    return int(np.argmin(cand)) if np.isfinite(cand).any() else None


def main() -> None:
    df = pd.read_parquet(sys.argv[1])
    out_dir = Path(sys.argv[2])
    if df["time_utc"].dt.tz is not None:
        df["time_utc"] = df["time_utc"].dt.tz_convert(None)
    b0 = {"runs": ((6.0, 12.5), (15.0, 17.0)), "start": 6.0, "end": 17.0}
    b1 = {"runs": ((6.0, 11.0), (15.0, 18.0)), "start": 6.0, "end": 18.0}
    assert legal(b1["runs"]) and not legal(b0["runs"])
    rs = [b0, b1, *[r for r in build() if r["runs"] != b1["runs"]]]
    wt = weights(rs)
    hrs = wt.sum(axis=1)
    start = np.array([r["start"] for r in rs])
    end = np.array([r["end"] for r in rs])
    E_all = exposures(df, wt)
    lines = [f"templates (legal, excl. baselines): {len(rs) - 2}"]

    # 1. Legalisation effect B0 -> B1 (per worked hour)
    leg = []
    for st in STATIONS:
        for yi, _ in enumerate(YEARS):
            leg.append({t: 1 - (E_all[st][t][yi, 1] / hrs[1]) / (E_all[st][t][yi, 0] / hrs[0]) for t in THRS})
    lg = pd.DataFrame(leg)
    lines.append(
        "B0 -> B1 (legalising the common roster), share per worked hour removed, 6 clusters x 3 summers: "
        + ", ".join(f">={int(t)}: {lg[t].mean():.1%} (range {lg[t].min():.1%}..{lg[t].max():.1%})" for t in THRS)
    )
    for c in (0.75, 1.5):
        for fl in (21.0, 21.5, 22.0):
            s1 = sleep_clock(start[:2], end[:2], c, fl)
            lines.append(f"sleep opp. commute {c * 60:.0f} min, bedtime floor {clock(fl)}: B0 {s1[0]:.2f} h, B1 {s1[1]:.2f} h")

    # 2. Scenario table
    scen = []
    for c in (0.75, 1.5):
        scen.append(("legal hours only (no sleep gate)", c, None, False, True))
        scen.append(("v1 span sleep model >=7.5 h, no guard [SUPERSEDED]", c, "span", False, False))
        for fl in (21.0, 21.5, 22.0):
            for bus in (False, True):
                scen.append((f"sleep>=7.5 h, bedtime floor {clock(fl)}" + (", bus>=05:00" if bus else ""), c, fl, bus, True))
            scen.append((f"sleep no worse than legal default, bedtime floor {clock(fl)}", c, ("rel", fl), False, True))
    rows = []
    for label, c, fl, bus, guard in scen:
        if fl is None:
            mask = np.ones(len(rs), dtype=bool)
        elif fl == "span":
            mask = sleep_span(start, end, c) >= GATE - 1e-9
        elif isinstance(fl, tuple):
            sl = sleep_clock(start, end, c, fl[1])
            mask = sl >= sl[1] - 1e-9
        else:
            mask = sleep_clock(start, end, c, fl) >= GATE - 1e-9
        if bus:
            mask &= (start - c) >= 5.0 - 1e-9
        mask[0] = False  # never recommend the non-compliant common roster
        for st in STATIONS:
            for yi, y in enumerate(YEARS):
                k = pick(E_all[st], hrs, mask, yi, ref=1, guard=guard)
                kk = 1 if k is None else k
                fl_eval = 21.5 if fl in (None, "span") else (fl[1] if isinstance(fl, tuple) else fl)
                rows.append(
                    {
                        "scenario": label,
                        "commute_min": int(c * 60),
                        "station": st,
                        "year": y,
                        "no_change": k is None,
                        "roster": name(rs[kk]["runs"]),
                        "start": clock(start[kk]),
                        "sleep_h_at_floor": float(sleep_clock(start[kk : kk + 1], end[kk : kk + 1], c, fl_eval)[0]),
                        **{f"vsB1_{int(t)}": 1 - (E_all[st][t][yi, kk] / hrs[kk]) / (E_all[st][t][yi, 1] / hrs[1]) for t in THRS},
                        **{f"vsB0_{int(t)}": 1 - (E_all[st][t][yi, kk] / hrs[kk]) / (E_all[st][t][yi, 0] / hrs[0]) for t in THRS},
                    }
                )
    res = pd.DataFrame(rows)
    res.to_csv(out_dir / "legal_sleep_templates.csv", index=False)
    pd.set_option("display.width", 260)
    pd.set_option("display.max_columns", 30)
    pd.set_option("display.max_colwidth", 70)
    cols = ["vsB1_28", "vsB1_30", "vsB1_32", "vsB0_30", "vsB0_32", "no_change", "sleep_h_at_floor"]
    for grp, sts in (("4 headline stations", HEAD), ("6 clusters", STATIONS)):
        lines.append(f"\n{grp} x 3 summers, LOSO, share of exposure per worked hour avoided (vsB1 = vs legal default):")
        t = res[res.station.isin(sts)].groupby(["commute_min", "scenario"], sort=False)[cols].mean().round(3)
        lines.append(t.to_string())
    h = res[res.station.isin(HEAD)]
    lines.append("\nmost common pick (headline):")
    lines.append(
        h.groupby(["commute_min", "scenario"], sort=False)["roster"]
        .agg(lambda s: s.value_counts().index[0] + f" ({s.value_counts().iloc[0]}/{len(s)})")
        .to_string()
    )

    # 3. Frontier JSON for the demo chart (default floor 21:30, gate 7.5 h, guard on, 6 clusters)
    fr = []
    for cm in (15, 30, 45, 60, 75, 90):
        c = cm / 60
        mask = sleep_clock(start, end, c, 21.5) >= GATE - 1e-9
        mask[0] = False
        vals: dict[float, list[float]] = {t: [] for t in THRS}
        nochange = 0
        for st in STATIONS:
            for yi, _ in enumerate(YEARS):
                k = pick(E_all[st], hrs, mask, yi, ref=1, guard=True)
                kk = 1 if k is None else k
                nochange += k is None
                for t in THRS:
                    vals[t].append(1 - (E_all[st][t][yi, kk] / hrs[kk]) / (E_all[st][t][yi, 1] / hrs[1]))
        b1s = float(sleep_clock(start[1:2], end[1:2], c, 21.5)[0])
        fr.append(
            {
                "commute_min": cm,
                "b1_sleep_h": round(b1s, 2),
                "b1_passes_sleep_gate": bool(b1s >= GATE - 1e-9),
                "folds_no_change": nochange,
                "folds": len(STATIONS) * 3,
                **{f"avoided_vs_legal_default_ge{int(t)}": round(float(np.mean(v)), 4) for t, v in vals.items()},
            }
        )
    lines.append("\nFrontier (6 clusters, floor 21:30, gate 7.5 h, guard on):")
    lines.append(pd.DataFrame(fr).to_string(index=False))
    # 4. Pareto fronts for the demo chart: E30 per worked hour (mean of 6 clusters x 3 summers, REAL obs) vs sleep opportunity
    e30h = np.mean([E_all[st][30.0].mean(axis=0) / hrs for st in STATIONS], axis=0)
    e32h = np.mean([E_all[st][32.0].mean(axis=0) / hrs for st in STATIONS], axis=0)
    fronts = []
    for cm in (15, 30, 45, 60, 75, 90):
        sl = sleep_clock(start, end, cm / 60, 21.5)
        pts = []
        best = np.inf
        for i in np.lexsort((e30h, -sl)):  # sleep descending, then E30 ascending
            if i == 0:
                continue
            if e30h[i] < best - 1e-9:
                best = e30h[i]
                pts.append(
                    {
                        "roster": name(rs[i]["runs"]),
                        "sleep_h": round(float(sl[i]), 2),
                        "e30_per_h": round(float(e30h[i]), 3),
                        "e32_per_h": round(float(e32h[i]), 3),
                    }
                )
        fronts.append(
            {
                "commute_min": cm,
                "pareto": pts,
                "B0": {"sleep_h": round(float(sl[0]), 2), "e30_per_h": round(float(e30h[0]), 3), "e32_per_h": round(float(e32h[0]), 3)},
                "B1": {"sleep_h": round(float(sl[1]), 2), "e30_per_h": round(float(e30h[1]), 3), "e32_per_h": round(float(e32h[1]), 3)},
            }
        )
    neutral = (
        res[res.scenario.str.startswith("sleep no worse")]
        .groupby(["commute_min", "scenario"], sort=False)[["vsB1_28", "vsB1_30", "vsB1_32"]]
        .mean()
        .round(4)
        .reset_index()
        .to_dict(orient="records")
    )
    payload = {
        "label": "REAL climatology (station obs WBGT, 2024-2026, LOSO); commute, buffer and bedtime are [I] assumptions",
        "generated_by": "docs/research/scripts/roster/legal_sleep_templates.py v2",
        "assumptions": {"prep_h": PREP, "evening_buffer_h": BUFFER, "bedtime_floor": "21:30", "sleep_gate_h": GATE},
        "baselines": {"B0_common_practice_non_compliant": name(b0["runs"]), "B1_legal_default": name(b1["runs"])},
        "legalisation_B0_to_B1_mean": {f"ge{int(t)}": round(float(lg[t].mean()), 4) for t in THRS},
        "frontier_absolute_gate": fr,
        "sleep_neutral_vs_legal_default": neutral,
        "pareto_e30_vs_sleep": fronts,
        "units": "e30_per_h = summer worker-hours at WBGT>=30 per scheduled daily hour (divide by ~139 days for a share)",
    }
    (out_dir / "roster_frontier.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    text = "\n".join(lines)
    (out_dir / "legal_sleep_templates_output.txt").write_text(text + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
