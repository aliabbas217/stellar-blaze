"""The ``sb-jobs`` command line: usage and configuration errors end before anything touches the database."""

from pathlib import Path

import pytest
from typer.testing import CliRunner

from stellar_blaze.jobs.cli import app

pytestmark = pytest.mark.unit

DATABASE_URL = "postgresql+asyncpg://sb:hunter2@localhost:5432/stellar_blaze"


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch, clean_cwd: None) -> None:
    """A valid environment that never connects: usage errors must end before the first connection."""
    monkeypatch.setenv("SB_DATABASE_URL", DATABASE_URL)
    monkeypatch.setenv("SB_ENV", "test")
    monkeypatch.setenv("SB_LOG_FORMAT", "json")


@pytest.fixture
def clean_cwd(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Run in an empty directory: a developer's ``backend/.env`` must not supply what the test leaves out."""
    monkeypatch.chdir(tmp_path)


def test_help_lists_the_three_commands() -> None:
    result = CliRunner().invoke(app, ["--help"])

    assert result.exit_code == 0
    for command in ("ingest-observations", "ingest-forecasts", "build-dataset"):
        assert command in result.output


@pytest.mark.usefixtures("configured")
def test_a_source_that_is_not_iem_or_ghcnh_is_a_usage_error() -> None:
    result = CliRunner().invoke(app, ["ingest-observations", "--source", "meteostat", "--summer", "2025"])

    assert result.exit_code == 2
    assert "meteostat" in result.output


@pytest.mark.usefixtures("configured")
def test_the_summer_is_required() -> None:
    result = CliRunner().invoke(app, ["ingest-observations", "--source", "iem"])

    assert result.exit_code == 2
    assert "--summer" in result.output


@pytest.mark.usefixtures("configured")
def test_an_unknown_station_is_a_usage_error_that_lists_the_known_ones() -> None:
    result = CliRunner().invoke(
        app, ["ingest-observations", "--source", "iem", "--summer", "2025", "--station", "KJFK"]
    )

    assert result.exit_code == 2
    assert "KJFK" in result.output
    assert "OMAA" in result.output


@pytest.mark.usefixtures("configured")
def test_a_model_summer_without_an_archive_is_a_usage_error_before_any_request() -> None:
    result = CliRunner().invoke(app, ["ingest-forecasts", "--model", "ecmwf_aifs025_single", "--summer", "2024"])

    assert result.exit_code == 2
    assert "ecmwf_aifs025_single" in result.output
    assert "2024" in result.output
    assert "2025" in result.output  # says which summers do exist


@pytest.mark.usefixtures("clean_cwd")
def test_a_missing_database_url_is_a_configuration_error_naming_the_variable() -> None:
    result = CliRunner().invoke(app, ["build-dataset"])

    assert result.exit_code == 2
    assert "database_url" in result.output
    assert "Traceback" not in result.output


@pytest.mark.usefixtures("clean_cwd")
def test_an_invalid_setting_is_named_and_no_secret_is_printed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SB_DATABASE_URL", DATABASE_URL)
    monkeypatch.setenv("SB_HTTP_TIMEOUT_S", "soon")

    result = CliRunner().invoke(app, ["build-dataset"])

    assert result.exit_code == 2
    assert "http_timeout_s" in result.output
    assert "hunter2" not in result.output
    assert "soon" not in result.output  # the offending value is not echoed either
