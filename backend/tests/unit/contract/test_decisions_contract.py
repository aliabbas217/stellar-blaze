"""The in-memory alert, plan, stop and sign-off stores satisfy the contract suite that Postgres also runs."""

import pytest

from tests.unit.contract.b3_world import fake_world
from tests.unit.contract.decisions_contract import CHECKS

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
@pytest.mark.parametrize("name", list(CHECKS))
async def test_the_in_memory_stores_satisfy_the_contract(name: str) -> None:
    await CHECKS[name](fake_world())
