"""Builders the site-day and day-plan tests share: the demo site, hand-set fake sources, a snapshot, a catalog.

A forecast day is a mapping ``UTC hour -> (t_c, td_c)`` for the 14 modelled hours (02-15 UTC = 06:00-19:00 Asia/Dubai);
an hour that is absent from the mapping has no row at all (the upstream archive holds nothing for it).
"""

import math
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime, timedelta

import polars as pl

from stellar_blaze.adapters.config.rulesets import load_catalog
from stellar_blaze.adapters.fakes.corrector import FakeCorrector
from stellar_blaze.adapters.fakes.weather import InMemoryForecastSource, InMemoryObservationSource
from stellar_blaze.application.runtime_config import ConfigSnapshot
from stellar_blaze.application.site_day import SiteDay, site_day
from stellar_blaze.domain.config.runtime import RuntimeConfig
from stellar_blaze.domain.rules.catalog import RulesetCatalog
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.stations import Station
from stellar_blaze.ports.corrector import ForecastCorrector
from stellar_blaze.ports.sites import SiteRecord
from tests.alembic_support import BACKEND_DIR
from tests.unit.application.support import forecast_rows

DAY = date(2026, 7, 1)  # inside the ban season
SHA = "c" * 64
IFS, GFS = NwpModel.ECMWF_IFS025, NwpModel.GFS_SEAMLESS
MODELLED = range(2, 16)

# Effective TWL of these (t, td) at wind 4 m/s, sw 800 / direct 600 W/m2, 1000 hPa, after the 7 W/m2 margin (probed):
GREEN_DAY = (30.0, 10.0)  # 237 W/m2: Low
AMBER = (38.0, 20.0)  # 131.6: Medium
ORANGE = (40.0, 22.0)  # 102.5: High
RED = (42.0, 24.0)  # 71.7: below the Red edge 85


def demo_site() -> SiteRecord:
    """The demo site as the fixture declares it (station OMAA, Asia/Dubai)."""
    return SiteRecord(
        id="site-demo-mussafah",
        name="Demo site",
        timezone="Asia/Dubai",
        station="OMAA",
        lat=24.43,
        lon=54.65,
        employer_id="emp-demo",
        synthetic=True,
    )


def catalog() -> RulesetCatalog:
    return load_catalog(BACKEND_DIR / "rulesets", allow_drafts=False)


def snapshot(*, version_id: int | None = None) -> ConfigSnapshot:
    return ConfigSnapshot(
        version_id=version_id,
        sha256=SHA,
        config=RuntimeConfig(),
        source="db" if version_id is not None else "file",
        model=None,
    )


def day_of(
    first: tuple[float, float], overrides: Mapping[int, tuple[float, float]] | None = None
) -> dict[int, tuple[float, float]]:
    """All 14 modelled hours at ``first``, with ``overrides`` by UTC hour."""
    return {hour: (overrides or {}).get(hour, first) for hour in MODELLED}


def radiation(hour_utc: int) -> float:
    """A daylight curve through 800 W/m2 at 10 UTC and 40 W/m2 at 02 and 15 UTC (a constant would lie at low sun)."""
    return 40.0 + 760.0 * math.sin(math.pi * (hour_utc - 2) / 13) / math.sin(math.pi * 8 / 13)


def frames(
    hours: Mapping[int, tuple[float | None, float | None]], *, valid_date: date = DAY, lead: int = 1
) -> dict[tuple[str, NwpModel], pl.DataFrame]:
    parts = {
        model: [
            forecast_rows(
                "OMAA",
                model,
                hours=[datetime(valid_date.year, valid_date.month, valid_date.day, hour, tzinfo=UTC)],
                leads=[lead],
                t_c=t,
                td_c=td,
                sw_wm2=radiation(hour),
                direct_wm2=0.75 * radiation(hour),
            )
            for hour, (t, td) in sorted(hours.items())
        ]
        for model in (IFS, GFS)
    }
    return {
        ("OMAA", model): pl.concat(rows) if rows else forecast_rows("OMAA", model, hours=[], leads=[lead])
        for model, rows in parts.items()
    }


def forecasts_of(
    hours: Mapping[int, tuple[float | None, float | None]], **kwargs: int | date
) -> InMemoryForecastSource:
    return InMemoryForecastSource(frames(hours, **kwargs))  # type: ignore[arg-type]


def observations() -> InMemoryObservationSource:
    return InMemoryObservationSource({})


class ExplodingForecasts:
    """A forecast source whose upstream is down."""

    async def previous_runs(
        self, *, station: Station, model: NwpModel, start: date, end: date, leads_days: Sequence[int]
    ) -> pl.DataFrame:
        raise RuntimeError("upstream is down")


def newest_run(valid_date: date = DAY, lead: int = 1) -> datetime:
    """The issue time site_day assigns to the newest hour (15 UTC) of the day: valid time minus ``lead`` days."""
    return datetime(valid_date.year, valid_date.month, valid_date.day, 15, tzinfo=UTC) - timedelta(days=lead)


async def make_site_day(
    source: InMemoryForecastSource | ExplodingForecasts,
    *,
    mode: str = "replay",
    now: datetime | None = None,
    config: ConfigSnapshot | None = None,
    corrector: ForecastCorrector | None = None,
    lead_days: int = 1,
    local_date: date = DAY,
) -> SiteDay:
    return await site_day(
        site=demo_site(),
        local_date=local_date,
        snapshot=config or snapshot(),
        catalog=catalog(),
        forecasts=source,
        observations=observations(),
        corrector=corrector or FakeCorrector(0.0),
        mode="live" if mode == "live" else "replay",
        now=now or datetime(2026, 7, 1, 1, tzinfo=UTC),
        lead_days=lead_days,
    )
