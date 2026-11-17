"""Who can reach the 2026 hold-out: a static scan of ``src/stellar_blaze`` (no gold data involved).

``open_gate`` takes the git reader from its caller and ``load_test_pairs`` takes a token, so the runtime guard alone
does not prove that nothing else unlocks 2026: the guarantee also rests on a short list of call sites. This test makes
that list explicit and fails when it grows without someone deciding it should:

* ``open_gate``, ``load_test_pairs`` and ``read_corrected_series`` (the reader of the 2026 corrected series, which needs
  a Warnings or Plans token) are referenced only by ``ml/protocol_gate.py``, ``ml/data.py`` and
  ``jobs/evaluate_2026.py`` (the gated evaluation job, Task 15); ``read_corrected_series`` is reachable only through
  the job, which holds the gate token;
* ``evaluate_folds`` and ``evaluate_with_predictor`` (public fold engines of ``ml/evaluate.py`` that, unlike
  ``evaluate_dev``, do not refuse a frame with 2026 rows) are referenced only by ``ml/evaluate.py`` itself and
  ``ml/forecast_test.py`` (which holds a gate token); tests are not scanned here, they are not shipped;
* the job hands ``open_gate`` a ``SubprocessGit(...)`` written inline as the ``git`` argument, never a fake or a
  variable;
* ``GateToken.recheck`` (the last check before a write) is called only by the job, on a token that is a parameter typed
  ``GateToken`` or the result of ``open_gate``, with a ``SubprocessGit(...)`` written inline as its reader;
* inside ``ml/`` only ``ml/data.py`` reads Parquet; the readers outside ``ml/`` are listed below with the reason each
  is not a gold reader.
"""

import ast
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

SRC = Path(__file__).resolve().parents[3] / "src" / "stellar_blaze"

GATED = frozenset({"open_gate", "load_test_pairs", "read_corrected_series"})
GATE_USERS = frozenset({"ml/protocol_gate.py", "ml/data.py", "jobs/evaluate_2026.py"})
SERIES_READER = frozenset({"read_corrected_series"})
SERIES_READER_USERS = frozenset({"ml/data.py", "jobs/evaluate_2026.py"})
EVALUATE_2026 = SRC / "jobs" / "evaluate_2026.py"

UNGUARDED_ENGINES = frozenset({"evaluate_folds", "evaluate_with_predictor"})
"""Public fold engines that skip the 2026 refusal of ``evaluate_dev``: their callers hold a gate token."""
ENGINE_USERS = frozenset({"ml/evaluate.py", "ml/forecast_test.py"})

