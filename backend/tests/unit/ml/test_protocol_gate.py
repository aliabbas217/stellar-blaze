"""The pre-registration gate (``ml/protocol_gate.py``) and ``SubprocessGit`` (``ml/git.py``).

The gate is tested against a fake ``GitReader`` and a throwaway directory tree; ``SubprocessGit`` against a throwaway
git repository created in ``tmp_path`` (the code under test is the only thing that runs git, and never on the worktree).
"""

import copy
import dataclasses
import hashlib
import pickle
import re
import shutil
import subprocess
import tomllib
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Final
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

from stellar_blaze.ml.data import TEST_SUMMER, HoldoutViolationError, load_test_pairs
from stellar_blaze.ml.git import GitError, GitReader, SubprocessGit
from stellar_blaze.ml.protocol_gate import (
    RESULT_FILES,
    GateRefusedError,
    GateToken,
    GoMarker,
    Part,
    ProtocolAmendment,
    ProtocolLock,
    load_lock,
    open_gate,
)
from tests.fixtures.forecast.synthetic import make_pairs

pytestmark = pytest.mark.unit

FIXTURE_MODELS = Path(__file__).resolve().parents[2] / "fixtures" / "models"
MODEL_ID = "corrector-20261111-0000000-000000"  # in FIXTURE_MODELS
PROTOCOL_PATH = "docs/research/protocol.md"
FREEZE_PATH = "docs/research/freeze.md"
PROTOCOL_BYTES = b"# Pre-registration\nline two\n"
FREEZE_BYTES = b"# Freeze addendum\n"
PROTOCOL_COMMIT = "a" * 40
GO_PATH = "backend/training/2026-go.toml"
GOLD_SHA = "7" * 64  # the lock's default pin; loader tests pin the real digest of their synthetic file
HEAD = "b" * 40


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@dataclass
class FakeGit:
    """A ``GitReader`` whose answers are plain attributes."""

    head_id: str = HEAD
    clean: bool = True
    ancestors: set[tuple[str, str]] = field(default_factory=lambda: {(PROTOCOL_COMMIT, HEAD)})
    files: dict[tuple[str, str], bytes] = field(
        default_factory=lambda: {
            (PROTOCOL_COMMIT, PROTOCOL_PATH): PROTOCOL_BYTES,
            (HEAD, PROTOCOL_PATH): PROTOCOL_BYTES,
            (HEAD, FREEZE_PATH): FREEZE_BYTES,
        }
    )
    errors: set[str] = field(default_factory=set)  # names of the methods that raise GitError

    def _maybe_fail(self, method: str) -> None:
        if method in self.errors:
            raise GitError(f"{method} failed")

    def head(self) -> str:
        self._maybe_fail("head")
        return self.head_id

    def is_clean(self) -> bool:
        self._maybe_fail("is_clean")
        return self.clean

    def is_ancestor(self, ancestor: str, descendant: str) -> bool:
        self._maybe_fail("is_ancestor")
        return (ancestor, descendant) in self.ancestors

    def show(self, commit: str, path: str) -> bytes:
        self._maybe_fail("show")
        try:
            return self.files[(commit, path)]
        except KeyError:
            raise GitError(f"{commit}:{path} not found") from None


def sha_lf(data: bytes) -> str:
    """The SHA-256 of ``data`` with CRLF read as LF (how the go marker binds the lock)."""
    return sha(data.replace(b"\r\n", b"\n"))


def manifest_sha(models_dir: Path, model_id: str) -> str:
    """The pin a lock holds for a model: SHA-256 of its ``manifest.json`` (CRLF as LF); zeros if there is none."""
    path = models_dir / model_id / "manifest.json"
    return sha_lf(path.read_bytes()) if path.is_file() else "0" * 64


def go_text(
    *,
    lock_sha256: str,
    protocol_sha256: str = sha(PROTOCOL_BYTES),
    model_id: str = MODEL_ID,
    approved_by: str = "the architect",
    approved_at: str = "2026-11-15T09:30:00+04:00",
) -> str:
    """The text of a ``2026-go.toml`` marker (the values are written as given, so a test can break one)."""
    return (
        f'protocol_sha256 = "{protocol_sha256}"\nmodel_id = "{model_id}"\nlock_sha256 = "{lock_sha256}"\n'
        f'approved_by = "{approved_by}"\napproved_at = {approved_at}\n'
    )


@dataclass
class World:
    repo_root: Path
    lock_path: Path
    go_path: Path
    results_dir: Path
    models_dir: Path
    git: FakeGit

    def go_text(self, **changes: str) -> str:
        """A go marker bound to the lock file as it is now; ``changes`` break one value (``go_text``'s keywords)."""
        return go_text(lock_sha256=sha_lf(self.lock_path.read_bytes()), **changes)

    def write_go(self, text: str | None = None, *, committed: bool = True) -> None:
        """Write the 2026-go marker (the default text is bound to the current lock) and commit it in the fake git.

        ``committed=False`` leaves HEAD without the marker (or with other bytes: the caller sets those).
        """
        data = (self.go_text() if text is None else text).encode("utf-8")
        self.go_path.write_bytes(data)
        if committed:
            self.git.files[(HEAD, GO_PATH)] = data

    def write_lock(self, *, amendments: Sequence[tuple[str, str, str]] = (), **changes: str | None) -> None:
        """Rewrite the lock; ``None`` drops a key (TOML has no null); ``amendments`` are (path, sha, commit) triples.

        The go marker is rewritten (and committed in the fake git) bound to the new lock (its protocol hash, model id
        and lock hash; a lock without a model id keeps the default one), so a test that changes the lock breaks one
        thing only. A go test rewrites the marker afterwards.
        """
        model_id = changes.get("model_id", MODEL_ID) or MODEL_ID
        values: dict[str, str | None] = {
            "protocol_path": PROTOCOL_PATH,
            "protocol_sha256": sha(PROTOCOL_BYTES),
            "protocol_commit": PROTOCOL_COMMIT,
            "gold_sha256": GOLD_SHA,
            "model_id": MODEL_ID,
            "model_manifest_sha256": manifest_sha(self.models_dir, model_id),
            "freeze_path": FREEZE_PATH,
            "freeze_sha256": sha(FREEZE_BYTES),
        }
        values.update(changes)
        lines = [f'{key} = "{value}"' for key, value in values.items() if value is not None]
        for path, digest, commit in amendments:
            lines += ["", "[[amendments]]", f'path = "{path}"', f'sha256 = "{digest}"', f'commit = "{commit}"']
        self.lock_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        self.write_go(
            self.go_text(protocol_sha256=values["protocol_sha256"] or "", model_id=values["model_id"] or MODEL_ID)
        )

    def add_amendment(
        self,
        name: str,
        data: bytes,
        commit: str,
        *,
        tree_bytes: bytes | None = None,
        committed_bytes: bytes | None = None,
        is_ancestor: bool = True,
    ) -> tuple[str, str, str]:
        """Create an amendment file and its git facts; the optional arguments break one of its three checks."""
        path = f"docs/research/{name}.md"
        (self.repo_root / path).write_bytes(data if tree_bytes is None else tree_bytes)
        self.git.files[(commit, path)] = data if committed_bytes is None else committed_bytes
        if is_ancestor:
            self.git.ancestors.add((commit, HEAD))
        return path, sha(data), commit

    def gate(
        self, part: Part = Part.FORECAST, *, amendment: str | None = None, git: GitReader | None = None
    ) -> GateToken:
        return open_gate(
            repo_root=self.repo_root,
            lock_path=self.lock_path,
            part=part,
            results_dir=self.results_dir,
            models_dir=self.models_dir,
            go_path=self.go_path,
            git=self.git if git is None else git,
            amendment=amendment,
        )


