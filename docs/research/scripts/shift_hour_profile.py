"""Hour-of-day heat profile for the shift-planner research note (2026-11-11).

Question: how hot is it, hour by hour, during the legal midday-break season (15 Jun-15 Sep), and in
particular (a) at the early-start hours 04:00-07:00 and (b) overnight, when workers are trying to sleep?

Data: Iowa Environmental Mesonet METAR archive (same source as fetch_iem.py), local time Asia/Dubai.
Stations: OMAA (Abu Dhabi Intl, inland-coastal), OMDB (Dubai Intl), OMAL (Al Ain, inland). Summers 2024-2026.

Derived quantities (all computed here, none measured):
  Tw      Stull (2011) wet-bulb from T and RH (valid RH 5-99 %, T -20..50 C).
  WBGT0   no-solar-load WBGT = 0.7*Tw + 0.3*T. This is the ISO 7243 outdoor formula with the globe
          temperature set equal to air temperature, so it is valid ONLY when the sun is down. It is a
          lower bound for any hour with sun. It is NOT the project's Liljegren WBGT (ADR 0006).
  Hours with the sun up are therefore not given a WBGT here; only T, Td and Tw.

Usage: python -I shift_hour_profile.py <out_dir>   (writes <out_dir>/shift_hour_profile.csv and prints a summary)
"""

from __future__ import annotations

import csv
import io
import math
import statistics
import sys
import time
from collections import defaultdict
from datetime import date as date_cls
from datetime import timedelta
from pathlib import Path

import requests

CGI = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"
STATIONS = ("OMAA", "OMDB", "OMAL")
YEARS = (2024, 2025, 2026)
# Legal midday-break season (MoHRE): 15 June to 15 September inclusive.
START = (6, 15)
END = (9, 16)  # exclusive end date for the IEM query


def fetch(station: str, year: int) -> list[dict[str, str]]:
    params = [
        ("station", station),
        ("data", "tmpf"),
        ("data", "relh"),
        ("year1", year),
        ("month1", START[0]),
        ("day1", START[1]),
        ("year2", year),
        ("month2", END[0]),
        ("day2", END[1]),
        ("tz", "Asia/Dubai"),
        ("format", "onlycomma"),
        ("latlon", "no"),
        ("missing", "empty"),
        ("trace", "empty"),
        ("direct", "no"),
        ("report_type", "3"),
    ]
    last: Exception | None = None
    for attempt in range(
        1, 6
    ):  # IEM resets idle connections now and then; retry with backoff
        try:
            resp = requests.get(
                CGI,
                params=params,
                headers={"User-Agent": "research-shift-planner/1.0"},
                timeout=120,
            )
            resp.raise_for_status()
            return list(csv.DictReader(io.StringIO(resp.text)))
        except requests.RequestException as exc:
            last = exc
            time.sleep(2.0 * attempt)
    raise RuntimeError(f"IEM fetch failed for {station} {year}: {last!r}")


def stull_tw(t_c: float, rh: float) -> float:
    return (
        t_c * math.atan(0.151977 * (rh + 8.313659) ** 0.5)
        + math.atan(t_c + rh)
        - math.atan(rh - 1.676331)
        + 0.00391838 * rh**1.5 * math.atan(0.023101 * rh)
        - 4.686035
    )


def dewpoint(t_c: float, rh: float) -> float:
    a, b = 17.625, 243.04  # Alduchov-Eskridge / Magnus
    g = math.log(rh / 100.0) + a * t_c / (b + t_c)
    return b * g / (a - g)


