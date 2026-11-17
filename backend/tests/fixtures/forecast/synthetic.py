"""A synthetic stand-in for the gold pair dataset (``GOLD_PAIRS_SCHEMA``), deterministic and fast.

No unit test reads the real gold file (the 2026 hold-out); they read what ``make_pairs`` builds. The generator is a
small weather model and an error model, kept simple on purpose:

* the *atmosphere* of a station and summer is a seasonal and diurnal cycle plus a day-to-day anomaly, with the solar
  radiation computed from the sun's position (``mean_cos_zenith_prev_hour``), so it is exactly zero at night and the
  Liljegren solver never sees incoherent inputs;
* the *truth* (``obs_*``) is that atmosphere plus small measurement noise, one value per station-hour whatever the model
  and lead, and may be missing (``missing_obs_rate``);
* a *forecast* is the atmosphere plus the injected bias plus noise whose standard deviation grows with the lead
  (``GFS`` is 20 percent noisier than ``IFS``), independent from row to row.

The frames go through B1's ``build_pairs``, so the WBGT columns, the reference columns, ``summer``, ``doy``,
``hour_utc``, ``is_daytime`` and ``has_joint_obs`` have exactly the semantics of the real dataset. A WBGT the solver or
the injected ``reject_rate`` rejects is NaN with its code, as in the real file.

Randomness is keyed by (seed, summer, station, stream), and every stream is drawn over the whole summer, so the
values do not depend on which stations, leads, hours or days a call selects: ``make_pairs(stations=("OMAA",))`` is
the OMAA rows of the full frame. Selecting leads without lead 0 leaves ``ref_*`` null (the reference is IFS lead 0).
"""

from collections.abc import Mapping, Sequence
from functools import lru_cache
from typing import Final

import numpy as np
import polars as pl

from stellar_blaze.application.dataset import build_pairs
from stellar_blaze.domain.physics.solar import mean_cos_zenith_prev_hour
from stellar_blaze.domain.physics.types import F64
from stellar_blaze.domain.weather.models import LEADS_DAYS, NwpModel
from stellar_blaze.domain.weather.schemas import FORECAST_SCHEMA, GOLD_PAIRS_SCHEMA, OBS_HOURLY_SCHEMA, conform
from stellar_blaze.domain.weather.stations import STATIONS, Station

SUMMER_DAYS: Final[tuple[int, ...]] = (*range(1, 31), *range(110, 140))
"""Default ``summer_days``: 15 May to 13 June (the first week and its history) and all of September (calibration)."""

_DAYS_IN_SUMMER: Final = 139  # 15 May .. 30 Sep
_MODELS: Final = (NwpModel.ECMWF_IFS025.value, NwpModel.GFS_SEAMLESS.value)
_NOISE_FACTOR: Final = {NwpModel.ECMWF_IFS025.value: 1.0, NwpModel.GFS_SEAMLESS.value: 1.2}
_REJECT_CODES: Final = np.array([2, 3, 4], dtype=np.int8)  # INCOHERENT_RADIATION, NO_CONVERGENCE, OUT_OF_BOUNDS

# Stream ids of the random generators of one (seed, summer, station).
_ATMOSPHERE, _OBSERVATION, _FORECAST = 0, 1, 100

type _Field = F64  # a (139, 24) array: summer day by hour of the day
type _Bias = tuple[tuple[str, float], ...]  # a per-station bias as sorted, hashable items


def _checked_ints(name: str, values: Sequence[int], low: int, high: int) -> list[int]:
    chosen = sorted(set(values))
    if not chosen or chosen[0] < low or chosen[-1] > high:
        raise ValueError(f"{name} must be a non-empty selection of integers in [{low}, {high}], got {list(values)}")
    return chosen


def _checked_bias(name: str, bias: Mapping[str, float] | None) -> _Bias:
    known = {s.icao for s in STATIONS}
    unknown = sorted(set(bias or {}) - known)
    if unknown:
        raise ValueError(f"{name} names stations that are not in STATIONS: {unknown}")
    return tuple(sorted((bias or {}).items()))