@pytest.fixture
def world(tmp_path: Path) -> World:
    """A repository tree where every check of section 9 holds, for every part."""
    repo = tmp_path / "repo"
    for relative, data in ((PROTOCOL_PATH, PROTOCOL_BYTES), (FREEZE_PATH, FREEZE_BYTES)):
        (repo / relative).parent.mkdir(parents=True, exist_ok=True)
        (repo / relative).write_bytes(data)
    built = World(
        repo_root=repo,
        lock_path=repo / "backend" / "training" / "protocol.lock.toml",
        go_path=repo / "backend" / "training" / "2026-go.toml",
        results_dir=repo / "artifacts" / "eval" / "2026",
        models_dir=FIXTURE_MODELS,
        git=FakeGit(),
    )
    built.lock_path.parent.mkdir(parents=True)
    built.write_lock()
    return built


def codes(error: pytest.ExceptionInfo[GateRefusedError]) -> list[str]:
    return [reason.split(": ", 1)[0] for reason in error.value.reasons]


def _drop_the_lock(w: World) -> None:
    w.lock_path.unlink()


def _break_the_lock(w: World) -> None:
    w.lock_path.write_text('protocol_path = "x"\nunknown_key = 1\n', encoding="utf-8")


def _edit_the_working_tree_protocol(w: World) -> None:
    (w.repo_root / PROTOCOL_PATH).write_bytes(PROTOCOL_BYTES + b"edited\n")


def _no_ancestry(w: World) -> None:
    w.git.ancestors.clear()


def _committed_protocol_differs(w: World) -> None:
    w.git.files[(PROTOCOL_COMMIT, PROTOCOL_PATH)] = PROTOCOL_BYTES + b"other\n"


def _dirty_tree(w: World) -> None:
    w.git.clean = False


def _no_model_id(w: World) -> None:
    w.write_lock(model_id=None)


def _unknown_model_id(w: World) -> None:
    w.write_lock(model_id="corrector-20261113-0000000-000009")


def _unverifiable_models(w: World) -> None:
    w.models_dir = w.models_dir.parent / "no-such-models-directory"


def _no_manifest_pin(w: World) -> None:
    w.write_lock(model_manifest_sha256=None)


def _manifest_pin_for_another_artefact(w: World) -> None:
    w.write_lock(model_manifest_sha256="a" * 64)


def _manifest_edited_after_the_pin(w: World) -> None:
    """The model's manifest changes after the lock pinned it: the id, the lock and the go all still agree."""
    copied = w.repo_root.parent / "models"  # never edit the shared fixture directory
    shutil.copytree(FIXTURE_MODELS, copied)
    manifest = copied / MODEL_ID / "manifest.json"
    manifest.write_bytes(manifest.read_bytes() + b"\n")
    w.models_dir = copied


def _no_freeze(w: World) -> None:
    w.write_lock(freeze_path=None, freeze_sha256=None)


def _freeze_edited(w: World) -> None:
    (w.repo_root / FREEZE_PATH).write_bytes(FREEZE_BYTES + b"edited\n")


def _freeze_not_committed_as_locked(w: World) -> None:
    w.git.files[(HEAD, FREEZE_PATH)] = FREEZE_BYTES + b"other\n"


def _no_gold_sha(w: World) -> None:
    w.write_lock(gold_sha256=None)


def _amendment_edited(w: World) -> None:
    w.write_lock(amendments=[w.add_amendment("amend-1", b"one\n", "c" * 40, tree_bytes=b"one edited\n")])


def _amendment_not_an_ancestor(w: World) -> None:
    w.write_lock(amendments=[w.add_amendment("amend-1", b"one\n", "c" * 40, is_ancestor=False)])


def _amendment_committed_differently(w: World) -> None:
    w.write_lock(amendments=[w.add_amendment("amend-1", b"one\n", "c" * 40, committed_bytes=b"other\n")])


def _no_go_marker(w: World) -> None:
    w.go_path.unlink()


def _unparsable_go_marker(w: World) -> None:
    w.write_go("this is = = not toml\n")


def _go_marker_with_a_naive_time(w: World) -> None:
    w.write_go(w.go_text(approved_at="2026-11-15T09:30:00"))  # a TOML local date-time: no offset, so not AwareDatetime


def _go_marker_with_an_extra_key(w: World) -> None:
    w.write_go(w.go_text() + 'note = "extra keys are refused"\n')


def _go_marker_for_another_protocol(w: World) -> None:
    w.write_go(w.go_text(protocol_sha256="1" * 64))


def _go_marker_for_another_model(w: World) -> None:
    w.write_go(w.go_text(model_id="corrector-20261113-0000000-000009"))


