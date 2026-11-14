"""The machine-learning and evaluation commands of ``sb-jobs``, mounted on its root app by ``jobs.cli``.

Commands that need no database and no advisory lock, like the ``config`` commands::

    sb-jobs replay build --summer YEAR --station ICAO [--station ICAO ...] --snapshot-id ID

``replay build`` copies the silver forecasts (IFS and GFS, leads 0 to 7) and IEM observations of the stations for the
summer from ``SB_DATA_DIR`` into ``<SB_REPLAY_DIR>/<ID>/`` with a hashed ``snapshot.json``. It writes inputs only (never
corrected output or scores), refuses an existing snapshot, an id that is not a lowercase slug, and a snapshot above
10 MB. The demo snapshot's agreed stations are OMAA, OMDB, OMAL and OMFJ (four clusters; OMAA is the scoreboard site).
The 2026 summer is locked (``HELD_OUT_SUMMERS``) until the architect's go-ahead. Exit codes: 0 built, 1 refused or
failed, 2 bad usage or configuration, or a held-out summer. Like every ``sb-jobs`` command it reads
the ``SB_*`` environment, which includes ``SB_DATABASE_URL``, though this command never connects to it.

The gated 2026 evaluation, behind the pre-registration gate (``jobs/evaluate_2026.py``)::

    sb-jobs evaluate-2026 --part forecast|warnings|plans|all [--amendment ID]

Development evaluation and selection, a job with a ``job_run`` row and an advisory lock per config name::

    sb-jobs evaluate-dev --config PATH [--grid] [--calibration-targets wbgt|all] [--allow-dirty] [--out DIR]

Training, a job with a ``job_run`` row and an advisory lock per config name::

    sb-jobs train --config PATH [--release --dev-skill PATH] [--dev-skill PATH]

``train`` fits the corrector on the 2024-2025 development rows only (``load_dev_pairs``) and writes the model directory
to ``$SB_DATA_DIR/models-eval/``, or, with ``--release``, to ``SB_MODELS_DIR``. A release REQUIRES ``--dev-skill`` and
is bound to the evaluation that selected the model (exit 2, nothing written, on any mismatch): the config's fields
(all but ``name``) must equal the ``configuration`` of ``dev_skill.json`` (and the ``chosen_configuration`` of the
``selection.json`` beside it), and the ``data_sha256`` of its provenance must be the gold manifest's output hash. The
chain from a model id to its evidence is model id -> ``training_config_sha256`` (the TOML) -> that TOML's fields =
``selection.json`` ``chosen_configuration`` (in grid mode its ``config_fingerprint`` is a hash of the derived
configuration, which has no file of its own). A release also refuses a dirty working tree and a corrector whose
corrected median equals the raw forecast on every sampled row of t, td or wind, and exits 1 when the run was skipped
because another one holds the lock (nothing was released).

The API image has no training dependencies and ``sb-jobs --help`` must work there, so this module imports only typer,
the standard library and ``stellar_blaze.config`` at module level. Every command imports what it needs
(``stellar_blaze.ml`` included) inside its body, and a test pins that ``sb-jobs --help`` runs with the training
packages blocked.
"""

import asyncio
import json
import shlex
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, NoReturn

import typer
from pydantic import JsonValue

from stellar_blaze.config import Settings

if TYPE_CHECKING:
    from stellar_blaze.ml.git import GitReader
    from stellar_blaze.ml.protocol_gate import Part
    from stellar_blaze.ml.training_config import TrainingConfig

ml_app = typer.Typer(
    no_args_is_help=True,
    add_completion=False,
    pretty_exceptions_show_locals=False,
    help="Replay snapshots, training and evaluation of the forecast corrector.",
)
replay_app = typer.Typer(
    no_args_is_help=True,
    add_completion=False,
    pretty_exceptions_show_locals=False,
    help="Replay snapshots: frozen, hashed copies of a summer's forecasts and observations.",
)
ml_app.add_typer(replay_app, name="replay")


