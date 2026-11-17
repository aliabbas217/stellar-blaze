"""The set of loaded rulesets and the date and pin lookups (ADR 0009 section 1, ADR 0010 section 4.3)."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from itertools import pairwise

from stellar_blaze.domain.rules.ruleset import Ruleset


class RulesetCatalogError(ValueError):
    """The loaded rulesets contradict each other: a duplicate id, an unknown or cyclic ``supersedes``, an overlap."""


class NoRulesetError(LookupError):
    """No active ruleset is in force on a date. Never answered with a default."""


class PinOutOfRangeError(LookupError):
    """A pinned ruleset does not cover the date it was asked to rule on."""


@dataclass(frozen=True)
class LoadedRuleset:
    """A validated ruleset and the SHA-256 of the file bytes it was read from (what a decision row records)."""

    ruleset: Ruleset
    sha256: str


def _range(ruleset: Ruleset) -> str:
    end = ruleset.meta.effective_to
    return f"[{ruleset.meta.effective_from}, {end if end is not None else 'open'})"


class RulesetCatalog:
    """Immutable catalog of loaded rulesets.

    The *active set* is every ruleset that no other loaded ruleset supersedes. Date lookups use the active set only,
    and its effective ranges must not overlap. A superseded ruleset stays reachable by id, so a decision made under it
    can be replayed for audit.
    """

    def __init__(self, rulesets: Sequence[LoadedRuleset]) -> None:
        """Build the catalog.

        Raises:
            RulesetCatalogError: Two rulesets share an id, a ``supersedes`` names a ruleset that is not loaded or
                forms a cycle, or two active rulesets have overlapping effective ranges.
        """
        by_id: dict[str, LoadedRuleset] = {}
        for item in rulesets:
            ruleset_id = item.ruleset.meta.id
            if ruleset_id in by_id:
                raise RulesetCatalogError(f"duplicate ruleset id {ruleset_id!r}")
            by_id[ruleset_id] = item

        for item in rulesets:
            for old in item.ruleset.meta.supersedes:
                if old not in by_id:
                    raise RulesetCatalogError(
                        f"{item.ruleset.meta.id} supersedes {old!r}, which is not loaded (loaded: {sorted(by_id)})"
                    )
        self._reject_cycles(by_id)

        superseded = {old for item in rulesets for old in item.ruleset.meta.supersedes}
        active = sorted(
            (item for item in rulesets if item.ruleset.meta.id not in superseded),
            key=lambda item: (item.ruleset.meta.effective_from, item.ruleset.meta.id),
        )
        # Sorted by start, so if any two ranges overlap, some neighboring pair does.
        for earlier, later in pairwise(active):
            end = earlier.ruleset.meta.effective_to
            if end is None or end > later.ruleset.meta.effective_from:
                raise RulesetCatalogError(
                    f"active rulesets overlap: {earlier.ruleset.meta.id} {_range(earlier.ruleset)} and "
                    f"{later.ruleset.meta.id} {_range(later.ruleset)}; supersede one of them or end its range"
                )

        self._by_id = by_id
        self._active = tuple(active)

    @staticmethod
    def _reject_cycles(by_id: dict[str, LoadedRuleset]) -> None:
        for start in by_id:
            seen: set[str] = set()
            frontier = [start]
            while frontier:
                current = frontier.pop()
                for old in by_id[current].ruleset.meta.supersedes:
                    if old == start:
                        raise RulesetCatalogError(f"supersession cycle through {start!r}")
                    if old not in seen:
                        seen.add(old)
                        frontier.append(old)

    def ids(self) -> tuple[str, ...]:
        """Every loaded id, superseded ones included, sorted."""
        return tuple(sorted(self._by_id))

    def get(self, ruleset_id: str) -> LoadedRuleset:
        """The loaded ruleset with this id, whether or not it is superseded.

        Raises:
            KeyError: No such ruleset is loaded; the message names the known ids.
        """
        try:
            return self._by_id[ruleset_id]
        except KeyError:
            raise KeyError(f"unknown ruleset {ruleset_id!r}; known: {', '.join(self.ids()) or '(none)'}") from None

    def for_local_date(self, d: date) -> LoadedRuleset:
        """The active ruleset in force on the Asia/Dubai local date ``d``.

        Raises:
            NoRulesetError: No active ruleset covers ``d`` (a gap, or a date before the first ruleset).
        """
        for item in self._active:
            if item.ruleset.covers(d):
                return item
        raise NoRulesetError(
            f"no ruleset is in force on {d} (active: "
            f"{', '.join(f'{i.ruleset.meta.id} {_range(i.ruleset)}' for i in self._active) or 'none'})"
        )

    def resolve(self, d: date, pin: str | None) -> LoadedRuleset:
        """The ruleset to use for the local date ``d``: the pinned one if there is a pin, otherwise the one by date.

        Raises:
            KeyError: ``pin`` names no loaded ruleset.
            PinOutOfRangeError: ``pin`` names a ruleset whose effective range does not cover ``d``.
            NoRulesetError: There is no pin and no active ruleset covers ``d``.
        """
        if pin is None:
            return self.for_local_date(d)
        pinned = self.get(pin)
        if not pinned.ruleset.covers(d):
            raise PinOutOfRangeError(f"pinned ruleset {pin} {_range(pinned.ruleset)} does not cover {d}")
        return pinned
