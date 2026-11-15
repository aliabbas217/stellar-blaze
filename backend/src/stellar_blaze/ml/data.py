"""The only readers of the gold pair file, and the 2026 hold-out guard (pre-registration sections 2.3 and 9).

The gold pair dataset holds three summers. 2024 and 2025 are the development data; 2026 is the hold-out and may only be
read by the gated evaluation. Every read of the gold file goes through one of two functions:

* ``load_dev_pairs`` returns 2024-2025 and cannot return 2026: the filter runs inside the lazy scan, before ``collect``,
  and the collected frame is checked again (polars 2.1.0 had a silent Parquet-filter regression, polars #30655, so the
  check after the collect is the belt to the filter's braces);
* ``load_test_pairs`` also returns 2026, and only to a caller holding a ``GateToken`` from
  ``stellar_blaze.ml.protocol_gate.open_gate`` for the right part.

No other code path may produce a frame with ``summer == 2026`` from the gold file. Both loaders hash the file before
reading any row, so a changed file is refused rather than scored.

"""

import hashlib
from collections.abc import Collection
from pathlib import Path
from typing import Final

import polars as pl

from stellar_blaze.domain.forecast.grid import MODEL_LEADS, MODELLED_HOURS_UTC
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.schemas import GOLD_PAIRS_SCHEMA, conform
from stellar_blaze.ml.protocol_gate import GateToken, Part

__all__ = [
    "DEV_SUMMERS",
    "TEST_SUMMER",
    "HoldoutViolationError",
    "load_dev_pairs",
    "load_test_pairs",
    "read_oof_samples",
]

DEV_SUMMERS: Final = frozenset({2024, 2025})
"""The development summers: training, tuning and calibration data."""

TEST_SUMMER: Final = 2026
"""The hold-out summer: read only through ``load_test_pairs`` with a gate token."""

_MODELS: Final = (NwpModel.ECMWF_IFS025.value, NwpModel.GFS_SEAMLESS.value)
_TEST_MODELS_ALLOWED: Final = frozenset({*_MODELS, NwpModel.ECMWF_AIFS025.value})
"""The models ``load_test_pairs`` may return: the two corrector models and raw AIFS (the 7.1 raw comparison)."""


class HoldoutViolationError(RuntimeError):
    """A read of the gold file would expose (or did expose) data the caller may not see."""


def _file_sha256(path: Path) -> str:
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def _verify_sha256(path: Path, expected: str) -> None:
    """Hash the whole file and compare, before any row is read.

    Raises:
        ValueError: The file's SHA-256 is not ``expected``; the message names both.
    """
    actual = _file_sha256(path)
    if actual != expected.lower():
        raise ValueError(f"{path} has sha256 {actual}, expected {expected.lower()}")


def _load(path: Path, *, summers: frozenset[int], models: Collection[str] = _MODELS) -> pl.DataFrame:
    """The modelled rows of ``summers`` and ``models``: filtered inside the lazy scan, checked again after the collect.

    Raises:
        HoldoutViolationError: The collected frame holds a summer outside ``summers`` or a model outside ``models``.
        stellar_blaze.domain.weather.schemas.SchemaMismatchError: The file is not ``GOLD_PAIRS_SCHEMA``.
    """
    # glob=False: a path is a path, never a pattern (B1's parquet store reads the same way).
    lazy = pl.scan_parquet(path, glob=False).filter(
        pl.col("summer").is_in(sorted(summers))
        & pl.col("lead_days").is_in(list(MODEL_LEADS))
        & pl.col("hour_utc").is_in(list(MODELLED_HOURS_UTC))
        & pl.col("model").is_in(sorted(models))
    )
    frame = conform(lazy.collect(), GOLD_PAIRS_SCHEMA)
    present = {int(summer) for summer in frame["summer"].unique().to_list()}
    if not present <= summers:
        raise HoldoutViolationError(
            f"the collected frame holds summers {sorted(present - summers)} outside {sorted(summers)}: "
            "the summer filter did not hold"
        )
    stray_models = {str(model) for model in frame["model"].unique().to_list()} - set(models)
    if stray_models:
        raise HoldoutViolationError(
            f"the collected frame holds models {sorted(stray_models)} outside {sorted(models)}: "
            "the model filter did not hold"
        )
    return frame


