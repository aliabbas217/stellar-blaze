"""Contract suite for ``NotificationChannel``, run against the in-memory fakes and, from B3, the real channels.

Import it as ``from tests.unit.contract.notification_contract import check_notification_channel``.

The suite makes one ``send`` call. It cannot make a real channel fail on demand, so a real adapter is tested once per
outcome it can produce (a mock transport answering 201, then 410, ...) with the status it expects for each.
"""

from stellar_blaze.ports.notifications import DeliveryResult, DeliveryStatus, NotificationChannel, OutboundMessage


async def check_notification_channel(
    channel: NotificationChannel, message: OutboundMessage, expect: DeliveryStatus
) -> None:
    """Assert that ``channel`` honors the ``NotificationChannel`` port when sending ``message``.

    Checks:
        * ``send`` returns a result and does not raise, whatever happened to the delivery;
        * ``result.status`` is ``expect``;
        * ``result.channel`` is the channel's ``name``;
        * a ``FAILED`` result explains itself in a non-blank ``detail``.

    Args:
        channel: The channel under test, set up so that this send ends in ``expect``.
        message: The message to send.
        expect: The status the setup should produce.

    Raises:
        AssertionError: The channel breaks the port; the message names the channel and the audience.
    """
    where = f"{channel.name} sending a {message.audience.value} message"
    try:
        result = await channel.send(message)
    except Exception as exc:
        raise AssertionError(
            f"{where}: send raised {type(exc).__name__}: {exc}; a delivery failure must be returned as "
            f"DeliveryStatus.FAILED, not raised"
        ) from exc

    assert isinstance(result, DeliveryResult), f"{where}: send returned {type(result).__name__}, not a DeliveryResult"
    assert result.status is expect, (
        f"{where}: status {result.status.value!r}, expected {expect.value!r} (detail: {result.detail!r})"
    )
    assert result.channel == channel.name, (
        f"{where}: result.channel {result.channel!r} is not the channel's name {channel.name!r}"
    )
    if result.status is DeliveryStatus.FAILED:
        assert result.detail is not None, f"{where}: FAILED result carries no detail"
        assert result.detail.strip(), f"{where}: FAILED result carries a blank detail"
