"""Value of planning horizons for heat-aware rostering: fixed seasonal vs monthly vs weekly vs daily, on real UAE station WBGT.

Input : hourly_wbgt.parquet from build_wbgt.py (obs-based WBGT truth plus IFS lead-1..7 forecast WBGT, raw and bias-corrected).
Output: CSVs in <out_dir> (named rosters, ladder, stability, stability-vs-exposure frontier, chosen rosters).

Definitions (all local time = UTC+4, no DST):
* Hourly WBGT label h is treated as the instant h:00 and as representative of [h-30 min, h+30 min). A roster block [a, b) gets weight =
  overlap with that interval, so 06:00-12:30 weights label 6 by 0.5 and labels 7..12 by 1.
* Exposure E_x = sum over scheduled hours of weight * 1[WBGT >= x], x in {28, 30, 32} degC
  ("worker-hours at WBGT >= x", one worker, one summer).
* Objective used to PICK a roster: severity S = E28 + E30 + E32 (each hour counts 0..3). Equal productive time: every candidate in the
  optimisation libraries has exactly 8.5 h of work (same as the 06:00-12:30 + 15:00-17:00 baseline) so choices cannot win by working less.
* Libraries: DAY = blocks inside 04:30-19:30; EVE = DAY plus evening blocks up to 22:00 (work after dark);
  ALL = EVE plus continuous 8.5 h night
  shifts starting 19:00-23:00. No work inside the 12:30-15:00 midday ban in any candidate (applied on all days for simplicity).
* Summer = 15 May .. 30 Sep (139 local days); months are local calendar months;
  a week is a block of 7 consecutive days from 15 May (20 blocks, last has 6).
* Strategies. All are scored on the OBSERVED WBGT of the days they are applied to, on the same set of valid days.
    fixed_baseline : 06:00-12:30 + 15:00-17:00 every day
    seasonal_oracle: one roster per station-summer chosen with hindsight (upper bound for "fixed")
    seasonal_loso  : one roster per station-summer chosen from the OTHER two summers (honest climatology)
    monthly_oracle / monthly_loso : one roster per calendar month
    weekly_clim_loso: roster per week-block from the other summers; weekly_persist: best roster of the previous observed week
    weekly_fc_raw / weekly_fc_bc : roster per week chosen on IFS forecasts at leads 1..7 (raw / LOSO bias-corrected),
                   real archived forecasts
    weekly_oracle  : perfect knowledge per week (upper bound)
    daily_oracle   : perfect knowledge per day (upper bound; shift start changes every day, not allowed in practice)
    daily_fc{1,3}_{raw,bc}: roster per day chosen on IFS lead-1 / lead-3 forecast; daily_persist: yesterday's observed best

Usage: python -I -X utf8 roster_ladder.py <hourly_wbgt.parquet> <out_dir>
"""

from __future__ import annotations

import itertools
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from numpy.typing import NDArray

F64 = NDArray[np.float64]
STATIONS = ["OMAA", "OMAD", "OMAL", "OMDB", "OMDW", "OMFJ", "OMSJ", "OMRK"]
HEADLINE = ["OMAA", "OMDB", "OMAL", "OMFJ"]
CLUSTER6 = ["OMAA", "OMDB", "OMDW", "OMAL", "OMFJ", "OMRK"]
YEARS = (2024, 2025, 2026)
THRS = (28.0, 30.0, 32.0)
N_DAYS = 139
NH = 36  # local hours 0..35 per work-day (day d 00:00 to day d+1 11:59)
TZ = 4
P_HOURS = 8.5


@dataclass(frozen=True)
class Roster:
    name: str
    blocks: tuple[tuple[float, float], ...]
    family: str

    @property
    def hours(self) -> float:
        return sum(b - a for a, b in self.blocks)


def clock(x: float) -> str:
    x = x % 24
    return f"{int(x):02d}:{int(round((x - int(x)) * 60)):02d}"


def describe(r: Roster) -> str:
    return " + ".join(f"{clock(a)}-{clock(b)}" for a, b in r.blocks)


