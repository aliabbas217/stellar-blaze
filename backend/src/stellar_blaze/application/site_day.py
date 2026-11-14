"""The site-day use case: a corrected forecast for one site and local date, as warning levels, zones and ban data.

``site_day`` asks B2's ``corrected_forecast`` for the station's lead-``L`` forecast, draws 50 joint samples of it
(``corrector.sample(..., n_samples=50, seed=20261112)``), turns them into the effective TWL of every hour and reads from
that the level of the hour (ADR 0046 decision 3, at ``warning_theta``), the zone at the protective quantile, and the
216-tick zone timeline the planner takes (ADR 0046 decision 4, with the product clamp). It never raises for missing
data: the day it cannot compute is the protective one.

Where the forecast is thin or old, the day says so and gets more protective, never less (ADR 0058 decision 4):

* an hour with no row, or with no finite sample, has ``level=None`` and ``zone=None``; its ticks, and the ticks next to
  it, are High with ``fallback`` set (``plans.ticks.zone_timeline``);
* no usable hour at all, or a forecast source that raises, gives ``fallback_timeline`` (every tick High) and
  ``forecast_status="fallback"``; any missing hour among the 14 also reads ``"fallback"`` so a client never shows a
  patchy day as a normal one;
* live mode, the newest run older than ``forecast_stale_after_hours``: ``"stale"`` (the numbers are shown as they are;
  ``day_plan`` plans such a day as High on every tick);
* replay mode is a fixed snapshot: never stale, and ``mode="replay"``.

The issue time of a forecast row is its valid time minus ``lead_days`` days (the Previous Runs archive serves
"the forecast as it was N days ago"; it stores no run time, so this is the convention of pre-registration L3, applied
per hour). ``generated_at`` is the newest of them, or the time the response is computed when there is no row. The hours
are
the 14 modelled hours 06:00-19:00 site-local (02-15 UTC for the demo site); a site whose working day crosses UTC
midnight is not served (``ValueError``).

Samples and TWL are computed on the event loop (about 700 elements); the corrector's own call is synchronous, as in
``corrected_forecast``.
"""

import math
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Final, Literal
from zoneinfo import ZoneInfo

import httpx2
import numpy as np
import polars as pl
import structlog
from numpy.typing import NDArray

from stellar_blaze.application.correct_forecast import corrected_forecast
from stellar_blaze.application.runtime_config import ConfigSnapshot, ruleset_for
from stellar_blaze.domain.config.runtime import ConfigViolation, EffectiveParams, resolve_effective
from stellar_blaze.domain.forecast.grid import MODEL_LEADS
from stellar_blaze.domain.physics.types import F64
from stellar_blaze.domain.plans.model import ZoneTimeline
from stellar_blaze.domain.plans.ticks import (
    BanWindowData,
    ban_window_for,
    fallback_timeline,
    hour_ban_weight,
    zone_timeline,
)
from stellar_blaze.domain.risk.levels import (
    AlertLevel,
    Zone,
    ZoneEdges,
    hour_levels,
    level_for_zone,
    protective_twl,
    zone_of,
)
from stellar_blaze.domain.risk.twl_samples import effective_twl, twl_sample_matrix, withdrawal_limits
from stellar_blaze.domain.rules.catalog import RulesetCatalog
from stellar_blaze.domain.rules.ruleset import Ruleset
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.stations import Station, station
from stellar_blaze.ports.corrector import ForecastCorrector
from stellar_blaze.ports.sites import SiteRecord
from stellar_blaze.ports.weather import ObservationSource, SourceUnavailableError, WeatherForecastSource

__all__ = [
    "N_SAMPLES",
    "SAMPLE_SEED",
    "ConfigParametersError",
    "CorrectorFailedError",
    "SiteDay",
    "SiteHour",
    "SiteIdentity",
    "effective_params",
    "site_day",
]

logger = structlog.stdlib.get_logger(__name__)

N_SAMPLES: Final = 50
SAMPLE_SEED: Final = 20261112
FIRST_HOUR: Final = 6  # site-local; the hours served are 06:00 to 19:00 inclusive (the corrector's modelled 02-15 UTC)
LAST_HOUR: Final = 19
type _Wbgt = tuple[float | None, float | None, float | None]
_NO_WBGT: Final[_Wbgt] = (None, None, None)
_KEY: Final = ["station", "valid_time", "lead_days"]

type ForecastStatus = Literal["fresh", "stale", "fallback"]


