"""List actual files in the ECMWF open-data AWS replica for sample dates (checks real file presence/size).
Usage: python -I probe_ecmwf_open_files.py
"""

from __future__ import annotations

import re
import time

import requests

B = "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com/"
S = requests.Session()


def ls(prefix: str) -> list[tuple[str, int]]:
    for attempt in range(6):
        try:
            r = S.get(B, params={"list-type": "2", "prefix": prefix, "max-keys": "1000"}, timeout=60)
            r.raise_for_status()
            return [(k, int(sz)) for k, sz in re.findall(r"<Contents><Key>([^<]+)</Key>.*?<Size>(\d+)</Size>", r.text, flags=re.S)]
        except requests.RequestException:
            time.sleep(5 * (attempt + 1))
    return []


for pref in (
    "20240715/00z/ifs/0p25/oper/",
    "20250715/00z/ifs/0p25/oper/",
    "20260715/00z/ifs/0p25/oper/",
    "20240715/00z/aifs/0p25/oper/",
    "20250715/00z/aifs-single/0p25/oper/",
    "20260715/00z/aifs-single/0p25/oper/",
):
    files = ls(pref)
    steps = sorted({int(m.group(1)) for k, _ in files if (m := re.search(r"-(\d+)h-", k))})
    grib = [(k, s) for k, s in files if k.endswith(".grib2")]
    idx = [k for k, _ in files if k.endswith(".index")]
    print(
        pref,
        "files",
        len(files),
        "grib2",
        len(grib),
        "index",
        len(idx),
        "steps",
        (steps[:3], steps[-3:], len(steps)),
        "sample",
        grib[0] if grib else None,
    )
