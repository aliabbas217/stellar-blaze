"""What does GHCNh QC reject that IEM keeps? Lists hours where GHCNh (non-null, QC flagged) vs IEM valid, per variable.
Usage: python -I check_qc_rejections.py <ghcnh_pq_dir> <iem_hourly_dir>
"""

import sys
from pathlib import Path

import pandas as pd

gdir, idir = Path(sys.argv[1]), Path(sys.argv[2])
for st, gid in (("OMAA", "AEI0000OMAA"), ("OMDB", "AEI0000OMDB"), ("OMFJ", "AEI0000OMFJ")):
    for y in (2024, 2025):
        g = pd.read_parquet(gdir / f"GHCNh_{gid}_{y}.parquet")
        g["ts"] = pd.to_datetime(g["DATE"])
        w = g[(g.ts >= f"{y}-05-15") & (g.ts < f"{y}-10-01")]
        for var, qc in (
            ("temperature", "temperature_Quality_Code"),
            ("dew_point_temperature", "dew_point_temperature_Quality_Code"),
            ("wind_speed", "wind_speed_Quality_Code"),
        ):
            flagged = w[w[var].notna() & w[qc].notna() & (w[qc] != "1")]
            missing_qc = w[w[var].notna() & w[qc].isna()]
            print(
                st,
                y,
                var,
                "non-null rows",
                int(w[var].notna().sum()),
                "| QC!=1 rows",
                len(flagged),
                flagged[qc].value_counts().to_dict(),
                "| value-present-but-QC-blank rows",
                len(missing_qc),
                "| flagged value range",
                (round(flagged[var].min(), 1), round(flagged[var].max(), 1)) if len(flagged) else None,
            )
        # hours present in IEM but missing in GHCNh-lenient: why?