def _settings() -> Settings:
    """The settings from the environment, with logging configured.

    An invalid or incomplete configuration ends the command with exit code 2 and says which variables are wrong (never
    their values).
    """
    from pydantic import ValidationError

    from stellar_blaze.logging import configure_logging

    try:
        settings = Settings()
    except ValidationError as exc:
        problems = "; ".join(
            f"{'.'.join(str(part) for part in error['loc']) or 'settings'}: {error['msg']}"
            for error in exc.errors(include_input=False, include_url=False, include_context=False)
        )
        typer.echo(f"invalid configuration (SB_* environment): {problems}", err=True)
        raise typer.Exit(2) from None
    configure_logging(settings)
    return settings


def _fail(message: str) -> NoReturn:
    typer.echo(message, err=True)
    raise typer.Exit(1)


@replay_app.command("build")
def replay_build_command(
    summer: Annotated[int, typer.Option("--summer", help="Summer year to copy (15 May to 30 Sep).")],
    station: Annotated[
        list[str], typer.Option("--station", help="ICAO station to copy. Repeat for several; at least one.")
    ],
    snapshot_id: Annotated[
        str,
        typer.Option("--snapshot-id", help="Directory name under SB_REPLAY_DIR: a lowercase slug, 64 chars at most."),
    ],
) -> None:
    """Copy a summer's silver forecasts and observations into a hashed snapshot under SB_REPLAY_DIR (at most 10 MB).

    The demo snapshot's agreed stations are OMAA, OMDB, OMAL and OMFJ (four clusters; OMAA is the scoreboard site),
    which fit the budget. The 2026 summer is locked until the architect's go-ahead (exit code 2).
    """
    from stellar_blaze.adapters.storage.parquet_store import ParquetStore
    from stellar_blaze.domain.weather.schemas import SchemaMismatchError
    from stellar_blaze.domain.weather.stations import station as station_by_icao
    from stellar_blaze.jobs.replay_build import (
        ReplayBuildError,
        ReplayHoldoutError,
        build_replay_snapshot,
        git_head,
        refuse_held_out,
        repo_root,
    )

    try:
        refuse_held_out(summer)  # first of all: before the settings, git or any file is touched
    except ReplayHoldoutError as exc:
        typer.echo(f"replay build refused: {exc}", err=True)
        raise typer.Exit(2) from None
    settings = _settings()
    try:
        stations = [station_by_icao(icao) for icao in dict.fromkeys(station)]
    except KeyError as exc:
        raise typer.BadParameter(str(exc.args[0]), param_hint="--station") from None
    try:
        built = build_replay_snapshot(
            store=ParquetStore(settings.data_dir),
            replay_dir=settings.replay_dir,
            summer=summer,
            stations=stations,
            snapshot_id=snapshot_id,
            git_sha=git_head(repo_root()),
        )
    except ReplayHoldoutError as exc:
        typer.echo(f"replay build refused: {exc}", err=True)
        raise typer.Exit(2) from None
    except (ReplayBuildError, SchemaMismatchError, OSError) as exc:
        _fail(f"replay build refused: {exc}")
    typer.echo(
        json.dumps(
            {
                "snapshot_id": built.snapshot.snapshot_id,
                "directory": str(built.directory),
                "size_bytes": built.size_bytes,
                "stations": built.snapshot.stations,
                "models": built.snapshot.models,
                "files": {file.path: file.sha256 for file in built.snapshot.files},
            }
        )
    )


class CalibrationTargets(StrEnum):
    """``--calibration-targets`` of ``evaluate-dev``: which variables' top-tercile coverage can switch rule 6.4."""

    WBGT = "wbgt"
    ALL = "all"


def repo_relative(path: Path, root: Path) -> str:
    """``path`` relative to the repository ``root`` (POSIX), or just its file name when it is outside the repository.

    A recorded command must reproduce on another machine, so it never holds an absolute local path.
    """
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.name


def evaluate_dev_invocation(
    config: Path,
    *,
    grid: bool,
    out_dir: Path | None,
    root: Path,
    calibration_targets: CalibrationTargets = CalibrationTargets.ALL,
    allow_dirty: bool = False,
) -> str:
    """The ``sb-jobs evaluate-dev`` invocation that was run, from its real arguments (shell-quoted, POSIX paths).

    Paths are relative to the repository ``root`` (``repo_relative``). ``--calibration-targets`` is always spelled out,
    so the recorded command does not depend on the default of the day.
    """
    words = ["sb-jobs", "evaluate-dev", "--config", repo_relative(config, root)]
    if grid:
        words.append("--grid")
    words += ["--calibration-targets", calibration_targets.value]
    if allow_dirty:
        words.append("--allow-dirty")
    if out_dir is not None:
        words += ["--out", repo_relative(out_dir, root)]
    return shlex.join(words)


