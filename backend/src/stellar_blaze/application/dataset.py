"""The gold pair dataset: forecasts joined to the truth, the audit values and the WBGT of three input sets.

``build_pairs`` is the research's ``match_pairs.py`` (which hour of which forecast meets which observation) plus the
columns the model and the evaluation need; ``summarize_pairs`` reports the numbers the research printed, so a build can
be checked against ``docs/research/scripts/results/``. Both are pure functions of the frames they are given: reading
the silver files and writing the gold file is the job's business.
"""

from collections.abc import Sequence
from typing import Final

import numpy as np
import polars as pl
from numpy.typing import NDArray

from stellar_blaze.domain.physics.types import F64
from stellar_blaze.domain.physics.wbgt import WbgtReject, wbgt_liljegren
from stellar_blaze.domain.weather.dataset import DatasetSummary, ObservationQc, PairCount, RawError
from stellar_blaze.domain.weather.models import LEADS_DAYS, NwpModel, is_working_daytime
from stellar_blaze.domain.weather.schemas import (
    FORECAST_SCHEMA,
    GOLD_PAIRS_SCHEMA,
    OBS_HOURLY_SCHEMA,
    conform,
)
from stellar_blaze.domain.weather.stations import STATIONS, station

# ADR 0005: the WBGT "truth" and the same-radiation forecast WBGT take the radiation and pressure that IFS issued the
# same day (lead 0) at the station's cell.
REFERENCE_MODEL: Final = NwpModel.ECMWF_IFS025
REFERENCE_LEAD_DAYS: Final = LEADS_DAYS[0]

_FORECAST_COLUMNS: Final = {
    "t_c": "fc_t_c",
    "td_c": "fc_td_c",
    "wind_ms": "fc_wind_ms",
    "sw_wm2": "fc_sw_wm2",
    "direct_wm2": "fc_direct_wm2",
    "pressure_hpa": "fc_pressure_hpa",
}
_REFERENCE_COLUMNS: Final = {"sw_wm2": "ref_sw_wm2", "direct_wm2": "ref_direct_wm2", "pressure_hpa": "ref_pressure_hpa"}
_TRUTH_COLUMNS: Final = {"t_c": "obs_t_c", "td_c": "obs_td_c", "wind_ms": "obs_wind_ms"}
_AUDIT_COLUMNS: Final = {"t_c": "audit_t_c", "td_c": "audit_td_c", "wind_ms": "audit_wind_ms"}

# The research's error variables, in its order: (name, forecast column, observation column).
_ERROR_VARIABLES: Final = (
    ("t", "fc_t_c", "obs_t_c"),
    ("td", "fc_td_c", "obs_td_c"),
    ("ws", "fc_wind_ms", "obs_wind_ms"),
)

# The three WBGT variants: (value column, reject column, t, td, wind, pressure, shortwave, direct) input columns.
type _WbgtInputs = tuple[str, str, str, str, str, str]
_WBGT_VARIANTS: Final[tuple[tuple[str, str, _WbgtInputs], ...]] = (
    (
        "wbgt_obs_c",
        "wbgt_obs_reject",
        ("obs_t_c", "obs_td_c", "obs_wind_ms", "ref_pressure_hpa", "ref_sw_wm2", "ref_direct_wm2"),
    ),
    (
        "wbgt_fc_c",
        "wbgt_fc_reject",
        ("fc_t_c", "fc_td_c", "fc_wind_ms", "fc_pressure_hpa", "fc_sw_wm2", "fc_direct_wm2"),
    ),
    (
        "wbgt_fc_refrad_c",
        "wbgt_fc_refrad_reject",
        ("fc_t_c", "fc_td_c", "fc_wind_ms", "ref_pressure_hpa", "ref_sw_wm2", "ref_direct_wm2"),
    ),
)

# Finite values that no weather station or model reports, which the Liljegren solver is not asked to digest: a value
# outside these bounds is made missing before the solver (Task 6 carry-forward; they would reach numpy as numbers and
# raise floating-point warnings). The temperature bounds apply to air temperature and dew point alike. These are
# gross-error screens in the spirit of ``PLAUSIBLE`` in ``binning.py``, wider than it, and not quality control.
_SOLVER_TEMPERATURE_C: Final = (-60.0, 70.0)

