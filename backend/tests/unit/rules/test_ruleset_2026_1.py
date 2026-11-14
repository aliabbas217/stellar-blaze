"""The released ruleset ``ae-heat-2026.1`` (B3 Task 2): its values, its lock entry, its floors and its tunables.

The values below are typed from the task brief and ADRs 0011, 0046-0050 and 0058, not read back from the file, so a
change to the file shows up here as a failing line and not as a silently updated expectation.
"""

import hashlib
import json
import tomllib
from datetime import date, time
from typing import Any

import pytest

from stellar_blaze.adapters.config.models import scan_models
from stellar_blaze.adapters.config.rulesets import load_catalog
from stellar_blaze.domain.config.runtime import (
    ConfigViolation,
    EffectiveParams,
    RuntimeConfig,
    resolve_effective,
    validate_runtime_config,
)
from stellar_blaze.domain.rules.catalog import RulesetCatalog
from stellar_blaze.domain.rules.floors import floor_violations
from stellar_blaze.domain.rules.ruleset import Ruleset, RulesetIncompleteError
from tests.unit.rules.support import BACKEND_ROOT, RULESETS_DIR, set_path

pytestmark = pytest.mark.unit

ID = "ae-heat-2026.1"
SEED_ID = "ae-heat-0.1"
PATH = RULESETS_DIR / f"{ID}.toml"
TODAY = date(2026, 7, 1)  # inside the ban season, after ae-heat-2026.1 takes effect


def raw() -> dict[str, Any]:
    return tomllib.loads(PATH.read_text(encoding="utf-8"))


def released() -> Ruleset:
    return Ruleset.model_validate(raw())


def seed() -> Ruleset:
    return Ruleset.model_validate(tomllib.loads((RULESETS_DIR / f"{SEED_ID}.toml").read_text(encoding="utf-8")))


def candidate(*changes: tuple[tuple[str | int, ...], Any]) -> Ruleset:
    data = raw()
    for path, value in changes:
        set_path(data, path, value)
    return Ruleset.model_validate(data)


def catalog() -> RulesetCatalog:
    return load_catalog(RULESETS_DIR, allow_drafts=False)


def violations_for(config: RuntimeConfig, *, pin: str | None = None) -> list[ConfigViolation]:
    models = scan_models(BACKEND_ROOT / "tests" / "fixtures" / "models")
    return validate_runtime_config(
        config.model_copy(update={"ruleset_pin": pin}), catalog=catalog(), models=models, today=TODAY, prod=True
    )


# --- identity, lock, catalog ------------------------------------------------------------------------------------


def test_2026_1_loads_and_hash_matches_lock() -> None:
    data = PATH.read_bytes()
    assert b"\r" not in data, "rulesets are LF files (.gitattributes eol=lf)"
    lock = json.loads((RULESETS_DIR / "lock.json").read_text(encoding="utf-8"))
    assert lock[ID] == hashlib.sha256(data).hexdigest()
    loaded = catalog().get(ID)
    assert loaded.sha256 == lock[ID]
    meta = loaded.ruleset.meta
    assert (meta.effective_from, meta.effective_to, meta.status) == (date(2024, 1, 1), None, "released")
    assert meta.supersedes == (SEED_ID,)
    assert meta.jurisdiction == "ae"


def test_0_1_still_loads() -> None:
    loaded = catalog().get(SEED_ID)
    assert loaded.ruleset.meta.id == SEED_ID
    # The seed predates the B3 sections: they are absent, not defaulted.
    for name in ("labour", "adosh_cycles", "acclimatisation", "workload", "privacy", "clauses", "alerts"):
        assert getattr(loaded.ruleset, name) is None


def test_catalog_resolves_2026_1_for_2026_07_01() -> None:
    assert catalog().for_local_date(TODAY).ruleset.meta.id == ID
    assert catalog().for_local_date(date(2024, 1, 1)).ruleset.meta.id == ID
    assert catalog().ids() == (SEED_ID, ID)


def test_the_seed_declares_only_the_margin_tunable() -> None:
    # The seed predates B3: this is why a config cannot be resolved against it any more (parking lot).
    assert set(seed().tunables) == {"twl_margin_w_m2"}


