"""Builders the runtime-config service, poller and CLI tests share (imported, not collected)."""

import asyncio
import json
import time
from collections.abc import Awaitable, Callable
from datetime import date
from typing import Any

from stellar_blaze.adapters.config.models import scan_models
from stellar_blaze.adapters.fakes.config_store import InMemoryConfigStore
from stellar_blaze.application.runtime_config import ConfigService, SnapshotHolder
from stellar_blaze.domain.config.models import ModelRegistry
from stellar_blaze.domain.config.runtime import RuntimeConfig
from stellar_blaze.domain.rules.catalog import RulesetCatalog
from tests.unit.rules.support import BACKEND_ROOT, loaded, make_ruleset

FIXTURE_MODELS = BACKEND_ROOT / "tests" / "fixtures" / "models"
FIRST_MODEL = "corrector-20261111-0000000-000000"
SECOND_MODEL = "corrector-20261112-0000000-000001"
TODAY = date(2026, 11, 11)
SEED_CATALOG = RulesetCatalog([loaded(make_ruleset())])


def models() -> ModelRegistry:
    return scan_models(FIXTURE_MODELS)


def config(**fields: Any) -> RuntimeConfig:
    return RuntimeConfig.model_validate(fields)


def margin(value: float) -> RuntimeConfig:
    return config(tunables={"twl_margin_w_m2": value})


def make_service(
    store: InMemoryConfigStore | None = None,
    *,
    catalog: RulesetCatalog = SEED_CATALOG,
    holder: SnapshotHolder | None = None,
    today: date = TODAY,
    prod: bool = False,
) -> tuple[ConfigService, InMemoryConfigStore, SnapshotHolder]:
    """A service over a (new) fake store and an (empty) holder; ``today`` is the date its validation uses."""
    store = store if store is not None else InMemoryConfigStore()
    holder = holder if holder is not None else SnapshotHolder()
    service = ConfigService(store, catalog, models(), holder, lambda: today, prod=prod)
    return service, store, holder


async def eventually(condition: Callable[[], bool], *, timeout_s: float = 3.0, what: str = "the condition") -> None:
    """Wait until ``condition()`` holds; fail with ``what`` after ``timeout_s``. Polls every 10 ms."""
    deadline = time.monotonic() + timeout_s
    while not condition():
        if time.monotonic() > deadline:
            raise AssertionError(f"{what} did not hold within {timeout_s} s")
        await asyncio.sleep(0.01)


async def settle(awaitable: Awaitable[Any], *, timeout_s: float = 3.0) -> Any:
    """Await ``awaitable`` with a deadline, so a hung test fails instead of hanging the run."""
    async with asyncio.timeout(timeout_s):
        return await awaitable


def log_events(out: str, event: str | None = None) -> list[dict[str, Any]]:
    """The JSON log lines in ``out`` (non-JSON lines are skipped), only those named ``event`` when given."""
    parsed = [json.loads(line) for line in out.splitlines() if line.startswith("{")]
    return [line for line in parsed if event is None or line.get("event") == event]
