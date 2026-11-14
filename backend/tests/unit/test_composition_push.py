"""``composition.build_push_channel``: no VAPID settings means no channel; with them, the Web Push channel."""

import pytest
from pydantic import SecretStr

from stellar_blaze.adapters.fakes.push import InMemoryPushStore
from stellar_blaze.adapters.notifications.webpush import WebPushChannel
from stellar_blaze.composition import build_push_channel
from stellar_blaze.config import Settings

pytestmark = pytest.mark.unit

DATABASE = SecretStr("postgresql+asyncpg://u:p@127.0.0.1:1/db")


def test_without_vapid_settings_there_is_no_channel() -> None:
    assert build_push_channel(Settings(_env_file=None, database_url=DATABASE), InMemoryPushStore()) is None


def test_with_vapid_settings_it_is_the_web_push_channel_and_never_shows_the_key() -> None:
    settings = Settings(
        _env_file=None,
        database_url=DATABASE,
        vapid_private_key=SecretStr("very-secret-key"),
        vapid_subject="mailto:ops@example.org",
    )

    channel = build_push_channel(settings, InMemoryPushStore())

    assert isinstance(channel, WebPushChannel)
    assert channel.name == "webpush"
    assert "very-secret-key" not in repr(channel)
