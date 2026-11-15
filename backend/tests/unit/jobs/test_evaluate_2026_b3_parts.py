"""``evaluate-2026 --part warnings|plans``: the forecast part's gate plus the freeze inputs (synthetic world).

The gate itself is tested in ``tests/unit/ml/test_protocol_gate.py``; here the two parts are driven through B2's gated
world (``tests/fixtures/forecast/gated.py``) and ``jobs/evaluate_2026.py``'s own freeze-input check. Nothing reads a
2026 file: the refusals all happen before any data is touched.
"""

import hashlib
import shutil
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Final, cast

import pytest

from stellar_blaze.config import Settings
from stellar_blaze.domain.scoreboard import Provenance, ProvenanceLabel, ThetaDecision, ThetaGridPoint
from stellar_blaze.jobs import evaluate_2026
from stellar_blaze.ml.artifact_io import write_artifact
from stellar_blaze.ml.protocol_gate import GateRefusedError, GateToken, Part
from tests.fixtures.forecast.gated import GatedWorld, released
from tests.unit.jobs import test_evaluate_2026_cli as base
from tests.unit.rules.support import RULESETS_DIR

pytestmark = pytest.mark.unit

env = base.env  # the synthetic gated world of the forecast part's tests, as a fixture of this module
invoke = base.invoke

BACKEND: Final = Path(__file__).resolve().parents[3]
FILES: Final = {"warnings": "policy_scoreboard.json", "plans": "plan_scoreboard.json"}


@pytest.mark.parametrize("part", ["warnings", "plans"])
def test_parts_refuse_without_freeze_file(env: base.Env, part: str) -> None:
    (env.world.repo_root / "docs" / "research" / "freeze.md").unlink()

    result = invoke("--part", part)

    assert result.exit_code == 2
    assert "freeze-hash-mismatch: " in result.stderr
    assert "the 2026 gate is closed" in result.stderr
    assert env.loads == []  # no gold read
    assert env.runs.finished == []  # refused before the job
    assert not env.results.exists()


@pytest.mark.parametrize("part", ["warnings", "plans"])
def test_parts_refuse_an_edited_freeze_file(env: base.Env, part: str) -> None:
    path = env.world.repo_root / "docs" / "research" / "freeze.md"
    path.write_bytes(path.read_bytes() + b"edited after the lock\n")

    result = invoke("--part", part)

    assert result.exit_code == 2
    assert "freeze-hash-mismatch: " in result.stderr
    assert env.loads == []


@pytest.mark.parametrize("part", ["warnings", "plans"])
def test_parts_refuse_second_run(env: base.Env, part: str) -> None:
    env.results.mkdir(parents=True)
    result_file = env.results / FILES[part]
    result_file.write_bytes(b"{}\n")

    result = invoke("--part", part)

    assert result.exit_code == 2
    assert "result-exists: " in result.stderr
    assert result_file.read_bytes() == b"{}\n"  # the first result is untouched
    assert env.loads == []
    assert env.runs.finished == []


def test_the_parts_are_registered_in_order() -> None:
    assert list(evaluate_2026.PART_RUNNERS) == [Part.FORECAST, Part.WARNINGS, Part.PLANS]


def test_the_warnings_part_selects_the_demo_day_before_it_scores_the_board(monkeypatch: pytest.MonkeyPatch) -> None:
    # Pre-registration 7.4: the day is chosen on truth alone BEFORE any P3 output is read. Every collaborator is a
    # recording stub, so only the order of the calls is under test.
    calls: list[str] = []

    def stub(name: str, result: object = None) -> Callable[..., object]:
        def call(*_args: object, **_kwargs: object) -> object:
            calls.append(name)
            return result

        return call

    frozen = SimpleNamespace(
        theta=SimpleNamespace(theta_protect=0.1, theta_balanced=0.2), loaded=SimpleNamespace(ruleset="r"), params="p"
    )
    inputs = SimpleNamespace(
        rows="rows",
        truth_frame=stub("truth_frame", "truth"),
        present_frame=stub("present_frame", "present"),
        wbgt=stub("wbgt", "wbgt"),
    )
    stubs: dict[str, object] = {
        "_plan": None,
        "frozen_inputs": frozen,
        "_scoring_inputs": inputs,
        "_board_context": "context",
        "select_demo_day": SimpleNamespace(date="day"),
        "warnings_scoreboard": "board",
        "fill_demo_day": "demo",
        "render_artifact": b"{}",
        "_write_part": {},
    }
    for name, result in stubs.items():
        monkeypatch.setattr(evaluate_2026, name, stub(name, result))
    token, settings = cast(GateToken, SimpleNamespace(part=Part.WARNINGS)), cast(Settings, SimpleNamespace())

    evaluate_2026.run_warnings(settings, token, Path(), amendment=None)

    assert calls.index("select_demo_day") < calls.index("warnings_scoreboard")
    assert calls.index("select_demo_day") < calls.index("fill_demo_day")