def _evaluate_dev(
    settings: Settings,
    config: Path,
    *,
    grid: bool,
    out_dir: Path | None,
    calibration_targets: CalibrationTargets,
    git_clean: bool,
    allow_dirty: bool,
) -> dict[str, JsonValue]:
    """The body of ``sb-jobs evaluate-dev``: load the dev pairs, run the selection, write the exports (blocking).

    Fails before any model is fitted if the manifest, the git commit or the pairs file cannot be had, and the export is
    built once from the first LOCO output (the preflight): a run of tens of minutes must not end at its last step.
    """
    from stellar_blaze.domain.weather.dataset import GoldManifest
    from stellar_blaze.jobs.replay_build import git_head, repo_root
    from stellar_blaze.ml.data import load_dev_pairs
    from stellar_blaze.ml.exporters import preflight_dev_exports, write_dev_exports
    from stellar_blaze.ml.selection import run_dev_selection
    from stellar_blaze.ml.training_config import load_training_config

    cfg, cfg_sha256 = load_training_config(config)
    root = repo_root()
    target = root / "artifacts" / "eval" / "dev" if out_dir is None else out_dir
    gold = settings.data_dir / "gold"
    manifest = GoldManifest.model_validate_json((gold / "manifest.json").read_bytes())
    data_sha256 = manifest.output.sha256
    git_sha = git_head(root)
    pairs = load_dev_pairs(gold / "pairs.parquet", expected_sha256=data_sha256)  # 2024-2025 only; 2026 never loads
    selection = run_dev_selection(
        pairs,
        cfg,
        cfg_sha256,
        grid=grid,
        calibration_targets=calibration_targets.value,
        preflight=lambda oof, used: preflight_dev_exports(oof, pairs, used),
    )
    hashes = write_dev_exports(
        selection.oof,
        selection.decisions,
        target,
        pairs=pairs,
        cfg=selection.cfg,
        cfg_sha256=selection.cfg_sha256,
        git_sha=git_sha,
        git_clean=git_clean,
        data_sha256=data_sha256,
        command=evaluate_dev_invocation(
            config,
            grid=grid,
            out_dir=out_dir,
            root=root,
            calibration_targets=calibration_targets,
            allow_dirty=allow_dirty,
        ),
        mode=selection.mode,
        calibration_targets=selection.calibration_targets,
        allow_dirty=allow_dirty,
        grid_scores=selection.grid_scores,
        tables=selection.tables,
        summer_split=selection.summer_split,
        counts=selection.counts,
    )
    return {
        "mode": selection.mode,
        "decisions": [json.loads(decision.model_dump_json()) for decision in selection.decisions],
        "exports": dict(hashes),
        "directory": str(target),
        "counts": dict(selection.counts),
    }


