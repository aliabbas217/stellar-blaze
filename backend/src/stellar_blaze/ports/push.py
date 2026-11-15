"""Port of Web Push subscriptions (ADR 0058 decision 3).

The endpoint is the natural key within an epoch and is stored for delivery only: it is never logged, and every log line,
audit row and error carries the subscription ``id`` instead.
"""

from collections.abc import Sequence
from typing import Final, Literal, Protocol

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from stellar_blaze.ports.notifications import DeliveryResult, OutboundMessage

# The public subscribe route is capped at this many subscriptions per crew and epoch. The dispatch gives EACH
# operator-recorded stop (a crew-lead stop, never a forecast-driven red) its own send lane of exactly this size, so that
# stop's recipients all send at once whatever any other event or stop does; ``ORDINARY_SEND_CONCURRENCY`` is the one
# shared lane of every other event (a forecast red included, which can therefore be delayed by hanging subscriptions).
#
# A channel that pools connections must allow at least ``CONNECTION_LIMIT``: the ordinary lane plus
# ``SIMULTANEOUS_STOPS_PROVISIONED`` stop lanes. 4 is the number of crews of the demo site (all of them stopped in the
# same cycle is the worst case of one site; operator stops are rate limited to 30 per 60 s per token and almost never
# coincide). Beyond that bound nothing fails at once: the excess sends wait for a free connection INSIDE their
# per-delivery deadline and, if none frees up, fail with ``deadline`` (a stop's recipients that cannot connect in time
# are failed and counted; the one bounded retry of ``application.alerts`` applies only to a transient failure with time
# left in the send deadline, never to a send that waited for a connection until the deadline). Raise the constant
# (and the host's file-descriptor limit) to provision more.
MAX_SUBSCRIPTIONS_PER_CREW: Final = 200
ORDINARY_SEND_CONCURRENCY: Final = 16
SIMULTANEOUS_STOPS_PROVISIONED: Final = 4
CONNECTION_LIMIT: Final = ORDINARY_SEND_CONCURRENCY + SIMULTANEOUS_STOPS_PROVISIONED * MAX_SUBSCRIPTIONS_PER_CREW


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


class PushStoreError(Exception):
    """The subscription store failed. Carries no data: the cause may hold statement parameters (an endpoint and keys),
    so callers raise this ``from None`` and the log names only the class of the cause."""


class SubscriptionCapError(Exception):
    """A NEW subscription would exceed the site or crew cap (``scope``). Carries no data."""

    def __init__(self, scope: Literal["site", "crew"]) -> None:
        super().__init__(scope)
        self.scope = scope


class PushSubscriptionStore(Protocol):
    async def id_for_endpoint(self, endpoint: str, epoch_id: int) -> str | None:
        """The id of the subscription with this endpoint in the epoch, or ``None``."""
        ...

    async def count_for_site(self, site_id: str, epoch_id: int) -> int:
        """How many subscriptions the site holds in the epoch (crew-targeted ones included)."""
        ...

    async def count_for_crew(self, crew_id: str, epoch_id: int) -> int:
        """How many subscriptions name this crew in the epoch."""
        ...

    async def upsert_by_endpoint(
        self, sub: NewSubscription, epoch_id: int, *, site_cap: int | None = None, crew_cap: int | None = None
    ) -> str:
        """Store ``sub`` and return its id; when the epoch already holds this endpoint, return the existing id and
        change nothing (the first row's keys and targets stay; a repeat is not counted against a cap).

        With ``site_cap`` or ``crew_cap`` the count and the insert are ONE atomic step (concurrent callers cannot
        both pass a check that only one of them fits under): a new row that would make the site hold more than
        ``site_cap`` subscriptions, or ``sub.crew_id``'s crew more than ``crew_cap``, is not stored.

        Raises:
            SubscriptionCapError: The new row would exceed a cap (nothing was stored).
        """
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


class PushChannel(Protocol):
    """A channel that delivers one alert to one subscription (``WebPushChannel``, a recording fake).

    ``NotificationChannel.send`` takes only a message, with no subscription and no epoch, so it cannot address a Web
    Push endpoint: the dispatch resolves the recipients and calls ``send_to`` once per subscription. As there, a
    delivery failure is a ``DeliveryResult`` (``FAILED`` with ``detail``; ``gone:<status>`` for a subscription the push
    service reports expired), never an exception, and nothing that identifies the subscription is logged except its id.
    """

    @property
    def name(self) -> str: ...

    @property
    def timeout_s(self) -> float:
        """The longest one ``send_to`` may take: the dispatch bounds every send by this plus a margin."""
        ...

    async def send_to(
        self, sub: SubscriptionRecord, message: OutboundMessage, *, extra_host_suffixes: Sequence[str] = ()
    ) -> DeliveryResult:
        """Deliver ``message`` to ``sub``. ``extra_host_suffixes`` is the operator's extension of the endpoint host
        allow-list (``RuntimeConfig.push_extra_host_suffixes`` of the config the run holds, ADR 0067): a channel that
        reaches an endpoint over the network refuses, FAILED ``blocked``, a host that is on neither the built-in list
        (``ports.push_endpoint``) nor these suffixes, before any connection is made."""
        ...

    async def aclose(self) -> None:
        """Release what the channel holds (an HTTP session); safe to call twice."""
        ...