def _checked_rate(name: str, rate: float) -> float:
    if not 0.0 <= rate <= 1.0:
        raise ValueError(f"{name} must be in [0, 1], got {rate!r}")
    return rate


def _stations(selection: Sequence[str] | None) -> list[tuple[int, Station]]:
    by_icao = {s.icao: (i, s) for i, s in enumerate(STATIONS)}
    if selection is None:
        return list(by_icao.values())
    unknown = sorted(set(selection) - set(by_icao))
    if unknown or not selection:
        raise ValueError(
            f"stations must be a non-empty selection of STATIONS, got {list(selection)}; unknown: {unknown}"
        )
    return [by_icao[icao] for icao in dict.fromkeys(selection)]


def _atmosphere(
    rng: np.random.Generator, index: int, station: Station, utc: np.ndarray[tuple[int, int], np.dtype[np.datetime64]]
) -> dict[str, _Field]:
    """The true atmosphere of one station and summer: each field a (139, 24) array (day, hour of the UTC day)."""
    days = np.arange(_DAYS_IN_SUMMER, dtype=np.float64)[:, None]
    hours = np.arange(24, dtype=np.float64)[None, :]
    doy = days + 135.0
    solar_hour = hours + station.lon / 15.0

    def anomaly(scale: float, persistence: float = 0.7) -> F64:
        """A day-to-day autoregressive anomaly, shape (139, 1)."""
        shocks = rng.normal(0.0, scale, _DAYS_IN_SUMMER)
        out = np.empty(_DAYS_IN_SUMMER)
        previous = 0.0
        for day in range(_DAYS_IN_SUMMER):
            previous = persistence * previous + shocks[day]
            out[day] = previous
        return out[:, None]

    station_offset = ((index * 7) % 5 - 2) * 0.5
    t = (
        34.0
        + station_offset
        + 1.8 * np.cos(2 * np.pi * (doy - 200.0) / 365.0)
        + anomaly(1.0)
        + 6.0 * np.cos(2 * np.pi * (solar_hour - 15.0) / 24.0)
        + rng.normal(0.0, 0.4, (_DAYS_IN_SUMMER, 24))
    )
    td = (
        21.0
        + 2.0 * np.cos(2 * np.pi * (doy - 215.0) / 365.0)
        + anomaly(1.0)
        + 2.0 * np.cos(2 * np.pi * (solar_hour - 20.0) / 24.0)
        + rng.normal(0.0, 0.4, (_DAYS_IN_SUMMER, 24))
    )
    wind = (
        3.5
        + 1.2 * np.cos(2 * np.pi * (solar_hour - 14.0) / 24.0)
        + anomaly(0.5)
        + rng.normal(0.0, 0.5, (_DAYS_IN_SUMMER, 24))
    )
    clearness = np.clip(0.82 + 0.05 * anomaly(1.0, persistence=0.5), 0.6, 0.95)
    direct_share = np.clip(0.7 + 0.1 * rng.normal(0.0, 1.0, (_DAYS_IN_SUMMER, 1)), 0.3, 0.9)
    cos_zenith = mean_cos_zenith_prev_hour(station.lat, station.lon, utc.ravel()).reshape(_DAYS_IN_SUMMER, 24)
    sw = 1000.0 * cos_zenith * clearness
    pressure = (
        1013.25 * np.exp(-station.elevation_m / 8434.0)
        + 2.0 * anomaly(1.0)
        + 1.0 * np.cos(2 * np.pi * (solar_hour - 10.0) / 12.0)
    )
    return {
        "t": t,
        "td": np.minimum(td, t - 2.0),
        "wind": np.maximum(wind, 0.3),
        "sw": sw,
        "direct": sw * direct_share,
        "pressure": pressure + np.zeros((_DAYS_IN_SUMMER, 24)),
        "direct_share": direct_share + np.zeros((_DAYS_IN_SUMMER, 24)),
    }


def _utc_series(
    utc_us: np.ndarray[tuple[int], np.dtype[np.datetime64]], rows: np.ndarray[tuple[int], np.dtype[np.bool_]]
) -> pl.Series:
    """The selected hour labels as a UTC-aware microsecond ``Datetime`` series."""
    return pl.Series(utc_us[rows], dtype=pl.Datetime("us")).dt.replace_time_zone("UTC")