def _go_marker_for_another_lock(w: World) -> None:
    w.write_go(w.go_text().replace(sha_lf(w.lock_path.read_bytes()), "2" * 64))


def _lock_edited_after_the_go(w: World) -> None:
    """A later committed lock edit (another gold hash) with the old go-ahead left as it was."""
    w.lock_path.write_text(
        w.lock_path.read_text(encoding="utf-8").replace(f'"{GOLD_SHA}"', '"' + "8" * 64 + '"'), encoding="utf-8"
    )


def _go_marker_not_committed(w: World) -> None:
    del w.git.files[(HEAD, GO_PATH)]


def _go_marker_edited_after_the_commit(w: World) -> None:
    w.git.files[(HEAD, GO_PATH)] = w.go_path.read_bytes() + b"# edited since\n"


def _prior_result(part: Part) -> Callable[[World], None]:
    def mutate(w: World) -> None:
        w.results_dir.mkdir(parents=True)
        (w.results_dir / RESULT_FILES[part]).write_text("{}", encoding="utf-8")

    return mutate


_REFUSALS: list[tuple[str, Part, Callable[[World], None]]] = [
    ("lock-missing", Part.FORECAST, _drop_the_lock),
    ("lock-invalid", Part.FORECAST, _break_the_lock),
    ("protocol-hash-mismatch", Part.FORECAST, _edit_the_working_tree_protocol),
    ("commit-not-ancestor", Part.FORECAST, _no_ancestry),
    ("commit-content-mismatch", Part.FORECAST, _committed_protocol_differs),
    ("tree-dirty", Part.FORECAST, _dirty_tree),
    ("model-id-missing", Part.FORECAST, _no_model_id),
    ("model-not-found", Part.FORECAST, _unknown_model_id),
    ("model-integrity", Part.FORECAST, _unverifiable_models),
    ("model-manifest-sha-missing", Part.FORECAST, _no_manifest_pin),
    ("model-manifest-mismatch", Part.FORECAST, _manifest_pin_for_another_artefact),
    ("model-manifest-mismatch", Part.FORECAST, _manifest_edited_after_the_pin),
    ("gold-sha-missing", Part.FORECAST, _no_gold_sha),
    ("gold-sha-missing", Part.WARNINGS, _no_gold_sha),
    ("gold-sha-missing", Part.PLANS, _no_gold_sha),
    ("amendment-hash-mismatch", Part.FORECAST, _amendment_edited),
    ("amendment-not-ancestor", Part.FORECAST, _amendment_not_an_ancestor),
    ("amendment-content-mismatch", Part.FORECAST, _amendment_committed_differently),
    ("go-missing", Part.FORECAST, _no_go_marker),
    ("go-missing", Part.WARNINGS, _no_go_marker),
    ("go-missing", Part.PLANS, _no_go_marker),
    ("go-invalid", Part.FORECAST, _unparsable_go_marker),
    ("go-invalid", Part.FORECAST, _go_marker_with_a_naive_time),
    ("go-invalid", Part.FORECAST, _go_marker_with_an_extra_key),
    ("go-mismatch", Part.FORECAST, _go_marker_for_another_protocol),
    ("go-mismatch", Part.FORECAST, _go_marker_for_another_model),
    ("go-mismatch", Part.FORECAST, _go_marker_for_another_lock),
    ("go-mismatch", Part.FORECAST, _lock_edited_after_the_go),
    ("go-uncommitted", Part.FORECAST, _go_marker_not_committed),
    ("go-uncommitted", Part.FORECAST, _go_marker_edited_after_the_commit),
    ("freeze-missing", Part.WARNINGS, _no_freeze),
    ("freeze-missing", Part.PLANS, _no_freeze),
    ("freeze-hash-mismatch", Part.WARNINGS, _freeze_edited),
    ("freeze-hash-mismatch", Part.PLANS, _freeze_not_committed_as_locked),
    ("result-exists", Part.FORECAST, _prior_result(Part.FORECAST)),
    ("result-exists", Part.WARNINGS, _prior_result(Part.WARNINGS)),
    ("result-exists", Part.PLANS, _prior_result(Part.PLANS)),
]


@pytest.mark.parametrize(
    ("code", "part", "mutate"), _REFUSALS, ids=[f"{c}-{p.value}-{m.__name__.strip('_')}" for c, p, m in _REFUSALS]
)
def test_gate_refuses_each_failure(code: str, part: Part, mutate: Callable[[World], None], world: World) -> None:
    mutate(world)
    with pytest.raises(GateRefusedError) as refused:
        world.gate(part)
    assert any(reason.startswith(f"{code}: ") for reason in refused.value.reasons)
    # One broken thing gives one reason (no cascade), and the exception message lists it.
    assert codes(refused) == [code]
    assert refused.value.reasons[0] in str(refused.value)


@pytest.mark.parametrize("part", list(Part))
def test_gate_opens_when_all_hold(part: Part, world: World) -> None:
    token = world.gate(part)
    assert token.head == HEAD
    assert token.part is part
    assert token.lock == load_lock(world.lock_path)
    assert token.lock.model_id == MODEL_ID


def test_gate_opens_with_good_amendments(world: World) -> None:
    good = [
        world.add_amendment("amend-1", b"one\n", "c" * 40),
        world.add_amendment("amend-2", b"two\n", "d" * 40),
    ]
    world.write_lock(amendments=good)
    token = world.gate(Part.FORECAST)
    assert [a.path for a in token.lock.amendments] == [path for path, _, _ in good]
    assert all(isinstance(a, ProtocolAmendment) for a in token.lock.amendments)


def test_gate_reports_only_the_bad_amendment(world: World) -> None:
    good = world.add_amendment("amend-1", b"one\n", "c" * 40)
    bad = world.add_amendment("amend-2", b"two\n", "d" * 40, tree_bytes=b"two edited\n", is_ancestor=False)
    world.write_lock(amendments=[good, bad])
    with pytest.raises(GateRefusedError) as refused:
        world.gate(Part.FORECAST)
    assert codes(refused) == ["amendment-hash-mismatch", "amendment-not-ancestor"]
    assert all(bad[0] in reason for reason in refused.value.reasons)
    assert not any(good[0] in reason for reason in refused.value.reasons)


