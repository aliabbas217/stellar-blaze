"""A rehearsal of the gated forecast scoring on REAL schema, dtypes and volume, using development data only.

``evaluate_forecast_test`` is meant to run once on the 2026 hold-out and takes about an hour; a crash late in it would
discard the hour and invite a patch under the once-only rule. This test runs the same function, with the real
configuration (the released model, the real default bootstrap of 2,000 replicates, all six clusters), on a frame that
is built from the 2024-2025 gold rows only:

* the rows come through ``load_dev_pairs`` and nothing else reads the gold file; 2026 never reaches memory;
* 2025 plays the test summer: its rows are cloned with the year shifted to 2026 (``valid_time`` plus one year; 2025 and
  2026 are both non-leap years, so ``doy``, ``hour_utc`` and the calendar stay consistent) and labelled ``summer`` 2026;
* the released model was trained on 2025 too (and its calibration window is in 2025), so every NUMBER this run
  produces is meaningless as skill: only the completion, the schema and the cost mean anything;
* the token is minted in a temporary world with a fake git reader (``tests/fixtures/forecast/gated.py``): nothing in
  this test opens the real gate or the real result directory, and everything it writes goes to the pytest temp
  directory.

It asserts that the run completes, that every pre-registration 7.1 key is present for both regimes and that no NaN would
be written; elapsed seconds and peak resident memory are printed (and not asserted) for the controller to read before
the real run. It skips when the gold file is absent.
"""

import importlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl
import pytest

from stellar_blaze.adapters.config.models import scan_models
from stellar_blaze.domain.forecast.features import Target
from stellar_blaze.domain.weather.dataset import GoldManifest
from stellar_blaze.jobs.evaluate_2026 import EXPECTED_CLUSTERS, EXPECTED_STATIONS, read_dev_tercile_edges
from stellar_blaze.ml.data import TEST_SUMMER, load_dev_pairs
from stellar_blaze.ml.forecast_test import check_test_coverage, evaluate_forecast_test
from stellar_blaze.ml.serving_path import cold_config, released_training_config
from tests.fixtures.forecast.gated import GatedWorld
from tests.fixtures.forecast.skill_keys import REQUIRED_SKILL_COLUMNS

_GOLD = Path(os.environ.get("SB_DATA_DIR", "data")) / "gold"
_PAIRS = _GOLD / "pairs.parquet"
_BACKEND = Path(__file__).resolve().parents[2]
_DEV_SKILL = _BACKEND.parent / "artifacts" / "eval" / "dev" / "dev_skill.json"
_FALLBACK_EDGES = (27.0, 30.0)

pytestmark = [pytest.mark.regression, pytest.mark.slow]
_NEEDS_GOLD = pytest.mark.skipif(not _PAIRS.is_file(), reason=f"gold dataset not built: {_PAIRS.resolve()}")


