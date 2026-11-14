"""``AlertJob.work``: a stop is escalated even when everything about the forecast fails (a stop needs no forecast)."""

from datetime import UTC, date, datetime
from typing import Any

import polars as pl
import pytest
from pydantic import BaseModel, ValidationError

from stellar_blaze.adapters.fakes.notifications import RecordingPushChannel
from stellar_blaze.adapters.http.client import UpstreamError
from stellar_blaze.application.runtime_config import ConfigSnapshot, SnapshotHolder
from stellar_blaze.composition import Runtime
from stellar_blaze.config import Settings
from stellar_blaze.domain.risk.levels import AlertLevel
from stellar_blaze.jobs.alerts import AlertJob
from tests.unit.api.support import SITE, build_world
from tests.unit.application.serving_support import catalog, snapshot
from tests.unit.config.support import models

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]
DAY = date(2026, 7, 1)
AT = datetime(2026, 7, 1, 4, 20, tzinfo=UTC)


class _Strict(BaseModel):
    n: int


def _validation_error() -> ValidationError:
    try:
        _Strict.model_validate({"n": "x"})
    except ValidationError as error:
        return error
    raise AssertionError("unreachable")


class RaisingProvider:
    """A ``CorrectorProvider`` whose model cannot be loaded."""

    def __init__(self, error: Exception) -> None:
        self.error = error

    def for_snapshot(self, snap: ConfigSnapshot) -> Any:
        raise self.error

    async def warm(self, snap: ConfigSnapshot) -> None:
        raise self.error


class DownForecasts:
    async def previous_runs(self, **_: object) -> pl.DataFrame:
        raise UpstreamError("503", url="https://x.invalid/v1", status=503)


async def stopped_job(settings: Settings, **overrides: Any) -> tuple[AlertJob, Any]:
    world = await build_world(settings, **{k: v for k, v in overrides.items() if k == "forecasts"})
    services = world.services
    if "correctors" in overrides:
        services = services.__class__(**{**services.__dict__, "correctors": overrides["correctors"]})
    runtime = Runtime(world.settings, catalog(), models(), SnapshotHolder(snapshot(version_id=3)))
    channel = RecordingPushChannel()
    job = AlertJob(world.settings, runtime, services, channel, None, None, _noop)  # type: ignore[arg-type]

    async def current() -> ConfigSnapshot:
        return snapshot(version_id=3)

    job.snapshot = current  # type: ignore[method-assign]
    epoch = await services.sites.active_epoch(SITE)
    world.clock.now = datetime(2026, 7, 1, 4, 10, tzinfo=UTC)
    await services.stops.start("crew-b", "heat", "lead-b", epoch)
    return job, channel


async def _noop() -> None:
    return None


@pytest.mark.parametrize(
    "provider",
    [
        RaisingProvider(FileNotFoundError("model.txt")),
        RaisingProvider(_validation_error()),
        RaisingProvider(RuntimeError("lightgbm")),
    ],
    ids=["file-not-found", "validation-error", "runtime"],
)
async def test_a_corrector_that_cannot_be_built_still_escalates_the_stop(settings: Settings, provider: Any) -> None:
    job, _ = await stopped_job(settings, correctors=provider)

    summary = await job.work(DAY, AT)

    reds = [r for r in job.services.alerts.records if r.crew_id == "crew-b"]  # type: ignore[attr-defined]
    assert [(r.level, r.kind) for r in reds] == [(AlertLevel.RED, "escalate")]
    assert isinstance(summary["events_created"], int)
    assert summary["events_created"] >= 1


async def test_a_source_that_raises_a_real_upstream_error_still_escalates_the_stop(settings: Settings) -> None:
    job, _ = await stopped_job(settings, forecasts=DownForecasts())

    await job.work(DAY, AT)

    reds = [r for r in job.services.alerts.records if r.crew_id == "crew-b"]  # type: ignore[attr-defined]
    assert [(r.level, r.kind) for r in reds][-1] == (AlertLevel.RED, "escalate")
