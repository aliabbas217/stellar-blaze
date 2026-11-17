"""What ``WebPushChannel`` reports so the dispatch can classify a failure (ADR 0058, second entry of 2026-11-15): the
HTTP status, the ``Retry-After`` the push service sent (bounded, in seconds) and whether the attempt timed out.
The channel stays ONE attempt per ``send_to``; the retry decision is the application's.

Facts (RFC 8030 section 5.2 / RFC 9110 section 10.2.3): ``Retry-After`` is a non-negative integer of seconds or an HTTP
date. A header that cannot be read is reported as the largest value (86400 s), never as absent: "absent" means the
service gave no hint and earns the short default backoff, but an unreadable hint must never be read as permission."""

from datetime import UTC, datetime, timedelta
from email.utils import format_datetime
from typing import Any

import aiohttp
import pytest

from stellar_blaze.adapters.notifications.webpush import MAX_RETRY_AFTER_S, WebPushChannel
from stellar_blaze.ports.notifications import DeliveryResult, DeliveryStatus
from tests.unit.adapters.test_webpush import ENDPOINT, SUBJECT, Sender, failure, message, stored

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


async def send(error: Exception | None) -> DeliveryResult:
    store, record = await stored()
    return await WebPushChannel("key", SUBJECT, store, sender=Sender(error)).send_to(record, message())


async def test_a_result_defaults_say_one_attempt_and_no_failure_class() -> None:
    result = DeliveryResult(channel="c", status=DeliveryStatus.DELIVERED)

    assert (result.http_status, result.retry_after_s, result.timed_out, result.attempts) == (None, None, False, 1)


@pytest.mark.parametrize("status", [400, 401, 403, 404, 410, 413, 429, 500, 502, 503])
async def test_the_http_status_is_reported(status: int) -> None:
    result = await send(failure(status))

    assert result.status is DeliveryStatus.FAILED
    assert result.http_status == status
    assert result.timed_out is False


@pytest.mark.parametrize(
    ("header", "seconds"),
    [("1", 1.0), ("120", 120.0), ("0", 0.0), ("2", 2.0), ("999999", MAX_RETRY_AFTER_S)],
)
async def test_retry_after_in_seconds_is_reported_bounded(header: str, seconds: float) -> None:
    result = await send(failure(429, **{"Retry-After": header}))

    assert result.retry_after_s == seconds


async def test_no_retry_after_header_is_none() -> None:
    assert (await send(failure(503))).retry_after_s is None


async def test_an_http_date_retry_after_is_the_seconds_from_now() -> None:
    past = format_datetime(datetime(2015, 10, 21, 7, 28, tzinfo=UTC), usegmt=True)
    far = format_datetime(datetime.now(UTC) + timedelta(days=30), usegmt=True)

    assert (await send(failure(503, **{"Retry-After": past}))).retry_after_s == 0.0
    assert (await send(failure(503, **{"Retry-After": far}))).retry_after_s == MAX_RETRY_AFTER_S


@pytest.mark.parametrize("header", ["soon", "", "-1", "nan", "inf", "1e3", "1.5", "١٢", " "])
async def test_an_unreadable_retry_after_is_the_largest_value_never_absent(header: str) -> None:
    result = await send(failure(503, **{"Retry-After": header}))

    assert result.retry_after_s == MAX_RETRY_AFTER_S


@pytest.mark.parametrize("error", [TimeoutError(ENDPOINT), aiohttp.ServerTimeoutError(ENDPOINT)])
async def test_a_timeout_is_marked_and_keeps_its_class_name_detail(error: Exception) -> None:
    result = await send(error)

    assert result.timed_out is True
    assert result.detail == f"error:{type(error).__name__}"
    assert result.http_status is None


@pytest.mark.parametrize("error", [OSError(ENDPOINT), ValueError("x"), failure(None)])
async def test_other_errors_are_not_timeouts(error: Exception) -> None:
    result = await send(error)

    assert result.timed_out is False
    assert result.http_status is None


async def test_a_delivered_result_carries_no_failure_class() -> None:
    result = await send(None)

    kinds: dict[str, Any] = result.model_dump()
    assert (kinds["http_status"], kinds["retry_after_s"], kinds["timed_out"]) == (None, None, False)
