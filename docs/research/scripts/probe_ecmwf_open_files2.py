"""Second-level structure for the 2025/2026 ECMWF open-data replica folders. Usage: python -I probe_ecmwf_open_files2.py"""

from __future__ import annotations

import re
import time

import requests

B = "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com/"
S = requests.Session()


def sub(prefix: str) -> list[str]:
    for attempt in range(6):
        try:
            r = S.get(B, params={"list-type": "2", "prefix": prefix, "delimiter": "/", "max-keys": "1000"}, timeout=60)
            r.raise_for_status()
            return re.findall(r"<CommonPrefixes><Prefix>([^<]+)</Prefix>", r.text)
        except requests.RequestException:
            time.sleep(5 * (attempt + 1))
    return []


def files(prefix: str) -> list[tuple[str, int]]:
    for attempt in range(6):
        try:
            r = S.get(B, params={"list-type": "2", "prefix": prefix, "max-keys": "1000"}, timeout=60)
            r.raise_for_status()
            return [(k, int(sz)) for k, sz in re.findall(r"<Contents><Key>([^<]+)</Key>.*?<Size>(\d+)</Size>", r.text, flags=re.S)]
        except requests.RequestException:
            time.sleep(5 * (attempt + 1))
    return []


for base in ("20250715/00z/ifs/0p25/", "20250715/00z/aifs-single/0p25/", "20260715/00z/ifs/0p25/", "20260715/00z/aifs-single/0p25/"):
    s1 = sub(base)
    print(base, "->", s1)
    for p in s1:
        f = files(p)
        grib = [(k, s) for k, s in f if k.endswith(".grib2")]
        steps = sorted({int(m.group(1)) for k, _ in f if (m := re.search(r"-(\d+)h-", k))})
        print(
            "   ", p, "files", len(f), "grib2", len(grib), "steps n", len(steps), steps[:2], steps[-2:], "sample", grib[0] if grib else None
        )
