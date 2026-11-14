"""The 5-minute tick grid of a local day, interpolation from hourly labels, the ban window, and the zone timeline.

Time rules (plan Global Constraints): every instant is timezone-aware UTC in code (here: naive ``datetime64[us]`` that
means UTC, like the rest of the numpy domain). A local date and the ban window are converted with the site's
``ZoneInfo``, never by adding hours by hand. The day grid is 216 ticks of 5 minutes from 04:00 local, equally spaced in
UTC (for a zone with a daylight-saving change that day the 216 ticks are 18 absolute hours, not 04:00-22:00 wall time;
the demo site, Asia/Dubai, has none). An hourly label ``H`` covers ``[H, H + 1 h)`` for display and scoring; a tick's
value is the linear interpolation between the hourly labels (pre-registration section 7.3), NaN outside the labelled
range and across a NaN label.
"""

from collections.abc import Sequence
from datetime import UTC, date, datetime, time, timedelta
from typing import Final, Literal
from zoneinfo import ZoneInfo

import numpy as np
from numpy.typing import NDArray

from stellar_blaze.domain.physics.types import F64
from stellar_blaze.domain.plans.model import ZoneTimeline
from stellar_blaze.domain.risk.levels import Zone, ZoneEdges, zone_of
from stellar_blaze.domain.rules.ruleset import LabourRules

TICK_MINUTES: Final = 5
"""Minutes per tick."""

_DAY_START_LOCAL: Final = time(4, 0)
_TICKS_PER_DAY: Final = 216  # 18 hours of 5 minutes: 04:00-22:00 local
_TICK: Final = np.timedelta64(TICK_MINUTES, "m")
_HOUR: Final = np.timedelta64(1, "h")
_HOUR_US: Final = 3_600_000_000

type TickTimes = NDArray[np.datetime64]


_EPOCH: Final = datetime(1970, 1, 1, tzinfo=UTC)


def _aware(instant: np.datetime64) -> datetime:
    """A naive ``datetime64`` that means UTC as a timezone-aware UTC ``datetime`` (exact to the microsecond)."""
    return _EPOCH + timedelta(microseconds=int(instant.astype("datetime64[us]").astype(np.int64)))


def _local_to_utc64(local_date: date, wall: time, tz: ZoneInfo) -> np.datetime64:
    """The UTC instant of ``wall`` on ``local_date`` in ``tz`` as a naive ``datetime64[us]``."""
    instant = datetime.combine(local_date, wall, tzinfo=tz).astimezone(UTC)
    return np.datetime64(instant.replace(tzinfo=None), "us")


def day_ticks(local_date: date, tz: ZoneInfo) -> TickTimes:
    """The 216 UTC instants of the day grid, 5 minutes apart, from 04:00 local on ``local_date`` (``datetime64[us]``).

    The ticks are equally spaced in UTC, so on a daylight-saving day the 216 ticks are 18 absolute hours.
    """
    start = _local_to_utc64(local_date, _DAY_START_LOCAL, tz)
    return np.asarray(start + np.arange(_TICKS_PER_DAY) * _TICK, dtype="datetime64[us]")


def interpolate_hourly(labels_utc: TickTimes, values: F64, ticks_utc: TickTimes) -> F64:
    """Linear interpolation of per-label ``values`` to ``ticks_utc``; NaN outside ``[labels[0], labels[-1]]``.

    A tick exactly on a label gets that label's value (NaN if the label is NaN), even when the next label is NaN. A tick
    strictly between two labels is NaN unless both are finite ("across a NaN label") AND the two labels are exactly one
    hour apart: a larger span means an hourly label is missing, and a missing hour is never bridged with a milder value
    (a gap gives NaN, which ``zone_timeline`` turns into ``HIGH`` with ``fallback``). Infinite values count as NaN.

    Raises:
        ValueError: ``labels_utc`` is not strictly increasing or does not match ``values`` in length.
    """
    labels = np.asarray(labels_utc).astype("datetime64[us]").astype(np.int64)
    vals = np.asarray(values, dtype=np.float64)
    vals = np.where(np.isfinite(vals), vals, np.nan)  # +/-inf is no value, like NaN
    ticks = np.asarray(ticks_utc).astype("datetime64[us]").astype(np.int64)
    if vals.shape != labels.shape or labels.ndim != 1:
        raise ValueError(f"values must have one value per label, got {vals.shape} for {labels.shape} labels")
    if labels.size > 1 and not (np.diff(labels) > 0).all():
        raise ValueError("labels_utc must be strictly increasing")
    out = np.full(ticks.shape, np.nan, dtype=np.float64)
    if labels.size == 0:
        return out
    inside = (ticks >= labels[0]) & (ticks <= labels[-1])
    lower = np.clip(np.searchsorted(labels, ticks, side="right") - 1, 0, labels.size - 1)
    upper = np.minimum(lower + 1, labels.size - 1)
    span = (labels[upper] - labels[lower]).astype(np.float64)
    offset = (ticks - labels[lower]).astype(np.float64)
    on_label = offset == 0.0
    weight = np.divide(offset, span, out=np.zeros_like(offset), where=span > 0.0)
    blended = vals[lower] + weight * (vals[upper] - vals[lower])  # NaN if either label is NaN
    blended = np.where(span == _HOUR_US, blended, np.nan)  # a span of more than one hour is a missing label
    out[inside] = np.where(on_label, vals[lower], blended)[inside]
    return out


def _in_season(local_date: date, labour: LabourRules) -> bool:
    start, end = labour.ban_season
    return start <= f"{local_date.month:02d}-{local_date.day:02d}" <= end