def build_libraries() -> tuple[list[Roster], list[Roster], list[Roster]]:
    ban = (12.5, 15.0)
    day: list[Roster] = []
    eve: list[Roster] = []
    grid = lambda lo, hi: np.arange(lo, hi + 1e-9, 0.5)  # noqa: E731
    for s in grid(4.5, 8.0):
        for lm in grid(4.5, 8.0):
            if s + lm > ban[0] + 1e-9:
                continue
            le = P_HOURS - lm
            for e in grid(15.0, 20.5):
                end = e + le
                if end > 22.0 + 1e-9:
                    continue
                r = Roster(
                    f"s{s:.1f}_m{lm:.1f}_e{e:.1f}",
                    ((float(s), float(s + lm)), (float(e), float(end))),
                    "day" if end <= 19.5 + 1e-9 else "eve",
                )
                (day if r.family == "day" else eve).append(r)
    night = [Roster(f"night_{n:.1f}", ((float(n), float(n + P_HOURS)),), "night") for n in grid(19.0, 23.0)]
    return day, day + eve, day + eve + night


def named_rosters() -> list[Roster]:
    return [
        Roster("N1 baseline 06:00-12:30 + 15:00-17:00", ((6.0, 12.5), (15.0, 17.0)), "named"),
        Roster("N2 05:00-12:30", ((5.0, 12.5),), "named"),
        Roster("N3 04:30-11:30 + 16:30-18:30", ((4.5, 11.5), (16.5, 18.5)), "named"),
        Roster("N4 night 20:00-04:30", ((20.0, 28.5),), "named"),
        Roster("N5 07:00-12:30 + 15:00-18:00", ((7.0, 12.5), (15.0, 18.0)), "named"),
        Roster("N6 05:00-10:00 + 17:30-21:00", ((5.0, 10.0), (17.5, 21.0)), "named"),
    ]


def weights(rosters: list[Roster]) -> F64:
    w = np.zeros((len(rosters), NH))
    for i, r in enumerate(rosters):
        for a, b in r.blocks:
            for h in range(NH):
                lo, hi = h - 0.5, h + 0.5
                w[i, h] += max(0.0, min(b, hi) - max(a, lo))
    return w


def day_matrix(df: pd.DataFrame, col: str, year: int) -> F64:
    """[N_DAYS, NH] array of `col` on local day d and local hour 0..35 (hour >= 24 is the next calendar day)."""
    s = df.loc[df.year == year].set_index("time_utc")[col]
    s.index = s.index + pd.Timedelta(hours=TZ)
    start = pd.Timestamp(f"{year}-05-15 00:00")
    hours = (np.arange(N_DAYS)[:, None] * 24 + np.arange(NH)[None, :]).ravel()
    grid = start + pd.to_timedelta(hours, unit="h")
    return s.reindex(grid).to_numpy().reshape(N_DAYS, NH)


def exposure(wd: F64, wt: F64, thr: float) -> tuple[F64, NDArray[np.bool_]]:
    """Exposure [D,R] and validity [D,R] for hourly WBGT wd [D,NH] and roster weights wt [R,NH]."""
    nan = np.isnan(wd)
    hot = np.where(nan, 0.0, (wd >= thr).astype(float))
    e = hot @ wt.T
    valid = (nan.astype(float) @ (wt > 0).astype(float).T) == 0
    return e, valid


def months_of(year: int) -> NDArray[np.int64]:
    start = pd.Timestamp(f"{year}-05-15")
    return np.array([(start + pd.Timedelta(days=int(d))).month for d in range(N_DAYS)])


def argmin_sticky(score: F64, prev: int | None) -> int:
    """argmin of score; among ties (1e-9) keep prev if it is among them (avoids spurious switches)."""
    m = score.min()
    if prev is not None and score[prev] <= m + 1e-9:
        return prev
    return int(np.argmin(score))


