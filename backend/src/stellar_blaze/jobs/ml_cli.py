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

The API image has no training dependencies and ``sb-jobs --help`` must work there, so this module imports only typer,
the standard library and ``stellar_blaze.config`` at module level. Every command imports what it needs
(``stellar_blaze.ml`` included) inside its body, and a test pins that ``sb-jobs --help`` runs with the training
packages blocked.
"""

import asyncio
import json
from collections.abc import Mapping
from pathlib import Path
from typing import Annotated, NoReturn

import typer
from pydantic import JsonValue

from stellar_blaze.config import Settings

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


def _evaluate_dev(settings: Settings, config: Path, *, grid: bool, out_dir: Path | None) -> dict[str, JsonValue]:
    """The body of ``sb-jobs evaluate-dev``: load the dev pairs, run the selection, write the exports (blocking).

    Fails before any model is fitted if the manifest, the git commit or the pairs file cannot be had: a run of tens of
    minutes must not end at its last step on a missing hash.
    """
    from stellar_blaze.domain.weather.dataset import GoldManifest
    from stellar_blaze.jobs.replay_build import git_head, repo_root
    from stellar_blaze.ml.data import load_dev_pairs
    from stellar_blaze.ml.exporters import write_dev_exports
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
    selection = run_dev_selection(pairs, cfg, cfg_sha256, grid=grid)
    hashes = write_dev_exports(
        selection.oof,
        selection.decisions,
        target,
        pairs=pairs,
        cfg=selection.cfg,
        cfg_sha256=selection.cfg_sha256,
        git_sha=git_sha,
        data_sha256=data_sha256,
        mode=selection.mode,
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
    out: Annotated[
        Path | None, typer.Option("--out", help="Export directory (default: artifacts/eval/dev/ at the repo root).")
    ] = None,
) -> None:
    """Evaluate the corrector on 2024-2025 leave-one-cluster-out and write the dev exports (never reads 2026).

    Without ``--grid`` only the given config runs; with it the hyperparameters, feature set, WBGT method and
    calibration window are chosen by the pre-registered rules (section 6) and the chosen configuration's out-of-fold
    predictions are exported. Writes ``selection.json``, ``dev_skill.json`` and ``oof_samples_abu_dhabi.parquet`` and
    prints the decisions as JSON. Runs as the ``evaluate-dev`` job (a ``job_run`` row, one advisory lock per config
    name). Exit codes: 0 done or skipped (locked), 1 failed, 2 bad usage or configuration.
    """
    import tomllib

    from pydantic import ValidationError

    from stellar_blaze.jobs.runner import run_job
    from stellar_blaze.ml.training_config import load_training_config

    settings = _settings()
    try:
        cfg, cfg_sha256 = load_training_config(config)
    except (OSError, tomllib.TOMLDecodeError, ValidationError) as exc:
        raise typer.BadParameter(f"{config}: {exc}", param_hint="--config") from None
    outcome: list[dict[str, JsonValue]] = []

    async def work() -> Mapping[str, JsonValue]:
        summary = await asyncio.to_thread(_evaluate_dev, settings, config, grid=grid, out_dir=out)
        outcome.append(summary)
        return summary

    params: dict[str, JsonValue] = {
        "config": str(config),
        "config_name": cfg.name,
        "config_sha256": cfg_sha256,
        "grid": grid,
    }
    code = asyncio.run(run_job(settings, "evaluate-dev", params, work, lock_key=f"evaluate-dev:{cfg.name}"))
    if outcome:
        typer.echo(json.dumps(outcome[0], sort_keys=True))
    raise typer.Exit(code)
