"""Command-line entry point for batch jobs, installed as ``sb-jobs``.

Each command is one idempotent job: it records a ``job_run`` row and takes an advisory lock named after the command and
what it works on (``ingest-observations:iem``, ``ingest-forecasts:gfs_seamless``, ``build-dataset``), so a second run of
the same thing while one is active is recorded as ``skipped_locked`` and exits 0, while runs of different sources or
models may overlap::

    sb-jobs ingest-observations --source iem|ghcnh --summer YEAR [--summer YEAR ...] [--station ICAO ...]
    sb-jobs ingest-forecasts --model <nwp model> --summer YEAR [--summer YEAR ...] [--station ICAO ...]
    sb-jobs build-dataset

and the schema and the runtime configuration (ADR 0010), which are not jobs (no ``job_run`` row, no advisory lock: the
activation log itself records who changed what and why)::

    sb-jobs db upgrade                     # alembic upgrade head, then config seed (what the migration job runs)
    sb-jobs config seed [--file PATH]      # store the git default; activate it only if nothing was ever activated
    sb-jobs config show | history [--limit N]
    sb-jobs config validate FILE           # offline
    sb-jobs config propose FILE --actor A --reason R
    sb-jobs config activate VERSION_ID --actor A --reason R [--expected-previous ID]
    sb-jobs config rollback --actor A --reason R [--expected-previous ID]

and the governance data (ADR 0054, 0057; not jobs either)::

    sb-jobs site load PATH --actor A --reason R   # idempotent upsert; one input.changed audit row per change
    sb-jobs audit verify                          # recompute the hash chain: exit 0, or 1 with audit.chain_broken id=N

and the replay snapshots of the forecast corrector (``jobs/ml_cli.py``, also not jobs: no ``job_run`` row, no database,
no lock; it copies silver files into ``SB_REPLAY_DIR`` and is documented there)::

    sb-jobs replay build --summer YEAR --station ICAO [--station ICAO ...] --snapshot-id ID

Configuration is the ``SB_*`` environment (``SB_DATABASE_URL`` is required; ``SB_DATA_DIR`` says where the files go).
The sources come from ``composition.build_sources`` and the config store from ``composition.build_config_store``, both
looked up as module attributes so a test can replace them with fakes; this module never names an adapter. Exit codes:
0 succeeded or skipped, 1 failed (a command was refused or could not reach the database), 2 bad usage or configuration.
The ``config`` commands print their result as JSON on stdout (one object, or one per line for ``history``) and their
refusals on stderr.
"""

import asyncio
import json
import tomllib
from collections.abc import Awaitable, Callable, Mapping, Sequence
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Any, NoReturn

import typer
from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from alembic.script import ScriptDirectory
from pydantic import JsonValue, ValidationError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine

from stellar_blaze.adapters.db.engine import build_engine
from stellar_blaze.adapters.storage.parquet_store import ParquetStore
from stellar_blaze.application.runtime_config import (
    AuditFieldsError,
    ConfigInvalidError,
    ConfigService,
    NothingToRollBackError,
    SeedResult,
    audit_fields,
)
from stellar_blaze.application.site_load import load_site
from stellar_blaze.composition import (
    Runtime,
    build_audit_log,
    build_config_service,
    build_config_store,
    build_runtime,
    build_site_store,
    build_sources,
    dubai_today,
    load_runtime_config,
    load_site_fixture,
)
from stellar_blaze.config import Settings
from stellar_blaze.domain.config.runtime import ConfigViolation, RuntimeConfig
from stellar_blaze.domain.weather.models import MODEL_SUMMERS, NwpModel
from stellar_blaze.domain.weather.stations import STATIONS, Station, station
from stellar_blaze.jobs.ml_cli import ml_app
from stellar_blaze.jobs.runner import describe_error, run_job
from stellar_blaze.jobs.work import build_dataset, ingest_forecasts, ingest_observations
from stellar_blaze.logging import configure_logging
from stellar_blaze.ports.config_store import (
    ActivationRecord,
    StaleActivationError,
    StoreUnavailableError,
    VersionNotFoundError,
)

