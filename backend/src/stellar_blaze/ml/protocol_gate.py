"""The pre-registration gate for the 2026 evaluation (pre-registration section 9).

``open_gate`` checks every condition of section 9 and either returns a ``GateToken`` or raises ``GateRefusedError``
listing every condition that failed (not the first). The token is the only thing ``load_test_pairs`` accepts, so the
2026 hold-out is unreachable until the gate has opened.

A ``GateToken`` can only be made by ``open_gate``: its constructor needs a module-private sentinel, so
``GateToken(part=..., head=..., lock=...)`` from anywhere else raises ``TypeError``, and so does ``dataclasses.replace``
on a real token (``replace`` calls the constructor without the sentinel). Copying and pickling a token are refused for
the same reason. The class is ``final`` (a subclass raises at class creation), has ``__slots__`` (no ``__dict__`` to
write into) and is frozen. Python cannot stop a caller in the same process who reaches into this module's private names
(``_SENTINEL``) or calls ``object.__setattr__``: that is out of scope. The structural guard is that the only code that
may call ``open_gate`` or ``load_test_pairs`` is listed and checked by ``tests/unit/ml/test_holdout_reachability.py``.

Reasons start with a stable code, then ``: ``, then the message. Codes: ``lock-missing``, ``lock-invalid``,
``protocol-hash-mismatch``, ``commit-not-ancestor``, ``commit-content-mismatch``, ``amendment-hash-mismatch``,
``amendment-not-ancestor``, ``amendment-content-mismatch``, ``tree-dirty``, ``git-error``, ``model-id-missing``,
``model-not-found``, ``model-integrity``, ``model-manifest-sha-missing``, ``model-manifest-mismatch``,
``gold-sha-missing``, ``freeze-missing``, ``freeze-hash-mismatch``,
``go-missing``, ``go-invalid``, ``go-mismatch``, ``go-uncommitted``, ``result-exists`` (from ``open_gate``) and
``head-changed``, ``tree-dirty`` (from ``GateToken.recheck``).

The lock (``backend/training/protocol.lock.toml``) holds ``protocol_path`` (relative to the repository root),
``protocol_sha256`` and ``protocol_commit``, optional ``[[amendments]]`` (``path``, ``sha256``, ``commit``: each is
checked like the protocol itself), ``gold_sha256`` (the one gold file the evaluation may read), ``model_id`` and
``model_manifest_sha256`` (the SHA-256 of the released model's ``manifest.json``, CRLF read as LF: the manifest
lists the hash of every artefact file, ``scan_models`` verifies those, so pinning the manifest pins the exact model that
is evaluated, not only its id) and the ``freeze_*`` keys; all optional keys are absent until they exist (TOML cannot
hold a null, so an absent key means ``None``, or no amendments).

The "2026 go" marker (``backend/training/2026-go.toml``) is the architect's written go-ahead: ``protocol_sha256``,
``model_id``, ``lock_sha256``, ``approved_by`` and ``approved_at`` (an offset date-time). It must exist and parse
(``go-missing``, ``go-invalid``); its ``protocol_sha256`` and ``model_id`` must equal the lock's and its ``lock_sha256``
must be the SHA-256 of the lock file's bytes (CRLF read as LF) (``go-mismatch``), so a go-ahead is valid for exactly one
pre-registration, one model and ONE lock content: any later edit of the lock (another amendment, a different gold hash,
the freeze fields B3 adds) closes the gate until the architect signs again. It must also be committed: the bytes at HEAD
(``git show HEAD:<marker path>``, CRLF read as LF) must equal the working-tree bytes (``go-uncommitted``), the same
standard ``_check_freeze`` holds the freeze file to; the clean-tree check alone would not say that the committed marker
is the one in the tree. No code writes it. Without a readable lock there is nothing to bind to, so only its existence,
form and commit are judged; a lock that names no ``model_id`` is already refused by ``model-id-missing`` and the model
binding is then not judged a second time.
"""