def _day_hour_selection(days: Sequence[int], hours: Sequence[int]) -> np.ndarray[tuple[int, ...], np.dtype[np.bool_]]:
    """A flat boolean mask over the (139, 24) fields that selects the requested days and hours."""
    day_mask = np.zeros(_DAYS_IN_SUMMER, dtype=bool)
    day_mask[np.asarray(days) - 1] = True
    hour_mask = np.zeros(24, dtype=bool)
    hour_mask[np.asarray(hours)] = True
    return (day_mask[:, None] & hour_mask[None, :]).ravel()


def make_pairs(
    *,
    seed: int,
    summers: tuple[int, ...],
    station_bias_c: Mapping[str, float],
    stations: Sequence[str] | None = None,
    leads: Sequence[int] = (0, 1, 2, 3),
    hours_utc: Sequence[int] = range(24),
    summer_days: Sequence[int] | None = None,
    td_bias_c: Mapping[str, float] | None = None,
    wind_bias_ms: Mapping[str, float] | None = None,
    missing_obs_rate: float = 0.02,
    reject_rate: float = 0.01,
    gfs_missing_rate: float = 0.01,
) -> pl.DataFrame:
    """Synthetic ``GOLD_PAIRS_SCHEMA`` rows for ``ecmwf_ifs025`` and ``gfs_seamless``.

    Args:
        seed: Non-negative seed; the same arguments give the same frame, and the values of a row do not depend on which
            other rows are selected.
        summers: Years to generate (each is the 139-day summer window, 15 May to 30 September).
        station_bias_c: Mean forecast minus truth of the temperature in degrees Celsius, per ICAO identifier; a station
            that is not named has none. It applies to every model and lead.
        stations: ICAO identifiers to generate (default: all 8, with their real clusters).
        leads: Leads in days, 0 to 7. Omitting lead 0 leaves every ``ref_*`` null and so every truth WBGT NaN (reject
            code ``NONFINITE_INPUT``): a caller that passes ``MODEL_LEADS`` (1-7) and needs the WBGT truth must keep
            lead 0 in the selection or build the truth separately.
        hours_utc: Hours of the UTC day (the default is all 24, so that a loader's hour filter has something to filter).
        summer_days: 1-based days of the summer (1 is 15 May, 110 is 1 September, 139 is 30 September); the default is
            ``SUMMER_DAYS``, days 1-30 and 110-139.
        td_bias_c: Mean forecast minus truth of the dew point per station (default none).
        wind_bias_ms: Mean forecast minus truth of the wind speed per station (default none).
        missing_obs_rate: Share of station-hours with no observation (null truth, ``has_joint_obs`` false).
        reject_rate: Share of the station-hours with an observation whose truth WBGT is rejected (NaN, never null,
            with a code of 2, 3 or 4).
        gfs_missing_rate: Share of GFS rows that are absent.

    Returns:
        The frame, sorted by model, station, valid time and lead as ``build_pairs`` sorts it.

    Raises:
        ValueError: An argument is out of range or names an unknown station.
    """
    if seed < 0:
        raise ValueError(f"seed must be non-negative, got {seed}")
    if not summers:
        raise ValueError("summers must name at least one year")
    chosen_days = _checked_ints("summer_days", SUMMER_DAYS if summer_days is None else summer_days, 1, _DAYS_IN_SUMMER)
    # The frame is a pure function of these hashable values: a repeated call (a test module, then the next) is cached,
    # and each caller gets its own clone so an in-place edit cannot reach the cache.
    return _generate(
        seed,
        tuple(summers),
        tuple(index for index, _ in _stations(stations)),
        tuple(_checked_ints("leads", leads, LEADS_DAYS[0], LEADS_DAYS[-1])),
        tuple(_checked_ints("hours_utc", hours_utc, 0, 23)),
        tuple(chosen_days),
        _checked_bias("station_bias_c", station_bias_c),
        _checked_bias("td_bias_c", td_bias_c),
        _checked_bias("wind_bias_ms", wind_bias_ms),
        _checked_rate("missing_obs_rate", missing_obs_rate),
        _checked_rate("reject_rate", reject_rate),
        _checked_rate("gfs_missing_rate", gfs_missing_rate),
    ).clone()


