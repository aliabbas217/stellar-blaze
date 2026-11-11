"""Daily layer INSIDE a fixed shift: assign task intensities to the shift's 17 half-hour slots using the day's WBGT.

Shift (fixed, never changes): (A) baseline 06:00-12:30 + 15:00-17:00, (B) best DAY seasonal roster 04:30-10:00 + 16:30-19:30.
Task mix (ASSUMPTION, labelled): 5 light (M=180 W), 7 moderate (300 W), 5 heavy (415 W) half-hour tasks per day = 8.5 h.
Limit per task: NIOSH REL (acclimatised) = 56.7 - 11.5*log10(M) degC-WBGT (ADR 0006): 30.77 / 28.21 / 26.59.
Metrics (observed WBGT, per 139 days, one worker): hours over REL = sum 0.5 h * 1[WBGT > REL(task)];
excess = sum 0.5 h * max(0, WBGT - REL).
Strategies for the order of tasks inside the fixed shift:
  random      : expected value over random permutations (closed form)
  heavy_first : fixed rule, heavy tasks in the earliest slots, light last
  opt_fc1/3   : exact assignment (Hungarian) minimising the excess on the IFS lead-1 / lead-3 forecast
                (raw or LOSO bias-corrected), scored on observations
  opt_obs     : same with perfect knowledge (upper bound)
Usage: python -I -X utf8 within_shift.py <hourly_wbgt.parquet> <out_dir>
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extra_analyses import slot_matrix  # noqa: E402
from roster_ladder import CLUSTER6, YEARS, day_matrix  # noqa: E402

M_W = {"light": 180.0, "moderate": 300.0, "heavy": 415.0}
REL = {k: 56.7 - 11.5 * np.log10(v) for k, v in M_W.items()}
MIX = ["light"] * 5 + ["moderate"] * 7 + ["heavy"] * 5
REL_VEC = np.array([REL[t] for t in MIX])
SHIFTS = {
    "A baseline 06:00-12:30 + 15:00-17:00": [(6.0, 12.5), (15.0, 17.0)],
    "B 04:30-10:00 + 16:30-19:30": [(4.5, 10.0), (16.5, 19.5)],
}


def over(wo: np.ndarray, assign: np.ndarray) -> np.ndarray:
    """[hours over REL, excess degC h] for slot WBGT wo and a task assignment (task index per slot)."""
    return np.array([0.5 * np.sum(wo > REL_VEC[assign]), 0.5 * np.sum(np.maximum(0.0, wo - REL_VEC[assign]))])


def shift_slot_idx(starts: np.ndarray, blocks: list[tuple[float, float]]) -> np.ndarray:
    idx = [i for i, s in enumerate(starts) if any(s >= a - 1e-9 and s + 0.5 <= b + 1e-9 for a, b in blocks)]
    assert len(idx) == 17, len(idx)
    return np.array(idx)


def main(parquet: str, out: str) -> None:
    out_dir = Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)
    df = pd.read_parquet(parquet)
    rows = []
    for st in CLUSTER6:
        d = df[df.station == st]
        for y in YEARS:
            starts, obs = slot_matrix(day_matrix(d, "wbgt_obs", y))
            fcs = {
                f"fc{k}_{kind}": slot_matrix(day_matrix(d, f"wbgt_{c}{k}", y))[1]
                for k in (1, 3)
                for kind, c in (("raw", "L"), ("bc", "bc"))
            }
            for sname, blocks in SHIFTS.items():
                idx = shift_slot_idx(starts, blocks)
                w_obs = obs[:, idx]
                ok = ~np.isnan(w_obs).any(axis=1)
                for v in fcs.values():
                    ok &= ~np.isnan(v[:, idx]).any(axis=1)
                res = {k: np.zeros(2) for k in ("random", "heavy_first", "opt_obs", *fcs.keys())}  # [hours over REL, excess]
                for dd in np.nonzero(ok)[0]:
                    wo = w_obs[dd]
                    # random: expectation over uniformly random assignment
                    m = np.array([0.5 * np.mean([(wo[s] > REL[t]) for t in MIX]) for s in range(17)]).sum()
                    e = np.array([0.5 * np.mean([max(0.0, wo[s] - REL[t]) for t in MIX]) for s in range(17)]).sum()
                    res["random"] += np.array([m, e])
                    # heavy first: slot i gets task sorted heavy..light
                    order = np.argsort(-REL_VEC * -1)  # ascending REL = heavy first
                    assign = np.empty(17, dtype=int)
                    assign[np.arange(17)] = order
                    res["heavy_first"] += over(wo, assign)

                    def best(wdec: np.ndarray) -> np.ndarray:
                        cost = np.maximum(0.0, wdec[:, None] - REL_VEC[None, :])  # slot x task
                        r, c = linear_sum_assignment(cost + 1e-6 * (wdec[:, None] > REL_VEC[None, :]))
                        a = np.empty(17, dtype=int)
                        a[r] = c
                        return a

                    res["opt_obs"] += over(wo, best(wo))
                    for k_, v in fcs.items():
                        res[k_] += over(wo, best(v[dd, idx]))
                scale = 139 / max(int(ok.sum()), 1)
                for strat, v in res.items():
                    rows.append(
                        {
                            "station": st,
                            "year": y,
                            "shift": sname,
                            "strategy": strat,
                            "n_days": int(ok.sum()),
                            "hours_over_REL": v[0] * scale,
                            "excess_degC_h": v[1] * scale,
                        }
                    )
    pd.DataFrame(rows).to_csv(out_dir / "within_shift.csv", index=False)
    r = pd.DataFrame(rows)
    g = r.groupby(["shift", "strategy"])[["hours_over_REL", "excess_degC_h"]].mean().round(0)
    pd.set_option("display.width", 200)
    print(g.to_string())
    print("REL thresholds:", {k: round(float(v), 2) for k, v in REL.items()})


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
