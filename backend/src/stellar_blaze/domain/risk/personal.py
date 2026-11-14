"""The personal (on-device) level, mirrored in Python so that the device and the server can be checked together.

The worker's phone computes its own level (ADR 0004): F1's ``exceedance.ts`` and ``personal.ts``. This module is a
line-for-line mirror of those two functions, and F2 runs the committed vector file against its TypeScript. If this
module and the TypeScript ever disagree, the TypeScript is the device truth.

The committed file is ``backend/tests/fixtures/risk/personal_level_vectors.json`` (a contract with F2, ADR 0049
decision 6). Write it with ``uv run python -m stellar_blaze.domain.risk.personal --write-vectors <path>``; the output is
deterministic (sorted keys, 2-space indent, ASCII, floats as shortest round-trip text, probabilities rounded to 12
decimals) and a unit test regenerates it in memory and compares. The format, ``format_version`` 1:

- ``default_bands``: the ADR 0049 bands ``[{"level", "min_exceedance_probability"}]``, ascending, green at 0.
- ``probability_tolerance``: 1e-9; compare ``expected_probability`` to the device's result within it.
- ``exceedance_vectors``: ``{"name", "p05", "p50", "p95", "limit", "expected_probability", "expected_level"}``. The
  inputs are the forecast quantiles (any order: the function sorts) and the NIOSH limit; ``expected_level`` is the level
  of ``expected_probability`` under ``default_bands``. The device must also reproduce it from the full pipeline.
- ``band_vectors``: ``{"name", "bands", "probability", "expected_level"}``: the band selection alone, for a probability
  exactly at a band minimum, just below one, equal minimums and a probability below every minimum (``null``).

Both functions refuse a non-finite number (``ValueError`` here, ``RangeError`` in TypeScript).
"""

import argparse
import json
import math
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any, Final

from stellar_blaze.domain.risk.levels import AlertLevel

_OUTER_MASS: Final = 0.45
_BELOW_P05: Final = 0.95
_ABOVE_P95: Final = 0.05
_AT_MEDIAN: Final = 0.5

DEFAULT_BANDS: Final[tuple[tuple[AlertLevel, float], ...]] = (
    (AlertLevel.GREEN, 0.0),
    (AlertLevel.AMBER, 0.10),
    (AlertLevel.ORANGE, 0.50),
    (AlertLevel.RED, 0.90),
)
"""The ADR 0049 bands (green at 0, then the tunable defaults 0.10, 0.50, 0.90)."""

_SEVERITY: Final = {level: rank for rank, level in enumerate(AlertLevel)}
_VECTORS_FORMAT_VERSION: Final = 1
_PROBABILITY_DECIMALS: Final = 12
_PROBABILITY_TOLERANCE: Final = 1e-9


def exceedance_3q(p05: float, p50: float, p95: float, limit: float) -> float:
    """P(WBGT > limit) in [0.05, 0.95] from three quantiles: a mirror of F1 ``exceedanceProbability``.

    The CDF is the polyline through (p05, 0.05), (p50, 0.50) and (p95, 0.95), each inner segment carrying 0.45 of the
    probability. Quantiles given out of order are sorted first (the median is the median of the three). A limit equal
    to the median is 0.50 first, whatever the tails do; then ``limit <= p05`` is 0.95 (a lower bound), ``limit >= p95``
    is 0.05 (an upper bound), and a limit strictly inside a segment is linear, so no segment of zero width is divided.

    Raises:
        ValueError: A number is not finite.
    """
    if not all(math.isfinite(v) for v in (p05, p50, p95, limit)):
        raise ValueError("quantiles and limit must be finite numbers")
    low = min(p05, p50, p95)
    high = max(p05, p50, p95)
    mid = max(min(p05, p50), min(max(p05, p50), p95))  # median of three, exact
    if limit == mid:
        return _AT_MEDIAN
    if limit <= low:
        return _BELOW_P05
    if limit >= high:
        return _ABOVE_P95
    if limit < mid:
        return _BELOW_P05 - (_OUTER_MASS * (limit - low)) / (mid - low)
    return _AT_MEDIAN - (_OUTER_MASS * (limit - mid)) / (high - mid)


