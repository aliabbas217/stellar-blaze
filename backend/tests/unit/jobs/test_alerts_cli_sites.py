"""``cli._dispatch_sites``: one job_run per site under its own lock key, every site finished even when one job raises,
the summaries merged, the worst exit code returned and the failed sites named (class names only)."""

import asyncio
import datetime as dt
from collections.abc import Awaitable, Callable, Mapping

import pytest
from pydantic import JsonValue

from stellar_blaze.config import Settings
from stellar_blaze.jobs import cli
from stellar_blaze.jobs.cli import _dispatch_sites as dispatch_sites
from stellar_blaze.jobs.cli import _lock_key as lock_key

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]

type Work = Callable[[], Awaitable[Mapping[str, JsonValue]]]


class FakeJob:
    """Stands for ``AlertJob``: ``site_ids`` and ``work`` (a summary per site)."""

    def __init__(self, ids: list[str], delivered: dict[str, int] | None = None) -> None:
        self.ids = ids
        self.delivered = delivered or {}
        self.calls: list[tuple[dt.date | None, dt.datetime | None, str]] = []

    async def site_ids(self) -> list[str]:
        return self.ids

    async def work(
        self, local_date: dt.date | None, as_of: dt.datetime | None, site_id: str
    ) -> Mapping[str, JsonValue]:
        self.calls.append((local_date, as_of, site_id))
        return {
            "sites": [site_id],
            "events_created": 1,
            "delivered": self.delivered.get(site_id, 2),
            "failed": 0,
            "interval_minutes": 5 if site_id != "b" else 3,
            "config_version": 7,
            "push": "configured",
            "persisted": True,
        }


class FakeRunner:
    """Stands for ``run_job``: runs ``work`` (so a site summary is produced) unless the site is told to raise or to
    report an exit code; records the lock key and the params of every call."""

    def __init__(self, raises: dict[str, BaseException] | None = None, codes: dict[str, int] | None = None) -> None:
        self.raises = raises or {}
        self.codes = codes or {}
        self.locks: list[str] = []
        self.params: list[Mapping[str, JsonValue]] = []
        self.finished: list[str] = []

    async def __call__(
        self, settings: Settings, name: str, params: Mapping[str, JsonValue], work: Work, *, lock_key: str
    ) -> int:
        assert name == "alerts-dispatch"
        self.locks.append(lock_key)
        self.params.append(params)
        site = str(params["site"])
        await asyncio.sleep(0)  # every site is in flight before any finishes
        if site in self.raises:
            raise self.raises[site]
        await work()
        self.finished.append(site)
        return self.codes.get(site, 0)


def site_names(summary: Mapping[str, JsonValue]) -> list[str]:
    sites = summary["sites"]
    assert isinstance(sites, list)
    return sorted(str(site) for site in sites)


def use(monkeypatch: pytest.MonkeyPatch, runner: FakeRunner) -> None:
    monkeypatch.setattr(cli, "run_job", runner)


async def test_each_site_is_its_own_job_run_under_its_own_lock_key(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    runner = FakeRunner()
    use(monkeypatch, runner)
    job = FakeJob(["a", "b", "c"])

    code, merged = await dispatch_sites(settings, job, None, dt.date(2026, 7, 1), None)  # type: ignore[arg-type]

    assert code == 0
    assert sorted(runner.locks) == ["alerts-dispatch:a", "alerts-dispatch:b", "alerts-dispatch:c"]
    assert [p["site"] for p in runner.params] == ["a", "b", "c"]
    assert all(p["date"] == "2026-07-01" and p["as_of"] is None for p in runner.params)
    assert sorted(site for _, _, site in job.calls) == ["a", "b", "c"]
    assert site_names(merged) == ["a", "b", "c"]
    assert (merged["events_created"], merged["delivered"], merged["failed"]) == (3, 6, 0)
    assert merged["interval_minutes"] == 3  # the smallest: the loop must not sleep past the most urgent site


async def test_a_single_site_filter_runs_only_that_site(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    runner = FakeRunner()
    use(monkeypatch, runner)

    await dispatch_sites(settings, FakeJob(["a", "b"]), "b", None, None)  # type: ignore[arg-type]

    assert runner.locks == ["alerts-dispatch:b"]


async def test_the_worst_exit_code_wins(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    runner = FakeRunner(codes={"a": 0, "b": 3, "c": 1})
    use(monkeypatch, runner)

    code, merged = await dispatch_sites(settings, FakeJob(["a", "b", "c"]), None, None, None)  # type: ignore[arg-type]

    assert code == 3
    assert merged["delivered"] == 6  # the sites that reported a code still contribute their summaries


async def test_a_site_job_that_raises_does_not_abandon_the_others(
    monkeypatch: pytest.MonkeyPatch, settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    """W3: before the fix ``gather`` re-raised at once and left the other sites running detached; now every site is
    finished, the survivors are merged, the exit is non-zero and stderr names the failed site by class only."""
    secret = "postgresql://user:SECRET-PASSWORD@db/x"  # noqa: S105
    runner = FakeRunner(raises={"b": RuntimeError(secret)})
    use(monkeypatch, runner)

    code, merged = await dispatch_sites(settings, FakeJob(["a", "b", "c"]), None, None, None)  # type: ignore[arg-type]

    assert code == 1
    assert sorted(runner.finished) == ["a", "c"]  # both survivors ran to the end
    assert site_names(merged) == ["a", "c"]
    assert merged["delivered"] == 4
    err = capsys.readouterr().err
    assert "b (RuntimeError)" in err
    assert "SECRET-PASSWORD" not in err


async def test_every_site_raising_gives_exit_1_and_an_empty_summary(
    monkeypatch: pytest.MonkeyPatch, settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    runner = FakeRunner(raises={"a": OSError("x"), "b": ValueError("y")})
    use(monkeypatch, runner)

    code, merged = await dispatch_sites(settings, FakeJob(["a", "b"]), None, None, None)  # type: ignore[arg-type]

    assert (code, merged) == (1, {})
    err = capsys.readouterr().err
    assert "a (OSError)" in err
    assert "b (ValueError)" in err


async def test_a_cancellation_is_not_swallowed_as_a_site_failure(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    runner = FakeRunner(raises={"a": asyncio.CancelledError()})
    use(monkeypatch, runner)

    with pytest.raises(asyncio.CancelledError):
        await dispatch_sites(settings, FakeJob(["a", "b"]), None, None, None)  # type: ignore[arg-type]


async def test_the_lock_key_is_per_site() -> None:
    assert lock_key("site-demo-mussafah") == "alerts-dispatch:site-demo-mussafah"
