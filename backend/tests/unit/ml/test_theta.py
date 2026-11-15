"""``ml.theta`` and ``sb-jobs freeze theta``: pre-registration 6.5 on hand-computed synthetic out-of-fold samples.

Every expectation below is worked out by hand in the comments (counts of hours at each theta), not read from the code.
"""

import dataclasses
import hashlib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final, Literal

import numpy as np
import pytest
from typer.testing import CliRunner, Result

from stellar_blaze.domain.risk.levels import Zone, ZoneEdges, zone_of
from stellar_blaze.domain.scoreboard import Provenance, ProvenanceLabel, ThetaDecision
from stellar_blaze.jobs.cli import app
from stellar_blaze.ml import theta
from stellar_blaze.ml.data import HoldoutViolationError
from stellar_blaze.ml.twl_rows import forward_effective, raw_twl
from tests.fixtures.scoreboard.oof import Hour, off_season, oof_frame, utc
from tests.unit.risk.support import default_params, released_ruleset
from tests.unit.rules.support import RULESETS_DIR

pytestmark = pytest.mark.unit

PROVENANCE: Final = Provenance(
    protocol_path="docs/research/2026-11-12-preregistration-2026-evaluation.md",
    protocol_anchor="#6-selection-rules-on-2024-2025-loco-out-of-fold-only",
    script="stellar_blaze.ml.theta",
    function="select_theta",
    git_sha="a" * 40,
    data_sha256="b" * 64,
    model_id=None,
    label=ProvenanceLabel.REAL,
    generated_at=datetime(2026, 11, 15, tzinfo=UTC),
)


def decide(hours: list[Hour], params: Any = None) -> ThetaDecision:
    return theta.select_theta(oof_frame(hours), released_ruleset(), params or default_params(), provenance=PROVENANCE)


def rows(counts: list[int], truth: Literal["high", "low", "none"], start: int) -> list[Hour]:
    return [Hour(off_season(start + i), k, truth) for i, k in enumerate(counts)]


# P(High) = k / 50. Ten truth-High hours, P = .90 .80 .70 .60 .50 .46 .40 .32 .30 .04, and ten calm hours,
# P = .60 .40 .20 .10 .10 .06 .02 0 0 0.
DANGER_K: Final = [45, 40, 35, 30, 25, 23, 20, 16, 15, 2]
CALM_K: Final = [30, 20, 10, 5, 5, 3, 1, 0, 0, 0]


def crossing() -> list[Hour]:
    return rows(DANGER_K, "high", 0) + rows(CALM_K, "low", 10)


def test_the_states_are_what_the_fixture_says() -> None:
    params, ruleset = default_params(), released_ruleset()
    edges = ZoneEdges.from_ruleset(ruleset, params)
    frame = oof_frame([Hour(off_season(0), 50, "high"), Hour(off_season(1), 0, "low")])
    samples = np.asarray(frame["samples"].to_numpy(), dtype=np.float64)
    effective = forward_effective(frame, samples, ruleset=ruleset, params=params)
    assert set(zone_of(effective[0], edges).tolist()) == {int(Zone.HIGH)}
    assert set(zone_of(effective[1], edges).tolist()) == {int(Zone.LOW)}
    truth = raw_twl(frame, "obs_t_c", "obs_td_c", "obs_wind_ms", "ref_sw_wm2", "ref_direct_wm2", "ref_pressure_hpa")
    assert zone_of(truth - params.twl_margin_w_m2, edges).tolist() == [int(Zone.HIGH), int(Zone.LOW)]


