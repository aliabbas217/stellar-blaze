"""The hash-chain arithmetic of the governance audit log (ADR 0054, ADR 0010 section 4.5), pure and stdlib-only.

Every row stores ``prev_hash`` (the previous row's ``row_hash``; ``ZERO_HASH`` for the first) and
``row_hash = sha256(prev_hash + canonical_json(payload))``. The payload is the row without ``id``, ``prev_hash`` and
``row_hash``; it includes ``epoch_id`` (architect ruling R-P). The formula exists once, here; the port, the Postgres
adapter and the in-memory fake all call it.

Verification works on RAW stored values (a ``Mapping`` per row), never on a validated ``AuditEvent``: a row edited with
the trigger dropped may hold a kind that does not exist, a float or a member-like key, and ``verify`` must name that row
instead of raising (review I1).
"""

import hashlib
import json
from collections.abc import Iterable, Mapping
from datetime import UTC, datetime
from typing import Final

ZERO_HASH: Final = "0" * 64

HASHED_FIELDS: Final[tuple[str, ...]] = (
    "kind",
    "actor",
    "actor_role",
    "employer_id",
    "site_id",
    "epoch_id",
    "outcome",
    "detail",
    "ruleset_id",
    "ruleset_sha256",
    "model_id",
    "config_version_id",
    "config_sha256",
)
"""The columns of a row whose values are hashed (with ``at``); everything but ``id``, ``prev_hash``, ``row_hash``."""


def format_instant(at: datetime) -> str:
    """The one text form of an instant inside the hashed payload: UTC, microseconds, ``Z``."""
    return at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def canonical_json(at: datetime, fields: Mapping[str, object]) -> str:
    """The canonical JSON a row hash covers: sorted keys, compact separators, ASCII.

    Raises:
        KeyError: ``fields`` lacks a hashed column.
        TypeError: a value is not JSON-serializable.
        ValueError: a value is out of range for JSON (for example a circular structure).
    """
    payload = {"at": format_instant(at), **{name: fields[name] for name in HASHED_FIELDS}}
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def hash_row(prev_hash: str, at: datetime, fields: Mapping[str, object]) -> str:
    """``sha256(prev_hash + canonical_json(payload))`` as lower-case hex."""
    return hashlib.sha256((prev_hash + canonical_json(at, fields)).encode()).hexdigest()


def link_holds(row: Mapping[str, object], previous_hash: str) -> bool:
    """Whether the raw ``row`` links to ``previous_hash`` and its ``row_hash`` is the hash of its own stored content.

    Never raises for a malformed row: whatever cannot be hashed does not hold.
    """
    if row.get("prev_hash") != previous_hash:
        return False
    at = row.get("at")
    if not isinstance(at, datetime) or at.tzinfo is None:
        return False
    try:
        return row.get("row_hash") == hash_row(previous_hash, at, row)
    except (KeyError, TypeError, ValueError, RecursionError, OverflowError):
        return False


def first_broken(rows: Iterable[tuple[int, Mapping[str, object]]]) -> int | None:
    """The id of the first ``(id, raw row)`` (ascending ids) whose hash or link does not hold; ``None`` if intact."""
    previous = ZERO_HASH
    for row_id, row in rows:
        if not link_holds(row, previous):
            return row_id
        previous = str(row["row_hash"])
    return None
