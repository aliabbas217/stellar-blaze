"""The reliability data, the raw model comparison and the series export (``ml/forecast_tables.py``): by hand."""

import hashlib
import io
import itertools
from datetime import UTC, datetime, timedelta
from typing import Any

import numpy as np
import polars as pl
import pytest
from pydantic import JsonValue

from stellar_blaze.domain.forecast.features import Target
from stellar_blaze.domain.forecast.grid import F64, LEVELS
from stellar_blaze.domain.provenance import Provenance, ProvenanceLabel
from stellar_blaze.ml.forecast_tables import (
    RELIABILITY_MIN_COUNT,
    SERIES_REFERENCE_COLUMNS,
    raw_comparison,
    reliability_payload,
    series_frame,
    series_manifest,
    series_parquet_bytes,
)
from stellar_blaze.ml.metrics import PREREGISTERED_RELIABILITY_EDGES

pytestmark = pytest.mark.unit

_LEVELS = np.asarray(LEVELS)


def grid_with_exceedance(threshold: float, probability: float) -> F64:
    """A sorted 19-level grid whose probability of exceeding ``threshold`` is ``probability`` (linear in the level)."""
    return threshold + (_LEVELS - (1.0 - probability)) * 10.0


def dig(value: JsonValue) -> Any:
    """A JSON document to navigate by index (the assertions say what is expected at each step)."""
    return value


def table(payload: JsonValue) -> list[dict[str, Any]]:
    document = dig(payload)
    return [dict(zip(document["columns"], row, strict=True)) for row in document["rows"]]


# === reliability ====================================================================================================


def _reliability_inputs() -> tuple[pl.DataFrame, F64, dict[str, F64]]:
    """1,000 rows at lead 1 in working hours: 600 forecast at 70% (420 events), 30 at 10% (3 events), 370 elsewhere.

    The 370 others are excluded for four different reasons (lead 2, an early hour, a missing truth and a missing grid)
    and would move the quoted bin if the selection let any of them in (their events are the opposite of 70%).
    """
    rows: list[tuple[int, int, float, float]] = []  # (lead, hour, probability, truth)
    rows += [(1, 7, 0.7, 33.0 if i < 420 else 20.0) for i in range(600)]
    rows += [(1, 9, 0.1, 33.0 if i < 3 else 20.0) for i in range(30)]
    rows += [(2, 7, 0.7, 20.0)] * 100  # another lead
    rows += [(1, 3, 0.7, 20.0)] * 100  # an early hour (UTC 03 is outside the working daytime 06-14)
    rows += [(1, 7, 0.7, float("nan"))] * 100  # no truth
    rows += [(1, 7, float("nan"), 20.0)] * 70  # no forecast
    keys = pl.DataFrame(
        {"lead_days": [r[0] for r in rows], "hour_utc": [r[1] for r in rows]},
        schema={"lead_days": pl.Int8(), "hour_utc": pl.Int8()},
    )
    truth = np.asarray([r[3] for r in rows])
    grid = np.stack([np.full(19, np.nan) if np.isnan(r[2]) else grid_with_exceedance(32.0, r[2]) for r in rows])
    return keys, truth, {"corrector": grid, "b2d": grid.copy()}


def test_reliability_pools_lead_1_working_hours_and_quotes_the_70_percent_bin() -> None:
    keys, truth, grids = _reliability_inputs()
    payload = dig(reliability_payload(keys, truth, grids))
    event = payload["events"]["32"]
    rows = table(event["models"]["corrector"])
    assert event["n_rows"] == 630
    assert event["n_events"] == 423
    assert [(r["bin_lo"], r["bin_hi"]) for r in rows] == list(itertools.pairwise(PREREGISTERED_RELIABILITY_EDGES))
    seventy = next(r for r in rows if r["bin_lo"] == 0.65)
    assert seventy["n"] == 600
    assert seventy["obs_freq"] == pytest.approx(0.7)
    assert seventy["mean_p"] == pytest.approx(0.7)
    assert seventy["hollow"] is False
    ten = next(r for r in rows if r["bin_lo"] == 0.05)
    assert ten["n"] == 30
    assert ten["hollow"] is True  # fewer than 50 forecasts: drawn hollow, never quoted
    quoted = payload["quoted_bin"]
    assert quoted == {
        "event_wbgt_ge_c": 32.0,
        "model": "corrector",
        "bin_lo": 0.65,
        "n": 600,
        "mean_p": pytest.approx(0.7),
        "obs_freq": pytest.approx(0.7),
        "hollow": False,
    }
    assert set(payload["events"]) == {"30", "32"}
    assert payload["selection"]["min_count"] == RELIABILITY_MIN_COUNT == 50


