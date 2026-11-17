"""Replay snapshots never feed back into training or evaluation: a static scan of ``src/stellar_blaze/ml``.

The architect's go-ahead of 2026-11-15 lets a replay snapshot hold the real 2026 summer (``REPLAY_LOCKED_SUMMERS`` is
empty). A snapshot is display data for the live demo. It must never reach a model, a threshold or a selection, so the
code that trains, selects, scores and releases (everything under ``ml/``) may not touch the replay side at all:

* no import of ``adapters.sources.replay`` (the replay sources) or ``jobs.replay_build`` (the snapshot builder), in any
  form (absolute, relative, ``from package import module``, or a string given to ``importlib``);
* no reference to the settings that locate a snapshot (``replay_dir``, ``replay_snapshot_id``, ``replay_default_date``,
  their ``SB_`` environment variables) or to the replay classes and the builder function by name.

``ReplaySnapshot`` (the plain manifest model in ``domain.weather.replay``) is data without I/O and is not on the list.
The scan is proven non-vacuous below: it finds each kind of violation in a synthetic module and in a temporary copy of
the real tree with one real module mutated.
"""

import ast
import shutil
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

SRC = Path(__file__).resolve().parents[3] / "src" / "stellar_blaze"
ML = SRC / "ml"

FORBIDDEN_MODULES = ("stellar_blaze.adapters.sources.replay", "stellar_blaze.jobs.replay_build")
FORBIDDEN_NAMES = frozenset(
    {
        "replay_dir",
        "replay_snapshot_id",
        "replay_default_date",
        "SB_REPLAY_DIR",
        "SB_REPLAY_SNAPSHOT_ID",
        "SB_REPLAY_DEFAULT_DATE",
        "ReplayForecastSource",
        "ReplayObservationSource",
        "build_replay_snapshot",
    }
)


def _tail(dotted: str, parts: int) -> str:
    return ".".join(dotted.split(".")[-parts:])


def _is_forbidden_module(dotted: str) -> bool:
    """``dotted`` is a forbidden module (or a submodule), absolute or as the tail of a relative import."""
    return any(
        dotted == module or dotted.startswith(module + ".") or _tail(module, dotted.count(".") + 1) == dotted
        for module in FORBIDDEN_MODULES
        if dotted
    )


def violations(tree: ast.AST) -> list[tuple[int, str]]:
    """``(line, what)`` of every reference to the replay side in ``tree``."""
    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        line = getattr(node, "lineno", 0)
        if isinstance(node, ast.Import):
            found += [(line, f"import {a.name}") for a in node.names if _is_forbidden_module(a.name)]
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if _is_forbidden_module(module):
                found.append((line, f"from {'.' * node.level}{module} import ..."))
            for alias in node.names:  # ``from stellar_blaze.jobs import replay_build`` and the relative forms
                joined = f"{module}.{alias.name}" if module else alias.name
                if alias.name in FORBIDDEN_NAMES or _is_forbidden_module(joined):
                    found.append((line, f"from {'.' * node.level}{module} import {alias.name}"))
        elif isinstance(node, ast.Name) and node.id in FORBIDDEN_NAMES:
            found.append((line, f"name {node.id}"))
        elif isinstance(node, ast.Attribute) and node.attr in FORBIDDEN_NAMES:
            found.append((line, f"attribute {node.attr}"))
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            value = node.value
            if value in FORBIDDEN_NAMES or any(module in value for module in FORBIDDEN_MODULES):
                found.append((line, f"string {value!r}"))
    return found


def scan(root: Path) -> dict[str, list[tuple[int, str]]]:
    """The violations of every Python file under ``root``, by path relative to it (files with none are left out)."""
    out: dict[str, list[tuple[int, str]]] = {}
    for path in sorted(root.rglob("*.py")):
        found = violations(ast.parse(path.read_text(encoding="utf-8"), filename=str(path)))
        if found:
            out[path.relative_to(root).as_posix()] = found
    return out


