"""The composition root: the one module that turns ``Settings`` into implementations (ADR 0009 section 2).

Nothing else branches on ``Settings`` to choose an adapter, and there is no dependency-injection framework and no
service locator: adapters are chosen through plain registries in this module, and handlers receive what they need
through FastAPI ``Depends`` from ``app.state.runtime``. The import-linter contract "Entrypoints reach swappable adapters
only through composition" keeps ``api`` and ``jobs`` from importing ``adapters.sources``, ``adapters.fakes``,
``adapters.compute`` and ``adapters.config`` directly. Fakes enter only through a registry that a test passes in; the
production registry below is read-only.
"""

from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from types import MappingProxyType
from typing import Final, Literal
from zoneinfo import ZoneInfo

import httpx2
from sqlalchemy.ext.asyncio import AsyncEngine

from stellar_blaze.adapters.compute.lgbm_corrector import LightGbmCorrector
from stellar_blaze.adapters.config.models import scan_models
from stellar_blaze.adapters.config.rulesets import load_catalog
from stellar_blaze.adapters.config.runtime_file import load_runtime_config_file
from stellar_blaze.adapters.config.site_fixture import load_site_fixture as _load_site_fixture
from stellar_blaze.adapters.db.audit import PostgresAuditLog
from stellar_blaze.adapters.db.config_store import PostgresConfigStore
from stellar_blaze.adapters.db.plans import PostgresCrewStopStore, PostgresDayPlanStore, PostgresPlanSignoffStore
from stellar_blaze.adapters.db.sites import PostgresSiteStore
from stellar_blaze.adapters.fakes.corrector import FakeCorrector
from stellar_blaze.adapters.http.cache import RawResponseCache
from stellar_blaze.adapters.http.client import build_async_client
from stellar_blaze.adapters.http.pacer import RequestPacer
from stellar_blaze.adapters.sources.ghcnh import GhcnhParquetSource
from stellar_blaze.adapters.sources.iem import IemMetarSource
from stellar_blaze.adapters.sources.open_meteo import OpenMeteoPreviousRunsSource
from stellar_blaze.adapters.sources.replay import ReplayForecastSource, ReplayObservationSource
from stellar_blaze.application.runtime_config import ConfigService, ConfigSnapshot, SnapshotHolder
from stellar_blaze.application.services import Services
from stellar_blaze.config import ForecastSourceKind, Settings
from stellar_blaze.domain.config.models import ModelRegistry
from stellar_blaze.domain.config.runtime import ConfigViolation, RuntimeConfig, config_sha256, validate_runtime_config
from stellar_blaze.domain.rules.catalog import RulesetCatalog
from stellar_blaze.ports.audit import AuditLog
from stellar_blaze.ports.config_store import RuntimeConfigStore
from stellar_blaze.ports.corrector import ForecastCorrector
from stellar_blaze.ports.sites import SiteFixture
from stellar_blaze.ports.weather import ObservationSource, WeatherForecastSource

DUBAI = "Asia/Dubai"

type ForecastSourceFactory = Callable[[Settings, httpx2.AsyncClient, RawResponseCache | None], WeatherForecastSource]


class CompositionError(Exception):
    """The process cannot be assembled from its settings and files. Startup fails with it, loudly."""


class ConfigSourceError(CompositionError):
    """The initial runtime config is not usable: pins that prod forbids, a missing seed, or a config that violates the
    ruleset it resolves against. ``violations`` lists what ``validate_runtime_config`` found, if that was the cause."""

    def __init__(self, message: str, violations: tuple[ConfigViolation, ...] = ()) -> None:
        super().__init__(message)
        self.violations = violations


class UnknownAdapterError(CompositionError):
    """A setting names an adapter kind that nobody registered."""


def _open_meteo(
    settings: Settings, client: httpx2.AsyncClient, cache: RawResponseCache | None
) -> WeatherForecastSource:
    return OpenMeteoPreviousRunsSource(
        client,
        settings.open_meteo_previous_runs_url,
        cache,
        pacer=RequestPacer(settings.open_meteo_request_interval_s),
    )


def _replay_dir(settings: Settings) -> Path:
    """The snapshot directory ``Settings`` names (``Settings`` guarantees the id is set when the source is replay)."""
    if settings.replay_snapshot_id is None:
        raise CompositionError("the replay source needs SB_REPLAY_SNAPSHOT_ID")
    return settings.replay_dir / settings.replay_snapshot_id


