"""The dev scoreboards on B2's real out-of-fold export (read-only; runs only when ``SB_OOF_PATH`` names the file).

Set ``SB_OOF_PATH`` to ``oof_samples_abu_dhabi.parquet`` (B2's ``artifacts/eval/dev/``); the file is git-ignored and is
never copied or written. The test runs ``sb-jobs freeze theta`` and ``sb-jobs scoreboard dev --summer 2025`` into a
temporary directory, checks that every output validates against the typed models, and prints the wall time.
"""

import json
import os
import sys
import time
from pathlib import Path

import pytest
from typer.testing import CliRunner

from stellar_blaze.domain.scoreboard import DemoDay, PlanScoreboard, PolicyScoreboard, ThetaDecision
from stellar_blaze.jobs.cli import app
from tests.unit.rules.support import RULESETS_DIR

OOF = Path(os.environ["SB_OOF_PATH"]) if os.environ.get("SB_OOF_PATH") else None

pytestmark = [
    pytest.mark.regression,
    pytest.mark.slow,
    pytest.mark.skipif(OOF is None or not OOF.is_file(), reason="SB_OOF_PATH does not name the OOF export"),
]


def test_the_dev_scoreboards_run_on_the_real_oof_and_validate(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert OOF is not None
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SB_DATABASE_URL", "postgresql+asyncpg://sb:hunter2@localhost:5432/stellar_blaze")
    monkeypatch.setenv("SB_ENV", "test")
    monkeypatch.setenv("SB_LOG_FORMAT", "json")
    monkeypatch.setenv("SB_RULESETS_DIR", str(RULESETS_DIR))
    runner = CliRunner()
    theta = tmp_path / "theta.json"
    frozen = runner.invoke(app, ["freeze", "theta", "--oof", str(OOF), "--out", str(theta)])
    assert frozen.exit_code == 0, frozen.output
    ThetaDecision.model_validate_json(theta.read_bytes())

    started = time.monotonic()
    result = runner.invoke(
        app, ["scoreboard", "dev", "--summer", "2025", "--oof", str(OOF), "--theta", str(theta), "--out", str(tmp_path)]
    )
    wall = time.monotonic() - started

    assert result.exit_code == 0, result.output
    PolicyScoreboard.model_validate_json((tmp_path / "policy_scoreboard.2025.json").read_bytes())
    PlanScoreboard.model_validate_json((tmp_path / "plan_scoreboard.2025.json").read_bytes())
    DemoDay.model_validate_json((tmp_path / "demo_day.2025.json").read_bytes())
    summary = json.loads(result.stdout.strip().splitlines()[-1])
    with capsys.disabled():
        sys.stdout.write(
            f"\nscoreboard dev --summer 2025, real OOF: {wall:.1f} s wall ({summary['seconds']} s in the command)\n"
        )
