"""ADR 0044 section 3 / ADR 0010: the poller re-validates the served config when the Asia/Dubai date changes.

A snapshot is validated when it loads. A ruleset's ``effective_to`` passing at midnight Dubai time can make a pin that
was valid yesterday invalid today, so the poller (which already runs) checks the held snapshot again on the first poll
of each new date, and re-reads an activation it refused on an earlier date.
"""

from datetime import UTC, date, datetime

import pytest
import time_machine

from stellar_blaze.adapters.config.models import scan_models
from stellar_blaze.adapters.fakes.config_store import InMemoryConfigStore
from stellar_blaze.application.runtime_config import ConfigPoller, ConfigService, ConfigStatus, SnapshotHolder
from stellar_blaze.composition import dubai_today
from stellar_blaze.config import Settings
from stellar_blaze.domain.config.runtime import ConfigViolation, RuntimeConfig, config_body
from stellar_blaze.domain.rules.catalog import RulesetCatalog
from stellar_blaze.logging import configure_logging
from tests.unit.config.support import FIXTURE_MODELS, log_events
from tests.unit.rules.support import loaded, make_ruleset

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]

OLD = "ae-heat-2025.1"
NEW = "ae-heat-2025.2"
ACTOR = "ali"
REASON = "pin a ruleset for the drill"
# Dubai is UTC+4 with no daylight saving: 19:59:59Z on the 14th is 23:59:59 in Dubai, 20:00:01Z is already the 15th.
BEFORE_MIDNIGHT = datetime(2026, 11, 14, 19, 59, 59, tzinfo=UTC)
AFTER_MIDNIGHT = datetime(2026, 11, 14, 20, 0, 1, tzinfo=UTC)
FIRST_DAY_OF_NEW = date(2026, 11, 15)


def status_of(poller: ConfigPoller) -> ConfigStatus:
    """The poller's status, read through a call so that mypy does not carry a narrowing across an ``await``."""
    return poller.status


class CountingService(ConfigService):
    """A service that counts the validations it is asked for (the poller must not validate on every poll)."""

    validations = 0

    def validate(self, config: RuntimeConfig) -> list[ConfigViolation]:
        self.validations += 1
        return super().validate(config)


def two_rulesets() -> RulesetCatalog:
    """OLD ends with 14 Nov (Dubai) and NEW starts on the 15th: no overlap, no gap."""
    return RulesetCatalog(
        [
            loaded(make_ruleset(OLD, effective_to=FIRST_DAY_OF_NEW)),
            loaded(make_ruleset(NEW, effective_from=FIRST_DAY_OF_NEW)),
        ]
    )


class Rig:
    """A prod service on the real Dubai clock (the seam time-machine moves), its holder, store and poller."""

    def __init__(self) -> None:
        self.store = InMemoryConfigStore()
        self.holder = SnapshotHolder()
        self.service = CountingService(
            self.store, two_rulesets(), scan_models(FIXTURE_MODELS), self.holder, dubai_today, prod=True
        )
        self.poller = ConfigPoller(self.service, self.holder, 0.02)

    async def activate(self, config: RuntimeConfig) -> int:
        """Propose and activate ``config`` as the next activation; returns the activation id."""
        latest = await self.store.latest_activation()
        version = await self.service.propose(config, ACTOR, REASON)
        record = await self.service.activate(version.id, None if latest is None else latest.id, ACTOR, REASON)
        return record.id


async def test_poller_revalidates_after_midnight_dubai(capsys: pytest.CaptureFixture[str], settings: Settings) -> None:
    configure_logging(settings)
    with time_machine.travel(BEFORE_MIDNIGHT, tick=False) as clock:
        rig = Rig()
        await rig.activate(RuntimeConfig(ruleset_pin=OLD))
        await rig.poller.poll_once()
        assert status_of(rig.poller) == "ok"
        capsys.readouterr()

        clock.move_to(AFTER_MIDNIGHT)
        for _ in range(3):
            await rig.poller.poll_once()

    assert status_of(rig.poller) == "stale"
    out = capsys.readouterr().out
    (rejected,) = log_events(out, "config_rejected")  # once per date, not once per poll
    assert rejected["codes"] == ["pin-out-of-range"]
    assert "ruleset_pin" in rejected["violations"][0]
    (changed,) = log_events(out, "config.status_changed")
    assert (changed["status"], changed["reason"], changed["previous"]) == ("stale", "rejected-activation", "ok")
    # The last good snapshot keeps serving: a refusal makes readiness `stale`, it does not drop the config.
    assert rig.holder.current().config.ruleset_pin == OLD


