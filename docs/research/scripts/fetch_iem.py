"""Download Iowa Environmental Mesonet ASOS/METAR archive for UAE (network AE__ASOS), summers 2024-2026.

Endpoint docs: https://mesonet.agron.iastate.edu/request/download.phtml
Usage: python -I fetch_iem.py <out_dir>
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import requests

NET = "https://mesonet.agron.iastate.edu/geojson/network/AE__ASOS.geojson"
CGI = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"
DATA = ["tmpf", "dwpf", "relh", "drct", "sknt", "gust", "alti", "mslp", "vsby", "skyc1", "wxcodes", "metar"]
SUMMERS = {2024: ("2024-05-15", "2024-10-01"), 2025: ("2025-05-15", "2025-10-01"), 2026: ("2026-05-15", "2026-10-01")}


def main(out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    s = requests.Session()
    s.headers["User-Agent"] = "research-data-availability-check/1.0"
    net = s.get(NET, timeout=60).json()
    meta = {f["id"]: f["properties"] for f in net["features"]}
    (out / "network_meta.json").write_text(json.dumps(meta, indent=1))
    for sid in meta:
        for y, (a, b) in SUMMERS.items():
            dest = out / f"{sid}_{y}.csv"
            if dest.exists():
                continue
            y1, m1, d1 = a.split("-")
            y2, m2, d2 = b.split("-")
            params = [
                ("station", sid),
                ("year1", y1),
                ("month1", int(m1)),
                ("day1", int(d1)),
                ("year2", y2),
                ("month2", int(m2)),
                ("day2", int(d2)),
                ("tz", "Etc/UTC"),
                ("format", "onlycomma"),
                ("latlon", "no"),
                ("elev", "no"),
                ("missing", "empty"),
                ("trace", "T"),
                ("direct", "no"),
                ("report_type", 3),
                ("report_type", 4),
            ] + [("data", d) for d in DATA]
            r = None
            for attempt in range(5):
                try:
                    r = s.get(CGI, params=params, timeout=180)
                    break
                except requests.RequestException as exc:
                    print(f"  retry {sid} {y}: {type(exc).__name__}")
                    time.sleep(10 * (attempt + 1))
            if r is None:
                print(f"FAIL {sid} {y}")
                continue
            if r.status_code == 200:
                dest.write_bytes(r.content)
                print(f"OK {sid} {y} {len(r.content)} bytes, {r.content.count(b'\n')} lines")
            else:
                print(f"{r.status_code} {sid} {y}")
            time.sleep(2)


if __name__ == "__main__":
    main(sys.argv[1])