def load_dev_pairs(path: Path, *, expected_sha256: str | None) -> pl.DataFrame:
    """The development rows of the gold pair file: summers 2024-2025, leads 1-7, UTC hours 02-15, IFS and GFS.

    The filters run inside the lazy scan, before ``collect``; 2026 never reaches memory.

    Args:
        path: The gold ``pairs.parquet``.
        expected_sha256: The file's SHA-256 (lowercase hex). ``None`` skips the check; the CLI always passes it.

    Returns:
        A ``GOLD_PAIRS_SCHEMA`` frame.

    Raises:
        ValueError: ``expected_sha256`` is given and the file hashes to something else (nothing is read).
        HoldoutViolationError: The collected frame holds a summer other than 2024 and 2025.
    """
    if expected_sha256 is not None:
        _verify_sha256(path, expected_sha256)
    return _load(path, summers=DEV_SUMMERS)


def load_test_pairs(
    path: Path,
    *,
    token: GateToken,
    part: Part = Part.FORECAST,
    expected_sha256: str,
    models: frozenset[str] = frozenset(_MODELS),
) -> pl.DataFrame:
    """The rows of the gold pair file including the 2026 hold-out, for the gated evaluation only.

    The same filters as ``load_dev_pairs`` with ``summer`` in 2024, 2025 and 2026. The caller must hold a
    ``GateToken`` that ``open_gate`` issued for ``part``; the token's lock pins the one gold file that may be read
    (``gold_sha256``). Every refusal happens before the file is read.

    Args:
        path: The gold ``pairs.parquet``.
        token: The token ``open_gate`` returned.
        part: The part being evaluated; it must be the token's part.
        expected_sha256: The file's SHA-256 (lowercase hex); required, and it must equal the lock's ``gold_sha256``.
        models: The ``model`` values to return: ``ecmwf_ifs025`` and ``gfs_seamless`` (the default), and
            ``ecmwf_aifs025_single``, which the raw comparison of pre-registration 7.1 needs. The development loader
            has no such option: it returns the first two only.

    Returns:
        A ``GOLD_PAIRS_SCHEMA`` frame.

    Raises:
        TypeError: ``token`` is not exactly a ``GateToken`` (a ``GateToken`` cannot be built outside ``open_gate``, and
            it cannot be subclassed).
        ValueError: ``models`` is empty or names a model other than the three above (nothing is read).
        HoldoutViolationError: The token is for a different part, its lock has no ``gold_sha256``, ``expected_sha256``
            is not the lock's value, the file hashes to something other than the lock's value, or the collected
            frame holds a summer outside 2024-2026.
    """
    if type(token) is not GateToken:
        raise TypeError(f"token must be a GateToken from open_gate, got {type(token).__name__}")
    unknown = sorted(models - _TEST_MODELS_ALLOWED)
    if unknown or not models:
        raise ValueError(
            f"models must be a non-empty subset of {sorted(_TEST_MODELS_ALLOWED)}, got {sorted(models)}"
            + (f" (unknown: {unknown})" if unknown else "")
        )
    if token.part != part:
        raise HoldoutViolationError(f"the gate token is for part {token.part.value!r}, not {part.value!r}")
    pinned = token.lock.gold_sha256
    if pinned is None:
        raise HoldoutViolationError("the token's lock has no gold_sha256: the gold file is not pinned")
    if expected_sha256.lower() != pinned:
        raise HoldoutViolationError(f"expected_sha256 {expected_sha256.lower()} is not the lock's gold_sha256 {pinned}")
    actual = _file_sha256(path)
    if actual != pinned:
        raise HoldoutViolationError(f"{path} has sha256 {actual}, the lock's gold_sha256 is {pinned}")
    return _load(path, summers=DEV_SUMMERS | {TEST_SUMMER}, models=models)


def read_oof_samples(path: Path) -> pl.DataFrame:
    """The dev export ``oof_samples_abu_dhabi.parquet`` as written (2024-2025 out-of-fold samples; no 2026 row).

    A plain read: the consumers (``ml.theta``, the dev scoreboards) refuse a 2026 row themselves, so the file is
    checked where it is used, not here.

    Raises:
        OSError: The file cannot be read.
        polars.exceptions.PolarsError: It is not a Parquet file.
    """
    return pl.read_parquet(path)
