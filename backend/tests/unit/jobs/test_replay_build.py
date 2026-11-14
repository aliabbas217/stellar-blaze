"""``sb-jobs replay build``: the builder (a plain function) and the command around it.

Inputs are synthetic silver files under ``tmp_path`` with 2025 dates; the real data directory is never read.
"""

import hashlib
import json
import subprocess
import sys
import textwrap
from datetime import UTC, datetime
from pathlib import Path

import polars as pl
import pytest
from typer.testing import CliRunner

from stellar_blaze.adapters.storage.parquet_store import ParquetStore
from stellar_blaze.domain.provenance import ProvenanceLabel
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.replay import ReplaySnapshot
from stellar_blaze.domain.weather.schemas import FORECAST_SCHEMA, OBS_HOURLY_SCHEMA
from stellar_blaze.domain.weather.stations import station
from stellar_blaze.jobs import replay_build
from stellar_blaze.jobs.cli import app
from stellar_blaze.jobs.replay_build import ReplayBuildError, build_replay_snapshot, git_head
from tests.fixtures.forecast.replay import (
    CREATED_AT,
    FIXTURE_STATIONS,
    GIT_SHA,
    SNAPSHOT_ID,
    SUMMER,
    build_fixture_snapshot,
    seed_silver,
    synthetic_pairs,
)
from tests.fixtures.forecast.synthetic import forecasts_of, observations_of

pytestmark = pytest.mark.unit

DATABASE_URL = "postgresql+asyncpg://sb:hunter2@localhost:5432/stellar_blaze"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# --- what a snapshot is ---------------------------------------------------------------------------------------------


def test_the_snapshot_holds_exactly_the_three_files_and_nothing_else(tmp_path: Path) -> None:
    built = build_fixture_snapshot(tmp_path)

    assert built.directory == tmp_path / "replay" / SNAPSHOT_ID
    assert sorted(path.name for path in built.directory.iterdir()) == [
        "forecasts.parquet",
        "observations.parquet",
        "snapshot.json",
    ]
    assert sorted(path.name for path in (tmp_path / "replay").iterdir()) == [SNAPSHOT_ID]  # no staging leftovers
    assert built.size_bytes == sum(path.stat().st_size for path in built.directory.iterdir())


def test_the_manifest_hashes_are_over_the_stored_bytes(tmp_path: Path) -> None:
    built = build_fixture_snapshot(tmp_path)

    manifest = ReplaySnapshot.model_validate_json((built.directory / "snapshot.json").read_bytes())

    assert manifest == built.snapshot
    assert {file.path: file.sha256 for file in manifest.files} == {
        "forecasts.parquet": sha256(built.directory / "forecasts.parquet"),
        "observations.parquet": sha256(built.directory / "observations.parquet"),
    }


def test_the_manifest_describes_the_summer_stations_and_models(tmp_path: Path) -> None:
    manifest = build_fixture_snapshot(tmp_path).snapshot

    assert manifest.snapshot_id == SNAPSHOT_ID
    assert manifest.created_at == CREATED_AT
    assert manifest.stations == ["OMAA", "OMDB"]
    assert manifest.models == ["ecmwf_ifs025", "gfs_seamless"]
    assert manifest.start == datetime(SUMMER, 5, 15, 0, tzinfo=UTC)
    assert manifest.end == datetime(SUMMER, 9, 30, 23, tzinfo=UTC)


def test_the_manifest_carries_real_provenance_from_the_builder(tmp_path: Path) -> None:
    built = build_fixture_snapshot(tmp_path)
    provenance = built.snapshot.provenance

    assert provenance.label is ProvenanceLabel.REAL
    assert provenance.git_sha == GIT_SHA
    assert provenance.script == "stellar_blaze.jobs.replay_build"
    assert provenance.function == "build_replay_snapshot"
    assert provenance.model_id is None
    assert provenance.generated_at == CREATED_AT
    expected = hashlib.sha256(
        "".join(f"{file.path}:{file.sha256}\n" for file in sorted(built.snapshot.files, key=lambda f: f.path)).encode()
    ).hexdigest()
    assert provenance.data_sha256 == expected  # the digest of the file hashes: the data the label stands for


