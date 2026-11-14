"""Health probes: liveness (is the process up) and readiness (can it serve)."""

import asyncio
from typing import Literal

import structlog
from fastapi import APIRouter
from pydantic import ConfigDict
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from stellar_blaze.api.deps import ConfigPollerDep, EngineDep, RuntimeDep, SettingsDep
from stellar_blaze.api.responses import problem_responses
from stellar_blaze.api.schemas import ResponseModel
from stellar_blaze.errors import DEPENDENCY_UNAVAILABLE, DomainProblem
from stellar_blaze.logging import bind_config_identity
from stellar_blaze.redaction import describe_exception

router = APIRouter(prefix="/health", tags=["health"])
logger = structlog.stdlib.get_logger(__name__)


class LiveResponse(ResponseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"] = "ok"


class ReadyChecks(ResponseModel):
    model_config = ConfigDict(extra="forbid")

    database: Literal["ok"] = "ok"
    # "stale": serving the last good config, but the latest activation could not be read or was refused (logged once per
    # change). "missing" (no config at all) is never a 200: it is the 503 below.
    config: Literal["ok", "stale"] = "ok"


class ReadyResponse(ResponseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"] = "ok"
    checks: ReadyChecks


@router.get("/live", summary="Liveness probe", responses=problem_responses())
async def health_live() -> LiveResponse:
    """The process is up and serving requests. Checks no dependency, so an orchestrator never restarts on a DB blip."""
    return LiveResponse()


@router.get(
    "/ready",
    summary="Readiness probe",
    responses=problem_responses("dependency-unavailable"),
)
async def health_ready(
    engine: EngineDep, settings: SettingsDep, poller: ConfigPollerDep, runtime: RuntimeDep
) -> ReadyResponse:
    """The API can serve requests: its database answers a trivial query within the readiness timeout, and it has a
    runtime config to decide with.

    Answers 503 (problem details, ``dependency: database``) when the database does not answer, and 503 with
    ``dependency: config`` when no config has been loaded (nothing seeded, or the database was down at startup). A
    config that is loaded but cannot follow the latest activation is still ready: ``checks.config`` says ``stale``.
    """
    # One budget (SB_READINESS_TIMEOUT_S) for connecting and for SELECT 1: a hung database must not hang the probe.
    try:
        async with asyncio.timeout(settings.readiness_timeout_s), engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
    except (SQLAlchemyError, OSError, TimeoutError) as exc:
        # The type, the message and the cause it was raised from, credentials masked (the class alone does not tell a
        # refused connection from a failed login or a timeout); no traceback, because a failing probe repeats every few
        # seconds. The response names the dependency, nothing else.
        logger.warning("health.ready.database_unavailable", error=describe_exception(exc))
        raise DomainProblem(
            type_=DEPENDENCY_UNAVAILABLE, title="Dependency unavailable", status=503, dependency="database"
        ) from exc
    config_status = poller.status
    if config_status == "missing":
        raise DomainProblem(
            type_=DEPENDENCY_UNAVAILABLE, title="Dependency unavailable", status=503, dependency="config"
        )
    bind_config_identity(runtime.config.current())  # the probe's own log line names the config this replica serves
    return ReadyResponse(checks=ReadyChecks(config=config_status))
