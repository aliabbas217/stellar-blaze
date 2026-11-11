"""The shared HTTP plumbing: the client builder, the raw-response cache and the retrying, caching, traced GET."""

import re
from collections.abc import Callable, Iterator
from pathlib import Path

import httpx2
import pytest
import stamina
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import StatusCode

from stellar_blaze.adapters.http import client as http_client
from stellar_blaze.adapters.http.cache import RawResponseCache
from stellar_blaze.adapters.http.client import UpstreamError, build_async_client, get_bytes
from stellar_blaze.config import Settings
from tests.unit.adapters.http_support import cached_files, forbidden

pytestmark = pytest.mark.unit

URL = "https://example.test/data"
PARAMS = [("station", "OMAA"), ("data", "tmpf"), ("data", "dwpf"), ("tz", "Etc/UTC")]
FULL_URL = "https://example.test/data?station=OMAA&data=tmpf&data=dwpf&tz=Etc%2FUTC"


class Calls:
    """A MockTransport handler that records every request and answers from a script (the last answer repeats)."""

    def __init__(self, *answers: httpx2.Response | Exception) -> None:
        self.answers = answers
        self.requests: list[httpx2.Request] = []

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        answer = self.answers[min(len(self.requests), len(self.answers)) - 1]
        if isinstance(answer, Exception):
            raise answer
        return answer


def client_for(settings: Settings, handler: Callable[[httpx2.Request], httpx2.Response]) -> httpx2.AsyncClient:
    return build_async_client(settings, httpx2.MockTransport(handler))


@pytest.fixture
def retry_three_times() -> Iterator[None]:
    """Stamina's testing mode: no backoff sleeps and 3 attempts (plain ``set_testing(True)`` would mean 1)."""
    with stamina.set_testing(True, attempts=3):
        yield


@pytest.fixture
def spans(monkeypatch: pytest.MonkeyPatch) -> InMemorySpanExporter:
    """Route the module's spans to a private provider, whatever global provider other tests installed."""
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    monkeypatch.setattr(http_client, "tracer", provider.get_tracer("test"))
    return exporter


def only_span(exporter: InMemorySpanExporter) -> ReadableSpan:
    finished = exporter.get_finished_spans()
    assert len(finished) == 1, [s.name for s in finished]
    return finished[0]


# === build_async_client =============================================================================================


@pytest.mark.asyncio
async def test_client_sends_the_configured_user_agent_and_has_the_configured_timeout(settings: Settings) -> None:
    calls = Calls(httpx2.Response(200, content=b"ok"))

    async with client_for(settings, calls) as client:
        await client.get(URL)

        assert client.timeout == httpx2.Timeout(settings.http_timeout_s)

    assert calls.requests[0].headers["User-Agent"] == settings.http_user_agent


# === RawResponseCache ===============================================================================================


def test_cache_key_is_a_stable_sha256_that_depends_on_url_and_ordered_params() -> None:
    key = RawResponseCache.key(URL, PARAMS)

    assert re.fullmatch(r"[0-9a-f]{64}", key)
    assert key == RawResponseCache.key(URL, list(PARAMS))
    assert key != RawResponseCache.key(URL, list(reversed(PARAMS)))  # order is part of the request
    assert key != RawResponseCache.key(URL + "/", PARAMS)
    assert key != RawResponseCache.key(URL, [*PARAMS, ("extra", "1")])
    # No delimiter ambiguity between a name and a value.
    assert RawResponseCache.key(URL, [("a", "bc")]) != RawResponseCache.key(URL, [("ab", "c")])


def test_cache_round_trip_uses_the_sharded_layout(tmp_path: Path) -> None:
    cache = RawResponseCache(tmp_path)
    key = RawResponseCache.key(URL, PARAMS)

    assert cache.get(key) is None
    path = cache.put(key, b"body")

    assert path == tmp_path / key[:2] / f"{key}.bin"
    assert path.read_bytes() == b"body"
    assert cache.get(key) == b"body"
    assert cached_files(tmp_path) == [path]  # no temp file left behind


def test_cache_put_replaces_an_existing_entry(tmp_path: Path) -> None:
    cache = RawResponseCache(tmp_path)
    key = RawResponseCache.key(URL, PARAMS)
    cache.put(key, b"old")

    cache.put(key, b"new")

    assert cache.get(key) == b"new"
    assert len(cached_files(tmp_path)) == 1


