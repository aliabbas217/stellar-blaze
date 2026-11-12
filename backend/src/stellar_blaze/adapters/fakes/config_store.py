"""In-memory ``RuntimeConfigStore`` for tests: the same rules as the Postgres adapter, none of its I/O.

Production composition never builds this class (``composition`` has no registry entry for it); tests pass it in. One
contract suite (``tests/unit/contract/config_store_contract.py``) runs against it and against Postgres, so the two
cannot disagree about the port.

Beyond the port it offers what a test needs and a real database gives for free:

* ``calls``: the name of every port method called, in order, to assert what a component read.
* ``fail_on``: ``{method name: exception}``, with ``"*"`` for every method; the method raises it, as a database that
  went away would.
* ``add_raw_version`` / ``add_raw_activation``: rows inserted as if by hand through SQL, bypassing the service's
  validation (the defence the poller and ``load_active`` exist for).
* ``hide_latest_activation_once``: the next ``latest_activation()`` answers ``None``, as a read that happened just
  before another process committed would.
"""

import json
from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, datetime

from pydantic import JsonValue

from stellar_blaze.domain.config.runtime import RuntimeConfig, body_sha256, config_body
from stellar_blaze.ports.config_store import (
    ActivationKind,
    ActivationRecord,
    StaleActivationError,
    VersionNotFoundError,
    VersionRecord,
)


def _utc_now() -> datetime:
    return datetime.now(UTC)


class InMemoryConfigStore:
    """Versions and the activation log held in lists; every method is atomic (no ``await`` between check and write)."""

    def __init__(self, *, clock: Callable[[], datetime] = _utc_now) -> None:
        self._clock = clock
        self._versions: list[VersionRecord] = []
        self._activations: list[ActivationRecord] = []
        self.calls: list[str] = []
        self.fail_on: dict[str, Exception] = {}
        self.hide_latest_activation_once = False

    def _enter(self, method: str) -> None:
        self.calls.append(method)
        failure = self.fail_on.get(method) or self.fail_on.get("*")
        if failure is not None:
            raise failure

    def _version_by_hash(self, sha256: str) -> VersionRecord | None:
        return next((v for v in self._versions if v.sha256 == sha256), None)

    def _append_version(
        self, body: Mapping[str, JsonValue], sha256: str, created_by: str, reason: str, schema_version: int
    ) -> VersionRecord:
        record = VersionRecord(
            id=len(self._versions) + 1,
            sha256=sha256,
            body=json.loads(json.dumps(body)),
            schema_version=schema_version,
            created_by=created_by,
            reason=reason,
            created_at=self._clock(),
        )
        self._versions.append(record)
        return record

    def _append_activation(
        self, version_id: int, kind: ActivationKind, actor: str, reason: str, previous: int | None
    ) -> ActivationRecord:
        record = ActivationRecord(
            id=len(self._activations) + 1,
            config_version_id=version_id,
            kind=kind,
            actor=actor,
            reason=reason,
            previous_activation_id=previous,
            activated_at=self._clock(),
        )
        self._activations.append(record)
        return record

    # --- the port -------------------------------------------------------------------------------------------------

    async def latest_activation(self) -> ActivationRecord | None:
        self._enter("latest_activation")
        if self.hide_latest_activation_once:
            self.hide_latest_activation_once = False
            return None
        return self._activations[-1] if self._activations else None

    async def get_version(self, version_id: int) -> VersionRecord:
        self._enter("get_version")
        for version in self._versions:
            if version.id == version_id:
                return version
        raise VersionNotFoundError(version_id)

    async def create_version(self, config: RuntimeConfig, *, actor: str, reason: str) -> VersionRecord:
        self._enter("create_version")
        body = config_body(config)
        sha256 = body_sha256(body)
        existing = self._version_by_hash(sha256)
        if existing is not None:
            return existing
        return self._append_version(body, sha256, actor, reason, config.schema_version)

    async def activate(
        self, version_id: int, *, expected_previous: int | None, kind: ActivationKind, actor: str, reason: str
    ) -> ActivationRecord:
        self._enter("activate")
        latest = self._activations[-1].id if self._activations else None
        if expected_previous != latest:  # Postgres: a unique violation on previous_activation_id, or a foreign key
            raise StaleActivationError(expected_previous)
        if not any(v.id == version_id for v in self._versions):
            raise VersionNotFoundError(version_id)
        return self._append_activation(version_id, kind, actor, reason, expected_previous)

    async def history(self, limit: int) -> Sequence[ActivationRecord]:
        self._enter("history")
        if limit < 1:
            msg = f"limit must be at least 1, got {limit}"
            raise ValueError(msg)
        return list(reversed(self._activations))[:limit]

    # --- test helpers: what a real database admits that the service never writes -----------------------------------

    def add_raw_version(
        self,
        body: Mapping[str, JsonValue],
        *,
        sha256: str | None = None,
        created_by: str = "hand",
        reason: str = "inserted by hand for a test",
    ) -> VersionRecord:
        """Store ``body`` as is, with ``sha256`` (default: the hash of the body), as an ``INSERT`` through SQL would."""
        schema_version = body.get("schema_version")
        return self._append_version(
            body,
            sha256 if sha256 is not None else body_sha256(body),
            created_by,
            reason,
            schema_version if isinstance(schema_version, int) else 1,
        )

    def add_raw_activation(
        self,
        version_id: int,
        *,
        kind: ActivationKind | None = None,
        actor: str = "hand",
        reason: str = "activated by hand for a test",
    ) -> ActivationRecord:
        """Activate ``version_id`` on top of the latest activation without any validation of the version."""
        latest = self._activations[-1].id if self._activations else None
        return self._append_activation(
            version_id, kind or ("seed" if latest is None else "activate"), actor, reason, latest
        )
