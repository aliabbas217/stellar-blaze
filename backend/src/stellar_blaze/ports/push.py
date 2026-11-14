"""Port of Web Push subscriptions (ADR 0058 decision 3).

The endpoint is the natural key within an epoch and is stored for delivery only: it is never logged, and every log line,
audit row and error carries the subscription ``id`` instead.
"""

from collections.abc import Sequence
from typing import Protocol

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class NewSubscription(BaseModel):
    """What the browser gave (``endpoint``, the two keys, the optional expiry) and what it subscribed to."""

    # The endpoint, p256dh and auth are bearer capabilities: keep them out of repr, so a log line of a record is safe.
    model_config = ConfigDict(frozen=True, extra="forbid")

    endpoint: str = Field(repr=False)
    p256dh: str = Field(repr=False)
    auth: str = Field(repr=False)
    expiration_time: int | None = None
    site_id: str
    crew_id: str | None = None


class SubscriptionRecord(NewSubscription):
    id: str
    epoch_id: int
    created_at: AwareDatetime


class PushSubscriptionStore(Protocol):
    async def upsert_by_endpoint(self, sub: NewSubscription, epoch_id: int) -> str:
        """Store ``sub`` and return its id; when the epoch already holds this endpoint, return the existing id and
        change nothing (the first row's keys and targets stay)."""
        ...

    async def delete(self, subscription_id: str) -> None:
        """Delete the subscription; idempotent (an unknown id is not an error)."""
        ...

    async def delete_gone(self, subscription_id: str) -> None:
        """Delete a subscription the push service reported expired (404 or 410); idempotent."""
        ...

    async def for_site(self, site_id: str, epoch_id: int) -> Sequence[SubscriptionRecord]:
        """Every subscription of the site in the epoch (crew-targeted ones included), oldest first."""
        ...

    async def for_crew(self, crew_id: str, epoch_id: int) -> Sequence[SubscriptionRecord]:
        """The subscriptions that name this crew in the epoch, oldest first."""
        ...
