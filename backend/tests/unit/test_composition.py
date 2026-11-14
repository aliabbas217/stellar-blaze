"""The composition root: the only place that turns settings into rulesets, models, the config snapshot and adapters."""

import json
import shutil
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, get_args

import pytest
import time_machine
from pydantic import SecretStr

from stellar_blaze.adapters.config.rulesets import RulesetLockError
from stellar_blaze.adapters.db.config_store import PostgresConfigStore
from stellar_blaze.adapters.db.engine import build_engine
from stellar_blaze.adapters.fakes.config_store import InMemoryConfigStore
from stellar_blaze.adapters.fakes.weather import InMemoryForecastSource
from stellar_blaze.adapters.http.client import build_async_client
from stellar_blaze.adapters.sources.open_meteo import OpenMeteoPreviousRunsSource
from stellar_blaze.application.runtime_config import ConfigUnavailableError
from stellar_blaze.composition import (
    FORECAST_SOURCES,
    ConfigSourceError,
    Runtime,
    UnknownAdapterError,
    build_config_service,
    build_config_store,
    build_forecast_source,
    build_runtime,
    dubai_today,
    load_runtime_config,
)
from stellar_blaze.config import ForecastSourceKind, Settings
from stellar_blaze.domain.config.runtime import RuntimeConfig, config_sha256
from stellar_blaze.domain.rules.catalog import NoRulesetError
from tests.unit.rules.support import BACKEND_ROOT, RULESETS_DIR

pytestmark = pytest.mark.unit

FIXTURE_MODELS = BACKEND_ROOT / "tests" / "fixtures" / "models"
FIRST = "corrector-20261111-0000000-000000"
SECOND = "corrector-20261112-0000000-000001"
TODAY = date(2026, 11, 11)
PROD_PINS_MESSAGE = "SB_RULESET_ID/SB_MODEL_ID are not used in prod; use the runtime config (ADR 0010)"


def make_settings(**overrides: Any) -> Settings:
    fields: dict[str, Any] = {
        "env": "test",
        "log_format": "json",
        "database_url": SecretStr("postgresql+asyncpg://sb:sb@localhost:5432/stellar_blaze"),
        "rulesets_dir": RULESETS_DIR,
        "models_dir": FIXTURE_MODELS,
        "runtime_config_seed": BACKEND_ROOT / "config" / "runtime" / "default.toml",
    }
    fields.update(overrides)
    return Settings(_env_file=None, **fields)


# --- build_runtime -----------------------------------------------------------------------------------------------


def test_defaults_build_the_seed_catalog_and_a_file_snapshot() -> None:
    settings = make_settings()
    runtime = build_runtime(settings, today=TODAY)
    assert isinstance(runtime, Runtime)
    assert runtime.settings is settings
    assert runtime.rulesets.ids() == ("ae-heat-0.1", "ae-heat-2026.1")
    assert runtime.models.ids() == (FIRST, SECOND)
    snapshot = runtime.config.current()
    assert snapshot.source == "file"
    assert snapshot.version_id is None
    assert snapshot.config == RuntimeConfig()
    assert snapshot.config.model_id is None
    assert snapshot.model is None
    assert snapshot.sha256 == config_sha256(RuntimeConfig())


def test_the_runtime_is_immutable() -> None:
    runtime = build_runtime(make_settings(), today=TODAY)
    with pytest.raises(AttributeError):
        runtime.settings = make_settings()  # type: ignore[misc]


def test_a_dev_model_pin_becomes_an_env_snapshot_with_that_model_loaded() -> None:
    runtime = build_runtime(make_settings(env="dev", model_id=SECOND), today=TODAY)
    snapshot = runtime.config.current()
    assert snapshot.source == "env"
    assert snapshot.version_id is None
    assert snapshot.config.model_id == SECOND
    assert snapshot.model is not None
    assert snapshot.model.manifest.model_id == SECOND
    assert snapshot.model.root == FIXTURE_MODELS / SECOND
    assert snapshot.sha256 == config_sha256(snapshot.config)
    assert snapshot.sha256 != config_sha256(RuntimeConfig())


def test_a_dev_ruleset_pin_becomes_an_env_snapshot() -> None:
    # ae-heat-0.1 cannot be pinned any more: it declares none of the B3 tunables, so no config resolves against it.
    snapshot = build_runtime(make_settings(env="dev", ruleset_id="ae-heat-2026.1"), today=TODAY).config.current()
    assert snapshot.source == "env"
    assert snapshot.config.ruleset_pin == "ae-heat-2026.1"
    assert snapshot.model is None


def test_the_env_pins_override_the_file_seed(tmp_path: Path) -> None:
    seed = tmp_path / "seed.toml"
    seed.write_text(
        'schema_version = 1\nmodel_id = "' + FIRST + '"\n[tunables]\ntwl_margin_w_m2 = 7.0\n[flags]\n', encoding="utf-8"
    )
    snapshot = build_runtime(make_settings(runtime_config_seed=seed, model_id=SECOND), today=TODAY).config.current()
    assert snapshot.config.model_id == SECOND
    assert snapshot.config.tunables.twl_margin_w_m2 == 7.0  # the seed's other values survive
    assert snapshot.source == "env"