def _replay(settings: Settings, client: httpx2.AsyncClient, cache: RawResponseCache | None) -> WeatherForecastSource:
    """The replay source: it reads a verified snapshot from disk, so the HTTP client and cache are not used."""
    return ReplayForecastSource(_replay_dir(settings))


# Read-only on purpose: a fake can never be registered into the production path, only passed to build_forecast_source.
FORECAST_SOURCES: Final[Mapping[ForecastSourceKind, ForecastSourceFactory]] = MappingProxyType(
    {"open_meteo": _open_meteo, "replay": _replay}
)


@dataclass(frozen=True)
class Runtime:
    """Everything the process loads at startup: settings, rulesets, models and the holder of the active config.

    The holder starts with the file or env snapshot outside prod, and empty in prod, where the database-active version
    is loaded into it by the application lifespan (``ConfigService.load_active``) and followed by the poller.
    """

    settings: Settings
    rulesets: RulesetCatalog
    models: ModelRegistry
    config: SnapshotHolder


def dubai_today() -> date:
    """The current calendar date in Asia/Dubai (UTC+4, no daylight saving): the date that picks a ruleset."""
    return datetime.now(ZoneInfo(DUBAI)).date()


def _initial_config(settings: Settings) -> tuple[RuntimeConfig, Literal["file", "env"]]:
    """The file seed, with the env pins applied when there are any (a dev or test run, never prod)."""
    seed_path = settings.runtime_config_seed
    if not seed_path.is_file():
        raise ConfigSourceError(f"runtime config seed not found: {seed_path} (SB_RUNTIME_CONFIG_SEED)")
    seed = load_runtime_config_file(seed_path)
    pins: dict[str, str] = {}
    if settings.ruleset_id is not None:
        pins["ruleset_pin"] = settings.ruleset_id
    if settings.model_id is not None:
        pins["model_id"] = settings.model_id
    if not pins:
        return seed, "file"
    return RuntimeConfig.model_validate(seed.model_dump() | pins), "env"


def build_runtime(settings: Settings, *, today: date) -> Runtime:
    """Load the rulesets and models and build the holder of the active config.

    ``today`` is the Asia/Dubai local date (``dubai_today()``). With ``SB_ENV=prod`` drafts are refused, the env pins
    are not accepted (the runtime config is the one source of truth, ADR 0010 section 4.6) and the holder starts empty:
    the active version lives in the database, and the lifespan loads it (a database that is down leaves the holder
    empty, which readiness reports as 503). Outside prod the file seed, with the env pins applied when there are any,
    is validated and becomes the first snapshot: a ``file`` snapshot, which the poller replaces once the database has an
    activation, or an ``env`` snapshot (back-tests and runs without a database), which it never replaces (ADR 0010
    section 4.6).

    Raises:
        ConfigSourceError: A pin is set in prod; or outside prod the seed is missing or the config violates its ruleset
            (the message names every violation, and for an unknown ruleset or model the ids that exist).
        RulesetLoadError: A ruleset file is unusable (``RulesetLockError`` for a changed, unlisted or draft one).
        RulesetCatalogError: The rulesets contradict each other.
        NoRulesetError: No ruleset is in force on ``today`` and none is pinned (in prod: none is in force at all, so no
            config could be valid).
        ModelIntegrityError: A model directory does not match its manifest.
    """
    prod = settings.env == "prod"
    if prod and (settings.ruleset_id is not None or settings.model_id is not None):
        raise ConfigSourceError("SB_RULESET_ID/SB_MODEL_ID are not used in prod; use the runtime config (ADR 0010)")

    catalog = load_catalog(settings.rulesets_dir, allow_drafts=not prod)
    models = scan_models(settings.models_dir)
    if prod:
        catalog.for_local_date(today)  # a day no ruleset covers has no valid config: fail now, not at the first request
        return Runtime(settings=settings, rulesets=catalog, models=models, config=SnapshotHolder())

    config, source = _initial_config(settings)
    violations = validate_runtime_config(config, catalog=catalog, models=models, today=today, prod=prod)
    if violations:
        detail = "; ".join(f"{v.code} at {v.path}: {v.message}" for v in violations)
        raise ConfigSourceError(f"the {source} runtime config is not valid: {detail}", tuple(violations))

    snapshot = ConfigSnapshot(
        version_id=None,
        sha256=config_sha256(config),
        config=config,
        source=source,
        model=models.get(config.model_id) if config.model_id is not None else None,
    )
    return Runtime(settings=settings, rulesets=catalog, models=models, config=SnapshotHolder(snapshot))


