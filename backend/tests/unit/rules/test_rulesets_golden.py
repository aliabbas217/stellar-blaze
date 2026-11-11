"""Every committed ruleset has a golden file that pins its values (ADR 0009 section 1: no golden file fails CI).

A change to a ruleset is therefore visible in one pull request as three edits: the TOML, its golden file, and the lock.
"""

import json
import tomllib
from pathlib import Path
from typing import Any

import pytest

from stellar_blaze.domain.physics.niosh import Clothing
from stellar_blaze.domain.rules.ruleset import Ruleset, RulesetSection
from tests.unit.rules.support import BACKEND_ROOT, RULESETS_DIR

pytestmark = pytest.mark.unit

GOLDEN_DIR = BACKEND_ROOT / "tests" / "fixtures" / "rulesets"
RULESET_FILES = sorted(RULESETS_DIR.glob("*.toml"))

# NIOSH (2016) Table 3-2, clothing adjustment factors in degrees C WBGT (ACGIH-derived), in the order of the table.
NIOSH_TABLE_3_2_C = {
    "work_clothes": 0.0,
    "cloth_coveralls": 0.0,
    "double_layer_woven": 3.0,
    "sms_coveralls": 0.5,
    "polyolefin_coveralls": 1.0,
    "limited_use_vapor_barrier": 11.0,
}


def value_sections() -> list[str]:
    """Names of the ruleset fields that hold values: every ``RulesetSection`` plus the tunables."""
    sections = [
        name
        for name, info in Ruleset.model_fields.items()
        if isinstance(info.annotation, type) and issubclass(info.annotation, RulesetSection)
    ]
    return [*sections, "tunables"]


def load(path: Path) -> Ruleset:
    return Ruleset.model_validate(tomllib.loads(path.read_text(encoding="utf-8")))


def golden_for(ruleset: Ruleset) -> dict[str, Any]:
    path = GOLDEN_DIR / f"{ruleset.meta.id}.golden.json"
    assert path.is_file(), f"missing golden file for ruleset {ruleset.meta.id}: expected {path}"
    golden: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return golden


def test_there_is_at_least_one_committed_ruleset() -> None:
    # The parametrized test below would pass vacuously over an empty glob.
    assert RULESET_FILES


@pytest.mark.parametrize("path", RULESET_FILES, ids=lambda path: path.stem)
def test_the_ruleset_matches_its_golden_file(path: Path) -> None:
    ruleset = load(path)
    assert path.stem == ruleset.meta.id
    golden = golden_for(ruleset)
    dumped = ruleset.model_dump(mode="json")

    assert golden["id"] == ruleset.meta.id
    assert golden["meta"] == {k: v for k, v in dumped["meta"].items() if k not in {"id", "jurisdiction"}}
    assert golden["source_ids"] == [s["id"] for s in dumped["sources"]]
    # Every value section is pinned: a section added to the schema cannot escape its golden file.
    assert set(golden["sections"]) == set(value_sections())
    for name in value_sections():
        assert dumped[name] == golden["sections"][name], f"{path.name}: section {name} differs from its golden file"


def test_the_seed_pins_niosh_table_3_2_and_the_adosh_zone_edges() -> None:
    ruleset = load(RULESETS_DIR / "ae-heat-0.1.toml")
    golden = golden_for(ruleset)["sections"]
    assert golden["niosh_clothing"]["values_c"] == NIOSH_TABLE_3_2_C
    assert ruleset.niosh_clothing.values_c == NIOSH_TABLE_3_2_C
    assert set(NIOSH_TABLE_3_2_C) == {c.value for c in Clothing}
    # ADOSH Technical Guideline Table 1: at least 140 W/m2 Low, 115 to 140 Medium, below 115 High.
    assert (ruleset.twl_zones.low_min_w_m2, ruleset.twl_zones.medium_min_w_m2) == (140.0, 115.0)
    assert (golden["twl_zones"]["low_min_w_m2"], golden["twl_zones"]["medium_min_w_m2"]) == (140.0, 115.0)


def test_the_seed_ships_with_withdrawal_limits_off_and_a_margin_that_starts_at_zero() -> None:
    # ADR 0006: the withdrawal-limit source is unverified and B3 decides; ADR 0010: the margin range never goes below
    # zero, so a live change can never zone above the ADOSH edges.
    ruleset = load(RULESETS_DIR / "ae-heat-0.1.toml")
    assert ruleset.twl_withdrawal.enabled is False
    assert (ruleset.twl_withdrawal.dry_bulb_c, ruleset.twl_withdrawal.natural_wet_bulb_c) == (44.0, 32.0)
    assert ruleset.twl_withdrawal.cap_w_m2 == 115.0
    margin = ruleset.tunables["twl_margin_w_m2"]
    assert (margin.default, margin.min, margin.max, margin.safer) == (0.0, 0.0, 20.0, "higher")
    assert margin.source == "adr-0006"
