import os

import pytest


@pytest.fixture(autouse=True)
def _clean_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep the developer's shell from leaking configuration into any test tier.

    Every ``SB_*`` variable and the OTLP endpoint are removed before each test; a test that needs one sets it itself.
    """
    for name in list(os.environ):
        if name.startswith("SB_") or name == "OTEL_EXPORTER_OTLP_ENDPOINT":
            monkeypatch.delenv(name)
