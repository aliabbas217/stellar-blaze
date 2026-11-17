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
from pydantic.json_schema import SkipJsonSchema
from starlette.exceptions import HTTPException as StarletteHTTPException

from stellar_blaze.application.replay_clock import ReplayClockUnavailableError
from stellar_blaze.logging import mark_exception_reported

PROBLEM_JSON = "application/problem+json"
REQUEST_ID_HEADER = "X-Request-ID"
# `type` of the 503 problem for a dependency the API needs and cannot reach (database, active runtime config).
DEPENDENCY_UNAVAILABLE = "urn:stellar-blaze:problem:dependency-unavailable"
# Problem types of the v1 contract (ADR 0051 and its amendments). `type` is a URN, stable for the life of the contract.
NOT_IMPLEMENTED = "urn:stellar-blaze:problem:not-implemented"  # 501, a route whose body is not built yet
UNAUTHORIZED = "urn:stellar-blaze:problem:unauthorized"  # 401, no or unknown bearer token
FORBIDDEN_EMPLOYER = "urn:stellar-blaze:problem:forbidden-employer"  # 403, a token of another employer
INDIVIDUAL_DATA_REFUSED = "urn:stellar-blaze:problem:individual-data-refused"  # 403, ADR 0054
NOT_FOUND = "urn:stellar-blaze:problem:not-found"  # 404, unknown site, crew or other id
PLAN_INVALID = "urn:stellar-blaze:problem:plan-invalid"  # 500, the validator rejected the planner's own plan
ROSTER_INVALID = "urn:stellar-blaze:problem:roster-invalid"  # 422, try-a-plan input that does not parse
REVIEW_REQUIRED = "urn:stellar-blaze:problem:review-required"  # 409, sign-off without every item acknowledged
NOT_A_DEMO_SITE = "urn:stellar-blaze:problem:not-a-demo-site"  # 409, reset of a site that is not synthetic
RATE_LIMITED = "urn:stellar-blaze:problem:rate-limited"  # 429, with a Retry-After header
SHIFT_NOT_LEGAL = "urn:stellar-blaze:problem:shift-not-legal"  # 422, the published shift breaks a shift rule itself
# 422, the host of a push endpoint is not on the allow-list of push services (ADR 0067)
ENDPOINT_HOST_NOT_ALLOWED = "urn:stellar-blaze:problem:endpoint-host-not-allowed"

logger = structlog.stdlib.get_logger(__name__)


class ProblemDraft(BaseModel):
    """What a layer knows when it raises: the problem itself, before the request (``instance``, ``request_id``) is.

    Extension members (``reason``, ``dependency``, ...) are kept as extra fields.
    """

    model_config = ConfigDict(extra="allow")

    type: str = "about:blank"
    title: str
    status: int = Field(ge=100, le=599)
    detail: str | None = None
    instance: str | None = None


class Problem(BaseModel):
    """An RFC 9457 problem details object, sent as ``application/problem+json`` for every error response.

    Extension members (for example ``dependency`` or ``errors``) may be present. ``detail`` is omitted when there is
    none.
    """

    # The OpenAPI schema of every error response; the docstring above is client-facing. `_respond` assembles the body
    # and tests/unit/api/test_openapi_contract.py validates what the API really sends against this model, so the two
    # cannot drift apart. `detail` is never sent as null, hence SkipJsonSchema[None]: optional, without a null.
    model_config = ConfigDict(extra="allow")

    type: str
    title: str
    status: int = Field(ge=100, le=599)
    detail: str | SkipJsonSchema[None] = None
    instance: str
    # Not part of the RFC: the correlation id of the failing request, so a user can quote it to support.
    request_id: str


# Declared once on the app so OpenAPI documents the error body for every route (and F2 generates a type for it).
PROBLEM_RESPONSES: dict[int | str, dict[str, Any]] = {
    "default": {"model": Problem, "description": "Problem details (RFC 9457)"},
}


class DomainProblem(Exception):  # noqa: N818  (named for the RFC 9457 concept, not as an *Error)
    """Raise from any layer to answer with a specific problem; ``**ext`` become extension members."""

    def __init__(
        self,
        *,
        type_: str,
        title: str,
        status: int,
        detail: str | None = None,
        headers: Mapping[str, str] | None = None,
        **ext: Any,
    ) -> None:
        super().__init__(title)
        self.headers = dict(headers or {})  # response headers such as Retry-After and WWW-Authenticate
        # A dict, not keyword arguments: mypy's pydantic plugin (init_forbid_extra) rejects extension kwargs.
        members = {**ext, "type": type_, "title": title, "status": status, "detail": detail}
        self.problem = ProblemDraft.model_validate(members)


def _respond(
    request: Request,
    problem: ProblemDraft,
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
        return _respond(request, exc.problem, headers=exc.headers)

    @app.exception_handler(ReplayClockUnavailableError)
    async def on_replay_clock(request: Request, exc: ReplayClockUnavailableError) -> JSONResponse:
        # Replay mode reads its time from the demo epoch row: with that row unreadable there is no time, and none is
        # made up. The same 503 as any other unreachable dependency, wherever in a route the clock was read.
        # model_validate, not keywords: mypy's pydantic plugin forbids the extension member `dependency` as a kwarg.
        problem = ProblemDraft.model_validate(
            {"type": DEPENDENCY_UNAVAILABLE, "title": "Dependency unavailable", "status": 503, "dependency": "database"}
        )
        return _respond(request, problem)

    @app.exception_handler(RequestValidationError)
    async def on_validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        # loc/msg/type only: `input` would echo the caller's payload back, and `ctx` may not be JSON serializable.
        errors = [{"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
        problem = ProblemDraft(title=_phrase(422), status=422, detail="Request validation failed")
        return _respond(request, problem, extra={"errors": errors})

    @app.exception_handler(StarletteHTTPException)
    async def on_http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        title = _phrase(exc.status_code)
        detail = str(exc.detail) if exc.detail != title else None
        # Keep headers Starlette sets itself (Allow on 405, WWW-Authenticate on 401).
        return _respond(request, ProblemDraft(title=title, status=exc.status_code, detail=detail), headers=exc.headers)

    @app.exception_handler(Exception)
    async def on_unhandled(request: Request, exc: Exception) -> JSONResponse:
        # Runs in Starlette's ServerErrorMiddleware, outside CorrelationIdMiddleware, so the header is set here.
        logger.error("request.unhandled", method=request.method, path=request.url.path, exc_info=exc)
        mark_exception_reported(exc)  # uvicorn re-logs every exception that escapes the app; tell it this one is done
        request_id = correlation_id.get()
        headers = {REQUEST_ID_HEADER: request_id} if request_id else None
        return _respond(request, ProblemDraft(title=_phrase(500), status=500), headers=headers)