@lru_cache(maxsize=32)
def _generate(
    seed: int,
    summers: tuple[int, ...],
    station_indices: tuple[int, ...],
    leads: tuple[int, ...],
    hours: tuple[int, ...],
    days: tuple[int, ...],
    station_bias: _Bias,
    td_bias_items: _Bias,
    wind_bias_items: _Bias,
    missing_rate: float,
    reject_share: float,
    gfs_rate: float,
) -> pl.DataFrame:
    """``make_pairs`` for validated, hashable arguments (cached)."""
    t_bias, td_bias, wind_bias = dict(station_bias), dict(td_bias_items), dict(wind_bias_items)
    chosen_stations = [(index, STATIONS[index]) for index in station_indices]
    selected = _day_hour_selection(days, hours)
    forecast_parts: list[pl.DataFrame] = []
    obs_parts: list[pl.DataFrame] = []
    reject_parts: list[pl.DataFrame] = []
    for summer in summers:
        start = np.datetime64(f"{summer}-05-15T00", "h")
        utc = (start + np.arange(_DAYS_IN_SUMMER * 24).astype("timedelta64[h]")).reshape(_DAYS_IN_SUMMER, 24)
        utc_us = utc.astype("datetime64[us]").ravel()
        for index, where in chosen_stations:
            atm = _atmosphere(np.random.default_rng([seed, summer, index, _ATMOSPHERE]), index, where, utc)
            obs_rng = np.random.default_rng([seed, summer, index, _OBSERVATION])
            truth_t = atm["t"] + obs_rng.normal(0.0, 0.3, atm["t"].shape)
            truth_td = np.minimum(atm["td"] + obs_rng.normal(0.0, 0.4, atm["t"].shape), truth_t - 0.5)
            truth_wind = np.maximum(atm["wind"] + obs_rng.normal(0.0, 0.3, atm["t"].shape), 0.0)
            absent = obs_rng.random(atm["t"].shape) < missing_rate
            rejected = (obs_rng.random(atm["t"].shape) < reject_share) & ~absent
            codes = obs_rng.choice(_REJECT_CODES, atm["t"].shape)
            keep = selected & ~absent.ravel()
            obs_parts.append(
                pl.DataFrame(
                    {
                        "station": [where.icao] * int(keep.sum()),
                        "valid_time": _utc_series(utc_us, keep),
                        "t_c": truth_t.ravel()[keep],
                        "td_c": truth_td.ravel()[keep],
                        "wind_ms": truth_wind.ravel()[keep],
                        "source": ["iem"] * int(keep.sum()),
                    },
                    schema=OBS_HOURLY_SCHEMA,
                )
            )
            flagged = selected & rejected.ravel()
            reject_parts.append(
                pl.DataFrame(
                    {
                        "station": [where.icao] * int(flagged.sum()),
                        "valid_time": _utc_series(utc_us, flagged),
                        "reject": codes.ravel()[flagged],
                    },
                    schema={"station": pl.String(), "valid_time": pl.Datetime("us", "UTC"), "reject": pl.Int8()},
                )
            )

            for model_number, model in enumerate(_MODELS):
                for lead in leads:
                    rng = np.random.default_rng([seed, summer, index, _FORECAST + 10 * model_number + lead])
                    shape = atm["t"].shape
                    scale = _NOISE_FACTOR[model]
                    fc_t = atm["t"] + t_bias.get(where.icao, 0.0) + scale * (0.6 + 0.3 * lead) * rng.normal(size=shape)
                    fc_td = (
                        atm["td"] + td_bias.get(where.icao, 0.0) + scale * (0.8 + 0.35 * lead) * rng.normal(size=shape)
                    )
                    fc_wind = (
                        atm["wind"]
                        + wind_bias.get(where.icao, 0.0)
                        + scale * (0.5 + 0.12 * lead) * rng.normal(size=shape)
                    )
                    fc_sw = atm["sw"] * np.clip(1.0 + 0.04 * (1 + lead) * rng.normal(size=shape), 0.0, 1.6)
                    share = np.clip(atm["direct_share"] + 0.03 * rng.normal(size=shape), 0.0, 0.95)
                    fc_pressure = atm["pressure"] + (0.3 + 0.05 * lead) * rng.normal(size=shape)
                    dropped = (
                        rng.random(shape) < gfs_rate if model == NwpModel.GFS_SEAMLESS.value else np.zeros(shape, bool)
                    )
                    rows = selected & ~dropped.ravel()
                    n = int(rows.sum())
                    forecast_parts.append(
                        pl.DataFrame(
                            {
                                "station": [where.icao] * n,
                                "model": [model] * n,
                                "valid_time": _utc_series(utc_us, rows),
                                "lead_days": np.full(n, lead, dtype=np.int8),
                                "t_c": fc_t.ravel()[rows],
                                "td_c": np.minimum(fc_td, fc_t).ravel()[rows],
                                "wind_ms": np.maximum(fc_wind, 0.0).ravel()[rows],
                                "sw_wm2": fc_sw.ravel()[rows],
                                "direct_wm2": (fc_sw * share).ravel()[rows],
                                "pressure_hpa": fc_pressure.ravel()[rows],
                                "grid_lat": np.full(n, round(where.lat * 4) / 4),
                                "grid_lon": np.full(n, round(where.lon * 4) / 4),
                                "grid_elev_m": np.full(n, where.elevation_m + 8.0),
                            },
                            schema=FORECAST_SCHEMA,
                        )
                    )

    pairs = build_pairs(
        forecasts=pl.concat(forecast_parts),
        obs_iem=pl.concat(obs_parts),
        obs_ghcnh=pl.DataFrame(schema=OBS_HOURLY_SCHEMA),
    )
    rejects = pl.concat(reject_parts)
    if rejects.height:
        pairs = (
            pairs.join(rejects, on=["station", "valid_time"], how="left", validate="m:1", maintain_order="left")
            .with_columns(
                pl.when(pl.col("reject").is_not_null())
                .then(pl.lit(float("nan"), dtype=pl.Float64))
                .otherwise(pl.col("wbgt_obs_c"))
                .alias("wbgt_obs_c"),
                pl.coalesce(pl.col("reject"), pl.col("wbgt_obs_reject")).alias("wbgt_obs_reject"),
            )
            .drop("reject")
        )
    return conform(pairs, GOLD_PAIRS_SCHEMA)


