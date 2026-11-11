"""Pure ASGI middleware (not ``BaseHTTPMiddleware``, which would hide the correlation id contextvar from the app)."""

import time

import structlog
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from stellar_blaze.logging import bind_runtime_ids

logger = structlog.stdlib.get_logger(__name__)


class RequestLogMiddleware:
    """Emit exactly one ``request.completed`` event per HTTP request.

    Must sit inside ``CorrelationIdMiddleware`` so the event carries the request id. The query string is deliberately
    not logged: it may carry tokens or personal data. When the application lifespan has built the runtime, the request's
    context also gets the loaded ``ruleset_ids`` and ``model_ids`` (a context bound in the lifespan does not reach
    request tasks), so every line of the request, this one included, names the rules in force.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        runtime = getattr(getattr(scope.get("app"), "state", None), "runtime", None)
        if runtime is not None:
            bind_runtime_ids(runtime)

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