PARQUET_READERS = frozenset({"read_parquet", "scan_parquet"})
ML_PARQUET_READERS = frozenset({"ml/data.py"})
PARQUET_READERS_OUTSIDE_ML = {
    "adapters/compute/lgbm_corrector.py": (
        "reads the model's two fold_stats climatology parquet files from bytes via io.BytesIO after scan_models "
        "verified their hashes; never the gold file"
    ),
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


def test_the_2026_series_reader_is_reachable_only_through_the_job() -> None:
    users = {name for name, tree in _python_files().items() if references(tree, SERIES_READER)}
    assert users >= SERIES_READER_USERS, "the scan must find the reader in its own module and in the job"
    assert users <= SERIES_READER_USERS, (
        f"unreviewed references to read_corrected_series in {sorted(users - SERIES_READER_USERS)}: it reads the 2026 "
        "series"
    )


def test_only_evaluate_and_the_gated_forecast_row_reference_the_unguarded_fold_engines() -> None:
    users = {name for name, tree in _python_files().items() if references(tree, UNGUARDED_ENGINES)}
    assert users >= ENGINE_USERS, "the scan must find the engines in their own module and in their one caller"
    assert users <= ENGINE_USERS, (
        f"unreviewed references to {sorted(UNGUARDED_ENGINES)} in {sorted(users - ENGINE_USERS)}: they do not refuse "
        "summer 2026"
    )


@pytest.mark.parametrize(
    "source",
    [
        "evaluate_folds(pairs, folds, cfg, cfg_sha256=s, tercile_edges=e)",
        "evaluate_with_predictor(train, test, fold_name='x')",
        "from stellar_blaze.ml.evaluate import evaluate_folds",
        "from stellar_blaze.ml.evaluate import evaluate_with_predictor as run",
        "engine = evaluate.evaluate_folds",
        "fn = getattr(evaluate, 'evaluate_with_predictor')",
    ],
)
def test_the_engine_scan_can_fail(source: str) -> None:
    assert references(ast.parse(source), UNGUARDED_ENGINES)


def test_the_job_gives_open_gate_a_subprocess_git_inline() -> None:
    assert EVALUATE_2026.exists(), "the gated evaluation job jobs/evaluate_2026.py must exist"
    arguments = open_gate_git_arguments(ast.parse(EVALUATE_2026.read_text(encoding="utf-8")))
    assert arguments, "jobs/evaluate_2026.py must call open_gate"
    assert all(is_subprocess_git_call(argument) for argument in arguments)


def recheck_calls(tree: ast.AST) -> list[tuple[ast.Call, ast.FunctionDef | ast.AsyncFunctionDef | None]]:
    """Every ``<receiver>.recheck(...)`` call with the function that encloses it (``None`` at module level)."""
    found: list[tuple[ast.Call, ast.FunctionDef | ast.AsyncFunctionDef | None]] = []

    def visit(node: ast.AST, enclosing: ast.FunctionDef | ast.AsyncFunctionDef | None) -> None:
        for child in ast.iter_child_nodes(node):
            inner = child if isinstance(child, ast.FunctionDef | ast.AsyncFunctionDef) else enclosing
            if isinstance(child, ast.Call) and isinstance(child.func, ast.Attribute) and child.func.attr == "recheck":
                found.append((child, enclosing))
            visit(child, inner)

    visit(tree, None)
    return found


def is_gate_token_receiver(call: ast.Call, function: ast.FunctionDef | ast.AsyncFunctionDef | None) -> bool:
    """The receiver is a plain name that is a ``GateToken``-typed parameter or is assigned from ``open_gate(...)``."""
    receiver = call.func.value if isinstance(call.func, ast.Attribute) else None
    if function is None or not isinstance(receiver, ast.Name):
        return False
    for argument in [*function.args.args, *function.args.kwonlyargs]:
        annotation = argument.annotation
        if argument.arg == receiver.id and isinstance(annotation, ast.Name) and annotation.id == "GateToken":
            return True
    for node in ast.walk(function):
        if (
            isinstance(node, ast.Assign)
            and isinstance(node.value, ast.Call)
            and isinstance(node.value.func, ast.Name | ast.Attribute)
            and (getattr(node.value.func, "id", None) or getattr(node.value.func, "attr", None)) == "open_gate"
            and any(isinstance(target, ast.Name) and target.id == receiver.id for target in node.targets)
        ):
            return True
    return False


def recheck_call_is_safe(call: ast.Call, function: ast.FunctionDef | ast.AsyncFunctionDef | None) -> bool:
    """One ``token.recheck(SubprocessGit(...))`` on a token the gate issued."""
    return (
        is_gate_token_receiver(call, function)
        and len(call.args) == 1
        and not call.keywords
        and is_subprocess_git_call(call.args[0])
    )


def test_only_the_job_calls_recheck_on_its_own_token_with_an_inline_subprocess_git() -> None:
    callers = {
        name: calls
        for name, tree in _python_files().items()
        if name != "ml/protocol_gate.py" and (calls := recheck_calls(tree))
    }
    assert set(callers) == {"jobs/evaluate_2026.py"}, f"recheck is called by {sorted(callers)}"
    assert all(recheck_call_is_safe(call, function) for call, function in callers["jobs/evaluate_2026.py"])


_SAFE = "def run(token: GateToken):\n    token.recheck(SubprocessGit(root))\n"
_OPENED = "def run():\n    token = open_gate(git=SubprocessGit(root))\n    token.recheck(SubprocessGit(root))\n"


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        (_SAFE, True),
        ("def run(token: GateToken):\n    token.recheck(git.SubprocessGit(root))\n", True),
        (_OPENED, True),
        ("def run(token: GateToken):\n    token.recheck(FakeGit())\n", False),
        ("def run(token: GateToken):\n    token.recheck(reader)\n", False),
        ("def run(token: GateToken):\n    token.recheck(git=SubprocessGit(root))\n", False),
        ("def run(token):\n    token.recheck(SubprocessGit(root))\n", False),  # an untyped token: unknown origin
        ("def run(token: object):\n    token.recheck(SubprocessGit(root))\n", False),
        ("def run(token: GateToken):\n    other.recheck(SubprocessGit(root))\n", False),
        ("token.recheck(SubprocessGit(root))\n", False),  # at module level there is no token
        ("def run():\n    token = make()\n    token.recheck(SubprocessGit(root))\n", False),
    ],
)
def test_the_recheck_check_can_fail(source: str, expected: bool) -> None:
    calls = recheck_calls(ast.parse(source))
    assert len(calls) == 1
    assert recheck_call_is_safe(*calls[0]) is expected


def test_the_recheck_scan_sees_a_call_and_ignores_docstrings() -> None:
    assert recheck_calls(ast.parse(_SAFE))
    assert not recheck_calls(ast.parse('"""token.recheck(x)"""\nrechecked = 1'))


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
        "series = read_corrected_series(path, manifest, token=t)",
        "from stellar_blaze.ml.data import read_corrected_series as read",
        "reader = data.read_corrected_series",
        "fn = getattr(data, 'read_corrected_series')",
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