def test_a_thin_quoted_bin_is_reported_hollow_with_its_count() -> None:
    keys, truth, grids = _reliability_inputs()
    keep = np.arange(keys.height)
    thin = keep[(keep < 40) | (keep >= 600)]  # only 40 of the 600 rows at 70%
    payload = dig(
        reliability_payload(keys[thin.tolist()], truth[thin], {name: grid[thin] for name, grid in grids.items()})
    )
    quoted = payload["quoted_bin"]
    assert quoted["n"] == 40
    assert quoted["hollow"] is True


def test_reliability_refuses_a_missing_reference_model() -> None:
    keys, truth, grids = _reliability_inputs()
    with pytest.raises(ValueError, match="b2d"):
        reliability_payload(keys, truth, {"corrector": grids["corrector"]})


# === the raw comparison =============================================================================================

_START = datetime(2026, 7, 1, 6, tzinfo=UTC)


def _raw_frame(rows: list[dict[str, Any]]) -> pl.DataFrame:
    base: dict[str, Any] = {
        "station": "OMAA",
        "summer": 2026,
        "lead_days": 1,
        "fc_td_c": 20.0,
        "fc_wind_ms": 3.0,
        "obs_td_c": 20.0,
        "obs_wind_ms": 3.0,
        "has_joint_obs": True,
        "wbgt_fc_c": 30.0,
        "wbgt_obs_c": 30.0,
        "wbgt_fc_reject": 0,
        "wbgt_obs_reject": 0,
    }
    frame = pl.DataFrame([base | row for row in rows])
    return frame.with_columns(
        pl.col("valid_time").cast(pl.Datetime("us", "UTC")),
        pl.col("summer").cast(pl.Int16()),
        pl.col("lead_days").cast(pl.Int8()),
        pl.col("wbgt_fc_reject").cast(pl.Int8()),
        pl.col("wbgt_obs_reject").cast(pl.Int8()),
    )


def hour(n: int) -> datetime:
    return _START + timedelta(hours=n)