@ml_app.command("evaluate-dev")
def evaluate_dev_command(
    config: Annotated[
        Path, typer.Option("--config", help="Training config TOML (backend/training/configs/); the starting point.")
    ],
    grid: Annotated[
        bool,
        typer.Option(
            "--grid",
            help="Run the pre-registered selection rules 6.1-6.4 (several full out-of-fold runs, about 2 hours) "
            "instead of the single config.",
        ),
    ] = False,
    calibration_targets: Annotated[
        CalibrationTargets,
        typer.Option(
            "--calibration-targets",
            help="Which variables rule 6.4 looks at: all (T, Td, wind and WBGT; the committed reading) or wbgt (only "
            "the WBGT interval). The window switches if any deciding variable is below 0.85 in the top forecast-WBGT "
            "tercile for any lead 1-3.",
        ),
    ] = CalibrationTargets.ALL,
    allow_dirty: Annotated[
        bool,
        typer.Option(
            "--allow-dirty",
            help="Run --grid from a dirty working tree (tests and development only; recorded as allow_dirty in "
            "selection.json). Without it a dirty --grid run is refused.",
        ),
    ] = False,
    out: Annotated[
        Path | None, typer.Option("--out", help="Export directory (default: artifacts/eval/dev/ at the repo root).")
    ] = None,
) -> None:
    """Evaluate the corrector on 2024-2025 leave-one-cluster-out and write the dev exports (never reads 2026).

    Without ``--grid`` only the given config runs; with it the hyperparameters, feature set, WBGT method and
    calibration window are chosen by the pre-registered rules (section 6) and the chosen configuration's out-of-fold
    predictions are exported. Writes ``selection.json``, ``dev_skill.json``, ``oof_samples_abu_dhabi.parquet`` and its
    ``oof_samples_abu_dhabi.manifest.json`` (which records this command with repository-relative paths) and prints the
    decisions as JSON. ``git_clean`` (was the tree clean at the recorded commit) is written to ``selection.json`` and
    the sample manifest; a dirty ``--grid`` run is refused (exit 2, nothing written, no job) unless ``--allow-dirty``.
    Runs as the ``evaluate-dev`` job (a ``job_run`` row, one advisory lock per config name). Exit codes: 0 done or
    skipped (locked), 1 failed, 2 bad usage or configuration or a refused dirty ``--grid`` run.
    """
    import tomllib

    from pydantic import ValidationError

    from stellar_blaze.jobs.replay_build import repo_root
    from stellar_blaze.jobs.runner import run_job
    from stellar_blaze.ml.git import GitError
    from stellar_blaze.ml.training_config import load_training_config

    settings = _settings()
    try:
        cfg, cfg_sha256 = load_training_config(config)
    except (OSError, tomllib.TOMLDecodeError, ValidationError) as exc:
        raise typer.BadParameter(f"{config}: {exc}", param_hint="--config") from None
    try:
        git_clean = _git_reader(repo_root()).is_clean()
    except GitError as exc:
        _fail(f"evaluate-dev refused: cannot read the git state: {exc}")
    if grid and not git_clean and not allow_dirty:
        typer.echo(
            "evaluate-dev --grid refused: the working tree is not clean (modified, staged or untracked files), so the "
            "recorded git_sha would not name the code that ran; commit or remove them (--allow-dirty is for tests and "
            "development only). Nothing was run.",
            err=True,
        )
        raise typer.Exit(2)
    outcome: list[dict[str, JsonValue]] = []

    async def work() -> Mapping[str, JsonValue]:
        summary = await asyncio.to_thread(
            _evaluate_dev,
            settings,
            config,
            grid=grid,
            out_dir=out,
            calibration_targets=calibration_targets,
            git_clean=git_clean,
            allow_dirty=allow_dirty,
        )
        outcome.append(summary)
        return summary

    params: dict[str, JsonValue] = {
        "config": str(config),
        "config_name": cfg.name,
        "config_sha256": cfg_sha256,
        "grid": grid,
        "calibration_targets": calibration_targets.value,
        "git_clean": git_clean,
        "allow_dirty": allow_dirty,
    }
    code = asyncio.run(run_job(settings, "evaluate-dev", params, work, lock_key=f"evaluate-dev:{cfg.name}"))
    if outcome:
        typer.echo(json.dumps(outcome[0], sort_keys=True))
    raise typer.Exit(code)


def _git_reader(root: Path) -> "GitReader":
    """The git queries of a release (a module attribute, so a test can replace it with a fake)."""
    from stellar_blaze.ml.git import SubprocessGit

    return SubprocessGit(root)


