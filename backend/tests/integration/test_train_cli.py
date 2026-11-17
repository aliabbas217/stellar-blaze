"""``sb-jobs train`` end to end against a real Postgres: a ``job_run`` row, a model directory the scan accepts.

The command runs ``asyncio.run`` itself, so the test is synchronous. The gold file is the tiny synthetic one of
``tests/fixtures/forecast/train_cli.py`` (with a 2026 summer the command must not load); git is replaced.
"""

import json
from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner

from stellar_blaze.adapters.config.models import scan_models
from stellar_blaze.config import Settings
from stellar_blaze.jobs import replay_build
from stellar_blaze.jobs.cli import app
from tests.fixtures.forecast.train_cli import CONFIG_NAME, CONFIG_TOML, GIT_SHA, fake_repo, write_gold
from tests.integration.db_admin import fetch_all


@pytest.mark.integration
@pytest.mark.slow
def test_train_cli_records_job_run(settings: Settings, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SB_DATABASE_URL", settings.database_url.get_secret_value())
    monkeypatch.setenv("SB_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("SB_ENV", "test")
    monkeypatch.setenv("SB_LOG_FORMAT", "json")
    monkeypatch.setenv("SB_GIT_SHA", "abc1234")
    monkeypatch.chdir(tmp_path)  # a developer's backend/.env is not read
    write_gold(tmp_path / "data")
    config = tmp_path / f"{CONFIG_NAME}.toml"
    config.write_bytes(CONFIG_TOML.encode("utf-8"))
    repo = fake_repo(tmp_path)
    monkeypatch.setattr(replay_build, "git_head", lambda root: GIT_SHA)
    monkeypatch.setattr(replay_build, "repo_root", lambda: repo)

    result = CliRunner().invoke(app, ["train", "--config", str(config)])

    assert result.exit_code == 0, result.output
    runs: list[dict[str, Any]] = fetch_all(
        settings.database_url.get_secret_value(),
        "SELECT job_name, status, params, summary, error, code_version FROM job_run ORDER BY started_at",
    )
    (run,) = runs
    assert run["job_name"] == f"train:{CONFIG_NAME}"
    assert run["status"] == "succeeded"
    assert run["error"] is None
    assert run["params"]["config_name"] == CONFIG_NAME
    assert run["params"]["release"] is False
    models_eval = tmp_path / "data" / "models-eval"
    model_id = run["summary"]["model_id"]
    assert run["summary"]["directory"] == str(models_eval / model_id)
    assert (models_eval / model_id).is_dir()
    assert scan_models(models_eval).ids() == (model_id,)  # every listed file exists and hashes to the manifest
    params = json.loads((models_eval / model_id / "params.json").read_bytes())
    assert params["summers"] == [2024, 2025]  # the 2026 rows of the gold file were never loaded
