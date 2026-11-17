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


@pytest.fixture(autouse=True)
def _plain_cli_output(monkeypatch: pytest.MonkeyPatch) -> None:
    """Give every CLI test plain text, wherever it runs.

    Typer forces ANSI colour when ``GITHUB_ACTIONS``, ``FORCE_COLOR`` or ``PY_COLORS`` is set
    (``typer.rich_utils.FORCE_TERMINAL``, read when a help or usage message is drawn). Rich then splits an option such
    as ``--part`` into differently styled pieces, so a test that looks for the word in the message passes on a laptop
    and fails on a CI runner. The tests assert on words, not on styling, so the setting that depends on the environment
    is switched off for all of them.
    """
    import typer.rich_utils

    monkeypatch.setattr(typer.rich_utils, "FORCE_TERMINAL", False)
