"""The Alembic ``Config`` the tests drive in process (``command.upgrade`` and friends)."""

import io
from pathlib import Path

from alembic.config import Config

from stellar_blaze.config import Settings

BACKEND_DIR = Path(__file__).resolve().parents[1]


def alembic_config(settings: Settings) -> Config:
    """A config for ``backend/alembic.ini`` that migrates the database in ``settings``.

    ``env.py`` takes the settings from ``config.attributes`` instead of the process environment, so a test never
    mutates ``os.environ``; ``configure_logger`` stops ``env.py`` from reconfiguring the root logger mid-test, and the
    private ``stdout`` keeps ``alembic check``'s "No new upgrade operations detected." out of the test output.
    """
    config = Config(str(BACKEND_DIR / "alembic.ini"), stdout=io.StringIO())
    config.attributes["settings"] = settings
    config.attributes["configure_logger"] = False
    return config