class ConfigParametersError(Exception):
    """The config snapshot does not resolve against the ruleset in force (a deployment fault, not a request fault)."""

    def __init__(self, violations: list[ConfigViolation]) -> None:
        super().__init__("; ".join(f"{v.code} at {v.path}: {v.message}" for v in violations))
        self.violations = tuple(violations)


@dataclass(frozen=True)
class SiteIdentity:
    """The five identity fields every decision row carries (``config_version`` is 0 for a file or env snapshot)."""

    ruleset_id: str
    ruleset_sha256: str
    model_id: str | None
    config_version: int
    config_sha256: str


@dataclass(frozen=True)
class SiteHour:
    """One hour ``[starts_at, starts_at + 1 h)``: the corrected WBGT range, the level, the zone and the ban."""

    starts_at: datetime
    wbgt_q05: float | None
    wbgt_q50: float | None
    wbgt_q95: float | None
    level: AlertLevel | None
    zone: Zone | None
    ban_active: bool
    action_codes: tuple[str, ...]


@dataclass(frozen=True)
class SiteDay:
    """What ``/sites/{id}/forecast/today`` and the crew views are built from, for one site and local date.

    ``zones`` is the site's 216-tick timeline (before any crew-lead stop); ``hours`` the 14 working-day hours.
    """

    site: SiteRecord
    local_date: date
    mode: Literal["replay", "live"]
    forecast_status: ForecastStatus
    lead_days: int
    generated_at: datetime
    hours: tuple[SiteHour, ...]
    zones: ZoneTimeline
    ban: BanWindowData
    identity: SiteIdentity


def effective_params(snapshot: ConfigSnapshot, ruleset: Ruleset) -> EffectiveParams:
    """The tunables of ``snapshot`` resolved against ``ruleset``.

    Raises:
        ConfigParametersError: The snapshot's tunables are not valid for this ruleset.
    """
    resolved = resolve_effective(snapshot.config, ruleset)
    if isinstance(resolved, EffectiveParams):
        return resolved
    raise ConfigParametersError(resolved)


def _labels(local_date: date, tz: ZoneInfo) -> list[datetime]:
    labels = [
        datetime.combine(local_date, time(hour), tzinfo=tz).astimezone(UTC) for hour in range(FIRST_HOUR, LAST_HOUR + 1)
    ]
    if labels[0].date() != labels[-1].date():
        raise ValueError(
            f"the working day of {local_date} in {tz.key} crosses UTC midnight; the corrector models 02-15 UTC"
        )
    return labels


@dataclass(frozen=True)
class _Hourly:
    """The corrected forecast on the 14-label grid: effective TWL samples and WBGT quantiles, NaN/None where absent."""

    eff: F64  # (labels, N_SAMPLES)
    wbgt: tuple[_Wbgt, ...]
    newest_issue: datetime | None


# What an unavailable or malformed forecast looks like: a source that cannot answer (`SourceUnavailableError`: the
# base of the live `UpstreamError` and the replay `ReplaySnapshotError`), an HTTP or I/O failure, a malformed payload or
# frame (`ValueError` includes pydantic's `ValidationError`), a missing row or key, a Polars data error.
_DATA_ERRORS: Final = (
    SourceUnavailableError,
    httpx2.HTTPError,
    OSError,
    ValueError,
    KeyError,
    pl.exceptions.PolarsError,
)


class CorrectorFailedError(SourceUnavailableError):
    """The corrector (the loaded model) failed with something other than a data error: an operational dependency."""


class _GuardedCorrector:
    """The corrector, with ANY failure of its own calls turned into ``CorrectorFailedError``.

    A model that cannot load, a LightGBM or numpy error inside it: all of them leave the day on the protective fallback
    (every tick High), which is the safe failure mode, instead of a 500. Only the corrector's calls are guarded: the TWL
    maths and the rest of this module are our code, and a bug there must still surface.
    """

    def __init__(self, inner: ForecastCorrector) -> None:
        self._inner = inner

    @property
    def model_id(self) -> str | None:
        return self._inner.model_id

    @property
    def needs_history_forecasts(self) -> bool:
        return self._inner.needs_history_forecasts

    def correct(
        self,
        *,
        ifs: pl.DataFrame,
        gfs: pl.DataFrame,
        history: pl.DataFrame,
        history_ifs: pl.DataFrame | None = None,
    ) -> pl.DataFrame:
        try:
            return self._inner.correct(ifs=ifs, gfs=gfs, history=history, history_ifs=history_ifs)
        except Exception as error:
            raise CorrectorFailedError(type(error).__name__) from error

    def sample(self, corrected: pl.DataFrame, *, n_samples: int, seed: int) -> NDArray[np.float64]:
        try:
            return self._inner.sample(corrected, n_samples=n_samples, seed=seed)
        except Exception as error:
            raise CorrectorFailedError(type(error).__name__) from error


