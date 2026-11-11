import re
from pathlib import Path

import pytest
from pydantic import SecretStr, ValidationError

from stellar_blaze import __version__
from stellar_blaze.config import Settings, get_settings

DATABASE_URL = "postgresql+asyncpg://sb:sb@localhost:5432/stellar_blaze"
BACKEND_ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.unit
def test_settings_reads_sb_prefixed_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SB_DATABASE_URL", DATABASE_URL)
    monkeypatch.setenv("SB_ENV", "test")
    settings = Settings(_env_file=None)
    assert settings.env == "test"
    assert settings.database_url.get_secret_value() == DATABASE_URL


@pytest.mark.unit
def test_database_url_is_required() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


@pytest.mark.unit
def test_database_url_is_not_leaked_by_repr() -> None:
    settings = Settings(database_url=SecretStr(DATABASE_URL), _env_file=None)
    assert DATABASE_URL not in repr(settings)
    assert "sb:sb" not in repr(settings)


@pytest.mark.unit
def test_settings_rejects_console_logs_in_prod() -> None:
    with pytest.raises(ValidationError):
        Settings(env="prod", log_format="console", database_url=SecretStr(DATABASE_URL), _env_file=None)


@pytest.mark.unit
def test_prod_accepts_json_logs() -> None:
    settings = Settings(env="prod", log_format="json", database_url=SecretStr(DATABASE_URL), _env_file=None)
    assert settings.env == "prod"


@pytest.mark.unit
def test_flag_defaults_and_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SB_DATABASE_URL", DATABASE_URL)
    defaults = Settings(_env_file=None)
    assert defaults.forecast_source == "open_meteo"
    assert defaults.ruleset_id is None
    assert defaults.model_id is None

    monkeypatch.setenv("SB_FORECAST_SOURCE", "replay")
    assert Settings(_env_file=None).forecast_source == "replay"

    monkeypatch.setenv("SB_FORECAST_SOURCE", "bogus")
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


@pytest.mark.unit
def test_empty_pins_mean_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    # A copied .env.example with an uncommented, empty pin must not pin the empty string.
    monkeypatch.setenv("SB_DATABASE_URL", DATABASE_URL)
    monkeypatch.setenv("SB_RULESET_ID", "")
    monkeypatch.setenv("SB_MODEL_ID", "")
    settings = Settings(_env_file=None)
    assert settings.ruleset_id is None
    assert settings.model_id is None


@pytest.mark.unit
def test_git_sha_defaults_to_unknown_and_reads_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SB_DATABASE_URL", DATABASE_URL)
    assert Settings(_env_file=None).git_sha == "unknown"
    monkeypatch.setenv("SB_GIT_SHA", "abc1234")
    assert Settings(_env_file=None).git_sha == "abc1234"


@pytest.mark.unit
def test_user_agent_carries_the_package_version(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SB_DATABASE_URL", DATABASE_URL)
    assert Settings(_env_file=None).http_user_agent == f"stellar-blaze/{__version__}"


@pytest.mark.unit
def test_get_settings_is_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SB_DATABASE_URL", DATABASE_URL)
    get_settings.cache_clear()
    try:
        assert get_settings() is get_settings()
    finally:
        get_settings.cache_clear()


@pytest.mark.unit
def test_env_example_lists_every_setting() -> None:
    # A setting added without a .env.example line is invisible to whoever configures the next environment.
    text = (BACKEND_ROOT / ".env.example").read_text(encoding="utf-8")
    listed = set(re.findall(r"^#? ?SB_([A-Z0-9_]+)=", text, flags=re.MULTILINE))
    declared = {name.upper() for name in Settings.model_fields}
    assert listed == declared


@pytest.mark.unit
def test_runtime_config_seed_defaults_to_the_file_the_image_ships(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SB_DATABASE_URL", DATABASE_URL)
    assert Settings(_env_file=None).runtime_config_seed == Path("config/runtime/default.toml")
    monkeypatch.setenv("SB_RUNTIME_CONFIG_SEED", "/etc/sb/seed.toml")
    assert Settings(_env_file=None).runtime_config_seed == Path("/etc/sb/seed.toml")
