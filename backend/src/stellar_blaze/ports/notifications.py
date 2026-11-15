"""Port for outbound alerts, and the only payload that may cross it.

ADR 0002: a message carries a site id, an audience, a level code and a template id (plus the crew id of a crew
message and the time the level takes effect), never a worker id or free text. ``extra="forbid"`` makes that a property
of the type: adding a field is a deliberate change here, not a keyword someone passes.
"""

from enum import StrEnum
from typing import Protocol, Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

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
    """The outcome of ``NotificationChannel.send``.

    The last four fields say HOW a failure failed, so the dispatch can classify it without parsing ``detail`` (ADR 0058,
    second entry of 2026-11-15: one bounded retry of a transient failure for an operator-recorded stop). A channel is
    ONE attempt per call and fills what it knows; every field is optional with a neutral default.

    * ``http_status``: the status the push service answered (404 and 410 included), ``None`` when none was read.
    * ``retry_after_s``: the ``Retry-After`` it sent, in seconds, at most one day; ``None`` when it sent none. A header
      that could not be read is the one-day maximum, never ``None`` (an unreadable hint is not permission to retry).
    * ``timed_out``: the attempt ended in a timeout (the channel's own, or the dispatch's per-attempt cut).
    * ``attempts``: how many attempts the dispatch made for this result (set by the dispatch; a channel leaves it 1).
    """

    model_config = ConfigDict(frozen=True)

    channel: str
    status: DeliveryStatus
    provider_message_id: str | None = None
    detail: str | None = None
    http_status: int | None = None
    retry_after_s: float | None = Field(default=None, ge=0)
    timed_out: bool = False
    attempts: int = Field(default=1, ge=1)


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
