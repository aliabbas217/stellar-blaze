"""Port of the append-only, hash-chained governance audit log (ADR 0054, ADR 0010 section 4.5, ADR 0066).

Every row stores ``prev_hash`` (the previous row's ``row_hash``; 64 zeros for the first) and
``row_hash = sha256(prev_hash + canonical_json(payload))``. The payload is the row without ``id``, ``prev_hash`` and
``row_hash``; it includes ``epoch_id`` (architect ruling R-P: the chain itself records which epoch an event belonged
to; ``null`` for events that have none). The arithmetic lives in ``domain.audit`` (pure); ``row_hash_of`` applies it
to an ``AuditEvent`` at append time. Verification never builds an ``AuditEvent``: it hashes the raw stored values.

``detail`` holds rule ids, codes and counts, never a person: a key that looks like a member field is refused
(``MEMBER_LIKE``, the regex of the API contract test), and floats are refused so that the JSON a row hashes is the JSON
Postgres ``jsonb`` gives back (``jsonb`` is ``numeric``: ``1e22`` would come back as an integer and break the chain).
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final, Literal, Protocol

from pydantic import AwareDatetime, BaseModel, ConfigDict, JsonValue, field_validator

from stellar_blaze.domain.audit import hash_row

# The one list of audit kinds (supplement section 2). `config.auth_failed` has no source until an HTTP admin route
# exists (ADR 0052), so it is not listed.
type AuditKind = Literal[
    "config.version_created",
    "config.activated",
    "config.rollback",
    "config.rejected",
    "input.changed",
    "data_request.refused",
    "access.denied",
    "plan.validator_rejected",
    "plan.planner_failed",
    "plan.signed",
    "crew.stop_started",
    "crew.stop_cleared",
    "demo_reset",
    "demo_reset.refused",
]

# Same pattern as `tests/unit/api/test_openapi_v1_contract.py::MEMBER_LIKE` (Task 0): no per-member name in a log row.
MEMBER_LIKE: Final = re.compile(r"(worker|member|employee|heart|symptom|acclimat|juvenile)", re.IGNORECASE)

AUDIT_LOCK_KEY: Final = 0x5B_A0D1
"""``pg_advisory_xact_lock`` key that serialises appends so the chain has one writer at a time."""

# The kinds a worker may read in the transparency log (ADR 0054 decision 3; ADR 0066 decision 3 adds none).
WORKER_VISIBLE_KINDS: Final[tuple[AuditKind, ...]] = ("data_request.refused",)


class AuditEvent(BaseModel):
    """What happened, to whom it applies, and under which ruleset, model and config (the five identity fields)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    kind: AuditKind
    actor: str
    actor_role: str
    employer_id: str | None = None
    site_id: str | None = None
    epoch_id: int | None = None
    outcome: str
    detail: Mapping[str, JsonValue]
    ruleset_id: str | None = None
    ruleset_sha256: str | None = None
    model_id: str | None = None
    config_version_id: int | None = None
    config_sha256: str | None = None

    @field_validator("detail")
    @classmethod
    def _detail_is_not_about_a_person(cls, detail: Mapping[str, JsonValue]) -> Mapping[str, JsonValue]:
        _check_detail(detail, "detail")
        return detail


def _check_detail(value: JsonValue | Mapping[str, JsonValue], path: str) -> None:
    if isinstance(value, bool) or value is None or isinstance(value, int | str):
        return
    if isinstance(value, float):
        raise ValueError(f"{path}: floats are not allowed in an audit detail (use an integer or a string)")
    if isinstance(value, Mapping):
        for key, item in value.items():
            if MEMBER_LIKE.search(key):
                raise ValueError(f"{path}: the key {key!r} looks like a member field; an audit detail holds no person")
            _check_detail(item, f"{path}.{key}")
        return
    for index, item in enumerate(value):
        _check_detail(item, f"{path}[{index}]")


class AuditRecord(AuditEvent):
    """A stored row: the event plus its place in the chain."""

    id: int
    at: AwareDatetime
    prev_hash: str
    row_hash: str


def row_hash_of(prev_hash: str, event: AuditEvent, at: datetime) -> str:
    """``sha256(prev_hash + canonical_json(payload))`` of ``event`` appended at ``at`` after ``prev_hash``."""
    return hash_row(prev_hash, at, event.model_dump())


@dataclass(frozen=True)
class ChainReport:
    """The outcome of walking the whole chain on one snapshot.

    ``broken_id`` is the first broken row or ``None``. When it is ``None``, ``rows`` is the row count, ``head_id`` the
    id of the newest row (``None`` when empty) and ``head`` its ``row_hash`` (``ZERO_HASH`` when empty): the value to
    record outside the database, because deleting the newest rows leaves a shorter, still consistent chain.
    """

    broken_id: int | None
    rows: int
    head_id: int | None
    head: str


class AuditLog(Protocol):
    """Port of the audit log. Postgres in production, an in-memory fake in tests."""

    async def append(self, event: AuditEvent) -> AuditRecord:
        """Append ``event`` to the chain (serialised: one writer at a time) and return the stored row."""
        ...

    async def site_entries(
        self, site_id: str, kinds: Sequence[AuditKind], limit: int, epoch_id: int
    ) -> Sequence[AuditRecord]:
        """The newest ``limit`` rows of ``site_id`` and ``epoch_id`` whose kind is in ``kinds``, newest first.

        Raises:
            ValueError: ``limit`` is below 1.
        """
        ...

    async def verify(self) -> int | None:
        """Recompute the whole chain: the id of the first broken row, or ``None`` when it is intact.

        Never raises for a tampered row: it hashes the raw stored values.
        """
        ...

    async def chain_report(self) -> ChainReport:
        """Like ``verify``, and also the row count and the head to anchor outside the database (review I3)."""
        ...
