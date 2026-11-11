"""Measure per-field byte sizes in ECMWF open-data GRIB files via the .index sidecar (AWS replica).
Shows what a byte-range subset of 2t/2d/10u/10v/ssrd/sp would cost per forecast step.
Usage: python -I probe_ecmwf_index_sizes.py
"""

from __future__ import annotations

import json
import time

import requests

B = "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com/"
S = requests.Session()
WANT = {"2t", "2d", "10u", "10v", "ssrd", "sp", "msl", "fdir"}
for key in (
    "20240715/00z/ifs/0p25/oper/20240715000000-24h-oper-fc",
    "20250715/00z/ifs/0p25/oper/20250715000000-24h-oper-fc",
    "20260715/00z/ifs/0p25/oper/20260715000000-24h-oper-fc",
    "20250715/00z/aifs-single/0p25/oper/20250715000000-24h-oper-fc",
):
    txt = None
    for attempt in range(5):
        try:
            r = S.get(B + key + ".index", timeout=60)
            r.raise_for_status()
            txt = r.text
            break
        except requests.RequestException:
            time.sleep(4 * (attempt + 1))
    if txt is None:
        print(key, "FAILED")
        continue
    recs = [json.loads(line) for line in txt.splitlines() if line.strip()]
    tot = sum(x["_length"] for x in recs)
    sel = {}
    for x in recs:
        if x["param"] in WANT and x.get("levtype", "sfc") == "sfc":
            sel[x["param"]] = x["_length"]
    print(key, "n_fields", len(recs), "total_bytes", tot, "selected", sel, "selected_sum", sum(sel.values()))
