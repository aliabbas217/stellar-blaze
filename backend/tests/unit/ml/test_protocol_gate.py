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
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from stellar_blaze.ml.data import TEST_SUMMER, HoldoutViolationError, load_test_pairs
from stellar_blaze.ml.git import GitError, GitReader, SubprocessGit
from stellar_blaze.ml.protocol_gate import (
    RESULT_FILES,
    GateRefusedError,
    GateToken,
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


@dataclass
class World:
    repo_root: Path
    lock_path: Path
    results_dir: Path
    models_dir: Path
    git: FakeGit

    def write_lock(self, *, amendments: Sequence[tuple[str, str, str]] = (), **changes: str | None) -> None:
        """Rewrite the lock; ``None`` drops a key (TOML has no null); ``amendments`` are (path, sha, commit) triples."""
        values: dict[str, str | None] = {
            "protocol_path": PROTOCOL_PATH,
            "protocol_sha256": sha(PROTOCOL_BYTES),
            "protocol_commit": PROTOCOL_COMMIT,
            "gold_sha256": GOLD_SHA,
            "model_id": MODEL_ID,
            "freeze_path": FREEZE_PATH,
            "freeze_sha256": sha(FREEZE_BYTES),
        }
        values.update(changes)
        lines = [f'{key} = "{value}"' for key, value in values.items() if value is not None]
        for path, digest, commit in amendments:
            lines += ["", "[[amendments]]", f'path = "{path}"', f'sha256 = "{digest}"', f'commit = "{commit}"']
        self.lock_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

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
    ("gold-sha-missing", Part.FORECAST, _no_gold_sha),
    ("gold-sha-missing", Part.WARNINGS, _no_gold_sha),
    ("gold-sha-missing", Part.PLANS, _no_gold_sha),
    ("amendment-hash-mismatch", Part.FORECAST, _amendment_edited),
    ("amendment-not-ancestor", Part.FORECAST, _amendment_not_an_ancestor),
    ("amendment-content-mismatch", Part.FORECAST, _amendment_committed_differently),
    ("freeze-missing", Part.WARNINGS, _no_freeze),
    ("freeze-missing", Part.PLANS, _no_freeze),
    ("freeze-hash-mismatch", Part.WARNINGS, _freeze_edited),
    ("freeze-hash-mismatch", Part.PLANS, _freeze_not_committed_as_locked),
    ("result-exists", Part.FORECAST, _prior_result(Part.FORECAST)),
    ("result-exists", Part.WARNINGS, _prior_result(Part.WARNINGS)),
    ("result-exists", Part.PLANS, _prior_result(Part.PLANS)),
]


@pytest.mark.parametrize(("code", "part", "mutate"), _REFUSALS, ids=[f"{c}-{p.value}" for c, p, _ in _REFUSALS])
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
    ("method", "code"),
    [
        ("head", "git-error"),
        ("is_ancestor", "commit-not-ancestor"),
        ("show", "commit-content-mismatch"),
        ("is_clean", "tree-dirty"),
    ],
)
def test_a_git_failure_closes_the_gate_with_the_codes_of_the_check(method: str, code: str, world: World) -> None:
    world.git.errors = {method}
    with pytest.raises(GateRefusedError) as refused:
        world.gate(Part.FORECAST)
    assert codes(refused) == [code]
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
