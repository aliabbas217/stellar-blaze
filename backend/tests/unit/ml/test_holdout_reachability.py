"""Who can reach the 2026 hold-out: a static scan of ``src/stellar_blaze`` (no gold data involved).

``open_gate`` takes the git reader from its caller and ``load_test_pairs`` takes a token, so the runtime guard alone
does not prove that nothing else unlocks 2026: the guarantee also rests on a short list of call sites. This test makes
that list explicit and fails when it grows without someone deciding it should:

* ``open_gate`` and ``load_test_pairs`` are referenced only by ``ml/protocol_gate.py``, ``ml/data.py`` and
  ``jobs/evaluate_2026.py`` (the job does not exist yet; Task 15 creates it and this test must then pass);
* the job hands ``open_gate`` a ``SubprocessGit(...)`` written inline as the ``git`` argument, never a fake or a
  variable;
* inside ``ml/`` only ``ml/data.py`` reads Parquet; the readers outside ``ml/`` are listed below with the reason each
  is not a gold reader.
"""

import ast
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

SRC = Path(__file__).resolve().parents[3] / "src" / "stellar_blaze"

GATED = frozenset({"open_gate", "load_test_pairs"})
GATE_USERS = frozenset({"ml/protocol_gate.py", "ml/data.py", "jobs/evaluate_2026.py"})
EVALUATE_2026 = SRC / "jobs" / "evaluate_2026.py"

PARQUET_READERS = frozenset({"read_parquet", "scan_parquet"})
ML_PARQUET_READERS = frozenset({"ml/data.py"})
PARQUET_READERS_OUTSIDE_ML = {
    "adapters/sources/ghcnh.py": "decodes the NOAA GHCNh download held in memory (io.BytesIO), never the gold file",
    "adapters/sources/replay.py": (
        "decodes the two data files of a replay snapshot from bytes just checked against snapshot.json (io.BytesIO); "
        "the snapshot is built from silver by jobs/replay_build.py, never from gold/pairs.parquet"
    ),
    "adapters/storage/parquet_store.py": (
        "B1's store reads silver observations and forecasts and counts silver rows (silver_inputs); it has no reader "
        "for gold/pairs.parquet (verified: write_gold only writes)"
    ),
}


def _python_files() -> dict[str, ast.Module]:
    return {
        path.relative_to(SRC).as_posix(): ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for path in sorted(SRC.rglob("*.py"))
    }


def references(tree: ast.AST, names: frozenset[str]) -> list[int]:
    """Lines where one of ``names`` is used: a name, an attribute, an import alias or a string (``getattr(m, "x")``)."""
    lines: list[int] = []
    for node in ast.walk(tree):
        if (
            (isinstance(node, ast.Name) and node.id in names)
            or (isinstance(node, ast.Attribute) and node.attr in names)
            or (isinstance(node, ast.alias) and node.name.split(".")[-1] in names)
            or (isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value in names)
        ):
            lines.append(getattr(node, "lineno", 0))
    return lines


def open_gate_git_arguments(tree: ast.AST) -> list[ast.expr | None]:
    """The ``git=`` argument expression of every ``open_gate(...)`` call (``None`` where it is not given by keyword)."""
    found: list[ast.expr | None] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        name = func.id if isinstance(func, ast.Name) else func.attr if isinstance(func, ast.Attribute) else None
        if name == "open_gate":
            found.append(next((kw.value for kw in node.keywords if kw.arg == "git"), None))
    return found


def is_subprocess_git_call(expression: ast.expr | None) -> bool:
    if not isinstance(expression, ast.Call):
        return False
    func = expression.func
    return (isinstance(func, ast.Name) and func.id == "SubprocessGit") or (
        isinstance(func, ast.Attribute) and func.attr == "SubprocessGit"
    )


def test_the_scan_sees_the_source_tree() -> None:
    files = _python_files()
    assert len(files) > 50  # a wrong SRC would make every scan below pass vacuously
    assert "ml/data.py" in files
    assert references(files["ml/data.py"], GATED), "the scanner must find load_test_pairs in its own module"
    assert references(files["ml/protocol_gate.py"], GATED), "the scanner must find open_gate in its own module"


def test_only_the_gate_the_loader_and_the_job_reference_the_2026_entry_points() -> None:
    users = {name for name, tree in _python_files().items() if references(tree, GATED)}
    assert users <= GATE_USERS, f"unreviewed references to {sorted(GATED)} in {sorted(users - GATE_USERS)}"


def test_the_job_gives_open_gate_a_subprocess_git_inline() -> None:
    if not EVALUATE_2026.exists():
        return  # Task 15 creates jobs/evaluate_2026.py; the synthetic cases below prove this check can fail
    arguments = open_gate_git_arguments(ast.parse(EVALUATE_2026.read_text(encoding="utf-8")))
    assert arguments, "jobs/evaluate_2026.py must call open_gate"
    assert all(is_subprocess_git_call(argument) for argument in arguments)


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("open_gate(git=SubprocessGit(root))", True),
        ("gate.open_gate(repo_root=r, git=git_module.SubprocessGit(root))", True),
        ("open_gate(git=FakeGit())", False),
        ("open_gate(git=reader)", False),
        ("open_gate(repo_root=root)", False),
        ("open_gate(git=None)", False),
    ],
)
def test_the_subprocess_git_check_can_fail(source: str, expected: bool) -> None:
    arguments = open_gate_git_arguments(ast.parse(source))
    assert len(arguments) == 1
    assert is_subprocess_git_call(arguments[0]) is expected


@pytest.mark.parametrize(
    "source",
    [
        "load_test_pairs(path, token=t, expected_sha256=s)",
        "from stellar_blaze.ml.data import load_test_pairs",
        "from stellar_blaze.ml.protocol_gate import open_gate as unlock",
        "gate = protocol_gate.open_gate",
        "fn = getattr(data, 'load_test_pairs')",
    ],
)
def test_the_reference_scan_can_fail(source: str) -> None:
    assert references(ast.parse(source), GATED)


def test_the_reference_scan_ignores_docstrings_and_unrelated_names() -> None:
    assert not references(ast.parse('"""calls open_gate and load_test_pairs"""\nx = open_gates + 1'), GATED)


def test_only_ml_data_reads_parquet_inside_ml() -> None:
    readers = {
        name for name, tree in _python_files().items() if name.startswith("ml/") and references(tree, PARQUET_READERS)
    }
    assert readers == ML_PARQUET_READERS, f"a Parquet reader in ml/ other than ml/data.py: {sorted(readers)}"


def test_the_parquet_readers_outside_ml_are_exactly_the_listed_ones() -> None:
    readers = {
        name
        for name, tree in _python_files().items()
        if not name.startswith("ml/") and references(tree, PARQUET_READERS)
    }
    assert readers == set(PARQUET_READERS_OUTSIDE_ML), (
        f"a new Parquet reader outside ml/ is a decision: new {sorted(readers - set(PARQUET_READERS_OUTSIDE_ML))}, "
        f"stale {sorted(set(PARQUET_READERS_OUTSIDE_ML) - readers)}"
    )


@pytest.mark.parametrize("source", ["pl.scan_parquet(p)", "pl.read_parquet(p)", "reader = pl.scan_parquet"])
def test_the_reader_scan_can_fail(source: str) -> None:
    assert references(ast.parse(source), PARQUET_READERS)
