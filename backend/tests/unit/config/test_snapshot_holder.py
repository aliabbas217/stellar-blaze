"""The active-config holder: one reference, swapped atomically; a reader that holds a snapshot keeps it."""

import dataclasses
from datetime import date

import pytest

from stellar_blaze.application.runtime_config import (
    ConfigSnapshot,
    ConfigUnavailableError,
    SnapshotHolder,
    ruleset_for,
)
from stellar_blaze.domain.config.runtime import RuntimeConfig, config_sha256
from stellar_blaze.domain.rules.catalog import NoRulesetError, PinOutOfRangeError, RulesetCatalog
from tests.unit.rules.support import loaded, make_ruleset

pytestmark = pytest.mark.unit


def snapshot(config: RuntimeConfig | None = None, *, version_id: int | None = None) -> ConfigSnapshot:
    config = config or RuntimeConfig()
    return ConfigSnapshot(version_id=version_id, sha256=config_sha256(config), config=config, source="file", model=None)


def test_an_empty_holder_has_no_current_snapshot() -> None:
    with pytest.raises(ConfigUnavailableError):
        SnapshotHolder().current()


def test_the_holder_returns_what_it_was_given() -> None:
    first = snapshot()
    assert SnapshotHolder(first).current() is first


def test_a_reader_holding_the_old_snapshot_keeps_it_after_a_swap() -> None:
    holder = SnapshotHolder()
    old = snapshot(version_id=1)
    new = snapshot(RuntimeConfig(model_id="corrector-20261112-0000000-000001"), version_id=2)
    holder.swap(old)
    held = holder.current()  # one request reads once and keeps it to the end
    holder.swap(new)
    assert held is old
    assert held.version_id == 1
    assert holder.current() is new
    assert holder.current().version_id == 2


def test_swap_replaces_a_reference_it_does_not_mutate_the_snapshot() -> None:
    holder = SnapshotHolder(snapshot(version_id=1))
    held = holder.current()
    holder.swap(snapshot(version_id=2))
    assert held.version_id == 1
    with pytest.raises(dataclasses.FrozenInstanceError):
        held.version_id = 3  # type: ignore[misc]


def test_ruleset_for_resolves_the_pin_or_the_date() -> None:
    catalog = RulesetCatalog(
        [
            loaded(make_ruleset("ae-heat-2024.1", effective_from=date(2024, 1, 1), effective_to=date(2026, 6, 1))),
            loaded(make_ruleset("ae-heat-2026.1", effective_from=date(2026, 6, 1))),
        ]
    )
    unpinned = snapshot()
    assert ruleset_for(unpinned, catalog, date(2025, 1, 1)).ruleset.meta.id == "ae-heat-2024.1"
    assert ruleset_for(unpinned, catalog, date(2026, 11, 11)).ruleset.meta.id == "ae-heat-2026.1"
    pinned = snapshot(RuntimeConfig(ruleset_pin="ae-heat-2024.1"))
    assert ruleset_for(pinned, catalog, date(2025, 1, 1)).ruleset.meta.id == "ae-heat-2024.1"
    with pytest.raises(PinOutOfRangeError):
        ruleset_for(pinned, catalog, date(2026, 11, 11))
    with pytest.raises(NoRulesetError):
        ruleset_for(unpinned, catalog, date(2020, 1, 1))
