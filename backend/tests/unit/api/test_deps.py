import pytest
from fastapi.testclient import TestClient

from stellar_blaze.api.app import create_app
from stellar_blaze.api.deps import EngineDep, SettingsDep
from stellar_blaze.config import Settings


@pytest.mark.unit
def test_settings_dependency_returns_the_settings_given_to_create_app(settings: Settings) -> None:
    app = create_app(settings)

    @app.get("/test/env")
    async def env(injected: SettingsDep) -> dict[str, str]:
        return {"env": injected.env, "git_sha": injected.git_sha}

    # The module-level get_settings() would raise here (no SB_DATABASE_URL in the environment), so this also proves
    # the dependency reads the app's own settings.
    assert TestClient(app).get("/test/env").json() == {"env": "test", "git_sha": "unknown"}


@pytest.mark.unit
def test_engine_dependency_is_the_engine_the_lifespan_created(settings: Settings) -> None:
    app = create_app(settings)

    @app.get("/test/engine")
    async def engine_route(engine: EngineDep) -> dict[str, bool]:
        return {"same": engine is app.state.engine}

    with TestClient(app) as client:
        assert client.get("/test/engine").json() == {"same": True}


@pytest.mark.unit
def test_engine_dependency_explains_a_missing_lifespan(settings: Settings) -> None:
    app = create_app(settings)

    @app.get("/test/engine")
    async def engine_route(engine: EngineDep) -> dict[str, str]:
        return {"dialect": engine.dialect.name}

    # Without `with TestClient(app)` the lifespan never runs, so there is no engine; say why instead of AttributeError.
    with pytest.raises(RuntimeError, match="lifespan"):
        TestClient(app).get("/test/engine")