def test_the_files_hold_the_silver_rows_of_the_stations_models_leads_and_window_only(tmp_path: Path) -> None:
    """Rows of another station or model, a lead above 7 and hours outside the summer window stay out."""
    omaa, omdb, omal = station("OMAA"), station("OMDB"), station("OMAL")
    pairs = synthetic_pairs((omaa, omdb, omal))
    store = seed_silver(tmp_path, pairs)
    ifs = forecasts_of(pairs, "ecmwf_ifs025").filter(pl.col("station") == "OMAA")
    truth = observations_of(pairs).filter(pl.col("station") == "OMAA")
    before = datetime(SUMMER, 5, 14, 23, tzinfo=UTC)
    after = datetime(SUMMER, 10, 1, 0, tzinfo=UTC)
    stray_forecasts = [
        ifs.head(1).with_columns(valid_time=pl.lit(before).cast(pl.Datetime("us", "UTC"))),
        ifs.head(1).with_columns(valid_time=pl.lit(after).cast(pl.Datetime("us", "UTC"))),
        ifs.head(1).with_columns(lead_days=pl.lit(9, dtype=pl.Int8)),
    ]
    store.write_forecasts(NwpModel.ECMWF_IFS025, SUMMER, "OMAA", pl.concat([ifs, *stray_forecasts]))
    store.write_forecasts(  # a third model, which the snapshot does not carry
        NwpModel.ECMWF_AIFS025, SUMMER, "OMAA", ifs.with_columns(model=pl.lit("ecmwf_aifs025_single"))
    )
    stray_truth = [
        truth.head(1).with_columns(valid_time=pl.lit(moment).cast(pl.Datetime("us", "UTC")))
        for moment in (before, after)
    ]
    store.write_observations("iem", SUMMER, "OMAA", pl.concat([truth, *stray_truth]))

    built = build_fixture_snapshot(tmp_path, store=store)

    forecasts = pl.read_parquet(built.directory / "forecasts.parquet")
    stored_truth = pl.read_parquet(built.directory / "observations.parquet")
    assert forecasts.schema == FORECAST_SCHEMA
    assert stored_truth.schema == OBS_HOURLY_SCHEMA
    assert sorted(forecasts["station"].unique().to_list()) == ["OMAA", "OMDB"]
    assert sorted(forecasts["model"].unique().to_list()) == ["ecmwf_ifs025", "gfs_seamless"]
    assert sorted(forecasts["lead_days"].unique().to_list()) == list(range(8))
    assert before not in forecasts["valid_time"].to_list()
    assert after not in forecasts["valid_time"].to_list()
    assert sorted(stored_truth["station"].unique().to_list()) == ["OMAA", "OMDB"]
    assert stored_truth["source"].unique().to_list() == ["iem"]
    assert before not in stored_truth["valid_time"].to_list()
    assert after not in stored_truth["valid_time"].to_list()
    # Every pair row is one forecast row, so the two stations' rows are all there: nothing lost, nothing added.
    assert forecasts.height == pairs.filter(pl.col("station").is_in(["OMAA", "OMDB"])).height
    assert stored_truth.height == observations_of(pairs).filter(pl.col("station").is_in(["OMAA", "OMDB"])).height


def test_the_snapshot_never_contains_corrected_output_or_scores(tmp_path: Path) -> None:
    built = build_fixture_snapshot(tmp_path)

    forecasts = pl.read_parquet(built.directory / "forecasts.parquet")
    truth = pl.read_parquet(built.directory / "observations.parquet")

    assert set(forecasts.columns) == set(FORECAST_SCHEMA)  # no corrected_*, no quantiles, no scores
    assert set(truth.columns) == set(OBS_HOURLY_SCHEMA)
    manifest_text = (built.directory / "snapshot.json").read_text(encoding="utf-8")
    for word in ("corrected", "quantile", "crps", "score"):
        assert word not in manifest_text.lower()


# --- bytes ----------------------------------------------------------------------------------------------------------


def test_snapshot_json_is_lf_terminated_utf8_so_the_hashes_match_a_linux_checkout(tmp_path: Path) -> None:
    built = build_fixture_snapshot(tmp_path)

    text = (built.directory / "snapshot.json").read_bytes()

    assert b"\r\n" not in text
    assert b"\r" not in text
    assert text.endswith(b"}\n")
    json.loads(text)  # and it is JSON


def test_the_same_inputs_give_the_same_bytes_and_hashes(tmp_path: Path) -> None:
    """Fixed parquet settings and a fixed creation time: two builds of one input are byte-identical."""
    store = seed_silver(tmp_path)

    first = build_fixture_snapshot(tmp_path, store=store, replay_dir=tmp_path / "one")
    second = build_fixture_snapshot(tmp_path, store=store, replay_dir=tmp_path / "two")

    for name in ("forecasts.parquet", "observations.parquet", "snapshot.json"):
        assert (first.directory / name).read_bytes() == (second.directory / name).read_bytes(), name


