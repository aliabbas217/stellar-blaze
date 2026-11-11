"""RFC 9457 problem details: one error shape for every failure the API can return.

Hand-rolled on purpose (stack doc 6.8): the typed extension members and the request id are the only parts that
matter to us, and they are about 40 lines.
"""

from collections.abc import Mapping
from http import HTTPStatus
from typing import Any

import structlog
from asgi_correlation_id import correlation_id
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

PROBLEM_JSON = "application/problem+json"
REQUEST_ID_HEADER = "X-Request-ID"

logger = structlog.stdlib.get_logger(__name__)


class Problem(BaseModel):
    """An RFC 9457 problem. Extension members (``reason``, ``dependency``, ...) are kept as extra fields."""

    model_config = ConfigDict(extra="allow")

    type: str = "about:blank"
    title: str
    status: int = Field(ge=100, le=599)
    detail: str | None = None
    instance: str | None = None
    # Not part of the RFC: the correlation id of the failing request, so a user can quote it to support.
    request_id: str | None = None


# Declared once on the app so OpenAPI documents the error body for every route (and F2 generates a type for it).
PROBLEM_RESPONSES: dict[int | str, dict[str, Any]] = {
    "default": {"model": Problem, "description": "Problem details (RFC 9457)"},
}


class DomainProblem(Exception):  # noqa: N818  (named for the RFC 9457 concept, not as an *Error)
    """Raise from any layer to answer with a specific problem; ``**ext`` become extension members."""

    def __init__(self, *, type_: str, title: str, status: int, detail: str | None = None, **ext: Any) -> None:
        super().__init__(title)
        # A dict, not keyword arguments: mypy's pydantic plugin (init_forbid_extra) rejects extension kwargs.
        members = {**ext, "type": type_, "title": title, "status": status, "detail": detail}
        self.problem = Problem.model_validate(members)


def _respond(
    request: Request,
    problem: Problem,
    *,
    extra: Mapping[str, Any] | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    # The problem is never mutated: a DomainProblem may be a shared constant, and `instance` is per request.
    body = problem.model_dump(mode="json", exclude_none=True)
    body.setdefault("instance", request.url.path)
    if extra:
        body.update(extra)
    if request_id := correlation_id.get():
        body["request_id"] = request_id
    return JSONResponse(body, status_code=problem.status, media_type=PROBLEM_JSON, headers=dict(headers or {}))


def _phrase(status: int) -> str:
    try:
        return HTTPStatus(status).phrase
    except ValueError:
        return "Error"


def install_problem_handlers(app: FastAPI) -> None:
    """Answer every error with ``application/problem+json``; internal details never reach the client."""

    @app.exception_handler(DomainProblem)
    async def on_domain(request: Request, exc: DomainProblem) -> JSONResponse:
        return _respond(request, exc.problem)

    @app.exception_handler(RequestValidationError)
    async def on_validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        # loc/msg/type only: `input` would echo the caller's payload back, and `ctx` may not be JSON serializable.
        errors = [{"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
        problem = Problem(title=_phrase(422), status=422, detail="Request validation failed")
        return _respond(request, problem, extra={"errors": errors})

    @app.exception_handler(StarletteHTTPException)
    async def on_http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        title = _phrase(exc.status_code)
        detail = str(exc.detail) if exc.detail != title else None
        # Keep headers Starlette sets itself (Allow on 405, WWW-Authenticate on 401).
        return _respond(request, Problem(title=title, status=exc.status_code, detail=detail), headers=exc.headers)

    @app.exception_handler(Exception)
    async def on_unhandled(request: Request, exc: Exception) -> JSONResponse:
        # Runs in Starlette's ServerErrorMiddleware, outside CorrelationIdMiddleware, so the header is set here.
        logger.error("request.unhandled", method=request.method, path=request.url.path, exc_info=exc)
        request_id = correlation_id.get()
        headers = {REQUEST_ID_HEADER: request_id} if request_id else None
        return _respond(request, Problem(title=_phrase(500), status=500), headers=headers)
