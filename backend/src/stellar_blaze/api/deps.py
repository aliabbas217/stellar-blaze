"""FastAPI dependencies shared by the routers."""

from typing import Annotated

import structlog
from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncEngine

from stellar_blaze.application.runtime_config import ConfigSnapshot, ConfigUnavailableError
from stellar_blaze.composition import Runtime
from stellar_blaze.config import Settings
from stellar_blaze.errors import DEPENDENCY_UNAVAILABLE, DomainProblem


def get_app_settings(request: Request) -> Settings:
    """The settings ``create_app`` was given, not the process-wide cache, so tests and tools can build an app freely."""
    settings: Settings = request.app.state.settings
    return settings


def get_engine(request: Request) -> AsyncEngine:
    """The database engine the application lifespan created (and will dispose)."""
    engine: AsyncEngine | None = getattr(request.app.state, "engine", None)
    if engine is None:
        msg = "No database engine: it is created by the application lifespan. Run the app through its lifespan."
        raise RuntimeError(msg)
    return engine


def get_runtime(request: Request) -> Runtime:
    """The runtime (rulesets, models, active config) the application lifespan built at startup."""
    runtime: Runtime | None = getattr(request.app.state, "runtime", None)
    if runtime is None:
        msg = "No runtime: it is built by the application lifespan. Run the app through its lifespan."
        raise RuntimeError(msg)
    return runtime


async def get_snapshot(runtime: Annotated[Runtime, Depends(get_runtime)]) -> ConfigSnapshot:
    """The active config snapshot, read once for the request, with its identity bound to the request's log context.

    A request keeps the snapshot it read until it finishes, so versions never mix inside one decision; FastAPI caches a
    dependency per request, so every use of ``SnapshotDep`` in one request is this one snapshot. It is ``async`` on
    purpose: a sync dependency runs in a worker thread with a copy of the context, and what it binds would never reach
    the handler's log lines.

    Raises:
        DomainProblem: 503 ``dependency-unavailable`` (``dependency: config``) when no config is loaded.
    """
    try:
        snapshot = runtime.config.current()
    except ConfigUnavailableError as exc:
        raise DomainProblem(
            type_=DEPENDENCY_UNAVAILABLE, title="Dependency unavailable", status=503, dependency="config"
        ) from exc
    structlog.contextvars.bind_contextvars(
        config_version=snapshot.version_id,
        config_sha256=snapshot.sha256,
        ruleset_pin=snapshot.config.ruleset_pin,
        model_id=snapshot.config.model_id,
    )
    return snapshot


SettingsDep = Annotated[Settings, Depends(get_app_settings)]
EngineDep = Annotated[AsyncEngine, Depends(get_engine)]
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
SnapshotDep = Annotated[ConfigSnapshot, Depends(get_snapshot)]