def test_a_seed_with_values_and_no_pins_is_a_file_snapshot(tmp_path: Path) -> None:
    seed = tmp_path / "seed.toml"
    seed.write_text(
        'schema_version = 1\nmodel_id = "' + FIRST + '"\n[tunables]\ntwl_margin_w_m2 = 7.0\n[flags]\n', encoding="utf-8"
    )
    snapshot = build_runtime(make_settings(runtime_config_seed=seed), today=TODAY).config.current()
    assert snapshot.source == "file"
    assert snapshot.config.tunables.twl_margin_w_m2 == 7.0
    assert snapshot.model is not None
    assert snapshot.model.manifest.model_id == FIRST


@pytest.mark.parametrize(
    "pins",
    [{"ruleset_id": "ae-heat-0.1"}, {"model_id": SECOND}, {"ruleset_id": "ae-heat-0.1", "model_id": SECOND}],
    ids=["ruleset", "model", "both"],
)
def test_prod_refuses_the_env_pins(pins: dict[str, str]) -> None:
    with pytest.raises(ConfigSourceError) as raised:
        build_runtime(make_settings(env="prod", **pins), today=TODAY)
    assert str(raised.value) == PROD_PINS_MESSAGE


def test_prod_starts_with_an_empty_holder_because_the_database_is_the_source_of_truth() -> None:
    runtime = build_runtime(make_settings(env="prod"), today=TODAY)
    assert runtime.config.peek() is None
    with pytest.raises(ConfigUnavailableError):
        runtime.config.current()
    # The rulesets and models are still loaded and verified: the DB-active config is validated against them.
    assert runtime.rulesets.ids() == ("ae-heat-0.1", "ae-heat-2026.1")
    assert runtime.models.ids() == (FIRST, SECOND)


def test_prod_does_not_read_the_file_seed_at_startup(tmp_path: Path) -> None:
    # `sb-jobs config seed` reads it (in the migration job); the API in prod never does.
    runtime = build_runtime(make_settings(env="prod", runtime_config_seed=tmp_path / "nowhere.toml"), today=TODAY)
    assert runtime.config.peek() is None


def test_prod_still_fails_startup_on_a_day_no_ruleset_covers() -> None:
    # No valid config can exist then (a prod pin must cover today), so starting would only defer the failure.
    with pytest.raises(NoRulesetError, match="2023-12-31"):
        build_runtime(make_settings(env="prod"), today=date(2023, 12, 31))


def test_prod_refuses_a_draft_ruleset_but_dev_loads_it(tmp_path: Path) -> None:
    directory = tmp_path / "rulesets"
    shutil.copytree(RULESETS_DIR, directory)
    path = directory / "ae-heat-2026.1.toml"
    path.write_bytes(path.read_bytes().replace(b'status = "released"', b'status = "draft"'))
    lock = json.loads((directory / "lock.json").read_text(encoding="utf-8"))
    del lock["ae-heat-2026.1"]  # a draft is not locked; the seed stays released
    (directory / "lock.json").write_text(json.dumps(lock), encoding="utf-8")
    with pytest.raises(RulesetLockError, match="draft"):
        build_runtime(make_settings(env="prod", rulesets_dir=directory), today=TODAY)
    assert build_runtime(make_settings(env="dev", rulesets_dir=directory), today=TODAY).rulesets.ids() == (
        "ae-heat-0.1",
        "ae-heat-2026.1",
    )


def test_an_unknown_ruleset_pin_fails_startup_naming_the_known_ids() -> None:
    with pytest.raises(ConfigSourceError, match=r"unknown-ruleset.*nope.*ae-heat-0\.1"):
        build_runtime(make_settings(env="dev", ruleset_id="nope"), today=TODAY)


def test_an_unknown_model_pin_fails_startup_naming_the_known_ids() -> None:
    with pytest.raises(ConfigSourceError, match=rf"unknown-model.*{FIRST}.*{SECOND}"):
        build_runtime(make_settings(env="dev", model_id="corrector-20990101-0000000-000000"), today=TODAY)


def test_a_seed_that_breaks_its_ruleset_range_fails_startup(tmp_path: Path) -> None:
    seed = tmp_path / "seed.toml"
    seed.write_text("schema_version = 1\n[tunables]\ntwl_margin_w_m2 = 25.0\n[flags]\n", encoding="utf-8")
    with pytest.raises(ConfigSourceError, match=r"out-of-range.*tunables\.twl_margin_w_m2") as raised:
        build_runtime(make_settings(runtime_config_seed=seed), today=TODAY)
    assert [v.code for v in raised.value.violations] == ["out-of-range"]


def test_a_missing_seed_file_fails_startup_naming_the_setting(tmp_path: Path) -> None:
    with pytest.raises(ConfigSourceError, match="SB_RUNTIME_CONFIG_SEED"):
        build_runtime(make_settings(runtime_config_seed=tmp_path / "nowhere.toml"), today=TODAY)