def test_gate_lists_every_failure_not_the_first(world: World) -> None:
    _edit_the_working_tree_protocol(world)
    _no_ancestry(world)
    _committed_protocol_differs(world)
    _dirty_tree(world)
    _unknown_model_id(world)
    _prior_result(Part.WARNINGS)(world)
    world.lock_path.write_text(
        world.lock_path.read_text(encoding="utf-8").replace(
            f'freeze_sha256 = "{sha(FREEZE_BYTES)}"', 'freeze_sha256 = "' + "1" * 64 + '"'
        ),
        encoding="utf-8",
    )
    with pytest.raises(GateRefusedError) as refused:
        world.gate(Part.WARNINGS)
    assert codes(refused) == [
        "protocol-hash-mismatch",
        "commit-not-ancestor",
        "commit-content-mismatch",
        "tree-dirty",
        "model-not-found",
        "freeze-hash-mismatch",
        "freeze-hash-mismatch",  # the working tree and HEAD both differ from the (replaced) locked hash
        "go-mismatch",  # the lock edit above also falls outside what the go-ahead signed (its lock_sha256)
        "result-exists",
    ]
    for reason in refused.value.reasons:
        assert reason in str(refused.value)


def test_gate_without_a_lock_skips_what_needs_it_and_still_reports_the_rest(world: World) -> None:
    _drop_the_lock(world)
    _dirty_tree(world)
    _prior_result(Part.FORECAST)(world)
    with pytest.raises(GateRefusedError) as refused:
        world.gate(Part.WARNINGS)
    # No protocol, model or freeze reason (they need the lock), and no result-exists: only the FORECAST file exists.
    assert codes(refused) == ["lock-missing", "tree-dirty"]


def test_gate_lists_both_go_bindings_when_both_differ_and_the_marker_is_read_without_a_lock(world: World) -> None:
    world.write_go(world.go_text(protocol_sha256="1" * 64, model_id="corrector-20261113-0000000-000009"))
    with pytest.raises(GateRefusedError) as refused:
        world.gate(Part.FORECAST)
    assert codes(refused) == ["go-mismatch", "go-mismatch"]
    assert "protocol_sha256" in refused.value.reasons[0]
    assert "model_id" in refused.value.reasons[1]
    # Without a lock there is nothing to bind to: a missing marker is still reported, a present one is not judged.
    _drop_the_lock(world)
    _no_go_marker(world)
    with pytest.raises(GateRefusedError) as unlocked:
        world.gate(Part.FORECAST)
    assert codes(unlocked) == ["lock-missing", "go-missing"]


def test_a_go_marker_for_a_lock_without_a_model_id_is_judged_by_model_id_missing_alone(world: World) -> None:
    """The lock names no model (reported once); a marker bound to a model cannot also be called a mismatch."""
    _no_model_id(world)
    with pytest.raises(GateRefusedError) as refused:
        world.gate(Part.FORECAST)
    assert codes(refused) == ["model-id-missing"]


def test_the_go_marker_is_parsed_into_a_frozen_marker_with_an_aware_time() -> None:
    marker = GoMarker.model_validate(
        {
            "protocol_sha256": sha(PROTOCOL_BYTES),
            "model_id": MODEL_ID,
            "lock_sha256": sha(b"the lock"),
            "approved_by": "the architect",
            "approved_at": datetime(2026, 11, 15, 9, 30, tzinfo=UTC),
        }
    )
    assert marker.approved_at.utcoffset() is not None
    with pytest.raises(ValidationError):
        marker.model_id = "other"  # type: ignore[misc]  # frozen
    with pytest.raises(ValidationError):
        GoMarker.model_validate({**marker.model_dump(), "approved_by": ""})  # who approved it must be named
    without_lock_hash = {key: value for key, value in marker.model_dump().items() if key != "lock_sha256"}
    with pytest.raises(ValidationError, match="lock_sha256"):
        GoMarker.model_validate(without_lock_hash)  # the lock binding is required, not optional
    with pytest.raises(ValidationError, match="lock_sha256"):
        GoMarker.model_validate({**marker.model_dump(), "lock_sha256": "not-a-digest"})


def test_the_go_marker_docstring_example_is_a_valid_marker() -> None:
    """The example in the ``GoMarker`` docstring (the architect copies it) parses as a marker with its five keys."""
    docstring = GoMarker.__doc__ or ""
    block = docstring.split("::", 1)[1]
    text = "\n".join(line.strip() for line in block.strip().splitlines())
    marker = GoMarker.model_validate(tomllib.loads(text))
    assert marker.approved_at.utcoffset() is not None
    assert set(tomllib.loads(text)) == set(GoMarker.model_fields)


def test_a_lock_with_crlf_line_endings_keeps_the_go_valid(world: World) -> None:
    """The marker binds the lock with CRLF read as LF: a Windows checkout with autocrlf is the same lock."""
    as_lf = world.lock_path.read_bytes().replace(b"\r\n", b"\n")
    world.lock_path.write_bytes(as_lf.replace(b"\n", b"\r\n"))
    assert b"\r\n" in world.lock_path.read_bytes()
    assert world.gate(Part.FORECAST).part is Part.FORECAST


def test_a_go_marker_with_crlf_line_endings_in_the_tree_is_the_committed_one(world: World) -> None:
    committed = world.go_path.read_bytes().replace(b"\r\n", b"\n")
    world.git.files[(HEAD, GO_PATH)] = committed
    world.go_path.write_bytes(committed.replace(b"\n", b"\r\n"))  # git stores LF, autocrlf writes CRLF
    assert world.gate(Part.FORECAST).part is Part.FORECAST


def test_the_go_marker_is_still_judged_for_its_commit_without_a_lock(world: World) -> None:
    _drop_the_lock(world)
    _go_marker_not_committed(world)
    with pytest.raises(GateRefusedError) as refused:
        world.gate(Part.FORECAST)
    assert codes(refused) == ["lock-missing", "go-uncommitted"]