# --- values (typed from the brief and ADRs) ----------------------------------------------------------------------


def test_zones_clothing_and_withdrawal_are_copied_from_the_seed() -> None:
    ruleset, old = released(), seed()
    assert ruleset.twl_zones == old.twl_zones
    assert ruleset.niosh_clothing == old.niosh_clothing
    assert ruleset.twl_withdrawal == old.twl_withdrawal
    assert ruleset.twl_withdrawal.enabled is False  # ADR 0047


def test_labour_values() -> None:
    labour = released().labour
    assert labour is not None
    assert labour.ban_window == (time(12, 30, 0), time(15, 0, 0))
    assert labour.ban_season == ("06-15", "09-15")
    assert labour.normal_hours_per_day == 8
    assert labour.normal_hours_per_week == 48
    assert labour.overtime_hours_per_day == 2
    assert labour.total_hours_per_3_weeks == 144
    assert labour.art18_max_run_h == 5
    assert labour.art18_break_h == 1
    assert labour.art18_ban_gap_counts_as_break is False
    assert labour.art18_adosh_rest_counts_as_break is False
    assert labour.juvenile_max_h == 6
    assert labour.juvenile_max_run_h == 4
    assert labour.juvenile_window == (time(7, 0, 0), time(19, 0, 0))
    assert labour.ramadan_reduction_h == 2


def test_adosh_cycle_values() -> None:
    cycles = released().adosh_cycles
    assert cycles is not None
    assert (cycles.medium_heavy_work_min, cycles.medium_heavy_rest_min) == (45, 15)
    assert (cycles.high_light_work_min, cycles.high_light_rest_min) == (45, 15)
    assert (cycles.high_heavy_work_min, cycles.high_heavy_rest_min) == (20, 40)
    assert cycles.moderate_uses_heavy is True
    assert cycles.lone_work_min_headcount == 2


def test_acclimatisation_values() -> None:
    acclimatisation = released().acclimatisation
    assert acclimatisation is not None
    assert acclimatisation.new_ramp_pct == {"1": 20, "2": 40, "3": 60, "4": 80, "5": 100}
    assert acclimatisation.experienced_ramp_pct == {"1": 50, "2": 60, "3": 80, "4": 100, "5": 100}
    assert acclimatisation.reacclimatisation_pct == {
        "lt4.1": 100,
        "4-5.1": 80,
        "4-5.2": 100,
        "6-12.1": 80,
        "6-12.2": 100,
        "12-20.1": 60,
        "12-20.2": 80,
        "12-20.3": 100,
        "gt20.1": 50,
        "gt20.2": 60,
        "gt20.3": 80,
        "gt20.4": 100,
    }
    assert acclimatisation.unacclimatised_after_days_away == 14
    assert acclimatisation.heavy_work_after_days == 7


def test_workload_privacy_and_alert_values() -> None:
    ruleset = released()
    assert ruleset.workload is not None
    assert ruleset.workload.metabolic_w == {"light": 180.0, "moderate": 300.0, "heavy": 415.0}
    assert ruleset.workload.source == "adr-0006-niosh-vectors"
    assert ruleset.privacy is not None
    assert (ruleset.privacy.k_health_floor, ruleset.privacy.k_exposure_floor) == (10, 5)
    assert ruleset.alerts is not None
    assert ruleset.alerts.template_ids == ("level-change", "level-end")
    assert set(ruleset.alerts.action_codes_by_level) == {"green", "amber", "orange", "red"}
    for codes in ruleset.alerts.action_codes_by_level.values():
        assert codes
    assert "cycle.medium.heavy.45-15" in ruleset.alerts.action_codes_by_level["amber"]
    assert "no-lone-work" in ruleset.alerts.action_codes_by_level["amber"]
    assert "fluids.over-1.2l" in ruleset.alerts.action_codes_by_level["orange"]
    assert "stop-work" in ruleset.alerts.action_codes_by_level["red"]