# No rich traceback with locals: the locals of a failing command hold its settings, and so its connection string.
app = typer.Typer(
    no_args_is_help=True,
    add_completion=False,
    pretty_exceptions_show_locals=False,
    help="Batch jobs of the Stellar Blaze backend: ingest the hindcast data and build the gold dataset; migrate the "
    "database; manage the runtime config.",
)
db_app = typer.Typer(
    no_args_is_help=True,
    add_completion=False,
    pretty_exceptions_show_locals=False,
    help="Database schema commands.",
)
config_app = typer.Typer(
    no_args_is_help=True,
    add_completion=False,
    pretty_exceptions_show_locals=False,
    help="Runtime config (ADR 0010): propose, activate and roll back the operating values, with no restart.",
)
site_app = typer.Typer(
    no_args_is_help=True,
    add_completion=False,
    pretty_exceptions_show_locals=False,
    help="Site fixture (ADR 0057): load the demo site, its crews and members.",
)
audit_app = typer.Typer(
    no_args_is_help=True,
    add_completion=False,
    pretty_exceptions_show_locals=False,
    help="The append-only, hash-chained audit log (ADR 0054).",
)
app.add_typer(db_app, name="db")
app.add_typer(config_app, name="config")
app.add_typer(site_app, name="site")
app.add_typer(audit_app, name="audit")
app.add_typer(ml_app)  # no name: its commands (and its `replay` group) sit at the top level of sb-jobs


class ObservationSourceName(StrEnum):
    """The observation sources ``ingest-observations`` can pull: the truth (IEM) and the audit values (GHCNh)."""

    IEM = "iem"
    GHCNH = "ghcnh"


SummerOption = Annotated[
    list[int], typer.Option("--summer", help="Summer year to ingest (15 May to 30 Sep). Repeat for several.")
]
StationOption = Annotated[
    list[str] | None,
    typer.Option("--station", help="ICAO station to ingest. Repeat for several. Default: all 8 core stations."),
]


def _settings() -> Settings:
    """The settings from the environment, with logging configured.

    An invalid or incomplete configuration ends the command with exit code 2 and says which variables are wrong (never
    their values).
    """
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


def _stations(icaos: Sequence[str] | None) -> list[Station]:
    """The stations asked for, each once, in the order given; all of ``STATIONS`` when none was asked for."""
    if not icaos:
        return list(STATIONS)
    try:
        return [station(icao) for icao in dict.fromkeys(icaos)]
    except KeyError as exc:
        raise typer.BadParameter(str(exc.args[0]), param_hint="--station") from None


def _execute(
    settings: Settings,
    job_name: str,
    params: Mapping[str, JsonValue],
    work: Callable[[], Awaitable[Mapping[str, JsonValue]]],
    *,
    lock_key: str,
) -> None:
    """Run the job to its end in a fresh event loop and exit with its code.

    ``lock_key`` names what the run works on (``ingest-observations:iem``): two runs that work on different things may
    overlap, two that work on the same thing may not.
    """
    raise typer.Exit(asyncio.run(run_job(settings, job_name, params, work, lock_key=lock_key)))


@app.command("ingest-observations")
def ingest_observations_command(
    source: Annotated[ObservationSourceName, typer.Option("--source", help="Observation source to pull.")],
    summer: SummerOption,
    station: StationOption = None,
) -> None:
    """Pull observations, bin them to the nearest UTC hour and store them (silver) with their binning counts."""
    settings = _settings()
    stations = _stations(station)
    summers = list(dict.fromkeys(summer))
    params: dict[str, JsonValue] = {
        "source": source.value,
        "summers": [*summers],
        "stations": [s.icao for s in stations],
    }

    async def work() -> Mapping[str, JsonValue]:
        sources = build_sources(settings)
        try:
            return await ingest_observations(
                sources=sources,
                source_name=source.value,
                stations=stations,
                summers=summers,
                store=ParquetStore(settings.data_dir),
            )
        finally:
            await sources.close()

    _execute(settings, "ingest-observations", params, work, lock_key=f"ingest-observations:{source.value}")


@app.command("ingest-forecasts")
def ingest_forecasts_command(
    model: Annotated[NwpModel, typer.Option("--model", help="NWP model whose archived forecasts to pull.")],
    summer: SummerOption,
    station: StationOption = None,
) -> None:
    """Pull one model's archived forecasts at leads 0 to 7 days and store them (silver)."""
    summers = list(dict.fromkeys(summer))
    unavailable = [year for year in summers if year not in MODEL_SUMMERS[model]]
    if unavailable:
        raise typer.BadParameter(
            f"{model.value} has no Previous Runs archive for {unavailable}; its summers are "
            f"{sorted(MODEL_SUMMERS[model])}",
            param_hint="--summer",
        )
    settings = _settings()
    stations = _stations(station)
    params: dict[str, JsonValue] = {
        "model": model.value,
        "summers": [*summers],
        "stations": [s.icao for s in stations],
    }

    async def work() -> Mapping[str, JsonValue]:
        sources = build_sources(settings)
        try:
            return await ingest_forecasts(
                sources=sources, model=model, stations=stations, summers=summers, store=ParquetStore(settings.data_dir)
            )
        finally:
            await sources.close()

    _execute(settings, "ingest-forecasts", params, work, lock_key=f"ingest-forecasts:{model.value}")


