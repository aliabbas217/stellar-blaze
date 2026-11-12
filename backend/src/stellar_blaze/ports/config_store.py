"""The store of runtime config versions and of which one is active (ADR 0010 section 3).

A version is immutable: the body of a ``RuntimeConfig`` exactly as it was stored, its hash, and who proposed it and why.
Activation is an append-only log; the active version is the latest entry's. Every entry names the entry it replaces
(``previous_activation_id``), and a store admits one successor per entry, so two activations that race on the same
predecessor cannot both succeed: that is the whole concurrency control, with no lock. The first entry has no predecessor
and there is only ever one.
"""

from collections.abc import Sequence
from typing import Literal, Protocol

from pydantic import AwareDatetime, BaseModel, ConfigDict, JsonValue

from stellar_blaze.domain.config.runtime import RuntimeConfig

type ActivationKind = Literal["seed", "activate", "rollback"]


class _Record(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class VersionRecord(_Record):
    """One stored config version.

    Attributes:
        id: Assigned by the store, increasing.
        sha256: ``body_sha256(body)``: the hash of the body as stored (see ``domain.config.runtime``).
        body: The config as JSON. It is what was stored, not necessarily what the current ``RuntimeConfig`` schema would
            dump, so it must be re-validated before it is used.
        schema_version: The ``schema_version`` of the body.
        created_by: Who proposed it (an actor name, ``seed:<git sha>`` for the git default).
        reason: Why (10 to 500 characters).
        created_at: When it was first stored.
    """

    id: int
    sha256: str
    body: dict[str, JsonValue]
    schema_version: int
    created_by: str
    reason: str
    created_at: AwareDatetime


class ActivationRecord(_Record):
    """One entry of the activation log: ``config_version_id`` became the active version.

    Attributes:
        kind: ``seed`` for the first entry, ``activate`` for a change, ``rollback`` for a return to an earlier version.
        previous_activation_id: The entry this one replaced; ``None`` only for the first entry.
    """

    id: int
    config_version_id: int
    kind: ActivationKind
    actor: str
    reason: str
    previous_activation_id: int | None
    activated_at: AwareDatetime


class StaleActivationError(Exception):
    """``activate`` was called with an ``expected_previous`` that is not the latest activation.

    Someone activated in between (or the caller named an entry that does not exist, or asked to be the first when an
    activation exists). Nothing was written; the caller reads the latest activation again and decides.
    """

    def __init__(self, expected_previous: int | None) -> None:
        super().__init__(
            "the first activation already exists"
            if expected_previous is None
            else f"activation {expected_previous} is not the latest activation"
        )
        self.expected_previous = expected_previous


class VersionNotFoundError(LookupError):
    """No config version has this id."""

    def __init__(self, version_id: int) -> None:
        super().__init__(f"config version {version_id} does not exist")
        self.version_id = version_id


class RuntimeConfigStore(Protocol):
    """Port of the config versions and the activation log. Postgres in production, an in-memory fake in tests."""

    async def latest_activation(self) -> ActivationRecord | None:
        """The latest activation, or ``None`` while nothing was ever activated. A single-row read."""
        ...

    async def get_version(self, version_id: int) -> VersionRecord:
        """The version with this id.

        Raises:
            VersionNotFoundError: There is none.
        """
        ...

    async def create_version(self, config: RuntimeConfig, *, actor: str, reason: str) -> VersionRecord:
        """Store ``config`` as a version, idempotently on its hash: if a version with the same ``sha256`` exists, that
        row is returned unchanged (its first author and reason stay)."""
        ...

    async def activate(
        self, version_id: int, *, expected_previous: int | None, kind: ActivationKind, actor: str, reason: str
    ) -> ActivationRecord:
        """Append an activation of ``version_id`` that replaces the activation ``expected_previous`` (``None``: there
        is none yet, this is the seed).

        Raises:
            StaleActivationError: ``expected_previous`` is not the latest activation. Nothing was written.
            VersionNotFoundError: ``version_id`` does not exist. Nothing was written.
        """
        ...

    async def history(self, limit: int) -> Sequence[ActivationRecord]:
        """The latest ``limit`` activations, newest first.

        Raises:
            ValueError: ``limit`` is below 1.
        """
        ...
