"""The active runtime config as an immutable snapshot, and the holder that swaps it (ADR 0010 section 3).

A request or a job run reads one snapshot and keeps it until it finishes, so two versions of the config never mix inside
one decision. The holder replaces a single reference; a reader that already holds a snapshot is not affected by a swap.
"""

from dataclasses import dataclass
from datetime import date
from typing import Literal

from stellar_blaze.domain.config.models import LoadedModel
from stellar_blaze.domain.config.runtime import RuntimeConfig
from stellar_blaze.domain.rules.catalog import LoadedRuleset, RulesetCatalog


class ConfigUnavailableError(RuntimeError):
    """There is no active config yet (or no longer): nothing may be decided until one is loaded."""


@dataclass(frozen=True)
class ConfigSnapshot:
    """One validated runtime config and where it came from.

    Attributes:
        version_id: The ``config_version`` row, or ``None`` for a snapshot read from a file or the environment.
        sha256: ``config_sha256`` of ``config``.
        config: The validated runtime config.
        source: ``"file"`` (the git seed), ``"env"`` (the seed with ``SB_RULESET_ID`` / ``SB_MODEL_ID`` pins applied,
            for back-tests and database-less development runs) or ``"db"`` (an activated config version).
        model: The loaded model ``config.model_id`` names, or ``None`` for the uncorrected forecast.
    """

    version_id: int | None
    sha256: str
    config: RuntimeConfig
    source: Literal["file", "env", "db"]
    model: LoadedModel | None


class SnapshotHolder:
    """Holds the current snapshot. Readers call ``current`` once and keep what they got."""

    def __init__(self, initial: ConfigSnapshot | None = None) -> None:
        self._snapshot = initial

    def current(self) -> ConfigSnapshot:
        """The active snapshot.

        Raises:
            ConfigUnavailableError: No snapshot has been loaded.
        """
        snapshot = self._snapshot
        if snapshot is None:
            msg = "no runtime config is loaded"
            raise ConfigUnavailableError(msg)
        return snapshot

    def swap(self, snapshot: ConfigSnapshot) -> None:
        """Make ``snapshot`` the active one: one reference assignment, so a reader sees the old or the new one."""
        self._snapshot = snapshot


def ruleset_for(snapshot: ConfigSnapshot, catalog: RulesetCatalog, d: date) -> LoadedRuleset:
    """The ruleset to decide on the local date ``d`` under ``snapshot``: its pin if it has one, else the one by date.

    Raises:
        KeyError: The pin names no loaded ruleset.
        PinOutOfRangeError: The pin does not cover ``d``.
        NoRulesetError: There is no pin and no ruleset covers ``d``.
    """
    return catalog.resolve(d, snapshot.config.ruleset_pin)
