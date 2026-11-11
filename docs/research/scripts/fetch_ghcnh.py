"""Download NOAA GHCNh by-year parquet files for every UAE station and summer year.

Source: https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/access/by-year/<Y>/parquet/GHCNh_<ID>_<Y>.parquet
Station list: https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/doc/ghcnh-station-list.txt
(Parquet is ~12x smaller than the PSV for the same station-year; the PSV downloads timed out at NCEI's
~35 kB/s per-connection throttle.) TLS verification is left at the requests default (on).
Usage: python -I fetch_ghcnh.py <out_dir>
"""

from __future__ import annotations

import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

BASE = "https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/access/by-year"
STATIONS = {
    "AEI0000OMAA": "Abu Dhabi Intl (OMAA)",
    "AEI0000OMAB": "Buhasa (OMAB)",
    "AEI0000OMAD": "Al Bateen (OMAD)",
    "AEI0000OMAH": "Al Hamra Aux (OMAH)",
    "AEI0000OMAJ": "Jebel Dhanna (OMAJ)",
    "AEI0000OMAL": "Al Ain Intl (OMAL)",
    "AEI0000OMAM": "Al Dhafra (OMAM)",
    "AEI0000OMAS": "Das Island (OMAS)",
    "AEI0000OMAW": "Sweihan (OMAW)",
    "AEI0000OMAZ": "Zirku (OMAZ)",
    "AEI0000OMDB": "Dubai Intl (OMDB)",
    "AEI0000OMDL": "Delma (OMDL)",
    "AEI0000OMDM": "Dubai Minhad AB (OMDM)",
    "AEI0000OMDW": "Al Maktoum Intl (OMDW)",
    "AEI0000OMFJ": "Fujairah Intl (OMFJ)",
    "AEI0000OMLW": "Liwa AB (OMLW)",
    "AEI0000OMQS": "Qusaiwera AB (OMQS)",
    "AEI0000OMSJ": "Sharjah Intl (OMSJ)",
    "AEI0000OMSN": "Sir Abu Nair (OMSN)",
    "AEM00040449": "Ash Shariqah SW (40449)",
    "AEM00041226": "Medina Zayed (41226)",
    "AEU041184-1": "Ras Al Khaimah (41184)",
    "AEU041244-1": "Buraimi (41244)",
}
YEARS = [2024, 2025, 2026]


def fetch_one(out: Path, sid: str, year: int) -> None:
    dest = out / f"GHCNh_{sid}_{year}.parquet"
    if dest.exists() and dest.stat().st_size > 0:
        return
    session = requests.Session()
    session.headers["User-Agent"] = "research-data-availability-check/1.0"
    url = f"{BASE}/{year}/parquet/GHCNh_{sid}_{year}.parquet"
    resp = None
    for _attempt in range(3):
        try:
            resp = session.get(url, timeout=180)
            break
        except requests.RequestException as exc:
            print(f"  retry {sid} {year}: {type(exc).__name__}")
            time.sleep(3)
    if resp is None:
        print(f"FAIL {sid} {year}")
        return
    if resp.status_code == 200:
        dest.write_bytes(resp.content)
        print(f"OK   {sid} {year} {len(resp.content)} bytes")
    else:
        print(f"{resp.status_code}  {sid} {year}")


def main(out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    jobs = [(out, sid, y) for sid in STATIONS for y in YEARS]
    with ThreadPoolExecutor(max_workers=4) as ex:
        list(ex.map(lambda a: fetch_one(*a), jobs))


if __name__ == "__main__":
    main(sys.argv[1])
