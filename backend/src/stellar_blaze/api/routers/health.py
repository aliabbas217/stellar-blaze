"""Health probes: liveness (is the process up) and readiness (can it serve)."""

import asyncio
from typing import Literal

import structlog
from fastapi import APIRouter
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from stellar_blaze.api.deps import EngineDep, SettingsDep
from stellar_blaze.api.schemas import ResponseModel
from stellar_blaze.errors import DEPENDENCY_UNAVAILABLE, DomainProblem, Problem

router = APIRouter(prefix="/health", tags=["health"])
logger = structlog.stdlib.get_logger(__name__)


class LiveResponse(ResponseModel):
    status: Literal["ok"] = "ok"


class ReadyChecks(ResponseModel):
    database: Literal["ok"] = "ok"


class ReadyResponse(ResponseModel):
    status: Literal["ok"] = "ok"
    checks: ReadyChecks


@router.get("/live", summary="Liveness probe")
async def health_live() -> LiveResponse:
    """The process is up and serving requests. Checks no dependency, so an orchestrator never restarts on a DB blip."""
    return LiveResponse()


@router.get(
    "/ready",
    summary="Readiness probe",
    responses={503: {"model": Problem, "description": "A required dependency (the database) is unavailable."}},
)
async def health_ready(engine: EngineDep, settings: SettingsDep) -> ReadyResponse:
    """The API can serve requests: its database answers a trivial query within the readiness timeout.

    Answers 503 (problem details, ``dependency: database``) when it does not.
    """
    # One budget (SB_READINESS_TIMEOUT_S) for connecting and for SELECT 1: a hung database must not hang the probe.
    try:
        async with asyncio.timeout(settings.readiness_timeout_s), engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
    except (SQLAlchemyError, OSError, TimeoutError) as exc:
        # The exception class only: the message can carry the host, port or user, and a failing probe repeats every few
        # seconds, so no traceback either. The response names the dependency, nothing else.
        logger.warning("health.ready.database_unavailable", error=type(exc).__name__)
        raise DomainProblem(
            type_=DEPENDENCY_UNAVAILABLE, title="Dependency unavailable", status=503, dependency="database"
        ) from exc
    return ReadyResponse(checks=ReadyChecks())
