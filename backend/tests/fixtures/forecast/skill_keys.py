"""The columns of a regime's skill table that pre-registration 7.1 requires (shared by the unit and rehearsal tests)."""

from typing import Final

from stellar_blaze.ml.evaluate import BRIER_THRESHOLDS_C

__all__ = ["BASELINES", "MODELS", "REQUIRED_SKILL_COLUMNS"]

MODELS: Final = ("corrector", "b0", "b0d", "b2d", "b3d", "b4")
BASELINES: Final = ("b0", "b0d", "b2d", "b3d", "b4")
REQUIRED_SKILL_COLUMNS: Final = frozenset(
    {
        "target",
        "lead_days",
        "hour_block",
        "n_rows",
        "n_days",
        "n_no_truth",
        "n_no_forecast",
        *(f"{metric}_{model}" for model in MODELS for metric in ("crps", "mae", "rmse", "bias")),
        *("pinball_05", "pinball_50", "pinball_95", "is_90", "is_80", "cov_90", "cov_80", "cov_50"),
        *(f"pit_{i:02d}" for i in range(10)),
        *(f"events_{t:.0f}" for t in BRIER_THRESHOLDS_C),
        *(f"brier_{name}_{t:.0f}" for t in BRIER_THRESHOLDS_C for name in ("c", "b2d", "clim")),
        *(f"bss_{pair}_{t:.0f}" for t in BRIER_THRESHOLDS_C for pair in ("c_clim", "c_b2d", "b2d_clim")),
        *(f"crps_diff_{b}{suffix}" for b in BASELINES for suffix in ("", "_lo", "_hi")),
    }
)
"""Every skill-table column of the 7.1 content: counts, per-model scores, intervals, PIT, Brier, BSS, bootstrap."""
