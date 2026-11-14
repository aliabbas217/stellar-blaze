"""Every committed ruleset has a golden file that pins its values (ADR 0009 section 1: no golden file fails CI).

A change to a ruleset is therefore visible in one pull request as three edits: the TOML, its golden file, and the lock.
"""

import dataclasses
import json
import tomllib
from pathlib import Path
from typing import Any

import pytest

from stellar_blaze.domain.physics.niosh import Clothing
from stellar_blaze.domain.physics.twl import WithdrawalLimits as TwlWithdrawalLimits
from stellar_blaze.domain.rules.ruleset import Ruleset, WithdrawalLimits
from tests.unit.rules.structure import section_fields
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
    """Names of the ruleset fields that hold values: every ``RulesetSection`` plus the tunables.

    ``section_fields`` fails on any field that is neither a section nor allowlisted, so none can escape the golden file.
    """
    return [*section_fields(), "tunables"]


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
    assert golden["meta"] == {k: v for k, v in dumped["meta"].items() if k != "id"}
    assert golden["source_ids"] == [s["id"] for s in dumped["sources"]]
    # Every value section is pinned: a section added to the schema cannot escape its golden file.
    assert set(golden["sections"]) == set(value_sections())
    for name in value_sections():
        assert dumped[name] == golden["sections"][name], f"{path.name}: section {name} differs from its golden file"


def withdrawal_drift(seed: WithdrawalLimits) -> list[str]:
    """Names of the fields in which ``twl.WithdrawalLimits()`` and the ruleset's section differ."""
    reference = TwlWithdrawalLimits()
    return [f.name for f in dataclasses.fields(reference) if getattr(reference, f.name) != getattr(seed, f.name)]


def test_the_golden_file_covers_every_field_of_the_ruleset() -> None:
    pinned = {"meta", "sources", *value_sections()}
    assert pinned == set(Ruleset.model_fields)


def test_the_twl_module_defaults_are_the_withdrawal_limits_of_the_seed_ruleset() -> None:
    # `twl.WithdrawalLimits()` is the reference implementation's own default; B3 builds an instance from the ruleset
    # instead. Until it does, the two must not drift apart, and a field added to one must show up in the other.
    seed = load(RULESETS_DIR / "ae-heat-0.1.toml").twl_withdrawal
    reference = TwlWithdrawalLimits()
    assert {f.name for f in dataclasses.fields(reference)} == {"dry_bulb_c", "natural_wet_bulb_c", "cap_w_m2"}
    assert withdrawal_drift(seed) == []
    # Negative control: the comparison does notice a difference.
    assert withdrawal_drift(seed.model_copy(update={"cap_w_m2": 120.0})) == ["cap_w_m2"]


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


def test_golden_2026_1() -> None:
    """The released B3 ruleset's golden file pins every floor, every tunable range end and every ``safer``."""
    ruleset = load(RULESETS_DIR / "ae-heat-2026.1.toml")
    golden = golden_for(ruleset)
    sections = golden["sections"]
    assert golden["id"] == "ae-heat-2026.1"
    assert golden["meta"]["supersedes"] == ["ae-heat-0.1"]
    assert golden["meta"]["status"] == "released"
    assert golden["meta"]["effective_to"] is None

    # No B3 section is pinned as absent: a null in this golden file would mean a section silently dropped.
    assert all(sections[name] is not None for name in value_sections())

    labour = sections["labour"]
    assert labour["ban_window"] == ["12:30:00", "15:00:00"]
    assert labour["ban_season"] == ["06-15", "09-15"]
    assert labour["juvenile_window"] == ["07:00:00", "19:00:00"]
    assert (labour["art18_ban_gap_counts_as_break"], labour["art18_adosh_rest_counts_as_break"]) == (False, False)
    cycles = sections["adosh_cycles"]
    assert (cycles["high_heavy_work_min"], cycles["high_heavy_rest_min"]) == (20, 40)
    assert cycles["moderate_uses_heavy"] is True
    assert sections["privacy"] == {"source": "adr-0050", "k_health_floor": 10, "k_exposure_floor": 5}
    assert sections["workload"]["metabolic_w"] == {"light": 180.0, "moderate": 300.0, "heavy": 415.0}

    expected = {
        "twl_margin_w_m2": (7.0, 7.0, 20.0, "higher"),
        "warning_theta": (0.10, 0.05, 0.50, "lower"),
        "red_twl_w_m2": (85.0, 60.0, 115.0, "higher"),
        "personal_band_amber": (0.10, 0.05, 0.30, "lower"),
        "personal_band_orange": (0.50, 0.30, 0.70, "lower"),
        "personal_band_red": (0.90, 0.70, 0.95, "lower"),
        "deescalation_dwell_minutes": (60.0, 0.0, 180.0, "higher"),
        "alert_lead_hours": (12.0, 1.0, 24.0, "higher"),
        "alert_dispatch_interval_minutes": (5.0, 1.0, 30.0, "lower"),
        "forecast_stale_after_hours": (30.0, 6.0, 48.0, "lower"),
        "k_health": (10.0, 10.0, 50.0, "higher"),
        "k_exposure": (5.0, 5.0, 50.0, "higher"),
        "low_zone_voluntary_rest_min": (0.0, 0.0, 15.0, "higher"),
    }
    pinned = {name: (t["default"], t["min"], t["max"], t["safer"]) for name, t in sections["tunables"].items()}
    assert pinned == expected
    assert all(t["source"] for t in sections["tunables"].values())


def test_the_seed_golden_pins_the_b3_sections_as_absent() -> None:
    golden = golden_for(load(RULESETS_DIR / "ae-heat-0.1.toml"))["sections"]
    for name in ("labour", "adosh_cycles", "acclimatisation", "workload", "privacy", "clauses", "alerts"):
        assert golden[name] is None