def test_a_go_marker_outside_the_repository_is_not_committed(world: World, tmp_path: Path) -> None:
    outside = tmp_path / "elsewhere" / "2026-go.toml"
    outside.parent.mkdir()
    outside.write_bytes(world.go_path.read_bytes())
    world.go_path = outside
    with pytest.raises(GateRefusedError) as refused:
        world.gate(Part.FORECAST)
    assert codes(refused) == ["go-uncommitted"]
    assert "not inside the repository" in refused.value.reasons[0]


def test_gate_without_a_lock_reports_a_prior_result_too(world: World) -> None:
    _drop_the_lock(world)
    _prior_result(Part.PLANS)(world)
    with pytest.raises(GateRefusedError) as refused:
        world.gate(Part.PLANS)
    assert codes(refused) == ["lock-missing", "result-exists"]


def test_gate_once_only(world: World) -> None:
    _prior_result(Part.FORECAST)(world)
    assert (world.results_dir / "forecast_skill.json").is_file()
    with pytest.raises(GateRefusedError):
        world.gate(Part.FORECAST)
    with pytest.raises(GateRefusedError):
        world.gate(Part.FORECAST, amendment="")
    with pytest.raises(GateRefusedError):
        world.gate(Part.FORECAST, amendment="   ")
    assert world.gate(Part.FORECAST, amendment="A1").part is Part.FORECAST


def test_a_result_of_one_part_does_not_block_another(world: World) -> None:
    _prior_result(Part.FORECAST)(world)
    assert world.gate(Part.WARNINGS).part is Part.WARNINGS


def test_forecast_part_does_not_need_the_freeze(world: World) -> None:
    _no_freeze(world)
    assert world.gate(Part.FORECAST).part is Part.FORECAST


@pytest.mark.parametrize(
    ("method", "expected"),
    [
        ("head", ["git-error"]),
        ("is_ancestor", ["commit-not-ancestor"]),
        ("show", ["commit-content-mismatch", "go-uncommitted"]),  # the marker's committed bytes are read the same way
        ("is_clean", ["tree-dirty"]),
    ],
)
def test_a_git_failure_closes_the_gate_with_the_codes_of_the_check(
    method: str, expected: list[str], world: World
) -> None:
    world.git.errors = {method}
    with pytest.raises(GateRefusedError) as refused:
        world.gate(Part.FORECAST)
    assert codes(refused) == expected
    assert f"{method} failed" in refused.value.reasons[0]


REAL_LOCK = Path(__file__).resolve().parents[3] / "training" / "protocol.lock.toml"
REPO_ROOT = Path(__file__).resolve().parents[4]


def test_the_real_lock_file_is_consistent_with_the_committed_documents() -> None:
    """Whatever the lock holds today, its hashes match the files in this tree (a lock edit cannot drift silently)."""
    lock = load_lock(REAL_LOCK)
    assert re.fullmatch(r"[0-9a-f]{40}", lock.protocol_commit)
    assert sha((REPO_ROOT / lock.protocol_path).read_bytes()) == lock.protocol_sha256
    for amendment in lock.amendments:
        assert re.fullmatch(r"[0-9a-f]{40}", amendment.commit)
        assert sha((REPO_ROOT / amendment.path).read_bytes()) == amendment.sha256, amendment.path
    if lock.freeze_path is not None:
        assert sha((REPO_ROOT / lock.freeze_path).read_bytes()) == lock.freeze_sha256
    if lock.model_id is not None or lock.model_manifest_sha256 is not None:
        assert lock.model_id is not None, "a manifest pin without the model it belongs to"
        assert lock.model_manifest_sha256 is not None, "a model id without its manifest pin"
        manifest = REPO_ROOT / "backend" / "models" / lock.model_id / "manifest.json"
        assert sha_lf(manifest.read_bytes()) == lock.model_manifest_sha256


REAL_PROTOCOL: Final = "docs/research/2026-11-12-preregistration-2026-evaluation.md"
REAL_AMENDMENTS: Final = (
    "docs/research/2026-11-14-preregistration-amendment-1.md",
    "docs/research/2026-11-15-preregistration-amendment-2.md",
)


REAL_MODEL_ID: Final = "corrector-20261114-d327987-6edafa"


def test_the_real_lock_pins_the_released_model_and_its_manifest() -> None:
    """The lock names the released model AND the hash of its manifest (which lists every artefact file's hash)."""
    lock = load_lock(REAL_LOCK)

    assert lock.model_id == REAL_MODEL_ID
    assert lock.model_manifest_sha256 is not None
    manifest = REPO_ROOT / "backend" / "models" / REAL_MODEL_ID / "manifest.json"
    assert sha_lf(manifest.read_bytes()) == lock.model_manifest_sha256  # the gate also needs a clean tree


def test_the_real_lock_lists_the_preregistration_and_exactly_the_two_amendments() -> None:
    lock = load_lock(REAL_LOCK)

    assert lock.protocol_path == REAL_PROTOCOL
    assert tuple(amendment.path for amendment in lock.amendments) == REAL_AMENDMENTS  # in this order, none else
    for path, pinned in [(lock.protocol_path, lock.protocol_sha256), *((a.path, a.sha256) for a in lock.amendments)]:
        assert sha((REPO_ROOT / path).read_bytes()) == pinned, (
            path
        )  # the committed working-tree bytes are the pinned ones


def _copy_of_the_real_repository_files(tmp_path: Path, *, edited: str | None = None) -> tuple[Path, Path, FakeGit]:
    """The real lock and the three documents it pins, copied under ``tmp_path``, with a fake git that vouches for them.

    ``edited`` is the path of one document whose COPY gets an extra byte (git still holds the pinned bytes).
    """
    lock = load_lock(REAL_LOCK)
    repo = tmp_path / "repo"
    git = FakeGit(files={}, ancestors=set())
    pinned = [(lock.protocol_path, lock.protocol_commit), *((a.path, a.commit) for a in lock.amendments)]
    for path, commit in pinned:
        data = (REPO_ROOT / path).read_bytes()
        (repo / path).parent.mkdir(parents=True, exist_ok=True)
        (repo / path).write_bytes(data + b"\n" if path == edited else data)
        git.files[(commit, path)] = data
        git.ancestors.add((commit, HEAD))
    copied_lock = repo / "backend" / "training" / "protocol.lock.toml"
    copied_lock.parent.mkdir(parents=True)
    shutil.copyfile(REAL_LOCK, copied_lock)
    return repo, copied_lock, git