@app.command("build-dataset")
def build_dataset_command() -> None:
    """Join the silver forecasts to the truth and audit values and write the gold pair dataset and its manifest."""
    settings = _settings()

    async def work() -> Mapping[str, JsonValue]:
        return await build_dataset(store=ParquetStore(settings.data_dir), code_version=settings.git_sha)

    _execute(settings, "build-dataset", {}, work, lock_key="build-dataset")


# === db and config ===================================================================================================

ActorOption = Annotated[
    str,
    typer.Option(
        "--actor", help="Who is making this change (recorded with it; the HTTP admin API takes it from a token)."
    ),
]
ReasonOption = Annotated[str, typer.Option("--reason", help="Why, in 10 to 500 characters (recorded with the change).")]
ConfigFileArgument = Annotated[
    Path,
    typer.Argument(
        exists=True, dir_okay=False, readable=True, help="A runtime config TOML file (see config/runtime/)."
    ),
]
DEFAULT_SEED_REASON = "seed from git default"
ALEMBIC_INI = Path("alembic.ini")


def _fail(message: str, code: int = 1) -> NoReturn:
    typer.echo(message, err=True)
    raise typer.Exit(code)


def _emit(payload: Mapping[str, Any], *, indent: int | None = None) -> None:
    typer.echo(json.dumps(payload, indent=indent))


def _runtime(settings: Settings) -> Runtime:
    """The rulesets, models and (outside prod) the seed snapshot, or exit 2: nothing is written to a database that
    these commands could not validate against."""
    try:
        return build_runtime(settings, today=dubai_today())
    except Exception as exc:  # every way the rulesets, models or seed can be unusable is a configuration error
        _fail(f"configuration error: {describe_error(exc)}", 2)


def _audit(actor: str, reason: str) -> None:
    """Refuse a blank actor or a reason outside 10 to 500 characters before anything is read or written."""
    try:
        audit_fields(actor, reason)
    except AuditFieldsError as exc:
        raise typer.BadParameter(str(exc), param_hint="--actor/--reason") from None


def _read_config_file(path: Path) -> RuntimeConfig:
    """The config in ``path``; an unreadable file is a usage error (2), a file that is not a config is a refusal (1)."""
    try:
        return load_runtime_config(path)
    except OSError as exc:
        _fail(f"cannot read {path}: {exc.strerror or type(exc).__name__}", 2)
    except ValidationError as exc:
        problems = "; ".join(
            f"{'.'.join(str(part) for part in error['loc']) or 'config'}: {error['msg']}"
            for error in exc.errors(include_input=False, include_url=False, include_context=False)
        )
        _fail(f"{path} is not a valid runtime config: {problems}")
    except tomllib.TOMLDecodeError as exc:
        _fail(f"{path} is not valid TOML: {exc}")


def _refuse(violations: Sequence[ConfigViolation]) -> NoReturn:
    for violation in violations:
        typer.echo(f"{violation.code} at {violation.path}: {violation.message}", err=True)
    raise typer.Exit(1)


def _run[T](settings: Settings, runtime: Runtime, work: Callable[[ConfigService], Awaitable[T]]) -> T:
    """Run ``work`` against a config service over the database, and turn what it refuses into exit codes.

    The engine opens no connection until ``work`` reads or writes, and is disposed afterwards.
    """

    async def go() -> T:
        engine = build_engine(settings)
        try:
            return await work(
                build_config_service(runtime, build_config_store(engine, settings), audit=build_audit_log(engine))
            )
        finally:
            await engine.dispose()

    try:
        return asyncio.run(go())
    except ConfigInvalidError as exc:
        _refuse(exc.violations)
    except StaleActivationError as exc:
        _fail(
            f"stale: {exc}. Another activation landed first (or this one named the wrong predecessor); "
            "run `sb-jobs config show` and decide again."
        )
    except VersionNotFoundError as exc:
        _fail(f"not found: {exc}")
    except NothingToRollBackError as exc:
        _fail(f"nothing to roll back: {exc}")
    except (StoreUnavailableError, SQLAlchemyError, OSError, TimeoutError) as exc:
        _fail(f"error: {describe_error(exc)}")


def _seed_actor(settings: Settings) -> str:
    """``seed:<git sha>`` of the release that seeds, ``seed:local`` outside a release (``SB_GIT_SHA`` unset)."""
    return f"seed:{'local' if settings.git_sha == 'unknown' else settings.git_sha}"