def _train(
    settings: Settings,
    config: Path,
    *,
    release: bool,
    dev_metrics: Mapping[str, Mapping[str, float]] | None,
    selection: Mapping[str, object] | None,
) -> dict[str, JsonValue]:
    """The body of ``sb-jobs train``: load the dev pairs, train, (release: smoke-check), write the model (blocking).

    Everything that can fail cheaply (the manifest, the commit, the lock file, the pairs hash) fails before the fit.
    """
    import hashlib
    from datetime import UTC, datetime

    from stellar_blaze.domain.weather.dataset import GoldManifest
    from stellar_blaze.jobs.replay_build import git_head, repo_root
    from stellar_blaze.ml.artefacts import write_model
    from stellar_blaze.ml.data import load_dev_pairs
    from stellar_blaze.ml.release_check import release_smoke_check
    from stellar_blaze.ml.train import train_corrector
    from stellar_blaze.ml.training_config import load_training_config

    cfg, cfg_sha256 = load_training_config(config)
    root = repo_root()
    backend = root / "backend"
    uv_lock = backend / "uv.lock"
    if not uv_lock.is_file():
        raise FileNotFoundError(f"{uv_lock} not found: a model records the SHA-256 of the dependency lock")
    gold = settings.data_dir / "gold"
    manifest_bytes = (gold / "manifest.json").read_bytes()
    manifest = GoldManifest.model_validate_json(manifest_bytes)
    gold_manifest_sha256 = hashlib.sha256(manifest_bytes.replace(b"\r\n", b"\n")).hexdigest()
    git_sha = git_head(root)
    try:
        cfg_path = config.resolve().relative_to(backend.resolve()).as_posix()
    except ValueError:
        cfg_path = config.as_posix()
    pairs = load_dev_pairs(gold / "pairs.parquet", expected_sha256=manifest.output.sha256)  # 2026 never loads
    trained = train_corrector(pairs, cfg, cfg_sha256=cfg_sha256)
    smoke: dict[str, JsonValue] = {}
    if release:
        smoke = dict(release_smoke_check(trained, pairs))
    metrics: Mapping[str, Mapping[str, float]] = (
        {"training": {"fit_rows": float(trained.train_rows), "calibration_rows": float(trained.cal_rows)}}
        if dev_metrics is None
        else dev_metrics
    )
    models_dir = settings.models_dir if release else settings.data_dir / "models-eval"
    directory = write_model(
        trained,
        models_dir=models_dir,
        created_at=datetime.now(UTC),
        git_sha=git_sha,
        uv_lock=uv_lock,
        gold_manifest_sha256=gold_manifest_sha256,
        cfg_path=cfg_path,
        dev_metrics=metrics,
        selection=selection,
    )
    return {
        "model_id": directory.name,
        "directory": str(directory),
        "release": release,
        "git_sha": git_sha,
        "config_sha256": cfg_sha256,
        "fit_rows": trained.train_rows,
        "calibration_rows": trained.cal_rows,
        "metrics": {regime: dict(values) for regime, values in metrics.items()},
        "smoke_mean_abs_shift": smoke,
    }


@dataclass(frozen=True)
class _DevSkillInputs:
    """What ``train`` reads from the evaluation that selected the model.

    Attributes:
        metrics: The headline LOCO CRPS of ``dev_skill.json`` (what the model manifest carries).
        selection: The ``selection.json`` beside it, or ``None`` (what the model card carries).
        configuration: The ``configuration`` of ``dev_skill.json`` (the final config's JSON), or ``None``.
        data_sha256: The ``provenance.data_sha256`` of ``dev_skill.json`` (the gold file it was computed from).
    """

    metrics: dict[str, dict[str, float]]
    selection: dict[str, object] | None
    configuration: Mapping[str, object] | None
    data_sha256: str | None


def _dev_skill_inputs(path: Path) -> _DevSkillInputs:
    """The headline metrics, configuration and data hash of ``dev_skill.json`` and the ``selection.json`` beside it.

    Raises:
        typer.BadParameter: The file is unreadable, not JSON, or has no skill table in the expected shape.
    """
    from stellar_blaze.ml.release_check import loco_headline_metrics

    try:
        skill = json.loads(path.read_bytes())
        beside = path.parent / "selection.json"
        selection = json.loads(beside.read_bytes()) if beside.is_file() else None
        if not isinstance(skill, dict) or (selection is not None and not isinstance(selection, dict)):
            raise ValueError("dev_skill.json and the selection.json beside it must be JSON objects")
        metrics = loco_headline_metrics(skill)
    except (OSError, ValueError) as exc:  # json.JSONDecodeError is a ValueError
        raise typer.BadParameter(f"{path}: {exc}", param_hint="--dev-skill") from None
    configuration = skill.get("configuration")
    provenance = skill.get("provenance")
    data_sha256 = provenance.get("data_sha256") if isinstance(provenance, dict) else None
    return _DevSkillInputs(
        metrics=metrics,
        selection=selection,
        configuration=configuration if isinstance(configuration, dict) else None,
        data_sha256=data_sha256 if isinstance(data_sha256, str) else None,
    )


