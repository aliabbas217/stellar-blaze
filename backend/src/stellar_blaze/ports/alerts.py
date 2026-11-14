"""Port of alert events (ADR 0058 decision 1; supplement R-O: the dispatch cadence is recorded).

``alert_event`` is append-only, so ``delivered`` and ``failed`` are the counts at insert time: a dispatcher that wants
them correct inserts after it has sent (the dedupe key then no longer claims the event before sending).
"""

from typing import Literal, Protocol

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from stellar_blaze.domain.risk.levels import AlertLevel


class AlertEventInput(BaseModel):
    """An alert event to store. ``crew_id`` is ``None`` for a site event. All five identity fields are given."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    site_id: str
    audience: Literal["site", "crew"]
    crew_id: str | None
    epoch_id: int
    level: AlertLevel
    valid_from: AwareDatetime
    template_id: str
    kind: Literal["escalate", "deescalate"]
    dedupe_key: str
    delivered: int = Field(default=0, ge=0)
    failed: int = Field(default=0, ge=0)
    dispatch_interval_minutes: int = Field(ge=1, le=30)
    ruleset_id: str
    ruleset_sha256: str
    model_id: str | None
    config_version_id: int
    config_sha256: str


class AlertRecord(AlertEventInput):
    id: int
    created_at: AwareDatetime


class AlertStore(Protocol):
    async def last_for_target(self, site_id: str, crew_id: str | None, epoch_id: int) -> AlertRecord | None:
        """The latest event of this target in this epoch (``crew_id=None``: the site's own events), or ``None``."""
        ...

    async def exists(self, epoch_id: int, dedupe_key: str) -> bool:
        """Whether an event with this ``(epoch_id, dedupe_key)`` is stored: asked BEFORE sending, so a stored event is
        never sent again."""
        ...

    async def insert(self, event: AlertEventInput) -> AlertRecord | None:
        """Store the event; ``None`` when its ``(epoch_id, dedupe_key)`` exists already (nothing changed)."""
        ...