def band_level(bands: Sequence[tuple[AlertLevel, float]], p: float) -> AlertLevel | None:
    """The level of the band with the highest minimum at or below ``p``; the more severe one when minimums tie.

    A mirror of ``bandLevel`` in F1 ``personal.ts``: a minimum above ``p`` is skipped, a probability equal to a minimum
    takes that band, and ``None`` means no band covers ``p``.
    """
    level: AlertLevel | None = None
    highest_min = -math.inf
    for candidate, minimum in bands:
        if minimum > p:
            continue
        if minimum > highest_min:
            highest_min = minimum
            level = candidate
        elif minimum == highest_min and level is not None:
            level = _more_severe(level, candidate)
    return level


def _more_severe(a: AlertLevel, b: AlertLevel) -> AlertLevel:
    return a if _SEVERITY[a] >= _SEVERITY[b] else b


def displayed_level(site: AlertLevel | None, personal: AlertLevel | None) -> AlertLevel | None:
    """The level the screen leads with: the more severe of the site's and the worker's own, either may be absent.

    A site Red (stop) always wins over a personal Green; a ``None`` on one side shows the other (ADR 0049 decision 4).
    """
    if site is None:
        return personal
    if personal is None:
        return site
    return _more_severe(site, personal)


# ---- the vector file ---------------------------------------------------------------------------------------------

_TRIPLES: Final[tuple[tuple[str, float, float, float], ...]] = (
    ("triple_a", 30.0, 32.0, 36.0),
    ("triple_b", 28.5, 31.0, 35.5),
    ("triple_c", 33.2, 35.8, 38.4),
)
_TIED_LOW: Final = ("tied_low", 26.0, 26.0, 30.0)  # p05 == p50
_TIED_HIGH: Final = ("tied_high", 26.0, 30.0, 30.0)  # p50 == p95
_ALL_EQUAL: Final = 25.0


def _bands_json(bands: Sequence[tuple[AlertLevel, float]]) -> list[dict[str, Any]]:
    return [{"level": level.value, "min_exceedance_probability": minimum} for level, minimum in bands]


def _exceedance_vector(name: str, p05: float, p50: float, p95: float, limit: float) -> dict[str, Any]:
    probability = exceedance_3q(p05, p50, p95, limit)
    level = band_level(DEFAULT_BANDS, probability)
    return {
        "name": name,
        "p05": p05,
        "p50": p50,
        "p95": p95,
        "limit": limit,
        "expected_probability": round(probability, _PROBABILITY_DECIMALS),
        "expected_level": None if level is None else level.value,  # green starts at 0, so never None here
    }


def _band_vector(name: str, bands: Sequence[tuple[AlertLevel, float]], probability: float) -> dict[str, Any]:
    level = band_level(bands, probability)
    return {
        "name": name,
        "bands": _bands_json(bands),
        "probability": probability,
        "expected_level": None if level is None else level.value,
    }


def _exceedance_vectors() -> list[dict[str, Any]]:
    vectors: list[dict[str, Any]] = []
    for name, p05, p50, p95 in _TRIPLES:
        vectors += [
            _exceedance_vector(f"{name}_limit_below_p05", p05, p50, p95, p05 - 1.0),
            _exceedance_vector(f"{name}_limit_equals_p05", p05, p50, p95, p05),
            _exceedance_vector(f"{name}_limit_between_p05_and_p50", p05, p50, p95, (p05 + p50) / 2.0),
            _exceedance_vector(f"{name}_limit_equals_p50", p05, p50, p95, p50),
            _exceedance_vector(f"{name}_limit_between_p50_and_p95", p05, p50, p95, (p50 + p95) / 2.0),
            _exceedance_vector(f"{name}_limit_equals_p95", p05, p50, p95, p95),
            _exceedance_vector(f"{name}_limit_above_p95", p05, p50, p95, p95 + 1.0),
        ]
    for name, p05, p50, p95 in (_TIED_LOW, _TIED_HIGH):
        inner = (p50 + p95) / 2.0 if p05 == p50 else (p05 + p50) / 2.0
        vectors += [
            _exceedance_vector(f"{name}_limit_below_p05", p05, p50, p95, p05 - 1.0),
            _exceedance_vector(f"{name}_limit_equals_p05", p05, p50, p95, p05),
            _exceedance_vector(f"{name}_limit_inside_the_wide_segment", p05, p50, p95, inner),
            _exceedance_vector(f"{name}_limit_equals_p50", p05, p50, p95, p50),
            _exceedance_vector(f"{name}_limit_equals_p95", p05, p50, p95, p95),
            _exceedance_vector(f"{name}_limit_above_p95", p05, p50, p95, p95 + 1.0),
        ]
    v = _ALL_EQUAL
    vectors += [
        _exceedance_vector("all_equal_at_limit_equals_value", v, v, v, v),
        _exceedance_vector("all_equal_at_limit_below", v, v, v, v - 0.1),
        _exceedance_vector("all_equal_at_limit_above", v, v, v, v + 0.1),
    ]
    _, a05, a50, a95 = _TRIPLES[0]
    orders = {
        "p95_p05_p50": (a95, a05, a50),
        "p50_p95_p05": (a50, a95, a05),
        "p95_p50_p05": (a95, a50, a05),
        "p50_p05_p95": (a50, a05, a95),
        "p05_p95_p50": (a05, a95, a50),
    }
    for order, (first, second, third) in orders.items():
        for limit in (31.0, 34.0):
            vectors.append(_exceedance_vector(f"unsorted_{order}_limit_{limit:g}", first, second, third, limit))
    return vectors


