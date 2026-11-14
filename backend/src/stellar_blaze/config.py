"""Typed process configuration: every ``SB_*`` environment variable, validated once.

Only ``composition`` turns these values into implementations; nothing else branches on them (ADR 0009 section 2).
The one deliberate exception to "config only through ``SB_*``" is the standard
``OTEL_EXPORTER_OTLP_ENDPOINT`` variable, which ``tracing`` reads directly.
"""

from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from stellar_blaze import __version__
from stellar_blaze.domain.weather.replay import SnapshotId

# The kinds of forecast source `composition` knows how to ask for. Defined once here; `composition.FORECAST_SOURCES`
# registers the factories, `replay` included (B2, `adapters.sources.replay`; ADR 0009 section 4).
type ForecastSourceKind = Literal["open_meteo", "replay"]


class Settings(BaseSettings):
    """Process configuration, read from ``SB_*`` environment variables and an optional ``.env`` file."""

    # env_ignore_empty: `SB_RULESET_ID=` (as left by copying .env.example) means "not set", never "pin the empty id".
    model_config = SettingsConfigDict(
        env_prefix="SB_", env_file=".env", extra="ignore", frozen=True, env_ignore_empty=True
    )

    env: Literal["dev", "test", "prod"] = "dev"
    # Release identity, set by the deploy (I1) in the container's environment, not stamped into the image, so logs and
    # traces name the exact code that ran; "unknown" outside a release.
    git_sha: str = "unknown"
    database_url: SecretStr
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    log_format: Literal["json", "console"] = "json"
    data_dir: Path = Path("data")

    # Outbound HTTP.
    http_timeout_s: float = 60.0
    http_user_agent: str = f"stellar-blaze/{__version__}"
    open_meteo_previous_runs_url: str = "https://previous-runs-api.open-meteo.com/v1/forecast"
    iem_asos_url: str = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"
    ghcnh_base_url: str = "https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/access/by-year"
    # Seconds between the starts of two requests that reach one service (a cache hit is no request); 0 turns pacing off.
    # IEM answered 429 to four requests in a few seconds. Open-Meteo's free tier allows 600 weighted calls a minute and
    # one 139-day request for 6 variables at 8 leads weighs about 48 (139/14 x 48/10, the formula of
    # docs/research/scripts/fetch_forecast_stations.py), so 6 s keeps it near 480.
    iem_request_interval_s: float = Field(default=2.0, ge=0.0, allow_inf_nan=False)
    open_meteo_request_interval_s: float = Field(default=6.0, ge=0.0, allow_inf_nan=False)

    # Health checks and heat-strain computation budgets. `readiness_timeout_s` is the budget of one dependency call, so
    # it also bounds every read of the runtime-config store: the startup load, each poll, and `sb-jobs config`.
    readiness_timeout_s: float = 2.0
    phs_timeout_s: float = 10.0

    # Evolvability (ADR 0009 sections 1, 3, 4; ADR 0010). Selecting a source nobody registered fails in `composition`
    # at startup, not here.
    forecast_source: ForecastSourceKind = "open_meteo"
    # The replay forecast source reads `<replay_dir>/<replay_snapshot_id>/`, a hashed snapshot built by
    # `sb-jobs replay build`. The id names a directory, so it must be a lowercase slug; it is required with `replay`.
    replay_dir: Path = Path("replay")
    replay_snapshot_id: SnapshotId | None = None
    # The site-local date the API serves when a request names none, in replay mode (the demo's "today", ADR 0057).
    replay_default_date: date | None = None
    # Pins for back-tests and database-less development runs only: `composition` refuses them with SB_ENV=prod, where
    # the runtime config is the one source of truth (ADR 0010 section 4.6). While one is set the snapshot is an `env`
    # one, and the config poller never replaces it with a database activation (it logs that once).
    ruleset_id: str | None = None  # None resolves the ruleset by date
    model_id: str | None = None  # None serves the uncorrected forecast
    rulesets_dir: Path = Path("rulesets")
    models_dir: Path = Path("models")
    # The git default of the runtime config. `sb-jobs config seed` writes it to the database as the first version;
    # outside prod it is also the initial snapshot until the poller finds a database activation (ADR 0010 section 3).
    runtime_config_seed: Path = Path("config/runtime/default.toml")
    # How often each process reads the latest config activation from the database. Under 1 s would hammer the database
    # for no benefit; over 60 s is no longer "without a restart" (ADR 0010 section 6).
    config_poll_interval_s: float = Field(default=5.0, ge=1.0, le=60.0, allow_inf_nan=False)

    @model_validator(mode="after")
    def _replay_needs_a_snapshot(self) -> Self:
        if self.forecast_source == "replay" and self.replay_snapshot_id is None:
            msg = (
                "forecast_source='replay' needs a snapshot: set SB_REPLAY_SNAPSHOT_ID (a directory under SB_REPLAY_DIR)"
            )
            raise ValueError(msg)
        return self

    @model_validator(mode="after")
    def _prod_logs_are_machine_readable(self) -> Self:
        if self.env == "prod" and self.log_format == "console":
            msg = "log_format='console' is for local development; production must log JSON (SB_LOG_FORMAT=json)"
            raise ValueError(msg)
        return self


@lru_cache
def get_settings() -> Settings:
    """Process-wide settings, read from the environment on first use."""
    return Settings()