def test_cache_put_that_fails_leaves_neither_a_partial_entry_nor_a_temp_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    cache = RawResponseCache(tmp_path)
    key = RawResponseCache.key(URL, PARAMS)

    def disk_full(self: Path, target: Path) -> Path:
        raise OSError("disk full")

    monkeypatch.setattr(Path, "replace", disk_full)  # the rename is the commit point of the atomic write
    with pytest.raises(OSError, match="disk full"):
        cache.put(key, b"body")
    monkeypatch.undo()

    assert cache.get(key) is None
    assert cached_files(tmp_path) == []


@pytest.mark.parametrize("key", ["", "../escape", "ab", "A" * 64, ("a" * 63) + "/"])
def test_cache_rejects_a_key_that_is_not_a_sha256_hex_digest(tmp_path: Path, key: str) -> None:
    cache = RawResponseCache(tmp_path)

    with pytest.raises(ValueError, match="sha-256"):
        cache.get(key)
    with pytest.raises(ValueError, match="sha-256"):
        cache.put(key, b"x")


# === get_bytes: cache ===============================================================================================


@pytest.mark.asyncio
async def test_cache_hit_skips_network(settings: Settings, tmp_path: Path) -> None:
    cache = RawResponseCache(tmp_path)
    cache.put(RawResponseCache.key(URL, PARAMS), b"cached body")

    async with client_for(settings, forbidden) as client:
        body = await get_bytes(client, URL, PARAMS, cache=cache)

    assert body == b"cached body"


@pytest.mark.asyncio
async def test_a_miss_is_fetched_cached_and_then_served_from_the_cache(settings: Settings, tmp_path: Path) -> None:
    cache = RawResponseCache(tmp_path)
    calls = Calls(httpx2.Response(200, content=b"fresh"))

    async with client_for(settings, calls) as client:
        first = await get_bytes(client, URL, PARAMS, cache=cache)
        second = await get_bytes(client, URL, PARAMS, cache=cache)

    assert (first, second) == (b"fresh", b"fresh")
    assert len(calls.requests) == 1
    assert cache.get(RawResponseCache.key(URL, PARAMS)) == b"fresh"


@pytest.mark.asyncio
async def test_without_a_cache_every_call_is_a_request(settings: Settings) -> None:
    calls = Calls(httpx2.Response(200, content=b"x"))

    async with client_for(settings, calls) as client:
        await get_bytes(client, URL, PARAMS, cache=None)
        await get_bytes(client, URL, PARAMS, cache=None)

    assert len(calls.requests) == 2


@pytest.mark.asyncio
async def test_the_request_carries_the_params_in_order_with_duplicates(settings: Settings) -> None:
    calls = Calls(httpx2.Response(200, content=b"x"))

    async with client_for(settings, calls) as client:
        await get_bytes(client, URL, PARAMS, cache=None)

    request = calls.requests[0]
    assert request.method == "GET"
    assert str(request.url) == FULL_URL
    assert list(request.url.params.multi_items()) == PARAMS


# === get_bytes: retries =============================================================================================


@pytest.mark.asyncio
@pytest.mark.usefixtures("retry_three_times")
async def test_retries_429_then_succeeds(settings: Settings, tmp_path: Path) -> None:
    too_many = httpx2.Response(429, content=b"Too many requests from your IP address, slow down.")
    calls = Calls(too_many, too_many, httpx2.Response(200, content=b"finally"))

    async with client_for(settings, calls) as client:
        body = await get_bytes(client, URL, PARAMS, cache=RawResponseCache(tmp_path))

    assert body == b"finally"
    assert len(calls.requests) == 3


@pytest.mark.asyncio
@pytest.mark.usefixtures("retry_three_times")
@pytest.mark.parametrize("status", [500, 502, 503, 504])
async def test_retries_server_errors(settings: Settings, status: int) -> None:
    calls = Calls(httpx2.Response(status), httpx2.Response(200, content=b"ok"))

    async with client_for(settings, calls) as client:
        body = await get_bytes(client, URL, PARAMS, cache=None)

    assert body == b"ok"
    assert len(calls.requests) == 2


@pytest.mark.asyncio
@pytest.mark.usefixtures("retry_three_times")
async def test_retries_transport_errors(settings: Settings) -> None:
    calls = Calls(
        httpx2.ConnectError("connection refused"), httpx2.ReadTimeout("slow"), httpx2.Response(200, content=b"ok")
    )

    async with client_for(settings, calls) as client:
        body = await get_bytes(client, URL, PARAMS, cache=None)

    assert body == b"ok"
    assert len(calls.requests) == 3