def _peak_rss_windows() -> float:
    """``PeakWorkingSetSize`` of this process in MiB (``GetProcessMemoryInfo``); NaN when the call fails."""
    import ctypes
    from ctypes import wintypes

    class Counters(ctypes.Structure):
        _fields_ = (
            ("cb", wintypes.DWORD),
            ("PageFaultCount", wintypes.DWORD),
            ("PeakWorkingSetSize", ctypes.c_size_t),
            ("WorkingSetSize", ctypes.c_size_t),
            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
            ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
            ("PagefileUsage", ctypes.c_size_t),
            ("PeakPagefileUsage", ctypes.c_size_t),
        )

    counters = Counters()
    counters.cb = ctypes.sizeof(Counters)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    psapi.GetProcessMemoryInfo.argtypes = (wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD)
    if not psapi.GetProcessMemoryInfo(kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
        return float("nan")
    return float(counters.PeakWorkingSetSize) / 2**20


def _peak_rss_mib() -> float:
    """The peak resident set of this process in MiB (``ru_maxrss``: KiB on Linux, bytes on macOS)."""
    if os.name == "nt":  # not sys.platform: mypy would treat the POSIX branch as unreachable on Windows
        return _peak_rss_windows()
    resource = importlib.import_module("resource")  # absent on Windows, so not a static import
    peak = float(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    return peak / (2**20 if sys.platform == "darwin" else 2**10)


def _rehearsal_frame(dev: pl.DataFrame) -> pl.DataFrame:
    """The development rows plus a copy of 2025 relabelled as the test summer (see the module docstring)."""
    clone = dev.filter(pl.col("summer") == 2025).with_columns(
        pl.col("valid_time").dt.offset_by("1y"), pl.lit(TEST_SUMMER, dtype=pl.Int16).alias("summer")
    )
    return pl.concat([dev, clone])


@_NEEDS_GOLD
def test_the_gated_scoring_completes_on_real_dev_rows_and_reports_its_cost(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    manifest = GoldManifest.model_validate_json((_GOLD / "manifest.json").read_bytes())
    dev = load_dev_pairs(_PAIRS, expected_sha256=manifest.output.sha256)  # the only read of the gold file
    assert set(dev["summer"].unique().to_list()) == {2024, 2025}
    pairs = _rehearsal_frame(dev)
    del dev
    clone = pairs.filter(pl.col("summer") == TEST_SUMMER)
    assert clone.height > 0
    assert clone["valid_time"].dt.year().unique().to_list() == [TEST_SUMMER]  # the calendar moved with the label
    check_test_coverage(
        pairs,
        clusters=EXPECTED_CLUSTERS,
        stations=EXPECTED_STATIONS,
        models={"ecmwf_ifs025", "gfs_seamless"},
    )

    models_dir = _BACKEND / "models"
    registry = scan_models(models_dir)
    if not registry.ids():
        pytest.skip(f"no released model in {models_dir}")
    model = registry.get(registry.ids()[-1])
    world = GatedWorld(tmp_path, model.manifest.model_id, models_dir)  # fake git, temp tree: not the real gate
    token = world.token()
    edges = read_dev_tercile_edges(_DEV_SKILL) if _DEV_SKILL.is_file() else _FALLBACK_EDGES

    started = time.perf_counter()
    result = evaluate_forecast_test(
        pairs,
        model=model,
        cold_cfg=cold_config(released_training_config(model)[0]),
        token=token,
        dev_tercile_edges=edges,
    )
    elapsed = time.perf_counter() - started
    with capsys.disabled():
        print(  # noqa: T201  (the numbers the controller needs; a test has no other channel for them)
            f"\nrehearsal of the gated scoring on 2024-2025 dev rows (numbers mean nothing): "
            f"{elapsed:.0f} s elapsed, peak RSS {_peak_rss_mib():.0f} MiB, {clone.height} rehearsal-test rows"
        )

    skill: Any = result.skill  # a JSON document, navigated by key
    assert set(skill["regimes"]) == {"a", "c", "b_all"}
    for name in ("a", "c"):
        payload = skill["regimes"][name]
        columns = payload["skill"]["columns"]
        assert set(columns) >= REQUIRED_SKILL_COLUMNS, sorted(REQUIRED_SKILL_COLUMNS - set(columns))
        assert payload["skill"]["rows"]
        for table in ("by_cluster", "by_station", "fallbacks"):
            assert payload[table]["rows"], table
    assert result.skill["notes"]
    # No NaN is written: the writers refuse non-finite floats (allow_nan=False), so do the same here.
    json.dumps(result.skill, allow_nan=False)
    json.dumps(result.reliability, allow_nan=False)
    for target in Target:  # a series row has a finite grid or none, never a row of NaN
        grids = result.series[f"grid_{target.value}"].drop_nulls()
        assert grids.len() > 0
        assert np.isfinite(grids.to_numpy()).all()
    assert result.series.height > 0
