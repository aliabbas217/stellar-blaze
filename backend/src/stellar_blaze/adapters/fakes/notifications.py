"""In-memory notification channels for tests: one that delivers and remembers, one that always fails."""

from stellar_blaze.ports.notifications import DeliveryResult, DeliveryStatus, OutboundMessage


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
