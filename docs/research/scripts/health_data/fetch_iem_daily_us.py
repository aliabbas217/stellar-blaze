"""Download IEM daily weather summaries (max temperature, max apparent temperature) for nine US airport stations, 2015-2025.

IEM data are public domain (see docs/research/2026-11-11-data-availability.md section 4). IEM resets connections intermittently, so each
station is retried and cached.
Usage: python -I -X utf8 fetch_iem_daily_us.py <out_dir>
"""

from __future__ import annotations

import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

STATIONS = [
    ("TX_ASOS", "HOU"),
    ("TX_ASOS", "DAL"),
    ("TX_ASOS", "SAT"),
    ("TX_ASOS", "AUS"),
    ("FL_ASOS", "MCO"),
    ("FL_ASOS", "JAX"),
    ("FL_ASOS", "TPA"),
    ("GA_ASOS", "ATL"),
    ("MO_ASOS", "MCI"),
]
CGI = "https://mesonet.agron.iastate.edu/cgi-bin/request/daily.py"


def main(out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for network, station in STATIONS:
        target = out / f"{station}.csv"
        if target.exists() and target.stat().st_size > 100_000:
            print(station, "cached")
            continue
        query = urllib.parse.urlencode(
            {
                "network": network,
                "stations": station,
                "year1": 2015,
                "month1": 1,
                "day1": 1,
                "year2": 2025,
                "month2": 11,
                "day2": 30,
                "format": "csv",
            }
        )
        for attempt in range(5):
            try:
                data = urllib.request.urlopen(f"{CGI}?{query}", timeout=120).read()  # noqa: S310 (fixed https URL)
                target.write_bytes(data)
                print(station, len(data))
                break
            except OSError as exc:
                print(station, "retry", attempt, type(exc).__name__)
                time.sleep(4)


if __name__ == "__main__":
    main(sys.argv[1])