async def test_a_pin_that_still_covers_the_new_date_stays_ok(
    capsys: pytest.CaptureFixture[str], settings: Settings
) -> None:
    configure_logging(settings)
    with time_machine.travel(BEFORE_MIDNIGHT, tick=False) as clock:
        rig = Rig()
        await rig.activate(RuntimeConfig())  # no pin: resolved by date
        await rig.poller.poll_once()
        capsys.readouterr()

        clock.move_to(AFTER_MIDNIGHT)
        await rig.poller.poll_once()

    assert status_of(rig.poller) == "ok"
    assert log_events(capsys.readouterr().out, "config_rejected") == []


async def test_the_held_snapshot_is_validated_once_per_date_not_once_per_poll() -> None:
    with time_machine.travel(BEFORE_MIDNIGHT, tick=False) as clock:
        rig = Rig()
        await rig.activate(RuntimeConfig(ruleset_pin=OLD))
        await rig.poller.poll_once()  # the first poll of this date
        after_first_poll = rig.service.validations

        for _ in range(5):
            await rig.poller.poll_once()
        assert rig.service.validations == after_first_poll

        clock.move_to(AFTER_MIDNIGHT)
        await rig.poller.poll_once()
        assert rig.service.validations == after_first_poll + 1
        await rig.poller.poll_once()
        assert rig.service.validations == after_first_poll + 1


async def test_a_refused_activation_is_read_again_on_the_first_poll_after_the_date_it_was_refused_on() -> None:
    with time_machine.travel(BEFORE_MIDNIGHT, tick=False) as clock:
        rig = Rig()
        await rig.activate(RuntimeConfig())
        await rig.poller.poll_once()
        # A row written by hand that pins NEW, which does not cover 14 Nov: refused today, valid from tomorrow.
        body = config_body(RuntimeConfig(ruleset_pin=NEW))
        hand = rig.store.add_raw_version(body)
        rig.store.add_raw_activation(hand.id)
        rig.store.calls.clear()

        for _ in range(3):
            await rig.poller.poll_once()
        assert rig.store.calls.count("get_version") == 1  # refused once: not re-read on every poll of the same date
        assert status_of(rig.poller) == "stale"
        assert rig.holder.current().version_id != hand.id

        clock.move_to(AFTER_MIDNIGHT)
        await rig.poller.poll_once()

    assert rig.store.calls.count("get_version") == 2
    assert rig.holder.current().version_id == hand.id
    assert rig.holder.current().config.ruleset_pin == NEW
    assert status_of(rig.poller) == "ok"


async def test_a_valid_activation_replaces_a_snapshot_that_failed_revalidation() -> None:
    with time_machine.travel(BEFORE_MIDNIGHT, tick=False) as clock:
        rig = Rig()
        await rig.activate(RuntimeConfig(ruleset_pin=OLD))
        await rig.poller.poll_once()
        clock.move_to(AFTER_MIDNIGHT)
        await rig.poller.poll_once()
        assert status_of(rig.poller) == "stale"

        # The operator rolls forward to the ruleset that covers the new date; the poller adopts it and clears.
        await rig.activate(RuntimeConfig(ruleset_pin=NEW))
        await rig.poller.poll_once()

    assert status_of(rig.poller) == "ok"
    assert rig.holder.current().config.ruleset_pin == NEW


async def test_a_gap_in_the_catalog_on_the_new_date_is_a_poll_error_and_is_retried() -> None:
    gap = RulesetCatalog([loaded(make_ruleset(OLD, effective_to=FIRST_DAY_OF_NEW))])
    with time_machine.travel(BEFORE_MIDNIGHT, tick=False) as clock:
        rig = Rig()
        rig.service = CountingService(rig.store, gap, scan_models(FIXTURE_MODELS), rig.holder, dubai_today, prod=True)
        rig.poller = ConfigPoller(rig.service, rig.holder, 0.02)
        await rig.activate(RuntimeConfig())
        await rig.poller.poll_once()
        assert status_of(rig.poller) == "ok"

        clock.move_to(AFTER_MIDNIGHT)
        await rig.poller.poll_once()
        # Not a config refusal but a hole in the catalog (NoRulesetError): loud, and checked again on the next poll.
        assert status_of(rig.poller) == "stale"
        before = rig.service.validations
        await rig.poller.poll_once()
        assert rig.service.validations > before
