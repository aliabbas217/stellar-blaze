"""Sanity-check the archive pulls: row count, nulls, units, grid cell."""

import json
import sys
from pathlib import Path

for f in sorted(Path(sys.argv[1]).glob("*.json")):
    d = json.loads(f.read_text(encoding="utf-8"))
    h = d["hourly"]
    nn = {k: sum(v is None for v in h[k]) for k in h if k != "time"}
    print(
        f.name[8:-5],
        len(h["time"]),
        round(d["latitude"], 3),
        round(d["longitude"], 3),
        d.get("elevation"),
        d["hourly_units"]["shortwave_radiation"],
        d["hourly_units"]["surface_pressure"],
        nn,
        h["time"][0],
        h["time"][-1],
    )
