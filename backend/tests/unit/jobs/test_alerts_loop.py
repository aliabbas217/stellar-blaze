"""``run_loop``: a FIXED-RATE cadence that follows the interval each cycle reads (period = max(60 s, interval x 60),
measured from the START of a run), a failing cycle does not end it, and a stop request ends it after the current run.
The clock is injected: a cycle "takes" ``Script.run_seconds`` of it, no real time passes."""

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
        self.now = 0.0
        self.run_seconds = 0.0

    def clock(self) -> float:
        return self.now

    async def cycle(self) -> int | None:
        self.runs += 1
        self.now += self.run_seconds
        answer = self.answers.pop(0)
        if not self.answers:
            self.stop.set()
        if isinstance(answer, Exception):
            raise answer
        return answer

    async def sleep(self, seconds: float, stop: asyncio.Event) -> None:
        self.waits.append(seconds)


async def drive(script: Script) -> int:
    return await run_loop(script.cycle, stop=script.stop, sleep=script.sleep, clock=script.clock)


async def test_the_wait_is_the_interval_each_cycle_read() -> None:
    script = Script(5, 2, 30, 1, 3)  # the config was changed between cycles: 5, then 2, ...

    assert await drive(script) == 5
    assert script.waits == [300.0, 120.0, 1800.0, 60.0]  # the last cycle stopped the loop: no wait after it


async def test_the_loop_is_fixed_rate_a_slow_run_shortens_the_wait() -> None:
    """Period 300 s; a run of 100 s waits 200 s (the next run starts 300 s after this one STARTED), a run of 400 s waits
    nothing (it overran: the next starts at once), and the period never goes below 60 s."""
    script = Script(5, 5, 5, 1, 1)
    script.run_seconds = 100.0
    await drive(script)
    assert script.waits == [200.0, 200.0, 200.0, 0.0]  # interval 1 -> period 60 s: a 100 s run overruns it

    slow = Script(5, 5, 5)
    slow.run_seconds = 400.0
    await drive(slow)
    assert slow.waits == [0.0, 0.0]


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