def test_nothing_under_ml_touches_the_replay_side() -> None:
    assert scan(ML) == {}


def test_the_scan_sees_the_ml_tree() -> None:
    """A wrong ``ML`` path would make the scan above pass vacuously."""
    files = sorted(ML.rglob("*.py"))
    assert len(files) > 15
    assert {"data.py", "train.py", "selection.py", "evaluate.py"} <= {f.name for f in files}


@pytest.mark.parametrize(
    ("source", "fragment"),
    [
        pytest.param(
            "import stellar_blaze.jobs.replay_build\n", "import stellar_blaze.jobs.replay_build", id="import-builder"
        ),
        pytest.param(
            "import stellar_blaze.adapters.sources.replay as r\n", "adapters.sources.replay", id="import-sources"
        ),
        pytest.param(
            "from stellar_blaze.jobs.replay_build import build_replay_snapshot\n", "replay_build", id="from-builder"
        ),
        pytest.param(
            "from stellar_blaze.adapters.sources.replay import ReplayForecastSource\n",
            "sources.replay",
            id="from-sources",
        ),
        pytest.param("from stellar_blaze.jobs import replay_build\n", "replay_build", id="from-package-module"),
        pytest.param("from stellar_blaze.adapters.sources import replay\n", "replay", id="from-sources-package-module"),
        pytest.param("from ..jobs import replay_build\n", "replay_build", id="relative-package-module"),
        pytest.param("from ..jobs.replay_build import ReplayHoldoutError\n", "replay_build", id="relative-builder"),
        pytest.param(
            "from ..adapters.sources.replay import ReplayObservationSource\n", "sources.replay", id="relative-sources"
        ),
        pytest.param(
            "import importlib\nimportlib.import_module('stellar_blaze.jobs.replay_build')\n",
            "replay_build",
            id="importlib-string",
        ),
        pytest.param("def f(settings):\n    return settings.replay_dir / 'x'\n", "replay_dir", id="read-replay-dir"),
        pytest.param(
            "def f(settings):\n    return getattr(settings, 'replay_snapshot_id')\n",
            "replay_snapshot_id",
            id="getattr-snapshot-id",
        ),
        pytest.param(
            "import os\nos.environ['SB_REPLAY_SNAPSHOT_ID']\n", "SB_REPLAY_SNAPSHOT_ID", id="environment-variable"
        ),
        pytest.param("x = ReplayForecastSource\n", "ReplayForecastSource", id="class-by-name"),
    ],
)
def test_the_scan_flags_each_kind_of_reference(source: str, fragment: str) -> None:
    found = violations(ast.parse(source))

    assert found, f"the scan missed: {source!r}"
    assert any(fragment in what for _, what in found)


@pytest.mark.parametrize(
    "source",
    [
        "from stellar_blaze.domain.weather.replay import ReplaySnapshot\n",  # plain manifest data, no I/O
        "from stellar_blaze.adapters.storage.parquet_store import ParquetStore\n",
        "from stellar_blaze.jobs import cli\n",
        "replayed = 1\n",
        "import stellar_blaze.adapters.sources.open_meteo\n",
    ],
)
def test_the_scan_leaves_unrelated_code_alone(source: str) -> None:
    assert violations(ast.parse(source)) == []


def test_a_real_module_with_one_offending_import_is_caught(tmp_path: Path) -> None:
    """The mutation: copy the real ``ml/`` tree, add one import to one real module, and the scan names exactly it."""
    copy = tmp_path / "ml"
    shutil.copytree(ML, copy, ignore=shutil.ignore_patterns("__pycache__"))
    assert scan(copy) == {}  # the copy is clean before the mutation

    target = copy / "metrics.py"
    target.write_text(
        target.read_text(encoding="utf-8") + "\nfrom stellar_blaze.jobs import replay_build\n", encoding="utf-8"
    )

    caught = scan(copy)
    assert list(caught) == ["metrics.py"]
    assert caught["metrics.py"][0][1].endswith("import replay_build")