import hashlib
import tomllib
from dataclasses import InitVar, dataclass
from enum import StrEnum
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Annotated, Final, NoReturn, final

import structlog
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, ValidationError, field_validator

from stellar_blaze.adapters.config.models import MANIFEST, ModelIntegrityError, scan_models
from stellar_blaze.domain.config.models import MODEL_ID, Sha256
from stellar_blaze.ml.git import GitError, GitReader

__all__ = [
    "RESULT_FILES",
    "GateRefusedError",
    "GateToken",
    "GoMarker",
    "Part",
    "ProtocolAmendment",
    "ProtocolLock",
    "load_go",
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


_Commit = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{40}$")]


class ProtocolAmendment(BaseModel):
    """One amendment of the pre-registration (``[[amendments]]`` in the lock): a committed file and its hash."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    path: str
    sha256: Sha256
    commit: _Commit

    @field_validator("path")
    @classmethod
    def _inside_the_repository(cls, value: str) -> str:
        return _relative_posix(value)


class ProtocolLock(BaseModel):
    """``training/protocol.lock.toml``: what the pre-registration is, where it was committed, what is being tested."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    protocol_path: str
    protocol_sha256: Sha256
    protocol_commit: _Commit
    amendments: tuple[ProtocolAmendment, ...] = ()
    gold_sha256: Sha256 | None = None
    model_id: Annotated[str, StringConstraints(pattern=MODEL_ID)] | None = None
    model_manifest_sha256: Sha256 | None = None
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


class GoMarker(BaseModel):
    """``training/2026-go.toml``: the architect's written go-ahead, bound to one protocol, one model and one lock.

    ``lock_sha256`` is the SHA-256 of ``backend/training/protocol.lock.toml`` (CRLF read as LF), so the go-ahead is
    valid for exactly one lock content: after ANY lock edit (an amendment, the B3 freeze fields, a gold hash) the
    architect re-signs. Compute it on the committed file with
    ``git show HEAD:backend/training/protocol.lock.toml | sha256sum`` (``git show`` prints the stored LF bytes).

    A complete marker (all five keys, no others; ``approved_at`` needs a UTC offset, a local time is refused)::

        protocol_sha256 = "2ea88c7a30351b12a4dcfc06cdce2af6eab18416176466c2500cb6ef74f745bf"
        model_id = "corrector-20261111-1a2b3c4-5d6e7f"
        lock_sha256 = "0c030586945fe504b604ecc2e875c38ede400cd5cd73da9730302162e6b02c6f"
        approved_by = "Ali Baig"
        approved_at = 2026-11-15T09:30:00+04:00
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    protocol_sha256: Sha256
    model_id: str = Field(min_length=1)
    lock_sha256: Sha256
    approved_by: str = Field(min_length=1)
    approved_at: AwareDatetime


def load_go(path: Path) -> GoMarker:
    """Read and validate the go marker.

    Raises:
        FileNotFoundError: ``path`` does not exist.
        tomllib.TOMLDecodeError: ``path`` is not TOML.
        pydantic.ValidationError: The keys or values are not a ``GoMarker`` (``approved_at`` needs an offset).
    """
    with path.open("rb") as file:
        return GoMarker.model_validate(tomllib.load(file))


# The sentinel only open_gate's factory passes; a GateToken built without it is refused.
_SENTINEL: Final = object()


@final
@dataclass(frozen=True, slots=True)
class GateToken:
    """Proof that ``open_gate`` opened the gate for ``part`` at commit ``head``; only ``open_gate`` makes one.

    Final, frozen, slotted and unconstructible outside ``open_gate`` (see the module docstring for what that does and
    does not guarantee). The job that holds a token calls ``recheck`` immediately before it writes any output, and
    writes with exclusive create (``open(path, "xb")``), so that a second run that raced past the once-only check
    fails instead of overwriting.
    """

    part: Part
    head: str
    lock: ProtocolLock
    _key: InitVar[object] = None

    def __init_subclass__(cls, **kwargs: object) -> None:
        """Refuse every subclass: a subclass is a way around the constructor check.

        Raises:
            TypeError: Always.
        """
        raise TypeError("GateToken is final and cannot be subclassed")

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

    def recheck(self, git: GitReader) -> None:
        """Confirm the repository is still what the gate saw: HEAD unchanged and the working tree clean.

        Call it immediately before writing outputs.

        Raises:
            GateRefusedError: HEAD moved (``head-changed``) or the tree is dirty (``tree-dirty``), or git failed.
        """
        reasons: list[str] = []
        try:
            current = git.head()
            if current != self.head:
                reasons.append(f"head-changed: HEAD was {self.head} when the gate opened and is {current} now")
        except GitError as exc:
            reasons.append(f"head-changed: cannot read HEAD: {exc}")
        try:
            if not git.is_clean():
                reasons.append("tree-dirty: the working tree has modified, staged or untracked files")
        except GitError as exc:
            reasons.append(f"tree-dirty: cannot read the working tree status: {exc}")
        if reasons:
            raise GateRefusedError(tuple(reasons))


def _issue_token(part: Part, head: str, lock: ProtocolLock) -> GateToken:
    return GateToken(part=part, head=head, lock=lock, _key=_SENTINEL)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _check_document(
    repo_root: Path,
    *,
    path: str,
    sha256: str,
    commit: str,
    git: GitReader,
    head: str | None,
    codes: tuple[str, str, str],
) -> list[str]:
    """Check a committed document against the lock.

    Its working-tree bytes hash to ``sha256``, ``commit`` is an ancestor of HEAD, and the bytes at ``commit`` hash to
    ``sha256`` too. ``codes`` are the (hash, ancestor, content) reason codes.
    """
    hash_code, ancestor_code, content_code = codes
    reasons: list[str] = []
    document = repo_root / path
    if not document.is_file():
        reasons.append(f"{hash_code}: {path} does not exist in {repo_root}")
    elif (actual := _sha256(document.read_bytes())) != sha256:
        reasons.append(f"{hash_code}: {path} has sha256 {actual}, the lock says {sha256}")
    if head is not None:
        try:
            if not git.is_ancestor(commit, head):
                reasons.append(f"{ancestor_code}: {commit} ({path}) is not an ancestor of HEAD {head}")
        except GitError as exc:
            reasons.append(f"{ancestor_code}: {path}: {exc}")
    try:
        committed = _sha256(git.show(commit, path))
    except GitError as exc:
        reasons.append(f"{content_code}: cannot read {path} at {commit}: {exc}")
    else:
        if committed != sha256:
            reasons.append(f"{content_code}: {path} at {commit} has sha256 {committed}, the lock says {sha256}")
    return reasons


def _check_protocol(repo_root: Path, lock: ProtocolLock, git: GitReader, head: str | None) -> list[str]:
    reasons = _check_document(
        repo_root,
        path=lock.protocol_path,
        sha256=lock.protocol_sha256,
        commit=lock.protocol_commit,
        git=git,
        head=head,
        codes=("protocol-hash-mismatch", "commit-not-ancestor", "commit-content-mismatch"),
    )
    for amendment in lock.amendments:
        reasons += _check_document(
            repo_root,
            path=amendment.path,
            sha256=amendment.sha256,
            commit=amendment.commit,
            git=git,
            head=head,
            codes=("amendment-hash-mismatch", "amendment-not-ancestor", "amendment-content-mismatch"),
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
    if lock.model_manifest_sha256 is None:
        return [
            "model-manifest-sha-missing: the lock does not pin the released model's manifest hash "
            "(model_manifest_sha256): the evaluated artefact must be the exact one the lock names"
        ]
    manifest_path = models_dir / lock.model_id / MANIFEST
    try:
        actual = hashlib.sha256(_lf(manifest_path.read_bytes())).hexdigest()
    except OSError as exc:
        return [f"model-integrity: cannot read {manifest_path}: {exc}"]
    if actual != lock.model_manifest_sha256:
        return [
            f"model-manifest-mismatch: {manifest_path} has SHA-256 {actual}, the lock pins "
            f"{lock.model_manifest_sha256} (a different model artefact than the one the lock froze)"
        ]
    return []


def _lf(data: bytes) -> bytes:
    """``data`` with CRLF read as LF (a Windows checkout with autocrlf holds the same text as git does)."""
    return data.replace(b"\r\n", b"\n")


def _check_go(
    repo_root: Path, go_path: Path, lock_path: Path, lock: ProtocolLock | None, git: GitReader, head: str | None
) -> list[str]:
    """The go marker exists, parses, is committed at HEAD, and (with a lock) is bound to its hashes and model id."""
    if not go_path.is_file():
        return [
            f"go-missing: {go_path} does not exist (the architect's 2026 go-ahead is written by hand, never by code)"
        ]
    reasons: list[str] = []
    if head is not None:  # git failed otherwise and git-error has said so
        reasons += _check_go_committed(repo_root, go_path, git, head)
    try:
        marker = load_go(go_path)
    except (tomllib.TOMLDecodeError, ValidationError) as exc:
        return [*reasons, f"go-invalid: {go_path} is not a valid go marker: {exc}"]
    if lock is not None and marker.protocol_sha256 != lock.protocol_sha256:
        reasons.append(
            f"go-mismatch: {go_path} approves protocol_sha256 {marker.protocol_sha256}, the lock has "
            f"{lock.protocol_sha256}"
        )
    if lock is not None and lock.model_id is not None and marker.model_id != lock.model_id:
        reasons.append(f"go-mismatch: {go_path} approves model_id {marker.model_id}, the lock has {lock.model_id}")
    if lock is not None and marker.lock_sha256 != (actual := _sha256(_lf(lock_path.read_bytes()))):
        reasons.append(
            f"go-mismatch: {go_path} approves lock_sha256 {marker.lock_sha256}, {lock_path} has {actual} "
            "(the lock changed after the go-ahead: the architect signs again)"
        )
    return reasons


def _check_go_committed(repo_root: Path, go_path: Path, git: GitReader, head: str) -> list[str]:
    """The marker's bytes at HEAD equal the working-tree bytes (CRLF read as LF)."""
    try:
        relative = go_path.relative_to(repo_root).as_posix()
    except ValueError:
        return [f"go-uncommitted: {go_path} is not inside the repository {repo_root}, so it cannot be committed"]
    try:
        committed = git.show(head, relative)
    except GitError as exc:
        return [f"go-uncommitted: cannot read {relative} at HEAD {head} (the marker is not committed): {exc}"]
    if _lf(committed) != _lf(go_path.read_bytes()):
        return [f"go-uncommitted: {relative} in the working tree differs from the one committed at HEAD {head}"]
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
    go_path: Path,
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
        go_path: ``backend/training/2026-go.toml``, the architect's go marker; it must lie inside ``repo_root`` and be
            committed (module docstring).
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
        if lock.gold_sha256 is None:
            reasons.append("gold-sha-missing: the lock has no gold_sha256 (the one gold file the evaluation may read)")
        if part in _FREEZE_PARTS:
            reasons += _check_freeze(repo_root, lock, git, head)
    reasons += _check_go(repo_root, go_path, lock_path, lock, git, head)
    result = results_dir / RESULT_FILES[part]
    if result.exists() and not (amendment and amendment.strip()):
        reasons.append(f"result-exists: {result} exists; a re-run needs an amendment id from the section 13 log")

    if reasons or lock is None or head is None:
        raise GateRefusedError(tuple(reasons))
    _log.info("gate_opened", part=part.value, head=head, model_id=lock.model_id, amendment=amendment)
    return _issue_token(part, head, lock)
