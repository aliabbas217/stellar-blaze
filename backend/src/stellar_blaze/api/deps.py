"""FastAPI dependencies shared by the routers."""

from typing import Annotated

from fastapi import Depends, Request

from stellar_blaze.config import Settings


def get_app_settings(request: Request) -> Settings:
    """The settings ``create_app`` was given, not the process-wide cache, so tests and tools can build an app freely."""
    settings: Settings = request.app.state.settings
    return settings


SettingsDep = Annotated[Settings, Depends(get_app_settings)]
