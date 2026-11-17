from pathlib import Path

import pytest

from stellar_blaze.api.app import create_app
from stellar_blaze.api.export_openapi import render_openapi
from stellar_blaze.config import Settings

SNAPSHOT = Path(__file__).resolve().parents[3] / "openapi" / "v1.json"
REGENERATE = "uv run python -m stellar_blaze.api.export_openapi openapi/v1.json  (run from backend/)"


@pytest.mark.unit
def test_openapi_snapshot_is_current(settings: Settings) -> None:
    # Bytes, not text: the committed file must be LF with a trailing newline (the spec F2 generates its client from).
    actual = render_openapi(create_app(settings).openapi())
    expected = SNAPSHOT.read_bytes().decode("utf-8")
    assert actual == expected, f"backend/openapi/v1.json is stale. Regenerate it with: {REGENERATE}"
    assert expected.endswith("}\n")
    assert "\r" not in expected
