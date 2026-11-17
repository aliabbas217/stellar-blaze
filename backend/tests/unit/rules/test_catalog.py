from datetime import date

import pytest

from stellar_blaze.domain.rules.catalog import (
    NoRulesetError,
    PinOutOfRangeError,
    RulesetCatalog,
    RulesetCatalogError,
)
from tests.unit.rules.support import loaded, make_ruleset

pytestmark = pytest.mark.unit

A = "ae-heat-2024.1"
B = "ae-heat-2026.1"
C = "ae-heat-2026.2"


def two_consecutive() -> RulesetCatalog:
    return RulesetCatalog(
        [
            loaded(make_ruleset(A, effective_from=date(2024, 1, 1), effective_to=date(2026, 6, 1))),
            loaded(make_ruleset(B, effective_from=date(2026, 6, 1))),
        ]
    )


def test_rulesets_resolve_by_date_with_an_exclusive_end() -> None:
    catalog = two_consecutive()
    assert catalog.for_local_date(date(2024, 1, 1)).ruleset.meta.id == A
    assert catalog.for_local_date(date(2026, 5, 31)).ruleset.meta.id == A
    assert catalog.for_local_date(date(2026, 6, 1)).ruleset.meta.id == B
    assert catalog.for_local_date(date(2030, 1, 1)).ruleset.meta.id == B


def test_a_date_before_the_first_ruleset_is_an_error_not_a_default() -> None:
    with pytest.raises(NoRulesetError, match="2023-12-31"):
        two_consecutive().for_local_date(date(2023, 12, 31))


def test_a_gap_between_rulesets_is_an_error() -> None:
    catalog = RulesetCatalog(
        [
            loaded(make_ruleset(A, effective_from=date(2024, 1, 1), effective_to=date(2026, 1, 1))),
            loaded(make_ruleset(B, effective_from=date(2026, 6, 1))),
        ]
    )
    assert catalog.for_local_date(date(2025, 12, 31)).ruleset.meta.id == A
    with pytest.raises(NoRulesetError):
        catalog.for_local_date(date(2026, 3, 1))
    assert catalog.for_local_date(date(2026, 6, 1)).ruleset.meta.id == B


def test_an_empty_catalog_has_no_ruleset_for_any_date() -> None:
    with pytest.raises(NoRulesetError):
        RulesetCatalog([]).for_local_date(date(2026, 11, 11))


def test_overlapping_active_ranges_are_rejected() -> None:
    with pytest.raises(RulesetCatalogError, match="overlap") as raised:
        RulesetCatalog(
            [
                loaded(make_ruleset(A, effective_from=date(2024, 1, 1), effective_to=date(2026, 7, 1))),
                loaded(make_ruleset(B, effective_from=date(2026, 6, 1))),
            ]
        )
    assert A in str(raised.value)
    assert B in str(raised.value)


def test_an_open_ended_ruleset_overlaps_every_later_one() -> None:
    with pytest.raises(RulesetCatalogError, match="overlap"):
        RulesetCatalog(
            [
                loaded(make_ruleset(A, effective_from=date(2024, 1, 1))),
                loaded(make_ruleset(B, effective_from=date(2026, 6, 1))),
            ]
        )


def test_a_superseding_ruleset_takes_over_its_range_and_the_old_one_stays_pinnable() -> None:
    catalog = RulesetCatalog(
        [
            loaded(make_ruleset(A, effective_from=date(2024, 1, 1))),
            loaded(make_ruleset(B, effective_from=date(2024, 1, 1), supersedes=(A,))),
        ]
    )
    assert catalog.for_local_date(date(2026, 11, 11)).ruleset.meta.id == B
    assert catalog.resolve(date(2026, 11, 11), None).ruleset.meta.id == B
    assert catalog.resolve(date(2026, 11, 11), A).ruleset.meta.id == A
    assert catalog.get(A).ruleset.meta.id == A


def test_supersession_is_transitive_in_effect_only_one_active() -> None:
    catalog = RulesetCatalog(
        [
            loaded(make_ruleset(A, effective_from=date(2024, 1, 1))),
            loaded(make_ruleset(B, effective_from=date(2024, 1, 1), supersedes=(A,))),
            loaded(make_ruleset(C, effective_from=date(2024, 1, 1), supersedes=(B,))),
        ]
    )
    assert catalog.for_local_date(date(2025, 1, 1)).ruleset.meta.id == C
    assert catalog.ids() == (A, B, C)


def test_a_superseded_ruleset_is_not_resolved_by_date() -> None:
    catalog = RulesetCatalog(
        [
            loaded(make_ruleset(A, effective_from=date(2024, 1, 1), effective_to=date(2026, 6, 1))),
            loaded(make_ruleset(B, effective_from=date(2024, 1, 1), effective_to=date(2026, 6, 1), supersedes=(A,))),
        ]
    )
    assert catalog.for_local_date(date(2025, 1, 1)).ruleset.meta.id == B


def test_duplicate_ids_are_rejected() -> None:
    with pytest.raises(RulesetCatalogError, match=f"duplicate.*{A}"):
        RulesetCatalog([loaded(make_ruleset(A)), loaded(make_ruleset(A))])


def test_a_supersedes_naming_a_ruleset_that_is_not_loaded_is_rejected() -> None:
    with pytest.raises(RulesetCatalogError, match=r"ae-heat-2020\.9"):
        RulesetCatalog([loaded(make_ruleset(B, supersedes=("ae-heat-2020.9",)))])


def test_a_supersession_cycle_is_rejected() -> None:
    with pytest.raises(RulesetCatalogError, match="cycle"):
        RulesetCatalog(
            [
                loaded(make_ruleset(A, supersedes=(B,))),
                loaded(make_ruleset(B, supersedes=(A,))),
                loaded(make_ruleset(C, effective_from=date(2030, 1, 1))),
            ]
        )


def test_a_pin_wins_over_the_date_but_must_cover_it() -> None:
    catalog = two_consecutive()
    assert catalog.resolve(date(2026, 5, 31), A).ruleset.meta.id == A
    assert catalog.resolve(date(2026, 7, 1), B).ruleset.meta.id == B
    with pytest.raises(PinOutOfRangeError, match=f"{A}.*2026-06-01"):
        catalog.resolve(date(2026, 6, 1), A)  # exclusive end
    with pytest.raises(PinOutOfRangeError, match=B):
        catalog.resolve(date(2026, 5, 31), B)


def test_no_pin_resolves_by_date() -> None:
    catalog = two_consecutive()
    assert catalog.resolve(date(2026, 6, 1), None).ruleset.meta.id == B
    with pytest.raises(NoRulesetError):
        catalog.resolve(date(2020, 1, 1), None)


def test_a_pin_to_an_unknown_id_names_the_known_ids() -> None:
    catalog = two_consecutive()
    with pytest.raises(KeyError, match=f"nope.*{A}.*{B}"):
        catalog.resolve(date(2026, 7, 1), "nope")
    with pytest.raises(KeyError, match="nope"):
        catalog.get("nope")


def test_loaded_rulesets_carry_their_hash() -> None:
    catalog = two_consecutive()
    assert (
        catalog.get(A).sha256
        == loaded(make_ruleset(A, effective_from=date(2024, 1, 1), effective_to=date(2026, 6, 1))).sha256
    )
    assert len(catalog.get(A).sha256) == 64