# --- refusals -------------------------------------------------------------------------------------------------------


def test_an_existing_snapshot_directory_is_refused_and_left_untouched(tmp_path: Path) -> None:
    first = build_fixture_snapshot(tmp_path)
    before = {path.name: path.read_bytes() for path in first.directory.iterdir()}

    with pytest.raises(ReplayBuildError, match=rf"{SNAPSHOT_ID}.*already exists"):
        build_fixture_snapshot(tmp_path, store=ParquetStore(tmp_path))

    assert {path.name: path.read_bytes() for path in first.directory.iterdir()} == before


def test_an_existing_empty_directory_is_refused_too(tmp_path: Path) -> None:
    (tmp_path / "replay" / SNAPSHOT_ID).mkdir(parents=True)

    with pytest.raises(ReplayBuildError, match="already exists"):
        build_fixture_snapshot(tmp_path)


def test_snapshot_size_budget(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A snapshot over the budget is refused, and nothing, not even a staging directory, is left behind."""
    built = build_fixture_snapshot(tmp_path, replay_dir=tmp_path / "measure")
    assert replay_build.MAX_SNAPSHOT_BYTES == 10 * 1024 * 1024  # the real budget, and the fixture is far below it
    assert built.size_bytes < replay_build.MAX_SNAPSHOT_BYTES

    monkeypatch.setattr(replay_build, "MAX_SNAPSHOT_BYTES", built.size_bytes - 1)  # one byte too many
    with pytest.raises(ReplayBuildError, match=r"over the budget of \d+ bytes"):
        build_fixture_snapshot(tmp_path, store=ParquetStore(tmp_path), replay_dir=tmp_path / "refused")
    assert not (tmp_path / "refused").exists() or not any((tmp_path / "refused").iterdir())

    monkeypatch.setattr(replay_build, "MAX_SNAPSHOT_BYTES", built.size_bytes)  # exactly at the budget is allowed
    build_fixture_snapshot(tmp_path, store=ParquetStore(tmp_path), replay_dir=tmp_path / "exact")


@pytest.mark.parametrize(
    "snapshot_id",
    ["", "../escape", "a/b", "a\\b", "Has Upper", "with space", ".hidden", "a--b", "-lead", "trail-", "x" * 65, "ü"],
)
def test_an_unsafe_snapshot_id_is_refused_before_anything_is_written(tmp_path: Path, snapshot_id: str) -> None:
    store = seed_silver(tmp_path)

    with pytest.raises(ReplayBuildError, match="snapshot id"):
        build_replay_snapshot(
            store=store,
            replay_dir=tmp_path / "replay",
            summer=SUMMER,
            stations=list(FIXTURE_STATIONS),
            snapshot_id=snapshot_id,
            git_sha=GIT_SHA,
        )

    assert not (tmp_path / "replay").exists()
    assert not (tmp_path / "escape").exists()


@pytest.mark.parametrize("snapshot_id", ["2025-dev", "dev_2025_v2", "a", "s2025", "x" * 64])
def test_a_slug_snapshot_id_is_accepted(tmp_path: Path, snapshot_id: str) -> None:
    store = seed_silver(tmp_path)

    built = build_replay_snapshot(
        store=store,
        replay_dir=tmp_path / "replay",
        summer=SUMMER,
        stations=list(FIXTURE_STATIONS),
        snapshot_id=snapshot_id,
        git_sha=GIT_SHA,
    )

    assert built.directory.name == snapshot_id


def test_a_station_without_silver_data_is_refused_and_nothing_is_written(tmp_path: Path) -> None:
    store = seed_silver(tmp_path)

    with pytest.raises(ReplayBuildError, match=r"OMAL.*ecmwf_ifs025"):
        build_replay_snapshot(
            store=store,
            replay_dir=tmp_path / "replay",
            summer=SUMMER,
            stations=[*FIXTURE_STATIONS, station("OMAL")],
            snapshot_id=SNAPSHOT_ID,
            git_sha=GIT_SHA,
        )

    assert not (tmp_path / "replay").exists()


def test_a_station_with_forecasts_but_no_observations_is_refused(tmp_path: Path) -> None:
    store = seed_silver(tmp_path)
    store.write_observations("iem", SUMMER, "OMDB", pl.DataFrame(schema=OBS_HOURLY_SCHEMA))

    with pytest.raises(ReplayBuildError, match=r"no observations.*OMDB"):
        build_fixture_snapshot(tmp_path, store=store)

    assert not (tmp_path / "replay").exists()


def test_a_summer_the_archive_does_not_cover_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ReplayBuildError, match="2019"):
        build_replay_snapshot(
            store=seed_silver(tmp_path),
            replay_dir=tmp_path / "replay",
            summer=2019,
            stations=list(FIXTURE_STATIONS),
            snapshot_id=SNAPSHOT_ID,
            git_sha=GIT_SHA,
        )


def test_no_stations_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ReplayBuildError, match="at least one station"):
        build_replay_snapshot(
            store=seed_silver(tmp_path),
            replay_dir=tmp_path / "replay",
            summer=SUMMER,
            stations=[],
            snapshot_id=SNAPSHOT_ID,
            git_sha=GIT_SHA,
        )


# --- the git helper -------------------------------------------------------------------------------------------------


class FakeRun:
    """A stand-in for ``subprocess.run`` that records its call."""

    def __init__(self, stdout: bytes = f"{GIT_SHA}\n".encode(), returncode: int = 0, stderr: bytes = b"") -> None:
        self.result = subprocess.CompletedProcess(args=[], returncode=returncode, stdout=stdout, stderr=stderr)
        self.calls: list[tuple[list[str], dict[str, object]]] = []

    def __call__(self, args: list[str], **kwargs: object) -> "subprocess.CompletedProcess[bytes]":
        self.calls.append((args, kwargs))
        return self.result


def test_git_head_runs_the_resolved_executable_without_a_shell_in_the_repo_root(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    run = FakeRun()
    monkeypatch.setattr("stellar_blaze.jobs.replay_build.shutil.which", lambda name: f"/resolved/{name}")
    monkeypatch.setattr("stellar_blaze.jobs.replay_build.subprocess.run", run)

    assert git_head(tmp_path) == GIT_SHA

    ((args, kwargs),) = run.calls
    assert args == ["/resolved/git", "rev-parse", "HEAD"]
    assert kwargs["cwd"] == tmp_path
    assert not kwargs.get("shell")


def test_git_head_fails_clearly_when_git_is_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("stellar_blaze.jobs.replay_build.shutil.which", lambda name: None)

    with pytest.raises(ReplayBuildError, match="git executable was not found"):
        git_head(tmp_path)


@pytest.mark.parametrize(
    ("stdout", "returncode", "stderr"),
    [(b"", 128, b"fatal: not a git repository"), (b"HEAD\n", 0, b""), (b"", 0, b"")],
    ids=["git-failed", "not-a-sha", "empty"],
)
def test_git_head_fails_clearly_on_a_bad_answer(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, stdout: bytes, returncode: int, stderr: bytes
) -> None:
    monkeypatch.setattr("stellar_blaze.jobs.replay_build.shutil.which", lambda name: "/resolved/git")
    monkeypatch.setattr("stellar_blaze.jobs.replay_build.subprocess.run", FakeRun(stdout, returncode, stderr))

    with pytest.raises(ReplayBuildError, match="git rev-parse HEAD"):
        git_head(tmp_path)


# --- the command ----------------------------------------------------------------------------------------------------


@pytest.fixture
def cli_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """An environment for ``sb-jobs``: data and replay directories under ``tmp_path``, seeded with synthetic silver."""
    monkeypatch.chdir(tmp_path)  # a developer's backend/.env must not reach the test
    monkeypatch.setenv("SB_DATABASE_URL", DATABASE_URL)
    monkeypatch.setenv("SB_ENV", "test")
    monkeypatch.setenv("SB_LOG_FORMAT", "json")
    monkeypatch.setenv("SB_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("SB_REPLAY_DIR", str(tmp_path / "replay"))
    seed_silver(tmp_path / "data")
    return tmp_path


@pytest.fixture
def stub_git(monkeypatch: pytest.MonkeyPatch) -> None:
    """``git rev-parse HEAD`` answers a fixed commit (the test run never runs git)."""
    monkeypatch.setattr(replay_build, "git_head", lambda repo_root: GIT_SHA)


def test_help_lists_the_replay_group_and_sb_jobs_help_still_works() -> None:
    top = CliRunner().invoke(app, ["--help"])
    group = CliRunner().invoke(app, ["replay", "--help"])
    build = CliRunner().invoke(app, ["replay", "build", "--help"])

    assert top.exit_code == group.exit_code == build.exit_code == 0
    assert "replay" in top.output
    assert "build" in group.output
    for option in ("--summer", "--station", "--snapshot-id"):
        assert option in build.output


@pytest.mark.usefixtures("stub_git")
def test_replay_build_command_builds_the_snapshot_and_reports_it(cli_env: Path) -> None:
    result = CliRunner().invoke(
        app,
        [
            "replay",
            "build",
            "--summer",
            str(SUMMER),
            "--station",
            "OMAA",
            "--station",
            "OMDB",
            "--snapshot-id",
            "cli-2025",
        ],
    )

    assert result.exit_code == 0, result.output
    report = json.loads(result.stdout)
    assert report["snapshot_id"] == "cli-2025"
    assert report["directory"] == str(cli_env / "replay" / "cli-2025")
    assert report["size_bytes"] > 0
    assert (cli_env / "replay" / "cli-2025" / "snapshot.json").is_file()
    manifest = ReplaySnapshot.model_validate_json((cli_env / "replay" / "cli-2025" / "snapshot.json").read_bytes())
    assert manifest.provenance.git_sha == GIT_SHA


@pytest.mark.usefixtures("stub_git")
def test_replay_build_command_refuses_an_existing_snapshot_with_exit_1(cli_env: Path) -> None:
    arguments = ["replay", "build", "--summer", str(SUMMER), "--station", "OMAA", "--station", "OMDB"]
    assert CliRunner().invoke(app, [*arguments, "--snapshot-id", "again"]).exit_code == 0

    result = CliRunner().invoke(app, [*arguments, "--snapshot-id", "again"])

    assert result.exit_code == 1
    assert "already exists" in result.output


@pytest.mark.usefixtures("stub_git")
def test_replay_build_command_refuses_an_unsafe_id_with_exit_1_and_writes_nothing(cli_env: Path) -> None:
    result = CliRunner().invoke(
        app, ["replay", "build", "--summer", str(SUMMER), "--station", "OMAA", "--snapshot-id", "../escape"]
    )

    assert result.exit_code == 1
    assert "snapshot id" in result.output
    assert not (cli_env / "replay").exists()


def test_replay_build_command_fails_clearly_without_git(cli_env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("stellar_blaze.jobs.replay_build.shutil.which", lambda name: None)

    result = CliRunner().invoke(
        app, ["replay", "build", "--summer", str(SUMMER), "--station", "OMAA", "--snapshot-id", "no-git"]
    )

    assert result.exit_code == 1
    assert "git executable was not found" in result.output
    assert not (cli_env / "replay").exists()


def test_replay_build_command_needs_a_station_and_a_snapshot_id(cli_env: Path) -> None:
    no_station = CliRunner().invoke(app, ["replay", "build", "--summer", str(SUMMER), "--snapshot-id", "x"])
    no_id = CliRunner().invoke(app, ["replay", "build", "--summer", str(SUMMER), "--station", "OMAA"])

    assert no_station.exit_code == 2
    assert "--station" in no_station.output
    assert no_id.exit_code == 2
    assert "--snapshot-id" in no_id.output


def test_replay_build_command_rejects_an_unknown_station_as_usage(cli_env: Path) -> None:
    result = CliRunner().invoke(
        app, ["replay", "build", "--summer", str(SUMMER), "--station", "KJFK", "--snapshot-id", "x"]
    )

    assert result.exit_code == 2
    assert "KJFK" in result.output


def test_sb_jobs_help_runs_without_the_training_packages_or_the_ml_package() -> None:
    """The API image has no train group: importing ``jobs.cli`` and asking for help must not import any of it."""
    program = textwrap.dedent(
        """
        import importlib.abc, sys

        class Block(importlib.abc.MetaPathFinder):
            def find_spec(self, name, path, target=None):
                if name.split(".")[0] in {"mapie", "sklearn", "scoringrules", "lightgbm"} or name.startswith(
                    "stellar_blaze.ml"
                ):
                    raise ImportError("blocked: " + name)

        sys.meta_path.insert(0, Block())
        from typer.testing import CliRunner
        from stellar_blaze.jobs.cli import app

        for arguments in (["--help"], ["replay", "--help"], ["replay", "build", "--help"]):
            result = CliRunner().invoke(app, arguments)
            assert result.exit_code == 0, (arguments, result.output)
        assert not [name for name in sys.modules if name.startswith("stellar_blaze.ml")]
        """
    )

    result = subprocess.run([sys.executable, "-c", program], check=False, capture_output=True, text=True)  # noqa: S603

    assert result.returncode == 0, result.stderr
