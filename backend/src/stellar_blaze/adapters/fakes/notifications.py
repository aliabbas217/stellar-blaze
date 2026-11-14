"""In-memory notification channels for tests: one that delivers and remembers, one that always fails."""

from collections.abc import Mapping

from stellar_blaze.ports.notifications import DeliveryResult, DeliveryStatus, OutboundMessage
from stellar_blaze.ports.push import SubscriptionRecord


class RecordingChannel:
    """Delivers every message and keeps it, in order, in ``sent``."""

    name = "recording"

    def __init__(self) -> None:
        self.sent: list[OutboundMessage] = []

    async def send(self, message: OutboundMessage) -> DeliveryResult:
        self.sent.append(message)
        return DeliveryResult(
            channel=self.name,
            status=DeliveryStatus.DELIVERED,
            provider_message_id=f"recorded-{len(self.sent)}",
        )


class FailingChannel:
    """Fails every message the way a real channel does: it returns ``FAILED`` with ``detail``, it does not raise."""

    name = "failing"

    def __init__(self, detail: str = "injected failure") -> None:
        self.detail = detail

    async def send(self, message: OutboundMessage) -> DeliveryResult:
        return DeliveryResult(channel=self.name, status=DeliveryStatus.FAILED, detail=self.detail)


class RecordingPushChannel:
    """A ``PushChannel`` for tests and the replay demo: delivers to every subscription and keeps ``(subscription id,
    message)`` in ``sent``; ``results`` overrides the result of a subscription id, ``raises`` makes ids raise (a channel
    that breaks its contract), ``closed`` says ``aclose`` ran."""

    name = "recording"

    def __init__(self, results: Mapping[str, DeliveryResult] | None = None, raises: set[str] | None = None) -> None:
        self.results: Mapping[str, DeliveryResult] = results or {}
        self.raises: set[str] = raises or set()
        self.sent: list[tuple[str, OutboundMessage]] = []
        self.closed = False

    async def send_to(self, sub: SubscriptionRecord, message: OutboundMessage) -> DeliveryResult:
        if sub.id in self.raises:
            raise RuntimeError("injected channel fault")
        self.sent.append((sub.id, message))
        return self.results.get(sub.id) or DeliveryResult(
            channel=self.name, status=DeliveryStatus.DELIVERED, provider_message_id=f"recorded-{len(self.sent)}"
        )

    async def aclose(self) -> None:
        self.closed = True
