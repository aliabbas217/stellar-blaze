"""Verify byte-range GETs of single GRIB2 fields work against the ECMWF open-data AWS replica (summer 2024/2025/2026).
Reads the .index sidecar, requests only the 2t message, checks HTTP 206 + 'GRIB' magic + length.
Usage: python -I probe_ecmwf_range_get.py
"""

from __future__ import annotations

import json
import time

import requests

B = "https://ecmwf-forecasts.s3.amazonaws.com/"  # regional vhost endpoint reset connections intermittently on the test network
S = requests.Session()


def get(url: str, headers: dict | None = None) -> requests.Response:
    for attempt in range(5):
        try:
            return S.get(url, headers=headers, timeout=90)
        except requests.RequestException:
            time.sleep(4 * (attempt + 1))
    raise RuntimeError("network failure")


for key in (
    "20240715/00z/ifs/0p25/oper/20240715000000-24h-oper-fc",
    "20250715/00z/ifs/0p25/oper/20250715000000-24h-oper-fc",
    "20260715/00z/ifs/0p25/oper/20260715000000-24h-oper-fc",
    "20250715/00z/aifs-single/0p25/oper/20250715000000-24h-oper-fc",
    "20260715/00z/aifs-single/0p25/oper/20260715000000-24h-oper-fc",
):
    idx = [json.loads(x) for x in get(B + key + ".index").text.splitlines() if x.strip()]
    rec = next(x for x in idx if x["param"] == "2t")
    start, length = rec["_offset"], rec["_length"]
    r = get(B + key + ".grib2", {"Range": f"bytes={start}-{start + length - 1}"})
    print(
        key.split("/", 1)[0],
        key.split("/")[2],
        "HTTP",
        r.status_code,
        "bytes",
        len(r.content),
        "magic",
        r.content[:4],
        "expected_len",
        length,
    )
