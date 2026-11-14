"""The pre-registration gate for the 2026 evaluation (pre-registration section 9).

``open_gate`` checks every condition of section 9 and either returns a ``GateToken`` or raises ``GateRefusedError``
listing every condition that failed (not the first). The token is the only thing ``load_test_pairs`` accepts, so the
2026 hold-out is unreachable until the gate has opened.

A ``GateToken`` can only be made by ``open_gate``: its constructor needs a module-private sentinel, so
``GateToken(part=..., head=..., lock=...)`` from anywhere else raises ``TypeError``, and so does ``dataclasses.replace``
on a real token (``replace`` calls the constructor without the sentinel). Copying and pickling a token are refused for
the same reason. Python cannot stop a caller who reaches into this module's private names; the guard is against
accidents and against code that "just builds a token to get the data", and every use of a token is visible in review.

Reasons start with a stable code, then ``: ``, then the message. Codes: ``lock-missing``, ``lock-invalid``,
``protocol-hash-mismatch``, ``commit-not-ancestor``, ``commit-content-mismatch``, ``tree-dirty``, ``git-error``,
``model-id-missing``, ``model-not-found``, ``model-integrity``, ``freeze-missing``, ``freeze-hash-mismatch`` and
``result-exists``.

The lock (``backend/training/protocol.lock.toml``) holds ``protocol_path`` (relative to the repository root),
``protocol_sha256`` and ``protocol_commit``; ``model_id`` and the ``freeze_*`` keys are absent until they exist (TOML
cannot hold a null, so an absent key means ``None``).
"""

import hashlib
import tomllib
from dataclasses import InitVar, dataclass
from enum import StrEnum
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Annotated, Final, NoReturn

import structlog
from pydantic import BaseModel, ConfigDict, StringConstraints, ValidationError, field_validator

from stellar_blaze.adapters.config.models import ModelIntegrityError, scan_models
from stellar_blaze.domain.config.models import MODEL_ID, Sha256
from stellar_blaze.ml.git import GitError, GitReader

__all__ = [
    "RESULT_FILES",
    "GateRefusedError",
    "GateToken",
    "Part",
    "ProtocolLock",
    "load_lock",
    "open_gate",
]

_log = structlog.get_logger(__name__)


class Part(StrEnum):
    """The three parts of the gated run (``sb-jobs evaluate-2026 --part``)."""

    FORECAST = "forecast"
    WARNINGS = "warnings"
    PLANS = "plans"


RESULT_FILES: Final[dict[Part, str]] = {
    Part.FORECAST: "forecast_skill.json",
    Part.WARNINGS: "policy_scoreboard.json",
    Part.PLANS: "plan_scoreboard.json",
}
"""The file whose presence in ``artifacts/eval/2026/`` means the part has run (pre-registration sections 7 and 12)."""

_FREEZE_PARTS: Final = frozenset({Part.WARNINGS, Part.PLANS})


class GateRefusedError(RuntimeError):
    """The gate did not open. ``reasons`` lists every failed check, each as ``<code>: <message>``."""

    def __init__(self, reasons: tuple[str, ...]) -> None:
        """Keep ``reasons`` and list all of them in the message."""
        super().__init__("the 2026 gate is closed:\n  - " + "\n  - ".join(reasons))
        self.reasons = reasons


def _relative_posix(value: str) -> str:
    posix = PurePosixPath(value)
    if (
        not value
        or "\\" in value
        or PureWindowsPath(value).drive
        or posix.is_absolute()
        or not posix.parts
        or ".." in posix.parts
    ):
        raise ValueError(
            f"path {value!r} must be a relative path with forward slashes that stays inside the repository"
        )
    return value


