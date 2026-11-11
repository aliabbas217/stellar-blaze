"""Port for outbound alerts, and the only payload that may cross it.

ADR 0002: a message carries a site id, an audience, a level code and a template id (plus the crew id of a crew
message and the time the level takes effect), never a worker id or free text. ``extra="forbid"`` makes that a property
of the type: adding a field is a deliberate change here, not a keyword someone passes.
"""

from enum import StrEnum
from typing import Protocol, Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, model_validator

from stellar_blaze.domain.risk.levels import AlertLevel


class Audience(StrEnum):
    """Who an alert is addressed to."""

    SITE = "site"
    CREW = "crew"


class OutboundMessage(BaseModel):
    """One alert to deliver, identified by a reviewed template; the channel renders the text."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    site_id: str
    audience: Audience
    crew_id: str | None
    level: AlertLevel
    valid_from: AwareDatetime
    template_id: str

    @model_validator(mode="after")
    def crew_id_matches_audience(self) -> Self:
        """A crew message names its crew; a site message has none."""
        if self.audience is Audience.CREW and self.crew_id is None:
            raise ValueError("crew_id is required when audience is 'crew'")
        if self.audience is Audience.SITE and self.crew_id is not None:
            raise ValueError("crew_id must be None when audience is 'site'")
        return self


class DeliveryStatus(StrEnum):
    """What happened to one message on one channel."""

    DELIVERED = "delivered"
    FAILED = "failed"
    SKIPPED = "skipped"
    """The channel deliberately made no attempt (for example nothing is subscribed to the target); not an error."""


class DeliveryResult(BaseModel):
    """The outcome of ``NotificationChannel.send``."""

    model_config = ConfigDict(frozen=True)

    channel: str
    status: DeliveryStatus
    provider_message_id: str | None = None
    detail: str | None = None


class NotificationChannel(Protocol):
    """One way of delivering an alert (Web Push, a recording fake, ...)."""

    @property
    def name(self) -> str:
        """Short identifier of the channel; every ``DeliveryResult.channel`` it returns equals it."""
        ...

    async def send(self, message: OutboundMessage) -> DeliveryResult:
        """Deliver the message.

        A delivery failure is a result, never an exception: the channel returns ``DeliveryStatus.FAILED`` and says why
        in ``detail``, so one failing channel cannot stop the others.
        """
        ...