def _open_the_copied_gate(tmp_path: Path, repo: Path, copied_lock: Path, git: FakeGit) -> list[str]:
    with pytest.raises(GateRefusedError) as refused:  # always refused: no models directory and no go marker here
        open_gate(
            repo_root=repo,
            lock_path=copied_lock,
            part=Part.FORECAST,
            results_dir=tmp_path / "no-results",
            models_dir=tmp_path / "no-models",
            go_path=tmp_path / "no-go.toml",
            git=git,
        )
    return list(refused.value.reasons)


def test_the_gate_accepts_the_real_documents_and_names_no_amendment_problem(tmp_path: Path) -> None:
    repo, copied_lock, git = _copy_of_the_real_repository_files(tmp_path)

    reasons = _open_the_copied_gate(tmp_path, repo, copied_lock, git)

    assert not [reason for reason in reasons if reason.startswith(("amendment-", "protocol-", "commit-"))]


@pytest.mark.parametrize("which", REAL_AMENDMENTS)
def test_the_gate_refuses_when_either_amendment_changes(tmp_path: Path, which: str) -> None:
    repo, copied_lock, git = _copy_of_the_real_repository_files(tmp_path, edited=which)

    reasons = _open_the_copied_gate(tmp_path, repo, copied_lock, git)

    mismatches = [reason for reason in reasons if reason.startswith("amendment-hash-mismatch")]
    assert len(mismatches) == 1
    assert which in mismatches[0]  # and only the edited amendment is named
    assert not any(reason.startswith(("amendment-content", "amendment-not")) for reason in reasons)


REAL_GO = REAL_LOCK.parent / "2026-go.toml"


@pytest.mark.skipif(REAL_GO.exists(), reason="the architect has written the 2026 go marker: the pin below is spent")
def test_the_real_gate_refuses_today_with_go_missing(tmp_path: Path) -> None:
    """The 2026 run is locked until the architect commits ``backend/training/2026-go.toml``: no code writes it.

    The real lock path and the real marker path go to ``open_gate`` (with a fake git, so nothing runs against the
    worktree); ``go-missing`` is among the refusal reasons whatever else the lock still lacks (a model id until the
    model is frozen).
    """
    with pytest.raises(GateRefusedError) as refused:
        open_gate(
            repo_root=REPO_ROOT,
            lock_path=REAL_LOCK,
            part=Part.FORECAST,
            results_dir=tmp_path / "no-results",
            models_dir=tmp_path / "no-models",
            go_path=REAL_GO,
            git=FakeGit(),
        )
    assert "go-missing" in codes(refused)
    assert not REAL_GO.exists()  # the test (like the gate) never creates it


@pytest.mark.parametrize("bad", ["../outside.md", "/etc/passwd", "C:/x.md", "a\\b.md", ""])
def test_lock_paths_must_stay_inside_the_repository(bad: str) -> None:
    with pytest.raises(ValueError, match="relative path"):
        ProtocolLock(protocol_path=bad, protocol_sha256="0" * 64, protocol_commit="a" * 40)


# --- the token -------------------------------------------------------------------------------------------------


def test_gate_token_is_unforgeable_by_replace_copy_and_pickle(world: World) -> None:
    token = world.gate(Part.FORECAST)
    with pytest.raises(TypeError, match="open_gate"):
        dataclasses.replace(token, part=Part.PLANS)
    with pytest.raises(TypeError, match="open_gate"):
        dataclasses.replace(token, head="c" * 40)
    with pytest.raises(TypeError, match="open_gate"):
        copy.copy(token)
    with pytest.raises(TypeError, match="open_gate"):
        copy.deepcopy(token)
    with pytest.raises(TypeError, match="open_gate"):
        pickle.dumps(token)
    with pytest.raises(dataclasses.FrozenInstanceError):
        token.part = Part.PLANS  # type: ignore[misc]


def test_gate_token_is_final_and_has_no_dict_to_write_into(world: World) -> None:
    token = world.gate(Part.FORECAST)
    with pytest.raises(TypeError, match="final"):
        type("Forged", (GateToken,), {})
    assert not hasattr(token, "__dict__")
    with pytest.raises(TypeError):
        vars(token)
    with pytest.raises(AttributeError):
        token.__dict__["part"] = Part.PLANS
    with pytest.raises(AttributeError):
        token.extra = "x"  # type: ignore[attr-defined]


def test_the_loader_wants_exactly_a_gate_token_not_something_that_claims_to_be_one(
    world: World, tmp_path: Path
) -> None:
    """``MagicMock(spec=GateToken)`` passes ``isinstance`` (it forges ``__class__``); the loader checks ``type``."""
    path, digest = _pinned_gold(world, tmp_path)
    impostor = MagicMock(spec=GateToken)
    impostor.part = Part.FORECAST
    assert isinstance(impostor, GateToken)
    with pytest.raises(TypeError, match="MagicMock"):
        load_test_pairs(path, token=impostor, expected_sha256=digest)


def test_a_retargeted_token_is_still_judged_by_its_live_part(world: World, tmp_path: Path) -> None:
    """After ``object.__setattr__`` (same-process abuse, out of scope) the loader still judges the live part."""
    path, digest = _pinned_gold(world, tmp_path)
    token = world.gate(Part.FORECAST)
    object.__setattr__(token, "part", Part.PLANS)
    with pytest.raises(HoldoutViolationError, match=re.escape("the gate token is for part 'plans', not 'forecast'")):
        load_test_pairs(path, token=token, expected_sha256=digest)


def test_gate_token_equality_and_repr_are_the_dataclass_defaults(world: World) -> None:
    first, second = world.gate(Part.FORECAST), world.gate(Part.FORECAST)
    assert first == second
    assert first != world.gate(Part.WARNINGS)
    assert "GateToken(part=<Part.FORECAST: 'forecast'>" in repr(first)
    assert HEAD in repr(first)