def test_the_raw_comparison_scores_models_on_common_rows_and_reports_each_own_count() -> None:
    rows = [
        # hour 0: all three models; errors (forecast minus truth) IFS +1, AIFS +0.5, GFS -1
        {"model": "ecmwf_ifs025", "valid_time": hour(0), "fc_t_c": 31.0, "obs_t_c": 30.0},
        {"model": "ecmwf_aifs025_single", "valid_time": hour(0), "fc_t_c": 30.5, "obs_t_c": 30.0},
        {"model": "gfs_seamless", "valid_time": hour(0), "fc_t_c": 29.0, "obs_t_c": 30.0},
        # hour 1: all three; IFS +3, AIFS +1.5, GFS -3
        {"model": "ecmwf_ifs025", "valid_time": hour(1), "fc_t_c": 33.0, "obs_t_c": 30.0},
        {"model": "ecmwf_aifs025_single", "valid_time": hour(1), "fc_t_c": 31.5, "obs_t_c": 30.0},
        {"model": "gfs_seamless", "valid_time": hour(1), "fc_t_c": 27.0, "obs_t_c": 30.0},
        # hour 2: no AIFS row, so IFS and GFS have an own row that is not a common row
        {"model": "ecmwf_ifs025", "valid_time": hour(2), "fc_t_c": 40.0, "obs_t_c": 30.0},
        {"model": "gfs_seamless", "valid_time": hour(2), "fc_t_c": 40.0, "obs_t_c": 30.0},
        # the 2024 summer and lead 5 are outside the table
        {"model": "ecmwf_ifs025", "valid_time": hour(3), "fc_t_c": 99.0, "obs_t_c": 30.0, "summer": 2024},
        {"model": "ecmwf_ifs025", "valid_time": hour(4), "fc_t_c": 99.0, "obs_t_c": 30.0, "lead_days": 5},
    ]
    result = raw_comparison(_raw_frame(rows))
    assert set(result["summer"]) == {2026}
    assert set(result["lead_days"]) == {1}
    t = {r["model"]: r for r in result.filter(pl.col("target") == "t").to_dicts()}
    assert t["ecmwf_ifs025"]["n_rows"] == 2
    assert t["ecmwf_ifs025"]["n_rows_own"] == 3
    assert t["ecmwf_ifs025"]["mae"] == pytest.approx(2.0)
    assert t["ecmwf_ifs025"]["bias"] == pytest.approx(2.0)
    assert t["ecmwf_aifs025_single"]["mae"] == pytest.approx(1.0)
    assert t["ecmwf_aifs025_single"]["bias"] == pytest.approx(1.0)
    assert t["ecmwf_aifs025_single"]["n_rows_own"] == 2
    assert t["gfs_seamless"]["mae"] == pytest.approx(2.0)
    assert t["gfs_seamless"]["bias"] == pytest.approx(-2.0)
    assert t["gfs_seamless"]["n_days"] == 1  # all the common rows fall on 1 July
    assert result.filter(pl.col("target") == "wbgt")["n_rows"].to_list() == [2, 2, 2]


def test_the_raw_comparison_counts_only_scored_rows_and_never_fills() -> None:
    rows = [
        {"model": m, "valid_time": hour(0), "fc_t_c": 31.0, "obs_t_c": 30.0} for m in ("ecmwf_ifs025", "gfs_seamless")
    ] + [
        # no joint observation: out of t, td and wind; a rejected truth WBGT: out of wbgt
        {
            "model": m,
            "valid_time": hour(1),
            "fc_t_c": 50.0,
            "obs_t_c": 30.0,
            "has_joint_obs": False,
            "wbgt_obs_reject": 3,
        }
        for m in ("ecmwf_ifs025", "gfs_seamless")
    ]
    result = raw_comparison(_raw_frame(rows))
    assert result.filter(pl.col("target") == "t")["n_rows"].to_list() == [1, 1]
    assert result.filter(pl.col("target") == "wbgt")["n_rows"].to_list() == [1, 1]
    assert result.filter(pl.col("target") == "t")["mae"].to_list() == [1.0, 1.0]  # the 20 degree error is not in


def test_the_raw_comparison_of_nothing_is_an_empty_table_with_the_schema() -> None:
    empty = raw_comparison(
        _raw_frame([{"model": "ecmwf_ifs025", "valid_time": _START, "fc_t_c": 1.0, "obs_t_c": 1.0}]).head(0)
    )
    assert empty.height == 0
    assert empty.columns == ["target", "summer", "lead_days", "model", "n_rows", "n_days", "mae", "bias", "n_rows_own"]


# === the series =====================================================================================================


def _series_inputs() -> tuple[pl.DataFrame, dict[Target, F64], dict[Target, F64]]:
    hours = [_START + timedelta(hours=h) for h in (3, 1, 2)]  # not in time order on purpose
    keys = pl.DataFrame(
        {
            "station": ["OMAA", "OMAA", "OMDB"],
            "cluster": ["abu_dhabi", "abu_dhabi", "dubai_sharjah"],
            "valid_time": hours,
            "summer": [2026, 2026, 2026],
            "lead_days": [1, 1, 1],
            "hour_utc": [9, 7, 8],
            **{f"raw_{t.value}": [30.0, float("nan"), 31.0] for t in Target},
        },
        schema={
            "station": pl.String(),
            "cluster": pl.String(),
            "valid_time": pl.Datetime("us", "UTC"),
            "summer": pl.Int16(),
            "lead_days": pl.Int8(),
            "hour_utc": pl.Int8(),
            **{f"raw_{t.value}": pl.Float64() for t in Target},
        },
    )
    grids = {t: np.stack([grid_with_exceedance(30.0, 0.5)] * 3) for t in Target}
    for grid in grids.values():
        grid[1] = np.nan  # the OMAA row at 07 UTC has no forecast
    truths = {t: np.asarray([29.0, 28.0, float("nan")]) for t in Target}
    return keys, grids, truths