def _seed_payload(result: SeedResult) -> dict[str, Any]:
    return {
        "version_id": result.version.id,
        "sha256": result.version.sha256,
        "activation_id": None if result.activation is None else result.activation.id,
    }


async def _validate(service: ConfigService, config: RuntimeConfig) -> list[ConfigViolation]:
    return service.validate(config)


@db_app.command("upgrade")
def db_upgrade_command() -> None:
    """Migrate the database to the latest revision, then seed the runtime config (what the migration job runs).

    Run from the directory that holds ``alembic.ini`` and ``alembic/`` (``backend/``; ``/app`` in the image). The seed
    file (``SB_RUNTIME_CONFIG_SEED``) is validated before anything is migrated, so a deploy never applies DDL and then
    finds that it cannot seed. Both steps are idempotent, and the seed never replaces a config that is already active.
    """
    settings = _settings()
    runtime = _runtime(settings)
    if not ALEMBIC_INI.is_file():
        _fail(
            f"configuration error: {ALEMBIC_INI} not found in the working directory; run from the directory that holds "
            "alembic.ini and alembic/ (backend/, or /app in the image)",
            2,
        )
    seed = _read_config_file(settings.runtime_config_seed)
    violations = _run(settings, runtime, lambda service: _validate(service, seed))
    if violations:
        _refuse(violations)

    alembic_config = AlembicConfig(str(ALEMBIC_INI))
    # Hand over the settings and keep the application's logging: Alembic's progress then goes through the same
    # structured log as everything else, and env.py needs no second environment.
    alembic_config.attributes["settings"] = settings
    alembic_config.attributes["configure_logger"] = False
    try:
        alembic_command.upgrade(alembic_config, "head")
    except Exception as exc:  # whatever stopped the migration: the deploy must see exit 1 and the reason
        _fail(f"migration failed: {describe_error(exc)}")
    revision = ScriptDirectory.from_config(alembic_config).get_current_head()

    seeded = _run(
        settings,
        runtime,
        lambda service: service.seed(seed, actor=_seed_actor(settings), reason=DEFAULT_SEED_REASON),
    )
    _emit({"revision": revision, **_seed_payload(seeded)})


@config_app.command("validate")
def config_validate_command(file: ConfigFileArgument) -> None:
    """Check a config file against the rulesets and models of this release, offline (nothing is read or written)."""
    settings = _settings()
    runtime = _runtime(settings)
    config = _read_config_file(file)
    violations = _run(settings, runtime, lambda service: _validate(service, config))
    if violations:
        _refuse(violations)
    _emit({"valid": True})


@config_app.command("seed")
def config_seed_command(
    file: Annotated[
        Path | None,
        typer.Option("--file", exists=True, dir_okay=False, readable=True, help="Default: SB_RUNTIME_CONFIG_SEED."),
    ] = None,
) -> None:
    """Store the git default config and activate it only if nothing was ever activated. Safe to run again."""
    settings = _settings()
    runtime = _runtime(settings)
    config = _read_config_file(file or settings.runtime_config_seed)
    seeded = _run(
        settings,
        runtime,
        lambda service: service.seed(config, actor=_seed_actor(settings), reason=DEFAULT_SEED_REASON),
    )
    _emit(_seed_payload(seeded))


@config_app.command("show")
def config_show_command() -> None:
    """Print the active version: the activation (who, why, when), the version's hash and its body."""
    settings = _settings()
    runtime = _runtime(settings)

    async def work(service: ConfigService) -> dict[str, Any] | None:
        latest = await service.latest_activation()
        if latest is None:
            return None
        version = await service.get_version(latest.config_version_id)
        return {
            "activation_id": latest.id,
            "kind": latest.kind,
            "actor": latest.actor,
            "reason": latest.reason,
            "activated_at": latest.activated_at.isoformat(),
            "config_version_id": version.id,
            "sha256": version.sha256,
            "body": version.body,
        }

    shown = _run(settings, runtime, work)
    if shown is None:
        _fail("no active config: nothing was ever activated (run `sb-jobs config seed`)")
    _emit(shown, indent=2)


@config_app.command("history")
def config_history_command(
    limit: Annotated[int, typer.Option("--limit", min=1, help="How many activations to print.")] = 20,
) -> None:
    """Print the latest activations, newest first, one JSON object per line."""
    settings = _settings()
    runtime = _runtime(settings)
    for record in _run(settings, runtime, lambda service: service.history(limit)):
        typer.echo(json.dumps(record.model_dump(mode="json")))