def test_a_day_no_ruleset_covers_fails_startup() -> None:
    with pytest.raises(NoRulesetError, match="2023-12-31"):
        build_runtime(make_settings(), today=date(2023, 12, 31))


def test_dubai_today_is_the_asia_dubai_calendar_date() -> None:
    with time_machine.travel(datetime(2026, 11, 11, 19, 59, 59, tzinfo=UTC), tick=False):
        assert dubai_today() == date(2026, 11, 11)  # 23:59:59 in Dubai
    with time_machine.travel(datetime(2026, 11, 11, 20, 0, 0, tzinfo=UTC), tick=False):
        assert dubai_today() == date(2026, 11, 12)  # midnight in Dubai (UTC+4, no daylight saving)


# --- forecast sources --------------------------------------------------------------------------------------------


def test_open_meteo_and_replay_are_registered() -> None:
    assert set(FORECAST_SOURCES) == {"open_meteo", "replay"}  # replay moved from B3 to B2 (Task 13)


def test_the_production_registry_is_read_only() -> None:
    # A fake cannot be registered into the production path by a test, a plugin or a typo: only passed in.
    with pytest.raises(TypeError):
        FORECAST_SOURCES["fake"] = lambda *_: InMemoryForecastSource({})  # type: ignore[index]


def test_the_registry_keys_are_kinds_settings_accepts() -> None:
    kinds = set(get_args(ForecastSourceKind.__value__))
    assert kinds == {"open_meteo", "replay"}
    assert set(FORECAST_SOURCES) == kinds
    # Settings uses the very same alias: there is one definition (config.py).
    annotation: object = Settings.model_fields["forecast_source"].annotation
    assert annotation is ForecastSourceKind


@pytest.mark.asyncio
async def test_open_meteo_builds_the_real_source() -> None:
    settings = make_settings()
    client = build_async_client(settings)
    try:
        source = build_forecast_source(settings, client, None)
    finally:
        await client.aclose()
    assert isinstance(source, OpenMeteoPreviousRunsSource)


@pytest.mark.asyncio
async def test_an_unregistered_kind_names_the_registered_ones() -> None:
    settings = make_settings(forecast_source="replay", replay_snapshot_id="demo-2026")
    client = build_async_client(settings)
    try:
        with pytest.raises(UnknownAdapterError, match=r"replay.*open_meteo"):
            build_forecast_source(settings, client, None, {"open_meteo": FORECAST_SOURCES["open_meteo"]})
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_a_registry_passed_in_wins_so_fakes_enter_only_through_tests() -> None:
    settings = make_settings()
    client = build_async_client(settings)
    fake = InMemoryForecastSource({})
    registered = FORECAST_SOURCES["open_meteo"]
    try:
        source = build_forecast_source(settings, client, None, {"open_meteo": lambda *_: fake})
        real = build_forecast_source(settings, client, None)
    finally:
        await client.aclose()
    assert source is fake
    # Passing a registry replaces nothing: the module registry still builds the real adapter.
    assert FORECAST_SOURCES["open_meteo"] is registered
    assert isinstance(real, OpenMeteoPreviousRunsSource)


# --- the config store, the service and the seed file ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_config_store_is_postgres_over_the_given_engine() -> None:
    settings = make_settings()
    engine = build_engine(settings)  # opens no connection
    try:
        assert isinstance(build_config_store(engine, settings), PostgresConfigStore)
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize(("env", "prod"), [("dev", False), ("test", False), ("prod", True)])
async def test_the_config_service_shares_the_runtimes_holder_and_is_strict_in_prod_only(env: str, prod: bool) -> None:
    runtime = build_runtime(make_settings(env=env), today=TODAY)
    service = build_config_service(runtime, InMemoryConfigStore(), clock=lambda: TODAY)
    assert service.prod is prod

    version = await service.propose(RuntimeConfig(), "ali", "composition test run")
    await service.activate(version.id, None, "ali", "composition test run")

    assert runtime.config.current().version_id == version.id  # the very holder the API serves from


@pytest.mark.asyncio
async def test_the_config_service_clock_defaults_to_the_asia_dubai_date() -> None:
    runtime = build_runtime(make_settings(env="prod"), today=TODAY)
    service = build_config_service(runtime, InMemoryConfigStore())
    # 2023-12-31 in Dubai: no ruleset covers it, which the validation reports loudly rather than defaulting.
    with (
        time_machine.travel(datetime(2023, 12, 31, 19, 0, tzinfo=UTC), tick=False),
        pytest.raises(NoRulesetError, match="2023-12-31"),
    ):
        service.validate(RuntimeConfig())


def test_load_runtime_config_parses_and_validates_a_toml_file(tmp_path: Path) -> None:
    path = tmp_path / "proposal.toml"
    path.write_text("schema_version = 1\n[tunables]\ntwl_margin_w_m2 = 7.0\n[flags]\n", encoding="utf-8")

    assert load_runtime_config(path).tunables.twl_margin_w_m2 == 7.0
    assert load_runtime_config(BACKEND_ROOT / "config" / "runtime" / "default.toml") == RuntimeConfig()
