"""The training config: strict validation, the pre-registered fixed values, and the byte-stable hash (R20)."""

import hashlib
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from stellar_blaze.domain.forecast.features import FeatureSet
from stellar_blaze.domain.forecast.grid import LEVELS, MODEL_LEADS, MODELLED_HOURS_UTC
from stellar_blaze.ml.training_config import LgbmParams, TrainingConfig, load_training_config

pytestmark = pytest.mark.unit

BACKEND = Path(__file__).resolve().parents[3]
SITE_TOML = BACKEND / "training" / "configs" / "corrector-v1.toml"
COLD_TOML = BACKEND / "training" / "configs" / "corrector-cold-v1.toml"

_LEVELS_TEXT = ", ".join(str(level) for level in LEVELS)
_TOML = f"""\
name = "unit"
feature_set = "site"
levels = [{_LEVELS_TEXT}]
leads = [1, 2, 3]
hours_utc = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
calibration_window = "september"
wbgt_method = "joint"

[lgbm]
num_leaves = 7
min_child_samples = 20
n_estimators = 40
num_threads = 2
deterministic = true
"""


def _data(**overrides: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "name": "unit",
        "feature_set": "site",
        "levels": list(LEVELS),
        "leads": [1, 2, 3],
        "hours_utc": list(MODELLED_HOURS_UTC),
        "lgbm": {"num_leaves": 7, "min_child_samples": 20, "n_estimators": 40, "num_threads": 2, "deterministic": True},
        "calibration_window": "september",
        "wbgt_method": "joint",
    }
    return {**data, **overrides}


def _write(path: Path, text: str, *, newline: str) -> Path:
    path.write_bytes(text.replace("\n", newline).encode("utf-8"))
    return path


# === validation =====================================================================================================


def test_config_accepts_the_minimal_valid_document() -> None:
    cfg = TrainingConfig.model_validate(_data())
    assert cfg.feature_set is FeatureSet.SITE
    assert cfg.levels == LEVELS
    assert cfg.lgbm.learning_rate == 0.05
    assert cfg.lgbm.seed == 20261112
    assert cfg.n_joint_samples == 50
    assert cfg.sample_seed == 20261112


def test_config_rejects_unknown_key() -> None:
    with pytest.raises(ValidationError, match="extra_forbidden"):
        TrainingConfig.model_validate(_data(surprise=1))
    lgbm = {**_data()["lgbm"], "max_depth": 3}
    with pytest.raises(ValidationError, match="extra_forbidden"):
        TrainingConfig.model_validate(_data(lgbm=lgbm))


def test_config_rejects_wrong_levels() -> None:
    with pytest.raises(ValidationError, match="levels"):
        TrainingConfig.model_validate(_data(levels=[0.1, 0.5, 0.9]))
    shifted = [*LEVELS[:-1], 0.96]
    with pytest.raises(ValidationError, match="levels"):
        TrainingConfig.model_validate(_data(levels=shifted))
    with pytest.raises(ValidationError, match="levels"):
        TrainingConfig.model_validate(_data(levels=list(reversed(LEVELS))))


def test_config_rejects_wrong_hours() -> None:
    with pytest.raises(ValidationError, match="hours_utc"):
        TrainingConfig.model_validate(_data(hours_utc=list(range(0, 24))))


@pytest.mark.parametrize("leads", [[0, 1], [1, 8], [], [1, 1, 2]])
def test_config_rejects_leads_outside_the_modelled_leads(leads: list[int]) -> None:
    with pytest.raises(ValidationError, match="leads"):
        TrainingConfig.model_validate(_data(leads=leads))


def test_config_rejects_bad_choices_and_non_deterministic_training() -> None:
    with pytest.raises(ValidationError):
        TrainingConfig.model_validate(_data(calibration_window="october"))
    with pytest.raises(ValidationError):
        TrainingConfig.model_validate(_data(wbgt_method="both"))
    with pytest.raises(ValidationError):
        TrainingConfig.model_validate(_data(feature_set="everything"))
    with pytest.raises(ValidationError):
        TrainingConfig.model_validate(_data(lgbm={**_data()["lgbm"], "deterministic": False}))


@pytest.mark.parametrize(
    ("field", "value"),
    [("num_leaves", 1), ("min_child_samples", 0), ("n_estimators", 0), ("num_threads", 0), ("learning_rate", 0.0)],
)
def test_lgbm_params_reject_degenerate_values(field: str, value: float) -> None:
    with pytest.raises(ValidationError):
        LgbmParams.model_validate({**_data()["lgbm"], field: value})