# name -> (source ADR id, default, min, max, safer)
TUNABLES: dict[str, tuple[float, float, float, str]] = {
    "twl_margin_w_m2": (7, 7, 20, "higher"),  # ADR 0047
    "warning_theta": (0.10, 0.05, 0.50, "lower"),  # ADR 0048
    "red_twl_w_m2": (85, 60, 115, "higher"),  # ADR 0046
    "personal_band_amber": (0.10, 0.05, 0.30, "lower"),  # ADR 0049
    "personal_band_orange": (0.50, 0.30, 0.70, "lower"),
    "personal_band_red": (0.90, 0.70, 0.95, "lower"),
    "deescalation_dwell_minutes": (60, 0, 180, "higher"),  # ADR 0058
    "alert_lead_hours": (12, 1, 24, "higher"),
    "alert_dispatch_interval_minutes": (5, 1, 30, "lower"),  # ADR 0058 decision 5 amendment
    "forecast_stale_after_hours": (30, 6, 48, "lower"),
    "k_health": (10, 10, 50, "higher"),  # ADR 0050
    "k_exposure": (5, 5, 50, "higher"),
    "low_zone_voluntary_rest_min": (0, 0, 15, "higher"),  # ADR 0011 section 8
}


def test_tunables_are_exactly_the_reviewed_set() -> None:
    tunables = released().tunables
    assert set(tunables) == set(TUNABLES)
    for name, (default, low, high, safer) in TUNABLES.items():
        spec = tunables[name]
        assert (spec.default, spec.min, spec.max, spec.safer) == (default, low, high, safer), name


def test_effective_params_default_to_the_ruleset() -> None:
    effective = resolve_effective(RuntimeConfig(), released())
    assert effective == EffectiveParams(
        twl_margin_w_m2=7.0,
        warning_theta=0.10,
        red_twl_w_m2=85.0,
        personal_band_amber=0.10,
        personal_band_orange=0.50,
        personal_band_red=0.90,
        deescalation_dwell_minutes=60,
        alert_lead_hours=12,
        alert_dispatch_interval_minutes=5,
        forecast_stale_after_hours=30,
        k_health=10,
        k_exposure=5,
        low_zone_voluntary_rest_min=0,
    )
    assert isinstance(effective, EffectiveParams)
    assert type(effective.k_health) is int
    assert type(effective.alert_lead_hours) is int
    assert type(effective.alert_dispatch_interval_minutes) is int


# --- clauses -----------------------------------------------------------------------------------------------------

CLAUSE_IDS = {
    "P-H1",
    "P-H1a",
    "P-H2.daily",
    "P-H2.weekly",
    "P-H3",
    "P-H4",
    "P-H5.hours",
    "P-H5.run",
    "P-H5.window",
    "P-H7.cap60",
    "P-H7.run",
    "P-H7.lone",
    "P-H7.unacclimatised",
    "P-H8.ramp",
    "P-H8.heavy7",
    "P-H10",
    "STOP.red",
    "STOP.no_acclimatised",
    "FALLBACK.high",
}


def test_clause_sources_declared() -> None:
    ruleset = released()
    assert ruleset.clauses is not None
    assert set(ruleset.clauses.entries) == CLAUSE_IDS
    declared = {s.id for s in ruleset.sources}
    assert {entry.source for entry in ruleset.clauses.entries.values()} <= declared
    assert all(entry.clause.strip() for entry in ruleset.clauses.entries.values())


def test_an_undeclared_clause_source_is_refused() -> None:
    with pytest.raises(ValueError, match=r"P-H1.*nowhere"):
        candidate((("clauses", "entries", "P-H1", "source"), "nowhere"))


def test_a_missing_clause_entry_is_refused() -> None:
    data = raw()
    del data["clauses"]["entries"]["P-H10"]
    with pytest.raises(ValueError, match="P-H10"):
        Ruleset.model_validate(data)


# --- floors ------------------------------------------------------------------------------------------------------


def test_ban_window_floor_wider() -> None:
    reference = released()
    narrower = candidate((("labour", "ban_window"), [time(12, 45), time(15, 0)]))
    assert [v.path for v in floor_violations(narrower, reference)] == ["labour.ban_window"]
    shorter_end = candidate((("labour", "ban_window"), [time(12, 30), time(14, 45)]))
    assert [v.path for v in floor_violations(shorter_end, reference)] == ["labour.ban_window"]
    wider = candidate((("labour", "ban_window"), [time(12, 0), time(15, 30)]))
    assert floor_violations(wider, reference) == []