def _pinned_gold(world: World, tmp_path: Path) -> tuple[Path, str]:
    """A small synthetic gold file with 2024-2026 and a lock that pins its hash."""
    frame = make_pairs(
        seed=3,
        summers=(2024, 2025, 2026),
        station_bias_c={},
        stations=("OMAA",),
        leads=(0, 1, 2),
        hours_utc=(1, 2, 9, 16),
        summer_days=(1, 2),
    )
    path = tmp_path / "pairs.parquet"
    frame.write_parquet(path)
    digest = sha(path.read_bytes())
    world.write_lock(gold_sha256=digest)
    return path, digest


def test_a_real_token_unlocks_2026_for_its_own_part_only(world: World, tmp_path: Path) -> None:
    path, digest = _pinned_gold(world, tmp_path)
    token = world.gate(Part.FORECAST)
    result = load_test_pairs(path, token=token, expected_sha256=digest)
    assert set(result["summer"].unique()) == {2024, 2025, TEST_SUMMER}
    assert 0 not in set(result["lead_days"].unique())
    assert set(result["hour_utc"].unique()) == {2, 9}
    with pytest.raises(HoldoutViolationError, match=re.escape("the gate token is for part 'forecast', not 'warnings'")):
        load_test_pairs(path, token=token, part=Part.WARNINGS, expected_sha256=digest)
    warnings_token = world.gate(Part.WARNINGS)
    assert (
        load_test_pairs(path, token=warnings_token, part=Part.WARNINGS, expected_sha256=digest).height == result.height
    )
    with pytest.raises(HoldoutViolationError, match=re.escape("the gate token is for part 'warnings', not 'forecast'")):
        load_test_pairs(path, token=warnings_token, expected_sha256=digest)


def test_the_test_loader_refuses_an_expected_hash_that_is_not_the_locks(world: World, tmp_path: Path) -> None:
    path, digest = _pinned_gold(world, tmp_path)
    token = world.gate(Part.FORECAST)
    wrong = "0" * 64
    with pytest.raises(
        HoldoutViolationError, match=re.escape(f"expected_sha256 {wrong} is not the lock's gold_sha256 {digest}")
    ):
        load_test_pairs(path, token=token, expected_sha256=wrong)


def test_the_test_loader_refuses_a_file_that_is_not_the_pinned_one(world: World, tmp_path: Path) -> None:
    path, digest = _pinned_gold(world, tmp_path)
    token = world.gate(Part.FORECAST)
    path.write_bytes(path.read_bytes() + b"tampered")
    with pytest.raises(HoldoutViolationError, match=f"the lock's gold_sha256 is {digest}"):
        load_test_pairs(path, token=token, expected_sha256=digest)


def test_the_test_loader_refuses_a_digest_the_lock_does_not_pin(world: World, tmp_path: Path) -> None:
    """The caller's digest and the file agree with each other but not with the lock (a lock pinned to another file)."""
    path, digest = _pinned_gold(world, tmp_path)
    world.write_lock(gold_sha256="1" * 64)
    token = world.gate(Part.FORECAST)
    with pytest.raises(HoldoutViolationError, match=re.escape(f"expected_sha256 {digest} is not the lock's")):
        load_test_pairs(path, token=token, expected_sha256=digest)


# --- recheck ---------------------------------------------------------------------------------------------------


def test_recheck_passes_when_nothing_moved(world: World) -> None:
    world.gate(Part.FORECAST).recheck(world.git)


def test_recheck_refuses_a_moved_head(world: World) -> None:
    token = world.gate(Part.FORECAST)
    world.git.head_id = "c" * 40
    with pytest.raises(GateRefusedError) as refused:
        token.recheck(world.git)
    assert codes(refused) == ["head-changed"]
    assert HEAD in refused.value.reasons[0]
    assert "c" * 40 in refused.value.reasons[0]


def test_recheck_refuses_a_dirty_tree(world: World) -> None:
    token = world.gate(Part.FORECAST)
    world.git.clean = False
    with pytest.raises(GateRefusedError) as refused:
        token.recheck(world.git)
    assert codes(refused) == ["tree-dirty"]


def test_recheck_lists_both_and_treats_git_failure_as_a_refusal(world: World) -> None:
    token = world.gate(Part.FORECAST)
    world.git.head_id = "c" * 40
    world.git.clean = False
    with pytest.raises(GateRefusedError) as refused:
        token.recheck(world.git)
    assert codes(refused) == ["head-changed", "tree-dirty"]
    world.git.errors = {"head", "is_clean"}
    with pytest.raises(GateRefusedError) as failed:
        token.recheck(world.git)
    assert codes(failed) == ["head-changed", "tree-dirty"]


# --- SubprocessGit on a throwaway repository -------------------------------------------------------------------

_GIT_ENV_VARS = (
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_PREFIX",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_NAMESPACE",
)


@pytest.fixture
def isolated_git(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Make git ignore the host's configuration and any repository the test run itself sits in (a hook sets GIT_DIR)."""
    empty = tmp_path / "empty.gitconfig"
    empty.write_text("", encoding="utf-8")
    for name in _GIT_ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(empty))
    monkeypatch.setenv("GIT_CONFIG_SYSTEM", str(empty))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    monkeypatch.setenv("LC_ALL", "C")  # git's messages in English, whatever the host locale
    repo = tmp_path / "throwaway-repo"
    repo.mkdir()
    return repo


_GIT = shutil.which("git")
_IDENTITY = ("-c", "user.name=Gate Test", "-c", "user.email=gate@example.invalid", "-c", "commit.gpgsign=false")


def _run_git(repo: Path, *args: str) -> str:
    assert _GIT is not None
    done = subprocess.run(  # noqa: S603  (a test helper: the resolved git executable, a fixed argument list, tmp_path)
        [_GIT, *_IDENTITY, *args], check=True, capture_output=True, cwd=repo, text=True, timeout=60
    )
    return done.stdout.strip()


def _commit(repo: Path, message: str) -> str:
    _run_git(repo, "add", "--all")
    _run_git(repo, "commit", "--quiet", "-m", message)
    return _run_git(repo, "rev-parse", "HEAD")