def test_theta_rule_on_synthetic() -> None:
    # hits at theta: .05-.30 -> 9, .35-.40 -> 7, .45 -> 6, .50 -> 5, .55-.60 -> 4, .65 -> 3: POD is .9 up to .30 and .7
    # at .35, so theta_protect = .30 (the largest theta with POD >= .90; exactly .9 counts).
    decision = decide(crossing())

    assert decision.theta_protect == 0.30
    by_theta = {point.theta: point for point in decision.grid}
    assert [p.theta for p in decision.grid] == [round(0.05 * k, 2) for k in range(1, 20)]
    assert by_theta[0.30].pod == pytest.approx(0.9)
    assert by_theta[0.35].pod == pytest.approx(0.7)
    assert by_theta[0.45].pod == pytest.approx(0.6)
    assert by_theta[0.65].pod == pytest.approx(0.3)
    # calm hours warned at .30: P = .6 and .4, so 2 of 10: POFD .2, PSS .9 - .2 = .7, FAR 2 / (9 + 2).
    assert by_theta[0.30].pss == pytest.approx(0.7)
    assert by_theta[0.30].far == pytest.approx(2 / 11)
    assert by_theta[0.05].pss == pytest.approx(0.9 - 0.6)  # calm warned at .05: .6 .4 .2 .1 .1 .06 -> 6 of 10
    assert all(p.n_hours == 20 for p in decision.grid)
    assert decision.n_hours == 20
    assert decision.rule == "preregistration §6.5"


def test_balanced_ties_go_lower() -> None:
    # PSS is .7 at both .25 (9 hits, 2 false alarms) and .30 (9 hits, 2 false alarms) and nowhere larger.
    decision = decide(crossing())
    pss = {point.theta: point.pss for point in decision.grid}

    assert pss[0.25] == pytest.approx(pss[0.30]) == pytest.approx(0.7)
    assert max(pss.values()) == pytest.approx(0.7)
    assert decision.theta_balanced == 0.25


def test_no_theta_reaches_pod_090_gives_005() -> None:
    # Ten truth-High hours that all but one forecast sample misses (P = .02): POD is 0 on the whole grid.
    decision = decide(rows([1] * 10, "high", 0) + rows([0] * 5, "low", 10))

    assert decision.theta_protect == 0.05
    assert all(point.pod == 0.0 for point in decision.grid)
    assert decision.theta_balanced == 0.05  # PSS is 0 everywhere: the tie goes to the smaller theta


def test_a_share_equal_to_theta_warns() -> None:
    # One truth-High hour with P = .30 exactly (15 of 50): warned at theta .30 (a tie escalates), not at .35.
    decision = decide(rows([15], "high", 0) + rows([0], "low", 1))
    pod = {point.theta: point.pod for point in decision.grid}

    assert pod[0.30] == 1.0
    assert pod[0.35] == 0.0
    assert decision.theta_protect == 0.30


@pytest.mark.parametrize(
    ("miss_at", "hits", "expected"),
    [
        # 4 hits + one miss at 09 UTC in July (ban weight 0): POD 4/4 = 1.0 -> .95 (unweighted .8 would give .05).
        (utc(2025, 7, 1, 9), 4, 0.95),
        # 9 hits + one miss at 08 UTC (weight .5): POD 9 / 9.5 = .947 -> .95.
        (utc(2025, 7, 1, 8), 9, 0.95),
        # 4 hits + one miss at 08 UTC: POD 4 / 4.5 = .889 < .9 -> the floor .05.
        (utc(2025, 7, 1, 8), 4, 0.05),
        # the same miss at 11 UTC (outside the ban window, weight 1): POD 4 / 5 = .8 -> the floor.
        (utc(2025, 7, 1, 11), 4, 0.05),
    ],
)
def test_hours_are_weighted_by_their_non_ban_fraction(miss_at: datetime, hits: int, expected: float) -> None:
    hours = [Hour(off_season(i), 50, "high") for i in range(hits)]
    hours += [Hour(miss_at, 0, "high")]
    hours += [Hour(off_season(20 + i), 0, "low") for i in range(3)]

    assert decide(hours).theta_protect == expected


def test_unscored_hours_are_not_imputed() -> None:
    # A row with no observed truth is out of the selection (n_hours counts the rest).
    decision = decide([*crossing(), Hour(off_season(30), 50, "none")])

    assert decision.n_hours == 20
    assert decision.theta_protect == 0.30