@pytest.mark.asyncio
@pytest.mark.usefixtures("retry_three_times")
async def test_exhausted_retries_on_a_status_raise_upstream_error_with_the_last_status(
    settings: Settings, tmp_path: Path
) -> None:
    calls = Calls(httpx2.Response(429, content=b"first"), httpx2.Response(503, content=b"Service  Unavailable\n"))

    async with client_for(settings, calls) as client:
        with pytest.raises(UpstreamError) as caught:
            await get_bytes(client, URL, PARAMS, cache=RawResponseCache(tmp_path))

    error = caught.value
    assert len(calls.requests) == 3
    assert error.status == 503
    assert error.url == FULL_URL
    assert error.body_excerpt == "Service Unavailable"
    assert "503" in str(error)
    assert cached_files(tmp_path) == []


@pytest.mark.asyncio
@pytest.mark.usefixtures("retry_three_times")
async def test_exhausted_retries_on_transport_errors_raise_upstream_error_without_a_status(settings: Settings) -> None:
    calls = Calls(httpx2.ConnectError("connection refused"))

    async with client_for(settings, calls) as client:
        with pytest.raises(UpstreamError) as caught:
            await get_bytes(client, URL, PARAMS, cache=None)

    error = caught.value
    assert len(calls.requests) == 3
    assert error.status is None
    assert error.url == FULL_URL
    assert error.body_excerpt is None
    assert "ConnectError" in str(error)
    assert isinstance(error.__cause__, httpx2.ConnectError)


# === get_bytes: no retry ============================================================================================


@pytest.mark.asyncio
async def test_404_raises_upstream_error_without_retry(settings: Settings, tmp_path: Path) -> None:
    calls = Calls(httpx2.Response(404, content=b"Not Found"))

    async with client_for(settings, calls) as client:
        with pytest.raises(UpstreamError) as caught:
            await get_bytes(client, URL, PARAMS, cache=RawResponseCache(tmp_path))

    assert len(calls.requests) == 1
    assert caught.value.status == 404
    assert caught.value.url == FULL_URL
    assert caught.value.body_excerpt == "Not Found"
    assert cached_files(tmp_path) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [301, 400, 401, 403, 410])
async def test_other_non_success_statuses_are_not_retried(settings: Settings, status: int) -> None:
    calls = Calls(httpx2.Response(status, content=b"nope"))

    async with client_for(settings, calls) as client:
        with pytest.raises(UpstreamError) as caught:
            await get_bytes(client, URL, PARAMS, cache=None)

    assert len(calls.requests) == 1
    assert caught.value.status == status


@pytest.mark.asyncio
async def test_the_body_excerpt_is_short(settings: Settings) -> None:
    calls = Calls(httpx2.Response(400, content=b'{"error": true, "reason": "' + b"x" * 5000 + b'"}'))

    async with client_for(settings, calls) as client:
        with pytest.raises(UpstreamError) as caught:
            await get_bytes(client, URL, PARAMS, cache=None)

    excerpt = caught.value.body_excerpt
    assert excerpt is not None
    assert excerpt.startswith('{"error": true, "reason": "xxx')
    assert len(excerpt) <= 220


@pytest.mark.asyncio
async def test_the_body_excerpt_replaces_control_characters_and_undecodable_bytes(settings: Settings) -> None:
    calls = Calls(httpx2.Response(400, content=b"a\x00b\r\n\x1b[31m\xffc"))

    async with client_for(settings, calls) as client:
        with pytest.raises(UpstreamError) as caught:
            await get_bytes(client, URL, PARAMS, cache=None)

    assert caught.value.body_excerpt == "a b [31m\ufffdc"


@pytest.mark.asyncio
async def test_an_empty_error_body_has_no_excerpt(settings: Settings) -> None:
    async with client_for(settings, Calls(httpx2.Response(403))) as client:
        with pytest.raises(UpstreamError) as caught:
            await get_bytes(client, URL, PARAMS, cache=None)

    assert caught.value.body_excerpt is None


# === get_bytes: validation before caching ===========================================================================


