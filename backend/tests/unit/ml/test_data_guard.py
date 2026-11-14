"""The 2026 hold-out guard of the loaders (``ml/data.py``): synthetic frames only, never the gold file."""

import hashlib
from pathlib import Path
from typing import Any

import polars as pl
import pytest

from stellar_blaze.domain.forecast.grid import MODEL_LEADS, MODELLED_HOURS_UTC
from stellar_blaze.domain.weather.schemas import GOLD_PAIRS_SCHEMA
from stellar_blaze.ml.data import (
    DEV_SUMMERS,
    TEST_SUMMER,
    HoldoutViolationError,
    load_dev_pairs,
    load_test_pairs,
)
from stellar_blaze.ml.protocol_gate import GateToken, Part, ProtocolLock
from tests.fixtures.forecast.synthetic import make_pairs

pytestmark = pytest.mark.unit

_OTHER_MODEL = "ecmwf_aifs025_single"  # a model the loaders must not return (the generator only makes IFS and GFS)


def _gold_frame() -> pl.DataFrame:
    """Summers 2024-2026, leads 0-2, hours 0-1, 2-15 and 16-23, two stations, and a third model to be filtered out."""
    frame = make_pairs(
        seed=7,
        summers=(2024, 2025, 2026),
        station_bias_c={},
        stations=("OMAA", "OMDB"),
        leads=(0, 1, 2),
        hours_utc=(0, 1, 2, 9, 15, 16, 23),
        summer_days=(1, 2, 3),
    )
    return pl.concat([frame, frame.head(40).with_columns(pl.lit(_OTHER_MODEL).alias("model"))])


@pytest.fixture
def gold(tmp_path: Path) -> tuple[Path, str, pl.DataFrame]:
    frame = _gold_frame()
    path = tmp_path / "pairs.parquet"
    frame.write_parquet(path)
    return path, hashlib.sha256(path.read_bytes()).hexdigest(), frame


def test_the_synthetic_gold_has_everything_the_loader_must_remove(gold: tuple[Path, str, pl.DataFrame]) -> None:
    """The fixture is falsifiable: each filtered dimension has rows on both sides of the filter."""
    _, _, frame = gold
    assert set(frame["summer"].unique()) == {2024, 2025, 2026}
    assert 0 in set(frame["lead_days"].unique())
    assert {0, 1, 16, 23} <= set(frame["hour_utc"].unique())
    assert _OTHER_MODEL in set(frame["model"].unique())
    assert frame.schema == GOLD_PAIRS_SCHEMA


def test_dev_loader_never_returns_2026(gold: tuple[Path, str, pl.DataFrame]) -> None:
    path, sha, frame = gold
    result = load_dev_pairs(path, expected_sha256=sha)
    assert result.height > 0
    assert set(result["summer"].unique()) == {2024, 2025}
    assert set(result["summer"].unique()) <= DEV_SUMMERS
    assert TEST_SUMMER not in set(result["summer"].unique())
    assert 0 not in set(result["lead_days"].unique())
    assert set(result["lead_days"].unique()) == {1, 2}
    assert set(result["hour_utc"].unique()) == {2, 9, 15}
    assert set(result["model"].unique()) == {"ecmwf_ifs025", "gfs_seamless"}
    # The same rows an in-memory filter keeps, in the same order: nothing else is dropped.
    expected = frame.filter(
        pl.col("summer").is_in(sorted(DEV_SUMMERS))
        & pl.col("lead_days").is_in(list(MODEL_LEADS))
        & pl.col("hour_utc").is_in(list(MODELLED_HOURS_UTC))
        & pl.col("model").is_in(["ecmwf_ifs025", "gfs_seamless"])
    )
    assert result.height == expected.height
    assert result.equals(expected)


def test_dev_loader_filters_before_collect(
    gold: tuple[Path, str, pl.DataFrame], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The plan handed to ``collect`` already carries every filter: collecting first would show a bare scan."""
    path, sha, _ = gold
    plans: list[str] = []
    original = pl.LazyFrame.collect

    def capturing_collect(self: pl.LazyFrame, *args: Any, **kwargs: Any) -> pl.DataFrame:
        plans.append(self.explain())
        return original(self, *args, **kwargs)  # type: ignore[no-any-return]

    monkeypatch.setattr(pl.LazyFrame, "collect", capturing_collect)
    load_dev_pairs(path, expected_sha256=sha)
    assert len(plans) == 1
    plan = plans[0]
    assert "Parquet SCAN" in plan
    assert 'col("summer").is_in([[2024, 2025]])' in plan
    assert "2026" not in plan
    for column in ("lead_days", "hour_utc", "model"):
        assert f'col("{column}").is_in(' in plan


def test_dev_loader_rejects_hash_mismatch(
    gold: tuple[Path, str, pl.DataFrame], monkeypatch: pytest.MonkeyPatch
) -> None:
    path, sha, _ = gold
    wrong = "0" * 64

    def scanned(*args: object, **kwargs: object) -> pl.LazyFrame:
        raise AssertionError("the file was scanned before its hash was checked")

    monkeypatch.setattr(pl, "scan_parquet", scanned)
    with pytest.raises(ValueError, match="sha256") as caught:
        load_dev_pairs(path, expected_sha256=wrong)
    assert sha in str(caught.value)
    assert wrong in str(caught.value)


def test_dev_loader_without_expected_hash_skips_the_check(gold: tuple[Path, str, pl.DataFrame]) -> None:
    path, _, _ = gold
    assert load_dev_pairs(path, expected_sha256=None).height > 0


def test_dev_loader_detects_a_filter_that_did_not_hold(
    gold: tuple[Path, str, pl.DataFrame], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The belt: a scan that ignores its filter (polars #30655) must end in ``HoldoutViolationError``, not 2026 rows."""
    path, sha, _ = gold

    def ignoring_filter(self: pl.LazyFrame, *args: Any, **kwargs: Any) -> pl.LazyFrame:
        return self

    monkeypatch.setattr(pl.LazyFrame, "filter", ignoring_filter)
    with pytest.raises(HoldoutViolationError, match="2026"):
        load_dev_pairs(path, expected_sha256=sha)


def test_test_loader_requires_token(gold: tuple[Path, str, pl.DataFrame]) -> None:
    path, sha, _ = gold
    with pytest.raises(TypeError, match="GateToken"):
        load_test_pairs(path, token=object(), expected_sha256=sha)  # type: ignore[arg-type]


def test_test_loader_refuses_none_as_a_token(gold: tuple[Path, str, pl.DataFrame]) -> None:
    path, sha, _ = gold
    with pytest.raises(TypeError, match="GateToken"):
        load_test_pairs(path, token=None, expected_sha256=sha)  # type: ignore[arg-type]


def test_a_gate_token_cannot_be_constructed_directly() -> None:
    lock = ProtocolLock(protocol_path="docs/p.md", protocol_sha256="0" * 64, protocol_commit="a" * 40)
    with pytest.raises(TypeError, match="open_gate"):
        GateToken(part=Part.FORECAST, head="b" * 40, lock=lock)
    with pytest.raises(TypeError, match="open_gate"):
        GateToken(part=Part.FORECAST, head="b" * 40, lock=lock, _key=object())
