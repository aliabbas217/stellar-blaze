"""The heat-risk warning levels, the ADOSH zones of the effective TWL, and the one rule that turns samples into a level.

``AlertLevel`` is the four-level vocabulary that the policy, the notification port and the API share. ``Zone`` is the
ADOSH zone of an effective TWL with the product's fourth "stop" edge (ADR 0046): Low, Medium, High, Red. The level of an
hour is the most severe zone that at least a share ``theta`` of the hour's finite joint samples reach (ADR 0046 section
3); the planner's tick zone comes from the protective quantile of the same samples (section 4). Alerts, the API, the
planner zones and the scoreboard's P3 all use this module, so there is one rule in one place.
"""

import math
from dataclasses import dataclass
from enum import IntEnum, StrEnum
from typing import Final, Self

import numpy as np
from numpy.typing import NDArray

from stellar_blaze.domain.config.runtime import EffectiveParams
from stellar_blaze.domain.physics.types import F64
from stellar_blaze.domain.rules.ruleset import Ruleset


class AlertLevel(StrEnum):
    """The four warning levels of plan section 8.4, declared in ascending severity.

    The values are the lowercase codes of the wire contracts (the API's ``Level`` and the Web Push payload). Members
    compare as strings, not by severity, so rank them by their position in this declaration. The probability
    thresholds that map a forecast onto a level belong to the risk policy (B3), not to this vocabulary.
    """

    GREEN = "green"
    AMBER = "amber"
    ORANGE = "orange"
    RED = "red"


class Zone(IntEnum):
    """The ADOSH zone of an effective TWL, in ascending severity; ``RED`` is the product's stop edge (ADR 0046).

    ``-1`` is not a member: ``zone_of`` and ``hour_levels`` return it for "no value", in an ``int8`` array.
    """

    LOW = 0
    MEDIUM = 1
    HIGH = 2
    RED = 3


@dataclass(frozen=True)
class ZoneEdges:
    """The three edges in W/m2 of the effective TWL, inclusive on the milder side (ADR 0046 decision 2).

    ``twl >= low_min`` is Low, ``>= medium_min`` Medium, ``>= red_min`` High, below ``red_min`` Red. So exactly 140 is
    Low, exactly 115 is Medium, exactly the Red edge is High. ``red_min == medium_min`` is legal (the Red edge's range
    ends at 115): the High zone is then empty.
    """

    low_min: float
    medium_min: float
    red_min: float

    def __post_init__(self) -> None:
        if not all(math.isfinite(e) for e in (self.low_min, self.medium_min, self.red_min)):
            raise ValueError(f"zone edges must be finite, got {self!r}")
        if not self.low_min > self.medium_min >= self.red_min:
            raise ValueError(f"zone edges must satisfy low_min > medium_min >= red_min, got {self!r}")

    @classmethod
    def from_ruleset(cls, ruleset: Ruleset, params: EffectiveParams) -> Self:
        """The legal edges of the ruleset's ``twl_zones`` and the Red edge of the effective tunable."""
        return cls(
            low_min=ruleset.twl_zones.low_min_w_m2,
            medium_min=ruleset.twl_zones.medium_min_w_m2,
            red_min=params.red_twl_w_m2,
        )


NO_ZONE: Final = -1
"""The value ``zone_of`` and ``hour_levels`` give where there is no finite sample."""


def zone_of(twl_eff: F64, edges: ZoneEdges) -> NDArray[np.int8]:
    """The zone of each effective TWL (W/m2) as an ``int8`` array of the same shape: 0 Low to 3 Red, -1 for NaN."""
    twl = np.asarray(twl_eff, dtype=np.float64)
    zone = np.select(
        [twl >= edges.low_min, twl >= edges.medium_min, twl >= edges.red_min],
        [int(Zone.LOW), int(Zone.MEDIUM), int(Zone.HIGH)],
        default=int(Zone.RED),
    ).astype(np.int8)
    zone[np.isnan(twl)] = NO_ZONE
    return zone


def hour_levels(twl_eff_samples: F64, edges: ZoneEdges, theta: float) -> NDArray[np.int8]:
    """The zone-valued level of each hour from its joint samples (ADR 0046 section 3), reducing the last axis.

    The level is the most severe zone ``z`` with ``count(samples with zone >= z) / count(finite samples) >= theta``. A
    tie at ``theta`` escalates. The share is the exact integer ratio, correctly rounded (``3 / 30 == 0.1``): it is the
    ADR's definition, written so that it does not depend on how ``np.quantile`` rounds its rank. With numpy 2.5.4 the
    two agree for every n up to 200 (``tests/unit/risk/test_levels.py``), which is what ADR 0046 section 4 states.
    NaN samples are not counted at all; an hour with no finite sample has no level (-1).

    Args:
        twl_eff_samples: Effective TWL in W/m2, shape ``(..., n_samples)``.
        edges: The zone edges.
        theta: The warning probability, in (0, 1].

    Raises:
        ValueError: ``theta`` is not in (0, 1].
    """
    if not (math.isfinite(theta) and 0.0 < theta <= 1.0):
        raise ValueError(f"theta must be a probability in (0, 1], got {theta!r}")
    zones = zone_of(np.asarray(twl_eff_samples, dtype=np.float64), edges)
    finite = zones >= 0
    n_finite = finite.sum(axis=-1)
    level = np.where(n_finite > 0, np.int8(Zone.LOW), np.int8(NO_ZONE)).astype(np.int8)
    for zone in (Zone.MEDIUM, Zone.HIGH, Zone.RED):
        reaching = ((zones >= zone) & finite).sum(axis=-1)
        share = np.divide(reaching, n_finite, out=np.zeros(n_finite.shape, dtype=np.float64), where=n_finite > 0)
        level = np.where((n_finite > 0) & (share >= theta), np.int8(zone), level).astype(np.int8)
    return level


def protective_twl(twl_eff_samples: F64, q: float = 0.10) -> F64:
    """The protective effective TWL: ``np.quantile(finite samples, q, method="inverted_cdf")`` over the last axis.

    This is the pre-registered q10 (section 7.3, one-sided 90 percent protection). NaN samples are dropped first; a row
    with no finite sample gives NaN. numpy's definition is kept as it is, so the value is the one the scoreboard's plan
    uses.
    """
    samples = np.asarray(twl_eff_samples, dtype=np.float64)
    flat = samples.reshape(-1, samples.shape[-1])
    out = np.full(flat.shape[0], np.nan, dtype=np.float64)
    for i, row in enumerate(flat):
        finite = row[np.isfinite(row)]
        if finite.size:
            out[i] = np.quantile(finite, q, method="inverted_cdf")
    return out.reshape(samples.shape[:-1])


_LEVEL_OF_ZONE: Final = {
    Zone.LOW: AlertLevel.GREEN,
    Zone.MEDIUM: AlertLevel.AMBER,
    Zone.HIGH: AlertLevel.ORANGE,
    Zone.RED: AlertLevel.RED,
}


def level_for_zone(z: Zone | int) -> AlertLevel:
    """Low is green, Medium amber, High orange, Red red (ADR 0046 decision 3).

    Raises:
        ValueError: ``z`` is not a zone (``-1``, "no level", has no alert level).
    """
    try:
        return _LEVEL_OF_ZONE[Zone(z)]
    except ValueError:
        raise ValueError(f"{z!r} is not a zone (0 to 3)") from None