def clear_cache() -> None:
    """Forget the frames ``make_pairs`` has built (a determinism test must rebuild, not read the cache)."""
    _generate.cache_clear()


def forecasts_of(pairs: pl.DataFrame, model: str) -> pl.DataFrame:
    """The ``FORECAST_SCHEMA`` rows of one model in a pair frame, in its order (what ``correct`` takes as ``ifs``)."""
    frame = pairs.filter(pl.col("model") == model).select(
        "station",
        "model",
        "valid_time",
        "lead_days",
        pl.col("fc_t_c").alias("t_c"),
        pl.col("fc_td_c").alias("td_c"),
        pl.col("fc_wind_ms").alias("wind_ms"),
        pl.col("fc_sw_wm2").alias("sw_wm2"),
        pl.col("fc_direct_wm2").alias("direct_wm2"),
        pl.col("fc_pressure_hpa").alias("pressure_hpa"),
        "grid_lat",
        "grid_lon",
        "grid_elev_m",
    )
    return conform(frame, FORECAST_SCHEMA)


def observations_of(pairs: pl.DataFrame) -> pl.DataFrame:
    """The ``OBS_HOURLY_SCHEMA`` truth of a pair frame: one row per station-hour that has a joint observation."""
    frame = (
        pairs.filter(pl.col("has_joint_obs"))
        .select(
            "station",
            "valid_time",
            pl.col("obs_t_c").alias("t_c"),
            pl.col("obs_td_c").alias("td_c"),
            pl.col("obs_wind_ms").alias("wind_ms"),
        )
        .unique(subset=["station", "valid_time"], keep="first", maintain_order=True)
        .with_columns(pl.lit("iem").alias("source"))
    )
    return conform(frame, OBS_HOURLY_SCHEMA)
