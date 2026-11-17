"""ADR 0044: in prod a ruleset pin must not be less protective than the ruleset in force on the tunables either.

Two released rulesets that differ: A (the older one, margin default 0, range [0, 20]) and B (in force today, which
supersedes A: margin default 7, range [7, 20]). A still covers today, so only the tunable comparison can refuse it.
"""

from datetime import date
from typing import Any

import pytest

from stellar_blaze.adapters.config.models import scan_models
from stellar_blaze.domain.config.runtime import ConfigViolation, RuntimeConfig, validate_runtime_config
from stellar_blaze.domain.rules.catalog import RulesetCatalog
from stellar_blaze.domain.rules.ruleset import Ruleset
from tests.unit.rules.support import BACKEND_ROOT, loaded, ruleset_dict, set_path

pytestmark = pytest.mark.unit

TODAY = date(2026, 11, 11)
A = "ae-heat-2025.1"
B = "ae-heat-2025.2"
MARGIN = "twl_margin_w_m2"


def ruleset(
    ruleset_id: str,
    *,
    default: float,
    low: float,
    high: float,
    safer: str = "higher",
    supersedes: tuple[str, ...] = (),
    effective_from: date = date(2024, 1, 1),
) -> Ruleset:
    """The seed under ``ruleset_id`` with the margin tunable's range, default and ``safer`` replaced."""
    raw = ruleset_dict(ruleset_id, supersedes=supersedes, effective_from=effective_from)
    for field, value in (("default", default), ("min", low), ("max", high), ("safer", safer)):
        set_path(raw, ("tunables", MARGIN, field), value)
    return Ruleset.model_validate(raw)


def catalog_of(older: Ruleset, in_force: Ruleset) -> RulesetCatalog:
    """``in_force`` supersedes ``older``, so it is the ruleset in force today while ``older`` still covers today."""
    return RulesetCatalog([loaded(older), loaded(in_force)])


def default_catalog(*, in_force_default: float = 7.0, **older: Any) -> RulesetCatalog:
    """A (older) is what the keyword arguments say, B (in force) has margin range [7, 20] and ``in_force_default``."""
    values: dict[str, Any] = {"default": 0.0, "low": 0.0, "high": 20.0} | older
    return catalog_of(
        ruleset(A, **values),
        ruleset(B, default=in_force_default, low=7.0, high=20.0, supersedes=(A,), effective_from=date(2025, 1, 1)),
    )


def validate(pin: str | None, catalog: RulesetCatalog, *, prod: bool = True) -> list[ConfigViolation]:
    models = scan_models(BACKEND_ROOT / "tests" / "fixtures" / "models")
    return validate_runtime_config(
        RuntimeConfig(ruleset_pin=pin), catalog=catalog, models=models, today=TODAY, prod=prod
    )


def codes(violations: list[ConfigViolation]) -> list[tuple[str, str]]:
    return [(v.code, v.path) for v in violations]


def test_pin_to_older_ruleset_with_lower_margin_min_is_refused() -> None:
    violations = validate(A, default_catalog())

    # One violation per failing tunable per check: the range end and the effective default both fail here.
    assert codes(violations) == [
        ("floor-violation", f"ruleset_pin.tunables.{MARGIN}.min"),
        ("floor-violation", f"ruleset_pin.tunables.{MARGIN}.default"),
    ]
    assert A in violations[0].message
    assert B in violations[0].message
    assert "0.0" in violations[0].message
    assert "7.0" in violations[0].message


def test_the_ruleset_in_force_can_be_pinned() -> None:
    assert validate(B, default_catalog()) == []


def test_pin_with_equal_tunables_is_accepted() -> None:
    # Equal on both range ends and on the default.
    assert validate(A, default_catalog(default=7.0, low=7.0, high=20.0)) == []
    # A pinned range that is only narrower on the safe side is at least as protective, so it is accepted too.
    assert validate(A, default_catalog(default=9.0, low=8.0, high=15.0)) == []