def _reference(keys: pl.DataFrame) -> pl.DataFrame:
    """The gold rows of ``keys`` (same identity columns, row for row) with distinct values in every exported column."""
    count = keys.height
    return keys.select("station", "valid_time", "lead_days").with_columns(
        pl.Series("obs_t_c", [30.5 + i for i in range(count)], dtype=pl.Float64),
        pl.Series("obs_td_c", [20.5 + i for i in range(count)], dtype=pl.Float64),
        pl.Series("obs_wind_ms", [3.5 + i for i in range(count)], dtype=pl.Float64),
        pl.Series("wbgt_obs_c", [29.5 + i for i in range(count)], dtype=pl.Float64),
        pl.Series("has_joint_obs", [True, False, True][:count], dtype=pl.Boolean),
        pl.Series("wbgt_obs_reject", [0, 3, 0][:count], dtype=pl.Int8),
        pl.Series("ref_sw_wm2", [800.0 + i for i in range(count)], dtype=pl.Float64),
        pl.Series("ref_direct_wm2", [600.0 + i for i in range(count)], dtype=pl.Float64),
        pl.Series("ref_pressure_hpa", [1000.0 + i for i in range(count)], dtype=pl.Float64),
    )


def test_the_series_is_one_station_one_summer_with_null_for_missing_never_a_number() -> None:
    keys, grids, truths = _series_inputs()
    frame = series_frame(keys, grids, truths, station="OMAA", summer=2026, reference=_reference(keys))
    assert frame.height == 2
    assert frame["hour_utc"].to_list() == [7, 9]  # sorted by time
    assert frame["grid_t"][0] is None  # no forecast: a null array, not a row of NaN
    assert frame["grid_t"][1].to_list() == pytest.approx(list(grid_with_exceedance(30.0, 0.5)))
    assert frame["raw_t"].to_list() == [None, 30.0]
    assert frame["truth_wbgt"].to_list() == [28.0, 29.0]
    assert frame["grid_wbgt"].dtype == pl.Array(pl.Float64, 19)
    assert frame.columns[:6] == ["station", "cluster", "valid_time", "summer", "lead_days", "hour_utc"]
    with pytest.raises(ValueError, match="no row of station OMFJ"):
        series_frame(keys, grids, truths, station="OMFJ", summer=2026, reference=_reference(keys))
    with pytest.raises(ValueError, match="summer 2025"):
        series_frame(keys, grids, truths, station="OMAA", summer=2025, reference=_reference(keys))


def test_the_series_carries_the_gold_truths_flags_and_lead_zero_reference_even_without_a_forecast() -> None:
    """B3's truth WBGT needs ``wbgt_obs_c``, ``has_joint_obs``, ``wbgt_obs_reject`` and ``ref_*`` on every row."""
    keys, grids, truths = _series_inputs()
    reference = _reference(keys)
    frame = series_frame(keys, grids, truths, station="OMAA", summer=2026, reference=reference)

    assert set(SERIES_REFERENCE_COLUMNS) == {
        "obs_t_c",
        "obs_td_c",
        "obs_wind_ms",
        "wbgt_obs_c",
        "has_joint_obs",
        "wbgt_obs_reject",
        "ref_sw_wm2",
        "ref_direct_wm2",
        "ref_pressure_hpa",
    }
    assert set(SERIES_REFERENCE_COLUMNS) <= set(frame.columns)
    # keys' rows are OMAA@09 (index 0), OMAA@07 (index 1), OMDB@08; the series is sorted by time: 07 first
    assert frame["grid_t"][0] is None  # the 07 UTC row has no forecast ...
    assert frame["truth_wbgt"][0] == 28.0
    assert frame["wbgt_obs_c"].to_list() == [30.5, 29.5]  # ... and keeps its gold observation, flags and reference
    assert frame["has_joint_obs"].to_list() == [False, True]
    assert frame["wbgt_obs_reject"].to_list() == [3, 0]
    assert frame["ref_sw_wm2"].to_list() == [801.0, 800.0]
    assert frame["ref_direct_wm2"].to_list() == [601.0, 600.0]
    assert frame["ref_pressure_hpa"].to_list() == [1001.0, 1000.0]
    assert frame["obs_t_c"].to_list() == [31.5, 30.5]
    assert frame["has_joint_obs"].dtype == pl.Boolean
    assert frame["wbgt_obs_reject"].dtype == pl.Int8


