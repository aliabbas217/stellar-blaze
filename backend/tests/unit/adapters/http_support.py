"""Helpers the HTTP adapter tests share (kept apart from the ``test_*`` modules so they are imported, not collected)."""

from pathlib import Path

import httpx2


def forbidden(request: httpx2.Request) -> httpx2.Response:
    """A ``MockTransport`` handler for a test in which any network call is a failure."""
    raise AssertionError(f"unexpected network call: {request.method} {request.url}")


def cached_files(root: Path) -> list[Path]:
    """Every file under a ``RawResponseCache`` root (a cache that stored nothing has none)."""
    return [path for path in root.rglob("*") if path.is_file()]