class Station:
    def __init__(self, df: pd.DataFrame, st: str, rosters: list[Roster]) -> None:
        self.st = st
        self.rosters = rosters
        self.wt = weights(rosters)
        d = df[df.station == st]
        self.E: dict[float, F64] = {}  # thr -> [Y,D,R]
        self.valid = np.ones((len(YEARS), N_DAYS, len(rosters)), dtype=bool)
        for thr in THRS:
            arr = []
            for yi, y in enumerate(YEARS):
                e, v = exposure(day_matrix(d, "wbgt_obs", y), self.wt, thr)
                arr.append(e)
                self.valid[yi] &= v
            self.E[thr] = np.stack(arr)
        self.sev = sum(self.E[t] for t in THRS)
        # forecast severities [Y,D,R] for lead k raw / bc; invalid -> inf so they are never chosen on nan
        self.sev_fc: dict[tuple[str, int], F64] = {}
        self.fc_valid = np.ones((len(YEARS), N_DAYS), dtype=bool)
        for kind in ("L", "bc"):
            for k in range(1, 8):
                arr = []
                for _yi, y in enumerate(YEARS):
                    tot = 0.0
                    ok = np.ones((N_DAYS, len(rosters)), dtype=bool)
                    wd = day_matrix(d, f"wbgt_{kind}{k}", y)
                    for thr in THRS:
                        e, v = exposure(wd, self.wt, thr)
                        tot = tot + e
                        ok &= v
                    arr.append(np.where(ok, tot, np.inf))
                self.sev_fc[(kind, k)] = np.stack(arr)
        self.mon = np.stack([months_of(y) for y in YEARS])  # [Y,D]
        self.wk = np.tile(np.arange(N_DAYS) // 7, (len(YEARS), 1))  # [Y,D]
        self.dw = np.tile(np.arange(N_DAYS) % 7, (len(YEARS), 1))  # day-in-week [Y,D]
        # day mask: all rosters valid on obs (library-wide), common to all strategies
        self.dmask = self.valid.all(axis=2)  # [Y,D]

    # ---- helpers -------------------------------------------------------------------------------------------------------
    def sev_masked(self) -> F64:
        return np.where(self.dmask[:, :, None], np.nan_to_num(self.sev), 0.0)

    def score(self, choice: NDArray[np.int64]) -> dict[str, F64]:
        """choice [Y,D] roster index -> per-year exposures at each thr over valid days."""
        out: dict[str, F64] = {}
        yy, dd = np.meshgrid(np.arange(len(YEARS)), np.arange(N_DAYS), indexing="ij")
        for thr in THRS:
            e = np.where(self.dmask, np.nan_to_num(self.E[thr])[yy, dd, choice], 0.0)
            out[f"E{int(thr)}"] = e.sum(axis=1)
        out["n_days"] = self.dmask.sum(axis=1).astype(float)
        return out

    def group_choice(self, key: NDArray[np.int64], dec_sev: F64, mode: str) -> NDArray[np.int64]:
        """Pick one roster per (year, key-group) minimising the decision severity.
        mode 'oracle'/'fc': decision uses this year's own rows (dec_sev is obs for oracle, forecast for fc);
        mode 'loso': decision uses the other years' rows of the same key (dec_sev = obs)."""
        choice = np.zeros((len(YEARS), N_DAYS), dtype=np.int64)
        usable = np.where(self.dmask[:, :, None], dec_sev, 0.0)
        for yi in range(len(YEARS)):
            prev: int | None = None
            for g in np.unique(key[yi]):
                sel = key[yi] == g
                if mode == "loso":
                    tot = np.zeros(len(self.rosters))
                    for yo in range(len(YEARS)):
                        if yo == yi:
                            continue
                        tot += usable[yo][key[yo] == g].sum(axis=0)
                else:
                    tot = usable[yi][sel].sum(axis=0)
                prev = argmin_sticky(tot, prev)
                choice[yi, sel] = prev
        return choice


def forecast_dec(stn: Station, kind: str, lead_rule: str) -> F64:
    """[Y,D,R] decision severity from forecasts. lead_rule: 'weekly' (day j of the week uses lead j+1) or an int lead as str."""
    if lead_rule == "weekly":
        out = np.zeros_like(stn.sev)
        for k in range(1, 8):
            m = stn.dw == (k - 1)
            out = np.where(m[:, :, None], stn.sev_fc[(kind, k)], out)
        return out
    return stn.sev_fc[(kind, int(lead_rule))]


def run_ladder(stn: Station, base_idx: int) -> dict[str, NDArray[np.int64]]:
    nY = len(YEARS)
    shape = (nY, N_DAYS)
    ch: dict[str, NDArray[np.int64]] = {}
    ch["fixed_baseline"] = np.full(shape, base_idx, dtype=np.int64)
    one = np.zeros(shape, dtype=np.int64)
    ch["seasonal_oracle"] = stn.group_choice(one, stn.sev, "oracle")
    ch["seasonal_loso"] = stn.group_choice(one, stn.sev, "loso")
    ch["monthly_oracle"] = stn.group_choice(stn.mon, stn.sev, "oracle")
    ch["monthly_loso"] = stn.group_choice(stn.mon, stn.sev, "loso")
    ch["weekly_clim_loso"] = stn.group_choice(stn.wk, stn.sev, "loso")
    ch["weekly_oracle"] = stn.group_choice(stn.wk, stn.sev, "oracle")
    for kind, tag in (("L", "raw"), ("bc", "bc")):
        ch[f"weekly_fc_{tag}"] = stn.group_choice(stn.wk, forecast_dec(stn, kind, "weekly"), "oracle")
    # weekly persistence: best roster of previous observed week (first week: seasonal_loso choice)
    wp = np.zeros(shape, dtype=np.int64)
    usable = np.where(stn.dmask[:, :, None], stn.sev, 0.0)
    for yi in range(nY):
        prev_choice = None
        for g in range(int(stn.wk.max()) + 1):
            sel = stn.wk[yi] == g
            if g == 0:
                wp[yi, sel] = ch["seasonal_loso"][yi, sel][0]
            else:
                tot = usable[yi][stn.wk[yi] == g - 1].sum(axis=0)
                prev_choice = argmin_sticky(tot, prev_choice)
                wp[yi, sel] = prev_choice
    ch["weekly_persist"] = wp
    # daily
    dd = np.where(stn.dmask[:, :, None], stn.sev, np.inf)
    daily_or = np.zeros(shape, dtype=np.int64)
    for yi in range(nY):
        prev = None
        for d in range(N_DAYS):
            row = np.where(np.isfinite(dd[yi, d]), dd[yi, d], 1e9)
            prev = argmin_sticky(row, prev)
            daily_or[yi, d] = prev
    ch["daily_oracle"] = daily_or
    for kind, tag in (("L", "raw"), ("bc", "bc")):
        for k in (1, 3):
            s = stn.sev_fc[(kind, k)]
            c = np.zeros(shape, dtype=np.int64)
            for yi in range(nY):
                prev = None
                for d in range(N_DAYS):
                    row = np.where(np.isfinite(s[yi, d]), s[yi, d], 1e9)
                    prev = argmin_sticky(row, prev)
                    c[yi, d] = prev
            ch[f"daily_fc{k}_{tag}"] = c
    dp = np.zeros(shape, dtype=np.int64)
    for yi in range(nY):
        dp[yi, 0] = ch["seasonal_loso"][yi, 0]
        prev = None
        for d in range(1, N_DAYS):
            row = np.where(np.isfinite(dd[yi, d - 1]), dd[yi, d - 1], 1e9)
            prev = argmin_sticky(row, prev)
            dp[yi, d] = prev
    ch["daily_persist"] = dp
    return ch


def switches(choice: NDArray[np.int64], rosters: list[Roster], unit: str) -> dict[str, float]:
    """Mean per summer number of roster changes between consecutive decision units, and mean |change| of first-block start (min)."""
    n_changes, dstart = [], []
    for yi in range(choice.shape[0]):
        seq = choice[yi]
        if unit == "week":
            seq = np.array([choice[yi][g * 7] for g in range((N_DAYS + 6) // 7)])
        ch = np.nonzero(seq[1:] != seq[:-1])[0]
        n_changes.append(len(ch))
        for i in ch:
            a = rosters[int(seq[i])].blocks[0][0]
            b = rosters[int(seq[i + 1])].blocks[0][0]
            dstart.append(abs(a - b) * 60)
    return {"changes_per_summer": float(np.mean(n_changes)), "mean_abs_start_shift_min": float(np.mean(dstart)) if dstart else 0.0}


def frontier(stn: Station, base_idx: int) -> pd.DataFrame:
    """Exposure vs number of roster changes per summer (week granularity), exact DP.
    'oracle' chooses segments and rosters with hindsight on the evaluated summer;
    'clim' chooses them on the other two summers (mean) and applies."""
    nW = (N_DAYS + 6) // 7
    sw = {thr: np.zeros((len(YEARS), nW, len(stn.rosters))) for thr in THRS}
    swsev = np.zeros((len(YEARS), nW, len(stn.rosters)))
    for yi in range(len(YEARS)):
        for g in range(nW):
            sel = (stn.wk[yi] == g) & stn.dmask[yi]
            for thr in THRS:
                sw[thr][yi, g] = np.nan_to_num(stn.E[thr][yi][sel]).sum(axis=0)
            swsev[yi, g] = np.nan_to_num(stn.sev[yi][sel]).sum(axis=0)

    def dp(cost: F64, kmax: int) -> list[list[tuple[int, int, int]]]:
        """cost [W,R]. Returns for each k (changes) the segment list [(start, end, roster)]."""
        pref = np.vstack([np.zeros(cost.shape[1]), np.cumsum(cost, axis=0)])
        INF = 1e18
        f = np.full((kmax + 2, nW + 1), INF)
        arg = np.zeros((kmax + 2, nW + 1), dtype=np.int64)
        f[0, 0] = 0.0
        best_r = np.zeros((nW + 1, nW + 1), dtype=np.int64)
        seg_cost = np.full((nW + 1, nW + 1), INF)
        for i in range(nW):
            for j in range(i + 1, nW + 1):
                c = pref[j] - pref[i]
                best_r[i, j] = int(np.argmin(c))
                seg_cost[i, j] = c.min()
        for s in range(1, kmax + 2):
            for j in range(1, nW + 1):
                cand = f[s - 1, :j] + seg_cost[np.arange(j), j]
                i = int(np.argmin(cand))
                f[s, j] = cand[i]
                arg[s, j] = i
        out = []
        for k in range(kmax + 1):
            s = k + 1
            segs, j = [], nW
            ss = s
            while ss > 0 and j > 0:
                i = int(arg[ss, j])
                segs.append((i, j, int(best_r[i, j])))
                j, ss = i, ss - 1
            out.append(segs[::-1])
        return out

    rows = []
    kmax = nW - 1
    for yi, y in enumerate(YEARS):
        others = [yo for yo in range(len(YEARS)) if yo != yi]
        or_sets = dp(swsev[yi], kmax)
        cl_sets = dp(swsev[others].mean(axis=0), kmax)
        for k in range(kmax + 1):
            for mode, sets in (("oracle", or_sets), ("clim_loso", cl_sets)):
                segs = sets[k]
                tot = {thr: sum(sw[thr][yi, i:j, r].sum() for i, j, r in segs) for thr in THRS}
                rows.append(
                    {
                        "station": stn.st,
                        "year": y,
                        "changes": len(segs) - 1,
                        "k_allowed": k,
                        "mode": mode,
                        **{f"E{int(t)}": tot[t] for t in THRS},
                    }
                )
    fr = pd.DataFrame(rows)
    # baseline exposure for reference
    yy = np.arange(len(YEARS))
    base = {thr: np.array([sw[thr][yi][:, base_idx].sum() for yi in yy]) for thr in THRS}
    for yi, y in enumerate(YEARS):
        for thr in THRS:
            fr.loc[fr.year == y, f"base_E{int(thr)}"] = base[thr][yi]
    return fr


def main(parquet: str, out: str) -> None:
    out_dir = Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)
    df = pd.read_parquet(parquet)
    day_lib, eve_lib, all_lib = build_libraries()
    print(
        f"libraries: DAY {len(day_lib)}, EVE {len(eve_lib)}, ALL {len(all_lib)} rosters; check equal hours:",
        {round(r.hours, 3) for r in all_lib},
    )
    named = named_rosters()

    # ---- Table 1: named rosters ----------------------------------------------------------------------------------------
    rows = []
    wtn = weights(named)
    for st in STATIONS:
        d = df[df.station == st]
        for y in YEARS:
            es = {}
            valid = np.ones((N_DAYS, len(named)), dtype=bool)
            for thr in THRS:
                e, v = exposure(day_matrix(d, "wbgt_obs", y), wtn, thr)
                es[thr] = e
                valid &= v
            dm = valid.all(axis=1)
            for ri, r in enumerate(named):
                rec = {"station": st, "year": y, "roster": r.name, "sched_hours_per_day": r.hours, "days_used": int(dm.sum())}
                for thr in THRS:
                    tot = float(es[thr][dm, ri].sum())
                    rec[f"E{int(thr)}_h"] = tot
                    rec[f"share{int(thr)}_pct"] = 100 * tot / (r.hours * dm.sum())
                rows.append(rec)
    pd.DataFrame(rows).to_csv(out_dir / "named_rosters.csv", index=False)

    # ---- Ladders for the three libraries ------------------------------------------------------------------------------
    ladder_rows, stab_rows, fr_rows, choice_rows = [], [], [], []
    for lib_name, lib in (("DAY", day_lib), ("EVE", eve_lib), ("ALL", all_lib)):
        base_r = Roster("base", ((6.0, 12.5), (15.0, 17.0)), "day")
        if all(r.blocks != base_r.blocks for r in lib):
            raise RuntimeError("baseline not in library")
        base_idx = next(i for i, r in enumerate(lib) if r.blocks == base_r.blocks)
        for st in STATIONS:
            stn = Station(df, st, lib)
            ch = run_ladder(stn, base_idx)
            for strat, c in ch.items():
                sc = stn.score(c)
                for yi, y in enumerate(YEARS):
                    ladder_rows.append(
                        {"library": lib_name, "station": st, "year": y, "strategy": strat, **{k: float(v[yi]) for k, v in sc.items()}}
                    )
                if strat in ("monthly_oracle", "weekly_oracle", "weekly_clim_loso", "weekly_fc_raw", "weekly_fc_bc", "weekly_persist"):
                    unit = "week"
                elif strat.startswith("daily"):
                    unit = "day"
                else:
                    unit = "week"
                sw = switches(c, lib, unit)
                stab_rows.append({"library": lib_name, "station": st, "strategy": strat, **sw})
            # chosen rosters (seasonal / monthly LOSO + oracle) for the narrative
            for strat in ("seasonal_oracle", "seasonal_loso", "monthly_oracle", "monthly_loso"):
                for yi, y in enumerate(YEARS):
                    for m in sorted(set(stn.mon[yi])):
                        sel = stn.mon[yi] == m
                        choice_rows.append(
                            {
                                "library": lib_name,
                                "station": st,
                                "year": y,
                                "strategy": strat,
                                "month": int(m),
                                "roster": describe(lib[int(ch[strat][yi, sel][0])]),
                            }
                        )
            fr = frontier(stn, base_idx)
            fr.insert(0, "library", lib_name)
            fr_rows.append(fr)
            print(f"{lib_name} {st} done; valid days per summer {stn.dmask.sum(axis=1).tolist()}")
    pd.DataFrame(ladder_rows).to_csv(out_dir / "ladder.csv", index=False)
    pd.DataFrame(stab_rows).to_csv(out_dir / "switches.csv", index=False)
    pd.concat(fr_rows).to_csv(out_dir / "frontier.csv", index=False)
    pd.DataFrame(choice_rows).to_csv(out_dir / "chosen_rosters.csv", index=False)
    print("wrote CSVs to", out_dir)


if __name__ == "__main__":
    _ = itertools  # (kept for later extension)
    main(sys.argv[1], sys.argv[2])
