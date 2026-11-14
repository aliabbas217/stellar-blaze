"""The in-memory push store satisfies the contract suite that Postgres also runs."""

import pytest

from tests.unit.contract.b3_world import fake_world
from tests.unit.contract.push_contract import CHECKS

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
@pytest.mark.parametrize("name", list(CHECKS))
async def test_the_in_memory_store_satisfies_the_contract(name: str) -> None:
    await CHECKS[name](fake_world())