def in_ban(ticks_utc: TickTimes, local_date: date, tz: ZoneInfo, labour: LabourRules) -> NDArray[np.bool_]:
    """Which ticks fall in the midday-ban window of ``local_date`` (P-H1): ``[start, end)`` local, inclusive season.

    The window is the ruleset's ``ban_window`` on ``local_date`` converted to UTC with ``tz``; outside
    ``ban_season`` (inclusive local dates) no tick is in the ban.
    """
    ticks = np.asarray(ticks_utc).astype("datetime64[us]")
    if not _in_season(local_date, labour):
        return np.zeros(ticks.shape, dtype=np.bool_)
    start = _local_to_utc64(local_date, labour.ban_window[0], tz)
    end = _local_to_utc64(local_date, labour.ban_window[1], tz)
    return np.asarray((ticks >= start) & (ticks < end), dtype=np.bool_)


def hour_ban_weight(label_utc: np.datetime64 | datetime, tz: ZoneInfo, labour: LabourRules) -> float:
    """The non-ban fraction of the hour ``[H, H + 1 h)`` of the label ``H``: 1.0 outside the season, 0.5 at 08Z in July.

    ``label_utc`` is a naive ``datetime64`` meaning UTC or a timezone-aware ``datetime``. The local date of the label
    decides the season (the ban never crosses local midnight).
    """
    if isinstance(label_utc, datetime):
        if label_utc.tzinfo is None:
            raise ValueError("label_utc must be timezone-aware")
        label = np.datetime64(label_utc.astimezone(UTC).replace(tzinfo=None), "us")
    else:
        label = np.datetime64(label_utc, "us")
    local_date = _aware(label).astimezone(tz).date()
    if not _in_season(local_date, labour):
        return 1.0
    ban_start = _local_to_utc64(local_date, labour.ban_window[0], tz)
    ban_end = _local_to_utc64(local_date, labour.ban_window[1], tz)
    overlap = min(label + _HOUR, ban_end) - max(label, ban_start)
    overlap_minutes = max(overlap / np.timedelta64(1, "m"), 0.0)
    return float(1.0 - overlap_minutes / 60.0)


def fallback_timeline(local_date: date, tz: ZoneInfo) -> ZoneTimeline:
    """A timeline with no forecast at all: every tick ``HIGH`` with ``fallback`` set, ``source="fallback"``."""
    ticks = day_ticks(local_date, tz)
    return ZoneTimeline.from_zones(
        _aware(ticks[0]),
        [Zone.HIGH] * ticks.size,
        fallback=[True] * ticks.size,
        source="fallback",
    )


def zone_timeline(
    *,
    local_date: date,
    tz: ZoneInfo,
    labels_utc: TickTimes,
    protective_twl_eff: F64,
    hour_level_zones: Sequence[Zone | int] | None,
    edges: ZoneEdges,
    source: Literal["forecast", "truth"] = "forecast",
) -> ZoneTimeline:
    """The zone of every tick of ``local_date`` from the hourly protective effective TWL (ADR 0046 section 4).

    The protective TWL (``levels.protective_twl`` of the hour's samples, or the truth TWL) is interpolated linearly from
    its hourly labels to the 216 ticks; the tick zone is ``zone_of`` of that value. A tick with no value (outside the
    labelled range, or next to a NaN label) is ``HIGH`` with ``fallback=True``, so a missing or stale forecast is
    protective, never "no constraint".

    The product clamp: when ``hour_level_zones`` is given (one level zone per label, ``-1`` for an hour with no level),
    a tick is never milder than the level of the hour that encloses it (``[H, H + 1 h)`` of its label), also when the
    tick has no value of its own. ``None`` disables the clamp: the scoreboard's pre-registered ``rule_corrected`` plan
    is the plain q10 plan.

    Args:
        local_date: The local date of the day grid.
        tz: The site's time zone.
        labels_utc: Hourly labels, strictly increasing, naive ``datetime64`` meaning UTC.
        protective_twl_eff: The protective effective TWL per label in W/m2 (NaN where there is none).
        hour_level_zones: The level zone per label for the clamp, or ``None`` for no clamp.
        edges: The zone edges.
        source: ``"forecast"`` or ``"truth"``; a timeline with no value on any tick is ``"fallback"`` whatever this is.

    Raises:
        ValueError: ``protective_twl_eff`` or ``hour_level_zones`` does not have one entry per label.
    """
    ticks = day_ticks(local_date, tz)
    labels = np.asarray(labels_utc).astype("datetime64[us]")
    twl = interpolate_hourly(labels, np.asarray(protective_twl_eff, dtype=np.float64), ticks)
    zones = zone_of(twl, edges).astype(np.int64)
    has_value = zones >= 0
    zones = np.where(has_value, zones, int(Zone.HIGH))

    if hour_level_zones is not None:
        if len(hour_level_zones) != labels.size:
            raise ValueError(f"hour_level_zones needs one zone per label ({labels.size}), got {len(hour_level_zones)}")
        if labels.size:
            levels = np.array([int(z) for z in hour_level_zones], dtype=np.int64)
            label_us = labels.astype(np.int64)
            tick_us = ticks.astype(np.int64)
            enclosing = np.clip(np.searchsorted(label_us, tick_us, side="right") - 1, 0, None)
            in_hour = (tick_us >= label_us[enclosing]) & (tick_us < label_us[enclosing] + _HOUR_US)
            zones = np.maximum(zones, np.where(in_hour, levels[enclosing], -1))

    resolved: Literal["forecast", "truth", "fallback"] = "fallback" if not has_value.any() else source
    return ZoneTimeline.from_zones(
        _aware(ticks[0]),
        [Zone(int(z)) for z in zones],
        fallback=(~has_value).tolist(),
        protective_twl_w_m2=twl.tolist(),
        source=resolved,
    )