@pytest.mark.skipif(_GIT is None, reason="the git executable is not installed")
def test_subprocess_git_against_a_throwaway_repository(isolated_git: Path) -> None:
    repo = isolated_git
    _run_git(repo, "init", "--quiet", "--initial-branch=main")
    lf_bytes = b"line one\nline two\n"
    crlf_bytes = b"windows\r\nstyle\r\n"
    (repo / "a.txt").write_bytes(lf_bytes)
    (repo / "crlf.txt").write_bytes(crlf_bytes)
    first = _commit(repo, "first")
    reader: GitReader = SubprocessGit(repo)

    # head
    assert reader.head() == first
    assert len(first) == 40

    # is_clean: clean, modified, back to clean, untracked
    assert reader.is_clean() is True
    (repo / "a.txt").write_bytes(lf_bytes + b"edit\n")
    assert reader.is_clean() is False
    (repo / "a.txt").write_bytes(lf_bytes)
    assert reader.is_clean() is True
    (repo / "untracked.txt").write_bytes(b"x\n")
    assert reader.is_clean() is False
    second = _commit(repo, "second")  # tracks untracked.txt
    assert reader.is_clean() is True
    assert reader.head() == second != first

    # is_ancestor: true (also for itself), false, and unknown objects are False
    assert reader.is_ancestor(first, second) is True
    assert reader.is_ancestor(first, first) is True
    assert reader.is_ancestor(second, first) is False
    assert reader.is_ancestor("f" * 40, second) is False
    assert reader.is_ancestor(first, "f" * 40) is False
    with pytest.raises(ValueError, match="option"):
        reader.is_ancestor("--all", second)

    # show: the committed bytes, line endings untouched, at the commit asked for
    assert reader.show(first, "a.txt") == lf_bytes
    assert reader.show(second, "a.txt") == lf_bytes
    assert reader.show(first, "crlf.txt") == crlf_bytes
    assert reader.show(second, "untracked.txt") == b"x\n"
    with pytest.raises(GitError):
        reader.show(first, "untracked.txt")  # not yet committed at the first commit
    with pytest.raises(GitError):
        reader.show("f" * 40, "a.txt")


@pytest.mark.skipif(_GIT is None, reason="the git executable is not installed")
def test_subprocess_git_ignores_repository_selecting_variables(
    isolated_git: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A hook's ``GIT_DIR``/``GIT_WORK_TREE``/``GIT_INDEX_FILE`` must not point the gate at another repository."""
    target, other = isolated_git, tmp_path / "other-repo"
    other.mkdir()
    heads: dict[str, str] = {}
    for name, repo in (("target", target), ("other", other)):
        _run_git(repo, "init", "--quiet", "--initial-branch=main")
        (repo / "f.txt").write_bytes(f"{name}\n".encode())
        heads[name] = _commit(repo, name)
    (other / "dirty.txt").write_bytes(b"untracked in the other repository\n")
    monkeypatch.setenv("GIT_DIR", str(other / ".git"))
    monkeypatch.setenv("GIT_WORK_TREE", str(other))
    monkeypatch.setenv("GIT_INDEX_FILE", str(other / ".git" / "index"))
    reader = SubprocessGit(target)
    assert reader.head() == heads["target"] != heads["other"]
    assert reader.is_clean() is True  # the other repository is dirty
    assert reader.show(heads["target"], "f.txt") == b"target\n"


def test_subprocess_git_outside_a_repository_raises_git_error(
    isolated_git: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("GIT_CEILING_DIRECTORIES", str(tmp_path))  # do not look in the parents for a repository
    with pytest.raises(GitError, match="not a git repository"):
        SubprocessGit(isolated_git).head()


def test_subprocess_git_needs_the_executable(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(shutil, "which", lambda _name: None)
    with pytest.raises(GitError, match="not found on PATH"):
        SubprocessGit(tmp_path)


@pytest.mark.skipif(_GIT is None, reason="the git executable is not installed")
def test_the_gate_wants_the_go_marker_committed_in_a_real_repository(isolated_git: Path, tmp_path: Path) -> None:
    """An untracked marker is refused even when the tree reads as clean; a committed one opens the gate."""
    repo = isolated_git
    _run_git(repo, "init", "--quiet", "--initial-branch=main")
    (repo / PROTOCOL_PATH).parent.mkdir(parents=True)
    (repo / PROTOCOL_PATH).write_bytes(PROTOCOL_BYTES)
    protocol_commit = _commit(repo, "the pre-registration")
    lock_file = repo / "backend" / "training" / "protocol.lock.toml"
    lock_file.parent.mkdir(parents=True)
    lock_file.write_bytes(
        (
            f'protocol_path = "{PROTOCOL_PATH}"\nprotocol_sha256 = "{sha(PROTOCOL_BYTES)}"\n'
            f'protocol_commit = "{protocol_commit}"\ngold_sha256 = "{GOLD_SHA}"\nmodel_id = "{MODEL_ID}"\n'
            f'model_manifest_sha256 = "{manifest_sha(FIXTURE_MODELS, MODEL_ID)}"\n'
        ).encode()
    )
    _commit(repo, "the lock")
    go_file = repo / GO_PATH
    go_file.write_bytes(
        go_text(lock_sha256=sha_lf(lock_file.read_bytes())).encode()
    )  # written, not committed; git is told to ignore it so that only the committed-bytes check can refuse
    (repo / ".git" / "info" / "exclude").write_text("backend/training/2026-go.toml\n", encoding="utf-8")
    reader = SubprocessGit(repo)
    assert reader.is_clean() is True

    def gate() -> GateToken:
        return open_gate(
            repo_root=repo,
            lock_path=lock_file,
            part=Part.FORECAST,
            results_dir=repo / "artifacts" / "eval" / "2026",
            models_dir=FIXTURE_MODELS,
            go_path=go_file,
            git=reader,
        )

    with pytest.raises(GateRefusedError) as untracked:
        gate()
    assert codes(untracked) == ["go-uncommitted"]

    (repo / ".git" / "info" / "exclude").write_text("", encoding="utf-8")
    go_commit = _commit(repo, "the architect's go")
    assert gate().head == go_commit

    go_file.write_bytes(go_file.read_bytes() + b"# edited after the commit\n")  # a tree edit: dirty, and not the commit
    with pytest.raises(GateRefusedError) as edited:
        gate()
    assert codes(edited) == ["tree-dirty", "go-uncommitted"]
