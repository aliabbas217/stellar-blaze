import pytest
from fastapi.testclient import TestClient

from stellar_blaze.api.app import create_app
from stellar_blaze.api.deps import SettingsDep
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
