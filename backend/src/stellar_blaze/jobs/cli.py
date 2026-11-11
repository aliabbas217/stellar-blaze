"""Command-line entry point for batch jobs, installed as ``sb-jobs``.

Each command is one idempotent job: it records a ``job_run`` row and takes an advisory lock named like the command, so a
second run while one is active is recorded as ``skipped_locked`` and exits 0::

    sb-jobs ingest-observations --source iem|ghcnh --summer YEAR [--summer YEAR ...] [--station ICAO ...]
    sb-jobs ingest-forecasts --model <nwp model> --summer YEAR [--summer YEAR ...] [--station ICAO ...]
    sb-jobs build-dataset

Configuration is the ``SB_*`` environment (``SB_DATABASE_URL`` is required; ``SB_DATA_DIR`` says where the files go).
The sources come from ``composition.build_sources``, looked up as a module attribute so a test can replace it with
fakes; this module never names an adapter. Exit codes: 0 succeeded or skipped, 1 failed, 2 bad usage or configuration.
"""

import asyncio
from collections.abc import Awaitable, Callable, Mapping, Sequence
from enum import StrEnum
from typing import Annotated

import typer
from pydantic import JsonValue, ValidationError

from stellar_blaze.adapters.storage.parquet_store import ParquetStore
from stellar_blaze.composition import build_sources
from stellar_blaze.config import Settings
from stellar_blaze.domain.weather.models import MODEL_SUMMERS, NwpModel
from stellar_blaze.domain.weather.stations import STATIONS, Station, station
from stellar_blaze.jobs.runner import run_job
from stellar_blaze.jobs.work import build_dataset, ingest_forecasts, ingest_observations
from stellar_blaze.logging import configure_logging

# No rich traceback with locals: the locals of a failing command hold its settings, and so its connection string.
app = typer.Typer(
    no_args_is_help=True,
    add_completion=False,
    pretty_exceptions_show_locals=False,
    help="Batch jobs of the Stellar Blaze backend: ingest the hindcast data and build the gold dataset.",
)


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
) -> None:
    """Run the job to its end in a fresh event loop and exit with its code."""
    raise typer.Exit(asyncio.run(run_job(settings, job_name, params, work)))


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

    _execute(settings, "ingest-observations", params, work)


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

    _execute(settings, "ingest-forecasts", params, work)


@app.command("build-dataset")
def build_dataset_command() -> None:
    """Join the silver forecasts to the truth and audit values and write the gold pair dataset and its manifest."""
    settings = _settings()

    async def work() -> Mapping[str, JsonValue]:
        return await build_dataset(store=ParquetStore(settings.data_dir), code_version=settings.git_sha)

    _execute(settings, "build-dataset", {}, work)