def _band_vectors() -> list[dict[str, Any]]:
    vectors: list[dict[str, Any]] = []
    just_below = {0.10: 0.0999999999, 0.50: 0.4999999999, 0.90: 0.8999999999}
    for level, minimum in DEFAULT_BANDS:
        vectors.append(_band_vector(f"band_minimum_exactly_{level.value}", DEFAULT_BANDS, minimum))
        if minimum in just_below:
            vectors.append(_band_vector(f"band_just_below_{level.value}", DEFAULT_BANDS, just_below[minimum]))
    vectors += [
        _band_vector("band_ends_of_the_exceedance_range_low", DEFAULT_BANDS, 0.05),
        _band_vector("band_ends_of_the_exceedance_range_high", DEFAULT_BANDS, 0.95),
        _band_vector(
            "band_equal_minimums_take_the_more_severe",
            [(AlertLevel.AMBER, 0.3), (AlertLevel.ORANGE, 0.3), (AlertLevel.GREEN, 0.0)],
            0.3,
        ),
        _band_vector(
            "band_equal_minimums_in_the_other_order",
            [(AlertLevel.GREEN, 0.0), (AlertLevel.ORANGE, 0.3), (AlertLevel.AMBER, 0.3)],
            0.3,
        ),
        _band_vector("band_below_every_minimum_has_no_level", [(AlertLevel.AMBER, 0.1), (AlertLevel.RED, 0.9)], 0.05),
    ]
    return vectors


def build_vectors() -> dict[str, Any]:
    """The vector document as plain data (what ``render_vectors`` serializes)."""
    return {
        "format_version": _VECTORS_FORMAT_VERSION,
        "description": (
            "Parity vectors for the personal-level pipeline (ADR 0049 decision 6): P(WBGT > limit) from three "
            "quantiles and the band selection. Generated by stellar_blaze.domain.risk.personal; do not edit by hand."
        ),
        "default_bands": _bands_json(DEFAULT_BANDS),
        "probability_tolerance": _PROBABILITY_TOLERANCE,
        "exceedance_vectors": _exceedance_vectors(),
        "band_vectors": _band_vectors(),
    }


def render_vectors() -> str:
    """The vector document as the exact text of the committed file (deterministic, ends with a newline)."""
    return json.dumps(build_vectors(), indent=2, sort_keys=True, ensure_ascii=True) + "\n"


def main(argv: Sequence[str] | None = None) -> int:
    """``python -m stellar_blaze.domain.risk.personal --write-vectors <path>``."""
    parser = argparse.ArgumentParser(prog="python -m stellar_blaze.domain.risk.personal", description=__doc__)
    parser.add_argument("--write-vectors", metavar="PATH", type=Path, required=True, help="write the vector file")
    args = parser.parse_args(argv)
    path: Path = args.write_vectors
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_vectors(), encoding="utf-8", newline="\n")
    print(f"wrote {path}", file=sys.stderr)  # noqa: T201
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
