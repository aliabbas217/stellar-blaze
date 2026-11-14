"""``load_test_pairs(models=...)``: the raw AIFS comparison needs AIFS rows; nothing else widens (synthetic)."""

import hashlib
from pathlib import Path

import polars as pl
import pytest

from stellar_blaze.ml.data import load_dev_pairs, load_test_pairs
from tests.fixtures.forecast.gated import GatedWorld, gold_with_lead_zero, with_aifs

pytestmark = pytest.mark.unit

FIXTURE_MODELS = Path(__file__).resolve().parents[2] / "fixtures" / "models"
MODEL_ID = "corrector-20261111-0000000-000000"  # in FIXTURE_MODELS (the gate only needs a model that verifies)
_IFS, _GFS, _AIFS = "ecmwf_ifs025", "gfs_seamless", "ecmwf_aifs025_single"


@pytest.fixture
def gold(tmp_path: Path) -> tuple[Path, str, GatedWorld]:
    frame = with_aifs(gold_with_lead_zero())
    path = tmp_path / "pairs.parquet"
    frame.write_parquet(path)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return path, digest, GatedWorld(tmp_path, MODEL_ID, FIXTURE_MODELS, gold_sha256=digest)


def test_the_default_returns_ifs_and_gfs_only(gold: tuple[Path, str, GatedWorld]) -> None:
    path, digest, world = gold
    result = load_test_pairs(path, token=world.token(), expected_sha256=digest)
    assert set(result["model"].unique()) == {_IFS, _GFS}
    assert 2026 in set(result["summer"].unique())


def test_aifs_is_returned_on_request_with_the_same_summer_lead_and_hour_filters(
    gold: tuple[Path, str, GatedWorld],
) -> None:
    path, digest, world = gold
    wide = load_test_pairs(path, token=world.token(), expected_sha256=digest, models=frozenset({_IFS, _GFS, _AIFS}))
    assert set(wide["model"].unique()) == {_IFS, _GFS, _AIFS}
    aifs = wide.filter(pl.col("model") == _AIFS)
    assert set(aifs["summer"].unique()) == {2025, 2026}  # the generator gives AIFS 2025 and 2026 only
    assert 0 not in set(wide["lead_days"].unique())  # lead 0 is still never returned
    assert set(wide["hour_utc"].unique()) <= set(range(2, 16))
    default = load_test_pairs(path, token=world.token(), expected_sha256=digest)
    assert wide.filter(pl.col("model") != _AIFS).equals(default)  # the other rows are exactly the default's
    only = load_test_pairs(path, token=world.token(), expected_sha256=digest, models=frozenset({_AIFS}))
    assert set(only["model"].unique()) == {_AIFS}
    assert only.height == aifs.height


@pytest.mark.parametrize("models", [frozenset({"icon_seamless"}), frozenset({_IFS, "nope"}), frozenset()])
def test_an_unknown_or_empty_model_set_is_refused_before_any_read(
    models: frozenset[str], tmp_path: Path, gold: tuple[Path, str, GatedWorld]
) -> None:
    _, digest, world = gold
    with pytest.raises(ValueError, match="models must be a non-empty subset"):
        # a path that does not exist: a read would raise FileNotFoundError, the refusal comes first
        load_test_pairs(tmp_path / "no-such-file.parquet", token=world.token(), expected_sha256=digest, models=models)


def test_the_development_loader_has_no_models_option_and_never_returns_aifs(
    gold: tuple[Path, str, GatedWorld],
) -> None:
    path, digest, _ = gold
    assert set(load_dev_pairs(path, expected_sha256=digest)["model"].unique()) == {_IFS, _GFS}
    with pytest.raises(TypeError):
        load_dev_pairs(path, expected_sha256=digest, models=frozenset({_AIFS}))  # type: ignore[call-arg]