def test_a_pin_with_a_lower_default_but_an_acceptable_range_is_refused_on_the_default_only() -> None:
    violations = validate(A, default_catalog(in_force_default=9.0, default=8.0, low=7.0, high=20.0))
    assert codes(violations) == [("floor-violation", f"ruleset_pin.tunables.{MARGIN}.default")]
    assert "8.0" in violations[0].message
    assert "9.0" in violations[0].message


def test_a_pin_with_a_lower_min_but_an_acceptable_default_is_refused_on_the_min_only() -> None:
    violations = validate(A, default_catalog(default=9.0, low=0.0, high=20.0))
    assert codes(violations) == [("floor-violation", f"ruleset_pin.tunables.{MARGIN}.min")]


def test_a_higher_safer_tunable_does_not_compare_the_max() -> None:
    # B allows up to 20; A allows only up to 10. The less protective end for "higher" is the min, so this is fine.
    assert validate(A, default_catalog(default=7.0, low=7.0, high=10.0)) == []


def lower_catalog(*, older_max: float, older_default: float) -> RulesetCatalog:
    return catalog_of(
        ruleset(A, default=older_default, low=0.0, high=older_max, safer="lower"),
        ruleset(B, default=5.0, low=0.0, high=10.0, safer="lower", supersedes=(A,), effective_from=date(2025, 1, 1)),
    )


def test_lower_safer_tunable_compares_max() -> None:
    violations = validate(A, lower_catalog(older_max=30.0, older_default=5.0))
    assert codes(violations) == [("floor-violation", f"ruleset_pin.tunables.{MARGIN}.max")]
    assert "30.0" in violations[0].message
    assert "10.0" in violations[0].message
    # The min is the more protective end for "lower" and is not compared, even though A reaches lower than B.
    assert validate(A, lower_catalog(older_max=10.0, older_default=5.0)) == []
    assert validate(A, lower_catalog(older_max=8.0, older_default=4.0)) == []


def test_lower_safer_tunable_compares_the_default_too() -> None:
    violations = validate(A, lower_catalog(older_max=10.0, older_default=6.0))
    assert codes(violations) == [("floor-violation", f"ruleset_pin.tunables.{MARGIN}.default")]


def test_a_none_safer_tunable_is_not_compared() -> None:
    catalog = catalog_of(
        ruleset(A, default=0.0, low=0.0, high=20.0, safer="none"),
        ruleset(B, default=7.0, low=7.0, high=10.0, safer="none", supersedes=(A,), effective_from=date(2025, 1, 1)),
    )
    assert validate(A, catalog) == []


def test_missing_tunable_in_pin_is_a_violation() -> None:
    older_raw = ruleset_dict(A)
    del older_raw["tunables"][MARGIN]
    older = Ruleset.model_validate(older_raw)
    in_force = ruleset(B, default=7.0, low=7.0, high=20.0, supersedes=(A,), effective_from=date(2025, 1, 1))

    violations = validate(A, catalog_of(older, in_force))

    # The pin cannot resolve the tunable at all, so resolution adds its own `unknown-tunable` for the same name.
    assert ("floor-violation", f"ruleset_pin.tunables.{MARGIN}") in codes(violations)
    missing = next(v for v in violations if v.path == f"ruleset_pin.tunables.{MARGIN}")
    assert MARGIN in missing.message
    assert A in missing.message


def test_a_tunable_only_the_pin_declares_is_not_a_violation() -> None:
    # In force declares nothing the pin lacks; extra tunables in the pin have nothing to be compared with.
    older_raw = ruleset_dict(A)
    older_raw["tunables"]["warn_theta_extra"] = {
        "source": "adr-0006",
        "default": 1.0,
        "min": 0.0,
        "max": 2.0,
        "safer": "higher",
    }
    older = Ruleset.model_validate(older_raw)
    in_force = ruleset(B, default=0.0, low=0.0, high=20.0, supersedes=(A,), effective_from=date(2025, 1, 1))
    assert validate(A, catalog_of(older, in_force)) == []


def test_dev_pin_is_not_compared() -> None:
    assert validate(A, default_catalog(), prod=False) == []


def test_without_a_pin_there_is_nothing_to_compare() -> None:
    assert validate(None, default_catalog()) == []
