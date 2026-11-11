"""Outbound HTTP: the process's client builder and one retrying, caching, traced GET.

Every upstream call goes through ``get_bytes``, so retries, the raw-response cache, body validation and tracing behave
the same for every source. ``opentelemetry-instrumentation-httpx`` does not instrument ``httpx2`` (stack doc finding
7), so the span is created here by hand.
"""

import asyncio
from collections.abc import Callable, Sequence
from typing import Final

import httpx2
import stamina
from opentelemetry import trace
from opentelemetry.trace import Span

from stellar_blaze.adapters.http.cache import RawResponseCache
from stellar_blaze.config import Settings

# Statuses that mean "the service could not answer now, ask again": throttling and server-side failures.
RETRYABLE_STATUSES: Final = frozenset({429, 500, 502, 503, 504})

_ATTEMPTS: Final = 6
_RETRY_TIMEOUT_S: Final = 600.0
# stamina's default backoff (0.1 s, capped at 5 s) gives up within about 3 s, shorter than a rate limiter's window:
# IEM answered 429 "Too many requests from your IP address, slow down." to 4 requests in a few seconds. This waits
# 1, 2, 4, 8 and 16 s (plus up to 1 s of jitter) between the 6 attempts.
_WAIT_INITIAL_S: Final = 1.0
_WAIT_MAX_S: Final = 30.0
_EXCERPT_CHARS: Final = 200

# Public so a test can replace it with a tracer of its own provider.
tracer = trace.get_tracer("stellar_blaze.adapters.http")


class UpstreamError(Exception):
    """An upstream service did not give a usable answer.

    Attributes:
        url: The full request URL, query string included. Credentials must never be put in a query string: this URL
            is logged, recorded on the ``http.get`` span and shown in error messages.
        status: The HTTP status of the last response, or ``None`` when there was none (the connection failed).
        body_excerpt: The start of the response body with control characters removed, or ``None`` when it is empty.
    """

    def __init__(self, message: str, *, url: str, status: int | None, body_excerpt: str | None = None) -> None:
        super().__init__(message)
        self.url = url
        self.status = status
        self.body_excerpt = body_excerpt


def build_async_client(settings: Settings, transport: httpx2.AsyncBaseTransport | None = None) -> httpx2.AsyncClient:
    """Build the HTTP client for outbound calls.

    TLS certificates are verified (httpx2's default; nothing here turns it off) and redirects are not followed, so a
    redirect surfaces as an ``UpstreamError`` instead of silently changing the host. ``transport`` is for tests.
    """
    return httpx2.AsyncClient(
        timeout=settings.http_timeout_s,
        headers={"User-Agent": settings.http_user_agent},
        transport=transport,
    )


def _excerpt(body: bytes) -> str | None:
    text = body[: _EXCERPT_CHARS * 4].decode("utf-8", errors="replace")
    text = " ".join("".join(char if char.isprintable() else " " for char in text).split())
    if not text:
        return None
    return text if len(text) <= _EXCERPT_CHARS else text[:_EXCERPT_CHARS] + "..."


def _is_retryable(exc: Exception) -> bool:
    if isinstance(exc, httpx2.TransportError):
        return True
    return isinstance(exc, UpstreamError) and exc.status in RETRYABLE_STATUSES


async def _send_with_retries(client: httpx2.AsyncClient, request: httpx2.Request, span: Span) -> httpx2.Response:
    url = str(request.url)
    try:
        async for attempt in stamina.retry_context(
            on=_is_retryable,
            attempts=_ATTEMPTS,
            timeout=_RETRY_TIMEOUT_S,
            wait_initial=_WAIT_INITIAL_S,
            wait_max=_WAIT_MAX_S,
        ):
            with attempt:
                response = await client.send(request)
                span.set_attribute("http.response.status_code", response.status_code)
                if response.is_success:
                    return response
                excerpt = _excerpt(response.content)
                detail = f": {excerpt}" if excerpt else ""
                raise UpstreamError(
                    f"GET {url} returned HTTP {response.status_code}{detail}",
                    url=url,
                    status=response.status_code,
                    body_excerpt=excerpt,
                )
    except httpx2.TransportError as exc:  # the retries are used up; httpx2's exception is not part of our contract
        raise UpstreamError(f"GET {url} failed: {type(exc).__name__}: {exc}", url=url, status=None) from exc
    raise RuntimeError("stamina ended the retry loop without a result")  # pragma: no cover


async def get_bytes(
    client: httpx2.AsyncClient,
    url: str,
    params: Sequence[tuple[str, str]],
    *,
    cache: RawResponseCache | None,
    validate: Callable[[bytes], None] | None = None,
) -> bytes:
    """GET ``url`` with ``params`` and return the body, from ``cache`` when the request was stored before.

    ``params`` is a sequence of ``(name, value)`` pairs, never a mapping: order and repeated names are sent as given.
    A transport error and a 429, 500, 502, 503 or 504 response are retried (6 attempts, 600 s in total, exponential
    backoff); any other non-2xx response is final.

    A 2xx body is passed to ``validate`` before it is written to the cache, so a body that is invalid (an error
    reported in a 200 response, a changed schema) is never stored and cannot fail every later call too. ``validate``
    raises ``ValueError`` to reject a body, and a cached body is not validated again.

    The call runs in one ``http.get`` span (``url.full``, ``http.response.status_code`` of the last response, and
    ``stellar_blaze.cache.hit`` when the cache answered); retries stay inside it.

    Raises:
        UpstreamError: The service did not give a usable answer: retries were exhausted (the last status, or ``None``
            after transport errors), the status was a final non-2xx one, or ``validate`` rejected the body (status
            200, with the ``ValueError`` as the cause). An error raised by ``validate`` that is not a ``ValueError``
            propagates unchanged.
        OSError: The cache could not be read or written.
    """
    request = client.build_request("GET", url, params=list(params))
    full_url = str(request.url)
    with tracer.start_as_current_span("http.get", attributes={"url.full": full_url}) as span:
        key = RawResponseCache.key(url, params)
        if cache is not None:
            cached = await asyncio.to_thread(cache.get, key)
            if cached is not None:
                span.set_attribute("stellar_blaze.cache.hit", True)
                return cached
        response = await _send_with_retries(client, request, span)
        body = response.content
        if validate is not None:
            try:
                validate(body)
            except ValueError as exc:
                raise UpstreamError(
                    f"GET {full_url} returned an unusable body: {exc}",
                    url=full_url,
                    status=response.status_code,
                    body_excerpt=_excerpt(body),
                ) from exc
        if cache is not None:
            await asyncio.to_thread(cache.put, key, body)
        return body
