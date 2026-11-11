"""Probe the ECMWF open-data replica on AWS (public bucket ecmwf-forecasts, eu-central-1).

Measures: date range of top-level date prefixes, and for sampled dates which run/stream/resolution
prefixes exist (ifs 0p25 oper, aifs-single, etc.). Anonymous S3 REST listing; TLS verified.
Usage: python -I probe_ecmwf_open_aws.py <out_json>
"""

from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

import requests

BUCKET = "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com/"
S = requests.Session()


def get(params: dict) -> requests.Response:
    last: Exception | None = None
    for attempt in range(6):
        try:
            r = S.get(BUCKET, params=params, timeout=60)
            r.raise_for_status()
            return r
        except requests.RequestException as exc:  # transient resets seen on this network
            last = exc
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"giving up: {type(last).__name__}")


def list_prefixes(prefix: str) -> list[str]:
    out: list[str] = []
    token = None
    while True:
        p = {"list-type": "2", "delimiter": "/", "prefix": prefix, "max-keys": "1000"}
        if token:
            p["continuation-token"] = token
        r = get(p)
        out += (
            re.findall(r"<Prefix>([^<]+)</Prefix>", r.text)[1:]
            if prefix == ""
            else re.findall(r"<CommonPrefixes><Prefix>([^<]+)</Prefix>", r.text)
        )
        m = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", r.text)
        if not m:
            return out
        token = m.group(1)


def main(out_json: str) -> None:
    dates = sorted(x.strip("/") for x in list_prefixes("") if re.fullmatch(r"\d{8}/", x))
    res: dict = {"n_dates": len(dates), "first": dates[0], "last": dates[-1]}
    # dates present within each summer window
    for y in (2023, 2024, 2025, 2026):
        win = [d for d in dates if f"{y}0515" <= d <= f"{y}0930"]
        res[f"summer_{y}_dates_present"] = len(win)
        res[f"summer_{y}_dates_expected"] = 139
    # gaps
    import datetime as dt

    d0, d1 = (
        dt.date.fromisoformat(f"{dates[0][:4]}-{dates[0][4:6]}-{dates[0][6:]}"),
        dt.date.fromisoformat(f"{dates[-1][:4]}-{dates[-1][4:6]}-{dates[-1][6:]}"),
    )
    have = set(dates)
    missing = []
    d = d0
    while d <= d1:
        k = d.strftime("%Y%m%d")
        if k not in have:
            missing.append(k)
        d += dt.timedelta(days=1)
    res["n_missing_dates_in_span"] = len(missing)
    res["missing_dates_sample"] = missing[:20]
    # structure for sampled dates
    samples = {}
    for d in ("20230118", "20230715", "20240201", "20240715", "20250101", "20250715", "20260715", dates[-1]):
        if d not in have:
            samples[d] = "date prefix absent"
            continue
        runs = list_prefixes(f"{d}/")
        entry = {"runs": runs}
        for r in runs[:1]:
            streams = list_prefixes(r)
            entry["streams_" + r] = streams
            for st in streams:
                entry[st] = list_prefixes(st)
        samples[d] = entry
    res["samples"] = samples
    Path(out_json).write_text(json.dumps(res, indent=1))
    print(json.dumps({k: v for k, v in res.items() if k != "samples"}, indent=1))
    print(json.dumps(samples, indent=1)[:6000])


if __name__ == "__main__":
    main(sys.argv[1])
