"""Weather vocabulary shared by ingestion, dataset building and the model: NWP models, windows and QC policy."""

from collections.abc import Mapping
from datetime import UTC, datetime
from enum import StrEnum
from types import MappingProxyType
from typing import Final


class NwpModel(StrEnum):
    """Numerical weather prediction models; the values are the Open-Meteo ``models=`` names."""

    ECMWF_IFS025 = "ecmwf_ifs025"
    GFS_SEAMLESS = "gfs_seamless"
    ECMWF_AIFS025 = "ecmwf_aifs025_single"


# Summers for which the Previous Runs archive holds data for each model (data-availability study, archive probe).
MODEL_SUMMERS: Final[Mapping[NwpModel, frozenset[int]]] = MappingProxyType(
    {
        NwpModel.ECMWF_IFS025: frozenset({2024, 2025, 2026}),
        NwpModel.GFS_SEAMLESS: frozenset({2024, 2025, 2026}),
        NwpModel.ECMWF_AIFS025: frozenset({2025, 2026}),
    }
)

# Forecast leads in days before the valid time: 0 is the same-day run, 1 to 7 are the previous runs.
LEADS_DAYS: Final = range(0, 8)


class QcPolicy(StrEnum):
    """How a source's per-value quality-control codes are read when binning observations."""

    NONE = "none"
    """The source has no QC codes (IEM METAR); every plausible value is kept."""

    GHCNH_LENIENT = "ghcnh_lenient"
    """GHCNh: keep a value whose code is ``"1"`` (passed) or missing (NOAA has not QC'd it yet); drop any other."""


def summer_window(year: int) -> tuple[datetime, datetime]:
    """Return the first and last hourly bin of the summer: 15 May 00:00 UTC to 30 Sep 23:00 UTC, both inclusive.

    That is 139 days, or 3,336 hourly bins.
    """
    return datetime(year, 5, 15, 0, tzinfo=UTC), datetime(year, 9, 30, 23, tzinfo=UTC)


def is_working_daytime(hour_utc: int) -> bool:
    """Whether a UTC hour of day falls in the working daytime, 06:00 to 14:59 UTC (10:00 to 18:59 GST)."""
    return 6 <= hour_utc <= 14
