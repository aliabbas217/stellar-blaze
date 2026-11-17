"""``RequestPacer``: spacing request starts without real waiting (a fake clock that the fake sleep advances)."""

import asyncio

import pytest

from stellar_blaze.adapters.http.pacer import RequestPacer

pytestmark = pytest.mark.unit


class FakeTime:
    """A clock and a sleep that advances it, recording every sleep."""

    def __init__(self) -> None:
        self.now = 1000.0
        self.sleeps: list[float] = []

    def clock(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


def pacer(interval: float, time: FakeTime) -> RequestPacer:
    return RequestPacer(interval, clock=time.clock, sleep=time.sleep)


@pytest.mark.asyncio
async def test_the_first_request_starts_at_once_and_the_next_waits_the_whole_interval() -> None:
    time = FakeTime()
    spacing = pacer(2.0, time)

    await spacing.wait()
    await spacing.wait()

    assert time.sleeps == [2.0]


@pytest.mark.asyncio
async def test_time_already_spent_counts_toward_the_interval() -> None:
    time = FakeTime()
    spacing = pacer(2.0, time)

    await spacing.wait()
    time.now += 0.5  # the request itself took half a second
    await spacing.wait()
    time.now += 5.0  # a long request: the next may start at once
    await spacing.wait()

    assert time.sleeps == [1.5]


@pytest.mark.asyncio
async def test_a_zero_interval_never_waits() -> None:
    time = FakeTime()
    spacing = pacer(0.0, time)

    for _ in range(5):
        await spacing.wait()

    assert time.sleeps == []


@pytest.mark.asyncio
async def test_concurrent_callers_are_spaced_one_after_the_other() -> None:
    time = FakeTime()
    spacing = pacer(2.0, time)

    await asyncio.gather(*(spacing.wait() for _ in range(3)))

    assert time.sleeps == [2.0, 2.0]
    assert time.now == 1004.0


@pytest.mark.parametrize("interval", [-1.0, float("inf"), float("nan")])
def test_an_interval_that_is_not_a_finite_non_negative_number_is_refused(interval: float) -> None:
    with pytest.raises(ValueError, match="min_interval_s"):
        RequestPacer(interval)


@pytest.mark.asyncio
async def test_with_the_real_clock_and_sleep_a_second_request_waits() -> None:
    spacing = RequestPacer(0.2)
    loop = asyncio.get_running_loop()

    await spacing.wait()
    started = loop.time()
    await spacing.wait()

    assert loop.time() - started >= 0.1  # well under the interval: the timer's resolution is coarse on Windows
