"""What ``sb-jobs train`` derives from finished work: the release smoke check and the headline dev metrics.

``release_smoke_check`` is the degenerate-model guard of a ``--release``: a corrector whose calibrated median equals the
raw forecast on every sampled row of a target has learned (and calibrated) nothing for it, and must not be released.
``loco_headline_metrics`` turns the ``dev_skill.json`` of ``evaluate-dev`` into the few numbers a model manifest and
card carry; every number comes from the file by code, and a number the file does not hold is left out, never filled.

Training-side code: it imports ``stellar_blaze.ml`` and so is only reached from inside a command body.
"""

import math
from collections.abc import Mapping
from typing import Final

import numpy as np
import polars as pl

from stellar_blaze.domain.forecast.features import FeatureSet, Target, build_features, history_features
from stellar_blaze.domain.forecast.grid import LEVELS
from stellar_blaze.ml.predict import corrected_grids
from stellar_blaze.ml.train import TrainedCorrector

__all__ = [
    "MEDIAN_TOLERANCE",
    "SMOKE_SAMPLE_ROWS",
    "SMOKE_SUMMER",
    "DegenerateModelError",
    "loco_headline_metrics",
    "release_smoke_check",
]

SMOKE_SAMPLE_ROWS: Final = 2000
"""The most training rows the smoke check predicts."""

SMOKE_SUMMER: Final = 2025
"""The summer the smoke sample is drawn from (a development summer: never 2026)."""

MEDIAN_TOLERANCE: Final = 1e-9
"""A corrected median within this of the raw forecast counts as equal to it."""

_MEDIAN: Final = LEVELS.index(0.5)
_CHECKED: Final = (Target.T, Target.TD, Target.WIND)
_HEADLINE_LEADS: Final = (1, 2, 3)
_HEADLINE_TARGETS: Final = tuple(target.value for target in Target)
_HEADLINE_MODELS: Final = ("corrector", "b0", "b2d")


class DegenerateModelError(ValueError):
    """The corrector leaves the raw forecast unchanged on every sampled row of a target (or there is no sample)."""


def release_smoke_check(
    trained: TrainedCorrector, pairs: pl.DataFrame, *, max_rows: int = SMOKE_SAMPLE_ROWS, summer: int = SMOKE_SUMMER
) -> dict[str, float]:
    """Predict a deterministic sample of ``summer``'s rows and refuse a corrector that changes nothing.

    The sample is the modelled IFS rows of ``summer`` in ``pairs`` sorted by station, time and lead, thinned by a fixed
    stride to at most ``max_rows``; the same ``pairs`` always give the same rows. Features are built with the
    corrector's own fold statistics (and the station history for the ``site`` set), as in training.

    Args:
        trained: The corrector to check.
        pairs: The gold-shaped rows it was trained on (history needs the days before the sampled ones).
        max_rows: At most this many rows are predicted.
        summer: The summer to sample.

    Returns:
        Per target (``t``, ``td``, ``wind``) the mean absolute difference between the corrected median and the raw
        forecast over the sampled rows that have both.

    Raises:
        DegenerateModelError: There is no usable row of ``summer``, or for some target of t, td and wind the corrected
            median is within ``MEDIAN_TOLERANCE`` of the raw forecast on every usable row.
    """
    cfg = trained.cfg
    history = history_features(pairs) if cfg.feature_set is FeatureSet.SITE else None
    frame = build_features(pairs, feature_set=cfg.feature_set, stats=trained.stats, history=history).filter(
        pl.col("hour_block").is_not_null() & (pl.col("summer") == summer)
    )
    if frame.height == 0:
        raise DegenerateModelError(f"no modelled row of summer {summer} to smoke-check the model on")
    ordered = frame.sort("station", "valid_time", "lead_days")
    sample = ordered.gather_every(math.ceil(ordered.height / max_rows))
    grids = corrected_grids(trained, sample)
    shifts: dict[str, float] = {}
    unchanged: list[str] = []
    for target in _CHECKED:
        raw = sample[f"raw_{target.value}"].cast(pl.Float64()).fill_null(float("nan")).to_numpy()
        difference = np.abs(grids[target][:, _MEDIAN] - raw)
        usable = np.isfinite(difference)
        if not usable.any() or bool((difference[usable] < MEDIAN_TOLERANCE).all()):
            unchanged.append(target.value)
        else:
            shifts[target.value] = float(difference[usable].mean())
    if unchanged:
        raise DegenerateModelError(
            f"the corrected median equals the raw forecast on every one of the {sample.height} sampled rows of summer "
            f"{summer} for {', '.join(unchanged)} (or no sampled row has a finite value): the model corrects nothing "
            "for them; refusing to release it"
        )
    return shifts


def loco_headline_metrics(dev_skill: Mapping[str, object]) -> dict[str, dict[str, float]]:
    """``{"loco_crps_<target>": {"corrector": x, "b0": y, "b2d": z}}`` from the ``skill`` table of ``dev_skill.json``.

    The CRPS (B0's is its MAE) at leads 1, 2 and 3 over the working daytime, pooled over the three leads by the number
    of scored rows of each, so it equals the CRPS of the three leads taken together. A target is left out when its
    table holds no row for one of the three leads, a lead has no scored row, or any of the three numbers is missing:
    nothing is invented.

    Args:
        dev_skill: The parsed ``dev_skill.json`` (``skill`` is ``{"columns": [...], "rows": [[...]]}``).

    Returns:
        The metrics, possibly empty. Values are finite.

    Raises:
        ValueError: ``dev_skill`` has no ``skill`` table in the expected shape.
    """
    table = dev_skill.get("skill")
    if not isinstance(table, Mapping):
        raise ValueError("dev_skill has no 'skill' table")
    columns, rows = table.get("columns"), table.get("rows")
    if not isinstance(columns, list) or not isinstance(rows, list):
        raise ValueError("dev_skill 'skill' is not {'columns': [...], 'rows': [...]}")
    needed = ["target", "lead_days", "hour_block", "n_rows", *(f"crps_{model}" for model in _HEADLINE_MODELS)]
    absent = [name for name in needed if name not in columns]
    if absent:
        raise ValueError(f"dev_skill 'skill' lacks the columns {absent}")
    records = [dict(zip(columns, row, strict=False)) for row in rows if isinstance(row, list)]
    metrics: dict[str, dict[str, float]] = {}
    for target in _HEADLINE_TARGETS:
        by_lead = {
            lead: record
            for record in records
            if record["target"] == target
            and record["hour_block"] == "working"
            and (lead := record["lead_days"]) in _HEADLINE_LEADS
        }
        if set(by_lead) != set(_HEADLINE_LEADS):
            continue
        weights = [_number(by_lead[lead]["n_rows"]) for lead in _HEADLINE_LEADS]
        pooled: dict[str, float] = {}
        for model in _HEADLINE_MODELS:
            values = [_number(by_lead[lead][f"crps_{model}"]) for lead in _HEADLINE_LEADS]
            if None in values or None in weights:
                break
            pairs = list(zip(values, weights, strict=True))
            if any(w <= 0 for w in weights if w is not None):  # a lead with no scored row: not a lead 1-3 number
                break
            total = sum(w for _, w in pairs if w is not None)
            pooled[model] = sum(v * w for v, w in pairs if v is not None and w is not None) / total
        else:
            metrics[f"loco_crps_{target}"] = pooled
    return metrics


def _number(value: object) -> float | None:
    """``value`` as a finite float, or ``None`` for a null, a boolean or anything that is not a finite number."""
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        return None
    return float(value)