def pct(xs: list[float], q: float) -> float:
    s = sorted(xs)
    k = (len(s) - 1) * q
    lo, hi = math.floor(k), math.ceil(k)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def main(out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    # (station, hour) -> lists
    t_by: dict[tuple[str, int], list[float]] = defaultdict(list)
    tw_by: dict[tuple[str, int], list[float]] = defaultdict(list)
    td_by: dict[tuple[str, int], list[float]] = defaultdict(list)
    w0_by: dict[tuple[str, int], list[float]] = defaultdict(list)
    # per (station, night-date) min temperature during 22:00-05:59 and mean 22-05
    night: dict[tuple[str, str], list[float]] = defaultdict(list)
    daily: dict[tuple[str, str], dict[int, float]] = defaultdict(
        dict
    )  # (station, date) -> hour -> T
    n_rows = 0
    for st in STATIONS:
        for yr in YEARS:
            for row in fetch(st, yr):
                if not row["tmpf"] or not row["relh"]:
                    continue
                try:
                    t = (float(row["tmpf"]) - 32.0) * 5.0 / 9.0
                    rh = float(row["relh"])
                except ValueError:
                    continue
                if not (5.0 <= rh <= 99.0 and -20.0 <= t <= 50.0):
                    continue
                stamp = row["valid"]  # 'YYYY-MM-DD HH:MM' local
                date, hhmm = stamp.split(" ")
                hh = int(hhmm[:2])
                # keep only the observation closest to the hour: minute <= 15 or >= 45 (routine METAR at :00/:30/:50)
                mm = int(hhmm[3:5])
                if not (mm >= 45 or mm <= 14):
                    continue
                hour = (hh + 1) % 24 if mm >= 45 else hh
                n_rows += 1
                tw = stull_tw(t, rh)
                t_by[(st, hour)].append(t)
                if hh == hour:
                    daily[(st, date)][hour] = t
                tw_by[(st, hour)].append(tw)
                td_by[(st, hour)].append(dewpoint(t, rh))
                if hour >= 20 or hour <= 4:
                    w0_by[(st, hour)].append(0.7 * tw + 0.3 * t)
                if hour >= 22 or hour <= 5:
                    # assign hours 00-05 to the previous evening so a night is one unit
                    key_date = date
                    if hour <= 5:
                        key_date = (
                            date_cls.fromisoformat(date) - timedelta(days=1)
                        ).isoformat()
                    night[(st, key_date)].append(t)
    rows = []
    for st in STATIONS:
        for h in range(24):
            ts = t_by[(st, h)]
            if not ts:
                continue
            w0 = w0_by.get((st, h), [])
            rows.append(
                {
                    "station": st,
                    "local_hour": h,
                    "n": len(ts),
                    "T_mean": round(statistics.fmean(ts), 1),
                    "T_p90": round(pct(ts, 0.9), 1),
                    "Td_mean": round(statistics.fmean(td_by[(st, h)]), 1),
                    "Tw_mean": round(statistics.fmean(tw_by[(st, h)]), 1),
                    "Tw_p90": round(pct(tw_by[(st, h)], 0.9), 1),
                    "WBGT0_mean_sun_down_only": round(statistics.fmean(w0), 1)
                    if w0
                    else "",
                    "WBGT0_p90_sun_down_only": round(pct(w0, 0.9), 1) if w0 else "",
                }
            )
    with (out / "shift_hour_profile.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    print(f"rows used: {n_rows}")
    for st in STATIONS:
        print(
            f"\n== {st}: hour  T_mean T_p90 Td_mean Tw_mean | WBGT0 mean/p90 (sun-down hours)"
        )
        for r in rows:
            if r["station"] == st and r["local_hour"] in (
                0,
                2,
                3,
                4,
                5,
                6,
                7,
                8,
                9,
                10,
                11,
                12,
                15,
                16,
                17,
                18,
                19,
                20,
                22,
            ):
                print(
                    f"  {r['local_hour']:02d}  {r['T_mean']:5.1f} {r['T_p90']:5.1f} {r['Td_mean']:5.1f} {r['Tw_mean']:5.1f} | "
                    f"{r['WBGT0_mean_sun_down_only']!s:>5} {r['WBGT0_p90_sun_down_only']!s:>5}"
                )
        nights = [v for (s, _d), v in night.items() if s == st and len(v) >= 6]
        mins = [min(v) for v in nights]
        means = [statistics.fmean(v) for v in nights]
        print(
            f"  nights n={len(nights)}  overnight(22-05) mean T: median {statistics.median(means):.1f} C; "
            f"share of nights with mean>=30: {sum(m >= 30 for m in means) / len(means):.0%}, "
            f">=25: {sum(m >= 25 for m in means) / len(means):.0%}; "
            f"night minimum T median {statistics.median(mins):.1f} C, share of nights min>=30: "
            f"{sum(m >= 30 for m in mins) / len(mins):.0%}, min>=25: {sum(m >= 25 for m in mins) / len(mins):.0%}"
        )
    print()
    print(
        "== Day-to-day stability of the diurnal heat ramp (justifies a fixed roster?)"
    )
    stability(daily)


def stability(daily: dict[tuple[str, str], dict[int, float]]) -> None:
    """How much does the day-specific timing of the heat ramp move around a fixed diurnal profile?

    For each station: day-to-day SD of T at each hour (after removing the hour mean) versus the mean ramp
    in degC per hour between 08:00 and 11:00. Their ratio is "how many hours of ramp a typical day's
    anomaly is worth". Also: first hour of the day (07-16 local) with T >= 38 C, its median and spread.
    """
    for st in STATIONS:
        days = {
            d: v
            for (s_, d), v in daily.items()
            if s_ == st and all(h in v for h in range(6, 20))
        }
        hour_mean = {
            h: statistics.fmean(v[h] for v in days.values()) for h in range(6, 20)
        }
        sd = {
            h: statistics.pstdev([v[h] - hour_mean[h] for v in days.values()])
            for h in range(6, 20)
        }
        ramp = (hour_mean[11] - hour_mean[8]) / 3.0
        first38 = []
        for v in days.values():
            hit = next((h for h in range(7, 17) if v[h] >= 38.0), None)
            first38.append(hit)
        hits = [h for h in first38 if h is not None]
        med = statistics.median(hits) if hits else float("nan")
        within1 = (
            sum(abs(h - med) <= 1 for h in hits) / len(hits) if hits else float("nan")
        )
        print(
            f"  {st}: days n={len(days)}; mean ramp 08->11 = {ramp:.2f} C/h; day-to-day SD of T: "
            f"{statistics.fmean(sd[h] for h in (8, 9, 10, 11)):.2f} C (08-11h), {sd[6]:.2f} C (06h), "
            f"{statistics.fmean(sd[h] for h in (15, 16, 17)):.2f} C (15-17h) -> anomaly = {statistics.fmean(sd[h] for h in (8, 9, 10, 11)) / ramp:.1f} h of ramp; "
            f"first hour T>=38C: median {med:.0f}h, {within1:.0%} of {len(hits)} days within +/-1 h; "
            f"{(len(first38) - len(hits))} days never reach 38C by 16h"
        )


if __name__ == "__main__":
    main(sys.argv[1])
