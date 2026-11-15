"""The warning thresholds under pre-registration 6.5 (``sb-jobs freeze theta``): theta_protect and theta_balanced.

Input: B2's out-of-fold joint samples of the held-out abu_dhabi fold (``oof_samples_abu_dhabi.parquet``, 2024-2025, lead
1, 06-14 UTC). The rule, exactly as written in 6.5 and as clarified for the freeze addendum:

* P(High) of an hour is the share of its FINITE samples whose effective TWL is in the High or Red zone (the product's
  own level rule, ADR 0046: a share that equals theta warns). Truth High is the observed TWL (observed T, Td and wind
  with the lead-0 radiation and pressure, assumption A2) in the same zones. Both use the frozen margin and the ruleset's
  withdrawal switch (``ae-heat-2026.1``: 7 W/m2, off). A row without a finite sample or without a fully observed truth
  is not scored and not imputed.
* **Weighting (clarification).** 6.5 says "POD for truth-High hours" and does not mention the ban. This module weights
  every hour by its non-ban fraction (``hour_ban_weight``, the worked-hour weighting of 7.2), because a warning is only
  worth anything on a worked hour and the 2026 Warnings row counts hours that way. In the ban season the hours 09 and
  10 UTC then weigh 0 and 08 UTC weighs 0.5. This is stated in the freeze addendum; it is the one reading of 6.5 the
  freeze has to fix.
* The grid is theta in {0.05, 0.10, ..., 0.95}; a policy warns an hour when ``P(High) >= theta``.
* theta_protect is the LARGEST theta whose weighted POD is at least 0.90 (0.05 when none is). theta_balanced is the
  theta with the largest Peirce skill score POD - POFD; ties (equal to 12 decimals) go to the smaller theta.
* Conventions where a ratio has no denominator: FAR is 0.0 when no hour is warned. POD needs a truth danger hour and
  POFD a truth non-danger hour, else the selection is refused (``ValueError``).

``red_hour_share`` is the weighted share of scored truth hours in Red, for the freeze addendum (information only,
ADR 0046). The comparison ``POD >= 0.90`` uses a ratio of sums of weights that are exact in binary (0, 0.5, 1), so a POD
of exactly 0.9 is not lost to rounding.
"""

from datetime import UTC
from typing import Final
from zoneinfo import ZoneInfo

import numpy as np
import polars as pl

from stellar_blaze.domain.config.runtime import EffectiveParams
from stellar_blaze.domain.plans.ticks import hour_ban_weight
from stellar_blaze.domain.risk.levels import Zone, ZoneEdges, zone_of
from stellar_blaze.domain.risk.twl_samples import effective_twl, withdrawal_limits
from stellar_blaze.domain.rules.ruleset import Ruleset
from stellar_blaze.domain.scoreboard import Provenance, ThetaDecision, ThetaGridPoint
from stellar_blaze.ml.data import DEV_SUMMERS, TEST_SUMMER, HoldoutViolationError
from stellar_blaze.ml.selection import EXPORT_CLUSTER, WORKING_HOURS_UTC
from stellar_blaze.ml.twl_rows import SITE_TIMEZONE, forward_effective, truth_raw_twl

__all__ = ["POD_TARGET", "THETA_FLOOR", "THETA_GRID", "oof_hours", "select_theta", "theta_grid"]

THETA_GRID: Final[tuple[float, ...]] = tuple(round(0.05 * k, 2) for k in range(1, 20))
"""The pre-registered grid 0.05, 0.10, ..., 0.95 (each value is the double nearest to its decimal)."""

POD_TARGET: Final = 0.90
THETA_FLOOR: Final = 0.05
"""theta_protect when no theta reaches the target POD (the report says so)."""

_RULE: Final = "preregistration §6.5"
_TIE_DECIMALS: Final = 12


