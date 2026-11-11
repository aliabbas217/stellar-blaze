"""A content-blind, on-disk cache of raw HTTP response bodies.

It stores the bytes an upstream service sent, keyed by the request, so a repeated dataset build does not download the
same archive twice. It never expires an entry: the owner of the directory decides when a snapshot is stale by choosing
or removing the directory.
"""

import hashlib
import json
import os
import re
import tempfile
from collections.abc import Sequence
from pathlib import Path

_KEY = re.compile(r"[0-9a-f]{64}")


class RawResponseCache:
    """Response bodies under ``root/<key[:2]>/<key>.bin``, written atomically."""

    def __init__(self, root: Path) -> None:
        self._root = root

    @staticmethod
    def key(url: str, params: Sequence[tuple[str, str]]) -> str:
        """Return the SHA-256 hex digest that identifies a request.

        Params keep their order and their repeats (``data=tmpf&data=dwpf`` is not ``data=dwpf&data=tmpf``): the order is
        part of what was asked, and upstream services may treat it as such. The pairs are serialized as JSON, so no
        value can run into the next name.
        """
        canonical = json.dumps([url, [[name, value] for name, value in params]], separators=(",", ":"))
        return hashlib.sha256(canonical.encode()).hexdigest()

    def get(self, key: str) -> bytes | None:
        """Return the stored body, or ``None`` when the request was never stored.

        Raises:
            ValueError: ``key`` is not a SHA-256 hex digest (it would otherwise be a path).
        """
        try:
            return self._path(key).read_bytes()
        except FileNotFoundError:
            return None

    def put(self, key: str, body: bytes) -> Path:
        """Store ``body`` under ``key``, replacing any earlier entry, and return its path.

        The body goes to a temporary file in the same directory, is flushed to disk, and then renamed over the final
        name, so a reader (or a crash) sees the old entry or the new one, never half of one.

        Raises:
            ValueError: ``key`` is not a SHA-256 hex digest.
            OSError: The entry could not be written; no partial file is left behind.
        """
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary: Path | None = None
        try:
            with tempfile.NamedTemporaryFile("wb", dir=path.parent, suffix=".tmp", delete=False) as handle:
                temporary = Path(handle.name)
                handle.write(body)
                handle.flush()
                os.fsync(handle.fileno())
            temporary.replace(path)  # the commit point; the handle is closed, which Windows requires before a rename
        except BaseException:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
            raise
        return path

    def _path(self, key: str) -> Path:
        if not _KEY.fullmatch(key):
            raise ValueError(f"cache key must be a sha-256 hex digest from RawResponseCache.key, got {key!r}")
        return self._root / key[:2] / f"{key}.bin"