_DAYTIME_HOURS: Final = [hour for hour in range(24) if is_working_daytime(hour)]
_KEYS: Final = ("model", "summer", "lead_days")


def _finite(columns: Sequence[str]) -> list[pl.Expr]:
    """Each column with NaN and infinities made null (the adapters emit nulls, but a frame can come from anywhere)."""
    return [pl.when(pl.col(name).is_finite()).then(pl.col(name)).alias(name) for name in columns]


def _float_columns(schema: pl.Schema) -> list[str]:
    return [name for name, dtype in schema.items() if dtype == pl.Float64()]


def _require_unique(frame: pl.DataFrame, keys: Sequence[str], label: str) -> None:
    duplicated = frame.filter(frame.select(keys).is_duplicated())
    if duplicated.height:
        example = duplicated.select(keys).row(0, named=True)
        raise ValueError(f"duplicate {label} ({duplicated.height} rows share a key), for example {example}")


def build_pairs(*, forecasts: pl.DataFrame, obs_iem: pl.DataFrame, obs_ghcnh: pl.DataFrame) -> pl.DataFrame:
    """One row per forecast row, with the truth, audit, reference and WBGT columns of ``GOLD_PAIRS_SCHEMA``.

    The truth is the IEM hourly value of the same station and valid hour, the audit value the GHCNh one; an hour a
    source lacks is null. The reference is the IFS lead-0 radiation and pressure of the same station and hour, whatever
    the row's own model and lead. NaN and infinities in the inputs are treated as missing. Rows are sorted by model,
    station, valid time and lead, so the same inputs always give the same frame.

    Each WBGT column is ``wbgt_liljegren`` (MIDPOINT mode, at the station's coordinates) over three input sets:
    ``wbgt_obs_c`` takes the observed temperature, dew point and wind and the reference radiation and pressure;
    ``wbgt_fc_c`` the forecast's own values; ``wbgt_fc_refrad_c`` the forecast temperature, dew point and wind with the
    reference radiation and pressure. A row the solver rejects is NaN, with its reason in the ``*_reject`` column
    (``WbgtReject``). Before the solver, a temperature or dew point outside -60 to 70 degrees Celsius, a pressure at or
    below 0 and a negative wind speed are made missing for that WBGT only (the row is rejected as non-finite input); the
    ``fc_*`` columns keep what the forecast said.

    Raises:
        SchemaMismatchError: A frame does not have its schema (``FORECAST_SCHEMA``, ``OBS_HOURLY_SCHEMA``).
        ValueError: A station is not one of ``STATIONS``, or a key occurs twice (a repeated forecast row would be
            counted twice, a repeated observation would multiply the rows it joins).
    """
    forecast = conform(forecasts, FORECAST_SCHEMA)
    truth = conform(obs_iem, OBS_HOURLY_SCHEMA)
    audit = conform(obs_ghcnh, OBS_HOURLY_SCHEMA)
    unknown = sorted(set(forecast["station"].unique().to_list()) - {s.icao for s in STATIONS})
    if unknown:
        raise ValueError(f"forecasts for stations that are not in STATIONS: {unknown}")
    _require_unique(forecast, ("station", "model", "valid_time", "lead_days"), "forecast rows")
    _require_unique(truth, ("station", "valid_time"), "iem observation rows")
    _require_unique(audit, ("station", "valid_time"), "ghcnh observation rows")

    forecast = forecast.with_columns(_finite(_float_columns(FORECAST_SCHEMA)))
    truth = truth.with_columns(_finite(["t_c", "td_c", "wind_ms"]))
    audit = audit.with_columns(_finite(["t_c", "td_c", "wind_ms"]))

    stations = pl.DataFrame(
        {
            "station": [s.icao for s in STATIONS],
            "cluster": [s.cluster for s in STATIONS],
            "station_elev_m": [s.elevation_m for s in STATIONS],
        },
        schema={"station": pl.String(), "cluster": pl.String(), "station_elev_m": pl.Float64()},
    )
    reference = forecast.filter(
        (pl.col("model") == REFERENCE_MODEL.value) & (pl.col("lead_days") == REFERENCE_LEAD_DAYS)
    ).select("station", "valid_time", *(pl.col(source).alias(target) for source, target in _REFERENCE_COLUMNS.items()))

    def observed(frame: pl.DataFrame, names: dict[str, str]) -> pl.DataFrame:
        return frame.select(
            "station", "valid_time", *(pl.col(source).alias(target) for source, target in names.items())
        )

    keys = ["station", "valid_time"]
    hour = pl.col("hour_utc")
    pairs = (
        forecast.rename(_FORECAST_COLUMNS)
        .join(stations, on="station", how="left", validate="m:1")
        .join(reference, on=keys, how="left", validate="m:1")
        .join(observed(truth, _TRUTH_COLUMNS), on=keys, how="left", validate="m:1")
        .join(observed(audit, _AUDIT_COLUMNS), on=keys, how="left", validate="m:1")
        .with_columns(
            pl.col("valid_time").dt.year().cast(pl.Int16()).alias("summer"),
            pl.col("valid_time").dt.hour().cast(pl.Int8()).alias("hour_utc"),
            pl.col("valid_time").dt.ordinal_day().cast(pl.Int16()).alias("doy"),
        )
        .with_columns(
            hour.is_in(_DAYTIME_HOURS).alias("is_daytime"),
            pl.all_horizontal(pl.col(name).is_not_null() for name in _TRUTH_COLUMNS.values()).alias("has_joint_obs"),
        )
        .sort("model", "station", "valid_time", "lead_days")
    )
    return conform(_with_wbgt(pairs), GOLD_PAIRS_SCHEMA)


