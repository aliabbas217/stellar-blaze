"""Pure ASGI middleware (not ``BaseHTTPMiddleware``, which would hide the correlation id contextvar from the app)."""

import time

import structlog
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = structlog.stdlib.get_logger(__name__)


class RequestLogMiddleware:
    """Emit exactly one ``request.completed`` event per HTTP request.

    Must sit inside ``CorrelationIdMiddleware`` so the event carries the request id. The query string is deliberately
    not logged: it may carry tokens or personal data.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()
        # If the app raises before it responds, ServerErrorMiddleware (outside this middleware) answers 500.
        status = 500

        async def send_and_record(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_and_record)
        finally:
            logger.info(
                "request.completed",
                method=scope["method"],
                path=scope["path"],
                status=status,
                duration_ms=round((time.perf_counter() - started) * 1000, 3),
            )