def build_config_store(engine: AsyncEngine, settings: Settings) -> RuntimeConfigStore:
    """The Postgres store of config versions and activations over ``engine``. Reads give up after
    ``SB_READINESS_TIMEOUT_S``, the same budget the readiness probe has for one dependency call."""
    return PostgresConfigStore(engine, read_timeout_s=settings.readiness_timeout_s)


def build_audit_log(engine: AsyncEngine) -> AuditLog:
    """The append-only, hash-chained audit log over ``engine`` (ADR 0054)."""
    return PostgresAuditLog(engine)


def build_site_store(engine: AsyncEngine) -> PostgresSiteStore:
    """The site repository, epoch store and fixture store over ``engine`` (one object, three ports)."""
    return PostgresSiteStore(engine)


def load_site_fixture(path: Path) -> SiteFixture:
    """Parse and validate the site fixture TOML at ``path`` (``fixtures/demo_site.toml``, ADR 0057).

    Raises:
        FileNotFoundError: ``path`` does not exist.
        tomllib.TOMLDecodeError: The file is not TOML.
        pydantic.ValidationError: The content is not a ``SiteFixture``.
    """
    return _load_site_fixture(path)


def build_config_service(
    runtime: Runtime,
    store: RuntimeConfigStore,
    *,
    clock: Callable[[], date] = dubai_today,
    audit: AuditLog | None = None,
) -> ConfigService:
    """The service that proposes, activates and loads configs for ``runtime``: its rulesets and models, and its holder
    (an activation made through the service swaps the very snapshot the API serves). ``clock`` is the date validation
    uses, the Asia/Dubai date unless a test says otherwise; the strict pin rules apply with ``SB_ENV=prod``."""
    return ConfigService(
        store, runtime.rulesets, runtime.models, runtime.config, clock, prod=runtime.settings.env == "prod", audit=audit
    )


def load_runtime_config(path: Path) -> RuntimeConfig:
    """Parse and validate the TOML file at ``path`` (the git seed, or an operator's proposal).

    Raises:
        FileNotFoundError: ``path`` does not exist.
        tomllib.TOMLDecodeError: The file is not TOML.
        pydantic.ValidationError: The content is not a ``RuntimeConfig`` (unknown keys, including any attempt to set a
            legal floor, are rejected).
    """
    return load_runtime_config_file(path)


def build_forecast_source(
    settings: Settings,
    client: httpx2.AsyncClient,
    cache: RawResponseCache | None,
    registry: Mapping[ForecastSourceKind, ForecastSourceFactory] = FORECAST_SOURCES,
) -> WeatherForecastSource:
    """The forecast source ``settings.forecast_source`` names, built by the factory registered for it.

    Raises:
        UnknownAdapterError: Nothing is registered for the kind; the message names the registered kinds.
    """
    factory = registry.get(settings.forecast_source)
    if factory is None:
        registered = ", ".join(sorted(registry)) or "(none)"
        raise UnknownAdapterError(
            f"no forecast source is registered for {settings.forecast_source!r}; registered: {registered}"
        )
    return factory(settings, client, cache)


async def _nothing() -> None:
    """The ``Sources.close`` of sources that hold nothing to release."""


@dataclass(frozen=True, slots=True)
class Sources:
    """The upstream data a batch job reads from, and how to release what it holds.

    Attributes:
        observations: Observation sources by name: ``"iem"`` (the truth) and ``"ghcnh"`` (the audit).
        forecasts: The forecast archive ``Settings.forecast_source`` names.
        close: Awaited once the job is done; closes the HTTP client of the real sources.
    """

    observations: Mapping[str, ObservationSource]
    forecasts: WeatherForecastSource
    close: Callable[[], Awaitable[None]] = _nothing


