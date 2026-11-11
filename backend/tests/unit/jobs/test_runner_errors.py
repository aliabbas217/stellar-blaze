"""What ``job_run.error`` may hold: the exception's type and message with credentials masked (``redact`` itself is
tested in ``tests/unit/test_redaction.py``)."""

import pytest

from stellar_blaze.jobs.runner import describe_error

pytestmark = pytest.mark.unit


def test_describe_error_is_the_type_name_and_a_redacted_message() -> None:
    error = ValueError("bad dsn postgresql+asyncpg://sb:hunter2@db/x")

    description = describe_error(error)

    assert description == "ValueError: bad dsn postgresql+asyncpg://***@db/x"
    assert "hunter2" not in description


def test_describe_error_masks_a_bearer_token_in_the_message() -> None:
    description = describe_error(RuntimeError("upstream said no (Authorization: Bearer abc.def.ghi)"))

    assert description == "RuntimeError: upstream said no (Authorization: ***"
    assert "abc.def.ghi" not in description


def test_describe_error_is_not_the_repr() -> None:
    assert describe_error(RuntimeError("boom")) == "RuntimeError: boom"
    assert describe_error(KeyError("OMXX")) == "KeyError: 'OMXX'"  # str() of a KeyError, as the traceback shows it
    assert describe_error(RuntimeError()) == "RuntimeError:"


def test_describe_error_is_bounded() -> None:
    description = describe_error(RuntimeError("x" * 10_000))

    assert len(description) < 2100
    assert description.endswith("...")
