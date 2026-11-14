"""Employer access tokens and the rate-limited dependencies of the employer operations (ADR 0051 decision 5).

``SB_ACCESS_TOKENS`` is JSON ``{sha256(token): {"actor", "role": "employer", "employer_id"}}``. A request presents the
token as a bearer; its SHA-256 is compared with ``hmac.compare_digest`` against EVERY stored key (no early exit), so the
time taken does not say which key was close. No token or an unknown one is 401 ``unauthorized`` with
``WWW-Authenticate: Bearer``.

The dependencies are built on ``security.employer_bearer`` so the OpenAPI security requirement is the same as with the
bare scheme. Authentication always runs before the limit (an unauthenticated caller costs a bucket nothing):

* ``EmployerDep``: token + the general bucket (``EMPLOYER_LIMITS``);
* ``StopEmployerDep``: token + the stop's OWN bucket only (``STOP_LIMITS``), never the general one: no other limit can
  block a stop;
* ``ResetEmployerDep``: token + the reset limits + the general bucket, all admitted or none charged.
"""

import hashlib
import hmac
import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Annotated, Any, Final

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, ConfigDict, RootModel

from stellar_blaze.api.limiter import RateLimitedError, RateLimiter
from stellar_blaze.api.rate_limits import DEMO_RESET_LIMITS, EMPLOYER_LIMITS, STOP_BUCKET, STOP_LIMITS
from stellar_blaze.api.security import employer_bearer
from stellar_blaze.application.services import Principal
from stellar_blaze.errors import RATE_LIMITED, UNAUTHORIZED, DomainProblem

__all__ = [
    "EmployerDep",
    "Principal",
    "ResetEmployerDep",
    "StopEmployerDep",
    "parse_access_tokens",
    "token_key",
]

GENERAL_BUCKET: Final = "employer"
RESET_BUCKET: Final = "reset"


class _Entry(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    actor: str
    role: str
    employer_id: str


_Tokens = RootModel[dict[str, _Entry]]


def token_key(token: str) -> str:
    """The SHA-256 hex digest a token is stored and rate-limited under."""
    return hashlib.sha256(token.encode()).hexdigest()


def parse_access_tokens(raw: str) -> Mapping[str, Principal]:
    """The principals by token SHA-256 from the ``SB_ACCESS_TOKENS`` JSON.

    Raises:
        ValueError: Not JSON of the documented shape, a key that is not 64 lower-case hex characters, or a role other
            than ``employer``.
    """
    try:
        entries = _Tokens.model_validate(json.loads(raw)).root
    except (json.JSONDecodeError, ValueError) as error:
        raise ValueError("SB_ACCESS_TOKENS must be JSON {sha256: {actor, role, employer_id}}") from error
    principals: dict[str, Principal] = {}
    for key, entry in entries.items():
        if len(key) != 64 or key != key.lower() or any(c not in "0123456789abcdef" for c in key):
            raise ValueError("SB_ACCESS_TOKENS keys must be the SHA-256 of a token: 64 lower-case hex characters")
        if entry.role != "employer":
            raise ValueError(f"SB_ACCESS_TOKENS: role {entry.role!r} is not supported (only 'employer')")
        principals[key] = Principal(actor=entry.actor, role="employer", employer_id=entry.employer_id)
    return principals


def _unauthorized(detail: str) -> DomainProblem:
    return DomainProblem(
        type_=UNAUTHORIZED,
        title="Unauthorized",
        status=401,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


@dataclass(frozen=True)
class _Authenticated:
    principal: Principal
    key: str


async def _authenticate(
    request: Request, credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(employer_bearer)]
) -> _Authenticated:
    if credentials is None or not credentials.credentials:
        raise _unauthorized("A bearer token is required.")
    tokens: Mapping[str, Principal] = request.app.state.tokens
    presented = token_key(credentials.credentials)
    found: Principal | None = None
    for key, principal in tokens.items():  # every key is compared: no early exit
        if hmac.compare_digest(presented, key):
            found = principal
    if found is None:
        raise _unauthorized("This token is not known.")
    return _Authenticated(found, presented)


AuthDep = Annotated[_Authenticated, Depends(_authenticate)]


def _charge(request: Request, auth: _Authenticated, buckets: list[tuple[str, Any]]) -> Principal:
    limiter: RateLimiter = request.app.state.limiter
    try:
        limiter.charge(auth.key, buckets)
    except RateLimitedError as error:
        raise DomainProblem(
            type_=RATE_LIMITED,
            title="Rate limited",
            status=429,
            detail="Too many requests; wait before trying again.",
            headers={"Retry-After": str(error.retry_after)},
        ) from error
    return auth.principal


async def _employer(request: Request, auth: AuthDep) -> Principal:
    return _charge(request, auth, [(GENERAL_BUCKET, EMPLOYER_LIMITS)])


async def _stop_employer(request: Request, auth: AuthDep) -> Principal:
    return _charge(request, auth, [(STOP_BUCKET, STOP_LIMITS)])


async def _reset_employer(request: Request, auth: AuthDep) -> Principal:
    return _charge(request, auth, [(RESET_BUCKET, DEMO_RESET_LIMITS), (GENERAL_BUCKET, EMPLOYER_LIMITS)])


EmployerDep = Annotated[Principal, Depends(_employer)]
StopEmployerDep = Annotated[Principal, Depends(_stop_employer)]
ResetEmployerDep = Annotated[Principal, Depends(_reset_employer)]