def test_config_is_frozen() -> None:
    cfg = TrainingConfig.model_validate(_data())
    with pytest.raises(ValidationError, match="frozen"):
        cfg.name = "other"  # type: ignore[misc]


# === the hash (R20) =================================================================================================


def test_config_hash_is_file_bytes(tmp_path: Path) -> None:
    path = _write(tmp_path / "lf.toml", _TOML, newline="\n")
    cfg, digest = load_training_config(path)
    assert cfg.name == "unit"
    assert digest == hashlib.sha256(_TOML.encode("utf-8")).hexdigest()


def test_config_hash_ignores_the_checkout_line_endings(tmp_path: Path) -> None:
    lf = _write(tmp_path / "lf.toml", _TOML, newline="\n")
    crlf = _write(tmp_path / "crlf.toml", _TOML, newline="\r\n")
    assert b"\r\n" in crlf.read_bytes()
    assert b"\r" not in lf.read_bytes()
    cfg_lf, hash_lf = load_training_config(lf)
    cfg_crlf, hash_crlf = load_training_config(crlf)
    assert hash_lf == hash_crlf
    assert cfg_lf == cfg_crlf


def test_config_hash_changes_with_one_character(tmp_path: Path) -> None:
    base = _write(tmp_path / "base.toml", _TOML, newline="\n")
    changed = _write(tmp_path / "changed.toml", _TOML.replace("num_leaves = 7", "num_leaves = 8"), newline="\n")
    _, base_hash = load_training_config(base)
    _, changed_hash = load_training_config(changed)
    assert base_hash != changed_hash
    assert len(base_hash) == 64


def test_load_rejects_unknown_key_in_file(tmp_path: Path) -> None:
    path = _write(tmp_path / "bad.toml", _TOML + "learning_rate_override = 0.5\n", newline="\n")
    # the stray key lands in the [lgbm] table: unknown there too
    with pytest.raises(ValidationError, match="extra_forbidden"):
        load_training_config(path)


# === the shipped files ==============================================================================================


def test_shipped_configs_validate_and_differ_only_in_name() -> None:
    # After the pre-registered selection (rule 6.2 chose `cold`), corrector-v1 and corrector-cold-v1 carry the same
    # settings; only the name (and so the file hash and the cfg6 of a model id) differs.
    main, main_hash = load_training_config(SITE_TOML)
    cold, cold_hash = load_training_config(COLD_TOML)
    assert main.feature_set is FeatureSet.COLD
    assert cold.feature_set is FeatureSet.COLD
    assert main_hash != cold_hash
    assert main.model_dump(exclude={"name"}) == cold.model_dump(exclude={"name"})
    assert main.name == "corrector-v1"
    assert cold.name == "corrector-cold-v1"


@pytest.mark.parametrize("path", [SITE_TOML, COLD_TOML], ids=["v1", "cold-v1"])
def test_shipped_configs_hold_the_selected_configuration(path: Path) -> None:
    # The values selection.json recorded on 2024-2025 (6.1 grid point, 6.2 cold, 6.3 joint, 6.4 weeks window).
    cfg, _ = load_training_config(path)
    assert cfg.levels == LEVELS  # exact doubles, as round(k * 0.05, 2)
    assert cfg.leads == tuple(MODEL_LEADS)
    assert cfg.hours_utc == tuple(MODELLED_HOURS_UTC)
    assert cfg.calibration_window == "weeks_4_8_12_16"
    assert cfg.wbgt_method == "joint"
    assert cfg.lgbm.num_leaves == 7
    assert cfg.lgbm.min_child_samples == 1000
    assert cfg.lgbm.n_estimators == 150
    assert cfg.lgbm.learning_rate == 0.05
    assert cfg.lgbm.feature_fraction == 0.8
    assert cfg.lgbm.bagging_fraction == 0.8
    assert cfg.lgbm.bagging_freq == 1
    assert cfg.lgbm.lambda_l2 == 1.0
    assert cfg.lgbm.seed == 20261112
    assert cfg.lgbm.num_threads == 8
    assert cfg.lgbm.deterministic is True
    assert cfg.n_joint_samples == 50
    assert cfg.sample_seed == 20261112


@pytest.mark.parametrize("path", [SITE_TOML, COLD_TOML], ids=["site", "cold"])
def test_shipped_configs_are_stored_with_lf_newlines(path: Path) -> None:
    data = path.read_bytes()
    assert b"\r" not in data
    assert data.endswith(b"\n")
