"""The training config of a corrector: fixed pre-registered values, validated, and hashed for the model id.

A config is a TOML file under ``backend/training/configs/``. It carries everything that defines a trained corrector
and nothing that is merely operational: the feature set, the 19 levels, the leads and hours, the LightGBM
hyperparameters, the calibration window and the WBGT method. There is no command-line override of any of it (roadmap
section 4): a change is a new file and so a new hash, and the hash is the ``cfg6`` of the model id (ADR 0010).

Names. ``LgbmParams`` uses the scikit-learn API names of the pre-registration (``min_child_samples``,
``n_estimators``). ``ml.quantile_models`` trains through the native ``lightgbm.train`` and maps them to the native
names (``min_data_in_leaf``, ``num_boost_round``).

The pre-registered constants are checked, not trusted: ``levels`` must equal ``grid.LEVELS`` exactly and ``hours_utc``
must be ``MODELLED_HOURS_UTC``, so a mistyped file fails at load rather than training a different model.
"""

import hashlib
import tomllib
from pathlib import Path
from typing import Final, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from stellar_blaze.domain.forecast.features import FeatureSet
from stellar_blaze.domain.forecast.grid import LEVELS, MODEL_LEADS, MODELLED_HOURS_UTC

__all__ = ["LgbmParams", "TrainingConfig", "load_training_config"]

SEED: Final = 20261112
"""The pre-registered seed (section 3.1): LightGBM's and the joint sampler's."""


class _Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)


class LgbmParams(_Frozen):
    """The LightGBM hyperparameters (pre-registration sections 3.1 and 6.1).

    ``num_leaves``, ``min_child_samples`` and ``n_estimators`` are the grid of selection rule 1; the rest are fixed by
    the pre-registration. ``num_threads`` is part of the config because a fixed thread count is what makes
    ``deterministic=True`` reproducible across runs. ``deterministic`` can only be true.
    """

    num_leaves: int = Field(ge=2)
    min_child_samples: int = Field(ge=1)
    n_estimators: int = Field(ge=1)
    learning_rate: float = Field(default=0.05, gt=0.0)
    feature_fraction: float = Field(default=0.8, gt=0.0, le=1.0)
    bagging_fraction: float = Field(default=0.8, gt=0.0, le=1.0)
    bagging_freq: int = Field(default=1, ge=0)
    lambda_l2: float = Field(default=1.0, ge=0.0)
    seed: int = SEED
    num_threads: int = Field(ge=1)
    deterministic: Literal[True]


class TrainingConfig(_Frozen):
    """Everything that defines one trained corrector.

    Attributes:
        name: The config's name (the file stem by convention).
        feature_set: ``site`` (all features) or ``cold`` (no station history).
        levels: The 19 quantile levels; must equal ``grid.LEVELS``.
        leads: The leads to train on, a non-empty duplicate-free subset of ``MODEL_LEADS``.
        hours_utc: The modelled hours; must equal ``MODELLED_HOURS_UTC``.
        lgbm: The LightGBM hyperparameters.
        calibration_window: ``september`` (1-30 Sep) or the 4th, 8th, 12th and 16th week of each summer (rule 4).
        wbgt_method: ``joint`` (copula samples through Liljegren) or ``direct`` (a WBGT quantile model), rule 3.
        n_joint_samples: Joint samples per forecast for the ``joint`` method.
        sample_seed: The seed of the joint sampler.
    """

    name: str = Field(min_length=1)
    feature_set: FeatureSet
    levels: tuple[float, ...]
    leads: tuple[int, ...]
    hours_utc: tuple[int, ...]
    lgbm: LgbmParams
    calibration_window: Literal["september", "weeks_4_8_12_16"]
    wbgt_method: Literal["joint", "direct"]
    n_joint_samples: int = Field(default=50, ge=1)
    sample_seed: int = SEED

    @field_validator("levels")
    @classmethod
    def _levels_are_the_preregistered_grid(cls, value: tuple[float, ...]) -> tuple[float, ...]:
        if value != LEVELS:
            raise ValueError(f"levels must be exactly the 19 pre-registered levels {LEVELS}, got {value}")
        return value

    @field_validator("hours_utc")
    @classmethod
    def _hours_are_the_modelled_hours(cls, value: tuple[int, ...]) -> tuple[int, ...]:
        if value != tuple(MODELLED_HOURS_UTC):
            raise ValueError(f"hours_utc must be the modelled hours {tuple(MODELLED_HOURS_UTC)}, got {value}")
        return value

    @model_validator(mode="after")
    def _leads_are_modelled_and_unique(self) -> Self:
        if not self.leads or len(set(self.leads)) != len(self.leads) or not set(self.leads) <= set(MODEL_LEADS):
            raise ValueError(
                f"leads must be a non-empty, duplicate-free subset of {tuple(MODEL_LEADS)}, got {self.leads}"
            )
        return self


def load_training_config(path: Path) -> tuple[TrainingConfig, str]:
    """Parse and validate a training config, and hash the file.

    The hash is the SHA-256 of the file bytes after CRLF is normalised to LF, so that a checkout on Windows
    (autocrlf) and one on Linux give one ``cfg6`` for one committed file (R20). Any other byte change changes it.

    Returns:
        The validated config and the 64-character lowercase hex SHA-256.

    Raises:
        FileNotFoundError: ``path`` does not exist.
        tomllib.TOMLDecodeError: The file is not TOML.
        pydantic.ValidationError: The content is not a ``TrainingConfig`` (unknown keys are rejected).
    """
    data = path.read_bytes().replace(b"\r\n", b"\n")
    config = TrainingConfig.model_validate(tomllib.loads(data.decode("utf-8")))
    return config, hashlib.sha256(data).hexdigest()