def _release_binding_problems(
    config_fields: Mapping[str, object], evaluated: _DevSkillInputs, gold_data_sha256: str
) -> list[str]:
    """What ties a release to the evaluation that selected the model, as a list of mismatches (empty: bound).

    Compares every field of the loaded config but ``name`` with ``dev_skill.json``'s ``configuration`` (feature set,
    WBGT method, calibration window, leads, hours, sampling and every ``lgbm`` value) and, when a ``selection.json``
    sits beside it, with its ``chosen_configuration``; and the gold manifest's output hash with the evaluation's
    ``provenance.data_sha256``. The name is ignored: a derived configuration is named ``<base>-selected`` and the
    release TOML has its own.

    Args:
        config_fields: The loaded config as JSON-native values (``json.loads(cfg.model_dump_json())``).
        evaluated: What ``_dev_skill_inputs`` read.
        gold_data_sha256: ``GoldManifest.output.sha256`` of the gold file the model would be trained on.
    """
    problems: list[str] = []
    wanted = {key: value for key, value in config_fields.items() if key != "name"}

    def compare(what: str, recorded: Mapping[str, object] | None, keys: Sequence[str]) -> None:
        if recorded is None:
            problems.append(f"{what} is missing")
            return
        for key in keys:
            if key not in recorded:
                problems.append(f"{what} has no {key!r}")
            elif recorded[key] != wanted[key]:
                problems.append(f"{key}: the config has {wanted[key]!r} but {what} has {recorded[key]!r}")

    compare("dev_skill.json 'configuration'", evaluated.configuration, list(wanted))
    if evaluated.selection is not None:
        chosen = evaluated.selection.get("chosen_configuration")
        compare(
            "selection.json 'chosen_configuration'",
            chosen if isinstance(chosen, dict) else None,
            ["feature_set", "wbgt_method", "calibration_window", "lgbm"],
        )
    if evaluated.data_sha256 != gold_data_sha256:
        problems.append(
            f"data_sha256: the gold manifest has {gold_data_sha256} but dev_skill.json's provenance has "
            f"{evaluated.data_sha256}"
        )
    return problems


def _refuse_unbound_release(settings: Settings, cfg: "TrainingConfig", evaluated: _DevSkillInputs) -> None:
    """Exit 2 (nothing written) unless the release is bound to the evaluation (``_release_binding_problems``)."""
    from pydantic import ValidationError

    from stellar_blaze.domain.weather.dataset import GoldManifest

    manifest_path = settings.data_dir / "gold" / "manifest.json"
    try:
        gold_sha256 = GoldManifest.model_validate_json(manifest_path.read_bytes()).output.sha256
    except (OSError, ValidationError) as exc:
        _fail(f"train --release refused: cannot read the gold manifest {manifest_path}: {exc}")
    problems = _release_binding_problems(json.loads(cfg.model_dump_json()), evaluated, gold_sha256)
    if problems:
        typer.echo(
            "train --release refused: the model is not the one the evaluation selected (nothing was written):\n  "
            + "\n  ".join(problems),
            err=True,
        )
        raise typer.Exit(2)


