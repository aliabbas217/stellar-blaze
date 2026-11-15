"""The in-memory site store satisfies the epoch-start contract suite that Postgres also runs."""

from collections.abc import Callable
from datetime import datetime

import pytest

from stellar_blaze.adapters.fakes.audit import InMemoryAuditLog
from stellar_blaze.adapters.fakes.sites import InMemorySiteStore
from tests.unit.contract.epoch_start_contract import CHECKS, SiteStoreWithEpochSource

pytestmark = pytest.mark.unit


def build(clock: Callable[[], datetime]) -> SiteStoreWithEpochSource:
    return InMemorySiteStore(InMemoryAuditLog(clock), clock=clock)


@pytest.mark.asyncio
@pytest.mark.parametrize("name", list(CHECKS))
async def test_the_in_memory_store_satisfies_the_epoch_start_contract(name: str) -> None:
    await CHECKS[name](build)