def test_ban_season_floor_wider() -> None:
    reference = released()
    assert [v.path for v in floor_violations(candidate((("labour", "ban_season"), ["06-16", "09-15"])), reference)] == [
        "labour.ban_season"
    ]
    assert [v.path for v in floor_violations(candidate((("labour", "ban_season"), ["06-15", "09-14"])), reference)] == [
        "labour.ban_season"
    ]
    assert floor_violations(candidate((("labour", "ban_season"), ["06-01", "09-30"])), reference) == []


def test_juvenile_window_floor_narrower() -> None:
    reference = released()
    earlier = candidate((("labour", "juvenile_window"), [time(6, 0), time(19, 0)]))
    assert [v.path for v in floor_violations(earlier, reference)] == ["labour.juvenile_window"]
    later = candidate((("labour", "juvenile_window"), [time(7, 0), time(19, 30)]))
    assert [v.path for v in floor_violations(later, reference)] == ["labour.juvenile_window"]
    inside = candidate((("labour", "juvenile_window"), [time(8, 0), time(18, 0)]))
    assert floor_violations(inside, reference) == []


def test_art18_switch_floor_false() -> None:
    reference = released()
    for field in ("art18_ban_gap_counts_as_break", "art18_adosh_rest_counts_as_break"):
        loosened = candidate((("labour", field), True))
        assert [v.path for v in floor_violations(loosened, reference)] == [f"labour.{field}"]
    # The other direction: a reference that credits the ban gap does not forbid a candidate that does not.
    credits = candidate((("labour", "art18_ban_gap_counts_as_break"), True))
    assert floor_violations(reference, credits) == []


@pytest.mark.parametrize(
    ("section", "field", "worse"),
    [
        ("labour", "normal_hours_per_day", 9),
        ("labour", "normal_hours_per_week", 49),
        ("labour", "overtime_hours_per_day", 3),
        ("labour", "total_hours_per_3_weeks", 145),
        ("labour", "art18_max_run_h", 6),
        ("labour", "art18_break_h", 0.5),
        ("labour", "juvenile_max_h", 7),
        ("labour", "juvenile_max_run_h", 5),
        ("labour", "ramadan_reduction_h", 1),
        ("adosh_cycles", "medium_heavy_work_min", 50),
        ("adosh_cycles", "medium_heavy_rest_min", 10),
        ("adosh_cycles", "high_light_work_min", 50),
        ("adosh_cycles", "high_light_rest_min", 10),
        ("adosh_cycles", "high_heavy_work_min", 25),
        ("adosh_cycles", "high_heavy_rest_min", 30),
        ("adosh_cycles", "moderate_uses_heavy", False),
        ("acclimatisation", "unacclimatised_after_days_away", 15),
        ("acclimatisation", "heavy_work_after_days", 5),
        ("privacy", "k_health_floor", 9),
        ("privacy", "k_exposure_floor", 4),
    ],
)
def test_every_scalar_floor_is_compared_in_its_protective_direction(section: str, field: str, worse: Any) -> None:
    reference = released()
    found = floor_violations(candidate(((section, field), worse)), reference)
    assert [v.path for v in found] == [f"{section}.{field}"]
    assert floor_violations(reference, candidate(((section, field), worse))) == []


def test_lone_work_needs_at_least_two_people_by_schema() -> None:
    with pytest.raises(ValueError, match="lone_work_min_headcount"):
        candidate((("adosh_cycles", "lone_work_min_headcount"), 1))
    raised = candidate((("adosh_cycles", "lone_work_min_headcount"), 3))
    # The reference asks for 3, so the released 2 is less protective.
    assert [v.path for v in floor_violations(released(), raised)] == ["adosh_cycles.lone_work_min_headcount"]


def test_ramp_tables_and_metabolic_rates_are_compared_per_entry() -> None:
    reference = released()
    ramp = candidate(
        (("acclimatisation", "new_ramp_pct", "1"), 30),
        (("acclimatisation", "experienced_ramp_pct", "1"), 60),
        (("acclimatisation", "reacclimatisation_pct", "gt20.1"), 60),
    )
    assert [v.path for v in floor_violations(ramp, reference)] == [
        "acclimatisation.new_ramp_pct.1",
        "acclimatisation.experienced_ramp_pct.1",
        "acclimatisation.reacclimatisation_pct.gt20.1",
    ]
    lighter = candidate((("workload", "metabolic_w", "heavy"), 400.0))
    assert [v.path for v in floor_violations(lighter, reference)] == ["workload.metabolic_w.heavy"]