@config_app.command("propose")
def config_propose_command(file: ConfigFileArgument, actor: ActorOption, reason: ReasonOption) -> None:
    """Validate a config file and store it as a new version. It is not active until you activate it."""
    _audit(actor, reason)
    settings = _settings()
    runtime = _runtime(settings)
    config = _read_config_file(file)
    version = _run(settings, runtime, lambda service: service.propose(config, actor, reason))
    _emit({"version_id": version.id, "sha256": version.sha256})


@config_app.command("activate")
def config_activate_command(
    version_id: Annotated[int, typer.Argument(min=1, help="The config version to activate (see `config propose`).")],
    actor: ActorOption,
    reason: ReasonOption,
    expected_previous: Annotated[
        int | None,
        typer.Option(
            "--expected-previous",
            help="The activation you saw as the latest. Default: the latest now. A stale one is refused (exit 1).",
        ),
    ] = None,
) -> None:
    """Make a stored version the active one; running processes pick it up within SB_CONFIG_POLL_INTERVAL_S."""
    _audit(actor, reason)
    settings = _settings()
    runtime = _runtime(settings)

    async def work(service: ConfigService) -> dict[str, Any]:
        expected = expected_previous
        if expected is None:
            latest = await service.latest_activation()
            expected = None if latest is None else latest.id
        record = await service.activate(version_id, expected, actor, reason)
        return _activation_payload(record)

    _emit(_run(settings, runtime, work))


@config_app.command("rollback")
def config_rollback_command(
    actor: ActorOption,
    reason: ReasonOption,
    expected_previous: Annotated[
        int | None,
        typer.Option(
            "--expected-previous",
            help="The activation you saw as the latest. Default: the latest now. A stale one is refused (exit 1), "
            "so a rollback sent twice, or two at once, rolls back once.",
        ),
    ] = None,
) -> None:
    """Activate the version that was active before the current one. A second rollback undoes the first."""
    _audit(actor, reason)
    settings = _settings()
    runtime = _runtime(settings)

    async def work(service: ConfigService) -> dict[str, Any]:
        return _activation_payload(await service.rollback(actor, reason, expected_previous=expected_previous))

    _emit(_run(settings, runtime, work))


def _activation_payload(record: ActivationRecord) -> dict[str, Any]:
    return {
        "activation_id": record.id,
        "kind": record.kind,
        "config_version_id": record.config_version_id,
        "previous_activation_id": record.previous_activation_id,
    }


# === site and audit =================================================================================================


def _run_db[T](settings: Settings, work: Callable[[AsyncEngine], Awaitable[T]]) -> T:
    """Run ``work`` against an engine over the database; a database error is exit 1 with its description."""

    async def go() -> T:
        engine = build_engine(settings)
        try:
            return await work(engine)
        finally:
            await engine.dispose()

    try:
        return asyncio.run(go())
    except (SQLAlchemyError, OSError, TimeoutError) as exc:
        _fail(f"error: {describe_error(exc)}")


@site_app.command("load")
def site_load_command(
    path: Annotated[
        Path,
        typer.Argument(
            exists=True, dir_okay=False, readable=True, help="A site fixture TOML (fixtures/demo_site.toml)."
        ),
    ],
    actor: ActorOption,
    reason: ReasonOption,
) -> None:
    """Upsert the site, its crews and members; audit one row per changed field. Safe to run again (no rows)."""
    _audit(actor, reason)
    settings = _settings()
    try:
        fixture = load_site_fixture(path)
    except OSError as exc:
        _fail(f"cannot read {path}: {exc.strerror or type(exc).__name__}", 2)
    except ValidationError as exc:
        problems = "; ".join(
            f"{'.'.join(str(part) for part in error['loc']) or 'fixture'}: {error['msg']}"
            for error in exc.errors(include_input=False, include_url=False, include_context=False)
        )
        _fail(f"{path} is not a valid site fixture: {problems}")
    except (tomllib.TOMLDecodeError, ValueError) as exc:
        _fail(f"{path} is not a valid site fixture: {exc}")

    async def work(engine: AsyncEngine) -> dict[str, Any]:
        store = build_site_store(engine)
        result = await load_site(fixture, sites=store, store=store, actor=actor.strip(), reason=reason.strip())
        return {"site_id": result.site_id, "created": result.created, "changes": result.changes}

    _emit(_run_db(settings, work))


@audit_app.command("verify")
def audit_verify_command() -> None:
    """Recompute the audit hash chain; exit 0 when intact, exit 1 naming the first broken row."""
    settings = _settings()

    async def work(engine: AsyncEngine) -> int | None:
        return await build_audit_log(engine).verify()

    broken = _run_db(settings, work)
    if broken is not None:
        _fail(f"audit.chain_broken id={broken}")
    _emit({"chain": "intact"})