@ml_app.command("train")
def train_command(
    config: Annotated[Path, typer.Option("--config", help="Training config TOML (backend/training/configs/).")],
    release: Annotated[
        bool,
        typer.Option(
            "--release",
            help="Write to SB_MODELS_DIR (the image's models) instead of $SB_DATA_DIR/models-eval/. Needs "
            "--dev-skill and refuses (exit 2) a config or gold file that is not the one the evaluation used; refuses "
            "a dirty working tree and a corrector that does not change the raw forecast.",
        ),
    ] = False,
    dev_skill: Annotated[
        Path | None,
        typer.Option(
            "--dev-skill",
            help="dev_skill.json of `evaluate-dev`: its LOCO CRPS (leads 1-3, working daytime) goes in the manifest; "
            "the selection.json beside it goes in the model card. Required with --release, which compares the config "
            "and the gold hash with it.",
        ),
    ] = None,
) -> None:
    """Train the corrector on 2024-2025 and write a model directory (never reads 2026).

    Runs as the job ``train:<config name>`` (a ``job_run`` row, one advisory lock per config name). Without
    ``--release`` the model goes to ``$SB_DATA_DIR/models-eval/``; with it, to ``SB_MODELS_DIR``, and only from a clean
    working tree (exit 1, nothing written, otherwise) and after the release smoke check. A release needs
    ``--dev-skill`` and exits 2 (nothing written) when the loaded config's fields (all but ``name``) differ from the
    evaluation's configuration or when the gold manifest's hash is not the evaluation's ``data_sha256``. A model over
    15 MB is refused with the breakdown and the remedies (exit 1). Exit codes: 0 done or skipped (locked; a skipped
    ``--release`` exits 1: nothing was released), 1 failed or refused, 2 bad usage or configuration or an unbound
    release.
    """
    import tomllib

    from pydantic import ValidationError

    from stellar_blaze.jobs.replay_build import repo_root
    from stellar_blaze.jobs.runner import run_job
    from stellar_blaze.ml.artefacts import ModelTooLargeError
    from stellar_blaze.ml.git import GitError
    from stellar_blaze.ml.release_check import DegenerateModelError
    from stellar_blaze.ml.training_config import load_training_config

    settings = _settings()
    try:
        cfg, cfg_sha256 = load_training_config(config)
    except (OSError, tomllib.TOMLDecodeError, ValidationError) as exc:
        raise typer.BadParameter(f"{config}: {exc}", param_hint="--config") from None
    if release and dev_skill is None:
        raise typer.BadParameter(
            "--release needs the evaluation that selected the model: pass the dev_skill.json of `evaluate-dev`",
            param_hint="--dev-skill",
        )
    evaluated = None if dev_skill is None else _dev_skill_inputs(dev_skill)
    dev_metrics = None if evaluated is None else evaluated.metrics
    selection = None if evaluated is None else evaluated.selection
    if release and evaluated is not None:
        _refuse_unbound_release(settings, cfg, evaluated)
    if release:
        try:
            clean = _git_reader(repo_root()).is_clean()
        except GitError as exc:
            _fail(f"train --release refused: cannot read the git state: {exc}")
        if not clean:
            _fail(
                "train --release refused: the working tree is not clean (modified, staged or untracked files); "
                "commit or remove them, so the model's git_sha names the code that trained it. Nothing was written."
            )
    outcome: list[dict[str, JsonValue]] = []

    async def work() -> Mapping[str, JsonValue]:
        try:
            summary = await asyncio.to_thread(
                _train, settings, config, release=release, dev_metrics=dev_metrics, selection=selection
            )
        except (ModelTooLargeError, DegenerateModelError) as exc:
            typer.echo(f"train refused: {exc}", err=True)
            raise
        outcome.append(summary)
        return summary

    params: dict[str, JsonValue] = {
        "config": str(config),
        "config_name": cfg.name,
        "config_sha256": cfg_sha256,
        "release": release,
        "dev_skill": None if dev_skill is None else str(dev_skill),
    }
    job = f"train:{cfg.name}"
    code = asyncio.run(run_job(settings, job, params, work, lock_key=job))
    if outcome:
        typer.echo(json.dumps(outcome[0], sort_keys=True))
    elif release and code == 0:  # skipped: another run holds the lock, so nothing was released
        typer.echo(f"train --release: the run was skipped (the lock of {job} is held); nothing was released.", err=True)
        raise typer.Exit(1)
    raise typer.Exit(code)


class EvaluationPart(StrEnum):
    """``--part`` of ``evaluate-2026``: the three parts of the gated run, or every part that exists."""

    FORECAST = "forecast"
    WARNINGS = "warnings"
    PLANS = "plans"
    ALL = "all"