def _array(frame: pl.DataFrame, name: str) -> F64:
    """The column as float64, with nulls as NaN."""
    return np.asarray(frame[name].to_numpy(), dtype=np.float64)


def _screened(t: F64, td: F64, wind: F64, pressure: F64) -> tuple[F64, F64, F64, F64]:
    """The solver's inputs with the sentinel-like values turned into NaN (see ``build_pairs``)."""
    low, high = _SOLVER_TEMPERATURE_C
    return (
        np.where((t >= low) & (t <= high), t, np.nan),
        np.where((td >= low) & (td <= high), td, np.nan),
        np.where(wind >= 0.0, wind, np.nan),
        np.where(pressure > 0.0, pressure, np.nan),
    )


def _solve(distinct: pl.DataFrame, inputs: _WbgtInputs) -> tuple[F64, NDArray[np.int8]]:
    """The WBGT and reject code of each row of ``distinct`` (columns ``station``, ``valid_time`` and ``inputs``)."""
    t_name, td_name, wind_name, pressure_name, sw_name, direct_name = inputs
    t, td, wind, pressure = _screened(
        _array(distinct, t_name),
        _array(distinct, td_name),
        _array(distinct, wind_name),
        _array(distinct, pressure_name),
    )
    sw, direct = _array(distinct, sw_name), _array(distinct, direct_name)
    valid_utc = distinct["valid_time"].dt.replace_time_zone(None).to_numpy()
    stations = distinct["station"].to_numpy()
    wbgt = np.full(distinct.height, np.nan, dtype=np.float64)
    reject = np.zeros(distinct.height, dtype=np.int8)
    for icao in np.unique(stations):
        rows = np.flatnonzero(stations == icao)
        where = station(str(icao))
        result = wbgt_liljegren(
            t_c=t[rows],
            td_c=td[rows],
            wind10m_ms=wind[rows],
            pressure_hpa=pressure[rows],
            sw_wm2=sw[rows],
            direct_wm2=direct[rows],
            lat=where.lat,
            lon=where.lon,
            valid_time_utc=valid_utc[rows],
        )
        wbgt[rows] = result.wbgt_c
        reject[rows] = result.reject
    return wbgt, reject


