"""FastAPI dependencies shared by the routers."""

from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncEngine

from stellar_blaze.config import Settings


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


SettingsDep = Annotated[Settings, Depends(get_app_settings)]
EngineDep = Annotated[AsyncEngine, Depends(get_engine)]