@pytest.mark.asyncio
async def test_an_invalid_success_body_is_never_cached_and_is_not_retried(settings: Settings, tmp_path: Path) -> None:
    calls = Calls(httpx2.Response(200, content=b'{"error": true, "reason": "Cannot initialize WeatherVariable"}'))
    cache = RawResponseCache(tmp_path)

    def validate(body: bytes) -> None:
        if b'"error": true' in body:
            raise ValueError("the API reported an error in a 200 response")

    async with client_for(settings, calls) as client:
        with pytest.raises(UpstreamError) as caught:
            await get_bytes(client, URL, PARAMS, cache=cache, validate=validate)

    error = caught.value
    assert len(calls.requests) == 1
    assert error.status == 200
    assert error.url == FULL_URL
    assert "the API reported an error in a 200 response" in str(error)
    assert error.body_excerpt is not None
    assert "Cannot initialize WeatherVariable" in error.body_excerpt
    assert isinstance(error.__cause__, ValueError)
    assert cached_files(tmp_path) == []
    assert cache.get(RawResponseCache.key(URL, PARAMS)) is None


@pytest.mark.asyncio
async def test_a_valid_body_is_validated_then_cached(settings: Settings, tmp_path: Path) -> None:
    calls = Calls(httpx2.Response(200, content=b"good"))
    cache = RawResponseCache(tmp_path)
    seen: list[bytes] = []

    async with client_for(settings, calls) as client:
        body = await get_bytes(client, URL, PARAMS, cache=cache, validate=seen.append)
        again = await get_bytes(client, URL, PARAMS, cache=cache, validate=seen.append)

    assert body == again == b"good"
    assert seen == [b"good"]  # a cached body was validated when it was written
    assert len(calls.requests) == 1


@pytest.mark.asyncio
async def test_an_error_raised_by_the_validator_that_is_not_a_value_error_propagates(settings: Settings) -> None:
    def validate(body: bytes) -> None:
        raise UpstreamError("custom", url="https://example.test/x", status=200)

    async with client_for(settings, Calls(httpx2.Response(200, content=b"x"))) as client:
        with pytest.raises(UpstreamError, match="custom"):
            await get_bytes(client, URL, PARAMS, cache=None, validate=validate)


# === get_bytes: tracing =============================================================================================


@pytest.mark.asyncio
async def test_a_call_runs_in_an_http_get_span_with_url_and_status(
    settings: Settings, spans: InMemorySpanExporter
) -> None:
    async with client_for(settings, Calls(httpx2.Response(200, content=b"x"))) as client:
        await get_bytes(client, URL, PARAMS, cache=None)

    span = only_span(spans)
    assert span.name == "http.get"
    assert span.attributes is not None
    assert span.attributes["url.full"] == FULL_URL
    assert span.attributes["http.response.status_code"] == 200
    assert span.status.status_code is not StatusCode.ERROR


@pytest.mark.asyncio
async def test_a_failed_call_records_the_last_status_and_an_error_span(
    settings: Settings, spans: InMemorySpanExporter
) -> None:
    async with client_for(settings, Calls(httpx2.Response(404))) as client:
        with pytest.raises(UpstreamError):
            await get_bytes(client, URL, PARAMS, cache=None)

    span = only_span(spans)
    assert span.attributes is not None
    assert span.attributes["http.response.status_code"] == 404
    assert span.status.status_code is StatusCode.ERROR


@pytest.mark.asyncio
@pytest.mark.usefixtures("retry_three_times")
async def test_retries_stay_inside_one_span_that_ends_with_the_last_status(
    settings: Settings, spans: InMemorySpanExporter
) -> None:
    calls = Calls(httpx2.Response(429), httpx2.Response(200, content=b"x"))

    async with client_for(settings, calls) as client:
        await get_bytes(client, URL, PARAMS, cache=None)

    span = only_span(spans)
    assert span.attributes is not None
    assert span.attributes["http.response.status_code"] == 200


@pytest.mark.asyncio
async def test_a_cache_hit_is_marked_on_the_span_and_has_no_status(
    settings: Settings, spans: InMemorySpanExporter, tmp_path: Path
) -> None:
    cache = RawResponseCache(tmp_path)
    cache.put(RawResponseCache.key(URL, PARAMS), b"cached")

    async with client_for(settings, forbidden) as client:
        await get_bytes(client, URL, PARAMS, cache=cache)

    span = only_span(spans)
    assert span.attributes is not None
    assert span.attributes["stellar_blaze.cache.hit"] is True
    assert "http.response.status_code" not in span.attributes