def _with_wbgt(pairs: pl.DataFrame) -> pl.DataFrame:
    """``pairs`` plus the three WBGT columns and their reject codes.

    Each variant is solved once per distinct set of inputs (station, hour and the six values), not once per row: the
    observation variant depends only on the station and the hour, so it is solved once and not once per model and lead
    (a saving of two thirds of the solver's time on the full dataset). The solved rows are joined back by their inputs,
    which keeps the order of ``pairs``.
    """
    for value_column, reject_column, inputs in _WBGT_VARIANTS:
        keys = ["station", "valid_time", *inputs]
        distinct = pairs.select(keys).unique()
        wbgt, reject = _solve(distinct, inputs)
        # NaN, not null: a rejected element is numpy output; the reject column says why (see GOLD_PAIRS_SCHEMA).
        solved = distinct.with_columns(
            pl.Series(value_column, wbgt, dtype=pl.Float64()), pl.Series(reject_column, reject, dtype=pl.Int8())
        )
        pairs = pairs.join(solved, on=keys, how="left", nulls_equal=True, validate="m:1", maintain_order="left")
    return pairs


def summarize_pairs(pairs: pl.DataFrame, *, observation_qc: Sequence[ObservationQc] = ()) -> DatasetSummary:
    """The numbers of a gold dataset: matched pairs, raw errors against the IEM truth, and WBGT reject counts.

    ``joint`` is ``has_joint_obs`` (observed temperature, dew point and wind all present) and the forecast's
    ``fc_t_c``, ``fc_td_c`` and ``fc_wind_ms`` all present: the research's ``pairs_joint``, which needs the forecast
    value as well as the observation. ``joint_daytime`` is ``joint`` in the working daytime (06:00 to 14:59 UTC).

    A raw error is the forecast minus the IEM observation of one variable (``t``, ``td`` or ``ws``), over the rows where
    both are present, pooled over the stations per model, summer and lead. A group without a pair of a variable has no
    row for it. ``observation_qc`` (what binning discarded, from the ingest) is carried through unchanged.

    Raises:
        SchemaMismatchError: ``pairs`` does not have the ``GOLD_PAIRS_SCHEMA`` columns and dtypes.
        ValueError: A reject column holds a code that is not a ``WbgtReject``.
    """
    frame = conform(pairs, GOLD_PAIRS_SCHEMA)
    joint = (
        pl.col("has_joint_obs")
        & pl.col("fc_t_c").is_not_null()
        & pl.col("fc_td_c").is_not_null()
        & pl.col("fc_wind_ms").is_not_null()
    )
    counted = (
        frame.group_by(_KEYS)
        .agg(joint.sum().alias("joint"), (joint & pl.col("is_daytime")).sum().alias("joint_daytime"))
        .sort(_KEYS)
    )
    pair_counts = [PairCount(**row) for row in counted.iter_rows(named=True)]

    ranked: list[tuple[tuple[str, int, int, int], RawError]] = []
    for position, (var, fc_column, obs_column) in enumerate(_ERROR_VARIABLES):
        error = pl.col(fc_column) - pl.col(obs_column)  # null where either side is missing
        per_group = (
            frame.group_by(_KEYS)
            .agg(
                error.count().alias("n"),
                error.mean().alias("bias"),
                error.abs().mean().alias("mae"),
                (error**2).mean().sqrt().alias("rmse"),
            )
            .filter(pl.col("n") > 0)
        )
        for row in per_group.iter_rows(named=True):
            ranked.append(((row["model"], row["summer"], row["lead_days"], position), RawError(var=var, **row)))
    raw_errors = [error for _, error in sorted(ranked, key=lambda item: item[0])]

    return DatasetSummary(
        pair_counts=pair_counts,
        raw_errors=raw_errors,
        wbgt_rejects={
            value_column: _reject_counts(frame, reject_column) for value_column, reject_column, _ in _WBGT_VARIANTS
        },
        observation_qc=list(observation_qc),
    )


def _reject_counts(frame: pl.DataFrame, reject_column: str) -> dict[str, int]:
    """Rows per ``WbgtReject`` name, every name listed (zero included)."""
    names = {int(reason): reason.name for reason in WbgtReject}
    tally = dict.fromkeys(names.values(), 0)
    for code, count in frame[reject_column].value_counts().iter_rows():
        if code not in names:
            raise ValueError(f"{reject_column} holds {code!r}, which is not a WbgtReject code ({sorted(names)})")
        tally[names[code]] += count
    return tally