def test_the_series_refuses_a_reference_that_is_not_the_rows_of_the_keys() -> None:
    keys, grids, truths = _series_inputs()
    shuffled = _reference(keys).reverse()
    with pytest.raises(ValueError, match="misaligned"):
        series_frame(keys, grids, truths, station="OMAA", summer=2026, reference=shuffled)
    with pytest.raises(ValueError, match="misaligned"):
        series_frame(keys, grids, truths, station="OMAA", summer=2026, reference=_reference(keys).head(2))
    with pytest.raises(ValueError, match=r"lacks the column\(s\) \['ref_sw_wm2'\]"):
        series_frame(keys, grids, truths, station="OMAA", summer=2026, reference=_reference(keys).drop("ref_sw_wm2"))


def test_a_model_missing_one_lead_does_not_empty_the_other_leads_common_rows() -> None:
    """AIFS has rows at lead 1 only: at lead 3 IFS and GFS are still compared on their common rows (not scored 0)."""
    rows = []
    for lead in (1, 3):
        for model in ("ecmwf_ifs025", "gfs_seamless", "ecmwf_aifs025_single"):
            if model == "ecmwf_aifs025_single" and lead == 3:
                continue
            rows.append({"model": model, "valid_time": hour(lead), "lead_days": lead, "fc_t_c": 31.0, "obs_t_c": 30.0})
    result = raw_comparison(_raw_frame(rows)).filter(pl.col("target") == "t")

    cells = {(r["lead_days"], r["model"]): r for r in result.to_dicts()}
    assert set(cells) == {
        (1, "ecmwf_ifs025"),
        (1, "gfs_seamless"),
        (1, "ecmwf_aifs025_single"),
        (3, "ecmwf_ifs025"),
        (3, "gfs_seamless"),
    }
    assert cells[(1, "ecmwf_ifs025")]["n_rows"] == 1
    assert cells[(3, "ecmwf_ifs025")]["n_rows"] == 1  # was 0 with a global model count of 3
    assert cells[(3, "gfs_seamless")]["n_rows"] == 1
    assert cells[(3, "ecmwf_ifs025")]["mae"] == pytest.approx(1.0)


def test_the_series_parquet_carries_its_provenance_and_the_manifest_hashes_its_bytes() -> None:
    keys, grids, truths = _series_inputs()
    frame = series_frame(keys, grids, truths, station="OMAA", summer=2026, reference=_reference(keys))
    provenance = Provenance(
        protocol_path="docs/x.md",
        protocol_anchor="#a",
        script="s",
        function="f",
        git_sha="a" * 40,
        data_sha256="0" * 64,
        model_id="corrector-20261114-ccccccc-000000",
        label=ProvenanceLabel.REAL,
        generated_at=datetime(2026, 11, 15, tzinfo=UTC),
    )
    data = series_parquet_bytes(frame, provenance)
    manifest = series_manifest(frame, file="series.parquet", data=data, command="sb-jobs x", git_sha="a" * 40)
    assert manifest["sha256"] == hashlib.sha256(data).hexdigest()
    assert manifest["rows"] == 2
    assert manifest["command"] == "sb-jobs x"
    names = [column["name"] for column in dig(manifest["columns"])]
    assert names == frame.columns
    back = pl.read_parquet(io.BytesIO(data))
    assert back.equals(frame)
    assert b"corrector-20261114-ccccccc-000000" in data  # the provenance is in the key-value metadata