async def _hourly(
    *,
    labels: list[datetime],
    where: Station,
    lead_days: int,
    ruleset: Ruleset,
    params: EffectiveParams,
    forecasts: WeatherForecastSource,
    observations: ObservationSource,
    corrector: ForecastCorrector,
) -> _Hourly:
    valid_date = labels[0].date()
    corrected = await corrected_forecast(
        forecasts=forecasts,
        observations=observations,
        corrector=corrector,
        station=where,
        valid_date=valid_date,
        leads_days=[lead_days],
    )
    ifs = await forecasts.previous_runs(
        station=where, model=NwpModel.ECMWF_IFS025, start=valid_date, end=valid_date, leads_days=[lead_days]
    )
    keys = corrected.select(_KEY).unique(maintain_order=True)
    eff = np.full((len(labels), N_SAMPLES), np.nan, dtype=np.float64)
    wbgt = [_NO_WBGT] * len(labels)
    if keys.height == 0:
        return _Hourly(eff, tuple(wbgt), None)

    slot = {label: i for i, label in enumerate(labels)}
    times: list[datetime] = keys["valid_time"].to_list()
    rows = [r for r, t in enumerate(times) if t in slot]
    if not rows:
        return _Hourly(eff, tuple(wbgt), None)

    samples = corrector.sample(corrected, n_samples=N_SAMPLES, seed=SAMPLE_SEED)
    radiation = (
        keys.join(
            ifs.unique(["valid_time", "lead_days"], keep="first", maintain_order=True).select(
                ["valid_time", "lead_days", "sw_wm2", "direct_wm2", "pressure_hpa"]
            ),
            on=["valid_time", "lead_days"],
            how="left",
            maintain_order="left",
        )
        .select(["sw_wm2", "direct_wm2", "pressure_hpa"])
        .fill_null(math.nan)
        .to_numpy()
        .astype(np.float64)
    )
    picked = np.asarray(rows)
    chosen = samples[picked]
    twl = twl_sample_matrix(
        chosen,
        sw_wm2=radiation[picked, 0],
        direct_wm2=radiation[picked, 1],
        pressure_hpa=radiation[picked, 2],
        valid_time_utc=np.array([times[r].replace(tzinfo=None) for r in rows], dtype="datetime64[us]"),
        lat=where.lat,
        lon=where.lon,
    )
    effective = effective_twl(
        twl, margin_w_m2=params.twl_margin_w_m2, withdrawal=withdrawal_limits(ruleset), t_c=chosen[:, :, 0], tnwb_c=None
    )
    for k, r in enumerate(rows):
        eff[slot[times[r]]] = effective[k]

    quantiles = corrected.filter(pl.col("variable") == "wbgt").select(["valid_time", "q05", "q50", "q95"])
    for valid_time, q05, q50, q95 in quantiles.iter_rows():
        if valid_time in slot:
            wbgt[slot[valid_time]] = (q05, q50, q95)
    newest = max(times[r] for r in rows) - timedelta(days=lead_days)
    return _Hourly(eff, tuple(wbgt), newest)


