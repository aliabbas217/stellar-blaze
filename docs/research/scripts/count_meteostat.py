"""Count valid hourly values per summer in Meteostat legacy bulk files (bulk.meteostat.net/v2/hourly/<WMO>.csv.gz).
Columns (headerless): date,hour,temp,dwpt,rhum,prcp,snow,wdir,wspd,wpgt,pres,tsun,coco  (times UTC; wspd km/h; pres hPa MSL).
Usage: python -I count_meteostat.py <dir>
"""

import sys
from pathlib import Path

import pandas as pd

NAMES = {"41217": "OMAA", "41216": "OMAD", "41218": "OMAL", "41194": "OMDB", "41196": "OMSJ", "41198": "OMFJ", "41184": "OMRK"}
cols = ["date", "hour", "temp", "dwpt", "rhum", "prcp", "snow", "wdir", "wspd", "wpgt", "pres", "tsun", "coco"]
for f in sorted(Path(sys.argv[1]).glob("*.csv.gz")):
    df = pd.read_csv(f, names=cols, compression="gzip")
    df["ts"] = pd.to_datetime(df["date"]) + pd.to_timedelta(df["hour"], unit="h")
    last = df["ts"].max()
    out = []
    for y in (2024, 2025, 2026):
        w = df[(df.ts >= f"{y}-05-15") & (df.ts < f"{y}-10-01")]
        core = w.temp.notna() & w.dwpt.notna() & w.wspd.notna()
        out.append(
            f"{y}: rows {len(w)} T {int(w.temp.notna().sum())} Td {int(w.dwpt.notna().sum())} "
            f"ws {int(w.wspd.notna().sum())} core {int(core.sum())} pres {int(w.pres.notna().sum())}"
        )
    print(NAMES.get(f.name.split(".")[0], f.name), "last row", last, "|", " | ".join(out))