def test_a_missing_section_against_a_present_one_is_one_violation_at_the_section_path() -> None:
    found = floor_violations(seed(), released())
    # Every B3 section, floors or not: a ruleset without clauses or alert templates cannot serve the planner either.
    assert sorted(v.path for v in found) == [
        "acclimatisation",
        "adosh_cycles",
        "alerts",
        "clauses",
        "labour",
        "privacy",
        "workload",
    ]
    labour = next(v for v in found if v.path == "labour")
    assert labour.candidate is None
    assert labour.reference == released().labour
    # No reference section, no violation: the other direction is clean.
    assert floor_violations(released(), seed()) == []


# --- Ruleset.require ---------------------------------------------------------------------------------------------


def test_require_names_the_missing_section() -> None:
    released().require("labour", "adosh_cycles", "acclimatisation", "workload", "privacy", "clauses", "alerts")
    with pytest.raises(RulesetIncompleteError, match=r"ae-heat-0\.1.*labour"):
        seed().require("labour")
    with pytest.raises(RulesetIncompleteError) as excinfo:
        seed().require("twl_zones", "labour", "privacy")
    assert "labour" in str(excinfo.value)
    assert "privacy" in str(excinfo.value)
    assert "twl_zones" not in str(excinfo.value)
    with pytest.raises(ValueError, match="not_a_section"):
        released().require("not_a_section")


# --- runtime config against the released ruleset -----------------------------------------------------------------


def test_pin_to_0_1_in_prod_is_refused_after_2026_1() -> None:
    violations = violations_for(RuntimeConfig(), pin=SEED_ID)
    by_path = {(v.code, v.path) for v in violations}
    # Floors: every section 0.1 lacks is a violation at the section path (labour, cycles, acclimatisation, ...).
    assert ("floor-violation", "ruleset_pin.labour") in by_path
    assert ("floor-violation", "ruleset_pin.adosh_cycles") in by_path
    # Tunables (Task 1): the margin range and default are less protective, and 0.1 declares none of the new ones.
    assert ("floor-violation", "ruleset_pin.tunables.twl_margin_w_m2.min") in by_path
    assert ("floor-violation", "ruleset_pin.tunables.twl_margin_w_m2.default") in by_path
    for name in TUNABLES:
        if name != "twl_margin_w_m2":
            assert ("floor-violation", f"ruleset_pin.tunables.{name}") in by_path, name
    # The ruleset in force can be pinned without a violation.
    assert violations_for(RuntimeConfig(), pin=ID) == []


def test_unpinned_config_validates_against_the_released_ruleset() -> None:
    assert violations_for(RuntimeConfig()) == []


def test_k_below_floor_rejected() -> None:
    for name, value in (("k_health", 9), ("k_exposure", 4)):
        violations = violations_for(RuntimeConfig.model_validate({"tunables": {name: value}}))
        assert [(v.code, v.path) for v in violations] == [("out-of-range", f"tunables.{name}")], name
    assert violations_for(RuntimeConfig.model_validate({"tunables": {"k_health": 10, "k_exposure": 5}})) == []
    assert violations_for(RuntimeConfig.model_validate({"tunables": {"k_health": 50, "k_exposure": 50}})) == []