def build_sources(
    settings: Settings, *, registry: Mapping[ForecastSourceKind, ForecastSourceFactory] = FORECAST_SOURCES
) -> Sources:
    """The HTTP client, the raw-response cache and the sources of the ingest jobs.

    The cache lives under ``<data_dir>/bronze/http``. It never expires an entry, so a directory that already holds
    responses is a snapshot of the day they were fetched; start from a fresh ``data_dir`` for a clean rebuild. Call this
    inside the event loop that will use the sources, and await ``Sources.close`` when done.

    With ``forecast_source == "replay"`` the observations are the snapshot's too: ``observations`` holds only ``"iem"``,
    a ``ReplayObservationSource``, so the job code that asks for ``sources.observations["iem"]`` is unchanged and
    nothing reaches the network. (``Sources.observations`` has no ``"ghcnh"`` then: the snapshot carries no audit
    values.)

    Raises:
        UnknownAdapterError: ``settings.forecast_source`` names a kind nobody registered in ``registry``.
        ReplaySnapshotError: A replay snapshot is missing a file or a file's hash differs from its manifest.
    """
    client = build_async_client(settings)
    cache = RawResponseCache(settings.data_dir / "bronze" / "http")
    forecasts = build_forecast_source(settings, client, cache, registry)
    if settings.forecast_source == "replay":
        return Sources(
            observations={"iem": ReplayObservationSource(_replay_dir(settings))},
            forecasts=forecasts,
            close=client.aclose,
        )
    iem = IemMetarSource(client, settings.iem_asos_url, cache, pacer=RequestPacer(settings.iem_request_interval_s))
    ghcnh = GhcnhParquetSource(client, settings.ghcnh_base_url, cache)
    return Sources(
        observations={iem.name: iem, ghcnh.name: ghcnh},
        forecasts=forecasts,
        close=client.aclose,
    )


class CorrectorProvider:
    """The forecast corrector of the active config snapshot, built once per model and reused.

    A snapshot with no model (``model is None``: the file or env seed without a ``model_id``) is served by
    ``FakeCorrector(0.0)``, the uncorrected raw forecast, whose ``model_id`` is ``None`` so every decision row says so
    (ADR 0010). A snapshot that names a released model is served by B2's ``LightGbmCorrector``, loaded from the verified
    model directory the first time it is asked for and kept: loading reads 19 boosters per target, which no request may
    pay. The provider is cheap to keep for the life of the process; a config activation that changes ``model_id`` just
    asks for another key.
    """

    def __init__(self) -> None:
        self._uncorrected = FakeCorrector(0.0)
        self._loaded: dict[str, ForecastCorrector] = {}

    def for_snapshot(self, snapshot: ConfigSnapshot) -> ForecastCorrector:
        """The corrector ``snapshot`` selects.

        Raises:
            FileNotFoundError: The model directory lacks a file of the layout.
            pydantic.ValidationError: A model parameter file is malformed.
            ValueError: The model's parts disagree with each other or with this code (``LightGbmCorrector.load``).
        """
        model = snapshot.model
        if model is None:
            return self._uncorrected
        key = model.manifest.model_id
        corrector = self._loaded.get(key)
        if corrector is None:
            corrector = self._loaded[key] = LightGbmCorrector.load(model)
        return corrector


async def build_api_services(settings: Settings, engine: AsyncEngine) -> tuple[Services, Callable[[], Awaitable[None]]]:
    """The ports of the API routes over ``engine`` and the sources ``settings`` names, and how to release them.

    Call inside the serving event loop (the HTTP client of the live sources belongs to it) and await the returned
    ``close`` once at shutdown. Creating the stores opens no connection. ``SB_FORECAST_SOURCE=replay`` serves the
    snapshot the settings name (``build_sources``: forecasts and observations from the same files, no network).

    Raises:
        UnknownAdapterError, ReplaySnapshotError: As ``build_sources``.
    """
    sources = build_sources(settings)
    sites = build_site_store(engine)
    services = Services(
        sites=sites,
        epochs=sites,
        stops=PostgresCrewStopStore(engine),
        plans=PostgresDayPlanStore(engine),
        signoffs=PostgresPlanSignoffStore(engine),
        audit=build_audit_log(engine),
        forecasts=sources.forecasts,
        observations=sources.observations["iem"],
        correctors=CorrectorProvider(),
    )
    return services, sources.close