def oof_hours(oof: pl.DataFrame, ruleset: Ruleset, params: EffectiveParams) -> pl.DataFrame:
    """The scored hours of the OOF export: ``p_high``, ``truth_high``, ``truth_red`` and the ban ``weight`` per hour.

    Rows are the abu_dhabi cluster at lead 1, UTC hours 06-14 of 2024 and 2025 (the export already holds only those; the
    filter makes the rule independent of what a caller passes). Columns of the result: ``station``, ``valid_time``,
    ``summer``, ``p_high``, ``truth_high``, ``truth_red``, ``weight`` (every row is scored: finite P(High) and truth).

    Raises:
        HoldoutViolationError: A row is of summer 2026 (by ``summer`` or by the year of ``valid_time``).
        ValueError: No row is left after the filter or none is scored.
    """
    years = set(oof["valid_time"].dt.year().unique().to_list())
    summers = set(oof["summer"].unique().to_list())
    if TEST_SUMMER in years or TEST_SUMMER in summers:
        raise HoldoutViolationError(f"the OOF holds summer {TEST_SUMMER}: theta is selected on 2024-2025 only")
    frame = oof.filter(
        (pl.col("cluster") == EXPORT_CLUSTER)
        & (pl.col("lead_days") == 1)
        & pl.col("valid_time").dt.hour().is_in(list(WORKING_HOURS_UTC))
        & pl.col("summer").is_in(sorted(DEV_SUMMERS))
    )
    if frame.is_empty():
        raise ValueError(f"no row of cluster {EXPORT_CLUSTER!r} at lead 1 in UTC hours 06-14 of 2024-2025")
    edges = ZoneEdges.from_ruleset(ruleset, params)

    samples = np.asarray(frame["samples"].to_numpy(), dtype=np.float64)
    forecast = forward_effective(frame, samples, ruleset=ruleset, params=params)
    zones = zone_of(forecast, edges)
    n_finite = (zones >= 0).sum(axis=1)
    n_high = ((zones >= int(Zone.HIGH)) & (zones >= 0)).sum(axis=1)
    p_high = np.divide(n_high, n_finite, out=np.full(frame.height, np.nan), where=n_finite > 0)

    truth_raw = truth_raw_twl(frame)
    obs_t = np.asarray(frame["obs_t_c"].cast(pl.Float64).fill_null(float("nan")).to_numpy(), dtype=np.float64)
    truth = effective_twl(
        truth_raw, margin_w_m2=params.twl_margin_w_m2, withdrawal=withdrawal_limits(ruleset), t_c=obs_t, tnwb_c=None
    )
    truth_zone = zone_of(truth, edges)

    tz = ZoneInfo(SITE_TIMEZONE)
    labour = ruleset.labour
    if labour is None:
        raise ValueError(f"ruleset {ruleset.meta.id} has no labour section: the ban weights cannot be computed")
    weight = np.array([hour_ban_weight(t.astimezone(UTC), tz, labour) for t in frame["valid_time"].to_list()])

    scored = np.isfinite(p_high) & (truth_zone >= 0)
    if not scored.any():
        raise ValueError("no hour has both a finite forecast and an observed truth")
    return pl.DataFrame(
        {
            "station": frame["station"],
            "valid_time": frame["valid_time"],
            "summer": frame["summer"],
            "p_high": p_high,
            "truth_high": truth_zone >= int(Zone.HIGH),
            "truth_red": truth_zone >= int(Zone.RED),
            "weight": weight,
        }
    ).filter(pl.Series(scored))


def theta_grid(hours: pl.DataFrame) -> list[ThetaGridPoint]:
    """POD, FAR, Peirce score and hours at every theta of the grid, weighted by the non-ban fraction.

    Raises:
        ValueError: No weighted truth danger hour, or no weighted truth non-danger hour.
    """
    p = hours["p_high"].to_numpy()
    truth = hours["truth_high"].to_numpy()
    w = hours["weight"].to_numpy()
    danger, calm = float(w[truth].sum()), float(w[~truth].sum())
    if danger == 0.0:
        raise ValueError("no truth danger hour with a worked fraction: POD, and so theta, is undefined")
    if calm == 0.0:
        raise ValueError("no truth non-danger hour with a worked fraction: the Peirce score is undefined")
    n_hours = int((w > 0).sum())
    points: list[ThetaGridPoint] = []
    for theta in THETA_GRID:
        warned = p >= theta
        hits = float(w[truth & warned].sum())
        false_alarms = float(w[~truth & warned].sum())
        pod = hits / danger
        pofd = false_alarms / calm
        far = false_alarms / (hits + false_alarms) if hits + false_alarms > 0.0 else 0.0
        points.append(ThetaGridPoint(theta=theta, pod=pod, far=far, pss=pod - pofd, n_hours=n_hours))
    return points


def _choose(grid: list[ThetaGridPoint]) -> tuple[float, float]:
    reaching = [point.theta for point in grid if point.pod >= POD_TARGET]
    protect = max(reaching) if reaching else THETA_FLOOR
    best = max(round(point.pss, _TIE_DECIMALS) for point in grid)
    balanced = min(point.theta for point in grid if round(point.pss, _TIE_DECIMALS) == best)
    return protect, balanced


def select_theta(
    oof: pl.DataFrame, ruleset: Ruleset, params: EffectiveParams, *, provenance: Provenance
) -> ThetaDecision:
    """Apply pre-registration 6.5 to the OOF export (the module docstring has the rule and its one clarification).

    Args:
        oof: ``oof_samples_abu_dhabi.parquet`` as a frame.
        ruleset: The frozen ruleset (zone edges, labour ban window, withdrawal switch).
        params: Its effective tunables (the margin 7 and the Red edge 85 of the freeze); ``warning_theta`` is not used.
        provenance: The block the result carries (the caller knows the commit and the data hash).

    Raises:
        HoldoutViolationError: The OOF holds a 2026 row.
        ValueError: As ``oof_hours`` and ``theta_grid``.
    """
    hours = oof_hours(oof, ruleset, params)
    grid = theta_grid(hours)
    protect, balanced = _choose(grid)
    w = hours["weight"].to_numpy()
    red = float(w[hours["truth_red"].to_numpy()].sum()) / float(w.sum())
    return ThetaDecision(
        theta_protect=protect,
        theta_balanced=balanced,
        grid=grid,
        red_hour_share=red,
        n_hours=int((w > 0).sum()),
        rule=_RULE,
        provenance=provenance,
    )