async def site_day(
    *,
    site: SiteRecord,
    local_date: date,
    snapshot: ConfigSnapshot,
    catalog: RulesetCatalog,
    forecasts: WeatherForecastSource,
    observations: ObservationSource,
    corrector: ForecastCorrector,
    mode: Literal["replay", "live"],
    now: datetime,
    lead_days: int = 1,
) -> SiteDay:
    """The site's day: 14 hours of levels, the 216-tick zone timeline, the ban, the forecast status and the identity.

    Args:
        site: The site (time zone, station).
        local_date: The site-local date.
        snapshot: The active config snapshot (tunables, the ruleset pin, the identity).
        catalog: The rulesets; the one in force on ``local_date`` (or the pinned one) decides.
        forecasts: The forecast archive (B1/B2 source).
        observations: The observation source ``corrected_forecast`` reads the station history from.
        corrector: The corrector of the active model (``CorrectorProvider``).
        mode: ``replay`` (never stale) or ``live``.
        now: The instant the response is computed, timezone-aware.
        lead_days: The forecast lead, 1 to 7.

    Raises:
        ValueError: ``lead_days`` is outside 1 to 7, ``now`` is naive, or the site's working day crosses UTC midnight.
        ConfigParametersError: The snapshot does not resolve against the ruleset.
        RulesetIncompleteError: The ruleset predates the B3 sections (``labour``, ``alerts``).
        KeyError: ``site.station`` is not a known station.
        NoRulesetError: No ruleset is in force on ``local_date`` (and none is pinned).
    """
    if not MODEL_LEADS[0] <= lead_days <= MODEL_LEADS[-1]:
        raise ValueError(f"lead_days must be within {MODEL_LEADS[0]}..{MODEL_LEADS[-1]}, got {lead_days}")
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("now must be timezone-aware")
    tz = ZoneInfo(site.timezone)
    loaded = ruleset_for(snapshot, catalog, local_date)
    ruleset = loaded.ruleset
    ruleset.require("labour", "alerts")
    labour, alerts = ruleset.labour, ruleset.alerts
    if labour is None or alerts is None:  # unreachable after ``require``; narrows the optional sections
        raise RuntimeError("ruleset sections labour and alerts are required")
    params = effective_params(snapshot, ruleset)
    edges = ZoneEdges.from_ruleset(ruleset, params)
    labels = _labels(local_date, tz)
    where = station(site.station)

    hourly: _Hourly | None
    try:
        hourly = await _hourly(
            labels=labels,
            where=where,
            lead_days=lead_days,
            ruleset=ruleset,
            params=params,
            forecasts=forecasts,
            observations=observations,
            corrector=_GuardedCorrector(corrector),
        )
    except _DATA_ERRORS as error:
        # Only source, corrector and data faults make the day protective (every on-shift tick High, `forecast_status`
        # fallback). A TypeError or AttributeError in OUR code is a programming error and must surface.
        cause = error.__cause__ if isinstance(error, CorrectorFailedError) and error.__cause__ else error
        logger.error("site_day.forecast_unavailable", site_id=site.id, error=type(cause).__name__)
        hourly = None

    if hourly is None:
        levels = np.full(len(labels), -1, dtype=np.int8)
        zone_hr = levels.copy()
        timeline = fallback_timeline(local_date, tz)
        wbgt = [_NO_WBGT] * len(labels)
        newest = None
    else:
        levels = hour_levels(hourly.eff, edges, params.warning_theta)
        protective = protective_twl(hourly.eff)
        zone_hr = zone_of(protective, edges)
        timeline = zone_timeline(
            local_date=local_date,
            tz=tz,
            labels_utc=np.array([t.replace(tzinfo=None) for t in labels], dtype="datetime64[us]"),
            protective_twl_eff=protective,
            hour_level_zones=levels.tolist(),
            edges=edges,
        )
        wbgt = list(hourly.wbgt)
        newest = hourly.newest_issue

    hours = tuple(
        SiteHour(
            starts_at=label,
            wbgt_q05=wbgt[i][0],
            wbgt_q50=wbgt[i][1],
            wbgt_q95=wbgt[i][2],
            level=level_for_zone(int(levels[i])) if levels[i] >= 0 else None,
            zone=Zone(int(zone_hr[i])) if zone_hr[i] >= 0 else None,
            ban_active=hour_ban_weight(label, tz, labour) < 1.0,
            action_codes=alerts.action_codes_by_level[level_for_zone(int(levels[i])).value] if levels[i] >= 0 else (),
        )
        for i, label in enumerate(labels)
    )

    stale_after = timedelta(hours=params.forecast_stale_after_hours)
    status: ForecastStatus
    if any(hour.level is None for hour in hours):
        status = "fallback"
    elif mode == "live" and newest is not None and now - newest > stale_after:
        status = "stale"
    else:
        status = "fresh"

    return SiteDay(
        site=site,
        local_date=local_date,
        mode=mode,
        forecast_status=status,
        lead_days=lead_days,
        generated_at=newest if newest is not None else now,
        hours=hours,
        zones=timeline,
        ban=ban_window_for(local_date, tz, labour),
        identity=SiteIdentity(
            ruleset_id=ruleset.meta.id,
            ruleset_sha256=loaded.sha256,
            model_id=corrector.model_id if timeline.source != "fallback" else None,
            config_version=snapshot.version_id if snapshot.version_id is not None else 0,
            config_sha256=snapshot.sha256,
        ),
    )
