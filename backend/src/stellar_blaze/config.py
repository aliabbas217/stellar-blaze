"""Typed process configuration: every ``SB_*`` environment variable, validated once.

Only ``composition`` turns these values into implementations; nothing else branches on them (ADR 0009 section 2).
The one deliberate exception to "config only through ``SB_*``" is the standard
``OTEL_EXPORTER_OTLP_ENDPOINT`` variable, which ``tracing`` reads directly.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from stellar_blaze import __version__

# The kinds of forecast source `composition` knows how to ask for. Defined once here; `composition.FORECAST_SOURCES`
# registers the factories, and `replay` is registered in B3 (ADR 0009 section 4).
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

    # Health checks and heat-strain computation budgets.
    readiness_timeout_s: float = 2.0
    phs_timeout_s: float = 10.0

    # Evolvability (ADR 0009 sections 1, 3, 4; ADR 0010). `replay` is registered in B3; selecting a source nobody
    # registered fails in `composition` at startup, not here.
    forecast_source: ForecastSourceKind = "open_meteo"
    # Pins for back-tests and database-less development runs only: `composition` refuses them with SB_ENV=prod, where
    # the runtime config is the one source of truth (ADR 0010 section 4.6).
    ruleset_id: str | None = None  # None resolves the ruleset by date
    model_id: str | None = None  # None serves the uncorrected forecast
    rulesets_dir: Path = Path("rulesets")
    models_dir: Path = Path("models")
    # The git default of the runtime config: the initial snapshot until a database-active version exists (Task 7B).
    runtime_config_seed: Path = Path("config/runtime/default.toml")

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