def test_personal_bands_must_increase() -> None:
    # Each value is inside its own range, so only the ordering rule can refuse them: 0.30 is the top of amber's range
    # and the bottom of orange's, 0.70 the top of orange's and the bottom of red's.
    tied_low = violations_for(
        RuntimeConfig.model_validate(
            {"tunables": {"personal_band_amber": 0.30, "personal_band_orange": 0.30, "personal_band_red": 0.90}}
        )
    )
    assert [(v.code, v.path) for v in tied_low] == [("out-of-range", "tunables.personal_band_orange")]
    tied_high = violations_for(
        RuntimeConfig.model_validate(
            {"tunables": {"personal_band_amber": 0.10, "personal_band_orange": 0.70, "personal_band_red": 0.70}}
        )
    )
    assert [(v.code, v.path) for v in tied_high] == [("out-of-range", "tunables.personal_band_red")]
    # The brief's literal example is refused as well (amber 0.5 is also outside its own range).
    literal = violations_for(
        RuntimeConfig.model_validate(
            {"tunables": {"personal_band_amber": 0.5, "personal_band_orange": 0.5, "personal_band_red": 0.9}}
        )
    )
    assert literal
    assert all(v.code == "out-of-range" and v.path.startswith("tunables.personal_band_") for v in literal)
    # A strictly increasing triple inside the ranges is fine, and so is the default.
    ok = RuntimeConfig.model_validate(
        {"tunables": {"personal_band_amber": 0.30, "personal_band_orange": 0.31, "personal_band_red": 0.71}}
    )
    assert violations_for(ok) == []


def test_resolve_effective_reports_ordering_even_with_a_partial_override() -> None:
    # Only orange is set (0.30) and amber keeps its default 0.10: 0.10 < 0.30 < 0.90 is fine.
    config = RuntimeConfig.model_validate({"tunables": {"personal_band_orange": 0.30}})
    assert isinstance(resolve_effective(config, released()), EffectiveParams)
    # Only red is set at its minimum 0.70 while orange is raised to 0.70: a tie through the defaults path.
    config = RuntimeConfig.model_validate({"tunables": {"personal_band_orange": 0.70, "personal_band_red": 0.70}})
    result = resolve_effective(config, released())
    assert isinstance(result, list)
    assert [(v.code, v.path) for v in result] == [("out-of-range", "tunables.personal_band_red")]


def test_an_integer_tunable_with_a_fractional_ruleset_default_is_refused() -> None:
    data = raw()
    data["tunables"]["k_health"]["default"] = 10.5
    result = resolve_effective(RuntimeConfig(), Ruleset.model_validate(data))
    assert isinstance(result, list)
    assert [(v.code, v.path) for v in result] == [("out-of-range", "tunables.k_health")]


def test_the_lock_file_pins_both_released_rulesets() -> None:
    lock = json.loads((RULESETS_DIR / "lock.json").read_text(encoding="utf-8"))
    assert set(lock) == {SEED_ID, ID}


@pytest.mark.parametrize(
    ("name", "bad", "good"),
    [
        ("alert_dispatch_interval_minutes", (0, 31), (1, 5, 30)),
        ("alert_lead_hours", (0, 25), (1, 24)),
        ("deescalation_dwell_minutes", (-1, 181), (0, 180)),
        ("forecast_stale_after_hours", (5, 49), (6, 48)),
        ("low_zone_voluntary_rest_min", (-1, 16), (0, 15)),
    ],
)
def test_integer_tunables_are_bounded_by_their_ranges(name: str, bad: tuple[int, ...], good: tuple[int, ...]) -> None:
    for value in bad:
        violations = violations_for(RuntimeConfig.model_validate({"tunables": {name: value}}))
        assert [(v.code, v.path) for v in violations] == [("out-of-range", f"tunables.{name}")], (name, value)
    for value in good:
        assert violations_for(RuntimeConfig.model_validate({"tunables": {name: value}})) == [], (name, value)


@pytest.mark.parametrize(
    ("name", "bad", "good"),
    [
        ("warning_theta", (0.04, 0.51), (0.05, 0.50)),
        ("red_twl_w_m2", (59.9, 115.1), (60.0, 115.0)),
        ("twl_margin_w_m2", (6.9, 20.1), (7.0, 20.0)),
    ],
)
def test_float_tunables_are_bounded_by_their_ranges(name: str, bad: tuple[float, ...], good: tuple[float, ...]) -> None:
    for value in bad:
        violations = violations_for(RuntimeConfig.model_validate({"tunables": {name: value}}))
        assert [(v.code, v.path) for v in violations] == [("out-of-range", f"tunables.{name}")], (name, value)
    for value in good:
        assert violations_for(RuntimeConfig.model_validate({"tunables": {name: value}})) == [], (name, value)
