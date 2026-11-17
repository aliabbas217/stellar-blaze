"""Profile the heat-exposure rows of the OSHA Severe Injury Reports (SIR) file.

Source file: https://www.osha.gov/sites/default/files/January2015toNovember2025.zip (US Department of Labor). osha.gov answers
non-browser clients with HTTP 403, so the 2026-09-29 Wayback Machine copy of the same URL was used. Unzip it into its own directory first.
Heat rows are OIICS event codes 531x ("Exposure to environmental heat").
Usage: python -I -X utf8 osha_sir_heat_profile.py <path to January2015toNovember2025.csv>
"""

from __future__ import annotations

import sys

import pandas as pd


def main(csv_path: str) -> None:
    df = pd.read_csv(csv_path, encoding="latin-1", low_memory=False)
    heat = df[df["Event"].astype(str).str.startswith("531")].copy()
    heat["d"] = pd.to_datetime(heat["EventDate"], errors="coerce")
    heat["naics2"] = heat["Primary NAICS"].astype(str).str[:2]
    month = heat["d"].dt.month

    print("all rows", len(df), "| heat rows (Event 531x)", len(heat))
    print("event titles", heat["EventTitle"].str.strip().value_counts().to_dict())
    print("hospitalized >0:", int((heat["Hospitalized"] > 0).sum()), "| lat/lon present:", int(heat["Latitude"].notna().sum()))
    print("date range", heat["d"].min().date(), heat["d"].max().date(), "| distinct dates", heat["d"].nunique())
    print("by year", heat.groupby(heat["d"].dt.year).size().to_dict())
    print("share May-Sep", round(float(((month >= 5) & (month <= 9)).mean()), 3))
    print("top states", heat["State"].value_counts().head(8).to_dict())
    print("NAICS2 top", heat["naics2"].value_counts().head(6).to_dict())
    print("FederalState flag", heat["FederalState"].value_counts().to_dict())
    plan_states = ["ARIZONA", "CALIFORNIA", "NEVADA", "NEW MEXICO"]
    print("heat rows in desert state-plan states", {s: int((heat["State"] == s).sum()) for s in plan_states})
    per_state_day = heat.groupby(["State", "d"]).size()
    print("state-days with >=1 / >=2 / >=3 events:", len(per_state_day), int((per_state_day >= 2).sum()), int((per_state_day >= 3).sum()))
    texas = heat[heat["State"] == "TEXAS"]
    print("Texas events", len(texas), "| distinct days", texas["d"].nunique())


if __name__ == "__main__":
    main(sys.argv[1])
