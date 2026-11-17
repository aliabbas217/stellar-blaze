"""Hourly binning of raw observations: the rules of the data-availability study, made a tested function.

The rules reproduce ``docs/research/scripts/analyze_obs.py`` (``to_hourly``), whose per-variable counts ADR 0005
relies on. They are applied per station and per variable independently:

1. A value outside its plausibility range is dropped (and counted).
2. Under ``QcPolicy.GHCNH_LENIENT`` a value whose QC code is neither ``"1"`` nor null is dropped (and counted).
3. Each report belongs to the nearest UTC hour. A report at exactly HH:30:00 goes to the even hour, which is what the
   research's pandas ``round("h")`` does (Polars ``dt.round`` rounds such ties up, so it is not used here).
4. Within an hour the report closest to the hour supplies the value. At equal distance the earlier report wins; at
   equal time as well, the report listed first wins.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final

import polars as pl

from stellar_blaze.domain.weather.models import QcPolicy
from stellar_blaze.domain.weather.schemas import OBS_HOURLY_SCHEMA, OBS_RAW_SCHEMA, conform

# Plausibility ranges, inclusive (ADR 0005): gross-error screens, not quality control.
PLAUSIBLE: Final[Mapping[str, tuple[float, float]]] = MappingProxyType(
    {"t_c": (-10.0, 60.0), "td_c": (-30.0, 40.0), "wind_ms": (0.0, 60.0)}
)

_QC_COLUMN: Final = {"t_c": "qc_t", "td_c": "qc_td", "wind_ms": "qc_wind"}
_KEY_COLUMNS: Final = ("station", "obs_time", "source")


@dataclass(frozen=True, slots=True)
class BinningReport:
    """What binning discarded, per variable (``t_c``, ``td_c``, ``wind_ms``).

    A value counts once: as implausible, or else as QC-flagged. Missing values count as neither. The counts cover every
    raw report, including those whose hour bin ends up empty or is superseded by a closer report.

    Attributes:
        n_raw: Raw reports received.
        n_implausible: Values outside the plausibility range, including NaN and infinities.
        n_qc_flagged: Plausible values dropped for their QC code (always zero under ``QcPolicy.NONE``).
    """

    n_raw: int
    n_implausible: dict[str, int]
    n_qc_flagged: dict[str, int]


def bin_to_nearest_hour(raw: pl.DataFrame, *, qc_policy: QcPolicy) -> tuple[pl.DataFrame, BinningReport]:
    """Bin raw reports to the nearest UTC hour, one value per variable.

    Reports are binned per station and per source, so a row's values always come from one source; pass a single source
    per call, because ``qc_policy`` is one per call. A blank QC code must arrive as null: any string other than
    ``"1"`` (an empty one included) is a flag. Hours in which no variable has a valid value are not emitted, and the
    caller restricts the result to the window it needs.

    Args:
        raw: Reports conforming to ``OBS_RAW_SCHEMA``.
        qc_policy: How to read the ``qc_*`` columns.

    Returns:
        The hourly frame (``OBS_HOURLY_SCHEMA``, sorted by station, hour and source) and the discard counts.

    Raises:
        SchemaMismatchError: ``raw`` does not conform to ``OBS_RAW_SCHEMA``.
        ValueError: ``station``, ``obs_time`` or ``source`` holds a null, so a report cannot be placed.
    """
    df = conform(raw, OBS_RAW_SCHEMA)
    null_keys = [name for name in _KEY_COLUMNS if df[name].null_count()]
    if null_keys:
        raise ValueError(f"cannot bin reports with null {', '.join(repr(name) for name in null_keys)}")

    # Rules 1 and 2: which values are dropped. A NaN or infinite value is implausible: Polars orders NaN above every
    # number and `is_between` is false for it.
    implausible = {
        name: pl.col(name).is_not_null() & ~pl.col(name).is_between(low, high)
        for name, (low, high) in PLAUSIBLE.items()
    }
    if qc_policy is QcPolicy.GHCNH_LENIENT:
        flagged = {
            name: pl.col(name).is_not_null() & ~implausible[name] & pl.col(code).is_not_null() & (pl.col(code) != "1")
            for name, code in _QC_COLUMN.items()
        }
    else:
        flagged = {name: pl.lit(False) for name in PLAUSIBLE}
    counts = df.select(
        *(implausible[name].sum().alias(f"implausible_{name}") for name in PLAUSIBLE),
        *(flagged[name].sum().alias(f"flagged_{name}") for name in PLAUSIBLE),
    ).row(0, named=True)
    report = BinningReport(
        n_raw=df.height,
        n_implausible={name: int(counts[f"implausible_{name}"]) for name in PLAUSIBLE},
        n_qc_flagged={name: int(counts[f"flagged_{name}"]) for name in PLAUSIBLE},
    )

    # Rule 3: the nearest hour; exactly half past goes to whichever of the two hours is even (24 is even, so the
    # parity of the clock hour is the parity of the hour count since the epoch, as in pandas).
    floor = pl.col("obs_time").dt.truncate("1h")
    past_floor = pl.col("obs_time") - floor
    half_hour = pl.duration(minutes=30)
    round_up = (past_floor > half_hour) | ((past_floor == half_hour) & (floor.dt.hour() % 2 == 1))

    # Rule 4: the closest report first; the earlier time, then the input position, break ties. The input position is
    # explicit, so the outcome does not hang on the stability of the sort.
    hourly = (
        df.with_row_index("input_position")
        .with_columns(
            *(pl.when(~(implausible[name] | flagged[name])).then(pl.col(name)).alias(name) for name in PLAUSIBLE),
            pl.when(round_up).then(floor + pl.duration(hours=1)).otherwise(floor).alias("valid_time"),
        )
        .with_columns((pl.col("obs_time") - pl.col("valid_time")).abs().alias("distance"))
        .sort("station", "valid_time", "source", "distance", "obs_time", "input_position")
        .group_by("station", "valid_time", "source", maintain_order=True)
        .agg(pl.col(name).drop_nulls().first() for name in PLAUSIBLE)
        .filter(pl.any_horizontal(pl.col(name).is_not_null() for name in PLAUSIBLE))
    )
    return conform(hourly, OBS_HOURLY_SCHEMA), report