def test_red_hour_share() -> None:
    # Truth is Red when the effective TWL is below the Red edge: put the edge above the HIGH state (about 100).
    raised = dataclasses.replace(default_params(), red_twl_w_m2=110.0)

    assert decide(crossing(), raised).red_hour_share == pytest.approx(10 / 20)
    assert decide(crossing()).red_hour_share == 0.0


def test_the_rule_reads_the_abu_dhabi_cluster_lead_1_working_hours_only() -> None:
    other = [
        Hour(off_season(25), 0, "high", cluster="oman_coast"),  # another cluster: ignored
        Hour(off_season(26, hour=3), 0, "high"),  # 03 UTC: outside 06-14
    ]

    assert decide(crossing() + other).theta_protect == 0.30


def test_refuses_2026_rows() -> None:
    by_summer = [Hour(utc(2026, 6, 1, 10), 50, "high", summer=2026), *crossing()]
    by_year = [Hour(utc(2026, 6, 1, 10), 50, "high", summer=2025), *crossing()]
    for hours in (by_summer, by_year):
        with pytest.raises(HoldoutViolationError, match="2026"):
            decide(hours)


def test_refuses_a_set_without_a_danger_hour() -> None:
    with pytest.raises(ValueError, match="no truth danger hour"):
        decide(rows([0, 0], "low", 0))


# --- the command ------------------------------------------------------------------------------------------------------


def write_oof(path: Path, hours: list[Hour]) -> str:
    oof_frame(hours).write_parquet(path)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_command(oof: Path, out: Path, ruleset: str = "ae-heat-2026.1") -> Result:
    return CliRunner().invoke(app, ["freeze", "theta", "--oof", str(oof), "--ruleset", ruleset, "--out", str(out)])


@pytest.fixture
def environment(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SB_DATABASE_URL", "postgresql+asyncpg://sb:hunter2@localhost:5432/stellar_blaze")
    monkeypatch.setenv("SB_ENV", "test")
    monkeypatch.setenv("SB_LOG_FORMAT", "json")
    monkeypatch.setenv("SB_RULESETS_DIR", str(RULESETS_DIR))
    return tmp_path


def test_output_has_provenance(environment: Path) -> None:
    oof = environment / "oof.parquet"
    digest = write_oof(oof, crossing())
    out = environment / "theta.json"

    result = run_command(oof, out)

    assert result.exit_code == 0, result.output
    decision = ThetaDecision.model_validate_json(out.read_bytes())
    assert (decision.theta_protect, decision.theta_balanced) == (0.30, 0.25)
    assert decision.provenance.data_sha256 == digest
    assert decision.provenance.script == "stellar_blaze.ml.theta"
    assert decision.provenance.label is ProvenanceLabel.REAL
    assert decision.provenance.protocol_anchor == "#6-selection-rules-on-2024-2025-loco-out-of-fold-only"
    assert out.read_bytes().endswith(b"\n")
    assert b"\r" not in out.read_bytes()


def test_the_command_refuses_2026_rows_and_writes_nothing(environment: Path) -> None:
    oof = environment / "oof.parquet"
    write_oof(oof, [Hour(utc(2026, 6, 1, 10), 50, "high", summer=2026), *crossing()])
    out = environment / "theta.json"

    result = run_command(oof, out)

    assert result.exit_code == 2
    assert "2026" in result.output
    assert not out.exists()


def test_the_command_refuses_an_unknown_ruleset_and_a_missing_file(environment: Path) -> None:
    oof = environment / "oof.parquet"
    write_oof(oof, crossing())

    assert run_command(oof, environment / "t.json", ruleset="nope").exit_code == 2
    assert run_command(environment / "missing.parquet", environment / "t.json").exit_code == 2
    assert not (environment / "t.json").exists()


def test_the_frozen_params_are_the_ruleset_defaults() -> None:
    params = default_params()
    assert (params.twl_margin_w_m2, params.red_twl_w_m2) == (7.0, 85.0)
