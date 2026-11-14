"""``run_loop``: the cadence follows the interval each cycle reads, it never spins, a failing cycle does not end it,
and a stop request ends it after the current run."""

import asyncio

import pytest
import structlog

from stellar_blaze.jobs.alerts import DEFAULT_INTERVAL_MINUTES, MIN_WAIT_S, run_loop

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


class Script:
    """A cycle that answers from a list (an int is an interval, ``None`` a run that read none, an exception raises)
    and a sleeper that records the waits; it sets ``stop`` once the script is used up."""

    def __init__(self, *answers: int | Exception | None) -> None:
        self.answers = list(answers)
        self.waits: list[float] = []
        self.stop = asyncio.Event()
        self.runs = 0

    async def cycle(self) -> int | None:
        self.runs += 1
        answer = self.answers.pop(0)
        if not self.answers:
            self.stop.set()
        if isinstance(answer, Exception):
            raise answer
        return answer

    async def sleep(self, seconds: float, stop: asyncio.Event) -> None:
        self.waits.append(seconds)


async def drive(script: Script) -> int:
    return await run_loop(script.cycle, stop=script.stop, sleep=script.sleep)


async def test_the_wait_is_the_interval_each_cycle_read() -> None:
    script = Script(5, 2, 30, 1, 3)  # the config was changed between cycles: 5, then 2, ...

    assert await drive(script) == 5
    assert script.waits == [300.0, 120.0, 1800.0, 60.0]  # the last cycle stopped the loop: no wait after it


async def test_it_never_spins_whatever_the_interval() -> None:
    script = Script(1, 1, 1)

    await drive(script)

    assert all(wait >= MIN_WAIT_S for wait in script.waits)
    assert MIN_WAIT_S >= 60.0


async def test_a_cycle_that_read_nothing_keeps_the_last_interval_and_the_first_one_the_default() -> None:
    script = Script(None, 7, None, 1)

    await drive(script)

    assert script.waits == [DEFAULT_INTERVAL_MINUTES * 60.0, 7 * 60.0, 7 * 60.0]


async def test_a_failing_cycle_is_logged_with_the_class_name_and_the_loop_continues() -> None:
    script = Script(3, ConnectionError("password=hunter2"), 4, 1)

    with structlog.testing.capture_logs() as captured:
        cycles = await drive(script)

    assert cycles == 4
    assert script.waits == [180.0, 180.0, 240.0]  # the failed cycle waited the last known interval, not zero
    failed = [e for e in captured if e["event"] == "alerts.cycle_failed"]
    assert [e["error"] for e in failed] == ["ConnectionError"]
    assert "hunter2" not in str(captured)


async def test_a_stop_during_a_run_lets_the_run_finish_and_ends_the_loop() -> None:
    stop = asyncio.Event()
    finished: list[bool] = []

    async def cycle() -> int | None:
        stop.set()  # SIGTERM arrives mid-run
        await asyncio.sleep(0)
        finished.append(True)
        return 5

    waits: list[float] = []

    async def sleep(seconds: float, event: asyncio.Event) -> None:
        waits.append(seconds)

    assert await run_loop(cycle, stop=stop, sleep=sleep) == 1
    assert finished == [True]
    assert waits == []


async def test_the_default_sleeper_returns_when_stop_is_set() -> None:
    from stellar_blaze.jobs.alerts import wait

    stop = asyncio.Event()
    asyncio.get_running_loop().call_later(0.01, stop.set)

    await asyncio.wait_for(wait(3600.0, stop), timeout=2)