class ProtocolLock(BaseModel):
    """``training/protocol.lock.toml``: what the pre-registration is, where it was committed, what is being tested."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    protocol_path: str
    protocol_sha256: Sha256
    protocol_commit: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{40}$")]
    model_id: Annotated[str, StringConstraints(pattern=MODEL_ID)] | None = None
    freeze_path: str | None = None
    freeze_sha256: Sha256 | None = None

    @field_validator("protocol_path", "freeze_path")
    @classmethod
    def _inside_the_repository(cls, value: str | None) -> str | None:
        return None if value is None else _relative_posix(value)


def load_lock(path: Path) -> ProtocolLock:
    """Read and validate a lock file.

    Raises:
        FileNotFoundError: ``path`` does not exist.
        tomllib.TOMLDecodeError: ``path`` is not TOML.
        pydantic.ValidationError: The keys or values are not a ``ProtocolLock``.
    """
    with path.open("rb") as file:
        return ProtocolLock.model_validate(tomllib.load(file))


# The sentinel only open_gate's factory passes; a GateToken built without it is refused.
_SENTINEL: Final = object()


@dataclass(frozen=True)
class GateToken:
    """Proof that ``open_gate`` opened the gate for ``part`` at commit ``head``; only ``open_gate`` makes one."""

    part: Part
    head: str
    lock: ProtocolLock
    _key: InitVar[object] = None

    def __post_init__(self, _key: object) -> None:
        """Refuse a construction that did not come through ``open_gate``.

        Raises:
            TypeError: The private sentinel was not passed (always the case outside this module).
        """
        if _key is not _SENTINEL:
            raise TypeError("a GateToken cannot be constructed directly; call open_gate")

    def __reduce__(self) -> NoReturn:
        """Refuse ``copy``, ``deepcopy`` and ``pickle``: they rebuild an object without running the constructor."""
        raise TypeError("a GateToken cannot be copied or pickled; call open_gate")


def _issue_token(part: Part, head: str, lock: ProtocolLock) -> GateToken:
    return GateToken(part=part, head=head, lock=lock, _key=_SENTINEL)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _check_protocol(repo_root: Path, lock: ProtocolLock, git: GitReader, head: str | None) -> list[str]:
    reasons: list[str] = []
    protocol = repo_root / lock.protocol_path
    if not protocol.is_file():
        reasons.append(f"protocol-hash-mismatch: {lock.protocol_path} does not exist in {repo_root}")
    elif (actual := _sha256(protocol.read_bytes())) != lock.protocol_sha256:
        reasons.append(
            f"protocol-hash-mismatch: {lock.protocol_path} has sha256 {actual}, the lock says {lock.protocol_sha256}"
        )
    if head is not None:
        try:
            if not git.is_ancestor(lock.protocol_commit, head):
                reasons.append(f"commit-not-ancestor: {lock.protocol_commit} is not an ancestor of HEAD {head}")
        except GitError as exc:
            reasons.append(f"commit-not-ancestor: {exc}")
    try:
        committed = _sha256(git.show(lock.protocol_commit, lock.protocol_path))
    except GitError as exc:
        reasons.append(f"commit-content-mismatch: cannot read {lock.protocol_path} at {lock.protocol_commit}: {exc}")
    else:
        if committed != lock.protocol_sha256:
            reasons.append(
                f"commit-content-mismatch: {lock.protocol_path} at {lock.protocol_commit} has sha256 {committed}, "
                f"the lock says {lock.protocol_sha256}"
            )
    return reasons


def _check_model(lock: ProtocolLock, models_dir: Path) -> list[str]:
    if lock.model_id is None:
        return ["model-id-missing: the lock names no released model_id (it is added when the model is frozen)"]
    try:
        registry = scan_models(models_dir)
    except (ModelIntegrityError, ValidationError) as exc:
        return [f"model-integrity: the models in {models_dir} do not verify: {exc}"]
    if lock.model_id not in registry.ids():
        return [
            f"model-not-found: {lock.model_id} is not in {models_dir} (found: {', '.join(registry.ids()) or 'none'})"
        ]
    return []


def _check_freeze(repo_root: Path, lock: ProtocolLock, git: GitReader, head: str | None) -> list[str]:
    if lock.freeze_path is None or lock.freeze_sha256 is None:
        return ["freeze-missing: the lock has no freeze_path and freeze_sha256 (the section 11 addendum)"]
    reasons: list[str] = []
    freeze = repo_root / lock.freeze_path
    if not freeze.is_file():
        reasons.append(f"freeze-hash-mismatch: {lock.freeze_path} does not exist in {repo_root}")
    elif (actual := _sha256(freeze.read_bytes())) != lock.freeze_sha256:
        reasons.append(
            f"freeze-hash-mismatch: {lock.freeze_path} has sha256 {actual}, the lock says {lock.freeze_sha256}"
        )
    if head is not None:  # the freeze must be committed, not only present
        try:
            committed = _sha256(git.show(head, lock.freeze_path))
        except GitError as exc:
            reasons.append(f"freeze-hash-mismatch: cannot read {lock.freeze_path} at HEAD {head}: {exc}")
        else:
            if committed != lock.freeze_sha256:
                reasons.append(
                    f"freeze-hash-mismatch: {lock.freeze_path} at HEAD {head} has sha256 {committed}, "
                    f"the lock says {lock.freeze_sha256}"
                )
    return reasons


def open_gate(
    *,
    repo_root: Path,
    lock_path: Path,
    part: Part,
    results_dir: Path,
    models_dir: Path,
    git: GitReader,
    amendment: str | None = None,
) -> GateToken:
    """Check every condition of pre-registration section 9 and return the token that unlocks the 2026 data.

    Every check runs; the refusal lists all that failed. When the lock cannot be read, the checks that need it are
    skipped and the refusal says so with one reason (``lock-missing`` or ``lock-invalid``).

    Args:
        repo_root: The repository root (the lock's paths are relative to it).
        lock_path: ``backend/training/protocol.lock.toml``.
        part: The part about to run.
        results_dir: ``artifacts/eval/2026``.
        models_dir: ``backend/models``.
        git: The repository queries.
        amendment: The id of the section 13 amendment-log row that allows a re-run; a non-blank string lifts the
            once-only check for this part.

    Returns:
        The token for ``part`` at the current HEAD.

    Raises:
        GateRefusedError: One or more checks failed; ``reasons`` has each as ``<code>: <message>``.
    """
    reasons: list[str] = []
    lock: ProtocolLock | None = None
    if not lock_path.is_file():
        reasons.append(f"lock-missing: {lock_path} does not exist")
    else:
        try:
            lock = load_lock(lock_path)
        except (tomllib.TOMLDecodeError, ValidationError) as exc:
            reasons.append(f"lock-invalid: {lock_path} is not a valid lock: {exc}")

    head: str | None = None
    try:
        head = git.head()
    except GitError as exc:
        reasons.append(f"git-error: cannot read HEAD: {exc}")
    if lock is not None:
        reasons += _check_protocol(repo_root, lock, git, head)
    try:
        if not git.is_clean():
            reasons.append("tree-dirty: the working tree has modified, staged or untracked files")
    except GitError as exc:
        reasons.append(f"tree-dirty: cannot read the working tree status: {exc}")
    if lock is not None:
        reasons += _check_model(lock, models_dir)
        if part in _FREEZE_PARTS:
            reasons += _check_freeze(repo_root, lock, git, head)
    result = results_dir / RESULT_FILES[part]
    if result.exists() and not (amendment and amendment.strip()):
        reasons.append(f"result-exists: {result} exists; a re-run needs an amendment id from the section 13 log")

    if reasons or lock is None or head is None:
        raise GateRefusedError(tuple(reasons))
    _log.info("gate_opened", part=part.value, head=head, model_id=lock.model_id, amendment=amendment)
    return _issue_token(part, head, lock)
