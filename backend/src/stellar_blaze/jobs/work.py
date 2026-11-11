"""The bodies of the ``sb-jobs`` commands: ingest observations, ingest forecasts, build the gold dataset.

Each is a plain coroutine over its collaborators (the sources, the store), with no database and no command line in
sight, so it is tested with fakes and a temporary directory. ``runner.run_job`` wraps one in the lock and the
``job_run`` record; what it returns is the run's summary.
"""

import asyncio
from collections.abc import Sequence

import structlog
from pydantic import JsonValue

from stellar_blaze.adapters.storage.parquet_store import ParquetStore
from stellar_blaze.application.dataset import build_pairs, summarize_pairs
from stellar_blaze.application.ingest import QC_POLICY_BY_SOURCE, fetch_forecasts, fetch_hourly_observations
from stellar_blaze.composition import Sources
from stellar_blaze.domain.weather.dataset import GoldManifest, ObservationQc
from stellar_blaze.domain.weather.models import NwpModel
from stellar_blaze.domain.weather.stations import Station

logger = structlog.stdlib.get_logger(__name__)

# The sources a gold dataset is built from: the truth, and the audit values.
TRUTH_SOURCE = "iem"
AUDIT_SOURCE = "ghcnh"


class DatasetInputError(RuntimeError):
    """The silver layer cannot make a gold dataset: something is missing, or it changed while the build read it."""


async def ingest_observations(
    *, sources: Sources, source_name: str, stations: Sequence[Station], summers: Sequence[int], store: ParquetStore
) -> dict[str, JsonValue]:
    """Fetch, bin and store the hourly observations of ``source_name`` for each summer and station, one after another.

    Per station-summer it writes ``silver/observations/<source>/<summer>/<ICAO>.parquet`` and, next to it, the
    ``BinningReport`` as ``<ICAO>.binning.json`` (the values excluded from the truth and audit columns, so the build
    can put the counts in the manifest). One log line per station-summer carries the row count and the report. The
    first failure stops the job: what was stored before it stays, and a rerun refetches nothing that is cached.

    Raises:
        KeyError: ``source_name`` is not one of the sources in ``sources.observations`` and ``QC_POLICY_BY_SOURCE``.
    """
    source = sources.observations[source_name]
    qc_policy = QC_POLICY_BY_SOURCE[source_name]
    files: list[JsonValue] = []
    total_rows = 0
    for summer in summers:
        for station in stations:
            hourly, report = await fetch_hourly_observations(source, station, summer, qc_policy)
            qc = ObservationQc(
                source=source_name,
                station=station.icao,
                summer=summer,
                n_raw=report.n_raw,
                n_implausible=report.n_implausible,
                n_qc_flagged=report.n_qc_flagged,
            )
            await asyncio.to_thread(store.write_observations, source_name, summer, station.icao, hourly)
            await asyncio.to_thread(store.write_binning_report, qc)
            total_rows += hourly.height
            fields = {"rows": hourly.height, **qc.model_dump(mode="json", exclude={"source", "station", "summer"})}
            logger.info("ingest.observations", source=source_name, station=station.icao, summer=summer, **fields)
            if report.n_raw == 0:
                logger.warning("ingest.observations_empty", source=source_name, station=station.icao, summer=summer)
            files.append({"station": station.icao, "summer": summer, **fields})
    return {"source": source_name, "files": files, "rows": total_rows}


async def ingest_forecasts(
    *, sources: Sources, model: NwpModel, stations: Sequence[Station], summers: Sequence[int], store: ParquetStore
) -> dict[str, JsonValue]:
    """Fetch and store ``model``'s forecasts for each summer and station, one after another.

    Per station-summer it writes ``silver/forecasts/<model>/<summer>/<ICAO>.parquet`` and logs the row count. The first
    failure stops the job, as in ``ingest_observations``.

    Raises:
        ValueError: ``model`` has no archive for one of the summers (nothing was requested for it).
    """
    files: list[JsonValue] = []
    total_rows = 0
    for summer in summers:
        for station in stations:
            frame = await fetch_forecasts(sources.forecasts, station, model, summer)
            await asyncio.to_thread(store.write_forecasts, model, summer, station.icao, frame)
            total_rows += frame.height
            logger.info("ingest.forecasts", model=model.value, station=station.icao, summer=summer, rows=frame.height)
            files.append({"station": station.icao, "summer": summer, "rows": frame.height})
    return {"model": model.value, "files": files, "rows": total_rows}


def _build_dataset(store: ParquetStore, code_version: str) -> GoldManifest:
    inputs = store.silver_inputs()
    forecasts = store.read_forecasts()
    truth = store.read_observations(TRUTH_SOURCE)
    audit = store.read_observations(AUDIT_SOURCE)
    if forecasts.is_empty():
        raise DatasetInputError("no silver forecasts to build from; run ingest-forecasts first")
    if truth.is_empty():
        raise DatasetInputError(f"no silver {TRUTH_SOURCE} observations (the truth); run ingest-observations first")
    if audit.is_empty():
        logger.warning("build_dataset.no_audit_observations", source=AUDIT_SOURCE)
    qc = [*store.read_binning_reports(TRUTH_SOURCE), *store.read_binning_reports(AUDIT_SOURCE)]

    pairs = build_pairs(forecasts=forecasts, obs_iem=truth, obs_ghcnh=audit)
    summary = summarize_pairs(pairs, observation_qc=qc)

    if store.silver_inputs() != inputs:
        raise DatasetInputError("silver files changed while the dataset was built; run build-dataset again")
    return store.write_gold(pairs, summary=summary, code_version=code_version, inputs=inputs)


async def build_dataset(*, store: ParquetStore, code_version: str) -> dict[str, JsonValue]:
    """Build ``gold/pairs.parquet`` and ``gold/manifest.json`` from every silver file.

    The build runs on a worker thread (a few minutes of numpy and Polars work), reads each silver file once between two
    hashings of the whole layer, and refuses to write when the layer changed in between, so the manifest's inputs are
    exactly what the pairs were built from.

    Raises:
        DatasetInputError: There are no forecasts or no IEM observations, or the silver layer changed during the build.
        MissingBinningReportError: A silver observation file has no binning report.
        SchemaMismatchError: A silver file does not hold its schema.
    """
    manifest = await asyncio.to_thread(_build_dataset, store, code_version)
    logger.info(
        "build_dataset.written",
        path=manifest.output.path,
        sha256=manifest.output.sha256,
        rows=manifest.output.rows,
        inputs=len(manifest.inputs),
        code_version=manifest.code_version,
    )
    return {
        "rows": manifest.output.rows,
        "sha256": manifest.output.sha256,
        "path": manifest.output.path,
        "inputs": len(manifest.inputs),
        "code_version": manifest.code_version,
    }