@ml_app.command("evaluate-2026")
def evaluate_2026_command(
    part: Annotated[
        EvaluationPart,
        typer.Option("--part", help="forecast, warnings or plans (the last two are implemented in B3), or all."),
    ],
    amendment: Annotated[
        str | None,
        typer.Option(
            "--amendment",
            help="One of the lock's amendments (amendment-1, amendment-2, ... by the order of its [[amendments]]) that "
            "allows a re-run of a part that has a result; the first output is kept as *.run1.json.",
        ),
    ] = None,
) -> None:
    """Score the held-out 2026 summer, once, behind the pre-registration gate (never run without the architect's go).

    The gate opens first: the lock, the protocol's hash and commit, a clean tree, the released model, the architect's
    ``backend/training/2026-go.toml`` bound to that protocol and model, and no earlier result. A refusal prints every
    reason on stderr and exits 2 with no data touched. Then the gold file is loaded (pinned to the lock's hash), scored,
    and ``artifacts/eval/2026/`` is written with exclusive create, after a last check that HEAD has not moved and the
    tree is clean. Runs as the job ``evaluate-2026:<part>`` (a ``job_run`` row, one advisory lock per part). Parts
    ``warnings`` and ``plans`` are implemented in B3 (exit 2); ``all`` runs the parts that exist. Exit codes: 0 done or
    skipped (locked, with a message: nothing ran, so it is not a success) is exit 1, 1 failed, 2 refused by the gate or
    bad usage. A relative ``SB_MODELS_DIR``/``SB_DATA_DIR`` is read against ``<repository>/backend``, and a missing
    models directory is refused before the gate reads anything.
    """
    from stellar_blaze.jobs import evaluate_2026
    from stellar_blaze.jobs.replay_build import repo_root
    from stellar_blaze.ml.protocol_gate import Part

    existing = list(evaluate_2026.PART_RUNNERS)
    wanted = existing if part is EvaluationPart.ALL else [Part(part.value)]
    missing = [item for item in wanted if item not in evaluate_2026.PART_RUNNERS]
    if missing:
        typer.echo(
            f"evaluate-2026 --part {', '.join(item.value for item in missing)}: implemented in B3 (nothing was run)",
            err=True,
        )
        raise typer.Exit(2)
    if part is EvaluationPart.ALL:
        later = [item.value for item in Part if item not in evaluate_2026.PART_RUNNERS]
        typer.echo(f"evaluate-2026 --part all: {', '.join(later)} implemented in B3, not run", err=True)
    note = amendment.strip() if amendment else None
    root = repo_root()
    try:
        settings = evaluate_2026.resolve_settings(_settings(), root)
    except ValueError as exc:
        typer.echo(f"evaluate-2026: {exc}", err=True)
        raise typer.Exit(2) from None
    for item in wanted:
        _evaluate_2026_part(settings, root, item, note)


def _evaluate_2026_part(settings: Settings, root: Path, part: "Part", amendment: str | None) -> None:
    """One part of ``evaluate-2026``: the gate first (exit 2 on refusal), then the job (exit 1 on failure)."""
    from stellar_blaze.jobs import evaluate_2026
    from stellar_blaze.jobs.runner import run_job
    from stellar_blaze.ml.protocol_gate import GateRefusedError

    try:
        token = evaluate_2026.open_the_gate(settings, root, part, amendment)
    except GateRefusedError as exc:
        typer.echo(str(exc), err=True)
        raise typer.Exit(2) from None
    refusals: list[GateRefusedError] = []
    outcome: list[dict[str, JsonValue]] = []

    async def work() -> Mapping[str, JsonValue]:
        try:
            summary = await asyncio.to_thread(
                evaluate_2026.PART_RUNNERS[part], settings, token, root, amendment=amendment
            )
        except GateRefusedError as exc:  # HEAD moved or the tree went dirty before the write: nothing was written
            refusals.append(exc)
            raise
        outcome.append(summary)
        return summary

    job = f"evaluate-2026:{part.value}"
    params: dict[str, JsonValue] = {"part": part.value, "amendment": amendment, "head": token.head}
    code = asyncio.run(run_job(settings, job, params, work, lock_key=job))
    if refusals:
        typer.echo(str(refusals[0]), err=True)
        raise typer.Exit(2)
    if outcome:
        typer.echo(json.dumps(outcome[0], sort_keys=True))
    elif code == 0:  # run_job skipped the run (another process holds the lock): nothing was scored or written
        typer.echo(f"{job}: skipped, another run holds the lock (nothing was scored or written)", err=True)
        raise typer.Exit(1)
    if code != 0:
        raise typer.Exit(code)
