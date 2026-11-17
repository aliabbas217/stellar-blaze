"""``alembic/env.py`` builds its own engine (outside the app): a failing statement must not print row values."""

import ast
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

ENV = Path(__file__).resolve().parents[2] / "alembic" / "env.py"


def test_every_engine_the_migration_env_builds_hides_statement_parameters() -> None:
    calls = [
        node
        for node in ast.walk(ast.parse(ENV.read_text(encoding="utf-8")))
        if isinstance(node, ast.Call)
        and getattr(node.func, "id", getattr(node.func, "attr", "")) == "create_async_engine"
    ]

    assert calls, "env.py no longer builds an engine: update this guard"
    for call in calls:
        hidden = {k.arg: k.value for k in call.keywords}.get("hide_parameters")
        assert isinstance(hidden, ast.Constant)
        assert hidden.value is True