# === the freeze inputs ==============================================================================================


def theta_file(path: Path) -> str:
    grid = [ThetaGridPoint(theta=0.05, pod=1.0, far=0.5, pss=0.5, n_hours=10)]
    decision = ThetaDecision(
        theta_protect=0.25,
        theta_balanced=0.35,
        grid=grid,
        red_hour_share=0.1,
        n_hours=10,
        rule="preregistration §6.5",
        provenance=Provenance(
            protocol_path="docs/research/p.md",
            protocol_anchor="#6",
            script="stellar_blaze.ml.theta",
            function="select_theta",
            git_sha="a" * 40,
            data_sha256="b" * 64,
            model_id=None,
            label=ProvenanceLabel.REAL,
            generated_at=datetime(2026, 11, 15, tzinfo=UTC),
        ),
    )
    write_artifact(path, decision)
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture
def repo(tmp_path: Path) -> tuple[GatedWorld, Path, Settings, dict[str, str]]:
    """A gated world whose repository also holds ``theta.json`` and the demo fixture; returns each input's SHA-256."""
    world = GatedWorld(tmp_path, released().model.manifest.model_id, released().models_dir)
    root = world.repo_root
    theta_sha = theta_file(root / evaluate_2026.THETA_PATH)
    fixture = root / evaluate_2026.FIXTURE_PATH
    fixture.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(BACKEND / "fixtures" / "demo_site.toml", fixture)
    ruleset_sha = hashlib.sha256((RULESETS_DIR / f"{evaluate_2026.FROZEN_RULESET_ID}.toml").read_bytes()).hexdigest()
    settings = cast(Settings, SimpleNamespace(rulesets_dir=RULESETS_DIR))
    hashes = {
        "theta": theta_sha,
        "ruleset": ruleset_sha,
        "fixture": hashlib.sha256(fixture.read_bytes()).hexdigest(),
    }
    return world, root, settings, hashes


def test_the_addendum_must_record_the_sha256_of_theta_the_ruleset_and_the_fixture(
    repo: tuple[GatedWorld, Path, Settings, dict[str, str]],
) -> None:
    world, root, settings, hashes = repo
    gate = world.token(Part.WARNINGS)
    freeze = root / "docs" / "research" / "freeze.md"
    freeze.write_text(f"theta {hashes['theta']}\n", encoding="utf-8")

    with pytest.raises(GateRefusedError) as raised:
        evaluate_2026.frozen_inputs(settings, gate, root)

    reasons = " ".join(raised.value.reasons)
    assert "freeze-input-missing" in reasons
    assert "ruleset ae-heat-2026.1" in reasons
    assert evaluate_2026.FIXTURE_PATH in reasons
    assert evaluate_2026.THETA_PATH not in reasons  # the one that is recorded is not reported


def test_the_frozen_inputs_load_when_the_addendum_records_them_and_theta_comes_from_the_dev_file(
    repo: tuple[GatedWorld, Path, Settings, dict[str, str]],
) -> None:
    world, root, settings, hashes = repo
    gate = world.token(Part.PLANS)
    freeze = root / "docs" / "research" / "freeze.md"
    # The fixture hash is accepted as read or with CRLF read as LF (a Windows checkout): both spellings work.
    freeze.write_text("\n".join(hashes.values()).upper() + "\n", encoding="utf-8")

    frozen = evaluate_2026.frozen_inputs(settings, gate, root)

    assert (frozen.theta.theta_protect, frozen.theta.theta_balanced) == (0.25, 0.35)
    assert frozen.loaded.ruleset.meta.id == evaluate_2026.FROZEN_RULESET_ID
    assert frozen.fixture_sha256 == hashes["fixture"]
    assert frozen.params.twl_margin_w_m2 == 7.0  # the ruleset's default, never the live configuration
