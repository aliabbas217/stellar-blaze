"""Health probes."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/health", tags=["health"])


class LiveResponse(BaseModel):
    status: Literal["ok"] = "ok"


@router.get("/live", summary="Liveness probe")
async def live() -> LiveResponse:
    """The process is up and serving requests. Checks no dependency, so an orchestrator never restarts on a DB blip."""
    return LiveResponse()
